# Drive Folder Copier Lite — Hosted Picker

## What this is
Same purpose as `drive-folder-copier/picker/` (a thin static bridge page, hosted on GitHub Pages, that loads Google's Picker library because the extension's own CSP forbids remote scripts) — but for the **Lite** product, which is a genuinely different tool, not a copy-paste of the Pro one.

## Why this is a SEPARATE page, not a shared one
Lite and Pro use different OAuth scopes (`drive.file` vs. the restricted `drive`) and different Picker configurations. Keeping them as two separate pages means there is no code path where Lite could accidentally end up requesting folder-selection or recursive behavior that its scope can't actually support. Don't merge these into one parameterized page.

## Single step, files only
Unlike the Pro picker's two-step (source → destination) flow, this is **one step**: multiselect any number of individual **files**. No folder selection is offered — under `drive.file`, selecting a folder only grants access to the folder object itself, never its contents, so offering folder selection here would silently produce broken/empty copies. The destination is always a fixed location in the user's own My Drive, decided by the extension itself (see `extension-lite/background.js`).

## How it talks to the extension
`chrome.runtime.sendMessage(EXTENSION_ID, message, ...)` — only works because the extension's `manifest.json` lists this page's origin in `externally_connectable`. `EXTENSION_ID` here is fixed by the `"key"` field in `extension-lite/manifest.json` (`lbebgmgpdafocohkmhpjifkadnagliip`) — if that key ever changes, this file's `EXTENSION_ID` constant must change with it.

Message types sent: `PICKER_RESULT_MULTI` (with `docs: [{id, name, mimeType, sizeBytes}, ...]`), `PICKER_CANCELLED`.

## The token never touches a server
Same rule as the Pro picker: the OAuth token travels in the URL fragment (`#token=...`), never a query parameter — browsers don't send fragments to servers.

## Repo visibility
Must stay **public** — GitHub Pages on GitHub's free plan only serves public repositories.
