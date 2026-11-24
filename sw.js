// Pawbi service worker: makes the site installable and receives push alerts.
// It does not cache the app, so updates always arrive immediately.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:18px system-ui;text-align:center;padding:48px 20px;background:#FFF8EE;color:#2A2233"><div style="font-size:48px">🐾</div><h2>You are offline</h2><p>Check your connection and try again.</p>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { }
  e.waitUntil(self.registration.showNotification(d.title || 'Pawbi', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'pawbi',
    renotify: true,
    requireInteraction: !!d.urgent,
    data: { url: d.url || '/dashboard' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/dashboard', self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = list.find(c => c.url.startsWith(self.location.origin));
    if (w) {
      await w.focus().catch(() => { });
      try { await w.navigate(url); } catch { }
    } else {
      await self.clients.openWindow(url);
    }
  })());
});
