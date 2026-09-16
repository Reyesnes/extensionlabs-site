---
name: package-extension
description: Packages an extension into its two release zips — dev (with the manifest "key" field) and -store (without it) — each including icons/, README.md and PRIVACY_POLICY.md. Use when asked to package, zip, build or deliver a new extension version.
disable-model-invocation: true
allowed-tools: Bash(zip *), Bash(cp *), Bash(mkdir *), Bash(node --check *), Read, Write
---

Package the extension at `$ARGUMENTS` (default: `drive-folder-copier/extension`) into two release zips.

1. Read `manifest.json`, confirm `"version"` is what the user wants. If not, ask before bumping.
2. Verify present: `icons/` with all 5 PNGs, `README.md`, `PRIVACY_POLICY.md`. If any is missing, stop and ask — never ship an incomplete zip.
3. `node --check` every `.js` file. Stop on any syntax error.
4. Build `<product>-v<version>/` — a straight copy, `"key"` left intact.
5. Build `<product>-v<version>-store/` — same copy, then strip `"key"` from its `manifest.json` by parsing the JSON, deleting the field, and re-serializing. Never do this with text find/replace.
6. Confirm both `manifest.json` files still parse as valid JSON.
7. Zip both folders.
8. Report both paths and state plainly which one carries `"key"` (dev) and which doesn't (store). Uploading the wrong one to the Chrome Web Store fails with `key field value in the manifest doesn't match the current item` — it has happened before.
