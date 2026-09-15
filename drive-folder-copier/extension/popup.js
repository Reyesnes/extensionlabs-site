const folderUrlInput = document.getElementById("folderUrl");
const copyBtn = document.getElementById("copyBtn");
const pickerBtn = document.getElementById("pickerBtn");
const useCurrentTabBtn = document.getElementById("useCurrentTabBtn");
const statusBox = document.getElementById("statusBox");
const statusIcon = document.getElementById("statusIcon");
const statusLabel = document.getElementById("statusLabel");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const currentItemEl = document.getElementById("currentItem");
const errorBox = document.getElementById("errorBox");
const successBox = document.getElementById("successBox");
const pauseResumeBtn = document.getElementById("pauseResumeBtn");
const cancelBtn = document.getElementById("cancelBtn");
const keepPermissionsCheckbox = document.getElementById("keepPermissionsCheckbox");
const manualLinkToggle = document.getElementById("manualLinkToggle");
const manualLinkSection = document.getElementById("manualLinkSection");
const upgradeBtn = document.getElementById("upgradeBtn");
const changePlanBtn = document.getElementById("changePlanBtn");
const switchAccountBtn = document.getElementById("switchAccountBtn");
const upgradePanel = document.getElementById("upgradePanel");
const planSelect = document.getElementById("planSelect");
const billingSelect = document.getElementById("billingSelect");
const goToCheckoutBtn = document.getElementById("goToCheckoutBtn");
const planBadge = document.getElementById("planBadge");

const CHECKOUT_URL = "https://extensionlabs.online/drive-folder-copier/checkout/";

// v1.12.0: the same footer button now serves two purposes depending on
// whether the account already has an active license — "Upgrade →" opens
// the plan/billing picker panel below; "Manage subscription →" instead
// jumps straight to Paddle's hosted Customer Portal (no local panel).
let hasActiveLicense = false;

upgradeBtn.addEventListener("click", () => {
  if (hasActiveLicense) {
    openManageSubscription();
  } else {
    upgradePanel.classList.toggle("hidden");
  }
});

// Only reachable once there's already an active license — this is what
// lets someone pick a different plan/billing and go through checkout
// again. The webhook's existing supersession logic (see
// paddle-webhook.ts) automatically cancels the old subscription and
// activates the new one once that checkout completes — this button is
// simply the missing entry point to reach that flow, which the earlier
// version of this file accidentally removed once a license existed.
changePlanBtn.addEventListener("click", () => {
  upgradePanel.classList.toggle("hidden");
});

// v1.12.5: there was no way to test/use the extension as a different
// Google account without this — the cached identity stuck to whichever
// account authenticated FIRST on this browser profile, regardless of
// which account the user later signs into for Drive access. This clears
// everything cached (token, identity, license) and forces a fresh,
// interactive sign-in — Google's own account picker appears, letting the
// user pick a different account.
switchAccountBtn.addEventListener("click", () => {
  switchAccountBtn.disabled = true;
  errorBox.classList.add("hidden");
  chrome.runtime.sendMessage({ type: "SWITCH_ACCOUNT" }, (response) => {
    switchAccountBtn.disabled = false;
    if (!response || response.error) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = `Could not switch account: ${response?.error || "unknown error"}`;
      return;
    }
    syncLicenseThenRender();
  });
});

function openManageSubscription() {
  upgradeBtn.disabled = true;
  errorBox.classList.add("hidden");
  chrome.runtime.sendMessage({ type: "GET_PORTAL_LINK" }, (response) => {
    upgradeBtn.disabled = false;
    if (!response || response.error || !response.url) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = `Could not open subscription management: ${response?.error || "unknown error"}`;
      return;
    }
    chrome.tabs.create({ url: response.url });
  });
}

