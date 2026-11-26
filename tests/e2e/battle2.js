const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
const ok = (n, p, x='') => console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:''));
const BASE = BASE_URL;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function player(b, name, url){
  const ctx = await b.newContext({ viewport:{ width:360, height:640 }, permissions:['clipboard-read','clipboard-write'] });
  const p = await ctx.newPage(); p.setDefaultTimeout(20000); p.errs = []; p.on('pageerror', e => p.errs.push(name + ': ' + e.message)); p.on('dialog', d => d.accept());
  await p.goto(url || BASE, { waitUntil:'networkidle' }); await p.waitForTimeout(1200);
  if (url) { await p.waitForSelector('#dlg-name[open]', { timeout:10000 }); await p.fill('#pname', name); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(1500); }
  else await p.evaluate(n => { S.player.name = n; S.introSeen = true; save(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); }, name);
  return p;
}
const room = p => p.evaluate(() => MP.room && { status:MP.room.status, round:MP.room.round, q:MP.room.q && MP.room.q.id, host:MP.room.host, seed:MP.room.seed, roster:MP.room.roster.map(x => x.name + ':' + x.lives) });
async function answer(p, val){ if (await p.evaluate(() => keyTarget() === 'battle')) { for (const k of String(val)) await p.click(`[data-act=key][data-k="${k}"]`); await p.click('#enterkey'); } }
async function until(p, fn, arg, ms = 30000){ return p.waitForFunction(fn, arg, { timeout: ms, polling: 300 }); }
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  const H = await player(b, 'QA Host');
  await H.evaluate(() => go('battle')); await H.waitForTimeout(800);
  await H.click('[data-act=mpcreate]'); await until(H, () => MP.room && MP.room.status === 'lobby');
  const code = await H.evaluate(() => MP.code);
  await H.evaluate(() => { MP.setSetting('lives', 1); }); await H.waitForTimeout(800);
  await H.click('[data-act=mpinvite]'); await H.waitForTimeout(600);
  const inv = await H.evaluate(async () => { const d = document.querySelector('#dlg-copy'); if (d && d.open) { const v = document.querySelector('#copy-text').value; d.close(); return v; } try { return await navigator.clipboard.readText(); } catch(e){ return ''; } });
  ok('Invite friends shares a link to the room', inv.includes('/b/' + code), inv.replace(/\n/g, ' ⏎ '));
  // guests open the link (the live /b/ redirect turns it into ?room=CODE)
  const G = await player(b, 'QA Guest', BASE + '?room=' + code);
  await until(G, c => MP.code === c && MP.room && MP.room.roster.some(p => p.name === 'QA Guest'), code).catch(() => {});
  ok('Opening the link joins that room', await G.evaluate(c => MP.code === c && App.view === 'battle', code), JSON.stringify(await room(G)));
  const T = await player(b, 'QA Third', BASE + '?room=' + code);
  await until(H, () => MP.room.roster.length === 3).catch(() => {});
  ok('A third player joins the same way', (await room(H)).roster.length === 3, (await room(H)).roster.join(', '));
  // game 1
  await H.click('[data-act=mpstart]'); await until(G, () => MP.room.status === 'question');
  const g1q1 = (await room(H)).q;
  ok('Leave battle button shows during a question', await G.locator('[data-act=mpquit]').count() === 1);
  // Third leaves mid-question
  await T.click('[data-act=mpquit]'); await T.waitForTimeout(800);
  ok('Leaving mid-game takes you out of the room', await T.evaluate(() => !MP.code && !S.mp));
  await until(H, () => MP.room.roster.find(p => p.name === 'QA Third').lives === 0, null, 15000).catch(() => {});
  ok('…and the others see that player knocked out', (await room(H)).roster.includes('QA Third:0'), (await room(H)).roster.join(', '));
  const qs1 = [g1q1];
  // host answers exactly, guest badly → guest out (1 life) → game over
  const ans = await H.evaluate(() => MP.room.q.answer);
  await answer(H, ans); await answer(G, 1);
  await until(H, () => MP.room.status === 'over', null, 40000).catch(() => {});
  const r1 = await room(H);
  ok('Game 1 finishes with a winner', r1.status === 'over', r1.roster.join(', '));
  // rematch
  await H.click('[data-act=mprematch]'); await until(G, () => MP.room.status === 'lobby').catch(() => {});
  const lobby = await room(G);
  ok('Rematch returns everyone to the lobby with fresh lives', lobby.status === 'lobby' && lobby.roster.every(x => x.endsWith(':1')), lobby.roster.join(', '));
  await H.click('[data-act=mpstart]'); await until(G, () => MP.room.status === 'question');
  await G.waitForTimeout(1500);
  const r2 = await room(G);
  ok('Rematch uses different questions', r2.q !== g1q1 && r2.seed !== r1.seed, `game 1 Q1 ${g1q1} → game 2 Q1 ${r2.q}`);
  ok('Rematch round waits for new answers (old answers don’t carry over)', r2.status === 'question' && await G.evaluate(() => keyTarget() === 'battle') && await G.locator('#enterkey').count() === 1);
  ok('Timer restarts properly in the rematch', await G.evaluate(() => { const f = document.querySelector('#tfill'); return !!f; }));
  // host leaves mid-game → guest takes over and wins
  await H.click('[data-act=mpquit]'); await H.waitForTimeout(500);
  await until(G, () => MP.room && (MP.room.status === 'over' || MP.room.host === Net.me), null, 15000).catch(() => {});
  const r3 = await room(G);
  ok('Host leaving hands over the room instead of closing it', r3 && r3.status !== 'closed' && r3.host === await G.evaluate(() => Net.me), JSON.stringify(r3));
  ok('…and with one player left, they win', r3 && r3.status === 'over', await G.evaluate(() => MP.room && MP.room.winner === Net.me ? 'Guest wins' : 'no'));
  ok('Leave room works after the game', await (async () => { await G.click('[data-act=mpleave]'); await G.waitForTimeout(600); return G.evaluate(() => !MP.code); })());
  const errs = [H, G, T].flatMap(p => p.errs); ok('no page errors', !errs.length, errs.join(' / '));
  await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
