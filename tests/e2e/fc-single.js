const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
let fails = 0; const ok = (n, p, x='') => { if (!p) fails++; console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
const BASE = BASE_URL;
async function open(b, vp = { width:360, height:640 }){
  const ctx = await b.newContext({ viewport:vp, permissions:['clipboard-read','clipboard-write'] }); const p = await ctx.newPage(); p.setDefaultTimeout(15000); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message)); await p.route('**/*supabase.co/**', r => r.abort());
  await p.goto(BASE, { waitUntil:'load' }); await p.waitForTimeout(900); return p;
}
const wide = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  const A = await open(b);
  // ---- placement
  // redesign: Home is the Daily card, with Fact Check! the next card under it
  const order = await A.evaluate(() => [...document.querySelectorAll('#app .dcard, #app .mode')].map(m => m.classList.contains('dcard') ? 'play' : m.dataset.act));
  ok('Home: Fact Check! sits directly under the Daily', order[0] === 'play' && order[1] === 'facthome', order.join(' > '));
  // ---- the daily schedule: same for everyone, balanced, no repeats within a cycle
  const sched = await A.evaluate(() => {
    const out = { badDays:[], repeats:0, days:0, perCycle: Math.floor(FACTS.length / 7) };
    const seen = new Set(); let d = FACT_EPOCH;
    for (let i = 0; i < out.perCycle * 2 + 5; i++) {
      const ids = factDailyIds(d), fs = ids.map(id => FACT_BY_ID.get(id)), t = fs.filter(f => f.truth).length, cats = {};
      fs.forEach(f => cats[f.category] = (cats[f.category] || 0) + 1);
      if (ids.length !== 7 || new Set(ids).size !== 7 || t < 2 || t > 5 || Math.max(...Object.values(cats)) > 2) out.badDays.push(d + ':' + t + 'T');
      if (i < out.perCycle) { ids.forEach(id => { if (seen.has(id)) out.repeats++; seen.add(id); }); }
      d = DateUK.add(d, 1); out.days++;
    }
    out.stable = JSON.stringify(factDailyIds(App.today)) === JSON.stringify(factDailyIds(App.today));
    return out;
  });
  ok(`Daily mixes are valid for ${sched.days} days (7 different claims, 2–5 true, ≤2 per topic)`, !sched.badDays.length, sched.badDays.slice(0, 5).join(', '));
  ok(`No claim repeats within a ${sched.perCycle}-day cycle`, sched.repeats === 0);
  const B = await open(b);
  ok('Two different players get the same daily claims', JSON.stringify(await A.evaluate(() => factDailyIds(App.today))) === JSON.stringify(await B.evaluate(() => factDailyIds(App.today))));
  // ---- playing the daily
  await A.click('.m-fact'); await A.waitForTimeout(300); await A.click('[data-act=factdaily]'); await A.waitForTimeout(600);
  ok('Daily opens on claim 1 with TRUE and FALSE buttons and a timer', await A.locator('.fct-half.t').count() === 1 && await A.locator('.fct-half.f').count() === 1 && await A.locator('#tfill').count() === 1);
  const truth = await A.evaluate(() => factDailyIds(App.today).map(id => FACT_BY_ID.get(id).truth));
  // claim 1: right answer by tapping, double-tapped
  await A.locator(`.fct-half.${truth[0] ? 't' : 'f'}`).dblclick(); await A.waitForTimeout(500);
  const a1 = await A.evaluate(() => S.facts.days[App.today].ans);
  ok('A double tap records exactly one answer', a1.filter(Boolean).length === 1 && a1[0].ok && a1[0].p >= 100 && a1[0].p <= 150, JSON.stringify(a1[0]));
  ok('Answered claim shows the stamp, verdict and real fact', await A.locator('.fc-stamp').count() === 1 && /Correct|Lightning/.test(await A.innerText('.fc-verdict')) && /THE TRUTH\s*(TRUE|FALSE)/i.test(await A.innerText('.fc-truth')));
  await A.click('#nextbtn'); await A.waitForTimeout(400);
  // claim 2: wrong answer with the keyboard
  await A.keyboard.press(truth[1] ? 'ArrowLeft' : 'ArrowRight'); await A.waitForTimeout(400);
  const a2 = await A.evaluate(() => S.facts.days[App.today].ans[1]);
  ok('Keyboard arrows answer; a wrong answer scores 0', a2 && !a2.ok && a2.p === 0, JSON.stringify(a2));
  await A.keyboard.press('Enter'); await A.waitForTimeout(400);
  ok('Enter moves to the next claim', await A.evaluate(() => App.fcur === 2));
  // claim 3: leave mid-claim, come back, time has kept running
  await A.waitForTimeout(3000); await A.evaluate(() => go('home')); await A.waitForTimeout(500); await A.click('.m-fact'); await A.click('[data-act=factdaily]'); await A.waitForTimeout(500);
  const left = await A.evaluate(() => Timer.left());
  ok('Leaving mid-claim and coming back keeps the same claim and the clock running', await A.evaluate(() => App.fcur === 2) && left < 9500, Math.round(left / 100) / 10 + 's left');
  // claim 3: let the clock run out
  await A.waitForTimeout(left + 900);
  const a3 = await A.evaluate(() => S.facts.days[App.today].ans[2]);
  ok('Running out of time counts as a time-out (0 points)', a3 && a3.to && a3.p === 0 && /Time’s up/.test(await A.innerText('.fc-verdict')));
  await A.click('#nextbtn'); await A.waitForTimeout(400);
  // claim 4: reload mid-claim; then reload again after its time is gone
  await A.reload({ waitUntil:'load' }); await A.waitForTimeout(700);
  await A.click('.m-fact'); await A.click('[data-act=factdaily]'); await A.waitForTimeout(500);
  ok('After a reload, the same claim comes back', await A.evaluate(() => App.fcur === 3 && !S.facts.days[App.today].ans[3]));
  await A.evaluate(() => { S.facts.days[App.today].st[3] = Date.now() - 60000; save(); }); await A.reload({ waitUntil:'load' }); await A.waitForTimeout(700);
  await A.click('.m-fact'); await A.waitForTimeout(400);
  ok('Coming back long after a claim’s time ran out counts it as a time-out', await A.evaluate(() => { const a = S.facts.days[App.today].ans[3]; return a && a.to; }));
  await A.click('[data-act=factdaily]'); await A.waitForTimeout(500);
  // finish the rest correctly (some by tap, some by T/F letters)
  for (let i = 4; i < 7; i++) { await A.waitForSelector('.fct-half'); if (i === 5) await A.keyboard.press(truth[i] ? 't' : 'f'); else await A.click(`.fct-half.${truth[i] ? 't' : 'f'}`); await A.waitForTimeout(450); await A.click('#nextbtn'); await A.waitForTimeout(450); }
  const res = await A.evaluate(() => ({ view:App.view, right:factDayRight(S.facts.days[App.today]), pts:factDayScore(S.facts.days[App.today]) }));
  ok('After 7 claims: results screen with 4/7 right', res.view === 'factres' && res.right === 4 && res.pts >= 400 && res.pts <= 600, JSON.stringify(res));
  ok('Results: tiles, title, share, review list, DIAL IN+ offer', await A.locator('.fc-tiles .tile').count() === 7 && await A.locator('.fc-row').count() === 7 && /Unlimited Fact Check/i.test(await A.innerText('#app')) && !(await wide(A)));
  await A.click('[data-act=factshare]'); await A.waitForTimeout(600);
  const share = await A.evaluate(async () => { const d = document.querySelector('#dlg-copy'); if (d && d.open) { const v = document.querySelector('#copy-text').value; d.close(); return v; } try { return await navigator.clipboard.readText(); } catch(e){ return ''; } });
  ok('Share text: number, score and 7 squares (no answers given away)', /Fact Check! #\d+/.test(share) && /4\/7 right/.test(share) && /^[🟩🟥]{7}$/mu.test(share), share.replace(/\n/g, ' ⏎ '));
  await A.click('.fc-row >> nth=1'); await A.waitForTimeout(400);
  ok('Tapping an answer lets you review it without changing it', await A.evaluate(() => App.view === 'factplay' && App.fcur === 1) && await A.locator('button.fct-half').count() === 0);
  await A.evaluate(() => go('home')); await A.waitForTimeout(300);
  ok('Home card now shows "Done · 4/7 right"', /Done · 4\/7 right/i.test(await A.innerText('.m-fact')));
  await A.click('.m-fact'); await A.click('[data-act=factdaily]'); await A.waitForTimeout(400);
  ok('Opening the daily again goes to results (can’t replay)', await A.evaluate(() => App.view === 'factres'));
  // ---- midnight in the middle of the daily
  const M = await open(b); await M.click('.m-fact'); await M.click('[data-act=factdaily]'); await M.waitForTimeout(400);
  const day0 = await M.evaluate(() => App.today);
  await M.evaluate(() => { window.__next = DateUK.add(DateUK.today(), 1); DateUK.today = () => window.__next; }); await M.waitForTimeout(1500);
  const mt = await M.evaluate(() => factDailyIds(App.fdate).map(id => FACT_BY_ID.get(id).truth));
  for (let i = 0; i < 7; i++) { await M.waitForSelector('.fct-half'); await M.click(`.fct-half.${mt[i] ? 't' : 'f'}`); await M.waitForTimeout(350); await M.click('#nextbtn'); await M.waitForTimeout(350); }
  ok('Midnight mid-daily: you finish yesterday’s Fact Check (7/7 here)', await M.evaluate(d => App.view === 'factres' && App.fdate === d && factDayRight(S.facts.days[d]) === 7, day0));
  await M.evaluate(() => go('home')); await M.waitForTimeout(1500);
  ok('…and back home, the new day’s Fact Check is waiting', await M.evaluate(d => App.today !== d, day0) && /7 claims a day/i.test(await M.innerText('.m-fact')));
  // ---- Unlimited
  const U = await open(b); await U.click('.m-fact'); await U.click('[data-act=factrun]'); await U.waitForTimeout(400);
  ok('Unlimited without DIAL IN+ opens the DIAL IN+ screen (which lists Unlimited Fact Check)', await U.locator('#dlg-pay[open]').count() === 1 && /Unlimited Fact Check/.test(await U.innerText('#dlg-pay')));
  await U.click('#dlg-pay [data-close]');
  await U.evaluate(() => { S.premium = { active:true, source:'stripe', at:Date.now() }; save(); }); await U.click('[data-act=factrun]'); await U.waitForTimeout(400);
  ok('With DIAL IN+, an Unlimited run starts with 3 hearts', await U.evaluate(() => App.view === 'factplay' && S.frun && S.frun.lives === 3));
  const ids = []; let guard = 0;
  while (guard++ < 60) {   // answer right 20 times, then wrong until out
    const st = await U.evaluate(() => ({ id:S.frun.id, t:FACT_BY_ID.get(S.frun.id).truth, over:S.frun.over, lives:S.frun.lives })); if (st.over) break; ids.push(st.id);
    const right = ids.length <= 20; await U.click(`.fct-half.${(st.t === right) ? 't' : 'f'}`); await U.waitForTimeout(200);
    if (ids.length === 10) { await U.reload({ waitUntil:'load' }); await U.waitForTimeout(600); await U.evaluate(() => { App.fmode = 'run'; go('factplay'); }); await U.waitForTimeout(300); }
    await U.click('#nextbtn'); await U.waitForTimeout(200);
  }
  const run = await U.evaluate(() => ({ view:App.view, r:S.frun, best:S.facts.best, bestN:S.facts.bestN }));
  ok('Run ends after 3 mistakes; 20 right, best saved', run.view === 'factres' && run.r.over && run.r.right === 20 && run.r.lives === 0 && run.best === run.r.score && run.bestN === 20, `score ${run.r.score}, streak ${run.r.bestStreak}`);
  ok('No claim repeats within the run (even across a reload)', new Set(ids).size === ids.length, ids.length + ' claims');
  await U.click('[data-act=factrun]'); await U.waitForTimeout(300);
  const next = await U.evaluate(() => S.frun.id);
  ok('Play again continues through new claims (no repeat of the last run)', !ids.includes(next));
  // ---- tampered and merged saves
  const t = await A.evaluate(() => {
    const raw = JSON.parse(JSON.stringify(S));
    const d = raw.facts.days[App.today]; d.ans[0] = { v:1, ok:true, p:9999 }; d.ans[1] = { v:'yes' }; raw.facts.best = -5; raw.frun = { id:'fake', lives:3 };
    raw.facts.days['2026-12-01'] = { ids:['f001','f001','f002','f003','f004','f005','f006'], ans:[] };
    const c = sanitize(raw), cd = c.facts.days[App.today];
    return { p0:cd.ans[0].p, ok0:cd.ans[0].ok === (FACT_BY_ID.get(cd.ids[0]).truth === true), a1:cd.ans[1], best:c.facts.best, frun:c.frun, dupDay:!!c.facts.days['2026-12-01'] };
  });
  ok('Tampered saves are cleaned (points capped, bad answers/claims/runs dropped)', t.p0 <= 150 && t.ok0 && t.a1 === null && t.best === 0 && t.frun === null && !t.dupDay, JSON.stringify(t));
  const m = await A.evaluate(() => { const a = sanitize(JSON.parse(JSON.stringify(S))), b2 = blankState(); b2.facts.best = 999; b2.facts.days['2026-11-01'] = JSON.parse(JSON.stringify(a.facts.days[App.today])); b2.updatedAt = 1; const out = mergeStates(a, sanitize(b2)); return { best:out.facts.best, days:Object.keys(out.facts.days).length }; });
  ok('Saves from two devices merge (best and days kept)', m.best === 999 && m.days >= 2, JSON.stringify(m));
  // ---- small screens
  for (const w of [320, 414]) for (const v of ['facthome', 'factres']) { await A.setViewportSize({ width:w, height:740 }); await A.evaluate(x => { App.fmode = 'daily'; App.fdate = App.today; go(x); }, v); await A.waitForTimeout(200); ok(`${v} fits a ${w}px screen`, !(await wide(A))); }
  const P = await open(b, { width:320, height:568 }); await P.click('.m-fact'); await P.click('[data-act=factdaily]'); await P.waitForTimeout(400);
  ok('Claim screen fits an iPhone SE (buttons visible without scrolling)', !(await wide(P)) && await P.evaluate(() => document.querySelector('.fct-half.t').getBoundingClientRect().bottom <= innerHeight + 2));
  const errs = [A, B, M, U, P].flatMap(p => p.errs); ok('No page errors', !errs.length, errs.join(' / '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
