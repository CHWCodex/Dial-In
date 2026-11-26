const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
// Upgrade from the live version (v44) to the redesign (v45) on a device with the offline app installed and a game in progress.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const U = __dirname, BASE = 'https://localhost:8443/';
let fails = 0; const ok = (n, c, x='') => { if (!c) fails++; console.log((c?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
(async () => {
  fs.writeFileSync(U + '/which', 'old');
  const b = await chromium.launch({ args:['--ignore-certificate-errors'] });
  const ctx = await b.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors:true });
  await ctx.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE); await p.waitForTimeout(2500);
  await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForTimeout(2000);
  const sw1 = await p.evaluate(async () => (await caches.keys()).join(','));
  ok('Live version installed with its offline cache', /dialin-v44/.test(sw1) && await p.evaluate(() => !!navigator.serviceWorker.controller), sw1);
  ok('…and it is the old layout (no bottom navigation)', await p.locator('.tabbar').count() === 0);
  // play 3 of 7 daily questions, set a name, turn sound off
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await p.evaluate(() => { S.player.name = 'QA Upgrader'; S.sound = false; save(); startDaily(); }); await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 3; i++) { await p.waitForSelector('#enterkey'); await p.click('[data-act=key][data-k="5"]'); await p.click('#enterkey'); await p.waitForTimeout(2600); await p.click('#nextbtn'); await p.waitForTimeout(300); }
  const before = await p.evaluate(() => ({ n:S.days[App.today].answers.filter(Boolean).length, pts:S.days[App.today].answers.filter(Boolean).map(a => a.s), name:S.player.name, sound:S.sound, id:S.player.id }));
  ok('Old version: 3 questions answered mid-game', before.n === 3, JSON.stringify(before.pts));
  // the redesign is deployed
  fs.writeFileSync(U + '/which', 'new');
  await p.goto(BASE); await p.waitForTimeout(3500);
  const reg = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); return true; }); await p.waitForTimeout(2500);
  await p.reload(); await p.waitForTimeout(3000);
  ok('First visit after the release shows the redesign (bottom navigation)', await p.locator('.tabbar').count() === 1 && await p.locator('.dcard').count() === 1);
  const after = await p.evaluate(() => ({ n:S.days[App.today].answers.filter(Boolean).length, pts:S.days[App.today].answers.filter(Boolean).map(a => a.s), name:S.player.name, sound:S.sound, id:S.player.id }));
  ok('Progress, name, player id and settings carried over unchanged', JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
  ok('Home offers "Continue · question 4 of 7"', /question 4 of 7/i.test(await p.innerText('.dcard')));
  const keys = await p.evaluate(async () => (await caches.keys()).join(','));
  ok('New offline cache in place and the old one removed', keys === 'dialin-v45', keys);
  await p.click('.dc-go'); await p.waitForSelector('#enterkey');
  ok('Continuing picks up at question 4 with no lost answers', await p.evaluate(() => App.cur === 3));
  // offline after the upgrade
  await ctx.setOffline(true); await p.reload(); await p.waitForTimeout(3500);
  ok('Offline: the redesigned game still opens from the cache, progress intact', await p.locator('.tabbar').count() === 1 && await p.evaluate(() => S.days[App.today].answers.filter(Boolean).length) === 3);
  await ctx.setOffline(false);
  ok('No page errors (old or new version)', !errs.length, errs.slice(0, 3).join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
