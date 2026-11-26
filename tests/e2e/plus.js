const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
const ok = (n, p, x='') => console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:''));
const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  const ctx = await b.newContext({ viewport:{ width:360, height:640 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/*supabase.co/**', r => r.abort());
  await p.goto(BASE_URL, { waitUntil:'load' }); await p.waitForTimeout(800);
  if (await p.locator("#dlg-intro[open]").count()) await p.locator("text=LET\'S DIAL IN").first().click(); await p.waitForTimeout(300);
  // paywall only exists when online + Stripe: switch it on for the test
  await p.evaluate(() => { Backend.on = true; S.player.name = 'T'; render(false); });
  await p.click('.navtab[data-nav=modes]'); await p.waitForTimeout(300);   // redesign: Past puzzles lives on the Play tab
  const home = await p.innerText('.m-past');
  ok('home: Past puzzles card offers a free try', /Past puzzles/i.test(home) && /try one free/i.test(home), home.replace(/\n+/g,' | '));
  await p.screenshot({ path: SP + '/plus-home.png', fullPage:true });
  await p.click('.m-past'); await p.waitForTimeout(400);
  const n = await p.locator('.archlist li').count(), today = await p.evaluate(() => DateUK.puzzleNo(App.today));
  ok('archive lists every finished puzzle, newest first', n === today - 1 && /#\d+/.test(await p.innerText('.archlist li >> nth=0')), `${n} puzzles; first: ${(await p.innerText('.archlist li >> nth=0')).replace(/\n+/g,' ')}`);
  ok('DIAL IN+ offer at the top for non-buyers', /Catch up on every puzzle/i.test(await p.innerText('#app')));
  await p.screenshot({ path: SP + '/plus-archive.png', fullPage:true });
  // play the 3rd one for free
  const d = await p.evaluate(() => archDates()[2]);
  await p.click(`[data-act=archopen][data-d="${d}"]`); await p.waitForTimeout(400);
  ok('free puzzle opens; header says which', /Past puzzle #/.test(await p.innerText('#app')) && await p.evaluate(x => App.view === 'arch' && S.archFree === x, d));
  const ans = await p.evaluate(() => S.archive[App.archDate].ids.map(id => BY_ID.get(id).answer));
  const before = await p.evaluate(() => JSON.stringify({ days:S.days, st:getStats(App.today) }));
  for (let i = 0; i < 7; i++) { await p.waitForSelector('#enterkey'); const g = i === 1 ? '1' : String(ans[i]); if (i === 3) { await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.type(g); await p.keyboard.press('Enter'); } else for (const k of g) await p.click(`[data-act=key][data-k="${k}"]`); if (i === 3) {} else await p.click('#enterkey'); await p.waitForTimeout(2600); if (await p.locator('#reveal').count()) await p.click('#reveal').catch(()=>{}); await p.waitForTimeout(250); if (!(await p.locator('#nextbtn').count())) { console.log('STUCK at', i, await p.evaluate(() => JSON.stringify({ view:App.view, cur:App.cur, entry:App.entry, ans:S.archive[App.archDate].answers.map(a => a && a.s) }))); await p.screenshot({ path: require('os').tmpdir() + '/plus-stuck.png' }); break; } await p.click('#nextbtn'); await p.waitForTimeout(250); }
  const res = await p.innerText('#app');
  ok('finishing shows the archive score screen', await p.evaluate(() => App.view === 'archres') && /\/ 7,000/.test(res), res.split('\n').slice(0, 6).join(' | '));
  ok('streaks, stats and daily days untouched', before === await p.evaluate(() => JSON.stringify({ days:S.days, st:getStats(App.today) })));
  await p.screenshot({ path: SP + '/plus-res.png', fullPage:true });
  // another one is locked
  await p.evaluate(() => go('archive')); await p.waitForTimeout(300);
  const other = await p.evaluate(() => archDates()[0]);
  await p.click(`[data-act=archopen][data-d="${other}"]`); await p.waitForTimeout(400);
  const pay = await p.innerText('#dlg-pay');
  ok('second past puzzle asks for DIAL IN+', await p.locator('#dlg-pay[open]').count() === 1 && /Get DIAL IN\+/i.test(pay) && /Every past puzzle/.test(pay), pay.replace(/\n+/g,' | ').slice(0, 220));
  await p.screenshot({ path: SP + '/plus-pay.png' });
  await p.click('#dlg-pay [data-close]');
  // reload keeps the archive game
  await p.reload({ waitUntil:'load' }); await p.waitForTimeout(800);
  ok('archive play survives a reload', await p.evaluate(x => S.archive[x] && S.archive[x].done && S.archFree === x, d));
  // buyer: everything open
  await p.evaluate(() => { Backend.on = true; S.premium = { active:true, source:'stripe', at:Date.now() }; save(); go('archive'); }); await p.waitForTimeout(300);
  ok('buyers: no locks, no offer', await p.locator('.archlist .ico').count() === 0 && !/Catch up on every puzzle/.test(await p.innerText('#app')));
  await p.click(`[data-act=archopen][data-d="${other}"]`); await p.waitForTimeout(300);
  ok('buyers can open any past puzzle', await p.evaluate(x => App.view === 'arch' && App.archDate === x, other));
  // a day played for real shows its daily score and can't be replayed
  await p.evaluate(() => { const d = archDates()[1], ids = dailyIds(d); S.days[d] = { ids, answers: ids.map(() => ({ g:1, s:600, t:1 })), st:Array(7).fill(null), done:true, synced:true, doneAt:1 }; go('archive'); }); await p.waitForTimeout(300);
  ok('days you played on the day show your score', await p.evaluate(() => { const b = document.querySelector(`[data-d="${archDates()[1]}"]`); return b.disabled && /4,200/.test(b.innerText) && /Played on the day/.test(b.innerText); }));
  ok('fits a small phone', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  ok('no page errors', !errs.length, errs.join(' / '));
  await b.close();
})();
