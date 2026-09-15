// background.js — Service Worker (Manifest V3)
// Core logic: OAuth authentication, recursive listing and copying of Drive folders.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const GOOGLE_NATIVE_MIME_PREFIX = "application/vnd.google-apps";

// ---------- Pause / cancel control ----------
// One controller per copy job. Checked at the start of each item (file or
// folder) before making any API call — new work stops immediately on cancel,
// or blocks until resumed on pause. In-flight requests (already past the
// check) are allowed to finish rather than being forcibly aborted.
class CancelledError extends Error {
  constructor() {
    super("Copy cancelled by user.");
    this.name = "CancelledError";
  }
}

function createJobController() {
  return {
    cancelled: false,
    paused: false,
    resumeResolvers: [],
    cancel() {
      this.cancelled = true;
      this._wakeAll();
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
      this._wakeAll();
    },
    _wakeAll() {
      const resolvers = this.resumeResolvers;
      this.resumeResolvers = [];
      resolvers.forEach((r) => r());
    },
    async checkpoint() {
      if (this.cancelled) throw new CancelledError();
      while (this.paused) {
        await new Promise((resolve) => this.resumeResolvers.push(resolve));
        if (this.cancelled) throw new CancelledError();
      }
    }
  };
}

let currentJob = null;

// ---------- Phase 2: licensing backend integration ----------
// Anonymous data contract: only install_id, license_key, total_bytes,
// item_count ever leave the browser. Never a folder name, Drive ID, or
// anything that identifies what was copied. See 02-arquitectura-tecnica.md.
const BACKEND_URL = "https://drive-folder-copier-backend.vercel.app";

// ---------- v1.12.0: identity = Google account (not a random per-browser id) ----------
// Previously, install_id was crypto.randomUUID() generated once per browser
// install — meaning the same person on two devices, or the same person after
// reinstalling, looked like two completely unrelated users to the backend.
// A paid license didn't follow them across devices, and the free-quota
// counter reset on reinstall.
//
// Now, install_id is derived deterministically from the user's Google
// account: we hash Google's stable account id ("sub", returned as `id` by
// the userinfo endpoint) with SHA-256, and format the first 32 hex
// characters as a UUID string. This is NOT a real RFC 4122 UUID (version/
// variant bits aren't set) — it's just a way to fit a hash into the
// existing `install_id UUID` column in Supabase without a schema type
// migration. Postgres' uuid type only validates the hex/dash format, not
// the version bits, so this is accepted without issue.
//
// Same Google account -> same install_id -> same license, on any device.
// Reinstalling the extension no longer resets the free-quota counter.
//
// Requires the "https://www.googleapis.com/auth/userinfo.email" OAuth
// scope (added below in OAUTH_SCOPES) — classified as a NON-sensitive scope
// by Google, so this does NOT add a second restricted scope and does NOT
// affect the CASA exemption strategy (see 07-estrategia-verificacion.md).
// It still needs to be added in Google Cloud Console → OAuth consent
// screen → Data Access → scopes, and shown in the verification demo video.

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

// v1.12.1 fix: before this version, getInstallId() returned ANY cached
// installId without checking what generated it. That meant devices that
// already had an installId cached from before v1.12.0 (a random UUID, not
// a Google-account hash) would NEVER migrate to the new identity scheme —
// they'd keep using the old random UUID forever, silently defeating the
// whole point of Option A for every existing install. This surfaced for
// real: two purchases from the same Google account ended up as two
// unrelated licenses in Supabase, because the second purchase's device
// happened to have its storage cleared (by chance, during a manual
// extension reinstall) and recomputed fresh — on a normal ⟳ reload it
// would NOT have recomputed, and the bug would have stayed invisible.
//
// IDENTITY_SCHEMA_VERSION forces a one-time recomputation on every device
// that doesn't yet have this exact version tag cached, regardless of what
// installId value was already stored. Since the computation is
// deterministic (same Google account -> same hash, every time), this is
// idempotent and safe to run again even on devices that already migrated.
const IDENTITY_SCHEMA_VERSION = 2; // 1 = random UUID (pre-v1.12.0), 2 = Google-account hash

