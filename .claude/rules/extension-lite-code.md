---
paths:
  - "drive-folder-copier/extension-lite/**"
---

# Extension Lite source (Manifest V3)

## The rule everything else is subordinate to
This product exists specifically to **avoid** Google's restricted-scope OAuth verification and the annual CASA security assessment. That only holds as long as:

- OAuth scopes stay exactly `https://www.googleapis.com/auth/drive.file` and `https://www.googleapis.com/auth/userinfo.email` — **never** `drive`, `drive.readonly`, `drive.metadata`, `drive.metadata.readonly`, or any other scope on Google's restricted list.
- No folder recursion, and no folder selection in the Picker. Under `drive.file`, selecting a folder only grants access to the folder object itself, never its children — offering folder selection here would silently produce broken/empty copies, not just "a smaller feature." Every copy is exactly the set of files the user explicitly selected.

If full recursive folder copying is ever needed, that belongs in `drive-folder-copier/extension/` (the Pro product, which accepts the restricted-scope/CASA tradeoff deliberately) — not here. Don't try to work around this limitation with cleverness (e.g. deriving child file IDs from a `drive.metadata.readonly` call and copying those under a `drive.file` token) — `drive.metadata.readonly` is itself a restricted scope, and `files.copy` rejects files the token was never granted per-file access to regardless of how their ID was discovered. See the research trail in this project's conversation history if it needs re-litigating.

This same "no Drive data reaches a server we control" rule from the Pro product's `.claude/rules/extension-code.md` applies here too — the `casa-guardian` subagent is not scoped only to `drive-folder-copier/extension/`; use it before committing changes here that touch Drive API calls or backend requests.

## Identity
Same derivation as Pro (SHA-256 hash of the Google account's stable ID, UUID-shaped) — intentionally produces the same `install_id` as the Pro extension for someone using both, but that's harmless: the backend keeps Lite's tables (`lite_installs`, `lite_credit_purchases`, `lite_operations_log`) completely separate from Pro's (`installs`, `licenses`, `operations_log`).

## Billing model — different from Pro, on purpose
No subscriptions. 1 GiB free, cumulative (not per-operation). Beyond that, a prepaid `bytes_balance` topped up by one-time credit-pack purchases via Paddle. Don't port over Pro's per-operation-ceiling or annual-quota concepts here — they don't fit occasional multi-file copies the way they fit large recursive folder trees.

## OAuth
Same `launchWebAuthFlow` + silent-then-interactive token caching pattern as Pro, but a **separate OAuth Client ID** in the same Google Cloud project — don't reuse the Pro extension's Client ID here, and don't reuse this one there. Keeping them separate is what makes it possible to audit "does this Client ID ever request a restricted scope?" with a single glance at Google Cloud Console.

## Packaging
Use the `/package-extension` skill, same as Pro. Every release needs two zips: dev (with manifest `"key"`) and `-store` (without it).
