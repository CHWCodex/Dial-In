const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
// Independent final pass: midnight with the game open, long sessions (memory), every internal link and asset, every static page.
const { chromium } = require('playwright');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (x ? ' | ' + x : '')); };
(async () => {
  const b = await chromium.launch({ ...require('./_guard').LAUNCH, args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  // 1. midnight passes while a question is open
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.clock.install({ time: new Date('2026-11-26T23:59:20Z') });   // 23:59:20 UK (GMT)
    await p.goto(BASE_URL); await p.waitForTimeout(1500); await p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); S.player.name = 'QA Midnight'; save(); startDaily(); });
    await p.waitForSelector('#enterkey'); await p.click('[data-act=key][data-k="4"]'); await p.click('#enterkey'); await p.waitForTimeout(500);
    const before = await p.evaluate(() => ({ today: App.today, n: S.days[App.today].answers.filter(Boolean).length }));
    await p.clock.fastForward('01:30'); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1500);
    const during = await p.evaluate(() => ({ today: App.today, view: App.view }));
    ok('Midnight passes mid-puzzle: the player finishes yesterday\'s game first (by design)', during.today === '2026-11-26' && during.view === 'play', JSON.stringify(during));
    await p.evaluate(() => go('home')); await p.clock.fastForward(2000); await p.waitForTimeout(500);
    const after = await p.evaluate(() => ({ today: App.today, home: !!document.querySelector('.dcard'), yesterday: S.days['2026-11-26'] && S.days['2026-11-26'].answers.filter(Boolean).length }));
    ok('…back on Home the new day starts, and yesterday\'s answers are kept', after.today === '2026-11-27' && after.home && after.yesterday >= 1, JSON.stringify({ before, after }));
    await p.evaluate(() => startDaily()); await p.waitForTimeout(800);
    const newDay = await p.evaluate(() => ({ ids: S.days[App.today] && S.days[App.today].ids.join(','), want: dailyIds(App.today).join(',') }));
    ok('…and today\'s puzzle is the scheduled one for the new date', newDay.ids === newDay.want);
    ok('…no page errors across midnight', !errs.length, errs.join(' / '));
    await ctx.close(); }
  // 2. long session: 150 Unlimited questions and 300 screen changes; memory and timers must not pile up
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE_URL); await p.waitForTimeout(1500); await p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); S.player.name = 'QA Long'; S.premium = { active: true, source: 'demo', at: Date.now() }; save(); });
    const heap = () => p.evaluate(() => { if (window.gc) gc(); return performance.memory.usedJSHeapSize; });
    const h0 = await heap(), nodes0 = await p.evaluate(() => document.getElementsByTagName('*').length);
    for (let i = 0; i < 300; i++) await p.evaluate(v => go(v), ['home', 'modes', 'board', 'settings', 'stats', 'facthome', 'archive'][i % 7]);
    await p.evaluate(() => { go('endless'); }); await p.click('[data-act=startrun]').catch(() => {});
    for (let i = 0; i < 150; i++) { await p.evaluate(() => { const r = S.run; if (!r || r.over) { startRun && startRun(); return; } App.entry = String(r.q.answer); submitRun(false); }); await p.evaluate(() => { if (S.run && S.run.ans) nextRun(); }); }
    await p.evaluate(v => go('home')); await p.waitForTimeout(1000);
    const h1 = await heap(), nodes1 = await p.evaluate(() => document.getElementsByTagName('*').length);
    const timers = await p.evaluate(() => { let n = 0; const id = setInterval(() => {}, 1e6); clearInterval(id); return id; });
    ok('Long session: memory doesn\'t keep growing (300 screen changes + 150 questions)', h1 < h0 * 1.6 + 4e6, `${(h0 / 1e6).toFixed(1)} MB → ${(h1 / 1e6).toFixed(1)} MB`);
    ok('…the page doesn\'t pile up elements', nodes1 < nodes0 * 1.5 + 200, `${nodes0} → ${nodes1} elements`);
    ok('…no page errors', !errs.length, errs.slice(0, 3).join(' / '));
    await ctx.close(); }
  // 3. every static page, internal link and asset
  { const ctx = await b.newContext(); const p = await ctx.newPage();
    const pages = ['', 'how-to-play.html', 'privacy.html', 'terms.html', 'past-puzzles.html', 'number-trivia-questions.html', 'estimation-game.html', 'dial-in-answers-1.html', 'dial-in-answers-31.html', '404.html'];
    const links = new Set(), broken = [], errs = [];
    for (const pg of pages) {
      const failed = []; p.removeAllListeners('requestfailed'); p.on('requestfailed', r => { if (r.url().startsWith(BASE_URL)) failed.push(r.url()); });
      p.removeAllListeners('pageerror'); p.on('pageerror', e => errs.push(pg + ': ' + e.message));
      const r = await p.goto(BASE_URL + pg); await p.waitForTimeout(600);
      if (!r || r.status() !== 200) broken.push(pg + ' ' + (r && r.status()));
      (await p.evaluate(() => [...document.querySelectorAll('a[href], link[href], script[src], img[src], source[src]')].map(e => e.href || e.src))).forEach(u => links.add(u));
      broken.push(...failed);
    }
    const internal = [...links].filter(u => u.startsWith(BASE_URL) && !/[?#]/.test(u.replace(BASE_URL, '')));
    for (const u of internal) {
      let path = u.replace(BASE_URL, ''); if (path && !/\.[a-z0-9]+$/i.test(path)) path += '.html';   // the live site serves /how-to-play for how-to-play.html
      const res = await p.request.get(BASE_URL + path).catch(() => null);
      if (!res || res.status() !== 200) broken.push(u);
    }
    ok(`Every page loads and every internal link and asset exists (${internal.length} checked)`, !broken.length, broken.slice(0, 6).join(', '));
    ok('No script errors on any page', !errs.length, errs.slice(0, 3).join(' / '));
    await ctx.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