// Derives (and caches) the stable identity for the signed-in Google account.
// Requires an already-obtained OAuth token (callers get one from
// getAuthToken() first) — this function never triggers its own auth prompt,
// to avoid surprise sign-in popups from code paths that don't expect one.
// v1.12.5 fix: previously, this returned the cached installId WITHOUT
// checking whether the account currently authenticated for Drive access
// is even the same one it was originally derived from. That meant if a
// SECOND Google account authenticated on the same browser profile — e.g.
// switching accounts, or a shared computer — the extension kept treating
// the person as whichever account authenticated FIRST on that device,
// forever, no matter which account actually granted the token being used
// right now. Confirmed for real: testing with a new account still showed
// the previous account's paid plan.
//
// Fix: always read the CURRENTLY authenticated account from the token and
// compare it against whatever identity is cached. Only skip the write if
// they genuinely match. If they differ, overwrite the identity AND clear
// any cached license info — that license belongs to the OLD account, not
// this one, and must not keep showing on screen.
async function getInstallId(token) {
  const { id, email } = await fetchGoogleAccountInfo(token);
  const source = id || email;
  const hash = await sha256Hex(source);
  const identity = hexToUuidShape(hash.slice(0, 32));

  const cached = await chrome.storage.local.get(["installId", "identitySchemaVersion"]);
  const isSameIdentity = cached.installId === identity && cached.identitySchemaVersion === IDENTITY_SCHEMA_VERSION;

  if (!isSameIdentity) {
    await chrome.storage.local.set({
      installId: identity,
      identitySchemaVersion: IDENTITY_SCHEMA_VERSION,
      accountEmail: email || null
    });
    // Belongs to whichever account was cached before — not valid for this one.
    await chrome.storage.local.remove(["licenseKey", "licensePlan", "licenseBillingPeriod"]);
  }

  return identity;
}

// Used by the new "Switch account" action in the popup. Clears the cached
// OAuth token (forcing Google's account picker to appear again, even if
// the old token hadn't expired yet) plus the identity and license cache,
// then immediately re-authenticates and re-derives everything fresh.
async function switchAccount() {
  await chrome.storage.local.remove([
    "authToken",
    "authTokenExpiresAt",
    "installId",
    "identitySchemaVersion",
    "accountEmail",
    "licenseKey",
    "licensePlan",
    "licenseBillingPeriod"
  ]);
  const token = await requestNewToken(true); // bypass any cache entirely, always interactive
  await chrome.storage.local.set({
    authToken: token.accessToken,
    authTokenExpiresAt: Date.now() + token.expiresInSeconds * 1000
  });
  return getInstallId(token.accessToken);
}

async function getLicenseKey() {
  const { licenseKey } = await chrome.storage.local.get("licenseKey");
  return licenseKey || null; // null = free-quota user (no paid license yet)
}

const QUOTA_DENIAL_MESSAGES = {
  free_quota_exhausted: "You've used your 2 free copies. Upgrade to keep copying — see the extension's Upgrade option.",
  annual_quota_exhausted: "This copy would exceed your plan's yearly limit. It resets on your renewal date.",
  folder_exceeds_operation_limit: "This folder is larger than your plan allows for a single copy.",
  license_cancelled: "Your license is no longer active.",
  license_past_due: "Your last payment failed — update your billing details to keep copying.",
  license_paused: "Your subscription is currently paused.",
  license_not_found: "We couldn't find an active license for this account.",
  license_superseded: "This license was replaced by a newer plan on this account."
};

