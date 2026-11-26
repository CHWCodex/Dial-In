// Every end-to-end suite loads this first. It decides where the tests point and makes sure they can never touch the live game.
//   BASE      the copy of the site under test (default: a local server on 127.0.0.1:8090 serving a staging build)
//   The live database host, playdialin.com, Stripe checkout and analytics are refused here and blocked again per browser context.
const BASE_URL = (process.env.BASE || 'http://127.0.0.1:8090/').replace(/\/?$/, '/');
const LIVE = /playdialin\.com|jfutntnbxwhstqgrwskj/i;
if (LIVE.test(BASE_URL)) { console.error('Refusing to run: BASE points at the live site. Use a staging build.'); process.exit(2); }
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const LAUNCH = proxy ? { proxy } : {};
// Patch Playwright so every new browser context blocks the live database, Stripe and analytics before any page loads.
const pw = require('playwright'); const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async o => { const b = await launch(o); const nc = b.newContext.bind(b);
  b.newContext = async c => { const ctx = await nc(c); await ctx.route(/jfutntnbxwhstqgrwskj|playdialin\.com|cloudflareinsights|buy\.stripe\.com/, r => r.abort()); return ctx; };
  b.newPage = async c => (await b.newContext(c)).newPage(); return b; };
module.exports = { BASE_URL, LAUNCH };
