const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
// Live (v44) vs redesign (v45): first visit and repeat visit on a throttled mid-range phone (4x CPU, "Fast 3G"-ish network).
const { chromium } = require('playwright');
const runs = 5, med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function measure(b, port, warm) {
  const ctx = await b.newContext({ viewport:{ width:390, height:844 }, deviceScaleFactor:2.5, isMobile:true, hasTouch:true, serviceWorkers: warm ? 'allow' : 'block' });
  await ctx.route(/jfutntnbxwhstqgrwskj|cloudflareinsights|buy\.stripe\.com|supabase\.co/, r => r.abort());   // backend off: measures the page itself
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', { offline:false, latency:150, downloadThroughput: 1.6e6/8, uploadThroughput: 750e3/8 });
  await p.addInitScript(() => { window.__m = { lcp:0, cls:0, long:0 };
    new PerformanceObserver(l => l.getEntries().forEach(e => __m.lcp = e.startTime)).observe({ type:'largest-contentful-paint', buffered:true });
    new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) __m.cls += e.value; })).observe({ type:'layout-shift', buffered:true });
    new PerformanceObserver(l => l.getEntries().forEach(e => __m.long += Math.max(0, e.duration - 50))).observe({ type:'longtask', buffered:true }); });
  const url = `http://127.0.0.1:${port}/`;
  if (warm) { await p.goto(url); await p.waitForTimeout(3000); await p.reload(); await p.waitForTimeout(1500); }
  await p.goto(url, { waitUntil:'load' }); await p.waitForTimeout(2500);
  const m = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { ...__m, load: n.loadEventEnd, bytes: performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), n.transferSize || 0) }; });
  // INP proxy: time from a tap to the next frame for opening the Play tab / a game screen
  const t = await p.evaluate(() => new Promise(res => { const b = document.querySelector('[data-nav=modes]') || document.querySelector('[data-act=startdaily],[data-act=play]'); const s = performance.now(); b && b.click(); requestAnimationFrame(() => setTimeout(() => res(performance.now() - s))); }));
  await ctx.close(); return { ...m, tap: t };
}
(async () => {
  const b = await chromium.launch(require('./_guard').LAUNCH);
  const out = {};
  for (const [name, port] of [['live v44', 8093], ['redesign v45', 8094]]) for (const warm of [false, true]) {
    const rs = []; for (let i = 0; i < runs; i++) rs.push(await measure(b, port, warm));
    out[`${name} ${warm ? 'repeat' : 'first'}`] = { LCP_ms: Math.round(med(rs.map(r => r.lcp))), CLS: +med(rs.map(r => r.cls)).toFixed(3), blocking_ms: Math.round(med(rs.map(r => r.long))), load_ms: Math.round(med(rs.map(r => r.load))), KB: Math.round(med(rs.map(r => r.bytes)) / 1024), tap_ms: Math.round(med(rs.map(r => r.tap))) };
  }
  console.table(out); require('fs').writeFileSync(__dirname + '/perf.json', JSON.stringify(out, null, 1)); await b.close();
})();