async function checkQuota(totalBytes, itemCount, token) {
  const installId = await getInstallId(token);
  const licenseKey = await getLicenseKey();

  let response;
  try {
    response = await fetch(`${BACKEND_URL}/api/check-quota`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        install_id: installId,
        license_key: licenseKey || undefined,
        total_bytes: totalBytes,
        item_count: itemCount
      })
    });
  } catch (err) {
    // Fail closed: if we can't reach the licensing backend at all, don't
    // let the copy proceed silently unmetered.
    throw new Error("Could not verify your quota — check your connection and try again.");
  }

  const data = await response.json();
  if (!data.allowed) {
    throw new Error(QUOTA_DENIAL_MESSAGES[data.reason] || `Copy not authorized (${data.reason}).`);
  }
}

async function logOperation(totalBytes, itemCount, token) {
  const installId = await getInstallId(token);
  const licenseKey = await getLicenseKey();

  try {
    await fetch(`${BACKEND_URL}/api/log-operation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        install_id: installId,
        license_key: licenseKey || undefined,
        total_bytes: totalBytes,
        item_count: itemCount
      })
    });
  } catch (err) {
    // Best-effort — a failed log call shouldn't undo an otherwise-successful
    // copy the user already has in their Drive.
    console.warn("Could not log operation to backend:", err.message);
  }
}

// ---------- In-memory + persisted state ----------
let copyState = {
  status: "idle", // idle | scanning | copying | paused | done | error | cancelled
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
  chrome.runtime.sendMessage({ type: "STATE_UPDATE", state: copyState }).catch(() => {
    // No popup open to receive the message — that's fine, the state is already in storage.
  });
  updateBadge();
}

// ---------- F6: progress badge on the toolbar icon ----------
function updateBadge() {
  if (copyState.status === "copying" && copyState.totalFiles > 0) {
    const pct = Math.min(100, Math.round((copyState.copiedFiles / copyState.totalFiles) * 100));
    chrome.action.setBadgeText({ text: `${pct}%` });
    chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
  } else if (copyState.status === "paused") {
    chrome.action.setBadgeText({ text: "❚❚" });
    chrome.action.setBadgeBackgroundColor({ color: "#f9ab00" });
  } else if (copyState.status === "done") {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#1e8e3e" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000);
  } else if (copyState.status === "error" || copyState.status === "cancelled") {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  } else if (copyState.status === "idle" || copyState.status === "authenticating" || copyState.status === "scanning") {
    chrome.action.setBadgeText({ text: "" });
  }
}

// ---------- Keep-alive ----------
// MV3 service workers can be suspended by Chrome after ~30s of perceived
// inactivity, which would silently kill a long folder copy mid-way. A
// recurring alarm forces the worker to wake up periodically, which resets
// its idle timer and keeps the copy running to completion.
const KEEP_ALIVE_ALARM = "drive-folder-copier-keep-alive";

function startKeepAlive() {
  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.4 }); // ~every 24s
}

function stopKeepAlive() {
  chrome.alarms.clear(KEEP_ALIVE_ALARM);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    // No-op: simply waking up the service worker is enough to reset its idle timer.
  }
});

// ---------- Authentication ----------
// Uses launchWebAuthFlow instead of getAuthToken so this same code works in
// both Chrome AND Edge (getAuthToken is not supported in Edge).
// Trade-off: no automatic token refresh — the user re-authenticates roughly
// every hour, since the implicit grant flow doesn't issue refresh tokens
// without a backend to redeem them securely.

const GOOGLE_OAUTH_CLIENT_ID = "496448603244-6mc053785tdf6phk990tmdj7pslc6rp2.apps.googleusercontent.com";
// v1.12.0: added userinfo.email (non-sensitive scope) to derive a stable
// per-account identity — see the "identity = Google account" comment block
// above. MUST also be added in Google Cloud Console → OAuth consent screen
// → Data Access → scopes, or Google will reject the auth request.
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email"
];

// ---------- OAuth token caching ----------
// launchWebAuthFlow (unlike chrome.identity.getAuthToken) issues a brand
// new token on EVERY call — it has no built-in cache. Previously
// getAuthToken(true) was called independently in two places per copy (once
// for the Picker, once again inside startCopy()), and every interactive
// call also forced prompt=consent — which tells Google to render the FULL
// "wants to access your account" screen every single time, even seconds
// after the exact same scopes were just approved. That combination is why
// picking a folder followed immediately by starting the copy looked like
// two entire back-to-back sign-in flows for one copy operation.
//
// Fix: cache the token with its real expiry (~1h, from expires_in), and
// only go back to Google when there's genuinely nothing valid cached. When
// a new token IS needed, ask silently first (no dialog at all if the
// browser session + prior grant are still valid) and only fall back to an
// interactive prompt — without forcing prompt=consent — if silent fails.
// Google itself then decides how much UI is actually needed based on
// whether these scopes were already granted, instead of us forcing the
// heaviest possible screen unconditionally on every call.
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60 * 1000; // refresh a bit before actual expiry

async function getCachedToken() {
  const { authToken, authTokenExpiresAt } = await chrome.storage.local.get([
    "authToken",
    "authTokenExpiresAt"
  ]);
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
    // No forced "consent" prompt here. If this account already granted
    // these exact scopes before, Google skips straight to (at most) a
    // quick account-selection step instead of re-rendering the whole
    // permissions screen on every single call.
    if (!interactive) {
      authUrl.searchParams.set("prompt", "none");
    }

    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || "Authentication was cancelled or failed."));
          return;
        }
        // The access token comes back in the URL fragment:
        // https://<ext-id>.chromiumapp.org/#access_token=...&token_type=Bearer&expires_in=3599
        const fragment = new URL(responseUrl).hash.substring(1);
        const params = new URLSearchParams(fragment);
        const accessToken = params.get("access_token");
        const expiresInSeconds = parseInt(params.get("expires_in") || "3599", 10);
        if (!accessToken) {
          reject(new Error("Could not retrieve an access token from Google."));
          return;
        }
        resolve({ accessToken, expiresInSeconds });
      }
    );
  });
}

async function getAuthToken(interactive = true) {
  const cached = await getCachedToken();
  if (cached) return cached;

  let result;
  try {
    // Always try silently first, even when the caller allows an
    // interactive fallback — this is what lets a SECOND copy in the same
    // browser session skip every dialog, not just the heavy consent screen.
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

// Clears the cached token so the next getAuthToken() call is forced to get
// a fresh one — used when the Drive API itself rejects a token as invalid/
// expired (401), which can happen if the user revoked access externally.
async function invalidateCachedToken() {
  await chrome.storage.local.remove(["authToken", "authTokenExpiresAt"]);
}

async function authedFetch(url, options = {}, token) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    if (res.status === 401) {
      // The cached token is no longer valid (expired early, or access was
      // revoked externally) — drop it so the next getAuthToken() call is
      // forced to fetch a fresh one instead of reusing this dead one.
      await invalidateCachedToken();
    }
    const body = await res.text();
    const err = new Error(`Drive API error ${res.status}: ${body}`);
    err.status = res.status;
    // v1.12.6: surface Drive's specific machine-readable reason (e.g.
    // "cannotCopyFile") so callers can show a clear, actionable message
    // instead of raw JSON — see FRIENDLY_DRIVE_ERRORS below.
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

// v1.12.6: previously, a failed copy showed the raw Drive API error JSON
// directly in the popup (e.g. the full cannotCopyFile response body) —
// confusing for a paying customer with no context on what to actually do
// about it. This maps the handful of Drive errors people are realistically
// going to hit to a plain-language, actionable message.
const FRIENDLY_DRIVE_ERRORS = {
  cannotCopyFile:
    "This file's owner has disabled copying for viewers and commenters. Ask them to open Share → the gear icon → and enable \"Viewers and commenters can download, copy, and print\" for this file or folder, then try again.",
  insufficientFilePermissions:
    "You don't have permission to copy this file. Ask the owner to share it with you first.",
  cannotDownloadFile:
    "This file's owner has disabled downloading for your account, which also blocks copying. Ask them to enable download access in the sharing settings.",
  teamDriveNotFound:
    "This item is in a shared drive this account can't access. Confirm you still have access to that shared drive.",
  insufficientParentPermissions:
    "You don't have permission to create files in the destination folder you selected."
};

function getFriendlyErrorMessage(err) {
  return (err.driveReason && FRIENDLY_DRIVE_ERRORS[err.driveReason]) || err.message;
}

// ---------- Retry with exponential backoff ----------
// Drive API rate-limits (HTTP 429) under sustained parallel load. Instead of
// marking a file as failed on the first 429, retry with growing delays.
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

// ---------- Concurrency limiter ----------
// Caps how many Drive API write calls (copy/create) run at once, regardless
// of how deep or wide the folder tree is — keeps parallelism fast without
// hammering the API hard enough to trigger sustained rate limiting.
class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }
  acquire() {
    if (this.count < this.max) {
      this.count++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    this.count--;
    const next = this.queue.shift();
    if (next) {
      this.count++;
      next();
    }
  }
}

const COPY_CONCURRENCY = 6;
let copySemaphore = new Semaphore(COPY_CONCURRENCY);

async function runLimited(fn) {
  await copySemaphore.acquire();
  try {
    // Re-check pause/cancel right before doing the actual work — not just
    // once when the item was first queued. Without this, items that were
    // already waiting in line for a free slot ignore Pause/Cancel entirely,
    // since they passed their one-time check long before the click happened.
    await currentJob.checkpoint();
    return await fn();
  } finally {
    copySemaphore.release();
  }
}

// ---------- Utilities ----------
function extractFolderId(urlOrId) {
  const trimmed = urlOrId.trim();
  // Already a plain ID (no slashes or typical URL characters)
  if (!trimmed.includes("/") && !trimmed.includes("http")) return trimmed;

  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/
  ];
  for (const re of patterns) {
    const match = trimmed.match(re);
    if (match) return match[1];
  }
  throw new Error("Could not extract a folder ID from that link. Make sure it's a Google Drive folder link.");
}

async function getFileMetadata(fileId, token) {
  const url = `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size&supportsAllDrives=true`;
  return authedFetch(url, {}, token);
}

async function listChildren(folderId, token) {
  let files = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await authedFetch(`${DRIVE_API}/files?${params.toString()}`, {}, token);
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return files;
}

async function createFolder(name, parentId, token) {
  const data = await authedFetch(
    `${DRIVE_API}/files?fields=id,name&supportsAllDrives=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId]
      })
    },
    token
  );
  return data.id;
}