goToCheckoutBtn.addEventListener("click", () => {
  goToCheckoutBtn.disabled = true;
  errorBox.classList.add("hidden");
  // Ask background.js for the account identity instead of reading
  // chrome.storage.local directly — this guarantees a Google sign-in
  // happens right here if the user has never authenticated before (e.g.
  // clicking "Upgrade" as their very first action, without ever having run
  // a copy or opened the Picker).
  chrome.runtime.sendMessage({ type: "GET_INSTALL_ID" }, (response) => {
    goToCheckoutBtn.disabled = false;
    if (!response || response.error || !response.installId) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = `Could not verify your Google account: ${response?.error || "unknown error"}`;
      return;
    }
    const plan = planSelect.value;
    const billing = billingSelect.value;
    const url = `${CHECKOUT_URL}#install_id=${encodeURIComponent(response.installId)}&plan=${plan}&billing_period=${billing}`;
    chrome.tabs.create({ url });
    window.close();
  });
});

function refreshLicenseUI() {
  chrome.storage.local.get(
    ["licenseKey", "licensePlan", "licenseBillingPeriod"],
    ({ licenseKey, licensePlan, licenseBillingPeriod }) => {
      hasActiveLicense = !!licenseKey;

      if (licensePlan) {
        const label = licensePlan.charAt(0).toUpperCase() + licensePlan.slice(1);
        planBadge.textContent = `${label} · ${licenseBillingPeriod}`;
      } else {
        planBadge.textContent = "Free";
      }

      upgradeBtn.textContent = hasActiveLicense ? "Manage subscription →" : "Upgrade →";
      changePlanBtn.classList.toggle("hidden", !hasActiveLicense);
    }
  );
}

// v1.12.2: chrome.storage.local only reflects the FULL truth about this
// account's plan on the one device that actually ran the checkout. On any
// other device signed into the same (licensed) Google account, that cache
// starts out empty. Ask the backend directly — using whatever installId is
// already cached on THIS device, no new sign-in prompt — before rendering,
// so the badge and the Upgrade/Manage button are correct even on a device
// that never itself completed a purchase.
function syncLicenseThenRender() {
  chrome.runtime.sendMessage({ type: "SYNC_LICENSE" }, () => {
    // Ignore the response contents here — SYNC_LICENSE already wrote the
    // result into chrome.storage.local itself. refreshLicenseUI() re-reads
    // storage as the single source of truth, so both the very first paint
    // and this refresh follow the exact same code path.
    refreshLicenseUI();
  });
}
refreshLicenseUI(); // instant paint from whatever's cached, avoids a blank flash
syncLicenseThenRender(); // then reconcile against the backend

manualLinkToggle.addEventListener("click", () => {
  const isHidden = manualLinkSection.classList.contains("hidden");
  manualLinkSection.classList.toggle("hidden");
  manualLinkToggle.textContent = isHidden ? "Paste a link instead ▴" : "Paste a link instead ▾";
});

const STATUS_ICON_COLORS = {
  authenticating: "#1a73e8",
  scanning: "#1a73e8",
  copying: "#1a73e8",
  paused: "#f9ab00"
};

chrome.storage.local.get("keepPermissions", ({ keepPermissions }) => {
  keepPermissionsCheckbox.checked = !!keepPermissions;
});

keepPermissionsCheckbox.addEventListener("change", () => {
  chrome.storage.local.set({ keepPermissions: keepPermissionsCheckbox.checked });
});

const STATUS_LABELS = {
  idle: "",
  authenticating: "Connecting to your Google account...",
  scanning: "Scanning the folder (counting files)...",
  copying: "Copying files...",
  paused: "Paused",
  done: "Done!",
  error: "Something went wrong",
  cancelled: "Cancelled"
};

