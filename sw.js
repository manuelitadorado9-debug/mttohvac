/* Service Worker · Smart Maintenance HVAC (PWA, offline). Cambia CACHE_VERSION al publicar. */
const CACHE_VERSION = 'hvac-v7';
const SHELL = ['./', './tecnico.html', './common.js', './manifest.json',
               './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

/* Sincronización en segundo plano (Android/Chrome): avisa a las pestañas para vaciar la cola de IndexedDB */
self.addEventListener('sync', e => {
  if (e.tag === 'hvac-outbox') e.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then(cs => cs.forEach(c => c.postMessage('hvac-sync'))));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;   // datos y fotos: siempre red (los datos offline viven en IndexedDB)
  if (req.mode === 'navigate' && !url.pathname.endsWith('tecnico.html')) return;   // el administrador funciona como web normal
  if (req.mode === 'navigate') {                      // HTML: red primero; sin señal, última copia
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE_VERSION).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match('./tecnico.html'))));
    return;
  }
  if (url.origin === location.origin || CDN_HOSTS.includes(url.hostname)) {   // estáticos: caché primero y revalida
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE_VERSION).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