async function copyFile(fileId, name, parentId, token) {
  return authedFetch(
    `${DRIVE_API}/files/${fileId}/copy?fields=id,name&supportsAllDrives=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parents: [parentId] })
    },
    token
  );
}

// ---------- F4: keep/remove sharing permissions ----------
// Applied only to the top-level copied item (the wrapping folder, or the
// single file) — nested items inherit from their parent in Drive's own
// permission model, so replicating on every single descendant isn't needed.
// Known limitation: ownership can't be transferred this way, only
// viewer/editor/commenter roles are replicated (see 02-arquitectura-tecnica.md).
async function getKeepPermissionsPref() {
  const { keepPermissions } = await chrome.storage.local.get("keepPermissions");
  return !!keepPermissions;
}

async function replicatePermissions(sourceId, destId, token) {
  let perms;
  try {
    perms = await authedFetch(
      `${DRIVE_API}/files/${sourceId}/permissions?fields=permissions(type,role,emailAddress,domain)&supportsAllDrives=true`,
      {},
      token
    );
  } catch (err) {
    console.warn("Could not read source permissions:", err.message);
    return;
  }

  for (const p of perms.permissions || []) {
    if (p.role === "owner") continue; // ownership can't be reassigned via this API
    const body = { role: p.role, type: p.type };
    if (p.emailAddress) body.emailAddress = p.emailAddress;
    if (p.domain) body.domain = p.domain;

    try {
      await authedFetch(
        `${DRIVE_API}/files/${destId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        },
        token
      );
    } catch (err) {
      // Some permission types (e.g. "anyone with the link") can occasionally
      // fail to replicate depending on org policy — skip and continue.
      console.warn("Could not replicate a permission:", err.message);
    }
  }
}

