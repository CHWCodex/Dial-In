# Record of processing activities (UK GDPR Article 30)

**Controller:** Charlie Hilton-West and James Alden, trading as Dial In (playdialin.com), United Kingdom.
Registered with the ICO. Contact: privacy@playdialin.com.
**Last reviewed:** 21 November 2026. Review this record whenever a feature changes what data we hold, and at least once a year.

| Activity | Data | People | Purpose | Lawful basis | Where held / processors | Retention |
|---|---|---|---|---|---|---|
| Player profile | Random player ID, display name, friend code, created date | All players | Run the game, show names in boards/Battles | Contract (Art 6(1)(b)) | Supabase (London) | Saved accounts: until deleted. Guests: 12 months after last use |
| Accounts | Username, PIN hash (bcrypt), recovery code hash, lockout counters | Players who save an account | Sign-in on any device | Contract | Supabase (London) | Until the account is deleted |
| Email (ending) | Email address, unconfirmed email changes, sign-in codes | 31 players who joined with email | Sign-in, until they move to username + PIN | Contract | Supabase, Resend | Deleted on migration; all deleted 5 Dec 2026 |
| Game results | Daily answers, scores, dates, Dial Ball bonus, off-board flag | Players who finish a daily | Scoring, leaderboards, streaks, history | Contract | Supabase (London) | With the profile |
| Saved progress | Whole game save (stats, streaks, settings, friends, Fact Check, archive) | Players online | Cross-device progress | Contract | Supabase (London); the player's own device | With the profile |
| Leagues | League name/code, owner, members, join date | Players who create/join | Private leaderboards | Contract | Supabase (London) | Until league closed or player deleted |
| Battles | Room code, names, answers, lives, heartbeats | Battle players | Live multiplayer | Contract | Supabase (London) | Deleted automatically within a day |
| Fair-play tags | Salted SHA-256 hash of IP (salt changes daily), puzzle date, player ID, event kind | Players starting/finishing the daily; account sign-ins and creation | Stop leaderboard cheating; rate-limit sign-in and account creation | Legitimate interests (Art 6(1)(f)) – see the legitimate interests assessment | Supabase (London) | 48 hours |
| Device codes | Hash of a 6-character code, player ID, expiry | Players adding a device | Sign in on another device | Contract | Supabase (London) | 10 minutes (deleted within a day) |
| Reminders | Push endpoint and keys | Players who opt in | One daily reminder | Consent (Art 6(1)(a)) | Supabase; browser push services (Google, Apple, Mozilla) | Until turned off or the endpoint fails |
| Purchases | Amount, currency, date, Stripe session and payment reference, refund date | Buyers of DIAL IN+ | Unlock DIAL IN+, refunds, tax records | Contract; legal obligation (Art 6(1)(c)) | Supabase; Stripe (own controller for card and billing data) | 6 years; player link removed if they delete their account |
| Server logs | IP, user agent, request times | All visitors | Security and running the service | Legitimate interests | Cloudflare, Supabase | Provider defaults (days to weeks) |
| Visit counts | Cookieless page-view statistics | All visitors | Understand traffic | Legitimate interests | Cloudflare Web Analytics | Provider default |

**Special category / criminal data:** none.
**International transfers:** US-based processors (Cloudflare, Stripe, Resend, Supabase's parent) rely on the UK–US data bridge or the UK International Data Transfer Addendum.
**Security:** row-level security on every table (players can read and write only their own rows); service-only functions for accounts, payments and reminders; secrets kept in Supabase only; HTTPS everywhere with HSTS and a strict content security policy; PINs and recovery codes hashed with bcrypt; 5-try PIN lockout and per-connection rate limits.
**Data processing agreements:** accept and keep a copy of each provider's DPA: Supabase (dashboard → Organization → Legal documents), Cloudflare, Stripe, Resend.
