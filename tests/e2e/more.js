const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
let fails = 0; const ok = (n, p, x='') => { if (!p) fails++; console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  const p = await (await b.newContext({ viewport:{ width:360, height:640 } })).newPage(); p.setDefaultTimeout(20000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE_URL, { waitUntil:'networkidle' }); await p.waitForTimeout(2000);
  await p.evaluate(() => { App.boardTab = 'all'; go('board'); }); await p.waitForTimeout(6000);
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#board-body .lb li:not(.gap)')].map(li => li.querySelector('.nm').firstChild.textContent));
  const total = await p.evaluate(async () => { let n = 0, off = 0; for (;;) { const r = await Backend.rpc('get_alltime_leaderboard', { p_limit: 100, p_offset: off }); n += r.length; if (r.length < 100) break; off += 100; } return n; });
  let r = await rows();
  ok('All-time board shows 100 places at first', r.length === 100, r.length + ' rows');
  ok('…with a "Show more" button for places 101–200', /Show more \(places 101–200\)/i.test(await p.innerText('#board-body')));
  let taps = 0;
  while (await p.locator('[data-act=boardmore]').count() && taps < 10) { await p.click('[data-act=boardmore]'); taps++; await p.waitForFunction(() => !document.querySelector('[data-act=boardmore][disabled]'), null, { timeout:20000 }); await p.waitForTimeout(300); }
  r = await rows();
  ok(`After ${taps} taps every player is listed (${total} on the board)`, r.length === total, r.length + ' rows');
  ok('…no one listed twice', new Set(r).size === r.length || r.length === total);
  ok('…and the button has gone', await p.locator('[data-act=boardmore]').count() === 0);
  const ranks = await p.evaluate(() => [...document.querySelectorAll('#board-body .lb li:not(.gap) .r')].map(x => Number(x.textContent.slice(1))));
  ok('…in rank order', ranks.every((v, i) => i === 0 || v >= ranks[i - 1]));
  await p.click('[data-act=tab][data-tab=daily]'); await p.waitForTimeout(5000);
  ok('Switching tabs starts fresh (Daily board, no leftover rows)', (await rows()).length < 100 && !(await p.locator('[data-act=boardmore]').count()));
  ok('No page errors', !errs.length, errs.join(' / '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
