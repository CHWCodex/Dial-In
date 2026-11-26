// Question integrity tooling: normalisation, fingerprints, semantic-duplicate candidates and history.
// Used by scripts/validate-questions.mjs (CI) and run directly for a full audit report:
//   node scripts/question-audit.mjs [--candidates]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadGame } from './load-game.mjs';

export function loadFacts(root = new URL('..', import.meta.url)) {
  const ctx = { window: {} }; vm.runInNewContext(readFileSync(new URL('facts.js', root), 'utf8'), ctx);
  return ctx.window.DIAL_IN_FACTS.map(([id, category, statement, truth, explanation, source]) => ({ id, category, statement, truth, explanation, source }));
}

const STOP = new Set(('a an the of in on at to for by with from and or is was were are be been it its this that these those how many much what which who whom whose ' +
  'did does do has have had there their they he she his her about roughly approximately around approx nearly almost exactly total number ' +
  'average typical usually normally standard per one as than into over under when where why year years old first ever world worlds ' +
  'can could would will would s t').split(/\s+/));
// unit words are dropped so "in metres" and "in feet" don't make two questions look different
const UNITS = new Set(('metre metres meter meters m km kilometre kilometres kilometer kilometers mile miles mi foot feet ft inch inches in cm ' +
  'centimetre centimetres mm millimetre millimetres yard yards kg kilogram kilograms kilo kilos gram grams g tonne tonnes ton tons pound pounds lb lbs ' +
  'ounce ounces oz litre litres liter liters ml pint pints gallon gallons mph kmh km/h kph knots celsius fahrenheit degree degrees °c °f percent per cent % ' +
  'second seconds minute minutes hour hours day days week weeks month months decade decades century centuries square cubic sq').split(/\s+/));
const SYN = { tall:'height', high:'height', height:'height', heights:'height', elevation:'height', summit:'height', altitude:'height', sea:'height', level:'',
  long:'length', length:'length', lengths:'length', wide:'width', width:'width', deep:'depth', depth:'depth', heavy:'weight', weigh:'weight', weighs:'weight', weight:'weight',
  born:'born', birth:'born', died:'died', death:'died', die:'died', populat:'population', people:'population', inhabitant:'population', live:'population', lives:'population',
  fast:'speed', speed:'speed', quick:'speed', top:'speed', old:'age', age:'age', aged:'age', founded:'founded', establish:'founded', opened:'founded', open:'founded', built:'built', completed:'built' };
const stem = w => w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') : w;

