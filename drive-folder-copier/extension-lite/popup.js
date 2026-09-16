const pickerBtn = document.getElementById("pickerBtn");
const statusBox = document.getElementById("statusBox");
const statusIcon = document.getElementById("statusIcon");
const statusLabel = document.getElementById("statusLabel");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const currentItemEl = document.getElementById("currentItem");
const errorBox = document.getElementById("errorBox");
const successBox = document.getElementById("successBox");
const cancelBtn = document.getElementById("cancelBtn");
const switchAccountBtn = document.getElementById("switchAccountBtn");
const buyMoreBtn = document.getElementById("buyMoreBtn");
const buyPanel = document.getElementById("buyPanel");
const packSelect = document.getElementById("packSelect");
const goToCheckoutBtn = document.getElementById("goToCheckoutBtn");
const balanceBadge = document.getElementById("balanceBadge");

const CHECKOUT_URL = "https://extensionlabs.online/drive-folder-copier/checkout-lite/";
const HOSTED_PICKER_URL = "https://extensionlabs.online/drive-folder-copier/picker-lite/";

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
    refreshBalance();
  });
});

buyMoreBtn.addEventListener("click", () => {
  buyPanel.classList.toggle("hidden");
});

goToCheckoutBtn.addEventListener("click", () => {
  goToCheckoutBtn.disabled = true;
  errorBox.classList.add("hidden");
  chrome.runtime.sendMessage({ type: "GET_INSTALL_ID" }, (response) => {
    goToCheckoutBtn.disabled = false;
    if (!response || response.error || !response.installId) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = `Could not verify your Google account: ${response?.error || "unknown error"}`;
      return;
    }
    const pack = packSelect.value;
    const url = `${CHECKOUT_URL}#install_id=${encodeURIComponent(response.installId)}&pack=${pack}`;
    chrome.tabs.create({ url });
    window.close();
  });
});

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function refreshBalance() {
  chrome.runtime.sendMessage({ type: "GET_BALANCE" }, (response) => {
    if (!response || response.error) {
      balanceBadge.textContent = "Free";
      return;
    }
    const { free_bytes_remaining, bytes_balance } = response;
    if (bytes_balance > 0) {
      balanceBadge.textContent = `${formatBytes(bytes_balance)} credits`;
    } else if (free_bytes_remaining > 0) {
      balanceBadge.textContent = `${formatBytes(free_bytes_remaining)} free left`;
    } else {
      balanceBadge.textContent = "No credits";
    }
  });
}
refreshBalance();

const STATUS_ICON_COLORS = { authenticating: "#1a73e8", copying: "#1a73e8" };

const STATUS_LABELS = {
  idle: "",
  authenticating: "Connecting to your Google account...",
  copying: "Copying files...",
  done: "Done!",
  error: "Something went wrong",
  cancelled: "Cancelled"
};

function renderState(state) {
  errorBox.classList.add("hidden");
  successBox.classList.add("hidden");

  if (!state || state.status === "idle") {
    statusBox.classList.add("hidden");
    pickerBtn.disabled = false;
    return;
  }

  statusBox.classList.remove("hidden");
  statusLabel.textContent = STATUS_LABELS[state.status] || state.status;
  statusIcon.style.background = STATUS_ICON_COLORS[state.status] || "#9aa0a6";

  const pct = state.totalFiles > 0 ? Math.min(100, Math.round((state.copiedFiles / state.totalFiles) * 100)) : 0;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = state.totalFiles > 0 ? `${state.copiedFiles} / ${state.totalFiles} items (${pct}%)` : "";
  currentItemEl.textContent = state.currentItem ? `Copying: ${state.currentItem}` : "";

  pickerBtn.disabled = ["authenticating", "copying"].includes(state.status);

  const jobActive = ["authenticating", "copying"].includes(state.status);
  cancelBtn.parentElement.classList.toggle("hidden", !jobActive);

  if (state.status === "done") {
    statusBox.classList.add("hidden");
    successBox.classList.remove("hidden");
    successBox.textContent = `"${state.destFolderName}" was copied to your My Drive (${state.copiedFiles} items).`;
    refreshBalance();
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
  } else if (message.type === "BALANCE_MAY_HAVE_CHANGED") {
    refreshBalance();
  }
});

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
    const width = 900;
    const height = 650;
    const left = Math.round((screen.width - width) / 2);
    const top = Math.round((screen.height - height) / 2);
    chrome.windows.create({ url, type: "popup", width, height, left, top });
    window.close();
  });
});

cancelBtn.addEventListener("click", () => {
  cancelBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "CANCEL_COPY" }, () => {
    cancelBtn.disabled = false;
  });
});

loadInitialState();
