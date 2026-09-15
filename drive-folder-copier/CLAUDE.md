# Drive Folder Copier

Chrome/Edge extension (Manifest V3) that recursively copies a Google Drive folder — including all subfolders — into the user's own My Drive. Freemium: 2 free operations, then paid plans via Paddle.

## Status
- Extension: v1.12.7 (local dev). Chrome Web Store has a much older package.
- Google OAuth verification: submitted, under review. One round of reviewer feedback already answered.
- Licensing backend: v0.9.3, live (separate private repo `drive-folder-copier-backend`).

## Folders
`extension/` source · `picker/` hosted Picker · `checkout/` hosted Paddle checkout · `legal-pages/` privacy, terms, refunds · `index.html` product page.

Detailed rules for each load automatically from `.claude/rules/` at the repo root when you open files in them.

## While OAuth verification is under review
Don't change the publishing status or user type in Google Cloud Console — Google warns it can delay or reset the review.
