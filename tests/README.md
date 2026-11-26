# DIAL IN tests

## Unit (no browser, no network)

```bash
node --test tests/unit.test.mjs
```

19 tests: the UK midnight reset (GMT, BST and both clock changes), puzzle numbers, the daily schedule, scoring bands, and the name filter.

## End to end (Playwright, Chromium, against a **staging** copy only)

Each suite starts with `require('./_guard')`. The guard:
- refuses to run if `BASE` points at playdialin.com or the live database;
- blocks the live database, Stripe checkout and analytics in every browser context.

To set up a staging copy:
1. Copy the site into a folder.
2. Set `config.js` to the staging Supabase project and its anon key.
3. Replace the live Supabase host in `index.html` with the staging host.
4. Serve the folder from that folder:

```bash
python3 -m http.server 8090
```

Then run any suite from the repository root:

```bash
node tests/e2e/journey.js
```

`BASE` defaults to `http://127.0.0.1:8090/`.

| Suite | Covers |
|---|---|
| journey | First visit, daily, results, boards and paging, accounts across 3 devices, export, sign-out, delete |
| fc-single | Fact Check daily and its bonus |
| guestlg | Leagues for guests: create, join by link, standings |
| battle2 / battle3 / fc-battle | Battles: 2–4 players, rejoining a seat, host hand-over, Fact Check battles |
| chal | Head-to-head challenge links |
| plus | DIAL IN+ unlimited and archive |
| pay | Stripe webhook on staging: needs `STAGING_WEBHOOK_SECRET` (staging only, never the live one) |
| verify / acct-day1 | Verified accounts, the same-connection rule, an account's first day |
| more | Leaderboard "show more" paging |
| clock | A wrong phone clock, two tabs, simultaneous posts, an impossible bonus |
| widths | 10 screen widths × 12 screens: sideways scroll, clipped content, tap targets. Takes an output folder. |
| visual | 21 screenshots of the key states. Takes an output folder. |
| upgrade | Live version → new version with a game in progress. Needs both builds on `https://localhost:8443`. |
| perf | Old vs new: LCP, CLS, blocking time, tap response on a throttled phone. Needs both builds on 8093/8094. |

Test players build up on staging. To reset the same-connection counters between runs, clear `net_plays` and `net_events` in the **staging** project.
