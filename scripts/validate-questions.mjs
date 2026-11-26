// Question and schedule validation. Runs in CI on every pull request and push, and every night before publishing.
//   node scripts/validate-questions.mjs                     validate (exit 1 on any error)
//   node scripts/validate-questions.mjs --record-published  also add any newly published days to content/published-history.json
//   node scripts/validate-questions.mjs --json              machine-readable summary
// Errors block a release. Warnings are printed (as GitHub annotations in Actions) but don't fail the run.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadGame, loadFactGame } from './load-game.mjs';
import { analyse, candidates, normText } from './question-audit.mjs';

const ROOT = new URL('..', import.meta.url), at = f => new URL(f, ROOT), read = f => JSON.parse(readFileSync(at(f), 'utf8'));
const args = process.argv.slice(2), GH = !!process.env.GITHUB_ACTIONS;
const errors = [], warnings = [];
const err = (code, msg) => errors.push(`[${code}] ${msg}`), warn = (code, msg) => warnings.push(`[${code}] ${msg}`);
export const THRESHOLDS = { dailyFailDays: 14, dailyWarnDays: 30, factFailDays: 7, factWarnDays: 30, reserveWarn: 21 };

const G = loadGame(), F = loadFactGame(), groups = read('content/question-groups.json'), reviewed = read('content/reviewed.json');
const today = process.env.DIALIN_TODAY || G.DateUK.today();   // DIALIN_TODAY lets tests simulate other days
const usage = read('content/question-usage.json');