function renderState(state) {
  errorBox.classList.add("hidden");
  successBox.classList.add("hidden");

  if (!state || state.status === "idle") {
    statusBox.classList.add("hidden");
    copyBtn.disabled = false;
    return;
  }

  statusBox.classList.remove("hidden");
  statusLabel.textContent = STATUS_LABELS[state.status] || state.status;
  statusIcon.style.background = STATUS_ICON_COLORS[state.status] || "#9aa0a6";
  statusIcon.style.animationPlayState = state.status === "paused" ? "paused" : "running";

  const pct = state.totalFiles > 0
    ? Math.min(100, Math.round((state.copiedFiles / state.totalFiles) * 100))
    : 0;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = state.totalFiles > 0
    ? `${state.copiedFiles} / ${state.totalFiles} items (${pct}%)`
    : "";
  currentItemEl.textContent = state.currentItem ? `Copying: ${state.currentItem}` : "";

  copyBtn.disabled = ["authenticating", "scanning", "copying", "paused"].includes(state.status);

  // Job controls (pause/resume/cancel) only make sense while something is
  // actively running or paused — hide them once the job reaches an end state.
  const jobActive = ["authenticating", "scanning", "copying", "paused"].includes(state.status);
  pauseResumeBtn.parentElement.classList.toggle("hidden", !jobActive);

  if (state.status === "paused") {
    pauseResumeBtn.textContent = "▶ Resume";
  } else {
    pauseResumeBtn.textContent = "⏸ Pause";
  }
  // Pausing only makes sense once we're actually copying (not while still
  // authenticating/scanning, to avoid confusing "pause" before there's a
  // per-item progress to pause).
  pauseResumeBtn.disabled = !["copying", "paused"].includes(state.status);

  if (state.status === "done") {
    statusBox.classList.add("hidden");
    successBox.classList.remove("hidden");
    successBox.textContent = `"${state.destFolderName}" was copied to your My Drive (${state.copiedFiles} items).`;
    // A copy just completed, which means the extension is now definitely
    // authenticated — good moment to pick up any license change quietly.
    syncLicenseThenRender();
  }

  if (state.status === "error") {
    statusBox.classList.add("hidden");
    errorBox.classList.remove("hidden");
    errorBox.textContent = state.errorMessage || "Unknown error.";
  }

  if (state.status === "cancelled") {
    statusBox.classList.add("hidden");
    errorBox.classList.remove("hidden");
    errorBox.textContent = `Cancelled after copying ${state.copiedFiles} item(s).`;
  }
}

function loadInitialState() {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (response && response.state) renderState(response.state);
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE_UPDATE") {
    renderState(message.state);
  }
});

const HOSTED_PICKER_URL = "https://reyesnes.github.io/drive-folder-copier-picker/";

pickerBtn.addEventListener("click", () => {
  pickerBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (response) => {
    pickerBtn.disabled = false;
    if (!response || response.error) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = `Could not authenticate: ${response?.error || "unknown error"}`;
      return;
    }
    const url = `${HOSTED_PICKER_URL}#token=${encodeURIComponent(response.token)}`;
    // v1.12.7: open as a small chrome-less popup window instead of a full
    // browser tab — feels like a floating dialog rather than navigating
    // away. Centered on the current screen.
    const width = 900;
    const height = 650;
    const left = Math.round((screen.width - width) / 2);
    const top = Math.round((screen.height - height) / 2);
    chrome.windows.create({ url, type: "popup", width, height, left, top });
    window.close();
  });
});

copyBtn.addEventListener("click", () => {
  const url = folderUrlInput.value.trim();
  if (!url) {
    errorBox.classList.remove("hidden");
    errorBox.textContent = "Paste the folder link first.";
    return;
  }
  copyBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "START_COPY", folderUrl: url });
});

useCurrentTabBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes("drive.google.com")) {
      folderUrlInput.value = tab.url;
    } else {
      errorBox.classList.remove("hidden");
      errorBox.textContent = "The active tab is not a Google Drive folder.";
    }
  });
});

pauseResumeBtn.addEventListener("click", () => {
  const isPaused = pauseResumeBtn.textContent.includes("Resume");
  pauseResumeBtn.disabled = true;
  chrome.runtime.sendMessage({ type: isPaused ? "RESUME_COPY" : "PAUSE_COPY" }, () => {
    pauseResumeBtn.disabled = false;
  });
});

cancelBtn.addEventListener("click", () => {
  cancelBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "CANCEL_COPY" }, () => {
    cancelBtn.disabled = false;
  });
});

loadInitialState();
