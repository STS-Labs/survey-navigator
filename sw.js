// Offline support: the app and the street network are kept on the phone, and so is every map tile it
// has shown (plus the tiles around the loaded route), so a dead spot in the city does not stop navigation.
const APP = 'sn-app-1';
const MAP = 'sn-map-1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/core.js', 'js/sim.js', 'js/i18n.js', 'js/icons.js',
  'vendor/maplibre-gl-4.7.1/maplibre-gl.js', 'vendor/maplibre-gl-4.7.1/maplibre-gl.css',
  'data/tbilisi-net.json', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== MAP).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// App files: fresh copy when the network answers within 4 s, the saved copy otherwise
function appFile(req) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req));
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(fallback()); } }, 4000);
    fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(APP).then((c) => c.put(req, copy)); }
      if (!settled) { settled = true; clearTimeout(timer); resolve(r); }
    }).catch(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback()); } });
  });
}

let puts = 0;
async function trim() {
  const c = await caches.open(MAP), keys = await c.keys();
  if (keys.length > 6000) await Promise.all(keys.slice(0, keys.length - 5000).map((k) => c.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(appFile(req)); return; }
  if (url.hostname !== 'tiles.openfreemap.org') return;
  // Tiles, fonts and icons have versioned addresses and never change: saved copy first
  if (/\/planet\/\d|\/fonts\/|\/sprites\/|\/natural_earth\//.test(url.pathname)) {
    e.respondWith(caches.open(MAP).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) { c.put(req, r.clone()); if (++puts % 200 === 0) trim(); }
      return r;
    }));
    return;
  }
  // Style and tile index: fresh when possible, saved copy offline
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(MAP).then((c) => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req)));
});
