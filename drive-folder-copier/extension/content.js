// content.js — Injects a floating button on drive.google.com to copy
// the folder currently being viewed, without needing to open the popup.
// Note: Drive's UI is an SPA with obfuscated class names, so we use our
// own floating button instead of trying to inject into its toolbar
// (far more fragile and prone to breaking with every Google update).

(function () {
  function isFolderView() {
    return /\/drive\/folders\//.test(location.href);
  }

  function createFab() {
    if (document.getElementById("dfc-fab")) return;

    const fab = document.createElement("button");
    fab.id = "dfc-fab";
    fab.title = "Copy this folder to My Drive";
    fab.innerText = "⬇ Copy folder";
    document.body.appendChild(fab);

    fab.addEventListener("click", () => {
      fab.disabled = true;
      fab.innerText = "Copying...";
      chrome.runtime.sendMessage({ type: "START_COPY", folderUrl: location.href });
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type !== "STATE_UPDATE") return;
      const state = message.state;
      if (state.status === "copying" || state.status === "scanning" || state.status === "authenticating") {
        fab.disabled = true;
        fab.innerText = state.totalFiles > 0
          ? `Copying ${state.copiedFiles}/${state.totalFiles}`
          : "Preparing...";
      } else if (state.status === "done") {
        fab.disabled = false;
        fab.innerText = "✓ Copied";
        setTimeout(() => { fab.innerText = "⬇ Copy folder"; }, 4000);
      } else if (state.status === "error") {
        fab.disabled = false;
        fab.innerText = "⚠ Error, retry";
      }
    });
  }

  function removeFab() {
    const fab = document.getElementById("dfc-fab");
    if (fab) fab.remove();
  }

  function sync() {
    if (isFolderView()) createFab();
    else removeFab();
  }

  // Drive es una SPA — detectamos cambios de URL sin recarga de página.
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      sync();
    }
  }).observe(document.body, { childList: true, subtree: true });

  sync();
})();
