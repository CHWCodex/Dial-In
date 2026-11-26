const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
// Trying to break the daily game the way real players (and impatient thumbs) do. Staging only.
const { chromium, devices } = require('playwright');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (x ? ' | ' + x : '')); };
const day = p => p.evaluate(() => { const d = S.days[App.today]; return d ? { n: d.answers.filter(Boolean).length, a: d.answers.map(a => a && (a.to ? 'T' : a.s)), done: d.done } : null; });
async function fresh(b, opts = {}, init) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...opts });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(); p.setDefaultTimeout(15000); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  return { ctx, p };
}
const startDailyNow = p => p.evaluate(() => { S.player.name = S.player.name || 'QA Adversary'; save(); startDaily(); });
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);

  // 1. impatient thumbs
  { const { ctx, p } = await fresh(b); await startDailyNow(p); await p.waitForSelector('#enterkey');
    await p.click('[data-act=key][data-k="7"]');
    await Promise.all(Array.from({ length: 6 }, () => p.click('#enterkey', { force: true, noWaitAfter: true }).catch(() => {})));
    await p.waitForTimeout(800);
    let d = await day(p); ok('Lock it in tapped 6 times at once: one answer, scored once', d.n === 1, JSON.stringify(d.a));
    await p.waitForTimeout(2200); if (await p.locator('#nextbtn').count()) await p.click('#nextbtn');
    await p.waitForSelector('#enterkey'); await p.keyboard.type('12');
    for (let i = 0; i < 10; i++) await p.keyboard.press('Enter');
    await p.waitForTimeout(800); d = await day(p);
    ok('Enter pressed 10 times: one answer for question 2, question 3 not skipped', d.n === 2 && d.a[2] === null, JSON.stringify(d.a));
    // 2. the timer and the answer arrive together
    await p.waitForTimeout(2200); if (await p.locator('#nextbtn').count()) await p.click('#nextbtn'); await p.waitForSelector('#enterkey');
    await p.evaluate(() => { const d = S.days[App.today]; d.st[App.cur] = Date.now() - (qSeconds() * 1000 - 150); save(); Timer.deadline = d.st[App.cur] + qSeconds() * 1000; });
    await p.click('[data-act=key][data-k="3"]'); await p.waitForTimeout(120); await p.click('#enterkey', { force: true }).catch(() => {});
    await p.waitForTimeout(1500); d = await day(p);
    ok('Answer locked in as the timer runs out: exactly one result (answer or time-out), not both', d.n === 3 && d.a[3] === null, JSON.stringify(d.a));
    // 3. refreshing doesn't buy extra time
    await p.waitForTimeout(1500); if (await p.locator('#nextbtn').count()) await p.click('#nextbtn'); await p.waitForSelector('#enterkey');
    await p.waitForTimeout(3000); const before = await p.evaluate(() => Timer.left());
    await p.reload(); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    if (!(await p.locator('#enterkey').count())) await p.evaluate(() => startDaily()); await p.waitForSelector('#enterkey');
    const after = await p.evaluate(() => Timer.left());
    ok('Refreshing mid-question keeps the clock running (no extra time)', after <= before && after > before - 4000, `${Math.round(before)}ms before, ${Math.round(after)}ms after`);
    // 4. phone locked / tab in the background longer than the timer
    await p.evaluate(() => { const d = S.days[App.today]; d.st[App.cur] = Date.now() - (qSeconds() + 30) * 1000; save(); Timer.deadline = 0; });
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(2500); d = await day(p);
    ok('Coming back after the phone was locked past the timer: that question is timed out, the game carries on', d.n === 4 && d.a[3] === 'T', JSON.stringify(d.a));
    ok('No page errors (taps, timer, refresh, background)', !p.errs.length, p.errs.join(' / '));
    await ctx.close(); }

  // 5. two tabs on the same question
  { const { ctx, p } = await fresh(b); await startDailyNow(p); await p.waitForSelector('#enterkey');
    const p2 = await ctx.newPage(); p2.errs = []; p2.on('pageerror', e => p2.errs.push(e.message)); await p2.goto(BASE_URL); await p2.waitForTimeout(1500);
    await p2.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); startDaily(); }); await p2.waitForSelector('#enterkey');
    await p.click('[data-act=key][data-k="5"]'); await p.click('#enterkey'); await p.waitForTimeout(1000);
    await p2.click('[data-act=key][data-k="9"]').catch(() => {}); await p2.click('#enterkey', { force: true }).catch(() => {}); await p2.waitForTimeout(1000);
    const a1 = await p.evaluate(() => S.days[App.today].answers[0] && S.days[App.today].answers[0].g), a2 = await p2.evaluate(() => S.days[App.today].answers[0] && S.days[App.today].answers[0].g);
    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)).days[App.today].answers[0].g);
    ok('Same question answered in two tabs: the first answer stands everywhere', a1 === 5 && a2 === 5 && stored === 5, `tab1 ${a1}, tab2 ${a2}, saved ${stored}`);
    ok('No page errors in either tab', !p.errs.length && !p2.errs.length, p.errs.concat(p2.errs).join(' / '));
    await ctx.close(); }

  // 6. storage that doesn't work (private browsing, blocked cookies, full disk)
  for (const [label, init] of [
    ['localStorage blocked entirely', () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); }],
    ['storage full (every write fails)', () => { const s = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; }],
    ['corrupted saved game', () => { try { localStorage.setItem('pinpoint:v1', '{"days":{"2026-11-26":{"ids":[1,2],"answers":"x"}},"player":7,"premium":"yes","sound":"loud"'); } catch (e) {} }]]) {
    const { ctx, p } = await fresh(b, {}, init);
    const home = await p.locator('.dcard').count();
    await startDailyNow(p).catch(() => {}); await p.waitForTimeout(800);
    const playing = await p.locator('#enterkey').count();
    if (playing) { await p.click('[data-act=key][data-k="4"]'); await p.click('#enterkey'); await p.waitForTimeout(800); }
    const d = await day(p).catch(() => null);
    ok(`${label}: the game still opens and can be played`, home === 1 && playing === 1 && d && d.n === 1, JSON.stringify(d));
    ok(`${label}: no page errors`, !p.errs.length, p.errs.slice(0, 2).join(' / '));
    await ctx.close();
  }

  // 7. connection drops right before / after locking in
  { const { ctx, p } = await fresh(b); await startDailyNow(p); await p.waitForSelector('#enterkey');
    await ctx.setOffline(true);
    for (let i = 0; i < 7; i++) { await p.waitForSelector('#enterkey'); await p.click('[data-act=key][data-k="5"]'); await p.click('#enterkey'); await p.waitForTimeout(2400); if (await p.locator('#nextbtn').count()) await p.click('#nextbtn'); await p.waitForTimeout(300); }
    const d = await day(p);
    ok('Offline for the whole game: every answer is kept on the phone', d.n === 7 && d.done, JSON.stringify(d.a));
    const v = await p.evaluate(() => App.view);
    ok('…and it reaches the bonus round/results without a network', ['pinball', 'results'].includes(v), v);
    await ctx.setOffline(false); await p.waitForTimeout(500);
    ok('No page errors offline', !p.errs.length, p.errs.join(' / '));
    await ctx.close(); }

  // 8. Dial Ball: refresh mid-flight can't re-roll a ball or add balls
  { const { ctx, p } = await fresh(b);
    await p.evaluate(() => { S.player.name = 'QA Ball'; const d = getDay(App.today, true); d.answers = d.ids.map(id => ({ g: BY_ID.get(id).answer, s: 1000, t: Date.now() })); finishDay(d); save(); go('pinball'); });
    await p.waitForTimeout(1200);
    const balls = await p.evaluate(() => S.days[App.today].pin && S.days[App.today].pin.balls);
    await p.click('[data-act=pinstart]'); await p.waitForSelector('#pinlaunch'); await p.click('#pinlaunch'); await p.waitForTimeout(400);
    const mid = await p.evaluate(() => ({ ...S.days[App.today].pin }));
    await p.reload(); await p.waitForTimeout(1500);
    const after = await p.evaluate(() => { const x = S.days[App.today].pin; return { balls: x.balls, used: x.used, hits: x.hits.length, bonus: x.bonus, done: x.done }; });
    ok('Bonus round: refreshing mid-flight doesn\'t give the balls back', mid.used > 0 && after.used >= mid.used && after.balls === balls, JSON.stringify({ mid: { used: mid.used, hits: mid.hits.length }, after }));
    ok('…bonus never exceeds what the balls allow', after.bonus <= after.balls * 400 && after.hits <= after.used);
    await p.evaluate(() => { App.pinGo = true; go('pinball'); }); await p.waitForTimeout(500);
    for (let i = 0; i < 5; i++) await p.click('#pinlaunch', { force: true, noWaitAfter: true }).catch(() => {});
    await p.waitForFunction(() => S.days[App.today].pin.done, null, { timeout: 40000 }).catch(() => {});
    const end = await p.evaluate(() => { const x = S.days[App.today].pin; return { used: x.used, hits: x.hits.length, balls: x.balls, done: x.done }; });
    ok('…launch button hammered: never more balls fired than earned, and the round finishes', end.used === end.balls && end.hits <= end.balls && end.done, JSON.stringify(end));
    ok('No page errors in the bonus round', !p.errs.length, p.errs.join(' / '));
    await ctx.close(); }

  // 9. navigation abuse, deep links and odd URLs
  { const { ctx, p } = await fresh(b);
    for (let i = 0; i < 40; i++) await p.click(`.navtab[data-nav=${['home', 'modes', 'board', 'settings'][i % 4]}]`, { noWaitAfter: true }).catch(() => {});
    await p.waitForTimeout(1500);
    ok('40 rapid tab switches: still on a working screen', await p.locator('#app section, #app .stack').count() > 0 && !p.errs.length, p.errs.join(' / '));
    for (const u of ['?ref=tiktok', '#/ranks', '?r=<img src=x onerror=alert(1)>', '?c=%E0%A4%A', 'index.html?utm_source=ig&x=' + 'a'.repeat(3000)]) {
      const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
      await p.goto(BASE_URL + u).catch(() => {}); await p.waitForTimeout(1200);
      ok(`Odd link ${u.slice(0, 40)}: opens the game, nothing injected`, (await p.locator('.tabbar').count()) === 1 && !dialogs.length && !p.errs.length, p.errs.concat(dialogs).join(' / '));
    }
    await ctx.close(); }

  // 10. phones held sideways, zoomed, big text, reduced motion
  for (const [label, opts, css] of [['landscape phone', { viewport: { width: 844, height: 390 } }, ''], ['200% browser zoom', {}, 'html{zoom:2}'],
    ['largest system text (150%)', {}, 'html{font-size:150% !important}'], ['reduced motion', { reducedMotion: 'reduce' }, '']]) {
    const { ctx, p } = await fresh(b, opts);
    if (css) await p.addStyleTag({ content: css });
    await startDailyNow(p); await p.waitForTimeout(800);
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const enter = await p.locator('#enterkey').boundingBox();
    if (enter) { await p.click('[data-act=key][data-k="8"]'); await p.click('#enterkey'); await p.waitForTimeout(600); }
    const d = await day(p);
    ok(`${label}: playable (answer locked in, no sideways scroll)`, !sideways && enter && d.n === 1, `sideways ${sideways}`);
    await ctx.close();
  }

  // 11. keyboard only
  { const { ctx, p } = await fresh(b, { isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } });
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) { await p.keyboard.press('Tab'); reached = await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('dc-go')); }
    ok('Keyboard: Tab reaches the Play button', reached);
    await p.keyboard.press('Enter'); await p.waitForTimeout(800);
    await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); if (!(await p.locator('#enterkey').count())) await startDailyNow(p);
    await p.waitForSelector('#enterkey'); await p.keyboard.type('42'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
    const d = await day(p);
    ok('Keyboard: typing a number and pressing Enter answers the question', d.n === 1, JSON.stringify(d.a));
    await ctx.close(); }

  // 12. nobody meets today's (or an upcoming) daily question early in Unlimited or Battles
  { const { ctx, p } = await fresh(b);
    const r = await p.evaluate(() => {
      const win = new Set(); for (let i = -3; i <= 30; i++) (dailyIds(DateUK.add(App.today, i)) || []).forEach(id => win.add(factOf(id)));
      const fwin = new Set(); for (let i = -3; i <= 30; i++) (factDailyIds(DateUK.add(App.today, i)) || []).forEach(id => fwin.add(ffactOf(id)));
      let unl = 0, bat = 0, fb = 0, n = 0, recent = [];
      for (let k = 0; k < 600; k++) { const x = pickEndless('qa-player', n, recent); n = x.n + 1; recent.push(x.q.id); if (win.has(factOf(x.q.id))) unl++; }
      for (let s = 0; s < 200; s++) { const used = []; for (let round = 1; round <= 10; round++) { const q = battleQ('seed' + s, round, used); used.push(q.id); if (win.has(factOf(q.id))) bat++; } }
      for (let s = 0; s < 100; s++) { const used = []; for (let round = 1; round <= 5; round++) { const f = factBattlePick('fs' + s, round, used); used.push(f.id); if (fwin.has(ffactOf(f.id))) fb++; } }
      const repeatsInRun = recent.length - new Set(recent.map(factOf)).size;
      return { window: win.size, unl, bat, fb, repeatsInRun };
    });
    ok('Unlimited: 600 questions in a row, none from the daily window (3 days back, 30 ahead), no fact twice', r.unl === 0 && r.repeatsInRun === 0, JSON.stringify(r));
    ok('Battles: 2,000 rounds across 200 rooms, none from the daily window', r.bat === 0);
    ok('Fact Check battles: none of the daily claims from the window', r.fb === 0);
    await ctx.close(); }

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
