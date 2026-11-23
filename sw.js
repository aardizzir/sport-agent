// ANATA · Service worker (Fase 3)
// Red primero para la app (HTML, CSS, JS): así cada versión nueva llega sola.
// La caché solo se usa sin conexión. Las llamadas al Worker y a Supabase no se tocan.
const CACHE_NAME = 'anata-v3';
const APP_SHELL = [
  '/sport-agent/',
  '/sport-agent/index.html',
  '/sport-agent/css/styles.css',
  '/sport-agent/css/anata.css',
  '/sport-agent/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('/sport-agent/index.html')))
  );
});
