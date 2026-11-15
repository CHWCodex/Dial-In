// Loads the question bank and daily schedule straight out of index.html, so generated pages always match the game.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function loadGame(root = new URL('..', import.meta.url)) {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const start = html.indexOf('/* ---------------------------- CONFIG');
  const end = html.indexOf('/* Unlimited: the n-th question');
  if (start < 0 || end < 0) throw new Error('index.html layout changed: update scripts/load-game.mjs');
  const code = html.slice(start, end) + '\n;({ CONFIG, BANK, BY_ID, DateUK, Scoring, dailyIds, fmtAns, fmtNum })';
  return vm.runInNewContext(code, { console, Intl, Date, Math, Map, Set, JSON, Number, String, Array, Object, RegExp, Error, isFinite });
}
