# Drive Folder Copier

Two sibling products sharing one brand and one licensing backend:

- **Pro** (`extension/`): Chrome/Edge extension that recursively copies a Google Drive folder — including all subfolders — into the user's own My Drive. Needs Google's restricted `drive` OAuth scope, which requires an annual paid ADA-CASA security assessment. Freemium: 2 free operations, then subscription/perpetual plans via Paddle.
- **Lite** (`extension-lite/`): copies only the specific files the user explicitly multiselects via Google's Picker — no recursion, no folder selection. Uses only the non-sensitive `drive.file` scope, so it needs **no OAuth verification and no CASA assessment at all**. Exists specifically to generate revenue without waiting on (or paying for) Pro's verification. Freemium: 1 GiB free (cumulative), then prepaid credit packs via Paddle — no subscription.

Never blur these two together. Lite must never request `drive`/`drive.readonly`/`drive.metadata.readonly` or gain folder recursion — see `.claude/rules/extension-lite-code.md`. If Pro's verification later completes and CASA is paid, Lite still has standalone value (instant availability, no restricted permissions) and can keep running alongside it — it isn't meant to be retired once Pro is unblocked.

## Status
- Pro extension: v1.12.8 (local dev). Chrome Web Store has a much older package.
- Pro Google OAuth verification: submitted, under review, blocked on an ADA-CASA AL1 assessment (~$500-720/yr, due Dec 13 2026) that isn't funded yet.
- Lite extension: v0.1.0, in development, not yet published. Needs: a real OAuth Client ID (see `extension-lite/README.md`), real icon art (currently placeholder — reused Pro's icons), the `supabase_schema_lite.sql` migration applied in Supabase, real Paddle Price IDs for the 3 credit packs, and a reviewed/published privacy policy (see "Legal pages" below) before it can ship.
- Licensing backend: v0.9.3 (Pro) + new Lite endpoints added, not yet deployed/tested end-to-end. Separate private repo `drive-folder-copier-backend`.

## Folders
`extension/` Pro source · `extension-lite/` Lite source · `picker/` Pro hosted Picker · `picker-lite/` Lite hosted Picker · `checkout/` Pro hosted Paddle checkout (subscriptions/perpetual) · `checkout-lite/` Lite hosted Paddle checkout (one-time credit packs) · `legal-pages/` privacy, terms, refunds · `index.html` product page.

Detailed rules for each load automatically from `.claude/rules/` at the repo root when you open files in them.

## While Pro's OAuth verification is under review
Don't change the publishing status or user type in Google Cloud Console — Google warns it can delay or reset the review. This restriction is Pro-specific: Lite's OAuth client is a separate, unverified-by-design non-sensitive-scope client and isn't subject to it.

## Legal pages
`legal-pages/` is guarded by a hook that blocks direct edits — legally load-bearing content needs your explicit confirmation of what changed and why. Lite needs its own published privacy policy (a draft exists at `extension-lite/PRIVACY_POLICY.md`, referencing an as-yet-unpublished `legal-pages/privacy-lite.html`) before it can go live — that publication step is intentionally not done yet, pending your review.