// Recursively scans a folder: counts items AND sums byte sizes. Used both
// for the progress bar (item count) and for the backend's quota check
// (total_bytes) — the anonymous numbers sent to check-quota/log-operation,
// never folder names or file IDs (see 02-arquitectura-tecnica.md).
async function scanFolder(folderId, token) {
  await currentJob.checkpoint();
  const children = await listChildren(folderId, token);
  let itemCount = children.length;
  let totalBytes = 0;

  for (const child of children) {
    if (child.mimeType === `${GOOGLE_NATIVE_MIME_PREFIX}.folder`) {
      const nested = await scanFolder(child.id, token);
      itemCount += nested.itemCount;
      totalBytes += nested.totalBytes;
    } else {
      totalBytes += parseInt(child.size, 10) || 0;
    }
  }

  return { itemCount, totalBytes };
}

// Copies a single item (file or folder). Folders recurse into their own
// children after being created; the semaphore only guards the individual
// API call, not the recursion, so nested branches can run concurrently too.
async function copyOneItem(child, destParentId, token) {
  await currentJob.checkpoint();

  copyState.currentItem = child.name;
  broadcastState();

  if (child.mimeType === `${GOOGLE_NATIVE_MIME_PREFIX}.folder`) {
    const newFolderId = await runLimited(() => withRetry(() => createFolder(child.name, destParentId, token)));
    copyState.copiedFiles += 1;
    broadcastState();
    await copyFolderRecursive(child.id, newFolderId, token);
  } else {
    try {
      await runLimited(() => withRetry(() => copyFile(child.id, child.name, destParentId, token)));
    } catch (err) {
      // Some files (e.g. broken shortcuts, no download permission, or a 429
      // that outlasted our retries) can still fail. We don't stop the whole
      // process because of a single file.
      console.warn(`Could not copy "${child.name}":`, getFriendlyErrorMessage(err));
      copyState.failedFiles += 1;
    }
    copyState.copiedFiles += 1;
    broadcastState();
  }
}

