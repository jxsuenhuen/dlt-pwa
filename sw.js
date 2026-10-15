const CACHE = 'dlt-pwa-v3-20261015';
const BASE = self.registration.scope;
const SHELL = ['index.html', 'styles.css', 'app.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(path => new Request(new URL(path, BASE), {cache: 'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('dlt-pwa-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(BASE)) return;
  const path = url.pathname.slice(new URL(BASE).pathname.length);
  // Draw data has an explicit localStorage fallback in app.js. Never return HTML for JSON.
  if (['history.json', 'data/latest.json', 'latest.json'].includes(path)) {
    event.respondWith(fetch(new Request(request, {cache: 'no-store'})));
    return;
  }
  const shellPath = request.mode === 'navigate' ? 'index.html' : path;
  if (!SHELL.includes(shellPath)) return;
  const key = new URL(shellPath, BASE).href;
  const network = (async () => {
    const response = await fetch(new Request(request, {cache: 'no-cache'}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  })();
  // Keep cache writes alive even after the response is delivered.
  event.waitUntil(network.then(async response => {
    const cache = await caches.open(CACHE);
    await cache.put(key, response.clone());
  }).catch(() => {}));
  event.respondWith(network.catch(async () => {
    const cached = await (await caches.open(CACHE)).match(key);
    return cached || Response.error();
  }));
});
