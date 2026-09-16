---
paths:
  - "drive-folder-copier/extension/**"
---

# Extension source (Manifest V3)

## The rule everything else is subordinate to
**No Google Drive data may ever reach a server we control** — not file names, folder names, file contents, Drive IDs, or folder structure. The copy engine runs entirely client-side in `background.js`.

This is what the CASA-exemption argument to Google's OAuth verification rests on. A change that violates it gets rejected, not redesigned around. Only these may be sent to the licensing backend: `install_id` (a one-way SHA-256 hash), `license_key`, `total_bytes`, `item_count`.

Use the `casa-guardian` subagent before committing changes that touch Drive API calls or backend requests.

## Identity
`install_id` = SHA-256 of the signed-in Google account's stable ID, formatted UUID-shaped (not a real RFC 4122 UUID — it just fits the existing Postgres `uuid` column).

Re-verify it against the currently authenticated account on every use. Never return a cached value blindly: a second Google account signing in on the same browser profile would inherit the first account's license. Real bug, fixed in v1.12.5.

## OAuth
`launchWebAuthFlow` has no built-in token cache — `background.js` implements its own, with the real expiry, and tries silent re-auth (`prompt=none`) before interactive. Never reintroduce `prompt=consent` forced on every call: it caused a full consent screen on every single operation. Removed deliberately in v1.12.4.

## Out of scope by decision
Multi-item copy (batch / Picker multiselect) is explicitly NOT supported. One file or folder per operation. Don't add it without a new, explicit instruction.

## Packaging
Use the `/package-extension` skill. Every release needs two zips: dev (with manifest `"key"`) and `-store` (without it).
