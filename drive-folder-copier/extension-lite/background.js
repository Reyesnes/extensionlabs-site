// background.js — Service Worker (Manifest V3)
// Core logic: OAuth authentication and copying of explicitly-selected Drive
// files into the user's own My Drive.
//
// This is the "Lite" product: it deliberately uses ONLY the drive.file
// OAuth scope (never the restricted "drive" scope the Pro extension needs).
// drive.file only grants access to files the user explicitly selects via
// the Picker — it can NEVER recurse into an unselected folder's children.
// That's not a bug here, it's the entire point: this product trades away
// automatic recursive folder copying in exchange for never needing Google's
// restricted-scope verification or an annual CASA security assessment. See
// drive-folder-copier/CLAUDE.md for the full reasoning.
//
// DO NOT add folder recursion, "select folder" Picker views, or the
// "drive"/"drive.readonly" scopes to this file. If that's ever needed,
// that's the Pro extension (drive-folder-copier/extension/), not this one.

const DRIVE_API = "https://www.googleapis.com/drive/v3";

// ---------- Pause / cancel control (same pattern as Pro, kept for parity) ----------
class CancelledError extends Error {
  constructor() {
    super("Copy cancelled by user.");
    this.name = "CancelledError";
  }
}

function createJobController() {
  return {
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
    checkpoint() {
      if (this.cancelled) throw new CancelledError();
    }
  };
}

let currentJob = null;

// ---------- Licensing backend integration ----------
// Anonymous data contract, same as the Pro extension: only install_id,
// total_bytes, item_count ever leave the browser. Never a file name, Drive
// ID, or anything that identifies what was copied.
const BACKEND_URL = "https://drive-folder-copier-backend.vercel.app";

// Internal-testing switch: while false, the extension skips the backend
// entirely (no quota check, no usage logging, no balance calls) and every
// copy is unlimited. This is deliberate — Néstor wants to try the core
// flow (Picker multiselect + drive.file + copy) before wiring up billing.
// The billing code beneath this flag is fully built and CASA-audited
// (lite-check-quota / lite-log-operation / lite-get-balance in the backend
// repo) — flip this back to true once ready to charge, don't rewrite it.
const BILLING_ENABLED = false;

// ---------- Identity = Google account (same derivation as Pro) ----------
// install_id is a SHA-256 hash of the signed-in Google account's stable id,
// formatted UUID-shaped. This intentionally produces the SAME install_id
// for someone who uses both the Pro and Lite extensions on the same Google
// account — that's fine, because the backend keeps Lite's tables
// (lite_installs, lite_credit_purchases, lite_operations_log) completely
// separate from Pro's (installs, licenses, operations_log). Same identity,
// two independent quotas/balances.
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToUuidShape(hex32) {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(
    20,
    32
  )}`;
}

async function fetchGoogleAccountInfo(token) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Could not read your Google account info (${res.status}).`);
  }
  const data = await res.json();
  if (!data.id && !data.email) {
    throw new Error("Google did not return an account identifier.");
  }
  return { id: data.id || null, email: data.email || null };
}

async function getInstallId(token) {
  const { id, email } = await fetchGoogleAccountInfo(token);
  const source = id || email;
  const hash = await sha256Hex(source);
  const identity = hexToUuidShape(hash.slice(0, 32));

  const cached = await chrome.storage.local.get(["installId"]);
  if (cached.installId !== identity) {
    // Different (or first) account on this device — old cached balance
    // display belongs to whoever was cached before, drop it.
    await chrome.storage.local.set({ installId: identity, accountEmail: email || null });
  }
  return identity;
}

async function switchAccount() {
  await chrome.storage.local.remove(["authToken", "authTokenExpiresAt", "installId", "accountEmail"]);
  const token = await requestNewToken(true);
  await chrome.storage.local.set({
    authToken: token.accessToken,
    authTokenExpiresAt: Date.now() + token.expiresInSeconds * 1000
  });
  return getInstallId(token.accessToken);
}

// ---------- Quota / balance ----------
const QUOTA_DENIAL_MESSAGES = {
  insufficient_credits: "You've used your free 1 GB. Buy more MB to keep copying — see the extension's \"Buy more\" option.",
  missing_fields: "Something went wrong checking your balance — try again."
};

