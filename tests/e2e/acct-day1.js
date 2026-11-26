const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
let fails = 0; const ok = (n, p, x='') => { if (!p) fails++; console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
async function nameIf(p, n){ await p.waitForSelector('#dlg-name[open], #enterkey', { timeout:8000 }).catch(() => {}); if (await p.locator('#dlg-name[open]').count()) { await p.fill('#pname', n); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(700); } }
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
  const p = await (await b.newContext({ viewport:{ width:360, height:640 } })).newPage(); p.setDefaultTimeout(20000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE_URL, { waitUntil:'networkidle' }); await p.waitForTimeout(1500);
  await setName(p, 'QA Dayone'); await p.click('.dc-go'); await nameIf(p, 'QA Dayone');
  for (let i = 0; i < 7; i++) { await p.waitForSelector('#enterkey'); await p.click('[data-act=key][data-k="5"]'); await p.click('#enterkey'); await p.waitForTimeout(2700); if (await p.locator('#reveal').count()) await p.click('#reveal').catch(()=>{}); await p.waitForTimeout(250); await p.click('#nextbtn'); await p.waitForTimeout(250); }
  if (await p.locator('[data-act=pinstart]').count()) { await p.click('[data-act=pinstart]'); await p.waitForTimeout(400); await p.click('#pinlaunch'); }
  await p.waitForFunction(() => App.view === 'results', null, { timeout:120000 }); await p.waitForTimeout(4000);
  await p.click('.navtab[data-nav=settings]'); await p.waitForTimeout(400); if (await p.locator('[data-act=acctopen]').count()) await p.click('[data-act=acctopen]'); await p.waitForTimeout(500);
  await p.fill('#acctuser', 'qa_day' + Math.floor(Math.random() * 1e5)); await p.fill('#acctpin', '583920'); await p.fill('#acctpin2', '583920'); await p.click('#createform button[type=submit]');
  await p.waitForSelector('#dlg-rec[open]', { timeout:20000 }); await p.click('#dlg-rec [data-close]');
  await p.evaluate(() => { App.boardTab = 'daily'; go('board'); }); await p.waitForTimeout(5000);
  const t = await p.innerText('#app');
  ok('Day 1: a brand-new saved account is on the public Daily board straight away', /QA Dayone \(you\)/.test(t), (t.match(/#\d+\s*QA Dayone[^\n]*/) || [''])[0]);
  ok('…with no "3 days" note', !/3 days|more to go/i.test(t));
  await p.click('[data-act=tab][data-tab=all]'); await p.waitForTimeout(4000);
  ok('…and on the All-time board', /QA Dayone \(you\)/.test(await p.innerText('#board-body')));
  ok('No page errors', !errs.length, errs.join(' / '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
