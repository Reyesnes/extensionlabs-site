# Privacy Policy — Drive Folder Copier

**Last updated:** September 2026 (v2 — added explicit data protection and retention/deletion disclosures, per Google's OAuth verification feedback)

This file mirrors the canonical, published version of this policy at
[extensionlabs.online/drive-folder-copier/legal-pages/privacy.html](https://extensionlabs.online/drive-folder-copier/legal-pages/privacy.html).
That page is the one linked from the Chrome Web Store listing and the
Google OAuth consent screen — if the two ever drift apart, treat the
live page as authoritative and update this file to match.

## Summary
Drive Folder Copier is a browser extension that copies Google Drive folders and files into your own "My Drive." The extension itself does not collect, store, or transmit your Drive files, folder names, or file contents to any server. A separate licensing backend, described below, receives only anonymous usage counters and a one-way identifier derived from your Google account — never your files or their metadata.

## What the extension accesses (Google Drive data)
The extension requests OAuth authorization for two scopes:

- `https://www.googleapis.com/auth/drive` — used exclusively to read, create, and copy files and folders on your behalf, with your explicit consent through Google's own authorization screen. These operations happen directly between your browser and Google's servers. We do not operate any server that receives your Drive files, file names, folder structures, or file contents.
- `https://www.googleapis.com/auth/userinfo.email` — used solely to recognize your paid subscription across multiple devices. See "What our licensing backend receives" below for exactly how this works.

## What our licensing backend receives (account & billing data)
To operate the free tier and paid subscriptions — including recognizing an existing paid plan if you use the extension on more than one device — the extension communicates with a licensing backend we operate (built on Vercel and Supabase). This backend receives only:

- A one-way cryptographic hash (SHA-256) derived from your Google account's stable identifier. This hash cannot be reversed to recover your email address or any other information about your account — it functions purely as an anonymous, consistent reference so that the same Google account is recognized as the same customer across different devices or browser installs.
- A license key, if you have an active subscription.
- The total byte size and item count of a copy operation (never file names, folder names, or Drive IDs).

This backend never receives your actual Google account email in plaintext, your OAuth access token, file names, folder names, or Drive identifiers. Your email address, if read via the `userinfo.email` scope, is stored only locally in your browser (see "Local storage" below) and is never transmitted anywhere.

## How we protect your data
We use industry-standard security measures to protect the confidentiality and integrity of the data our licensing backend processes. All communication between the extension, our backend, and Google's servers happens exclusively over encrypted HTTPS/TLS connections — nothing is ever transmitted in plaintext over the network. The one-way SHA-256 hash described above adds a further layer of protection: even in the unlikely event of unauthorized access to our database, the values stored there cannot be reversed to recover your Google account email or identifier. Access to our backend's database is restricted to server-side infrastructure only, authenticated with a private service key that is never exposed to the extension, the browser, or any public-facing surface.

## Data retention and deletion
We retain the anonymous identifier, license information, and copy-operation counters described above for as long as your account remains active, so that your license stays recognized across devices. If you stop using the extension, this data simply stops being accessed — it is not actively deleted on a schedule, but you can request its deletion at any time by contacting us at the email below, and we will remove it within a reasonable timeframe.

## Payment information
Subscriptions and one-time purchases are processed by [Paddle.com Market Limited](https://www.paddle.com), acting as our Merchant of Record. Paddle collects and processes your payment details, billing address, and email directly — we do not receive or store your card details. See [Paddle's Privacy Policy](https://www.paddle.com/legal/privacy) for details on how they handle your data.

## Local storage
The extension stores a small amount of data locally in your browser (`chrome.storage.local`): the identifier described above, your Google account email (kept on-device only, for potential future account-recovery support — never transmitted), your license key if you have one, your copy progress, and your preferences (such as whether to keep sharing permissions on copies). This data stays on your device.

## Data we do NOT collect
We do not collect: the contents of your files, your file or folder names, your browsing history, your location, your Google account email in a form that leaves your device, or any data unrelated to operating this extension's core function and license enforcement.

## Your rights
You can revoke the extension's access to your Google account at any time via your [Google Account permissions](https://myaccount.google.com/permissions) page. To request deletion of your installation record from our licensing backend, contact us at the email below.

## Changes to this policy
If this policy changes, this page will be updated with a new revision date.

## Contact
Néstor Reyes, independent developer (autónomo), Madrid, Spain.
Email: support@extensionlabs.online
