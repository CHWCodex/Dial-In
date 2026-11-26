// Number entry and scoring: property-based and fuzz tests (thousands of generated cases per run, fixed seed so failures reproduce).
// Run: node --test tests/input.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../scripts/load-game.mjs';

const G = loadGame(), { Entry, parseAnswer, Scoring, CONFIG } = G;
let seed = 20261126; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = a => a[Math.floor(rnd() * a.length)];
const POINTS = new Set([0, 200, 400, 600, 750, 900, 1000]);

// ---------------------------------------------------------------- the on-screen keypad (what players actually type with)
const KEYS = ['0','1','2','3','4','5','6','7','8','9','.','back','clear','-','e','E','+',',',' ','٣','５','−','1e5','NaN','Infinity','🙂','\u0000','..','00'];
test('keypad: any sequence of 20,000 random key presses only ever builds a valid number', () => {
  for (let run = 0; run < 400; run++) {
    let buf = '';
    for (let i = 0; i < 50; i++) {
      buf = Entry.press(buf, pick(KEYS));
      assert.match(buf, /^(\d+(\.\d*)?)?$/, `bad buffer "${buf}"`);
      const [int, dec = ''] = buf.split('.');
      assert.ok(int.length <= CONFIG.MAX_DIGITS, 'too many digits');
      assert.ok(dec.length <= CONFIG.MAX_DECIMALS, 'too many decimals');
      assert.ok(!/^0\d/.test(buf), `leading zero kept: ${buf}`);
      const v = Entry.value(buf);
      assert.ok(v === null || (Number.isFinite(v) && v >= 0), `value ${v} from "${buf}"`);
      assert.equal(typeof Entry.display(buf, false), 'string');
    }
  }
});
test('keypad: specific edge cases', () => {
  const type = keys => keys.reduce((b, k) => Entry.press(b, k), '');
  assert.equal(type(['.', '5']), '0.5', 'a leading decimal point becomes 0.');
  assert.equal(type(['0', '0', '7']), '7', 'leading zeros are dropped');
  assert.equal(type(['1', '.', '.', '2']), '1.2', 'a second decimal point is ignored');
  assert.equal(type(['1', '.', '2', '3', '4', '5']), '1.234', 'at most 3 decimals');
  assert.equal(Entry.value('12.'), 12, 'a trailing decimal point is fine');
  assert.equal(Entry.value(''), null, 'empty is no answer, not zero');
  assert.equal(Entry.value('0'), 0, 'zero is a real answer');
  assert.equal(type(['-', '5']), '5', 'no minus key: answers are never negative');
  assert.equal(type(Array(30).fill('9')).length, CONFIG.MAX_DIGITS, 'digit cap');
  assert.equal(Entry.display('1234567.5', false), '1,234,567.5');
  assert.equal(Entry.display('1999', true), '1999', 'years are not grouped');
  assert.equal(type(['5', 'back', 'back', 'back']), '', 'backspace past empty is safe');
});

// ---------------------------------------------------------------- typed or pasted text (hardware keyboards, paste, restore codes)
test('pasted text: every hostile input is rejected or parsed safely, never throws', () => {
  const cases = ['', ' ', '\t\n', '0', '00012', '12.', '.5', '1,234', '1,23', '12,3456', '1,234.5', '12.34.5', '--5', '-5', '−5', '+5', '1e5', '1E-3', 'NaN', 'Infinity', '-Infinity',
    '0x1A', '٣٤', '１２', '1 000', "1'000", '1_000', '12abc', 'abc', '🙂', '<script>', '1;drop table', '9'.repeat(400), '1e309', '9999999999999999', '0.0000001', null, undefined, {}, [], 12];
  for (const raw of cases) {
    let r; assert.doesNotThrow(() => { r = parseAnswer(raw); }, String(raw));
    assert.equal(typeof r.ok, 'boolean');
    if (r.ok) assert.ok(Number.isFinite(r.v) && r.v >= 0 && r.v <= 1e15, `${JSON.stringify(raw)} -> ${r.v}`);
    else assert.ok(typeof r.msg === 'string' && r.msg.length > 5 && !/undefined|NaN|Error/.test(r.msg), r.msg);
  }
  assert.equal(JSON.stringify(parseAnswer('10,080')), JSON.stringify({ ok: true, v: 10080 }));
  assert.equal(JSON.stringify(parseAnswer(' 1 000 ')), JSON.stringify({ ok: true, v: 1000 }));
  assert.equal(parseAnswer('-5').ok, false, 'negatives are refused (every answer is ≥ 0)');
  assert.equal(parseAnswer('1e5').ok, false, 'scientific notation is refused with a clear message');
  assert.equal(parseAnswer('12.34.5').ok, false);
  assert.equal(parseAnswer('1,23').ok, false, 'commas only between groups of three');
});
test('pasted text: 5,000 random strings never throw and never yield a bad number', () => {
  const alphabet = '0123456789.,-+eE xX_\'٣５−🙂abc ';
  for (let i = 0; i < 5000; i++) {
    const s = Array.from({ length: 1 + Math.floor(rnd() * 14) }, () => pick([...alphabet])).join('');
    const r = parseAnswer(s);
    if (r.ok) assert.ok(Number.isFinite(r.v) && r.v >= 0 && r.v <= 1e15, `${s} -> ${r.v}`);
  }
});

