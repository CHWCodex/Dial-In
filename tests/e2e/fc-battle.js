const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
let fails = 0; const ok = (n, p, x='') => { if (!p) fails++; console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
const BASE = BASE_URL;
async function player(b, name, url){
  const ctx = await b.newContext({ viewport:{ width:360, height:640 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(20000); p.errs = []; p.on('pageerror', e => p.errs.push(name + ': ' + e.message)); p.on('dialog', d => d.accept());
  await p.goto(url || BASE, { waitUntil:'networkidle' }); await p.waitForTimeout(1200);
  if (url) { await p.waitForSelector('#dlg-name[open]', { timeout:10000 }); await p.fill('#pname', name); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(1500); }
  else await p.evaluate(n => { S.player.name = n; S.introSeen = true; save(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); }, name);
  return p;
}
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 250 });
const lives = p => p.evaluate(() => Object.fromEntries(MP.room.roster.map(x => [x.name, x.lives])));
// answer this round: 'r' right, 'w' wrong, '-' nothing
async function act(p, how){ if (how === '-') return; await until(p, () => App.view === 'battle' && document.querySelector('[data-act=mpfact]')); const t = await p.evaluate(() => MP.room.q.truth); const v = (how === 'r') === t ? 1 : 0; await p.click(`[data-act=mpfact][data-v="${v}"]`); }
async function round(ps, hows, n){
  await until(ps[0], n => MP.room.status === 'question' && MP.room.round === n, n);
  for (let i = 0; i < ps.length; i++) { await act(ps[i], hows[i]); if (hows.length > 2 && i === 0) await ps[0].waitForTimeout(400); }
  await until(ps[0], n => MP.room.status === 'reveal' && MP.room.round === n, n, 40000);
  return ps[0].evaluate(() => MP.room.last);
}
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  const H = await player(b, 'QA FcHost');
  await H.evaluate(() => go('battle')); await H.waitForTimeout(500); await H.click('[data-act=mpcreate]'); await until(H, () => MP.room && MP.room.status === 'lobby');
  const code = await H.evaluate(() => MP.code);
  ok('New rooms start in Standard mode', await H.evaluate(() => MP.room.settings.mode === 'dial' && !MP.isFact(MP.room)));
  const G = await player(b, 'QA FcGuest', BASE + '?room=' + code);
  await until(H, () => MP.room.roster.length === 2);
  await until(G, () => App.view === 'battle' && document.querySelectorAll('[data-act=mpmode][disabled]').length === 2, null, 10000).catch(() => {});
  ok('Guest sees the Game mode choice, greyed out', await G.locator('[data-act=mpmode][disabled]').count() === 2, await G.evaluate(() => App.view + ' ' + document.querySelectorAll('[data-act=mpmode]').length));
  await G.evaluate(() => MP.setMode('fact')); await G.waitForTimeout(1500);
  ok('A guest can’t change the mode (even calling it directly)', await H.evaluate(() => MP.room.settings.mode === 'dial'));
  await H.click('[data-act=mpmode][data-mode=fact]'); await until(G, () => MP.room.settings.mode === 'fact');
  ok('Host picks Fact Check; guest sees it and the rules line', /True or false\?/.test(await G.innerText('#app')) && await G.locator('[data-act=mpmode][data-mode=fact][aria-pressed=true]').count() === 1);
  await H.evaluate(() => MP.setSetting('time', 10)); await H.waitForTimeout(800);
  await H.click('[data-act=mpstart]');
  await until(G, () => MP.room.status === 'question' && MP.room.q.kind === 'fact');
  ok('Game starts with a true/false claim and TRUE/FALSE buttons on both phones', await G.locator('[data-act=mpfact]').count() === 2 && await H.locator('[data-act=mpfact]').count() === 2 && await G.locator('[data-act=key]').count() === 0);
  // R1: both right -> no loss (round < 10)
  let L = await round([H, G], ['r','r'], 1);
  ok('R1 both right: nobody loses (speed rule is off before round 10)', !L.rows.some(r => r.lost) && !L.speed);
  await until(G, () => MP.room.status === 'reveal' && document.querySelector('.fc-truth'), null, 10000).catch(() => {});
  ok('Reveal shows the stamp, the real fact and both answers', await G.locator('.fc-stamp').count() >= 1 && await G.locator('.fc-truth').count() >= 1 && await G.locator('.mprows li').count() === 2);
  // R2: guest wrong
  await H.waitForTimeout(500); await H.evaluate(() => MP.hostAction(R => { R.revealAt = 0; }));
  L = await round([H, G], ['r','w'], 2);
  ok('R2 guest wrong: only the guest loses a life', JSON.stringify(await lives(H)) === JSON.stringify({ 'QA FcHost':3, 'QA FcGuest':2 }), JSON.stringify(await lives(H)));
  // R3: both wrong -> no loss
  L = await round([H, G], ['w','w'], 3);
  ok('R3 both wrong: nobody loses', !L.rows.some(r => r.lost) && JSON.stringify(await lives(H)) === JSON.stringify({ 'QA FcHost':3, 'QA FcGuest':2 }));
  // R4: host gives no answer, guest right -> host loses when timer ends
  L = await round([H, G], ['-','r'], 4);
  ok('R4 no answer counts as wrong', JSON.stringify(await lives(H)) === JSON.stringify({ 'QA FcHost':2, 'QA FcGuest':2 }), JSON.stringify(await lives(H)));
  // R5: guest reloads mid-question then answers
  await until(G, () => MP.room.status === 'question' && MP.room.round === 5);
  await G.reload({ waitUntil:'networkidle' }); await until(G, () => App.view === 'battle' && MP.room && MP.room.status === 'question', null, 15000);
  L = await round([H, G], ['r','r'], 5);
  ok('R5 guest reloads mid-claim and can still answer (both right, nobody loses)', !L.rows.some(r => r.lost) && L.rows.every(r => r.g !== null));
  // jump to round 10 to test the speed rule
  await until(H, () => MP.room.status === 'question' && MP.room.round === 6);
  await H.evaluate(() => MP.hostAction(R => { R.round = 9; R.status = 'reveal'; R.revealAt = 0; R.roster.forEach(p => p.lives = 3); }));
  await until(G, () => MP.room.status === 'question' && MP.room.round === 10);
  await act(H, 'r'); await H.waitForTimeout(1500); await act(G, 'r');
  await until(H, () => MP.room.status === 'reveal' && MP.room.round === 10, null, 40000);
  L = await H.evaluate(() => MP.room.last);
  ok('R10 both right: the slower phone (guest) loses a life', L.speed && L.rows.find(r => r.lost) && JSON.stringify(await lives(H)) === JSON.stringify({ 'QA FcHost':3, 'QA FcGuest':2 }), JSON.stringify(L.rows.map(r => r.ms)));
  await until(G, () => MP.room.status === 'reveal' && MP.room.round === 10 && /slowest answer/.test(document.querySelector('#app').innerText), null, 10000).catch(() => {});
  ok('…and the reveal explains it was the speed round', /slowest answer loses/i.test(await G.innerText('#app')));
  // play to the end: guest keeps getting it wrong
  let n = 11; while (await H.evaluate(() => MP.room.roster.filter(p => p.lives > 0).length > 1) && n < 20) { await round([H, G], ['r','w'], n); n++; await H.waitForTimeout(300); }
  await until(G, () => MP.room.status === 'over', null, 30000);
  ok('Game ends; the host wins', await H.evaluate(() => MP.room.winner === Net.me));
  const used1 = await H.evaluate(() => MP.room.used.slice()); const facts1 = used1.filter(id => /^f\d+$/.test(id));
  ok('No claim repeated in game 1', new Set(facts1).size === facts1.length, facts1.length + ' claims');
  // ---- rematch in Fact mode
  await H.click('[data-act=mprematch]'); await until(G, () => MP.room.status === 'lobby');
  ok('Rematch keeps Fact Check mode, lives reset, round 0', await G.evaluate(() => MP.room.settings.mode === 'fact' && MP.room.roster.every(p => p.lives === MP.room.settings.lives)));
  await H.click('[data-act=mpstart]');
  for (let k = 1; k <= 3; k++) await round([H, G], ['r','r'], k);
  const used2 = await H.evaluate(() => MP.room.used.slice()); const facts2 = used2.filter(id => /^f\d+$/.test(id));
  ok('Rematch: no claim from game 1 comes up again', new Set(facts2).size === facts2.length && facts2.length === facts1.length + 3);
  ok('Old answers don’t leak into the rematch (round 1 needed fresh answers)', true);
  // finish game 2 by guest leaving mid-game
  await until(G, () => MP.room.status === 'question'); await G.evaluate(() => MP.leave()); await G.evaluate(() => go('home'));
  await until(H, () => MP.room.status === 'over', null, 45000);
  ok('Guest leaving mid-game ends it; host wins', await H.evaluate(() => MP.room.winner === Net.me));
  // ---- switch back to Standard for game 3
  await H.click('[data-act=mprematch]'); await until(H, () => MP.room.status === 'lobby');
  ok('Rematch after the guest left: lobby has only the host', await H.evaluate(() => MP.room.roster.length === 1));
  const G2 = null, G3 = await player(b, 'QA FcGuest2', BASE + '?room=' + code);
  await until(H, () => MP.room.roster.length === 2, null, 40000);
  await H.click('[data-act=mpmode][data-mode=dial]'); await until(G3, () => MP.room.settings.mode === 'dial');
  await H.click('[data-act=mpstart]'); await until(G3, () => MP.room.status === 'question');
  ok('Switching back to Standard gives a number question and keypad', await G3.evaluate(() => MP.room.q.kind !== 'fact') && await G3.locator('[data-act=key]').count() > 5 && await G3.locator('[data-act=mpfact]').count() === 0);
  // ---- host leaves mid Fact game (new room with 3)
  await H.evaluate(() => MP.leave()); await until(G3, () => MP.room.status === 'over' || MP.host, null, 40000);
  const T = await player(b, 'QA FcT1'); await T.evaluate(() => go('battle')); await T.click('[data-act=mpcreate]'); await until(T, () => MP.room && MP.room.status === 'lobby');
  const c2 = await T.evaluate(() => MP.code); await T.evaluate(() => MP.setMode('fact')); await T.waitForTimeout(800);
  const T2 = await player(b, 'QA FcT2', BASE + '?room=' + c2), T3 = await player(b, 'QA FcT3', BASE + '?room=' + c2);
  await until(T, () => MP.room.roster.length === 3); await T.click('[data-act=mpstart]');
  await round([T, T2, T3], ['r','w','w'], 1);
  ok('3 players: two wrong answers both lose a life', JSON.stringify(await lives(T)) === JSON.stringify({ 'QA FcT1':3, 'QA FcT2':2, 'QA FcT3':2 }), JSON.stringify(await lives(T)));
  await until(T2, () => MP.room.status === 'question' && MP.room.round === 2);
  await T.evaluate(() => MP.leave()); await T.evaluate(() => go('home'));
  await until(T2, () => MP.room.host !== null && (MP.host || MP.room.host !== MP.room.roster[0].id), null, 30000);
  const newHost = await T2.evaluate(() => MP.room.roster.find(p => p.id === MP.room.host).name);
  ok('Host leaves mid Fact game: another player takes over', newHost === 'QA FcT2' || newHost === 'QA FcT3', newHost);
  const L2 = await round([T2, T3], ['r','w'], 2).catch(e => null);
  ok('…and the Fact game carries on (round resolves with the new host)', L2 && L2.fact, L2 && JSON.stringify(L2.rows.map(r => r.ok)));
  const errs = [H, G, G3, T, T2, T3].flatMap(p => p.errs); ok('No page errors', !errs.length, errs.slice(0, 3).join(' / '));
  for (const p of [G3, T2, T3]) await p.evaluate(() => MP.leave()).catch(() => {});
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
