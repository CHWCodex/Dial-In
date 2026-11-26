const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
let fails = 0; const ok = (n, p, x='') => { if (!p) fails++; console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
const BASE = BASE_URL;
async function open(b, url, vp = { width:360, height:640 }){
  const ctx = await b.newContext({ viewport:vp, permissions:['clipboard-read','clipboard-write'] });
  const p = await ctx.newPage(); p.setDefaultTimeout(20000); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(url || BASE, { waitUntil:'networkidle' }); await p.waitForTimeout(1200); return p;
}
const clip = p => p.evaluate(async () => { const d = document.querySelector('#dlg-copy'); if (d && d.open) { const v = document.querySelector('#copy-text').value; d.close(); return v; } try { return await navigator.clipboard.readText(); } catch(e){ return ''; } });
async function nameIf(p, n){ await p.waitForSelector('#dlg-name[open], #enterkey', { timeout:8000 }).catch(() => {}); if (await p.locator('#dlg-name[open]').count()) { await p.fill('#pname', n); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(700); } }
async function playDaily(p, n, gf){
  await p.evaluate(() => go('home')); await p.click('.dc-go'); await nameIf(p, n);
  const ans = await p.evaluate(() => S.days[App.today].ids.map(id => BY_ID.get(id).answer));
  for (let i = 0; i < 7; i++) { await p.waitForSelector('#enterkey'); const yr = await p.evaluate(() => isYearQ(BY_ID.get(S.days[App.today].ids[App.cur])));
    for (const k of gf(i, ans[i]).replace(yr ? /\./g : /$^/, '')) await p.click(`[data-act=key][data-k="${k}"]`); await p.click('#enterkey'); await p.waitForTimeout(2700); if (await p.locator('#reveal').count()) await p.click('#reveal').catch(()=>{}); await p.waitForTimeout(250); await p.click('#nextbtn'); await p.waitForTimeout(250); }
  if (await p.locator('[data-act=pinstart]').count()) { await p.click('[data-act=pinstart]'); await p.waitForTimeout(400); await p.click('#pinlaunch'); }
  await p.waitForFunction(() => App.view === 'results', null, { timeout:120000 }); await p.waitForTimeout(3500);
  // redesign: no name pop-up before the first game; a new player renames from their results ("Change name")
  if (n && await p.evaluate(() => S.player.name) !== n) { await p.click('[data-act=rename]'); await p.fill('#pname', n); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(2500); }
}
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  // ---- 2. no How to Play pop-up
  const A = await open(b);
  ok('First visit: How to Play does not pop up', await A.locator('#dlg-intro[open]').count() === 0);
  await A.click('.navtab[data-nav=modes]'); await A.waitForTimeout(300);   // redesign: every mode lives on the Play tab
  ok('Play still offers Daily, Unlimited, Past puzzles and Battle', await A.locator('.m-daily,.m-unl,.m-past,.m-battle').count() === 4);
  await A.click('.navtab[data-nav=home]'); await A.waitForTimeout(200);
  await A.click('#ic-help'); await A.waitForTimeout(300); ok('How to Play still opens from the ? icon', await A.locator('#dlg-intro[open]').count() === 1); await A.click('#dlg-intro [data-close]');
  await A.click('[data-act=intro]'); await A.waitForTimeout(300); ok('…and from the "How to play & scoring" link', await A.locator('#dlg-intro[open]').count() === 1); await A.click('#dlg-intro [data-close]');
  await A.reload({ waitUntil:'networkidle' }); await A.waitForTimeout(800); ok('Still no pop-up after a reload', await A.locator('#dlg-intro[open]').count() === 0);
  // ---- 4. Leagues (redesign: Ranks tab → Leagues, on screen without scrolling the row)
  await A.click('.navtab[data-nav=board]'); await A.waitForTimeout(400);
  ok('Ranks shows a Leagues choice without scrolling the row', await A.evaluate(() => { const t = document.querySelector('.tabs [data-tab=leagues]'); if (!t) return false; const r = t.getBoundingClientRect(), row = t.parentElement.getBoundingClientRect(); return r.right <= row.right + 1; }));
  await A.click('.navtab[data-nav=home]'); await A.waitForTimeout(200);
  for (const w of [320, 390]) { await A.setViewportSize({ width:w, height:700 }); await A.waitForTimeout(200); ok(`Home fits a ${w}px phone`, !(await A.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))); }
  await A.setViewportSize({ width:360, height:640 });
  // ---- 3. Guest A creates a league
  await A.click('.navtab[data-nav=board]'); await A.waitForTimeout(300); await A.click('.tabs [data-tab=leagues]'); await A.waitForTimeout(800);
  ok('Ranks → Leagues opens the Leagues list with "start a league" (no account needed)', await A.evaluate(() => App.view === 'board' && App.boardTab === 'leagues') && await A.locator('#lgname').count() === 1);
  await A.evaluate(() => { S.player.name = 'QA Ann'; save(); });
  await A.fill('#lgname', 'QA <b>Gang</b> 🎯'); await A.click('#leaguecreate button[type=submit]'); await A.waitForTimeout(2000);
  const inv = await clip(A); const code = await A.evaluate(() => App.league);
  ok('A guest can create a league; invite link shared', /^[A-Z2-9]{6}$/.test(code || '') && inv.includes('/l/' + code), inv.replace(/\n/g, ' ⏎ '));
  const lgName = await A.evaluate(() => (App.leagues.find(l => l.code === App.league) || {}).name);
  ok('League name cleaned of code and symbols', lgName && !/[<>🎯]/u.test(lgName), lgName);
  // ---- Guest B joins by link with no email
  const B = await open(b, BASE + '?league=' + code);
  await B.waitForSelector('#dlg-league[open]', { timeout:10000 }).catch(() => {});
  const dlg = await B.innerText('#dlg-league');
  ok('Invite opens "You’re invited", with Join and no email step', /Join the league/i.test(dlg) && !/Add my email/i.test(dlg) && /No (email|account) needed/i.test(dlg), dlg.replace(/\n+/g, ' | ').slice(0, 160));
  ok('Invite skips How to Play', await B.locator('#dlg-intro[open]').count() === 0);
  await B.click('[data-act=lgaccept]'); await B.waitForTimeout(2000);
  ok('Guest B joins and lands on the league', await B.evaluate(c => App.view === 'board' && App.league === c, code));
  // ---- both play; scores reach the league
  await playDaily(A, 'QA Ann', (i, a) => String(a));
  await playDaily(B, 'QA Ben', (i, a) => String(i < 3 ? a : 1));
  ok('Results show "Your leagues today" for a guest', /YOUR LEAGUES TODAY/i.test(await A.innerText('#leaguecard').catch(() => '')), (await A.innerText('#leaguecard').catch(() => '')).replace(/\n+/g, ' | '));
  await B.evaluate(c => { App.boardTab = 'leagues'; App.league = c; App.leagueMode = 'today'; go('board'); }, code); await B.waitForTimeout(2500);
  const board = await B.innerText('#league-board');
  ok('League board shows both guests with their scores, Ann first', /QA Ann/.test(board) && /QA Ben \(you\)/.test(board) && board.indexOf('QA Ann') < board.indexOf('QA Ben'), board.replace(/\n+/g, ' | '));
  ok('"Still to play" list is empty once both have played', !(/Still to play/.test(await B.innerText('#league-waiting'))));
  await B.click('[data-act=lgmode][data-mode=all]'); await B.waitForTimeout(1500);
  ok('All-time view works', /day played|days played/.test(await B.innerText('#league-board')));
  // ---- public boards stay email-only for guests
  await B.click('[data-act=tab][data-tab=daily]'); await B.waitForTimeout(1500);
  await B.waitForSelector('#board-body .lb, #board-body .empty', { timeout:15000 }).catch(() => {});
  ok('Guest on Daily tab: sees the board, all 6 tabs and the "Get verified" card', await B.locator('#board-body .lb li').count() >= 1 && await B.locator('.tabs .tab').count() === 6 && /Get verified/i.test(await B.innerText('#app')));
  ok('Guest board pages fit the phone', !(await B.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  // ---- Leagues list reflects league position (redesign: Ranks → Leagues)
  await A.evaluate(() => { App.boardTab = 'leagues'; App.league = null; App.leagues = null; go('board'); }); await A.waitForTimeout(2500);
  const lgl = (await A.innerText('#board-body')).replace(/\n+/g, ' | ');
  ok('Leagues list shows your league position', /#1/.test(lgl) && /2 players/.test(lgl), lgl.slice(0, 120));
  // ---- edge cases
  const C = await open(b, BASE + '?league=ZZZZZZ');
  ok('Dead league link: polite message, no pop-up left behind', await C.evaluate(() => !pendingLeague()) && await C.locator('#dlg-league[open]').count() === 0);
  const B2 = await B.context().newPage(); B2.errs = []; B2.on('pageerror', e => B2.errs.push(e.message));
  await B2.goto(BASE + '?league=' + code, { waitUntil:'networkidle' }); await B2.waitForTimeout(2500);
  ok('Opening the link again when already a member goes straight to the league', await B2.evaluate(c => App.league === c && !document.querySelector('#dlg-league[open]'), code));
  await B2.close();
  const D = await open(b); await D.evaluate(() => { S.player.name = 'QA Dee'; save(); App.boardTab = 'leagues'; App.league = null; go('board'); }); await D.waitForTimeout(1500);
  await D.fill('#lgcode', ' ' + code.toLowerCase().slice(0, 3) + ' ' + code.toLowerCase().slice(3) + ' '); await D.click('#leaguejoin button[type=submit]'); await D.waitForTimeout(2000);
  ok('Join by typed code (lower case, spaces) works', await D.evaluate(c => App.league === c, code));
  await D.waitForTimeout(800); const waiting = await D.innerText('#league-waiting');
  ok('A member who hasn’t played appears under "Still to play"', /QA Dee/.test(waiting), waiting);
  await D.click('[data-act=lgleave]'); await D.waitForTimeout(1500);
  ok('A member can leave', await D.evaluate(() => App.league === null && !(App.leagues || []).length));
  // owner closes the league; B finds it gone
  await A.evaluate(c => { App.boardTab = 'leagues'; App.league = c; go('board'); }, code); await A.waitForTimeout(1500);
  ok('Owner sees "Close this league"', /Close this league/i.test(await A.innerText('[data-act=lglev], [data-act=lgleave]')));
  await A.click('[data-act=lgleave]'); await A.waitForTimeout(1500);
  await B.evaluate(() => { App.boardTab = 'leagues'; App.league = null; App.leagues = null; go('board'); }); await B.waitForTimeout(2000);
  ok('After the owner closes it, members no longer see it', /not in a league yet/i.test(await B.innerText('#league-list')));
  // offline
  await D.route('**/*supabase.co/**', r => r.abort()); await D.evaluate(() => { App.league = null; render(false); }); await D.waitForTimeout(2500);
  ok('Offline: leagues page shows a message instead of breaking', /Couldn’t load your leagues|not in a league/i.test(await D.innerText('#league-list')));
  // score-posting rules (which account a day was posted for)
  const rules = await A.evaluate(async () => {
    const calls = []; const realRpc = Backend.rpc.bind(Backend), realEmail = Backend.email;
    Backend.rpc = async (fn, args) => { if (fn === 'submit_result') { calls.push(fn); return [{ score:1 }]; } return realRpc(fn, args); };
    const day = S.days[App.today], uid = Backend.sess.user_id, out = {};
    const run = async (setup, email) => { calls.length = 0; setup(); Backend.email = email; await Backend.sync(); return calls.length; };
    out.sameAccount = await run(() => { day.syncedBy = uid; }, '');
    out.otherAccount = await run(() => { day.syncedBy = '00000000-0000-0000-0000-000000000000'; }, 'x@y.z');
    out.legacyEmail = await run(() => { delete day.syncedBy; day.synced = true; }, 'x@y.z');
    out.legacyGuest = await run(() => { delete day.syncedBy; day.synced = true; }, '');
    Backend.rpc = realRpc; Backend.email = realEmail; day.syncedBy = uid; save(); return out;
  });
  ok('Posting rules: same account skips; new account (e.g. after adding an email) posts again', rules.sameAccount === 0 && rules.otherAccount === 1 && rules.legacyEmail === 0 && rules.legacyGuest === 1, JSON.stringify(rules));
  // challenge card offers a league
  const link = (await (async () => { await A.evaluate(() => go('results')); await A.waitForTimeout(800); await A.click('[data-act=challenge]'); await A.waitForTimeout(700); return clip(A); })()).match(/http\S+\/c\/\S+/)[0];
  const E = await open(b, BASE + '?c=' + encodeURIComponent(link.split('/c/')[1]));
  await E.click('#dlg-chal [data-act=chalgo]'); await E.waitForTimeout(500); await nameIf(E, 'QA Eve'); await playDaily(E, 'QA Eve', (i, a) => String(i < 2 ? a : 1)).catch(e => console.log('PLAYDAILY ERR', e.message.slice(0,300)));
  await E.waitForSelector('.chalcard [data-act=lgstart]', { timeout:15000 }).catch(() => {}); ok('Head-to-head card offers "Start a league together"', await E.locator('.chalcard [data-act=lgstart]').count() === 1, await E.evaluate(() => App.view + ' ' + document.querySelectorAll('.chalcard').length));
  const errs = [A, B, C, D, E].flatMap(p => p.errs); ok('No page errors anywhere', !errs.length, errs.join(' / '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0]); process.exit(1); });
