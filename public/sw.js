// Tracky service worker: app shell cached for offline use; prices network-first with the last copy as fallback.
const VERSION = 'tracky-v15';
const SHELL = ['/', '/agg.js', '/logo.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (req.mode === 'navigate' && (await cache.match('/'))) || Response.error();
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') (await caches.open(VERSION)).put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const { request: req } = e;
  if (req.method !== 'GET') return; // POST /api/refresh always goes to the network
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  // Page, prices and own scripts: fresh when online, cached when offline.
  if (req.mode === 'navigate' || (sameOrigin && (url.pathname.startsWith('/api/') || url.pathname.endsWith('.js')))) {
    e.respondWith(networkFirst(req));
  } else if (sameOrigin || /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
});