// Recursively copies a folder and its contents. Siblings at each level run
// in parallel (bounded by the global semaphore), instead of one at a time.
async function copyFolderRecursive(sourceFolderId, destParentId, token) {
  await currentJob.checkpoint();
  const children = await listChildren(sourceFolderId, token);
  await Promise.all(children.map((child) => copyOneItem(child, destParentId, token)));
}

// ---------- Main flow ----------
async function startCopy(sourceUrlOrId, destParentId = null) {
  resetState();
  copySemaphore = new Semaphore(COPY_CONCURRENCY);
  currentJob = createJobController();
  copyState.status = "authenticating";
  broadcastState();
  startKeepAlive();

  try {
    const token = await getAuthToken(true);
    const sourceId = extractFolderId(sourceUrlOrId);

    copyState.status = "scanning";
    broadcastState();

    const sourceMeta = await getFileMetadata(sourceId, token);
    const isFolder = sourceMeta.mimeType === `${GOOGLE_NATIVE_MIME_PREFIX}.folder`;

    // Destination: the chosen folder if the Picker's 2-step flow provided one,
    // otherwise fall back to the root of "My Drive" (manual link / current tab flows).
    let destParent = destParentId;
    if (!destParent) {
      const rootUser = await authedFetch(`${DRIVE_API}/files/root?fields=id`, {}, token);
      destParent = rootUser.id;
    }

    const keepPermissions = await getKeepPermissionsPref();

    // ---- Phase 2: ask the backend "am I allowed to do this?" BEFORE
    // touching the Drive API for the actual copy. Only anonymous byte/item
    // counts are sent — see checkQuota()'s data contract above.
    let totalBytes;
    let itemCount;
    if (isFolder) {
      const scan = await scanFolder(sourceId, token);
      totalBytes = scan.totalBytes;
      itemCount = scan.itemCount;
      copyState.totalFiles = itemCount;
      broadcastState();
    } else {
      totalBytes = parseInt(sourceMeta.size, 10) || 0;
      itemCount = 1;
    }

    await checkQuota(totalBytes, itemCount, token);

    if (isFolder) {
      const destFolderName = `${sourceMeta.name} (copy)`;
      const destFolderId = await createFolder(destFolderName, destParent, token);
      copyState.destFolderName = destFolderName;
      copyState.destFolderId = destFolderId;

      copyState.status = "copying";
      broadcastState();

      await copyFolderRecursive(sourceId, destFolderId, token);

      if (keepPermissions) {
        await replicatePermissions(sourceId, destFolderId, token);
      }
    } else {
      // Single file — no recursion, no wrapping folder, just one direct copy.
      copyState.currentItem = sourceMeta.name;
      copyState.status = "copying";
      broadcastState();

      const copyName = `Copy of ${sourceMeta.name}`;
      const copied = await runLimited(() => withRetry(() => copyFile(sourceId, copyName, destParent, token)));

      if (keepPermissions) {
        await replicatePermissions(sourceId, copied.id, token);
      }

      copyState.copiedFiles = 1;
      copyState.destFolderName = copyName;
      copyState.destFolderId = destParent;
      broadcastState();
    }

    copyState.status = "done";
    broadcastState();

    // Best-effort — increments the free-quota counter / annual bucket.
    // Doesn't block or fail the copy if this call itself has trouble.
    await logOperation(totalBytes, itemCount, token);

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Copy complete",
      message: isFolder
        ? `"${copyState.destFolderName}" was copied to your My Drive (${copyState.copiedFiles} items).`
        : `"${copyState.destFolderName}" was copied to your My Drive.`
    });
  } catch (err) {
    if (err.name === "CancelledError") {
      copyState.status = "cancelled";
      broadcastState();
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Copy cancelled",
        message: `Cancelled after copying ${copyState.copiedFiles} item(s).`
      });
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

