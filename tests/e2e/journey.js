const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
// Live site, end to end: one player's day, then their account across several phones.
const { chromium, devices } = require('playwright');
const BASE = BASE_URL;
let fails = 0; const ok = (n, p, x='') => { if (!p) fails++; console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
const USER = 'qa_jr' + Math.floor(Math.random() * 1e5), PIN = '583920';
async function phone(b, dev, state){
  const ctx = await b.newContext({ ...devices[dev || 'iPhone 13'], acceptDownloads:true, permissions:['clipboard-read','clipboard-write'], ...(state ? { storageState:state } : {}) });
  const p = await ctx.newPage(); p.setDefaultTimeout(25000); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE, { waitUntil:'networkidle' }); await p.waitForTimeout(2500); return p;
}
async function nameIf(p, n){ await p.waitForSelector('#dlg-name[open], #enterkey', { timeout:8000 }).catch(() => {}); if (await p.locator('#dlg-name[open]').count()) { await p.fill('#pname', n); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(700); } }
// redesign: Profile tab, then open "Account & devices" the way a player would (the guest button, or the section header)
const settings = async p => { await p.click('.navtab[data-nav=settings]'); await p.waitForTimeout(500);
  if (await p.locator('[data-act=acctopen]').count()) await p.click('[data-act=acctopen]');
  for (const f of ['acct', 'data']) if (await p.locator(`details.fold[data-fold=${f}]:not([open])`).count()) await p.click(`details.fold[data-fold=${f}] summary`);
  await p.waitForTimeout(500); };
