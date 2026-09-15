---
paths:
  - "**/extension/manifest.json"
---

# manifest.json — two variants, never confuse them

| Variant | `"key"` field | Extension ID | Used for |
|---|---|---|---|
| Dev (committed here) | Present | `adocjegeagfnjhdkjiagkabbnopmochk` | `Load unpacked` on Néstor's machines |
| Store upload | **Removed** | `fnifkmdjhkdjllojbnhlmgcngjndlbhm` (assigned by Google) | Chrome Web Store |

The committed `manifest.json` keeps `"key"` — the OAuth redirect URIs registered in Google Cloud Console depend on that fixed dev ID.

Uploading a package that still contains `"key"` fails with `key field value in the manifest doesn't match the current item`. This has happened once already. The `/package-extension` skill strips it correctly (JSON parse → delete → re-serialize; a text find/replace is not safe here).

Bumping `"version"` is what names the release zips — keep them consistent.
