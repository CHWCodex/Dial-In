// DIAL IN unit tests: critical game logic, read straight out of index.html so they always test the real code.
// Run: node --test tests/          (no browser, no network, no database)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadGame } from '../scripts/load-game.mjs';

const G = loadGame();
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const at = iso => Date.parse(iso);

// ---------------------------------------------------------------- daily reset (UK time, both clock changes)
test('the daily puzzle changes at midnight UK time, in winter (GMT)', () => {
  assert.equal(G.DateUK.today(at('2026-11-26T23:59:59Z')), '2026-11-26');
  assert.equal(G.DateUK.today(at('2026-11-27T00:00:00Z')), '2026-11-27');
});
test('…and in summer (BST, an hour earlier in UTC)', () => {
  assert.equal(G.DateUK.today(at('2026-06-15T22:59:59Z')), '2026-06-15');
  assert.equal(G.DateUK.today(at('2026-06-15T23:00:00Z')), '2026-06-16');
});
test('…and on the nights the clocks change', () => {
  // spring forward: 29 March 2026, 01:00 GMT → 02:00 BST
  assert.equal(G.DateUK.today(at('2026-03-28T23:59:59Z')), '2026-03-28');
  assert.equal(G.DateUK.today(at('2026-03-29T00:00:00Z')), '2026-03-29');
  assert.equal(G.DateUK.today(at('2026-03-29T22:59:59Z')), '2026-03-29');
  assert.equal(G.DateUK.today(at('2026-03-29T23:00:00Z')), '2026-03-30');
  // fall back: 25 October 2026, 02:00 BST → 01:00 GMT
  assert.equal(G.DateUK.today(at('2026-10-24T22:59:59Z')), '2026-10-24');
  assert.equal(G.DateUK.today(at('2026-10-24T23:00:00Z')), '2026-10-25');
  assert.equal(G.DateUK.today(at('2026-10-25T23:59:59Z')), '2026-10-25');
  assert.equal(G.DateUK.today(at('2026-10-26T00:00:00Z')), '2026-10-26');
});
test('the "next puzzle in" countdown targets the real UK midnight', () => {
  assert.equal(new Date(G.DateUK.nextMidnight(at('2026-03-28T12:00:00Z'))).toISOString(), '2026-03-29T00:00:00.000Z');
  assert.equal(new Date(G.DateUK.nextMidnight(at('2026-03-29T12:00:00Z'))).toISOString(), '2026-03-29T23:00:00.000Z');
  assert.equal(new Date(G.DateUK.nextMidnight(at('2026-10-25T12:00:00Z'))).toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(new Date(G.DateUK.nextMidnight(at('2026-07-01T12:00:00Z'))).toISOString(), '2026-07-01T23:00:00.000Z');
});
test('players abroad get the UK puzzle whatever their device time zone', () => {
  for (const tz of ['America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney', 'UTC']) {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'short' });   // the device's own idea of the date differs…
    assert.ok(fmt.format(new Date(at('2026-11-26T23:30:00Z'))));
    assert.equal(G.DateUK.today(at('2026-11-26T23:30:00Z')), '2026-11-26');              // …but the puzzle date is the UK one
  }
});
test('puzzle numbers count from the launch day', () => {
  assert.equal(G.DateUK.puzzleNo(G.CONFIG.EPOCH), 1);
  assert.equal(G.DateUK.puzzleNo('2026-11-25'), 31);
  assert.equal(G.DateUK.puzzleNo('2026-11-26'), 32);
});

// ---------------------------------------------------------------- the daily schedule
test('each day has 7 different, real questions, the same for everyone', () => {
  for (let k = 0; k < 400; k++) {
    const d = G.DateUK.add('2026-10-26', k), ids = G.dailyIds(d);
    assert.equal(ids.length, 7, d);
    assert.equal(new Set(ids).size, 7, d);
    for (const id of ids) assert.ok(G.BY_ID.has(id), `${d}: ${id}`);
    assert.deepEqual(G.dailyIds(d), ids, 'deterministic');
  }
});
test('the schedule matches the puzzles stored on the server (spot checks from the database)', () => {
  assert.deepEqual([...G.dailyIds('2026-11-25')], ['c04','tv04','an13','c36','c46','s50','x173']);
  assert.deepEqual([...G.dailyIds('2026-11-26')], ['u41','fd07','x304','x231','x073','b10','x177']);
});
test('no question repeats across 60 consecutive days', () => {
  const seen = new Map();
  for (let k = 0; k < 60; k++) { const d = G.DateUK.add('2026-11-01', k); for (const id of G.dailyIds(d)) { assert.ok(!seen.has(id), `${id} on ${seen.get(id)} and ${d}`); seen.set(id, d); } }
});

