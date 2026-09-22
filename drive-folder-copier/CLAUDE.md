# Drive Folder Copier

Two sibling products sharing one brand and one licensing backend:

- **Pro** (`extension/`): Chrome/Edge extension that recursively copies a Google Drive folder — including all subfolders — into the user's own My Drive. Needs Google's restricted `drive` OAuth scope, which requires an annual paid ADA-CASA security assessment. Freemium: 2 free operations, then subscription/perpetual plans via Paddle.
- **Lite** (`extension-lite/`): copies only the specific files the user explicitly multiselects via Google's Picker — no recursion, no folder selection. Uses only the non-sensitive `drive.file` scope, so it needs **no OAuth verification and no CASA assessment at all**. Exists specifically to generate revenue without waiting on (or paying for) Pro's verification. Billing model (built, audited, not yet turned on): 1 GiB free cumulative, then prepaid credit packs via Paddle. **Currently running fully free, billing disabled on purpose** — see "Billing status" below.

Never blur these two together. Lite must never request `drive`/`drive.readonly`/`drive.metadata.readonly` or gain folder recursion — see `.claude/rules/extension-lite-code.md`. If Pro's verification later completes and CASA is paid, Lite still has standalone value (instant availability, no restricted permissions) and can keep running alongside it — it isn't meant to be retired once Pro is unblocked.

## Status
- Pro extension: v1.12.8 (local dev). Chrome Web Store has a much older package.
- Pro Google OAuth verification: submitted, under review, blocked on an ADA-CASA AL1 assessment (~$500-720/yr, due Dec 13 2026) that isn't funded yet.
- Lite extension: v0.1.0, in development, not yet published anywhere (not even internally installed yet). Currently free/unlimited by design (`BILLING_ENABLED = false` in `background.js` and `popup.js`) — Néstor wants to try the core flow first before wiring up money. Only blocker to internal testing now: a real OAuth Client ID (see `extension-lite/README.md`) — nothing else on the old checklist (Paddle Price IDs, Supabase migration, icons, privacy policy) blocks *internal* testing, only public release.
- Licensing backend: v0.9.3 (Pro) + new Lite endpoints added and CASA-audited, not yet deployed to Vercel (not needed while `BILLING_ENABLED = false`).

## Billing status (Lite)
The full billing implementation exists and passed the casa-guardian audit (see `.claude/rules/extension-lite-code.md` and the backend's `lite-*` endpoints), but is switched off:
- `extension-lite/background.js`: `BILLING_ENABLED = false` skips `checkQuota`/`logOperation` entirely — copies never touch the backend.
- `extension-lite/popup.js`: same flag hides the "Buy more" button and shows a plain "Free (internal test)" badge instead of calling the backend for a balance.
To turn billing back on: flip both flags to `true`, deploy the backend (apply `supabase_schema_lite.sql`, set env vars, deploy to Vercel), fill in the OAuth Client ID and Paddle Price IDs, then re-test end to end before publishing.

## Folders
`extension/` Pro source · `extension-lite/` Lite source · `picker/` Pro hosted Picker · `picker-lite/` Lite hosted Picker · `checkout/` Pro hosted Paddle checkout (subscriptions/perpetual) · `checkout-lite/` Lite hosted Paddle checkout (one-time credit packs) · `legal-pages/` privacy, terms, refunds · `index.html` product page.

Detailed rules for each load automatically from `.claude/rules/` at the repo root when you open files in them.

## While Pro's OAuth verification is under review
Don't change the publishing status or user type in Google Cloud Console — Google warns it can delay or reset the review. This restriction is Pro-specific: Lite's OAuth client is a separate, unverified-by-design non-sensitive-scope client and isn't subject to it.

## Legal pages
`legal-pages/` is guarded by a hook that blocks direct edits — legally load-bearing content needs your explicit confirmation of what changed and why. Lite needs its own published privacy policy (a draft exists at `extension-lite/PRIVACY_POLICY.md`, referencing an as-yet-unpublished `legal-pages/privacy-lite.html`) before it can go live — that publication step is intentionally not done yet, pending your review.

## Funding the Pro CASA assessment (~$540/yr)
Since Pro's OAuth verification is blocked on an unfunded ADA-CASA AL1 assessment (see "Status" above), Néstor is raising the ~$540 through two channels, both live:
- **GitHub Sponsors**: https://github.com/sponsors/Reyesnes — profile configured (bio, introduction, monthly goal $50/mo framed as ongoing sustainability, not the urgent one-time ask). `.github/FUNDING.yml` enables the Sponsor button across the repo.
- **Ko-fi**: https://ko-fi.com/reyesnes — the actual "$540, ASAP" one-time campaign, with a public goal ("Google Security Certification (CASA)", 0/$540) and a pinned intro post. This is the primary link to share when promoting the fundraiser (Reddit, Product Hunt, personal outreach), since Ko-fi supports one-time cumulative goals and GitHub Sponsors' goal is monthly-recurring only, not a lump-sum tracker.
Considered and rejected: hiring cheap Upwork freelancers to "do the CASA assessment" — confirmed via research that only ADA-authorized labs (e.g. TAC Security) can issue the Letter of Validation Google accepts; freelancers can at most help with prep/remediation work, not the final certification.
