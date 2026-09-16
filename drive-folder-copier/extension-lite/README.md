# Drive Folder Copier Lite — Chrome Extension

Copy specific Google Drive files — the ones you explicitly select, as many at once as you like — into your own "My Drive." No verification wait, no restricted permissions.

**Current version:** v0.1.0 · **Status:** In development, not yet published.

## Why this exists
The main "Drive Folder Copier" product (`drive-folder-copier/extension/`) needs Google's restricted `drive` OAuth scope to recursively copy an entire folder tree the user hasn't browsed — and that requires an annual paid ADA-CASA security assessment before Google will approve it. This Lite product is a **genuinely different, more limited tool**: it uses only the non-sensitive `drive.file` scope, which means **no OAuth verification and no CASA assessment at all** — at the cost of not supporting automatic recursion into unselected subfolders. Users select every file they want copied, explicitly, via Google's own multiselect Picker.

Don't add folder recursion or the `drive`/`drive.readonly` scopes to this extension. If that's ever needed, that's the Pro extension, not this one — see `drive-folder-copier/CLAUDE.md` and `.claude/rules/extension-lite-code.md`.

## 🚨 Required first step: create OAuth credentials
This extension's ID is already fixed by the `"key"` field in `manifest.json` — **`lbebgmgpdafocohkmhpjifkadnagliip`** — so, unlike a fresh extension, there's no chicken-and-egg problem: the redirect URI is known before you ever load it.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and select the **same project** used by the Pro extension (`scientific-elf-504912-c7`) — no need for a new project, since `drive.file` is non-sensitive and doesn't affect that project's restricted-scope verification status.
2. Confirm the **Google Drive API** and **Google Picker API** are enabled (they already are, for the Pro extension).
3. Go to **"APIs & Services" → "Credentials" → "Create credentials" → "OAuth client ID"**:
   - Application type: **Web application**.
   - Under "Authorized redirect URIs," add: `https://lbebgmgpdafocohkmhpjifkadnagliip.chromiumapp.org/`
4. Copy the generated **Client ID** and paste it into `GOOGLE_OAUTH_CLIENT_ID` in `background.js` (currently a `REPLACE_ME` placeholder).
5. Go to **"Google Auth Platform" → "Data Access"** and declare `.../auth/drive.file` and `.../auth/userinfo.email` for documentation purposes.
6. Load the extension (see "Installation" below) and reload after setting the Client ID.

## 📦 Installation (developer mode)
1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked**, select this `extension-lite` folder.
3. The extension ID should be exactly `lbebgmgpdafocohkmhpjifkadnagliip` (confirms the `"key"` field loaded correctly).

## 🚀 Usage
Click the extension icon → **"Select files to copy"** → pick as many files as you want in Google's multiselect Picker → they're copied into a new dated folder (or directly, for a single file) in your My Drive.

## ⚙️ How it works under the hood
- `background.js`: OAuth (drive.file + userinfo.email only), identity derivation (same SHA-256 scheme as the Pro extension, but written to entirely separate backend tables), direct `files.copy` calls for each explicitly-selected file — no recursion, no folder listing.
- `picker-lite/` (hosted, separate repo path from the Pro picker): single-step multiselect Picker, files only.
- `checkout-lite/` (hosted): one-time Paddle checkout for prepaid credit packs.

## 💳 Licensing & monetization
- **Free tier:** 1 GiB, cumulative across all operations (not per-operation, not a count of operations).
- **Beyond that:** prepaid credit packs (10 GB / 50 GB / 200 GB), one-time purchase via Paddle — no subscription.
- **Backend:** same Vercel + Supabase project as Pro, but entirely separate tables (`lite_installs`, `lite_credit_purchases`, `lite_operations_log` — see `supabase_schema_lite.sql` in the backend repo). Never receives file names, folder names, Drive IDs, or file contents — only the hashed identity and byte/item counts.

## ⚠️ Current limitations (by design, not oversight)
- **Files only, no folders.** Selecting a folder isn't offered in the Picker — under `drive.file`, that would only grant access to the folder object itself, never its contents, which would silently produce broken copies.
- **No recursion.** Every copy is exactly what you selected — nothing more.
- **Fixed destination.** Copies land in a new dated folder (or, for a single file, directly) in your My Drive root — there's no destination-folder picker step yet.
- Native Google files (Docs, Sheets, Slides) are copied like any other file via `files.copy`.