// ---------- Messaging with popup / content script / hosted picker page ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_COPY") {
    startCopy(message.folderUrl);
    sendResponse({ ok: true });
  } else if (message.type === "GET_STATE") {
    sendResponse({ state: copyState });
  } else if (message.type === "GET_TOKEN") {
    getAuthToken(true)
      .then(async (token) => {
        // Warm the identity cache as early as possible (right after the
        // very first sign-in via the Picker), so later flows like clicking
        // "Upgrade" already have installId cached with no extra prompt.
        // Failure here must NOT block the Picker from opening.
        await getInstallId(token).catch((err) => {
          console.warn("Could not derive account identity yet:", err.message);
        });
        return token;
      })
      .then((token) => sendResponse({ token }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  } else if (message.type === "GET_INSTALL_ID") {
    // Used by popup.js's "Upgrade" button — guarantees an identity exists
    // (authenticating interactively if this is the very first thing the
    // user does) before building the checkout URL.
    getAuthToken(true)
      .then((token) => getInstallId(token))
      .then((installId) => sendResponse({ installId }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  } else if (message.type === "GET_PORTAL_LINK") {
    // Used by popup.js's "Manage subscription" button.
    (async () => {
      try {
        const { installId } = await chrome.storage.local.get("installId");
        if (!installId) {
          throw new Error("No account identity found yet — try reopening the extension.");
        }
        const res = await fetch(`${BACKEND_URL}/api/portal-link?install_id=${encodeURIComponent(installId)}`);
        const data = await res.json();
        if (!data.url) {
          throw new Error(data.reason || "Could not open subscription management.");
        }
        sendResponse({ url: data.url });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  } else if (message.type === "SWITCH_ACCOUNT") {
    // Used by the new "Switch account" link in the popup.
    switchAccount()
      .then((installId) => sendResponse({ installId }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  } else if (message.type === "SYNC_LICENSE") {
    // v1.12.2 fix: popup.js calls this on open to refresh the plan badge.
    // Without this, licenseKey/licensePlan in chrome.storage.local only
    // ever got set on the ONE device that completed a checkout — a second
    // device signed into the same (licensed) Google account had nothing
    // locally to show, and displayed "Free" despite having a real active
    // plan. This only uses an ALREADY-cached installId (no new auth
    // prompt) — if this device has never authenticated at all yet, there's
    // nothing to sync and the badge correctly shows Free until it does.
    (async () => {
      try {
        const { installId } = await chrome.storage.local.get("installId");
        if (!installId) {
          sendResponse({ licenseKey: null });
          return;
        }
        const res = await fetch(`${BACKEND_URL}/api/get-license?install_id=${encodeURIComponent(installId)}`);
        const data = await res.json();
        if (data.license_key) {
          await chrome.storage.local.set({
            licenseKey: data.license_key,
            licensePlan: data.plan,
            licenseBillingPeriod: data.billing_period
          });
        } else {
          // No active license found for this identity — make sure any
          // stale local cache (e.g. from a superseded/cancelled license)
          // doesn't keep showing a paid badge incorrectly.
          await chrome.storage.local.remove(["licenseKey", "licensePlan", "licenseBillingPeriod"]);
        }
        sendResponse({ licenseKey: data.license_key || null, plan: data.plan, billingPeriod: data.billing_period });
      } catch (err) {
        // Best-effort — if the backend is unreachable, keep whatever was
        // already cached locally rather than erroring out the popup.
        sendResponse({ error: err.message });
      }
    })();
    return true;
  } else if (message.type === "PAUSE_COPY") {
    currentJob?.pause();
    copyState.status = "paused";
    broadcastState();
    sendResponse({ ok: true });
  } else if (message.type === "RESUME_COPY") {
    currentJob?.resume();
    copyState.status = "copying";
    broadcastState();
    sendResponse({ ok: true });
  } else if (message.type === "CANCEL_COPY") {
    currentJob?.cancel();
    sendResponse({ ok: true });
  }
  return true; // keeps the channel open for an async response
});

// Messages from the hosted Picker page AND the hosted checkout page —
// both only reachable because their origins are declared in
// "externally_connectable" in the manifest.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === "PICKER_RESULT") {
    // Two-step result: source folder to copy + destination folder to copy it into.
    startCopy(message.sourceId, message.destId);
    if (tabId) chrome.tabs.remove(tabId);
    sendResponse({ ok: true });
  } else if (message.type === "PICKER_CANCELLED") {
    if (tabId) chrome.tabs.remove(tabId);
    sendResponse({ ok: true });
  } else if (message.type === "CHECKOUT_COMPLETED") {
    refreshLicenseAfterCheckout(message.installId);
    sendResponse({ ok: true });
  }
  return true;
});

// The Paddle webhook can take a few seconds to process after checkout
// completes, so we poll get-license a handful of times with a delay
// instead of giving up after a single empty response.
async function refreshLicenseAfterCheckout(installId, attempt = 0) {
  const MAX_ATTEMPTS = 6;
  const DELAY_MS = 3000;

  try {
    const res = await fetch(`${BACKEND_URL}/api/get-license?install_id=${encodeURIComponent(installId)}`);
    const data = await res.json();

    if (data.license_key) {
      await chrome.storage.local.set({
        licenseKey: data.license_key,
        licensePlan: data.plan,
        licenseBillingPeriod: data.billing_period
      });
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Upgrade complete",
        message: `You're now on the ${data.plan} (${data.billing_period}) plan.`
      });
      return;
    }
  } catch (err) {
    console.warn("Could not refresh license:", err.message);
  }

  if (attempt < MAX_ATTEMPTS) {
    setTimeout(() => refreshLicenseAfterCheckout(installId, attempt + 1), DELAY_MS);
  }
}
