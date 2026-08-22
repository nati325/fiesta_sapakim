/* Fiesta CRM — minimal service worker for PWA installability.
   Network-first: the dashboard always needs live API/Mongo data. */

const SW_VERSION = 'fiesta-crm-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('fiesta-crm-') && key !== SW_VERSION)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// Required by Chromium installability heuristics.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
