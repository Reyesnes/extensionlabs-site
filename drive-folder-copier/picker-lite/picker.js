// picker.js — Hosted on GitHub Pages (regular web page, NOT part of the
// extension package). Loads Google's Picker library, since Manifest V3's
// CSP forbids loading remote scripts inside the extension itself.
//
// Unlike the Pro product's picker (two-step: source folder -> destination
// folder), this is a SINGLE step: multiselect any number of individual
// FILES. No folder selection is offered here — under the drive.file scope
// this extension uses, selecting a folder only grants access to the folder
// object itself, never to its contents, so letting someone "select" a
// folder here would silently produce an empty/broken copy. Keeping folders
// out of the picker entirely is the honest choice, not a missing feature.

const PICKER_API_KEY = "AIzaSyCn_elBGOfmsUqhtmGc6ZxA3kFIQM0iLKU";
const EXTENSION_ID = "lbebgmgpdafocohkmhpjifkadnagliip"; // fixed extension ID (see extension-lite/manifest.json "key")

const statusEl = document.getElementById("status");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  statusEl.style.display = "block";
}

function getParamsFromHash() {
  // Token (and an optional pre-navigation file ID) travel in the URL
  // fragment, which browsers never send to any server — GitHub Pages never
  // sees it, only this page's JS does.
  const params = new URLSearchParams(location.hash.substring(1));
  return {
    token: params.get("token"),
    // Optional: a Drive file ID to pre-navigate the Picker to, using the
    // Picker API's setFileIds() (rolled out January 2025) — lets someone
    // who pasted a Drive file link land straight on that file instead of
    // browsing for it. Not wired up from the popup yet; picker.js supports
    // it so a future "paste a link" entry point can pass it through.
    fileIds: params.get("fileIds")
  };
}

const { token: oauthToken, fileIds } = getParamsFromHash();

if (!oauthToken) {
  setStatus("Missing authentication token. Close this tab and try again from the extension.", true);
} else {
  loadGooglePickerLibrary();
}

function loadGooglePickerLibrary() {
  const script = document.createElement("script");
  script.src = "https://apis.google.com/js/api.js?onload=onGapiLoad";
  script.onerror = () => setStatus("Could not load Google's Picker library. Check your connection and try again.", true);
  document.head.appendChild(script);
}

window.onGapiLoad = function () {
  gapi.load("picker", { callback: () => showPicker() });
};

function showPicker() {
  const builder = new google.picker.PickerBuilder()
    .setTitle("Select the files you want to copy (multiple allowed)")
    .setOAuthToken(oauthToken)
    .setDeveloperKey(PICKER_API_KEY)
    .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
    .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
    .setCallback(onPickerAction);

  // Files only — no setIncludeFolders/setSelectFolderEnabled. Matches the
  // three tabs Drive's own left nav shows: My Drive, Shared with me, Starred.
  const myDriveView = new google.picker.DocsView(google.picker.ViewId.DOCS)
    .setParent("root")
    .setMode(google.picker.DocsViewMode.LIST);

  const sharedWithMeView = new google.picker.DocsView(google.picker.ViewId.DOCS)
    .setOwnedByMe(false)
    .setMode(google.picker.DocsViewMode.LIST);

  const starredView = new google.picker.DocsView(google.picker.ViewId.DOCS)
    .setStarred(true)
    .setMode(google.picker.DocsViewMode.LIST);

  builder.addView(myDriveView).addView(sharedWithMeView).addView(starredView);

  if (fileIds) {
    // Pre-navigate to specific file IDs (e.g. from a pasted Drive link) —
    // see the setFileIds() note above.
    myDriveView.setFileIds(fileIds);
  }

  const picker = builder.build();
  statusEl.style.display = "none";
  picker.setVisible(true);
}

function onPickerAction(data) {
  if (data.action === google.picker.Action.PICKED) {
    const docs = (data.docs || []).map((doc) => ({
      id: doc.id,
      name: doc.name,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes || 0
    }));
    sendResultToExtension({ type: "PICKER_RESULT_MULTI", docs });
  } else if (data.action === google.picker.Action.CANCEL) {
    sendResultToExtension({ type: "PICKER_CANCELLED" });
  }
}

function sendResultToExtension(message) {
  if (!(window.chrome && chrome.runtime && chrome.runtime.sendMessage)) {
    setStatus("Could not communicate with the extension. Close this tab and try again.", true);
    return;
  }
  chrome.runtime.sendMessage(EXTENSION_ID, message, () => {
    window.close();
  });
}
