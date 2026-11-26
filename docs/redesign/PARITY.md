# Feature parity: live (v44) vs redesign (v45)

**Backend dependencies:** the redesign doesn't change the database, edge functions, Stripe, scoring, puzzles or prices. All of them stay as they are on live.

**Status key:**
- **V** = verified and passed on staging (real staging backend, Chromium emulation)
- **U** = verified by unit test

| Feature | Live behaviour | Redesign behaviour | What changed | Tests | Status |
|---|---|---|---|---|---|
| Daily puzzle (7 questions, UK midnight reset) | Home → Play | Home card → Play now / Continue · question N of 7 | Layout only | journey, unit (reset incl. clock changes), upgrade | V, U |
| Scoring bands, ranges, exact | Client + server | Unchanged | None | unit, 300/300 client/server parity | V, U |
| Dial Ball bonus | After the 7th answer | Unchanged | None | journey, clock (server caps bonus) | V |
| Results, share | Results screen | Same, tidier layout | Layout | journey, visual | V |
| First visit | Name pop-up before playing | Random name auto-assigned; rename any time in Profile or on results | No pop-up for daily, archive or Unlimited | journey, fc-single | V |
| Battles (2–4) | Name pop-up | Name asked only for Battles; lobby shows "Playing as … · Change name" | Name asked only here | battle2 15/15, battle3, fc-battle | V |
| Fact Check daily and battles | Home card | Home card + Play tab | Placement | fc-single, fc-battle | V |
| Unlimited / Unlimited Fact Check (DIAL IN+) | Mode screens | Play tab | Placement | plus 13/13 | V |
| Past puzzles (archive) | Mode screen | Play tab | Placement | plus, visual | V |
| Challenges (head-to-head links) | Links | Unchanged | None | chal 10/10 | V |
| Leaderboards: daily, all-time, streaks, Fact Check | Ranks screen | Ranks tab, scrollable chips | Leagues is now the third chip | more 8/8, journey | V |
| Leagues (guests and accounts) | Home line + Ranks | Ranks → Leagues | The home leagues line was removed (one fewer request on load) | guestlg | V |
| Accounts: save, sign in on another phone, PIN, export, sign out, delete | Settings | Profile (folds); guest chip "save or sign in" | Renamed Settings → Profile | journey (3 devices), acct-day1 | V |
| Verified tick, same-connection rule | Server | Unchanged | None | verify 11/11 | V |
| DIAL IN+ purchase, restore, refund | Stripe link + webhook | Unchanged | Wording only ("Profile") | pay 15/15 + database checks | V (staging webhook; real Stripe test checkout blocked) |
| Stats and history | Stats screen | Profile → All statistics | Placement; "Your first daily game" wording | visual | V |
| Festive theme (26 Nov–1 Jan) and switch | Live | Unchanged | None | visual | V |
| Sound, reminders, add to home screen | Settings | Profile folds | Placement | visual | V |
| Offline play / PWA | SW v44 | SW v45, network-first pages | Cache version only | upgrade 10/10 | V |
| Upgrade with a game in progress | — | Progress, name, settings and player id kept; old cache removed | — | upgrade | V |
| Static pages (how to play, privacy, terms) | "Settings" | "Profile" | Wording; legal "last updated" date | review | V |
| SEO pages, sitemap, answers pages | Live | Unchanged | None | — | Unchanged |
