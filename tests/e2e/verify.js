const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
let fails = 0; const ok = (n, p, x='') => { if (!p) fails++; console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
async function nameIf(p, n){ await p.waitForSelector('#dlg-name[open], #enterkey', { timeout:8000 }).catch(() => {}); if (await p.locator('#dlg-name[open]').count()) { await p.fill('#pname', n); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(700); } }
async function player(b, name){
  const p = await (await b.newContext({ viewport:{ width:360, height:640 } })).newPage(); p.setDefaultTimeout(20000); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(BASE_URL, { waitUntil:'networkidle' }); await p.waitForTimeout(1500);
  await setName(p, name); await p.click('.dc-go'); await nameIf(p, name);
  for (let i = 0; i < 7; i++) { await p.waitForSelector('#enterkey'); await p.click('[data-act=key][data-k="5"]'); await p.click('#enterkey'); await p.waitForTimeout(2700); if (await p.locator('#reveal').count()) await p.click('#reveal').catch(()=>{}); await p.waitForTimeout(250); await p.click('#nextbtn'); await p.waitForTimeout(250); }
  if (await p.locator('[data-act=pinstart]').count()) { await p.click('[data-act=pinstart]'); await p.waitForTimeout(400); await p.click('#pinlaunch'); }
  await p.waitForFunction(() => App.view === 'results', null, { timeout:120000 }); await p.waitForTimeout(4000); return p;
}
async function board(p, tab){ await p.evaluate(t => { App.boardTab = t; go('board'); }, tab || 'daily'); await p.waitForTimeout(5000); return p.evaluate(() => [...document.querySelectorAll('#board-body .lb li:not(.gap)')].map(li => ({ name: li.querySelector('.nm').firstChild.textContent, me: li.classList.contains('me'), tick: !!li.querySelector('.vtick') }))); }
async function setName(p, n){   // redesign: no pop-up before the first game; set the name the way a player would (Profile → Display name)
  await p.click('.navtab[data-nav=settings]'); await p.waitForTimeout(300);
  if (await p.locator('details.fold[data-fold=name]:not([open])').count()) await p.click('details.fold[data-fold=name] summary');
  await p.fill('#name', n); await p.click('#nameform button[type=submit]'); await p.waitForTimeout(500);
  await p.click('.navtab[data-nav=home]'); await p.waitForTimeout(300); }
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  const A = await player(b, 'QA Verify A');
  const rk = await A.innerText('#app');
  ok('A guest sees their real ranking on the results screen', /You beat|First in|#\d/.test(rk) && !/Save your account to claim/i.test(rk));
  let rows = await board(A);
  const me = rows.find(r => r.me);
  ok('A guest is on the public Daily board straight away, with no tick', me && me.name.startsWith('QA Verify A') && !me.tick, JSON.stringify(me));
  ok('…and sees the "Get verified" card', /Get verified/i.test(await A.innerText('#app')));
  rows = await board(A, 'all'); ok('…and is on the All-time board too', rows.some(r => r.me));
  // save an account
  await A.click('.verifynudge [data-act=acctgo]'); await A.waitForTimeout(600);
  await A.fill('#acctuser', 'qa_vf' + Math.floor(Math.random() * 1e5)); await A.fill('#acctpin', '583920'); await A.fill('#acctpin2', '583920'); await A.click('#createform button[type=submit]');
  await A.waitForSelector('#dlg-rec[open]', { timeout:20000 }); await A.click('#dlg-rec [data-close]');
  rows = await board(A);
  const me2 = rows.find(r => r.me);
  ok('After saving an account: a verified tick next to their name', me2 && me2.tick, JSON.stringify(me2));
  ok('…and the "Get verified" card has gone', !/Get verified/i.test(await A.innerText('#app')));
  const guestsShown = rows.filter(r => !r.tick).length;
  ok('Other guests are on the board without a tick', guestsShown > 0, guestsShown + ' guests listed');
  // a second guest on the same connection, after A started as a guest
  const B = await player(b, 'QA Verify B');
  const rowsB = await board(B);
  ok('A second guest on the same connection is kept off the public Daily board', !rowsB.some(r => r.me));
  ok('…and is told why', /Another player without a saved account had already started/i.test(await B.innerText('#app')));
  rows = await board(B, 'all'); ok('…but still counts on the All-time board', rows.some(r => r.me));
  const shot = process.argv[2] + '/verify-board.png'; await A.evaluate(() => { App.boardTab = 'daily'; go('board'); }); await A.waitForTimeout(4500); await A.screenshot({ path: shot });
  const errs = [A, B].flatMap(p => p.errs); ok('No page errors', !errs.length, errs.join(' / '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
