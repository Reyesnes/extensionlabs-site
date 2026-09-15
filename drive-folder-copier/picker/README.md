# Drive Folder Copier — Hosted Picker

## What this is
A tiny static page (`index.html` + `picker.js`), hosted on GitHub Pages, that exists ONLY because Manifest V3's CSP forbids loading remote scripts (`apis.google.com/js/api.js`, the Google Picker library) from inside the extension itself. The extension opens this page in a popup window, passes it an OAuth token via the URL fragment, and the page shows Google's Picker UI on the extension's behalf.

This page has no business logic of its own — it's a thin bridge between the extension and Google's Picker widget.

## Two-step flow (source → destination)
`picker.js` runs the SAME Picker twice in one page load:
1. **Step "source"**: three views (My Drive, Shared with me, Starred), any file/folder selectable.
2. **Step "destination"**: one view, folders only, scoped to the user's own My Drive (`root`).

Only after both steps complete does it message the extension back. Don't collapse this into a single-step flow without an explicit instruction — the two-step design is intentional (source and destination are conceptually different: one is "what to copy," the other is "where it lands, always in the user's own storage").

## How it talks to the extension
`chrome.runtime.sendMessage(EXTENSION_ID, message, ...)` — this ONLY works because the extension's `manifest.json` lists this page's origin in `externally_connectable`. If the hosting URL ever changes (see below), the extension's manifest must be updated to match, or messages silently fail to deliver.

Message types sent: `PICKER_RESULT` (with `sourceId`, `destId`), `PICKER_CANCELLED`.

## The token never touches a server
`getTokenFromHash()` reads the OAuth token from the URL fragment (`#token=...`). Browsers never send URL fragments to any server — GitHub Pages never sees it, only this page's own JS does. Don't change this to a query parameter (`?token=...`) or any other mechanism that would put the token somewhere a server request could log it.

## Current hosting
`https://reyesnes.github.io/drive-folder-copier-picker/` — referenced as `HOSTED_PICKER_URL` in the extension's `popup.js`. If this repo is ever merged into `extensionlabs-site` (only on explicit instruction — see that repo's CLAUDE.md), both `HOSTED_PICKER_URL` in the extension AND the Google Picker API key's HTTP referrer restrictions in Google Cloud Console need updating together, or the Picker breaks silently.

## Repo visibility
Must stay **public** — GitHub Pages on GitHub's free plan only serves public repositories.