// ---------------------------------------------------------------- scoring (same bands as the server's score_guess)
const q = (answer, scoring, range) => ({ answer, scoring, range });
test('percentage questions: bands at 1, 5, 10, 20 and 35 % off', () => {
  const P = g => G.Scoring.points(q(1000, 'pct'), g);
  assert.deepEqual([1000, 1010, 1050, 1100, 1200, 1350, 1351, 990, 650, 649].map(P), [1000, 900, 750, 600, 400, 200, 0, 900, 200, 0]);
});
test('year questions: bands at 1, 3, 5, 10 and 25 years off', () => {
  const P = g => G.Scoring.points(q(1966, 'year'), g);
  assert.deepEqual([1966, 1967, 1969, 1971, 1976, 1991, 1992, 1941, 1940].map(P), [1000, 900, 750, 600, 400, 200, 0, 200, 0]);
});
test('small-count questions: 1, 2 or 3 off', () => {
  const P = g => G.Scoring.points(q(7, 'abs'), g);
  assert.deepEqual([7, 6, 8, 5, 10, 11].map(P), [1000, 600, 600, 400, 200, 0]);
});
test('a range answer counts as exact anywhere inside it', () => {
  const R = g => G.Scoring.points(q(220, 'pct', [210, 220]), g);
  assert.deepEqual([210, 215, 220, 209, 222].map(R), [1000, 1000, 1000, 750, 900]);   // 209 is 5% below 220; 222 is 0.9% above
});
test('a zero answer is scored by units, not percent', () => {
  assert.equal(G.Scoring.points(q(0, 'pct'), 0), 1000);
  assert.equal(G.Scoring.points(q(0, 'pct'), 1), 600);
});
test('empty, negative or nonsense guesses score 0', () => {
  for (const g of [null, undefined, NaN, Infinity, -1, '5']) assert.equal(G.Scoring.points(q(10, 'pct'), g), 0, String(g));
});
test('huge guesses are safe and score 0', () => {
  assert.equal(G.Scoring.points(q(763, 'pct'), 1e15), 0);
  assert.equal(G.Scoring.points(q(3040, 'pct', [3000, 3040]), 999999999), 0);
});
test('every question in the bank has an answer the scoring can reach exactly', () => {
  for (const x of G.BANK) assert.equal(G.Scoring.points(x, x.answer), 1000, x.id);
});

// ---------------------------------------------------------------- name filter (same lists as the server's name_ok)
function nameOk() {
  const a = html.indexOf('const NAME_BLOCK'), b = html.indexOf('const NAME_NOT_OK');
  const ctx = {}; vm.runInNewContext(html.slice(a, b).replace('const NAME_BLOCK', 'var NAME_BLOCK') + ';this.nameOk = nameOk;', ctx);
  return ctx.nameOk;
}
test('name filter blocks offensive names, including disguised and joined-up ones', () => {
  const ok = nameOk();
  for (const n of ['CockMuncher', 'c0ckmunch3r', 'N i 9 9 a', 'fuuuck', 'f.ck', '5hit', 'BigDickEnergy', 'SexyBoy', 'Bellend', 'Jew', 'KYS']) assert.equal(ok(n), false, n);
});
test('…and lets real names through', () => {
  const ok = nameOk();
  for (const n of ['Nigel', 'Sheila', 'Hancock', 'Dickens', 'Essex', 'Sussex', 'Cumbria', 'Cassie', 'Pakistan', 'Titan', 'Yoshitaka', 'Mighty Puffin 69']) assert.equal(ok(n), true, n);
});
