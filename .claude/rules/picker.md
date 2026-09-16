---
paths:
  - "drive-folder-copier/picker/**"
---

# Hosted Picker page

Exists only because Manifest V3's CSP forbids loading remote scripts (`apis.google.com/js/api.js`) inside the extension. The extension opens this page in a popup window and passes an OAuth token via the URL fragment.

## Don't break these
- **Token travels in the URL fragment** (`#token=...`), never a query parameter. Browsers don't send fragments to servers, so GitHub Pages never sees it. Changing this would leak tokens into server logs.
- **`chrome.runtime.sendMessage(EXTENSION_ID, ...)`** only works because the extension's manifest lists this page's origin in `externally_connectable`. If the hosting URL changes, update the manifest too or messages silently fail.
- **Two-step flow** (source folder → destination folder) in a single page load. Intentional — don't collapse to one step.

## After migrating from the old standalone repo
The Picker moved from `reyesnes.github.io/drive-folder-copier-picker/` to `extensionlabs.online/<product>/picker/`. Two things must match the new URL:
1. `HOSTED_PICKER_URL` in the extension's `popup.js`.
2. The Google Picker API key's HTTP-referrer restriction in Google Cloud Console — if it's still locked to `reyesnes.github.io/*`, the Picker fails silently.
