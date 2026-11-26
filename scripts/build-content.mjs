// Builds the reviewed daily schedules and the question usage record, then writes them into index.html.
//
//   node scripts/build-content.mjs                 extend the schedules (existing scheduled days are kept as they are)
//   node scripts/build-content.mjs --from DATE     start the reviewed schedule on DATE (first run / re-cut before release; DATE must be in the future)
//   node scripts/build-content.mjs --usage-only    refresh content/question-usage.json only (nightly)
//   node scripts/build-content.mjs --check         change nothing; exit 1 if index.html is out of date with content/
//
// Sources of truth (all in content/, none of it deployed):
//   question-groups.json   reviewed fact groups, quarantine, rewording log
//   schedule.json          the reviewed daily lists (Daily DIAL IN and Fact Check!) from their start date
//   question-usage.json    generated: every question's status, publication dates and verification status
//
// Rules: a fact (a question or any of its fact-group siblings) appears in Daily DIAL IN at most once, ever, counting the
// original schedule's puzzles. Days already in schedule.json are never rewritten here (corrections: see docs/content/RUNBOOK.md).
// When the pool runs low the schedule simply stops: it never reuses a fact to fill a day.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadGame, loadFactGame } from './load-game.mjs';
import { analyse, candidates } from './question-audit.mjs';

const ROOT = new URL('..', import.meta.url), at = f => new URL(f, ROOT);
const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i < 0 ? null : (args[i + 1] || true); };
const CHECK = args.includes('--check'), USAGE_ONLY = args.includes('--usage-only');   // --usage-only: refresh question-usage.json, schedule nothing new
export const RULES = { reserve: 35, relatedGapDays: [14, 7, 3, 1], crossModeGapDays: 3, perCategory: 2, perDayYears: 2 };

const groupsFile = JSON.parse(readFileSync(at('content/question-groups.json'), 'utf8'));
const QUALITY = {
  groups: groupsFile.factGroups.map(g => g.filter(x => /^[a-z]+\d+$/.test(x))),
  quarantine: Object.keys(groupsFile.quarantine).sort(),
  fgroups: groupsFile.factCheckGroups.map(g => g.filter(x => /^f\d+$/.test(x))),
  fquarantine: Object.keys(groupsFile.factCheckQuarantine).sort()
};
const schedulePath = at('content/schedule.json');
const sched = existsSync(schedulePath) ? JSON.parse(readFileSync(schedulePath, 'utf8')) : { daily: { from: null, days: [] }, factCheck: { from: null, days: [] } };

// 1. write QUALITY with the current schedules so index.html evaluates, then load the game from it
const html0 = readFileSync(at('index.html'), 'utf8');
const block = s => `/*QUALITY:START*/\nconst QUALITY = ${JSON.stringify(QUALITY)};\n` +
  `const DAILY_V2 = ${JSON.stringify({ from: s.daily.from || '9999-12-31', days: s.daily.days.map(d => d.join(',')).join(';') })};\n` +
  `const FACT_V2 = ${JSON.stringify({ from: s.factCheck.from || '9999-12-31', days: s.factCheck.days.map(d => d.join(',')).join(';') })};\n/*QUALITY:END*/`;
const swap = (html, s) => html.replace(/\/\*QUALITY:START\*\/[\s\S]*?\/\*QUALITY:END\*\//, block(s));
if (!CHECK) writeFileSync(at('index.html'), swap(html0, sched));
const G = loadGame(), F = loadFactGame();
const todayUK = G.DateUK.today();

// 2. decide the start date
let from = flag('--from');
if (from) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('--from takes a date like 2026-11-28');
  if (from <= todayUK) throw new Error(`--from ${from} is not in the future (UK today is ${todayUK}); published days can't change`);
  if (sched.daily.from && from < sched.daily.from) throw new Error('--from can only move the start later');
  // keep any reviewed days before the new start date, drop the rest so they're rebuilt
  if (sched.daily.from) { const keep = G.DateUK.diff(sched.daily.from, from); sched.daily.days = sched.daily.days.slice(0, Math.max(0, keep)); }
  if (sched.factCheck.from) { const keep = G.DateUK.diff(sched.factCheck.from, from); sched.factCheck.days = sched.factCheck.days.slice(0, Math.max(0, keep)); }
  if (!sched.daily.from || !sched.daily.days.length) sched.daily.from = from;
  if (!sched.factCheck.from || !sched.factCheck.days.length) sched.factCheck.from = from;
}
if (!sched.daily.from) throw new Error('First run: pass --from DATE');

