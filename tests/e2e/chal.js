const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const { chromium } = require('playwright');
const ok = (n, p, x='') => console.log((p?'PASS':'FAIL')+' | '+n+(x?' | '+x:''));
const SP = process.argv[2], BASE = BASE_URL.replace(/\/$/, '');
async function player(b, name, url, guessFn){
  const ctx = await b.newContext({ viewport:{ width:360, height:640 }, permissions:['clipboard-read','clipboard-write'] });
  const p = await ctx.newPage(); p.setDefaultTimeout(15000); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.route('**/*supabase.co/**', r => r.abort());
  await p.goto(url, { waitUntil:'load' }); await p.waitForTimeout(800);
  return p;
}
async function playDaily(p, name, guessFn){
  if (await p.locator('#dlg-name[open]').count()) { await p.fill('#pname', name); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(500); }
  if (!(await p.locator('#enterkey').count())) { await p.evaluate(() => startDaily()); await p.waitForTimeout(400); if (await p.locator('#dlg-name[open]').count()) { await p.fill('#pname', name); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(500); } }
  const ans = await p.evaluate(() => (App.view === 'arch' ? S.archive[App.archDate] : S.days[App.today]).ids.map(id => BY_ID.get(id).answer));
  for (let i = 0; i < 7; i++) { await p.waitForSelector('#enterkey'); for (const k of guessFn(i, ans[i])) await p.click(`[data-act=key][data-k="${k}"]`); await p.click('#enterkey'); await p.waitForTimeout(2600); if (await p.locator('#reveal').count()) await p.click('#reveal').catch(()=>{}); await p.waitForTimeout(250); await p.click('#nextbtn'); await p.waitForTimeout(250); }
  if (await p.locator('[data-act=pinstart]').count()) { await p.click('[data-act=pinstart]'); await p.waitForTimeout(400); await p.click('#pinlaunch'); await p.waitForFunction(() => App.view === 'results', null, { timeout:120000 }); await p.waitForTimeout(2600); }
  // redesign: no name pop-up before the first game; a new player renames from their results ("Change name")
  if (await p.evaluate(n => S.player.name !== n, name) && await p.locator('[data-act=rename]').count()) { await p.click('[data-act=rename]'); await p.fill('#pname', name); await p.click('#pnameform button[type=submit]'); await p.waitForTimeout(800); }
}
const shared = p => p.evaluate(async () => { const d = document.querySelector('#dlg-copy'); if (d && d.open) { const v = document.querySelector('#copy-text').value; d.close(); return v; } try { return await navigator.clipboard.readText(); } catch(e){ return ''; } });
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  { const _nc = b.newContext.bind(b), _np = b.newPage.bind(b);   // staging safety net: the live database, Stripe and analytics are unreachable
    const guard = async c => { await c.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return c; };
    b.newContext = async o => guard(await _nc(o)); b.newPage = async o => { const c = await b.newContext(o); return c.newPage(); }; }
  // Player A
  const A = await player(b, 'A', BASE + '/');
  if (await A.locator("#dlg-intro[open]").count()) await A.locator("text=LET\'S DIAL IN").first().click(); await A.click('.dc-go'); await A.waitForTimeout(300);
  await playDaily(A, 'Sam Smith', (i, a) => String(i === 2 ? 1 : a));
  ok('A: Challenge a friend button on results', await A.locator('[data-act=challenge]').count() === 1);
  await A.click('[data-act=challenge]'); await A.waitForTimeout(600);
  const msg = await shared(A); const link = (msg.match(/https?:\/\/\S+\/c\/\S+/) || [''])[0];
  ok('A: challenge message has score, squares and /c/ link', /I scored [\d,]+ on today’s DIAL IN #\d+\. Can you beat me\?/.test(msg) && !!link && /Sam\+Smith$/.test(link), msg.replace(/\n/g, ' ⏎ '));
  const aTotal = await A.evaluate(() => dayTotal(S.days[App.today]));
  // Player B opens it (the /c/ path redirects to /?c= on the live site)
  const token = link.split('/c/')[1];
  const B = await player(b, 'B', BASE + '/?c=' + encodeURIComponent(token));
  const dlg = await B.innerText('#dlg-chal');
  ok('B: "You’ve been challenged" with name and score; intro skipped', await B.locator('#dlg-chal[open]').count() === 1 && dlg.includes('Sam Smith scored ' + aTotal.toLocaleString('en-GB')) && await B.locator('#dlg-intro[open]').count() === 0, dlg.replace(/\n+/g, ' | ').slice(0, 160));
  ok('B: link removed from the address bar', await B.evaluate(() => location.search === ''));
  await B.screenshot({ path: SP + '/chal-invite.png' });
  await B.click('[data-act=chalgo]'); await B.waitForTimeout(500);
  await playDaily(B, 'Jo', (i, a) => String(i < 4 ? a : Math.round(a * 1.3) || 1));
  const card = await B.innerText('.chalcard');
  ok('B: head-to-head card after the daily, question by question', /CHALLENGE · YOU VS SAM SMITH/i.test(card) && /(wins by|You win by|draw)/i.test(card) && (await B.locator('.h2h li').count()) >= 8, card.replace(/\n+/g, ' | ').slice(0, 220));
  await B.screenshot({ path: SP + '/chal-h2h.png', fullPage:true });
  await B.click('.chalcard [data-act=chalback]'); await B.waitForTimeout(600);
  const back = await shared(B);
  ok('B: reply message links back with B’s own score', /(beat|Rematch|drew)/.test(back) && /\/c\/\d+-[0-6]{7}-\d+-Jo$/.test(back), back.replace(/\n/g, ' ⏎ '));
  // Yesterday's challenge: free from the archive
  const no = await B.evaluate(() => DateUK.puzzleNo(App.today));
  const C = await player(b, 'C', `${BASE}/?c=${no - 1}-0123456-0-Kim`);
  await C.click('[data-act=chalgo]'); await C.waitForTimeout(500);
  if (await C.locator('#dlg-name[open]').count()) { await C.fill('#pname', 'Lee'); await C.click('#pnameform button[type=submit]'); await C.waitForTimeout(400); }
  ok('yesterday’s challenge plays free from the archive (taster not used up)', await C.evaluate(() => App.view === 'arch' && App.archDate === archDates()[0] && !S.archFree && !document.querySelector('#dlg-pay[open]')));
  // Older challenge: DIAL IN+ (with paywall switched on)
  const D = await player(b, 'D', `${BASE}/?c=3-0000000-0-Max`);
  await D.evaluate(() => { Backend.on = true; S.archFree = archDates()[5]; save(); showChallenge.call(null); });
  await D.evaluate(() => { App.pendingChal = parseChallenge('3-0000000-0-Max'); showChallenge(); }); await D.waitForTimeout(300);
  ok('older challenge asks for DIAL IN+ once the free taster is used', /come with DIAL IN\+/.test(await D.innerText('#chal-body')));
  // Tampering
  const t = await D.evaluate(() => ({ big: parseChallenge('3-6666666-99999-X'), bonus: parseChallenge('3-0000000-99999-X').c.bonus, future: parseChallenge('999-0000000-0-X'), junk: parseChallenge('hello'), xss: parseChallenge('3-0000000-0-%3Cimg%20src%3Dx%3E').c.name }));
  ok('tampered links are cleaned: bonus capped, future/junk ignored, names stripped', t.bonus === 8400 && t.future === null && t.junk === null && !/[<>]/.test(t.xss) && t.big.c.bonus === 0, JSON.stringify(t));
  const errs = [A, B, C, D].flatMap(p => p.errs);
  ok('no page errors', !errs.length, errs.join(' / '));
  await b.close();
})();
