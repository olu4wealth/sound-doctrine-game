// sw.js — offline shell for Sound Doctrine.
// Without this the game had no return path at all: it could not be installed to a
// home screen, and every visit re-downloaded the whole payload. Cache-first for the
// static shell (it only changes when CACHE_VERSION is bumped), network-first for the
// question bank so content fixes reach players without waiting for a new shell.

const CACHE_VERSION = 'sd-v1';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './game-core.js',
  './storage.js',
  './sound.js',
  './manifest.webmanifest',
  './assets/icon-crest.png',
  './assets/candle-lit.png',
  './assets/candle-guttering.png',
  './assets/candle-smouldering.png',
  './assets/hero-timothy.png',
  './assets/hero-titus.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      // Individual misses (an asset removed from the repo) must not fail the whole
      // install, so each entry is added independently.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Question data: network-first, fall back to cache offline.
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else: cache-first, then fill the cache in the background.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