// 3. related pairs (same subject, different fact): kept apart in time; group siblings count as the same fact
const A = analyse(), C = candidates(A);
const related = new Map(), rel = (a, b) => { (related.get(a) || related.set(a, new Set()).get(a)).add(b); };
const crossRel = new Map();   // Fact Check statement -> number questions about the same thing
for (const c of C) {
  if (c.kind === 'Q-Q' && G.factOf(c.a) !== G.factOf(c.b)) { rel(c.a, c.b); rel(c.b, c.a); }
  if (c.kind === 'F-F' && F.ffactOf(c.a) !== F.ffactOf(c.b)) { rel(c.a, c.b); rel(c.b, c.a); }
  if (c.kind === 'F-Q') (crossRel.get(c.a) || crossRel.set(c.a, new Set()).get(c.a)).add(c.b);
}
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function hashStr(s){ let h=2166136261; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
const shuffle = (arr, seed) => { const r = mulberry32(hashStr(seed)), a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 4. Daily DIAL IN
const dailyFrom = sched.daily.from, legacyDays = [];
for (let d = G.CONFIG.EPOCH; d < dailyFrom; d = G.DateUK.add(d, 1)) legacyDays.push([d, G.legacyDailyIds(d)]);
const placed = new Map();   // question id -> date it is/was a daily question
legacyDays.forEach(([d, ids]) => ids.forEach(id => { if (!placed.has(id)) placed.set(id, d); }));
sched.daily.days.forEach((ids, i) => ids.forEach(id => placed.set(id, G.DateUK.add(dailyFrom, i))));
const usedFacts = new Set([...placed.keys()].map(G.factOf));
const bankIds = G.BANK.map(q => q.id);
let pool = shuffle(bankIds.filter(id => !G.QUARANTINED.has(id) && !usedFacts.has(G.factOf(id))), 'dialin-reviewed|' + dailyFrom);
{ const seenFact = new Set(); pool = pool.filter(id => { const f = G.factOf(id); if (seenFact.has(f)) return false; seenFact.add(f); return true; }); }
// the replacement reserve is chosen once and kept (so re-running is stable); it's topped up if questions leave it
const kept = (sched.reserve || []).filter(id => pool.includes(id));
const reserve = kept.concat(pool.filter(id => !kept.includes(id)).slice(-(RULES.reserve - kept.length) || pool.length)).slice(0, RULES.reserve);
const avail = pool.filter(id => !reserve.includes(id));
sched.reserve = reserve.slice().sort();
const relaxLog = [];
function fillDay(date, queue, opts) {
  // at most 2 "what year" questions a day, or 3 while the remaining pool is year-heavy (so they're spread out, not stranded at the end)
  const yearShare = queue.filter(id => G.BY_ID.get(id).scoring === 'year').length / queue.length, yearCap = yearShare > RULES.perDayYears / 7 ? RULES.perDayYears + 1 : RULES.perDayYears;
  for (const gap of RULES.relatedGapDays) {
    const day = [], cats = {}; let years = 0;
    for (const id of queue) {
      if (day.length === 7) break;
      const q = G.BY_ID.get(id);
      if ((cats[q.category] || 0) >= RULES.perCategory) continue;
      if (q.scoring === 'year' && years >= yearCap) continue;
      const near = [...(related.get(id) || [])].some(r => day.includes(r) || (placed.has(r) && Math.abs(G.DateUK.diff(placed.get(r), date)) < gap));
      if (near) continue;
      day.push(id); cats[q.category] = (cats[q.category] || 0) + 1; if (q.scoring === 'year') years++;
    }
    if (day.length === 7) { if (gap !== RULES.relatedGapDays[0]) relaxLog.push(`${date}: related questions ${gap} days apart (not ${RULES.relatedGapDays[0]})`); return day; }
  }
  return null;
}
let queue = avail.slice();
for (; !USAGE_ONLY;) {
  const date = G.DateUK.add(dailyFrom, sched.daily.days.length);
  if (queue.length < 7) break;
  const day = fillDay(date, queue);
  if (!day) break;
  day.sort((a, b) => G.BY_ID.get(a).difficulty - G.BY_ID.get(b).difficulty || a.localeCompare(b));
  sched.daily.days.push(day); day.forEach(id => placed.set(id, date));
  queue = queue.filter(id => !day.includes(id));
}

// 5. Fact Check!
const factFrom = sched.factCheck.from, fplaced = new Map();
for (let d = F.FACT_EPOCH; d < factFrom; d = F.DateUK.add(d, 1)) F.legacyFactDailyIds(d).forEach(id => { if (!fplaced.has(id)) fplaced.set(id, d); });
sched.factCheck.days.forEach((ids, i) => ids.forEach(id => fplaced.set(id, F.DateUK.add(factFrom, i))));
const fused = new Set([...fplaced.keys()].map(F.ffactOf));
let fpool = shuffle(F.FACTS.map(f => f.id).filter(id => !QUALITY.fquarantine.includes(id) && !fused.has(F.ffactOf(id))), 'factcheck-reviewed|' + factFrom);
{ const seen = new Set(); fpool = fpool.filter(id => { const f = F.ffactOf(id); if (seen.has(f)) return false; seen.add(f); return true; }); }
const dailyOn = new Map(); sched.daily.days.forEach((ids, i) => ids.forEach(id => dailyOn.set(id, G.DateUK.add(dailyFrom, i))));
legacyDays.forEach(([d, ids]) => ids.forEach(id => { if (!dailyOn.has(id)) dailyOn.set(id, d); }));
let fq = fpool.slice();
for (; !USAGE_ONLY;) {
  const date = F.DateUK.add(factFrom, sched.factCheck.days.length);
  if (fq.length < 7) break;
  const day = [], cats = {}, tf = [0, 0];
  for (const id of fq) {
    if (day.length === 7) break;
    const f = F.FACT_BY_ID.get(id), t = f.truth ? 1 : 0;
    if ((cats[f.category] || 0) >= 2 || tf[t] >= 5) continue;
    if ([...(related.get(id) || [])].some(r => day.includes(r))) continue;
    // never on (or within 3 days of) a day whose number puzzle asks about the same thing
    if ([...(crossRel.get(id) || [])].some(q => dailyOn.has(q) && Math.abs(F.DateUK.diff(dailyOn.get(q), date)) <= RULES.crossModeGapDays)) continue;
    day.push(id); cats[f.category] = (cats[f.category] || 0) + 1; tf[t]++;
  }
  if (day.length < 7 || tf[0] < 2 || tf[1] < 2) break;
  sched.factCheck.days.push(day); fq = fq.filter(id => !day.includes(id));
}

// 6. usage record
const verify = { status: 'editorial-review', date: '2026-11-26', note: 'Checked by an editorial review of the whole bank; not yet checked line by line against the named source' };
const usage = { generated: todayUK, rules: RULES, dailyFrom, factCheckFrom: factFrom, questions: {}, factCheck: {} };
const pubDates = new Map(); legacyDays.forEach(([d, ids]) => ids.forEach(id => (pubDates.get(id) || pubDates.set(id, []).get(id)).push(d)));
const schedDate = new Map(); sched.daily.days.forEach((ids, i) => ids.forEach(id => schedDate.set(id, G.DateUK.add(dailyFrom, i))));
const reserveSet = new Set(reserve), unplaced = new Set(queue);
for (const q of G.BANK) {
  const dates = (pubDates.get(q.id) || []).concat(schedDate.has(q.id) ? [schedDate.get(q.id)] : []);
  const published = dates.filter(d => d <= todayUK), upcoming = dates.filter(d => d > todayUK);
  const status = G.QUARANTINED.has(q.id) ? 'quarantined' : published.length ? 'published' : upcoming.length ? 'scheduled'
    : usedFacts.has(G.factOf(q.id)) || (G.factOf(q.id) !== q.id && placed.has(G.factOf(q.id))) ? 'retired-same-fact' : reserveSet.has(q.id) ? 'reserve' : unplaced.has(q.id) ? 'available' : 'retired-same-fact';
  usage.questions[q.id] = { fact: G.factOf(q.id), category: q.category, difficulty: q.difficulty, answer: q.answer, unit: q.unit, range: q.range, source: q.source,
    status, firstPublished: published[0] || null, publishedDates: published, scheduledDate: upcoming[0] || null,
    quarantineReason: groupsFile.quarantine[q.id] || null, reworded: groupsFile.reworded[q.id] || null, verification: verify };
}
const fpub = new Map(); for (let d = F.FACT_EPOCH; d < factFrom; d = F.DateUK.add(d, 1)) F.legacyFactDailyIds(d).forEach(id => (fpub.get(id) || fpub.set(id, []).get(id)).push(d));
sched.factCheck.days.forEach((ids, i) => ids.forEach(id => (fpub.get(id) || fpub.set(id, []).get(id)).push(F.DateUK.add(factFrom, i))));
for (const f of F.FACTS) {
  const dates = fpub.get(f.id) || [], published = dates.filter(d => d <= todayUK), upcoming = dates.filter(d => d > todayUK);
  usage.factCheck[f.id] = { fact: F.ffactOf(f.id), category: f.category, truth: f.truth, source: f.source,
    status: published.length ? 'published' : upcoming.length ? 'scheduled' : fused.has(F.ffactOf(f.id)) ? 'retired-same-fact' : 'available',
    publishedDates: published, scheduledDate: upcoming[0] || null, verification: verify };
}
const dailyEnd = G.DateUK.add(dailyFrom, sched.daily.days.length - 1), factEnd = F.DateUK.add(factFrom, sched.factCheck.days.length - 1);
usage.inventory = { dailyScheduledThrough: dailyEnd, dailyDaysAhead: G.DateUK.diff(todayUK, dailyEnd), reserveQuestions: reserve.length, unplacedQuestions: queue.length,
  factCheckScheduledThrough: factEnd, factCheckDaysAhead: F.DateUK.diff(todayUK, factEnd), factCheckUnplaced: fq.length, relaxations: relaxLog };

// 7. write (or check)
const html1 = swap(readFileSync(at('index.html'), 'utf8'), sched);
const out = { schedule: JSON.stringify(sched, null, 1) + '\n', usage: JSON.stringify(usage, null, 1) + '\n' };
if (CHECK) {
  const stale = [html1 !== html0 && 'index.html', existsSync(schedulePath) && readFileSync(schedulePath, 'utf8') !== out.schedule && 'content/schedule.json'].filter(Boolean);
  if (stale.length) { console.error('Out of date: ' + stale.join(', ') + '. Run: node scripts/build-content.mjs'); process.exit(1); }
  console.log('content is up to date');
} else {
  writeFileSync(at('index.html'), html1); writeFileSync(schedulePath, out.schedule); writeFileSync(at('content/question-usage.json'), out.usage);
  console.log(JSON.stringify(usage.inventory, null, 1));
}
