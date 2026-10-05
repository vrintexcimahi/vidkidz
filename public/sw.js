const APP_VERSION = '5.3.0';
const CACHE_VERSION = 'v47';
const STATIC_CACHE = `vidkidz-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `vidkidz-runtime-${CACHE_VERSION}`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/kids-ui.css',
  '/dashboard-ui.css',
  '/scenes-3d.css',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js',
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
      if (!response || !response.ok) throw new Error('App shell unavailable: ' + url);
      await cache.put(url, response);
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
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => /^(vidkidz-static-|vidkidz-runtime-)/.test(key) && ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
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

self.addEventListener('sync', (event) => {
  if (event.tag === 'vidkidz-sync-queue') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => clients.forEach((client) => client.postMessage({
          type: 'VIDKIDZ_FLUSH_QUEUE'
        })))
    );
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'vidkidz-telemetry-heartbeat') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => clients.forEach((client) => client.postMessage({
          type: 'VIDKIDZ_HEARTBEAT_PULSE',
          timestamp: Date.now()
        })))
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || request.headers.has('Authorization')) return;

  if (url.origin === self.location.origin && (request.mode === 'navigate' || request.destination === 'document')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin && ['/', '/index.html'].includes(url.pathname) && !url.search) {
            const copy = response.clone();
            event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put('/index.html', copy)));
          }
          return response;
        })
        .catch(async () => (await (await caches.open(STATIC_CACHE)).match('/index.html')) || Response.error())
    );
    return;
  }

  // Only public application assets belong in the shared runtime cache.
  // Private media, authenticated requests, APIs and arbitrary fetches bypass it.
  const isShell = APP_SHELL.some(path => new URL(path, self.location.origin).href === url.href);
  const isPublicAsset = url.origin === self.location.origin && !url.search && url.pathname.startsWith('/assets/');
  if (request.headers.has('Authorization') || (!isShell && !isPublicAsset)) return;

  event.respondWith((async () => {
    const cache = await caches.open(isShell ? STATIC_CACHE : RUNTIME_CACHE);
    const cached = await cache.match(request);
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok && response.status === 200 && !/private|no-store/i.test(response.headers.get('Cache-Control') || '')) {
        try {
          await cache.put(request, response.clone());
          if (!isShell) await trimCache(RUNTIME_CACHE, MAX_RUNTIME_ITEMS);
        } catch (_) { /* Storage failure must not break a successful network response. */ }
      }
      return response;
    } catch (_) { return cached || Response.error(); }
  })());
});
