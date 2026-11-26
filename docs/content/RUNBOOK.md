# Question content runbook

How DIAL IN keeps its questions unique, correct and in supply. Nothing in `content/`, `scripts/`, `tests/` or `docs/` is deployed (see `.assetsignore`).

## The pieces

| File | What it is |
|---|---|
| `index.html` (`RAW_QUESTIONS`) | The number-question bank, 1,307 questions. Rows are only ever added at the end. |
| `facts.js` | The Fact Check! statement bank, 300 statements. |
| `content/question-groups.json` | **Reviewed decisions**: fact groups (questions testing the same fact), quarantine with reasons, and a rewording log. |
| `content/reviewed.json` | Flagged pairs judged to be *different* facts, and time-sensitive questions judged stable. |
| `content/schedule.json` | The reviewed daily lists for Daily DIAL IN and Fact Check!, from 28 Nov 2026, plus the replacement reserve. |
| `content/question-usage.json` | Generated record per question: fact, status (published / scheduled / reserve / available / retired-same-fact / quarantined), publication dates, source and verification status. |
| `content/published-history.json` | Every published day. Written nightly; validation fails if the game would ever show something different for a published date. |
| `content/fact-check-candidates.json` | Draft statements **awaiting your approval**. Never served. |
| Database `questions.fact_id/status/reviewed_on`, view `question_usage`, trigger `daily_sets_guard` | Server copy of the same rules (migration `20261126000000_question_integrity_sync.sql`). |

## Reuse policy

| Mode | Rule | Where it's enforced |
|---|---|---|
| **Daily DIAL IN** | A fact (a question or any of its fact-group siblings) is a daily question **at most once, ever**. Past puzzles stay exactly as published. When the reviewed list runs out the game shows a holding screen; it never fills a day with a repeat. | `build-content.mjs`, `validate-questions.mjs`, CI, and the `daily_sets_guard` trigger |
| **Past puzzles (archive)** | Replays the original questions on purpose. This is the only exception. | by design |
| **Fact Check! daily** | A claim, or its twin (the same claim reworded, negated or flipped from true to false), is used at most once. No claim about the same subject as that day's number puzzle within ±3 days. | `build-content.mjs`, validator, tests |
| **Unlimited** (both games) | One question per fact. Each player works through their own shuffle of the whole pool before anything repeats. The last 800 questions seen are skipped across runs. Nothing from the daily window (3 days back, 30 ahead) is served. | `pickEndless`, `factNextRunId` |
| **Battles** (both games) | No fact twice in a room, across rematches. Nothing from the daily window. Every player gets the host's question, so all players stay in sync. | `battleQ`, `factBattlePick` |

**Settings:**
- The window size is `DAILY_GUARD` in `index.html`.
- The ±3-day gap between Fact Check and the number puzzle is `RULES.crossModeGapDays` in `build-content.mjs`.
- The reserve size is `RULES.reserve`.

**Variety rules for scheduling:**
- At most 2 questions from one category per day.
- At most 2 "what year" questions per day, or 3 while the remaining pool is year-heavy.
- Related questions (same subject, different fact) at least 14 days apart where possible. Any relaxation is logged in `question-usage.json`.

## Adding questions

1. Append the rows to `RAW_QUESTIONS` in `index.html` (number questions) or to `facts.js` (statements). Give each one a source, use British English, and add a reference date if the answer can change.
2. Run `node scripts/validate-questions.mjs`. It lists every new possible duplicate (`[review]`), giveaway, missing date and formatting problem.
3. Decide each flag:
   - **Same fact:** add the pair to `factGroups` in `content/question-groups.json`.
   - **Different facts:** add the pair to `distinctPairs` in `content/reviewed.json`.
   - **Wrong or unverifiable:** add the question to `quarantine` with a reason.
4. Run `node scripts/build-content.mjs`. It extends the schedules; days already scheduled are kept as they are.
5. Run `node scripts/build-db-sync.mjs > supabase/migrations/<timestamp>_question_sync.sql` and apply it after the release. The trigger refuses any day that breaks the rules.
6. Push. CI blocks the merge if anything is out of step.

## Approving the draft Fact Check statements

`content/fact-check-candidates.json` holds 131 drafts, written to cover Fact Check past 30 Dec 2026, when the current statements run out. They were checked editorially, not against their sources. To approve some or all of them:

1. Append the approved rows to `facts.js`.
2. Run `node scripts/build-content.mjs` then `node scripts/validate-questions.mjs`.

Approving all of them extends Fact Check to about 18 Jan 2027.

## Correcting a published question (controlled procedure)

Published puzzles are locked. A genuinely wrong answer is handled like this:

1. **Decide the fix.**
   - Usually: correct the answer or range in the bank and leave the day's questions as they are.
   - Rarely: void the question for that day.
2. **Work out who is affected.** Read `public.question_usage` for the dates, and `daily_results` for who played them.
3. **Re-score only if the correction helps players.** Run `update daily_results set points = …, score = …` in one transaction, with `set local dialin.correction = 'on'` if a `daily_sets` row must change. Never lower anyone's score without telling them.
4. **Tell players** in the results screen copy or on social media, and add a line to this file's changelog.
5. **Update `content/question-groups.json`** (`reworded` / `quarantine`). The question will not be scheduled again.

## Release steps for this change

1. **Before merging:** if the release happens on or after 28 Nov 2026, re-cut the start date to tomorrow:
   ```bash
   node scripts/build-content.mjs --from <tomorrow>
   ```
   Then regenerate the migration with `build-db-sync.mjs` and run all the checks again.
2. **Merge.** The site deploys.
3. **Apply the migration** in Supabase. It replaces the database's unpublished future days with the reviewed schedule; published days are untouched.
4. **Check:**
   - `select md5(string_agg(...))` over `daily_sets` matches the game (see `tests/db/guard.sh`).
   - Tomorrow's puzzle can be submitted.

## Monitoring

- **Every pull request and push:** unit, integration, fuzz and question checks (`.github/workflows/ci.yml`).
- **Every night at 00:20 UK** (`.github/workflows/daily-pages.yml`):
  - records the day that just went live;
  - refreshes the usage record;
  - checks the schedule, the history and the stock of questions;
  - fails the run (GitHub emails the owner) if:
    - a published day would change;
    - a fact would be reused;
    - fewer than 14 days of daily puzzles or 7 days of Fact Check are left.
  - It warns at 30 days.
