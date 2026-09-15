// picker.js — Hosted on GitHub Pages (regular web page, NOT part of the
// extension package). This is what lets us load Google's Picker library,
// since Manifest V3's CSP forbids loading remote scripts from inside the
// extension itself.
//
// Two-step flow in a single tab: first pick the SOURCE folder to copy, then
// pick the DESTINATION folder to copy it into. Only after both are chosen do
// we message the extension, via chrome.runtime.sendMessage(EXTENSION_ID, ...),
// which only works because the extension declares this page's origin in its
// "externally_connectable" manifest key.

const PICKER_API_KEY = "AIzaSyCn_elBGOfmsUqhtmGc6ZxA3kFIQM0iLKU";
const EXTENSION_ID = "adocjegeagfnjhdkjiagkabbnopmochk"; // fixed extension ID (see manifest "key")

const statusEl = document.getElementById("status");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  statusEl.style.display = "block";
}

function getTokenFromHash() {
  // The token travels in the URL fragment (#token=...), which browsers never
  // send to any server — GitHub Pages never sees it, only this page's JS does.
  const params = new URLSearchParams(location.hash.substring(1));
  return params.get("token");
}

const oauthToken = getTokenFromHash();

// Tracks progress through the two-step flow.
let step = "source"; // "source" | "destination"
let sourceDoc = null; // { id, name, mimeType }

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
  const title = step === "source"
    ? "Step 1 of 2 — Select a folder or file to copy"
    : "Step 2 of 2 — Select where to copy it";

  const builder = new google.picker.PickerBuilder()
    .setTitle(title)
    .setOAuthToken(oauthToken)
    .setDeveloperKey(PICKER_API_KEY)
    .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
    .setCallback(onPickerAction);

  if (step === "source") {
    // Three tabs, matching Drive's own left-nav sections: My Drive, Shared
    // with me, and Starred. Any file type is selectable (folders included).
    const myDriveView = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setParent("root")
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMode(google.picker.DocsViewMode.LIST);

    const sharedWithMeView = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setOwnedByMe(false) // "shared with me" = not owned by the current user
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMode(google.picker.DocsViewMode.LIST);

    const starredView = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setStarred(true)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMode(google.picker.DocsViewMode.LIST);

    builder.addView(myDriveView).addView(sharedWithMeView).addView(starredView);
  } else {
    // Destination step: your own "My Drive" only, folders only — you can't
    // copy "into" a file, and copies always land in your own storage.
    const destView = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setParent("root")
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMode(google.picker.DocsViewMode.LIST);

    builder.addView(destView);
  }

  const picker = builder.build();
  statusEl.style.display = "none";
  picker.setVisible(true);
}

function onPickerAction(data) {
  if (data.action === google.picker.Action.PICKED) {
    const doc = data.docs[0];

    if (step === "source") {
      sourceDoc = doc;
      step = "destination";
      setStatus(`Source: "${doc.name}". Now choose where to copy it…`);
      // Small delay so the previous Picker dialog fully closes before opening the next one.
      setTimeout(showPicker, 200);
    } else {
      sendResultToExtension({
        type: "PICKER_RESULT",
        sourceId: sourceDoc.id,
        sourceName: sourceDoc.name,
        destId: doc.id,
        destName: doc.name
      });
    }
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
    // Best-effort close; the extension also closes this tab on its end as a fallback.
    window.close();
  });
}