// ---------------------------------------------------------------- 1. every number question is well formed
const ids = new Set(), YEAR_NOW = Number(today.slice(0, 4));
const SPELL = /\b(color|colors|center|centers|meters|liters|favorite|flavor|humor|neighbor|traveled|theater|gray|aluminum|tire|curb|program(?:me)?s? \(tv\))\b/i;
for (const q of G.BANK) {
  const where = `${q.id}`;
  if (ids.has(q.id)) err('id', `${where}: duplicate id`); ids.add(q.id);
  if (!/^[a-z]+\d+$/.test(q.id)) err('id', `${where}: bad id`);
  if (!q.category) err('field', `${where}: no category`);
  if (![1, 2, 3].includes(q.difficulty)) err('field', `${where}: difficulty must be 1, 2 or 3`);
  if (typeof q.question !== 'string' || q.question.length < 12 || q.question.length > 200) err('wording', `${where}: question length ${q.question.length}`);
  if (!/[?…][’'”"]?$/.test(q.question.trim())) warn('wording', `${where}: question doesn't end with a question mark`);
  if (typeof q.answer !== 'number' || !isFinite(q.answer) || q.answer < 0) err('answer', `${where}: answer must be a finite number ≥ 0`);
  if (!['pct', 'year', 'abs'].includes(q.scoring)) err('answer', `${where}: unknown scoring ${q.scoring}`);
  if (q.scoring === 'year' && (!Number.isInteger(q.answer) || (q.answer > YEAR_NOW && !/\bwill\b/i.test(q.question)))) err('answer', `${where}: a year answer must be a whole number, and not in the future unless the question says 'will'`);
  if (q.range && !(q.range.length === 2 && q.range[0] <= q.answer && q.answer <= q.range[1])) err('answer', `${where}: the 'counts as exact' range ${q.range} must contain the answer ${q.answer}`);
  if (q.range && (q.range[1] - q.range[0]) / Math.max(1, Math.abs(q.answer)) > 0.6 && q.scoring !== 'year') warn('answer', `${where}: the 'counts as exact' range is very wide`);
  if (!q.source || q.source.trim().length < 3) err('source', `${where}: no source`);
  if (!q.explanation || q.explanation.trim().length < 2) err('field', `${where}: no explanation`);
  const status = usage.questions[q.id] && usage.questions[q.id].status;
  const live = status !== 'published' && status !== 'quarantined';   // published wording is frozen
  if (live && SPELL.test(q.question)) err('wording', `${where}: American spelling in "${q.question.match(SPELL)[0]}" (use British English)`);
  if (live && q.scoring !== 'year') {
    const shown = (q.question.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) || []).map(Number);
    if (shown.includes(q.answer) && !reviewed.timeSensitiveOk.includes(q.id)) err('giveaway', `${where}: the answer ${q.answer} appears in the question`);
  }
  const TS = /\b(live in|lives in|population|currently|today|nowadays|at present|so far|has won|have won|has had|have had|has scored|record|recent|latest|tallest|biggest|largest|longest|oldest|richest|most)\b/i;
  const REF = /\b(19|20)\d\d\b/;
  if (live && TS.test(q.question) && !REF.test(q.question) && !reviewed.timeSensitiveOk.includes(q.id)) err('time', `${where}: time-sensitive wording with no reference date: "${q.question}"`);
}
for (const f of F.FACTS) {
  if (!f.source) err('source', `${f.id}: no source`);
  if (!f.explanation) err('field', `${f.id}: no explanation`);
}

// ---------------------------------------------------------------- 2. duplicates: exact, normalised and suspected same-fact pairs must be reviewed
const A = analyse(), C = candidates(A);
const groupOf = new Map(); [...groups.factGroups, ...groups.factCheckGroups].forEach(g => g.filter(x => /^[a-z]+\d+$/.test(x)).forEach(x => groupOf.set(x, g[0])));
for (const g of groups.factGroups) for (const id of g.filter(x => /^[a-z]+\d+$/.test(x))) if (!G.BY_ID.has(id)) err('groups', `fact group lists unknown question ${id}`);
for (const g of groups.factCheckGroups) for (const id of g.filter(x => /^f\d+$/.test(x))) if (!F.FACT_BY_ID.has(id)) err('groups', `Fact Check group lists unknown statement ${id}`);
for (const id of Object.keys(groups.quarantine)) if (!G.BY_ID.has(id)) err('groups', `quarantine lists unknown question ${id}`);
const known = new Set(reviewed.distinctPairs);
const normSeen = new Map();
for (const q of A.Q) { const k = q.norm; if (normSeen.has(k) && groupOf.get(q.id) !== groupOf.get(normSeen.get(k)) ) err('duplicate', `${normSeen.get(k)} and ${q.id} have the same wording but aren't in a fact group`); normSeen.set(k, q.id); }
for (const c of C) {
  const k = `${c.a}|${c.b}`, same = groupOf.has(c.a) && groupOf.get(c.a) === groupOf.get(c.b);
  if (!same && !known.has(k)) err('review', `${k} may test the same fact (${c.why}). Add them to a fact group in content/question-groups.json, or to distinctPairs in content/reviewed.json once reviewed`);
}

// ---------------------------------------------------------------- 3. generated content is in step with content/
try { execFileSync(process.execPath, [new URL('build-content.mjs', import.meta.url).pathname, '--check'], { stdio: 'pipe' }); }
catch (e) { err('sync', String(e.stderr || e.stdout || e.message).trim()); }

// ---------------------------------------------------------------- 4. the daily schedules
const hist = existsSync(at('content/published-history.json')) ? read('content/published-history.json') : { daily: {}, factCheck: {}, knownRepeats: [] };
for (const [d, want] of Object.entries(hist.daily)) { const got = G.dailyIds(d); if (!got || got.join(',') !== want.join(',')) err('history', `Daily ${d} was published as ${want.join(',')} but the game now says ${got ? got.join(',') : 'nothing'}. Published puzzles must never change.`); }
for (const [d, want] of Object.entries(hist.factCheck)) { const got = F.factDailyIds(d); if (!got || got.join(',') !== want.join(',')) err('history', `Fact Check ${d} was published as ${want.join(',')} but the game now says ${got ? got.join(',') : 'nothing'}.`); }
const lastPub = Object.keys(hist.daily).sort().pop();
if (lastPub && lastPub < G.DateUK.add(today, -2)) warn('history', `published-history.json ends on ${lastPub}; the nightly job should be recording each day`);

const factSeen = new Map(), knownRepeat = new Set(hist.knownRepeats || []);
let d = G.CONFIG.EPOCH, lastDaily = null;
for (; G.hasDaily(d); d = G.DateUK.add(d, 1)) {
  const day = G.dailyIds(d);
  if (day.length !== 7 || new Set(day).size !== 7) err('schedule', `${d}: needs 7 different questions`);
  if (new Set(day.map(G.factOf)).size !== 7) err('schedule', `${d}: two questions about the same fact`);
  for (const id of day) {
    if (!G.BY_ID.has(id)) { err('schedule', `${d}: unknown question ${id}`); continue; }
    if (d > today && G.QUARANTINED.has(id)) err('schedule', `${d}: quarantined question ${id} is scheduled`);
    const f = G.factOf(id);
    if (factSeen.has(f) && !knownRepeat.has(`${id}@${d}`)) err('reuse', `${d}: ${id} repeats a fact already used on ${factSeen.get(f)}`);
    if (!factSeen.has(f)) factSeen.set(f, d);
  }
  if (d >= G.DAILY_V2.from) {
    const cats = {}; day.forEach(id => { const c = G.BY_ID.get(id).category; cats[c] = (cats[c] || 0) + 1; });
    const over = Object.entries(cats).filter(([, n]) => n > 2); if (over.length) err('balance', `${d}: more than 2 ${over[0][0]} questions`);
    const years = day.filter(id => G.BY_ID.get(id).scoring === 'year').length; if (years > 3) err('balance', `${d}: ${years} "what year" questions`);
  }
  lastDaily = d;
}
if (G.hasDaily(G.DateUK.add(d, 1))) err('schedule', `gap in the schedule on ${d}`);
const dailyAhead = lastDaily ? G.DateUK.diff(today, lastDaily) : -1;
if (dailyAhead < 0) err('inventory', `No Daily DIAL IN puzzle for today (${today}). Players see the holding screen.`);
else if (dailyAhead < THRESHOLDS.dailyFailDays) err('inventory', `Daily puzzles run out on ${lastDaily} (${dailyAhead} days). Add and review questions, then run node scripts/build-content.mjs`);
else if (dailyAhead < THRESHOLDS.dailyWarnDays) warn('inventory', `Daily puzzles run out on ${lastDaily} (${dailyAhead} days)`);

const ffSeen = new Map(); let fd = F.FACT_EPOCH, lastFact = null;
for (; F.factDailyIds(fd); fd = F.DateUK.add(fd, 1)) {
  const day = F.factDailyIds(fd);
  if (day.length !== 7 || new Set(day).size !== 7) err('schedule', `Fact Check ${fd}: needs 7 different claims`);
  for (const id of day) { const f = F.ffactOf(id); if (ffSeen.has(f) && !knownRepeat.has(`${id}@${fd}`)) err('reuse', `Fact Check ${fd}: ${id} repeats a claim used on ${ffSeen.get(f)}`); if (!ffSeen.has(f)) ffSeen.set(f, fd); }
  lastFact = fd;
}
const factAhead = lastFact ? F.DateUK.diff(today, lastFact) : -1;
if (factAhead < 0) err('inventory', `No Fact Check! claims for today (${today}).`);
else if (factAhead < THRESHOLDS.factFailDays) err('inventory', `Fact Check! claims run out on ${lastFact} (${factAhead} days). Add and review new statements in facts.js`);
else if (factAhead < THRESHOLDS.factWarnDays) warn('inventory', `Fact Check! claims run out on ${lastFact} (${factAhead} days)`);
const reserve = Object.values(usage.questions).filter(q => q.status === 'reserve').length;
if (reserve < THRESHOLDS.reserveWarn) warn('inventory', `Only ${reserve} reviewed reserve questions for corrections`);

// ---------------------------------------------------------------- 5. record newly published days (nightly job)
// recorded whenever the published puzzles themselves are sound (a low-inventory error must not stop the record being kept)
if (args.includes('--record-published') && !errors.some(e => /^\[(history|reuse|schedule|sync)\]/.test(e))) {
  for (let x = G.CONFIG.EPOCH; x <= today && G.hasDaily(x); x = G.DateUK.add(x, 1)) hist.daily[x] = hist.daily[x] || G.dailyIds(x);
  for (let x = F.FACT_EPOCH; x <= today && F.factDailyIds(x); x = F.DateUK.add(x, 1)) hist.factCheck[x] = hist.factCheck[x] || F.factDailyIds(x);
  writeFileSync(at('content/published-history.json'), JSON.stringify(hist, null, 1) + '\n');
}

const summary = { today, questions: G.BANK.length, statements: F.FACTS.length, factGroups: groups.factGroups.length, quarantined: Object.keys(groups.quarantine).length,
  dailyThrough: lastDaily, dailyDaysAhead: dailyAhead, factCheckThrough: lastFact, factCheckDaysAhead: factAhead, reserve, errors: errors.length, warnings: warnings.length };
if (args.includes('--json')) console.log(JSON.stringify({ summary, errors, warnings }, null, 1));
else {
  for (const w of warnings) console.log(GH ? `::warning title=Question check::${w}` : `WARNING ${w}`);
  for (const e of errors) console.log(GH ? `::error title=Question check::${e}` : `ERROR ${e}`);
  console.log(`${errors.length ? 'FAILED' : 'OK'}: ${JSON.stringify(summary)}`);
}
process.exit(errors.length ? 1 : 0);