async function checkQuota(totalBytes, itemCount, token) {
  const installId = await getInstallId(token);

  let response;
  try {
    response = await fetch(`${BACKEND_URL}/api/lite-check-quota`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ install_id: installId, total_bytes: totalBytes, item_count: itemCount })
    });
  } catch (err) {
    throw new Error("Could not verify your balance — check your connection and try again.");
  }

  const data = await response.json();
  if (!data.allowed) {
    const extra = data.reason === "insufficient_credits" && typeof data.bytes_needed === "number"
      ? ` You need ${formatBytes(data.bytes_needed)} more.`
      : "";
    throw new Error((QUOTA_DENIAL_MESSAGES[data.reason] || `Copy not authorized (${data.reason}).`) + extra);
  }
}

async function logOperation(totalBytes, itemCount, token) {
  const installId = await getInstallId(token);
  try {
    await fetch(`${BACKEND_URL}/api/lite-log-operation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ install_id: installId, total_bytes: totalBytes, item_count: itemCount })
    });
  } catch (err) {
    console.warn("Could not log operation to backend:", err.message);
  }
}

async function fetchBalance(token) {
  const installId = await getInstallId(token);
  const res = await fetch(`${BACKEND_URL}/api/lite-get-balance?install_id=${encodeURIComponent(installId)}`);
  if (!res.ok) throw new Error(`Could not fetch balance (${res.status}).`);
  return res.json(); // { free_bytes_remaining, bytes_balance }
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

// ---------- In-memory + persisted state ----------
let copyState = {
  status: "idle", // idle | authenticating | copying | done | error | cancelled
  totalFiles: 0,
  copiedFiles: 0,
  failedFiles: 0,
  currentItem: "",
  errorMessage: "",
  destFolderName: "",
  destFolderId: null
};

function resetState() {
  copyState = {
    status: "idle",
    totalFiles: 0,
    copiedFiles: 0,
    failedFiles: 0,
    currentItem: "",
    errorMessage: "",
    destFolderName: "",
    destFolderId: null
  };
}

function broadcastState() {
  chrome.storage.local.set({ copyState });
  chrome.runtime.sendMessage({ type: "STATE_UPDATE", state: copyState }).catch(() => {});
  updateBadge();
}

function updateBadge() {
  if (copyState.status === "copying" && copyState.totalFiles > 0) {
    const pct = Math.min(100, Math.round((copyState.copiedFiles / copyState.totalFiles) * 100));
    chrome.action.setBadgeText({ text: `${pct}%` });
    chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
  } else if (copyState.status === "done") {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#1e8e3e" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000);
  } else if (copyState.status === "error" || copyState.status === "cancelled") {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// ---------- Keep-alive (same rationale as Pro: MV3 workers can be suspended mid-job) ----------
const KEEP_ALIVE_ALARM = "drive-folder-copier-lite-keep-alive";
function startKeepAlive() {
  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.4 });
}
function stopKeepAlive() {
  chrome.alarms.clear(KEEP_ALIVE_ALARM);
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    // No-op: waking the worker resets its idle timer.
  }
});

// ---------- Authentication ----------
// Same cross-browser approach as Pro (launchWebAuthFlow, not getAuthToken,
// so this works in Edge too), with the same silent-then-interactive token
// caching. See drive-folder-copier/extension/background.js for the full
// rationale — reproduced here rather than shared, since these are two
// separately-packaged extensions with two separate OAuth clients.

// ⚠️ FILL IN: create a NEW OAuth Client ID in the SAME Google Cloud project
// used by the Pro extension (scientific-elf-504912-c7), application type
// "Web application", with an Authorized redirect URI of
// https://lbebgmgpdafocohkmhpjifkadnagliip.chromiumapp.org/
// (that extension ID is fixed by the "key" field in manifest.json, so this
// redirect URI is stable — no chicken-and-egg problem). Do NOT reuse the
// Pro extension's Client ID: this one must only ever request drive.file +
// userinfo.email, and mixing clients makes that harder to audit.
const GOOGLE_OAUTH_CLIENT_ID = "REPLACE_ME.apps.googleusercontent.com";

// Non-sensitive scopes only — this is precisely what lets this product skip
// Google's OAuth verification entirely. Never add "drive" or
// "drive.readonly" here (see the file header comment).
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email"
];

const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

async function getCachedToken() {
  const { authToken, authTokenExpiresAt } = await chrome.storage.local.get(["authToken", "authTokenExpiresAt"]);
  if (authToken && authTokenExpiresAt && Date.now() < authTokenExpiresAt - TOKEN_EXPIRY_SAFETY_MARGIN_MS) {
    return authToken;
  }
  return null;
}

function requestNewToken(interactive) {
  return new Promise((resolve, reject) => {
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("response_type", "token");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", OAUTH_SCOPES.join(" "));
    if (!interactive) {
      authUrl.searchParams.set("prompt", "none");
    }

    chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(new Error(chrome.runtime.lastError?.message || "Authentication was cancelled or failed."));
        return;
      }
      const fragment = new URL(responseUrl).hash.substring(1);
      const params = new URLSearchParams(fragment);
      const accessToken = params.get("access_token");
      const expiresInSeconds = parseInt(params.get("expires_in") || "3599", 10);
      if (!accessToken) {
        reject(new Error("Could not retrieve an access token from Google."));
        return;
      }
      resolve({ accessToken, expiresInSeconds });
    });
  });
}

async function getAuthToken(interactive = true) {
  const cached = await getCachedToken();
  if (cached) return cached;

  let result;
  try {
    result = await requestNewToken(false);
  } catch (silentErr) {
    if (!interactive) throw silentErr;
    result = await requestNewToken(true);
  }

  await chrome.storage.local.set({
    authToken: result.accessToken,
    authTokenExpiresAt: Date.now() + result.expiresInSeconds * 1000
  });
  return result.accessToken;
}

async function invalidateCachedToken() {
  await chrome.storage.local.remove(["authToken", "authTokenExpiresAt"]);
}

async function authedFetch(url, options = {}, token) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    if (res.status === 401) await invalidateCachedToken();
    const body = await res.text();
    const err = new Error(`Drive API error ${res.status}: ${body}`);
    err.status = res.status;
    try {
      const parsed = JSON.parse(body);
      err.driveReason = parsed?.error?.errors?.[0]?.reason || null;
    } catch {
      err.driveReason = null;
    }
    throw err;
  }
  return res.json();
}

const FRIENDLY_DRIVE_ERRORS = {
  cannotCopyFile:
    "This file's owner has disabled copying for viewers and commenters. Ask them to enable it in Share → the gear icon, then try again.",
  insufficientFilePermissions: "You don't have permission to copy this file. Ask the owner to share it with you first.",
  cannotDownloadFile:
    "This file's owner has disabled downloading for your account, which also blocks copying."
};

function getFriendlyErrorMessage(err) {
  return (err.driveReason && FRIENDLY_DRIVE_ERRORS[err.driveReason]) || err.message;
}

async function withRetry(fn, { maxRetries = 5, baseDelayMs = 500 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimited = err.status === 429;
      if (!isRateLimited || attempt >= maxRetries) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
    }
  }
}

// ---------- Drive calls ----------
// Deliberately no listChildren()/folder recursion here — see file header.
// Every item copied by this extension is one the user picked explicitly.

async function getFileMetadata(fileId, token) {
  const url = `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size,shortcutDetails`;
  return authedFetch(url, {}, token);
}

async function createFolder(name, parentId, token) {
  const data = await authedFetch(
    `${DRIVE_API}/files?fields=id,name`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] })
    },
    token
  );
  return data.id;
}

async function copyFile(fileId, name, parentId, token) {
  return authedFetch(
    `${DRIVE_API}/files/${fileId}/copy?fields=id,name`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parents: [parentId] })
    },
    token
  );
}

// ---------- Main flow ----------
// selectedDocs: array of { id, name, mimeType, sizeBytes } from the Picker
// (multiselect, files only — see picker-lite/picker.js).
async function startCopy(selectedDocs) {
  resetState();
  currentJob = createJobController();
  copyState.status = "authenticating";
  broadcastState();
  startKeepAlive();

  try {
    const token = await getAuthToken(true);

    copyState.status = "authenticating"; // fetching real sizes from Drive
    copyState.totalFiles = selectedDocs.length;
    broadcastState();

    // Get authoritative size for each selected file directly from Drive
    // (the Picker's own sizeBytes isn't reliable for every mimeType — e.g.
    // native Google Docs/Sheets/Slides don't carry a byte size at all).
    const metas = [];
    for (const doc of selectedDocs) {
      currentJob.checkpoint();
      const meta = await getFileMetadata(doc.id, token);
      metas.push(meta);
    }

    const totalBytes = metas.reduce((sum, m) => sum + (parseInt(m.size, 10) || 0), 0);
    const itemCount = metas.length;

    // Ask the backend "am I allowed to do this?" BEFORE touching the Drive
    // API for the actual copy. Only anonymous byte/item counts are sent.
    // Skipped entirely while BILLING_ENABLED is false (internal testing).
    if (BILLING_ENABLED) {
      await checkQuota(totalBytes, itemCount, token);
    }

    const rootUser = await authedFetch(`${DRIVE_API}/files/root?fields=id`, {}, token);
    const stamp = new Date().toISOString().slice(0, 10);
    const destFolderName = itemCount > 1 ? `Copied files (${stamp})` : `Copy of ${metas[0].name}`;
    let destParent = rootUser.id;
    let wrappingFolderId = null;

    if (itemCount > 1) {
      wrappingFolderId = await createFolder(destFolderName, rootUser.id, token);
      destParent = wrappingFolderId;
    }

    copyState.status = "copying";
    copyState.destFolderName = destFolderName;
    copyState.destFolderId = wrappingFolderId || rootUser.id;
    broadcastState();

    for (const meta of metas) {
      currentJob.checkpoint();
      copyState.currentItem = meta.name;
      broadcastState();
      try {
        await withRetry(() => copyFile(meta.id, meta.name, destParent, token));
      } catch (err) {
        console.warn(`Could not copy "${meta.name}":`, getFriendlyErrorMessage(err));
        copyState.failedFiles += 1;
      }
      copyState.copiedFiles += 1;
      broadcastState();
    }

    copyState.status = "done";
    broadcastState();

    if (BILLING_ENABLED) {
      await logOperation(totalBytes, itemCount, token);
    }

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Copy complete",
      message: `${copyState.copiedFiles} item(s) copied to your My Drive.`
    });
  } catch (err) {
    if (err.name === "CancelledError") {
      copyState.status = "cancelled";
      broadcastState();
    } else {
      copyState.status = "error";
      copyState.errorMessage = getFriendlyErrorMessage(err);
      broadcastState();
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Copy failed",
        message: getFriendlyErrorMessage(err)
      });
    }
  } finally {
    stopKeepAlive();
  }
}

// ---------- Messaging with popup / hosted picker / hosted checkout ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_STATE") {
    sendResponse({ state: copyState });
  } else if (message.type === "GET_TOKEN") {
    getAuthToken(true)
      .then(async (token) => {
        await getInstallId(token).catch((err) => console.warn("Could not derive identity yet:", err.message));
        return token;
      })
      .then((token) => sendResponse({ token }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  } else if (message.type === "GET_BALANCE") {
    if (!BILLING_ENABLED) {
      sendResponse({ unlimited: true });
      return true;
    }
    getAuthToken(true)
      .then((token) => fetchBalance(token))
      .then((balance) => sendResponse(balance))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  } else if (message.type === "GET_INSTALL_ID") {
    getAuthToken(true)
      .then((token) => getInstallId(token))
      .then((installId) => sendResponse({ installId }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  } else if (message.type === "SWITCH_ACCOUNT") {
    switchAccount()
      .then((installId) => sendResponse({ installId }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  } else if (message.type === "CANCEL_COPY") {
    currentJob?.cancel();
    sendResponse({ ok: true });
  }
  return true;
});

// Messages from the hosted Picker page AND the hosted checkout page.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === "PICKER_RESULT_MULTI") {
    startCopy(message.docs); // [{ id, name, mimeType, sizeBytes }, ...]
    if (tabId) chrome.tabs.remove(tabId);
    sendResponse({ ok: true });
  } else if (message.type === "PICKER_CANCELLED") {
    if (tabId) chrome.tabs.remove(tabId);
    sendResponse({ ok: true });
  } else if (message.type === "CREDITS_PURCHASE_COMPLETED") {
    // Best-effort local ping; the balance itself is re-fetched from the
    // backend (via GET_BALANCE) rather than trusted from this message.
    chrome.runtime.sendMessage({ type: "BALANCE_MAY_HAVE_CHANGED" }).catch(() => {});
    sendResponse({ ok: true });
  }
  return true;
});
