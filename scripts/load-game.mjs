// Loads the question bank and daily schedule straight out of index.html, so generated pages always match the game.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function loadGame(root = new URL('..', import.meta.url)) {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const start = html.indexOf('/* ---------------------------- CONFIG');
  const end = html.indexOf('/* Unlimited: the n-th question');
  if (start < 0 || end < 0) throw new Error('index.html layout changed: update scripts/load-game.mjs');
  const code = html.slice(start, end) + '\n;({ CONFIG, BANK, BY_ID, DateUK, Scoring, Entry, parseAnswer, rangeHint, dailyIds, legacyDailyIds, hasDaily, factOf, QUALITY, QUARANTINED, DAILY_V2, FACT_V2, fmtAns, fmtNum })';
  return vm.runInNewContext(code, { console, Intl, Date, Math, Map, Set, JSON, Number, String, Array, Object, RegExp, Error, isFinite });
}

// The Fact Check schedule needs the statement bank (facts.js) plus the Fact Check section of index.html.
export function loadFactGame(root = new URL('..', import.meta.url)) {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const start = html.indexOf('/* ---------------------------- CONFIG'), end = html.indexOf('/* Unlimited: the n-th question');
  const fs0 = html.indexOf('const FACT_SECONDS'), fs1 = html.indexOf('const factPayload');
  if (start < 0 || end < 0 || fs0 < 0 || fs1 < 0) throw new Error('index.html layout changed: update scripts/load-game.mjs');
  const code = readFileSync(new URL('facts.js', root), 'utf8') + '\n' + html.slice(start, end) + '\n' + html.slice(fs0, fs1) +
    '\n;({ FACTS, FACT_BY_ID, FACT_EPOCH, factDailyIds, legacyFactDailyIds, ffactOf, FACT_V2, QUALITY, DateUK })';
  return vm.runInNewContext(code, { window: {}, console, Intl, Date, Math, Map, Set, JSON, Number, String, Array, Object, RegExp, Error, isFinite });
}
