# Extension Labs

Monorepo for Extension Labs: the public site (GitHub Pages, `extensionlabs.online`) plus the source of each browser extension, one folder per product.

## Layout
```
<product>/
├── index.html      Product page
├── legal-pages/    Privacy, terms, refunds — legally load-bearing
├── checkout/       Hosted Paddle checkout (extension CSP forbids Paddle.js inline)
├── extension/      Extension source (Manifest V3)
└── picker/         Hosted Google Picker page (extension CSP forbids remote scripts)
```
Products: `drive-folder-copier/`. Planned: `kdp-lens/`.

## Universal rules
- **Repo must stay public.** GitHub Pages free tier serves public repos only.
- **Never commit secrets.** No `.env`, no `*.pem`, no API keys. The licensing backend's secrets live in Vercel env vars, never here.
- **One product per top-level folder.** Product-specific detail goes in that folder's `CLAUDE.md`, never in this file.
- Extensions are packaged and uploaded to the Chrome Web Store manually — nothing here auto-deploys except GitHub Pages serving the static site.

## Sibling repo (not here, stays private)
`drive-folder-copier-backend` — Vercel + Supabase licensing backend. Cannot merge into this repo: it must stay private, and GitHub Pages requires public.

## Detailed rules
Loaded on demand from `.claude/rules/` when you touch matching files — don't duplicate that detail here.
