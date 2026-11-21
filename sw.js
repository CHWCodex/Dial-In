/* DIAL IN service worker: makes the game installable and playable offline.
   The page itself is network-first (so players always get the latest version when online)
   with the cached copy as a fallback; icons and fonts are cache-first.
   Supabase and Stripe requests are never touched. Bump VERSION to clear old caches. */
const VERSION = 'dialin-v34';
const CORE = ['./', 'index.html', 'config.js', 'facts.js', 'manifest.webmanifest', 'icons/favicon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'fonts/rubik-latin.woff2', 'fonts/bungee-latin.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !fonts) return;
  const page = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('config.js') || url.pathname.endsWith('facts.js');
  if (page) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});

// Daily reminder notifications (sent by the daily-push function to players who turned reminders on)
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || 'DIAL IN', {
    body: d.body || 'Today’s puzzle is live.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    tag: d.tag || 'daily', renotify: false, data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
