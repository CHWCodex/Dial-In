const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
// Battle edge cases: bad codes, finished and full rooms, the same player twice, simultaneous rematches, question repeats.
const { chromium } = require('playwright');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (x ? ' | ' + x : '')); };
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 300 });
async function player(b, name, url, ctx) {
  ctx = ctx || await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(20000); p.errs = []; p.on('pageerror', e => p.errs.push(name + ': ' + e.message)); p.on('dialog', d => d.accept());
  await p.goto(url || BASE_URL, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  if (url && await p.locator('#dlg-name[open]').count()) { await p.fill('#pname', name); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(1500); }
  else await p.evaluate(n => { S.player.name = n; S.introSeen = true; save(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); }, name);
  p.ctx = ctx; return p;
}
const toastText = p => p.evaluate(() => (document.querySelector('#toast') || {}).textContent || '');
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  const H = await player(b, 'QA Edge Host');
  await H.evaluate(() => go('battle')); await H.click('[data-act=mpcreate]'); await until(H, () => MP.room && MP.room.status === 'lobby');
  const code = await H.evaluate(() => MP.code);
  await H.evaluate(() => MP.setSetting('lives', 1)); await H.waitForTimeout(800); await H.evaluate(() => MP.setSetting('max', 2)); await H.waitForTimeout(800);
  ok('Room set to 2 players, 1 life', await H.evaluate(() => MP.room.settings.max === 2 && MP.room.settings.lives === 1));

  // a code that doesn't exist
  const X = await player(b, 'QA Edge Lost', BASE_URL + '?room=0000'); await X.waitForTimeout(3000);
  const xt = await toastText(X) + ' ' + await X.evaluate(() => (document.querySelector('#app').innerText || ''));
  ok('Unknown room code: a clear message, no crash, no technical text', /no room|check the number|couldn.t/i.test(xt) && !/undefined|null|error:|PGRST|violates/i.test(xt) && !X.errs.length, xt.replace(/\s+/g, ' ').slice(0, 120));
  // the same guest opening the invite in two tabs takes one seat
  const G = await player(b, 'QA Edge Guest', BASE_URL + '?room=' + code);
  await until(H, () => MP.room.roster.length === 2).catch(() => {});
  const G2 = await player(b, 'QA Edge Guest', BASE_URL + '?room=' + code, G.ctx); await G2.waitForTimeout(3000);
  const roster = await H.evaluate(() => MP.room.roster.map(x => x.name));
  ok('Same player opens the invite in a second tab: still one seat', roster.filter(n => n === 'QA Edge Guest').length === 1 && roster.length === 2, roster.join(', '));
  await G2.close();
  // a full room
  const F = await player(b, 'QA Edge Late', BASE_URL + '?room=' + code); await F.waitForTimeout(3000);
  const ft = await toastText(F) + ' ' + await F.evaluate(() => document.querySelector('#app').innerText);
  ok('Room full (2 of 2): a newcomer is told so, the room is unchanged', /full/i.test(ft) && (await H.evaluate(() => MP.room.roster.length)) === 2, ft.replace(/\s+/g, ' ').slice(0, 100));
  // play the game out
  await H.click('[data-act=mpstart]'); await until(G, () => MP.room && MP.room.status === 'question');
  const qs = [];
  for (let r = 0; r < 12; r++) {
    const st = await H.evaluate(() => MP.room.status); if (st === 'over') break;
    if (st === 'question') { qs.push(await H.evaluate(() => MP.room.q.id));
      for (const [p, v] of [[H, '1'], [G, '999999']]) if (await p.evaluate(() => keyTarget() === 'battle')) { for (const k of v) await p.click(`[data-act=key][data-k="${k}"]`); await p.click('#enterkey'); } }
    await H.waitForTimeout(2500);
  }
  await until(H, () => MP.room.status === 'over', null, 60000).catch(() => {});
  ok('Game finishes with a winner', await H.evaluate(() => MP.room.status === 'over' && !!MP.room.winner));
  // joining a finished game
  const L = await player(b, 'QA Edge After', BASE_URL + '?room=' + code); await L.waitForTimeout(3000);
  const lt = await toastText(L) + ' ' + await L.evaluate(() => document.querySelector('#app').innerText);
  ok('Joining a finished game: told plainly, no crash', /full|over|started|rematch|finished/i.test(lt) && !L.errs.length, lt.replace(/\s+/g, ' ').slice(0, 100));
  // both players hit rematch at the same moment
  await Promise.all([H.evaluate(() => MP.rematch()), G.evaluate(() => MP.rematch && MP.rematch())]); await H.waitForTimeout(2500);
  const games = await H.evaluate(() => ({ st: MP.room.status, games: MP.room.games, roster: MP.room.roster.length }));
  ok('Two rematch taps at once: one new game, both players still in', games.st === 'lobby' && games.games === 2 && games.roster === 2, JSON.stringify(games));
  await H.click('[data-act=mpstart]'); await until(G, () => MP.room && MP.room.status === 'question');
  const q2 = await H.evaluate(() => MP.room.q.id);
  ok('The rematch starts on a question nobody in the room has had', !qs.includes(q2), q2 + ' vs ' + qs.join(','));
  const usedFacts = await H.evaluate(() => (MP.room.used || []).map(factOf));
  ok('…and no fact twice across both games', new Set(usedFacts).size === usedFacts.length, usedFacts.length + ' questions');
  ok('No page errors', ![H, G, X, F, L].some(p => p.errs.length), [H, G, X, F, L].flatMap(p => p.errs).join(' / '));
  await H.evaluate(() => MP.leave && MP.leave()).catch(() => {});
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