const snap = p => p.evaluate(() => ({ uid: Backend.sess && Backend.sess.user_id, acct: Backend.acct, name: S.player.name, daily: S.days[App.today] ? dayTotal(S.days[App.today]) : null, fact: S.facts.days[App.today] ? factDayRight(S.facts.days[App.today]) : null, leagues: S.leagues || null }));
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  const A = await phone(b, 'iPhone SE');
  ok('Site loads the newest version (offline cache v45)', await A.evaluate(async () => { const r = await fetch('/sw.js', { cache:'no-store' }); return /dialin-v45/.test(await r.text()); }));
  await A.click('.navtab[data-nav=modes]'); await A.waitForTimeout(300);
  ok('Play tab: Daily, Fact Check!, Unlimited, Past puzzles, Battle cards', await A.locator('.modes .mode').count() >= 5);
  await A.click('.navtab[data-nav=home]'); await A.waitForTimeout(200);
  // ---- the Daily, answer panel on every question
  await A.click('.dc-go'); await nameIf(A, 'QA Journey');
  const ans = await A.evaluate(() => S.days[App.today].ids.map(id => BY_ID.get(id).answer));
  let panels = 0;
  for (let i = 0; i < 7; i++) {
    await A.waitForSelector('#enterkey'); const yr = await A.evaluate(() => isYearQ(BY_ID.get(S.days[App.today].ids[App.cur])));
    const g = String(i % 2 ? ans[i] : Math.round(ans[i] * 1.15) || 1);
    for (const k of g.replace(yr ? /\./g : /$^/, '')) await A.click(`[data-act=key][data-k="${k}"]`);
    await A.click('#enterkey'); await A.waitForTimeout(3600);
    const seen = await A.evaluate(() => { const h = document.querySelector('.ans-hero'), n = document.querySelector('#nextbtn'); if (!h || !n) return false; const a = h.getBoundingClientRect(), c = n.getBoundingClientRect(); return getComputedStyle(h).visibility === 'visible' && a.top >= 0 && c.bottom <= innerHeight + 1; });
    if (seen) panels++;
    await A.click('#nextbtn'); await A.waitForTimeout(300);
  }
  ok('Daily: "THE ANSWER" panel and Next on screen after every question (iPhone SE)', panels === 7, panels + '/7');
  if (await A.locator('[data-act=pinstart]').count()) { await A.click('[data-act=pinstart]'); await A.waitForTimeout(400); await A.click('#pinlaunch'); }
  await A.waitForFunction(() => App.view === 'results', null, { timeout:120000 }); await A.waitForTimeout(6000);
  ok('Results: score, Dial Ball bonus and today’s ranking from the server', /You beat|First in|#\d/.test(await A.innerText('#app')) && await A.evaluate(() => S.days[App.today].pin && S.days[App.today].pin.done));
  // ---- Fact Check
  await A.evaluate(() => openFactDaily()); await A.waitForTimeout(800);
  const ft = await A.evaluate(() => factDailyIds(App.today).map(id => FACT_BY_ID.get(id).truth));
  let truths = 0;
  for (let i = 0; i < 7; i++) { await A.waitForSelector('.fct-half'); await A.click(`.fct-half.${(i === 2 ? !ft[i] : ft[i]) ? 't' : 'f'}`); await A.waitForTimeout(1200); if (await A.locator('.fc-truth').count() && await A.locator('.fc-toggle.done').count()) truths++; await A.click('#nextbtn'); await A.waitForTimeout(300); }
  ok('Fact Check: the new dial and "The truth" panel after every claim; 6/7 right', truths === 7 && await A.evaluate(() => factDayRight(S.facts.days[App.today]) === 6), truths + '/7');
  // ---- Unlimited free run, past puzzle taster
  await A.evaluate(() => { go('endless'); }); await A.waitForTimeout(600);
  const free = await A.locator('[data-act=startrun]').count(); if (free) { await A.click('[data-act=startrun]'); await A.waitForTimeout(600); }
  ok('Unlimited: today’s free run starts', free && await A.locator('#enterkey').count() === 1);
  await A.evaluate(() => go('archive')); await A.waitForTimeout(800);
  ok('Past puzzles: the list shows, with a free one to try', await A.locator('[data-act=archplay], .arch li, .archlist button').count() > 0);
  // ---- Leaderboards as a guest
  await A.evaluate(() => { App.boardTab = 'daily'; go('board'); }); await A.waitForTimeout(6000);
  const rowsA = await A.evaluate(() => [...document.querySelectorAll('#board-body .lb li.me')].map(li => ({ tick: !!li.querySelector('.vtick') })));
  ok('Guest is on the public Daily board, without a tick, with "Get verified"', rowsA.length === 1 && !rowsA[0].tick && /Get verified/i.test(await A.innerText('#app')));
  for (const t of ['all', 'streak', 'fdaily', 'fall', 'leagues']) { await A.click(`[data-act=tab][data-tab=${t}]`); await A.waitForTimeout(3500); }
  ok('Every board tab loads (All-time, Streaks, Friends ×2, Leagues)', !/Couldn.t reach the leaderboard/.test(await A.innerText('#app')));
  await A.click('[data-act=tab][data-tab=all]'); await A.waitForTimeout(4500);
  ok('All-time board: 100 places and "Show more"', await A.locator('#board-body .lb li:not(.gap)').count() >= 100 && await A.locator('[data-act=boardmore]').count() === 1);
  // ---- save an account
  await A.click('[data-act=tab][data-tab=daily]'); await A.waitForTimeout(3500);
  await A.click('.verifynudge [data-act=acctgo]'); await A.waitForTimeout(600);
  await A.fill('#acctuser', USER); await A.fill('#acctpin', PIN); await A.fill('#acctpin2', PIN); await A.click('#createform button[type=submit]');
  await A.waitForSelector('#dlg-rec[open]', { timeout:25000 }).catch(() => {});
  const code = (await A.innerText('#rec-code').catch(() => '')).trim();
  ok('Save account: recovery code shown', /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code));
  if (await A.locator('#dlg-rec[open]').count()) await A.click('#dlg-rec [data-close]');
  await A.evaluate(() => { App.boardTab = 'daily'; go('board'); }); await A.waitForTimeout(5500);
  ok('…and the verified tick appears next to their name', await A.locator('#board-body .lb li.me .vtick').count() === 1);
  const a0 = await snap(A);
  // ---- a second phone signs in with username + PIN
  const C = await phone(b, 'iPhone 15 Pro Max');
  await settings(C); await C.click('[data-act=acctstep][data-s=login]'); await C.fill('#acctuser', USER); await C.fill('#acctpin', PIN); await C.click('#loginform button[type=submit]'); await C.waitForTimeout(6000);
  const c0 = await snap(C);
  ok('Second phone: signed in as the same player, with today’s Daily, Fact Check and name', c0.acct === USER && c0.uid === a0.uid && c0.daily === a0.daily && c0.fact === a0.fact && c0.name === a0.name, JSON.stringify({ c:c0.daily, a:a0.daily, f:c0.fact }));
  // ---- a third phone with a device code
  await settings(A); await A.click('[data-act=acctdevice]'); await A.waitForSelector('.devcode'); const dc = (await A.innerText('.devcode')).trim();
  const D = await phone(b, 'iPhone 13');
  await settings(D); await D.click('[data-act=acctstep][data-s=device]'); await D.fill('#devcodein', dc); await D.click('#deviceform button[type=submit]'); await D.waitForTimeout(6000);
  ok('Third phone: signed in with a 6-character code from the first', (await snap(D)).acct === USER);
  // ---- export, sign out, delete
  await settings(A);
  const [dl] = await Promise.all([A.waitForEvent('download', { timeout:20000 }).catch(() => null), A.click('[data-act=export]')]);
  let exp = null; if (dl) exp = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  ok('Export my data: server copy has the username, today’s result, and no email', exp && exp.server && exp.server.account.username === USER && exp.server.daily_results.length >= 1 && !exp.server.email);
  await settings(D); await D.click('[data-act=acctpanel][data-p=out]'); await D.click('[data-act=acctsignout]'); await D.waitForTimeout(5000);
  ok('Sign out of a device: that phone is a fresh guest again', !(await snap(D)).acct && !(await snap(D)).daily);
  await settings(C); await C.click('[data-act=acctdelete]'); await C.waitForTimeout(300); await C.click('[data-act=acctdelete]'); await C.waitForTimeout(7000);
  ok('Delete my account and data: the phone becomes a fresh guest', !(await snap(C)).acct && !(await snap(C)).daily);
  const E = await phone(b, 'iPhone 13'); await settings(E); await E.click('[data-act=acctstep][data-s=login]'); await E.fill('#acctuser', USER); await E.fill('#acctpin', PIN); await E.click('#loginform button[type=submit]'); await E.waitForTimeout(5000);
  ok('…and the deleted account can’t be signed in to', !(await snap(E)).acct);
  await A.reload({ waitUntil:'networkidle' }); await A.waitForTimeout(4000);
  ok('…and the first phone, which was signed in, is now signed out', !(await snap(A)).acct, await A.innerText('#toast').catch(() => ''));
  const errs = [A, C, D, E].flatMap(p => p.errs); ok('No page errors anywhere', !errs.length, errs.slice(0, 3).join(' / '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
