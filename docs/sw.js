const CACHE_NAME = 'cncvexa-shell-v6.2.2';
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
  './js/bootstrap.js',
  './js/expression.js',
  './js/gcode-data.js',
  './js/i18n.js',
  './js/interpreter.js',
  './js/lathe-interpreter.js',
  './js/lathe-simulator.js',
  './js/simulation-worker.js',
  './js/simulation-worker-client.js',
  './js/simulator.js',
  './js/playback.js',
  './js/vertex-inspector.js',
  './js/surface-renderer.js',
  './js/cutter-mesh.js'
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

async function fetchCurrent(request){
  const cache=await caches.open(CACHE_NAME);
  try{
    const response=await fetch(request,{cache:'no-cache'});
    if(response.ok){try{await cache.put(request,response.clone());}catch{}}
    return response;
  }catch{
    const cached=await cache.match(request)||await cache.match(request,{ignoreSearch:true});
    if(cached)return cached;
    if(request.mode==='navigate')return cache.match('./index.html');
    throw new Error('Recurso no disponible');
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(fetchCurrent(request));
});
