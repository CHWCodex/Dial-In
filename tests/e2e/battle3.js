const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
const ok = (n, p, x='') => console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:''));
const BASE = BASE_URL;
async function player(b, name, url){
  const ctx = await b.newContext({ viewport:{ width:360, height:640 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(20000); p.errs = []; p.on('pageerror', e => p.errs.push(name + ': ' + e.message)); p.on('dialog', d => d.accept());
  await p.goto(url || BASE, { waitUntil:'networkidle' }); await p.waitForTimeout(1200);
  if (url) { await p.waitForSelector('#dlg-name[open]', { timeout:10000 }); await p.fill('#pname', name); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(1500); }
  else await p.evaluate(n => { S.player.name = n; S.introSeen = true; save(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); }, name);
  return p;
}
const room = p => p.evaluate(() => MP.room && { status:MP.room.status, round:MP.room.round, host:MP.room.host, roster:MP.room.roster.map(x => x.name + ':' + x.lives) });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 300 });
async function answer(p, val){ await p.screenshot({ path: require('os').tmpdir() + '/b3-answer.png' }); console.log('  answering', val, await p.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(d => d.id).join(',')), await p.evaluate(() => [...document.querySelectorAll('[data-act=key]')].map(k => k.dataset.k + (k.disabled ? '(off)' : '')).join(' '))); if (!(await p.evaluate(() => keyTarget() === 'battle'))) { console.log('  (no answer box: ' + JSON.stringify(await p.evaluate(() => ({ view:App.view, st:MP.room && MP.room.status, t:keyTarget() }))) + ')'); return; } for (const k of String(val)) await p.click(`[data-act=key][data-k="${k}"]`); await p.click('#enterkey'); }
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  // ---- lobby ghost
  const H = await player(b, 'QA Host');
  await H.evaluate(() => go('battle')); await H.waitForTimeout(600); await H.click('[data-act=mpcreate]'); await until(H, () => MP.room && MP.room.status === 'lobby');
  const code = await H.evaluate(() => MP.code); await H.evaluate(() => MP.setSetting('time', 60)); await H.waitForTimeout(800);
  const ghost = await player(b, 'QA Ghost', BASE + '?room=' + code);
  await until(H, () => MP.room.roster.length === 2);
  await ghost.context().close();
  const t0 = Date.now(); await until(H, () => MP.room.roster.length === 1, null, 45000).catch(() => {});
  ok('Lobby: a player who closes the app frees their seat', (await room(H)).roster.length === 1, Math.round((Date.now() - t0) / 1000) + 's after closing');
  const G = await player(b, 'QA Guest', BASE + '?room=' + code);
  const X = await player(b, 'QA Third', BASE + '?room=' + code);
  await until(H, () => MP.room.roster.length === 3);
  await H.click('[data-act=mpstart]'); await until(G, () => MP.room.status === 'question');
  // ---- reload mid-question: straight back in and able to answer
  await G.reload({ waitUntil:'networkidle' });
  await until(G, () => App.view === 'battle' && MP.room && MP.room.status === 'question', null, 15000).catch(() => {});
  ok('Reopening the site mid-round goes straight back into the battle', await G.evaluate(() => App.view === 'battle'));
  ok('…and the player can still answer (nothing covering the keypad)', await G.evaluate(() => keyTarget() === 'battle' && !document.querySelector('dialog[open]')) && await G.locator('#enterkey').count() === 1);
  // ---- lost answer is re-sent
  let dropped = 0;
  await G.route('**/rest/v1/mp_docs*', async r => { const body = r.request().postData() || ''; if (r.request().method() === 'POST' && /"ans":\{"round"/.test(body) && dropped === 0) { dropped++; return r.abort(); } return r.continue(); });
  const ans = await H.evaluate(() => MP.room.q.answer);
  await answer(G, ans);
  ok('Guest’s answer shows as locked in', /Locked in/i.test(await G.innerText('#app')));
  await answer(H, ans); await answer(X, ans);
  await until(H, () => MP.room.status === 'reveal', null, 40000).catch(() => {});
  const rev = await H.evaluate(() => MP.room.last && MP.room.last.rows.map(r => (MP.room.roster.find(p => p.id === r.id) || {}).name + ':' + (r.g === null ? 'none' : 'answered')));
  ok('An answer lost to a signal drop is re-sent and counts', dropped === 1 && rev && rev.every(x => x.endsWith('answered')), (dropped ? 'first send dropped; ' : '') + (rev || []).join(', '));
  await G.unroute('**/rest/v1/mp_docs*');
  // ---- rejoin from a different browser with the same name
  await until(H, () => MP.room.status === 'question', null, 20000);
  await G.context().close();
  const G2 = await player(b, 'QA Guest', BASE + '?room=' + code);
  const tj = Date.now(); const waiting = await G2.evaluate(() => /Getting your seat back/.test(document.body.innerText)); await until(G2, () => MP.room && MP.room.roster.some(p => p.id === Net.me), null, 45000).catch(() => {}); console.log('  seat back after', Math.round((Date.now() - tj) / 1000) + 's; showed waiting message:', waiting);
  ok('Opening the link in another app takes back your seat', await G2.evaluate(() => MP.room && MP.room.roster.some(p => p.id === Net.me && p.name === 'QA Guest')), JSON.stringify(await room(G2)));
  ok('…and you can answer straight away', await G2.evaluate(() => MP.room.status !== 'question' || keyTarget() === 'battle'));
  // ---- host disappears: someone else takes over and the game keeps going
  const roundBefore = (await room(G2)).round;
  await H.context().close();
  const t1 = Date.now();
  await until(X, () => MP.room && MP.room.host === Net.me || (MP.room && MP.room.host !== MP.room.roster[0].id && MP.host), null, 60000).catch(() => {});
  const r3 = await room(X), xIsHost = await X.evaluate(() => MP.host), g2IsHost = await G2.evaluate(() => MP.host);
  ok('If the host vanishes, another player takes over running the room', xIsHost || g2IsHost, Math.round((Date.now() - t1) / 1000) + 's; new host: ' + (xIsHost ? 'QA Third' : g2IsHost ? 'QA Guest' : 'nobody'));
  await until(X, r => MP.room && MP.room.round > r, roundBefore, 60000).catch(() => {});
  ok('…and the rounds keep coming', (await room(X)).round > roundBefore, `round ${roundBefore} → ${(await room(X)).round}`);
  const errs = [H, G2, X].flatMap(p => p.errs || []); ok('no page errors', !errs.length, errs.join(' / '));
  await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
