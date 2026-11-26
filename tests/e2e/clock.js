const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
// Device clock wrong + same game open in two tabs: the server must accept only today's (or last night's) result, once.
const { chromium } = require('playwright');
let fails = 0; const ok = (n, p, x='') => { if (!p) fails++; console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  const ctx = await b.newContext({ viewport:{ width:390, height:844 } });
  await ctx.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort());
  const A = await ctx.newPage(); A.setDefaultTimeout(20000); const errs = []; A.on('pageerror', e => errs.push(e.message));
  await A.goto(BASE_URL, { waitUntil:'networkidle' }); await A.waitForTimeout(2500);
  const uid = await A.evaluate(async () => { await Backend.auth(); return Backend.sess.user_id; });
  const ids = await A.evaluate(() => getDay(App.today, true).ids);
  // device clock two days ahead / behind: posting another day's result is refused by the server
  for (const [label, off] of [['tomorrow', 1], ['two days ago', -2], ['a week ahead', 7]]) {
    const r = await A.evaluate(async ([off, ids]) => { try { await Backend.rpc('submit_result', { p_date: DateUK.add(DateUK.today(), off), p_question_ids: ids, p_guesses: [1,2,3,4,5,6,7], p_bonus: 0 }); return 'accepted'; } catch(e) { return e.message; } }, [off, ids]);
    ok(`Phone clock set to ${label}: result refused by the server`, r !== 'accepted', r.slice(0, 70));
  }
  const fake = await A.evaluate(async () => { try { await Backend.rpc('submit_result', { p_date: DateUK.today(), p_question_ids: ['u1','u2','u3','u4','u5','u6','u7'], p_guesses: [1,2,3,4,5,6,7], p_bonus: 0 }); return 'accepted'; } catch(e) { return e.message; } });
  ok('Made-up question list refused', fake !== 'accepted', fake.slice(0, 60));
  { const c2 = await b.newContext(); await c2.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); const X = await c2.newPage();
    await X.goto(BASE_URL, { waitUntil:'networkidle' }); await X.waitForTimeout(2500);
    const r = await X.evaluate(async () => { await Backend.auth(); const d = getDay(App.today, true); try { const row = await Backend.rpc('submit_result', { p_date: App.today, p_question_ids: d.ids, p_guesses: [1,2,3,4,5,6,7], p_bonus: 99999 }); return JSON.stringify(row); } catch(e) { return 'ERR ' + e.message; } });
    const sc = Number((r.match(/\d+/) || [])[0]);
    ok('Impossible bonus (99,999) capped by the server to what the balls allow', !/^ERR/.test(r) && sc < 99999, r.slice(0, 80)); await c2.close(); }
  // finish the daily (answers in localStorage), then open a second tab and post from both at the same moment
  await A.evaluate(() => { const d = getDay(App.today, true); d.answers = d.ids.map(() => ({ g:5, s:0 })); d.done = true; d.pin = { done:true, bonus:0 }; save(); });
  const B = await ctx.newPage(); await B.goto(BASE_URL, { waitUntil:'networkidle' }); await B.waitForTimeout(2500);
  ok('Second tab sees the finished game (shared storage)', await B.evaluate(() => !!S.days[App.today].done));
  const res = await Promise.all([A, B, A, B].map(p => p.evaluate(async () => { try { await Backend.rpc('submit_result', { p_date: App.today, p_question_ids: S.days[App.today].ids, p_guesses: S.days[App.today].answers.map(a => a.g), p_bonus: 0 }); return 'ok'; } catch(e) { return e.message; } })));
  ok('Two tabs posting the same finished game: never accepted twice (tab B had already auto-posted on open)', res.filter(r => r === 'ok').length <= 1 && res.every(r => r === 'ok' || /already submitted/i.test(r)), res.map(r => r.slice(0, 30)).join(' / '));
  await A.evaluate(() => Backend.sync()); await B.evaluate(() => Backend.sync()); await A.waitForTimeout(1500);
  ok('Normal sync afterwards treats "already submitted" as done (no error loop)', await A.evaluate(() => !!S.days[App.today].synced) && await B.evaluate(() => { S = sanitize(Store.read()); return !!S.days[App.today].synced; }));
  { const c3 = await b.newContext(); await c3.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); const Y = await c3.newPage();
    await Y.goto(BASE_URL, { waitUntil:'networkidle' }); await Y.waitForTimeout(2500);
    const rr = await Y.evaluate(async () => { await Backend.auth(); const ids = getDay(App.today, true).ids; return Promise.all([0,1,2,3,4,5].map(() => Backend.rpc('submit_result', { p_date: App.today, p_question_ids: ids, p_guesses: [1,2,3,4,5,6,7], p_bonus: 0 }).then(() => 'ok', e => e.message))); });
    ok('Race: six identical posts fired at the same instant: exactly one stored', rr.filter(r => r === 'ok').length === 1, rr.map(r => r.slice(0, 24)).join(' / ')); await c3.close(); }
  ok('No page errors', !errs.length, errs.join(' / '));
  console.log('UID ' + uid); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
