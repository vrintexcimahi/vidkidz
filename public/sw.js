const APP_VERSION = '5.2.20';
const CACHE_VERSION = 'v43';
const STATIC_CACHE = `vidkidz-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `vidkidz-runtime-${CACHE_VERSION}`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/android-icon-192-v23.png',
  '/android-icon-512-v23.png',
  '/apple-touch-icon-v23.png',
  '/app-icon-192.png',
  '/app-icon-512.png',
  '/logo.png',
  '/logo-mark.png',
  '/icon96.png',
  '/favicon.png'
];
const MAX_RUNTIME_ITEMS = 80;

async function warmAppShell() {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(APP_SHELL.map(async (url) => {
    try {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (response && response.ok) await cache.put(url, response);
    } catch (err) {
      const cached = await cache.match(url);
      if (!cached) throw err;
    }
  }));
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxItems) return;
  const toDelete = keys.slice(0, keys.length - maxItems);
  await Promise.all(toDelete.map((k) => cache.delete(k)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    warmAppShell()
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE, 'vidkidz-offline-videos'].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => clients.forEach((client) => client.postMessage({
        type: 'VIDKIDZ_SW_ACTIVE',
        version: APP_VERSION,
        cacheVersion: CACHE_VERSION
      })))
  );
});

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (message.type === 'WARM_UPDATE') {
    event.waitUntil(
      warmAppShell()
    );
    return;
  }
  if (message.type === 'GET_VERSION') {
    event.source?.postMessage({
      type: 'VIDKIDZ_SW_VERSION',
      version: APP_VERSION,
      cacheVersion: CACHE_VERSION
    });
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (['image', 'font', 'style', 'script', 'manifest'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE)
              .then((cache) => cache.put(request, copy))
              .then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ITEMS));
          }
          return response;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE)
            .then((cache) => cache.put(request, copy))
            .then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ITEMS));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
