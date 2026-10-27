const VERSION = 'globehop-kids-india-20261027';
const CORE = [
  './', './index.html', './src/styles.css', './src/app.js',
  './src/modules/config.js', './src/modules/i18n.js', './src/modules/storage.js',
  './src/modules/geo.js', './src/modules/dataService.js', './src/modules/cityInsights.js', './src/modules/globe.js', './src/modules/globe3d.js', './src/modules/wikiMedia.js',
  './src/data/countries/index.json', './src/data/world-geometries.json',
  './src/data/places/index.json', './src/data/cities/index.json', './src/data/origins/index.json',
  './favicon.svg', './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isApi = url.hostname.includes('open-meteo.com') || url.hostname.includes('worldbank.org') || url.hostname.includes('project-osrm.org') || url.hostname.includes('wikipedia.org') || url.hostname.includes('wikidata.org');

  if (isApi) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(VERSION).then((cache) => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // HTML/JS/CSS/JSON always refresh from the network so new deploys take effect immediately.
  const liveCode = url.pathname.endsWith('/') || /\.(?:html|js|css|json|webmanifest)$/.test(url.pathname);
  if (liveCode) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) caches.open(VERSION).then((cache) => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Immutable-ish local assets can stay cache-first.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(VERSION).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }))
  );
});
