// Question integrity: duplicate detection, the reviewed schedule, history protection and inventory monitoring.
// Run: node --test tests/content.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadGame, loadFactGame } from '../scripts/load-game.mjs';
import { tokens, entities, normText, fingerprint, sameQuantity, candidates } from '../scripts/question-audit.mjs';

const G = loadGame(), F = loadFactGame();
const ROOT = new URL('..', import.meta.url).pathname;
const groups = JSON.parse(readFileSync(new URL('../content/question-groups.json', import.meta.url), 'utf8'));

// a tiny synthetic bank run through the same detector the validator uses
const mk = (id, question, answer, unit = '') => ({ id, question, answer, unit, toks: tokens(question), ents: entities(question), fp: fingerprint(question), norm: normText(question) });
const pairsOf = (qs, fx = []) => new Set(candidates({ Q: qs, FX: fx.map(f => ({ ...f, toks: tokens(f.statement), ents: entities(f.statement), tmpl: normText(f.statement).replace(/\d[\d.,]*/g, '#') })) }).map(c => [c.a, c.b].sort().join('|')));

test('the four Mount Everest questions are all recognised as the same fact', () => {
  const qs = [mk('e1', 'How tall is Mount Everest in metres?', 8849, 'metres'), mk('e2', 'What is the height of Mount Everest?', 8849, 'metres'),
    mk('e3', 'How many metres above sea level is Mount Everest?', 8849, 'metres'), mk('e4', 'How tall is Mount Everest in feet?', 29032, 'feet')];
  const P = pairsOf(qs);
  for (const [a, b] of [['e1', 'e2'], ['e1', 'e3'], ['e1', 'e4'], ['e2', 'e3'], ['e2', 'e4'], ['e3', 'e4']]) assert.ok(P.has(`${a}|${b}`), `${a} and ${b} should be flagged`);
});
test('punctuation, capitals, curly quotes and accents don\'t hide a duplicate', () => {
  assert.equal(normText('In what year did ‘The Hobbit’ come out?'), normText("in what year did 'the hobbit' come out"));
  assert.equal(normText('How many Pokémon were in the original Pokédex?'), normText('How many POKEMON were in the original pokedex'));
  const P = pairsOf([mk('a', 'How many legs does a spider have?', 8), mk('b', 'How many legs, does a SPIDER have!', 8)]);
  assert.ok(P.has('a|b'));
});
test('unit changes are caught: the same quantity in different units counts as the same answer', () => {
  assert.ok(sameQuantity(8849, 29032));     // m and ft
  assert.ok(sameQuantity(42.195, 26.2));    // km and miles
  assert.ok(sameQuantity(100, 212));        // °C and °F
  assert.ok(sameQuantity(5, 11.02));        // kg and lb
  assert.ok(!sameQuantity(8849, 6190));
  const P = pairsOf([mk('m', 'How long is a marathon, in miles?', 26.2, 'miles'), mk('k', 'How long is a marathon, in kilometres?', 42.195, 'km')]);
  assert.ok(P.has('k|m'));
});
test('reversed sentence structure is caught', () => {
  const P = pairsOf([mk('a', 'In what year did the Titanic sink?', 1912, 'year'), mk('b', 'The Titanic sank in which year?', 1912, 'year')]);
  assert.ok(P.has('a|b'));
});
test('Fact Check: a claim flipped from true to false with a different number is the same claim', () => {
  const P = pairsOf([], [{ id: 'f1', statement: 'Henry VIII had six wives.', truth: true, explanation: '' }, { id: 'f2', statement: 'Henry VIII had 8 wives.', truth: false, explanation: '' },
    { id: 'f3', statement: 'The Battle of Hastings was in 1066.', truth: true, explanation: '' }, { id: 'f4', statement: 'The Battle of Hastings was in 1166.', truth: false, explanation: '' }]);
  assert.ok(P.has('f3|f4'), 'number swapped');
  assert.ok(P.has('f1|f2'), 'word number vs digit');
});
test('genuinely different questions about the same subject stay eligible (flagged at most as related, never merged)', () => {
  // the reviewed bank: these pairs share a subject but test different facts, and are NOT in a fact group
  const groupOf = new Map(); groups.factGroups.forEach(g => g.filter(x => /^[a-z]+\d+$/.test(x)).forEach(x => groupOf.set(x, g[0])));
  for (const [a, b] of [['h28', 'x263'], ['h07', 'h28'], ['c41', 'c42'], ['mu10', 'mu18'], ['h23', 'h24'], ['s63', 's64'], ['lm14', 'lm15']]) {
    assert.ok(G.BY_ID.has(a) && G.BY_ID.has(b));
    assert.ok(!(groupOf.has(a) && groupOf.get(a) === groupOf.get(b)), `${a} and ${b} are different facts`);
  }
  // and the schedule uses both members of such pairs (on different days)
  const used = new Set(); for (let d = '2026-10-26'; G.hasDaily(d); d = G.DateUK.add(d, 1)) G.dailyIds(d).forEach(id => used.add(id));
  assert.ok(used.has('c41') && used.has('c42'), 'Friends seasons and episodes are both used');
});
test('distinct questions with no shared subject are not flagged', () => {
  const P = pairsOf([mk('a', 'How many keys are on a standard piano?', 88), mk('b', 'How many bones are in the human body?', 206), mk('c', 'In what year did the Titanic sink?', 1912, 'year')]);
  assert.equal(P.size, 0);
});