// ---------------------------------------------------------------- scoring (the established formula; unchanged)
const Q = (answer, scoring, range = null) => ({ answer, scoring, range });
test('scoring: impossible guesses score 0 and never throw', () => {
  for (const g of [NaN, Infinity, -Infinity, -1, -0.0001, null, undefined, '5', {}, [], 1e308]) for (const s of ['pct', 'year', 'abs'])
    assert.equal(Scoring.points(Q(100, s), g), g === 1e308 ? 0 : 0, `${s} ${g}`);
});
test('scoring: every result is one of the published point values', () => {
  for (let i = 0; i < 20000; i++) {
    const s = pick(['pct', 'year', 'abs']), a = s === 'year' ? 1000 + Math.floor(rnd() * 1026) : pick([0, 0.5, 1, 7, 42, 365, 8849, 1e6, 8.2e9]) * (s === 'abs' ? 1 : 1 + rnd());
    const g = rnd() < 0.1 ? a : Math.max(0, a + (rnd() - 0.5) * a * pick([0.001, 0.02, 0.1, 0.5, 3]) + (rnd() - 0.5) * pick([0, 1, 5, 40]));
    assert.ok(POINTS.has(Scoring.points(Q(a, s), g)), `${s} answer ${a} guess ${g}`);
  }
});
test('scoring: a closer guess never scores fewer points (monotonic), on both sides of the answer', () => {
  for (let i = 0; i < 4000; i++) {
    const s = pick(['pct', 'year', 'abs']), a = s === 'year' ? 1500 + Math.floor(rnd() * 500) : s === 'abs' ? Math.floor(rnd() * 12) : 1 + rnd() * 10000;
    const d1 = rnd() * (s === 'pct' ? a : 40), d2 = d1 * rnd(), side = rnd() < 0.5 ? -1 : 1;
    const far = Math.max(0, a + side * d1), near = Math.max(0, a + side * d2);
    assert.ok(Scoring.points(Q(a, s), near) >= Scoring.points(Q(a, s), far), `${s} a=${a} near=${near} far=${far}`);
  }
});
test('scoring: exact boundaries (floating point can\'t knock a boundary guess down a band)', () => {
  const P = (a, g, s = 'pct') => Scoring.points(Q(a, s), g);
  assert.equal(P(1000, 1000), 1000);
  for (const [pct, pts] of [[1, 900], [5, 750], [10, 600], [20, 400], [35, 200]]) {
    for (const a of [3, 7, 0.3, 123.45, 8849, 1e9]) {
      assert.equal(P(a, a * (1 + pct / 100)), pts, `${a} +${pct}%`);
      assert.equal(P(a, a * (1 - pct / 100)), pts, `${a} -${pct}%`);
    }
  }
  assert.equal(P(0.1 + 0.2, 0.3), 1000, '0.1 + 0.2 still counts as exact');
  assert.equal(P(1000, 1350.0001), 0, 'just past the last band');
  for (const [off, pts] of [[1, 900], [3, 750], [5, 600], [10, 400], [25, 200], [26, 0]]) assert.equal(P(1966, 1966 + off, 'year'), pts, `year +${off}`);
  for (const [off, pts] of [[1, 600], [2, 400], [3, 200], [4, 0]]) assert.equal(P(6, 6 - off, 'abs'), pts, `abs -${off}`);
  assert.equal(P(0, 0), 1000, 'zero answer, zero guess');
  assert.equal(P(0, 1), 600, 'zero answers fall back to units-off scoring');
  assert.equal(Scoring.points(Q(37, 'pct', [36.5, 37.5]), 36.5), 1000, 'range is inclusive');
  assert.equal(Scoring.points(Q(37, 'pct', [36.5, 37.5]), 37.5), 1000);
  assert.equal(Scoring.points(Q(37, 'pct', [36.5, 37.5]), 36.7), 1000, 'inside the range');
  assert.equal(Scoring.points(Q(37, 'pct', [36.5, 37.5]), 38), 750, 'outside the range scores against the answer (2.7% off)');
  assert.equal(Scoring.points(Q(37, 'pct', [36.5, 37.5]), 36.4), 750, '1.6% off');
});
test('scoring: no bank question can produce an unexpected score for any guess', () => {
  for (const q of G.BANK) for (const g of [0, q.answer, q.answer * 1.0099, q.answer * 0.6, q.answer * 10, 1e15, q.range ? q.range[0] : q.answer])
    assert.ok(POINTS.has(Scoring.points(q, g)), `${q.id} ${g}`);
});
test('range hints never give the answer away and always contain it', () => {
  for (const q of G.BANK) {
    const h = G.rangeHint(q); if (!h) continue;
    assert.ok(h[0] <= q.answer && q.answer <= h[1], `${q.id}: hint ${h} must contain ${q.answer}`);
    assert.ok(h[0] < h[1], q.id);
    if (q.scoring !== 'year') assert.ok(Math.abs((h[0] + h[1]) / 2 - q.answer) / q.answer > 0.05 || h[1] / h[0] > 2, `${q.id}: hint centred on the answer`);
  }
});
