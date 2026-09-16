# Privacy Policy — Drive Folder Copier Lite

**Last updated:** September 2026 (v1 — initial policy for the Lite product)

**⚠️ Draft, not yet published.** This file is meant to mirror a canonical, published version hosted at `extensionlabs.online/drive-folder-copier/legal-pages/privacy-lite.html` (or similar), linked from the Chrome Web Store listing and the Google OAuth consent screen — but that hosted page does not exist yet. `legal-pages/` is legally load-bearing content per the repo's own rules, so it needs your explicit sign-off before anything is published there. Treat this file as a draft for review, not a live policy.

## Summary
Drive Folder Copier Lite is a browser extension that copies specific Google Drive files — the ones you explicitly select — into your own "My Drive." The extension itself does not collect, store, or transmit your Drive files, file names, or file contents to any server. A separate licensing backend, described below, receives only anonymous usage counters and a one-way identifier derived from your Google account — never your files or their metadata.

## What the extension accesses (Google Drive data)
The extension requests OAuth authorization for two scopes:

- `https://www.googleapis.com/auth/drive.file` — a narrow, Google-classified **non-sensitive** scope that only grants access to files you explicitly select through Google's own file picker (or that the extension itself creates). It does **not** grant access to your Drive at large, and it does **not** allow the extension to see or act on files or folders you haven't selected. These operations happen directly between your browser and Google's servers. We do not operate any server that receives your Drive files, file names, or file contents.
- `https://www.googleapis.com/auth/userinfo.email` — used solely so your free tier and any purchased credit balance are recognized across devices signed into the same Google account. See "What our licensing backend receives" below.

## What our licensing backend receives (account & billing data)
To operate the free tier and prepaid credit packs — including recognizing your balance if you use the extension on more than one device — the extension communicates with a licensing backend we operate (built on Vercel and Supabase). This backend receives only:

- A one-way cryptographic hash (SHA-256) derived from your Google account's stable identifier. This hash cannot be reversed to recover your email address or any other information about your account.
- The total byte size and item count of a copy operation (never file names or Drive IDs).

This backend never receives your actual Google account email in plaintext, your OAuth access token, file names, or Drive identifiers. Your email address, if read via the `userinfo.email` scope, is stored only locally in your browser and is never transmitted anywhere.

## How we protect your data
All communication between the extension, our backend, and Google's servers happens exclusively over encrypted HTTPS/TLS connections. The one-way SHA-256 hash described above means that even in the unlikely event of unauthorized access to our database, the values stored there cannot be reversed to recover your Google account email or identifier. Access to our backend's database is restricted to server-side infrastructure only, authenticated with a private service key never exposed to the extension, the browser, or any public-facing surface.

## Data retention and deletion
We retain the anonymous identifier and byte-balance counters described above for as long as your account remains active, so your purchased credits stay recognized across devices. You can request deletion of this data at any time by contacting us at the email below.

## Payment information
Credit pack purchases are processed by [Paddle.com Market Limited](https://www.paddle.com), acting as our Merchant of Record. Paddle collects and processes your payment details, billing address, and email directly — we do not receive or store your card details. See [Paddle's Privacy Policy](https://www.paddle.com/legal/privacy).

## Local storage
The extension stores a small amount of data locally in your browser (`chrome.storage.local`): the identifier described above, your Google account email (kept on-device only, never transmitted), and your copy progress. This data stays on your device.

## Data we do NOT collect
We do not collect: the contents of your files, your file or folder names, your browsing history, your location, your Google account email in a form that leaves your device, or any data unrelated to operating this extension's core function and balance enforcement.

## Your rights
You can revoke the extension's access to your Google account at any time via your [Google Account permissions](https://myaccount.google.com/permissions) page. To request deletion of your installation record from our licensing backend, contact us at the email below.

## Changes to this policy
If this policy changes, the published page will be updated with a new revision date.

## Contact
Néstor Reyes, independent developer (autónomo), Madrid, Spain.
Email: support@extensionlabs.online
