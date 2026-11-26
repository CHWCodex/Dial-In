# Redesign release: deployment and rollback plan

**Current live version:** service worker `dialin-v44`, `main`.

**This release:** service worker `dialin-v45`, branch `claude/modest-keller-azmz2k`.

**Files that change:**
- `index.html`
- `sw.js` (cache version)
- `how-to-play.html`, `privacy.html`, `terms.html` (wording)
- tests and docs, which aren't deployed (`.assetsignore`)

**Not changing:**
- database and migrations (none needed)
- edge functions
- Stripe links and prices
- `config.js`
- Cloudflare settings

## Deploy

1. Merge `main` into the branch, then re-run `node --test tests/unit.test.mjs`.
2. Open the PR, then merge it. The merge auto-deploys through Cloudflare Workers static assets.
3. Health checks within 10 minutes:
   1. `https://playdialin.com/sw.js` contains `dialin-v45`.
   2. Home shows the bottom navigation, and Play now opens question 1.
   3. Ranks loads the daily board.
   4. Profile opens, and its Account fold works.
   5. Finish one test daily on a QA account, then confirm it appears on the board. Delete the QA player afterwards.
   6. Supabase logs show no new errors on `submit_result`.
   7. The Stripe webhook log is quiet. No payment test on live.
4. Returning players get v45 on their next visit. Pages are network-first, so no hard refresh is needed. Their old cache is removed automatically.

## Rollback (about 2 minutes, no data risk)

1. Revert the merge commit on `main`. That redeploys v44 automatically.
   - Alternatively, use Cloudflare → Workers → dial-in → Deployments → roll back to the previous deployment.
2. Bump `sw.js` to `dialin-v46` in the revert, so phones already on v45 drop its cache.
3. Nothing in the database needs undoing. Player progress lives in the same storage keys in both versions, so it survives a downgrade too.

## Known limits of the testing

These areas weren't tested:
- Safari, Firefox, Edge and in-app browsers (TikTok, Instagram) on real devices
- a real Stripe test-mode checkout page
- push notifications
- custom analytics events (the site uses only Cloudflare Web Analytics)