// ---------------------------------------------------------------- the reviewed bank and schedule
test('every fact group and quarantine entry names a real question', () => {
  for (const g of groups.factGroups) for (const id of g.filter(x => /^[a-z]+\d+$/.test(x))) assert.ok(G.BY_ID.has(id), id);
  for (const id of Object.keys(groups.quarantine)) assert.ok(G.BY_ID.has(id), id);
});
test('the original schedule is untouched: all 1,100 stored days still match the database exactly', () => {
  const parts = []; for (let d = '2026-10-26'; d <= '2029-10-29'; d = G.DateUK.add(d, 1)) parts.push(d + ':' + G.legacyDailyIds(d).join(','));
  // md5 of the same string computed in the live database (daily_sets) on 26 Nov 2026
  assert.equal(createHash('md5').update(parts.join(';')).digest('hex'), 'f46e68f1eaacc998ec1b4cd37ccaa867');
});
test('no fact is ever used twice in Daily DIAL IN from the reviewed start date on', () => {
  const seen = new Map();
  for (let d = '2026-10-26'; G.hasDaily(d); d = G.DateUK.add(d, 1)) for (const id of G.dailyIds(d)) {
    const f = G.factOf(id);
    if (d >= G.DAILY_V2.from) assert.ok(!seen.has(f), `${d}: ${id} (fact ${f}) already used on ${seen.get(f)}`);
    if (!seen.has(f)) seen.set(f, d);
  }
});
test('quarantined questions are never scheduled, nor served in Unlimited or Battles', () => {
  for (let d = G.DAILY_V2.from; G.hasDaily(d); d = G.DateUK.add(d, 1)) for (const id of G.dailyIds(d)) assert.ok(!G.QUARANTINED.has(id), `${d}: ${id}`);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const PLAY_POOL = BANK\.filter\(q => !QUARANTINED\.has\(q\.id\) && factOf\(q\.id\) === q\.id\)/);
});
test('Fact Check: no claim (or its twin) is reused, and the original Fact Check days are unchanged', () => {
  const seen = new Map();
  for (let d = F.FACT_EPOCH; F.factDailyIds(d); d = F.DateUK.add(d, 1)) for (const id of F.factDailyIds(d)) {
    const f = F.ffactOf(id); assert.ok(!seen.has(f), `${d}: ${id} already used on ${seen.get(f)}`); seen.set(f, d);
  }
  for (let d = F.FACT_EPOCH; d < F.FACT_V2.from; d = F.DateUK.add(d, 1)) assert.deepEqual(F.factDailyIds(d), F.legacyFactDailyIds(d));
});
test('Fact Check never covers the same thing as that day\'s number puzzle (±3 days)', () => {
  const qs = G.BANK.map(q => mk(q.id, q.question, q.answer, q.unit)), on = new Map();
  for (let d = G.DAILY_V2.from; G.hasDaily(d); d = G.DateUK.add(d, 1)) G.dailyIds(d).forEach(id => on.set(id, d));
  const fx = F.FACTS.map(f => ({ ...f, toks: tokens(f.statement), ents: entities(f.statement), tmpl: '' }));
  const cross = candidates({ Q: qs, FX: fx }).filter(c => c.kind === 'F-Q');
  for (let d = F.FACT_V2.from; F.factDailyIds(d); d = F.DateUK.add(d, 1)) for (const id of F.factDailyIds(d))
    for (const c of cross.filter(c => c.a === id)) if (on.has(c.b)) assert.ok(Math.abs(G.DateUK.diff(on.get(c.b), d)) > 3, `${id} on ${d} vs ${c.b} on ${on.get(c.b)}`);
});
test('past the end of the reviewed list there is no puzzle (the game shows a holding screen, never a repeat)', () => {
  let d = G.DAILY_V2.from; while (G.hasDaily(d)) d = G.DateUK.add(d, 1);
  assert.equal(G.dailyIds(d), null);
  assert.equal(G.dailyIds(G.DateUK.add(d, 400)), null);
});

// ---------------------------------------------------------------- monitoring: simulated days (isolated: nothing is published)
const validate = today => { try { return { code: 0, out: execFileSync(process.execPath, ['scripts/validate-questions.mjs', '--json'], { cwd: ROOT, env: { ...process.env, DIALIN_TODAY: today }, stdio: 'pipe' }).toString() }; }
  catch (e) { return { code: e.status, out: e.stdout.toString() }; } };
test('simulated daily resets: validation passes today and fails loudly as content runs low', () => {
  let last = G.DAILY_V2.from; while (G.hasDaily(G.DateUK.add(last, 1))) last = G.DateUK.add(last, 1);
  const ok = validate('2026-11-26'); assert.equal(ok.code, 0, ok.out);
  let fEnd = F.FACT_V2.from; while (F.factDailyIds(F.DateUK.add(fEnd, 1))) fEnd = F.DateUK.add(fEnd, 1);
  const lowFact = validate(F.DateUK.add(fEnd, -3)); assert.equal(lowFact.code, 1); assert.match(lowFact.out, /Fact Check! claims run out/);
  const low = JSON.parse(validate(G.DateUK.add(last, -10)).out); assert.ok(low.errors.some(e => /Daily puzzles run out/.test(e)), JSON.stringify(low.errors));
  const none = JSON.parse(validate(G.DateUK.add(last, 1)).out); assert.ok(none.errors.some(e => /No Daily DIAL IN puzzle for today/.test(e)));
});
