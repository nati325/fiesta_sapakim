/* Fiesta CRM PWA.
   Chromium needs a fetch handler to allow "Add to Home Screen".
   We only intercept navigations (the HTML shell) and always hit the network,
   so a deploy cannot leave an installed app stuck on old HTML that points at
   deleted /_next/static chunks. JS/CSS/API/images go through the browser. */

const SW_VERSION = 'fiesta-crm-pwa-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode !== 'navigate') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' }).catch(() =>
      new Response(
        '<!doctype html><meta charset="utf-8"><title>Fiesta</title><p dir="rtl">אין חיבור. בדקו רשת ורעננו.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    )
  );
});
