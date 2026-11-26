const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
// DIAL IN+ on STAGING: real checkout link (intercepted, nothing bought), signed test webhooks, restore, duplicates, refunds.
const { chromium, devices } = require('playwright'); const { execFileSync } = require('child_process'); const crypto = require('crypto'); const fs = require('fs');
const BASE = BASE_URL, HOOK = 'https://orvhqvmblegvuaokktjy.supabase.co/functions/v1/stripe-webhook';
const SECRET = process.env.STAGING_WEBHOOK_SECRET || (() => { throw new Error('Set STAGING_WEBHOOK_SECRET (staging only)'); })();
let fails = 0; const ok = (n, c, x='') => { if (!c) fails++; console.log((c?'PASS':'FAIL')+' | '+n+(x?' | '+x:'')); };
function send(evt, badSig){ const body = JSON.stringify(evt), t = Math.floor(Date.now()/1000), sig = badSig ? 'deadbeef' : crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  return execFileSync('curl', ['-s', '-m', '20', '-w', ' %{http_code}', '-X', 'POST', HOOK, '-H', `stripe-signature: t=${t},v1=${sig}`, '-H', 'Content-Type: application/json', '--data-binary', body]).toString().trim(); }
const checkout = (uid, o = {}) => ({ id:'evt_'+crypto.randomUUID(), type:'checkout.session.completed', data:{ object:Object.assign({ id:'cs_test_'+crypto.randomUUID().slice(0,8), client_reference_id:uid, payment_status:'paid', amount_total:299, amount_subtotal:299, currency:'gbp', payment_intent:'pi_test_'+crypto.randomUUID().slice(0,8) }, o) } });
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  const mk = async dev => { const ctx = await b.newContext({ ...devices[dev || 'iPhone 13'] }); let stripeUrl = null;
    await ctx.route(/jfutntnbxwhstqgrwskj|cloudflareinsights/, r => r.abort()); await ctx.route(/buy\.stripe\.com/, r => { stripeUrl = r.request().url(); r.abort(); });
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.stripe = () => stripeUrl; await p.goto(BASE); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); return p; };
  const A = await mk();
  // free user: limits in place
  ok('Free player: not premium, Unlimited free run offered', await A.evaluate(() => !isPremium() && freeRunLeft()));
  await A.evaluate(() => { S.endless.freeDay = App.today; save(); go('endless'); }); await A.waitForTimeout(400);
  const shown = await A.evaluate(() => { const b = [...document.querySelectorAll('#app [data-act=startrun], #app [data-act=pay]')].find(e => e.offsetParent); if (!b) return null; b.click(); return b.dataset.act + ': ' + b.innerText.trim(); }); await A.waitForTimeout(500);
  console.log('   (endless screen offered: ' + shown + ')');
  ok('After the free run: Unlimited opens the DIAL IN+ screen (one-off price shown)', await A.locator('#dlg-pay[open]').count() === 1 && /£2\.99/.test(await A.innerText('#dlg-pay')) && /one-off|no subscription/i.test(await A.innerText('#dlg-pay')));
  ok('Guest is asked to save an account first (purchase follows the player)', await A.locator('#dlg-pay [data-act=payemail]').count() === 1);
  // save an account
  await A.click('#dlg-pay [data-act=payemail]'); await A.waitForTimeout(800);
  const USER = 'qa_pay' + Math.floor(Math.random()*1e5);
  await A.fill('#acctuser', USER); await A.fill('#acctpin', '583920'); await A.fill('#acctpin2', '583920'); await A.click('#createform button[type=submit]'); await A.waitForTimeout(6000);
  await A.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  const uid = await A.evaluate(() => Backend.sess && Backend.sess.user_id); ok('Account saved', !!(await A.evaluate(() => Backend.acct)), USER);
  // buy: the real Stripe link with this player's id (navigation intercepted, nothing bought)
  await A.evaluate(() => openPay()); await A.waitForTimeout(300); await A.click('#dlg-pay [data-act=buy]'); await A.waitForTimeout(2000);
  const su = A.stripe(); ok('Pay button opens the existing Stripe checkout link with the player id', !!su && su.startsWith('https://buy.stripe.com/8x27sL3CB4PT3W6g6H8Zq00') && new URL(su).searchParams.get('client_reference_id') === uid, su && su.slice(0, 70));
  // bad signature, tip, unpaid: nothing unlocks
  const ev = checkout(uid);
  ok('Webhook rejects a bad signature', /400$/.test(send(ev, true)));
  send(checkout(uid, { amount_total:100, amount_subtotal:100 })); send(checkout(uid, { payment_status:'unpaid' }));
  await A.goto(BASE + '?paid=1'); await A.waitForTimeout(5000);
  ok('A £1 tip or an unpaid checkout unlocks nothing', await A.evaluate(() => !isPremium()));
  // a real-shaped paid checkout arrives while the game is confirming
  await A.goto(BASE + '?paid=1'); await A.waitForTimeout(1500); const r1 = send(ev); await A.waitForTimeout(6000);
  ok('Paid checkout webhook accepted', /received/.test(r1) && /200$/.test(r1));
  ok('Back from checkout: DIAL IN+ unlocks by itself', await A.evaluate(() => isPremium() && S.premium.source === 'stripe'));
  ok('…Unlimited and every past puzzle open', await A.evaluate(() => !archAllLocked()));
  // duplicate delivery
  const r2 = send(ev); ok('Duplicate webhook delivery is accepted but adds nothing (checked in DB next)', /200$/.test(r2));
  // another device signs in: premium follows the account
  const C = await mk('Pixel 5'); await C.evaluate(() => go('settings')); await C.waitForTimeout(300); await C.click('[data-act=acctopen]'); await C.waitForTimeout(400);
  await C.click('[data-act=acctstep][data-s=login]'); await C.fill('#acctuser', USER); await C.fill('#acctpin', '583920'); await C.click('#loginform button[type=submit]'); await C.waitForTimeout(6000);
  await C.evaluate(() => { for (const f of ['plus']) App.folds.add(f); go('settings'); }); await C.waitForTimeout(300); await C.click('[data-act=restorebuy]'); await C.waitForTimeout(3000);
  ok('Second phone: Restore purchase brings DIAL IN+ back', await C.evaluate(() => isPremium()));
  // refund removes it
  const r3 = send({ id:'evt_'+crypto.randomUUID(), type:'charge.refunded', data:{ object:{ id:'ch_test', refunded:true, payment_intent:ev.data.object.payment_intent } } });
  await A.reload(); await A.waitForTimeout(4000);
  ok('Full refund webhook removes DIAL IN+ on the next check', /200$/.test(r3) && await A.evaluate(() => !isPremium()));
  console.log('UID', uid, 'SESSION', ev.data.object.id);
  ok('No page errors', !A.errs.length && !C.errs.length, [...A.errs, ...C.errs].slice(0, 2).join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close();
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
