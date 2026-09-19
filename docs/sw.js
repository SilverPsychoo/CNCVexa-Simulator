const CACHE_NAME = 'cncvexa-shell-v6.0.2';
const APP_SHELL = [
  './',
  './index.html',
  './privacy.html',
  './styles.css',
  './site.webmanifest',
  './assets/logo.png',
  './assets/brand-full.png',
  './assets/favicon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './js/app.js',
  './js/expression.js',
  './js/gcode-data.js',
  './js/i18n.js',
  './js/interpreter.js',
  './js/lathe-interpreter.js',
  './js/lathe-simulator.js',
  './js/simulation-worker.js',
  './js/simulation-worker-client.js',
  './js/simulator.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('cncvexa-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then(response => response || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
