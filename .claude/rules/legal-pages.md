---
paths:
  - "**/legal-pages/**"
---

# Legal pages

These files are linked from Google Cloud Console's OAuth consent screen and the Chrome Web Store Privacy tab. They are legally load-bearing.

- Never change their substance without being told exactly what changed and why. A `PreToolUse` hook blocks edits here — that block is intentional, not a bug to work around.
- `drive-folder-copier/legal-pages/privacy.html` has already been through one correction demanded by Google's OAuth verification team: it needs explicit "How we protect your data" (encryption in transit, one-way hashing, restricted DB access) and "Data retention and deletion" sections. Don't remove them.
- The privacy policy must disclose both OAuth scopes the extension requests: `auth/drive` and `auth/userinfo.email`.
- Keep in sync with the same product's `extension/PRIVACY_POLICY.md`. Editing one usually means editing the other.
