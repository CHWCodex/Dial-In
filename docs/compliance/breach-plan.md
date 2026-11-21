# What to do if personal data leaks (breach plan)

A breach is anything that loses, exposes, changes or destroys player data without permission. Examples: someone reads the database, a secret key is published, the database is deleted, a bug shows one player's data to another.

## In the first hour
1. **Contain it.** Rotate any exposed key (Supabase: Project settings → API keys; Stripe: Developers → API keys). If the account secrets in `acct_config` leak, the cron secret can simply be replaced; changing the pepper signs every account out, so have a developer do it together with a fix. Turn off the affected feature if needed.
2. **Write it down** in the breach log below: when you found it, what happened, which data, roughly how many players.
3. Tell your co-owner straight away.

## Within 72 hours: do we have to tell the ICO?
Report to the ICO (ico.org.uk/for-organisations/report-a-breach, or 0303 123 1113) **within 72 hours of finding out** unless the breach is unlikely to put anyone at risk. If unsure, report: you can add details later.

- Likely to need reporting: emails (until 5 Dec 2026) or PIN hashes exposed; saved progress readable by others; a purchase record linked to a player exposed.
- Usually not reportable (still log it): a few display names and scores that were public anyway; a scrambled connection tag (it can't be turned back into an IP).

## Tell players?
If the breach is likely to put people at **high risk** (for example PIN hashes plus usernames exposed), tell the affected players without delay: an in-game message on the home screen and a note on the site. Tell them what happened, what we've done, and what they should do (for example "change your PIN in Settings").

## Afterwards
Fix the cause, check the fix, and note what you'd do differently.

## Breach log (keep every incident here, reported or not)
| Date found | What happened | Data / players affected | Reported to ICO? (date, ref) | Players told? | Fix |
|---|---|---|---|---|---|
| | | | | | |
