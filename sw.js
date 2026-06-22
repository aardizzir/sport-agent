const CACHE_NAME = 'anata-v1';
const urlsToCache = [
  '/sport-agent/',
  '/sport-agent/index.html',
  '/sport-agent/css/styles.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
