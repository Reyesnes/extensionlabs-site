# Drive Folder Copier — Chrome Extension

Copy Google Drive folders shared with you directly into your own "My Drive," including all subfolders, with no size restrictions like the native web UI often runs into with shared folders.

**Current version:** v1.12.6 · **Status:** Testing (Google OAuth verification submitted, under review) · See `08-estado-proyecto.md` in the project's knowledge base for the full, always-current status of every phase.

## 🚨 Required first step: create OAuth credentials

This version works in **both Chrome and Edge** because it uses `chrome.identity.launchWebAuthFlow` instead of `getAuthToken` (the latter is not supported in Edge). This changes how you set up credentials in Google Cloud Console — the client type is **"Web application,"** not "Chrome Extension."

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and select your project (or create one).
2. Go to **"APIs & Services" → "Library"**, search for **"Google Drive API"** and **"Google Picker API"**, and enable both (skip if already enabled).
3. Go to **"Google Auth Platform" → "Audience"** and make sure the consent screen is configured (External, app name, support email, your email as a test user).
4. Go to **"Google Auth Platform" → "Data Access"** and declare both scopes the extension requests: `.../auth/drive` and `.../auth/userinfo.email`. This is documentation only — it doesn't trigger any review by itself, but it's required before requesting OAuth verification.
5. Load the extension in `chrome://extensions` (or `edge://extensions`) first — see "Installation" below — so you can get its ID and build the redirect URI.
6. Go to **"APIs & Services" → "Credentials" → "Create credentials" → "OAuth client ID"**:
   - Application type: **Web application**.
   - Under "Authorized redirect URIs," add: `https://<EXTENSION_ID>.chromiumapp.org/` (replace `<EXTENSION_ID>` with the actual ID from `chrome://extensions`, keep the trailing slash). Add one per environment (Chrome dev, Edge dev, the Chrome Web Store published ID) as separate URIs on the same client.
7. Copy the generated **Client ID** (ends in `.apps.googleusercontent.com`). Ignore the "Client secret" — it isn't used in this flow.
8. Open `background.js` and confirm `GOOGLE_OAUTH_CLIENT_ID` matches your Client ID.
9. Reload the extension (reload button ⟳ in `chrome://extensions` / `edge://extensions`).

## 📦 Installation (developer mode)

**Chrome:**
1. Open Chrome and go to `chrome://extensions`.
2. Enable **"Developer mode"** (toggle in the top right).
3. Click **"Load unpacked"**.
4. Select the `drive-folder-copier` folder (the one containing `manifest.json`, with `icons/` inside it).
5. The extension will appear in your toolbar. Pin the icon for quick access.

**Edge:** same steps at `edge://extensions`.

⚠️ **Two different `manifest.json` variants exist — don't mix them up:**
- The **local development** manifest includes a `"key"` field, which pins the extension to a fixed ID (`adocjegeagfnjhdkjiagkabbnopmochk`) across reinstalls and across both laptops used for development — this is what the redirect URIs above are registered against.
- The **Chrome Web Store upload** package must have that `"key"` field **removed** before zipping — the Store rejects any upload containing a `key` that doesn't match its own internally-assigned ID for this listing (`fnifkmdjhkdjllojbnhlmgcngjndlbhm`). Never upload the local-dev manifest as-is.

## 🚀 Usage

**Option 1 — Floating button:** Open the shared folder on `drive.google.com`; you'll see a blue "⬇ Copy folder" button floating in the bottom right. Click it and you're done.

**Option 2 — Popup, via the Picker:** Click the extension icon → "Select folder or file" → pick a source folder, then a destination folder in your own My Drive, both using Google's own Picker UI.

**Option 3 — Popup, manual link:** Click "Paste a link instead," paste a Drive folder URL, then "Copy to My Drive."

The first time, Google will ask you to authorize access to your account (standard OAuth screen, now requesting both the Drive and email scopes). Since the app is still in Testing / awaiting verification, you'll see an "unverified app" warning — this is expected until Google completes the OAuth verification review; click "Advanced" → "Go to Drive Folder Copier (unsafe)."

**Managing your plan (footer of the popup):**
- **Upgrade →** — opens the plan/billing selector, for accounts with no active license yet.
- **Manage subscription →** — once you have a plan, opens Paddle's Customer Portal (update payment method, cancel).
- **Change plan** — reopens the plan/billing selector even with an active license, to switch plans (the old one is cancelled automatically once the new purchase completes).
- **Switch account** — clears the cached identity and forces Google's account picker again, for signing in with a different Google account on the same device.

## ⚙️ How it works under the hood

- `background.js`: Service worker that does all the heavy lifting — authentication (`chrome.identity`), identity derivation (SHA-256 hash of the signed-in Google account, used as the license lookup key — see "Licensing" below), recursive listing of the source folder (`files.list`), subfolder creation (`files.create`), file copying (`files.copy`), OAuth token caching, and communication with the licensing backend.
- `content.js`: Injects the floating button whenever it detects you're viewing a folder on `drive.google.com`.
- `popup.html/js/css`: Main interface — Picker entry point, progress bar, plan badge, and subscription controls.

Native Google files (Docs, Sheets, Slides) are copied just like any other file via `files.copy` — Drive duplicates them correctly, preserving their format.

## 💳 Licensing & monetization (built and live — not a future phase)

Unlike earlier drafts of this README suggested, this is fully built and processing real payments:

- **Identity:** the extension derives a stable identifier from the signed-in Google account (SHA-256 hash of the account's stable ID, formatted as a UUID) — not a random per-install value. This is what makes a purchased plan portable across every device signed into the same Google account, and what prevents resetting the free quota by reinstalling.
- **Free tier:** 2 free copy operations per identity, enforced server-side.
- **Paid plans:** Essential / Advanced / Business, each Monthly / Annual / Perpetual, sold via [Paddle](https://paddle.com) (Merchant of Record).
- **Backend:** Vercel Edge Functions + Supabase, used *only* for quota/license enforcement. It never receives file names, folder names, Drive IDs, or file contents — only the hashed identity, a license key, and byte/item counts per operation. See `02-arquitectura-tecnica.md` in the project's knowledge base for the full data-flow diagram and rationale (this architecture is what the app's CASA-exemption strategy depends on — don't add any server-side Drive data handling without reading that document first).
- **Plan changes:** handled by re-running the extension's own checkout, not through Paddle's Customer Portal (which has no self-service plan-change feature) — the webhook automatically cancels the previous subscription and activates the new one.

## ⚠️ Current limitations

- **One item per operation.** The extension copies a single file or folder per operation — there's no multi-select/batch mode. This was evaluated and explicitly decided against; see the decision log in the project's knowledge base before reopening it.
- Does not copy comments or version history of files (the Drive API doesn't support that via `copy`).
- If an individual file fails to copy (e.g., due to restricted permissions from the original owner), it's skipped and the process continues — the popup shows a plain-language reason for common failures (e.g., the owner has disabled copying for viewers), and full detail is in the console (`chrome://extensions` → "Inspect views: service worker").
- Very large folders (thousands of files) can take several minutes due to Drive API rate limits.
- If a folder/file owner has disabled "Viewers and commenters can download, copy, and print" in their sharing settings, the extension cannot copy it — this is a hard Google Drive restriction enforced identically for the native UI and for any third-party app; there is no workaround.