export function normText(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/[^a-z0-9%°'\s-]/g, ' ').replace(/'s\b/g, '').replace(/'/g, '').replace(/\s+/g, ' ').trim();
}
export function tokens(s) {
  const out = new Set(), words = normText(s).split(/[\s-]+/);
  // a conversion question ("how many feet in a mile") is ABOUT its units, so keep them; otherwise a unit is just the answer format
  const keepUnits = words.filter(w => UNITS.has(w)).length >= 2 && !/\b(in|to)\s+(metres|feet|miles|kilometres|km|kg|seconds|minutes|hours|days|years|degrees|mph|km\/h)\s*\??$/.test(normText(s));
  for (let w of words) {
    if (!w || STOP.has(w) || (!keepUnits && UNITS.has(w)) || /^\d+$/.test(w)) continue;
    if (w in SYN) { if (SYN[w]) out.add(SYN[w]); continue; }
    w = stem(w); if (w in SYN) { if (SYN[w]) out.add(SYN[w]); continue; }
    if (w.length > 1) out.add(w);
  }
  return out;
}
// Proper names (capitalised runs that aren't the first word of the sentence), e.g. "Mount Everest", "Pink Floyd"
export function entities(s) {
  const out = new Set(), words = String(s).replace(/[’‘]/g, "'").split(/\s+/);
  let run = [];
  const flush = () => { if (run.length) { const e = run.join(' ').replace(/'s$/, '').toLowerCase(); if (!/^(in|what|how|the|which|who|roughly|about|a|an|true|false|on|at|by)$/.test(e)) out.add(e.replace(/^the /, '')); } run = []; };
  words.forEach((w, i) => { const c = w.replace(/^[^\w]+|[^\w']+$/g, ''); if (i > 0 && /^[A-Z][\w'.-]*$/.test(c) && !/^(I|In|What|How|The|Which|UK|US|USA)$/.test(c)) run.push(c); else if (run.length && /^(of|the|de|da|von|and)$/.test(c)) run.push(c); else flush(); });
  flush();
  for (const e of [...out]) { const t = e.replace(/ (of|the|de|da|von|and)$/, ''); if (t !== e) { out.delete(e); out.add(t); } }
  return out;
}
export const fingerprint = s => [...tokens(s)].sort().join(' ');
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
// two numbers the same quantity in different units? (m↔ft, km↔mi, kg↔lb, °C↔°F, l↔pint, cm↔in)
const RATIOS = [1, 3.28084, 1.60934, 2.20462, 1.75975, 2.54, 1000, 0.001, 100, 0.01, 1.852, 0.621371, 0.3048, 0.453592];
export function sameQuantity(a, b) {
  if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return a === b;
  for (const r of RATIOS) for (const [x, y] of [[a, b], [b, a]]) if (Math.abs(x * r - y) / y < 0.02) return true;
  if (Math.abs((a * 9) / 5 + 32 - b) < 1.5 || Math.abs((b * 9) / 5 + 32 - a) < 1.5) return true;
  return false;
}
const nums = s => (String(s).replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) || []).map(Number);

export function analyse() {
  const G = loadGame(), F = loadFacts();
  const Q = G.BANK.map(q => ({ ...q, toks: tokens(q.question), ents: entities(q.question), fp: fingerprint(q.question), norm: normText(q.question) }));
  const FX = F.map(f => ({ ...f, toks: tokens(f.statement), ents: entities(f.statement), tmpl: normText(f.statement).replace(/\d[\d.,]*/g, '#') }));
  return { G, Q, FX };
}

// Candidate pairs that may test the same fact. Scored; the reviewed decisions live in content/question-groups.json.
export function candidates({ Q, FX }) {
  const out = [];
  const shareEnt = (a, b) => [...a.ents].filter(e => b.ents.has(e) || [...b.ents].some(f => f.includes(e) || e.includes(f)));
  for (let i = 0; i < Q.length; i++) for (let j = i + 1; j < Q.length; j++) {
    const a = Q[i], b = Q[j], J = jac(a.toks, b.toks), E = shareEnt(a, b);
    const sameAns = a.answer === b.answer || (a.unit !== 'year' && b.unit !== 'year' && sameQuantity(a.answer, b.answer));
    let why = null;
    if (a.norm === b.norm) why = 'identical text';
    else if (a.fp && a.fp === b.fp && a.toks.size >= 2) why = 'same words (fingerprint)';
    else if (J >= 0.6) why = `wording ${Math.round(J * 100)}% alike`;
    else if (E.length && J >= 0.3) why = `same subject (${E[0]}) and ${Math.round(J * 100)}% alike`;
    else if (E.length && sameAns && J >= 0.15) why = `same subject (${E[0]}) and same answer`;
    if (why) out.push({ kind: 'Q-Q', a: a.id, b: b.id, why, score: J + (E.length ? 0.3 : 0) + (sameAns ? 0.2 : 0) });
  }
  for (let i = 0; i < FX.length; i++) for (let j = i + 1; j < FX.length; j++) {
    const a = FX[i], b = FX[j], J = jac(a.toks, b.toks), E = shareEnt(a, b);
    let why = null;
    if (a.tmpl === b.tmpl) why = 'same claim with a different number';
    else if (J >= 0.55) why = `wording ${Math.round(J * 100)}% alike`;
    else if (E.length && J >= 0.3) why = `same subject (${E[0]}) and ${Math.round(J * 100)}% alike`;
    if (why) out.push({ kind: 'F-F', a: a.id, b: b.id, why, score: J + (E.length ? 0.3 : 0) });
  }
  for (const f of FX) for (const q of Q) {
    const J = jac(f.toks, q.toks), E = shareEnt(f, q);
    const fn = [...nums(f.statement), ...nums(f.explanation)];
    const hit = fn.some(n => n === q.answer || (q.unit !== 'year' && sameQuantity(n, q.answer)));
    let why = null;
    if (E.length && (J >= 0.3 || (hit && J >= 0.12))) why = `same subject (${E[0]})${hit ? ', and the claim reveals the answer' : ''}`;
    else if (J >= 0.5) why = `wording ${Math.round(J * 100)}% alike`;
    if (why) out.push({ kind: 'F-Q', a: f.id, b: q.id, why, score: J + (E.length ? 0.3 : 0) + (hit ? 0.3 : 0) });
  }
  return out.sort((x, y) => y.score - x.score);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const A = analyse(), C = candidates(A);
  const byId = new Map([...A.Q.map(q => [q.id, `${q.question} → ${q.answer} ${q.unit}`]), ...A.FX.map(f => [f.id, `${f.statement} [${f.truth ? 'T' : 'F'}] ${f.explanation}`])]);
  console.log(`questions ${A.Q.length}, facts ${A.FX.length}, candidate pairs ${C.length} (Q-Q ${C.filter(c => c.kind === 'Q-Q').length}, F-F ${C.filter(c => c.kind === 'F-F').length}, F-Q ${C.filter(c => c.kind === 'F-Q').length})`);
  if (process.argv.includes('--candidates')) for (const c of C) console.log(`${c.kind} ${c.a}|${c.b} ${c.why}\n   A ${byId.get(c.a)}\n   B ${byId.get(c.b)}`);
}
