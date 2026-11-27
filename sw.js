/* Service Worker · Smart Maintenance HVAC.
   Nueva versión de caché: incrementar CACHE_VERSION en cada despliegue con cambios del shell. */
const CACHE_VERSION = 'hvac-v19-history-progress-20261126';
const SHELL = [
  './',
  './tecnico.html',
  './common.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './js/tecnico/pwa-install.js'
];
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => Promise.allSettled(SHELL.map(path => cache.add(path))))
      // Activa la versión nueva sin esperar a cerrar las pestañas antiguas.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(key => key.startsWith('hvac-') && key !== CACHE_VERSION)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.postMessage({
      type: 'HVAC_SW_ACTIVATED',
      cacheVersion: CACHE_VERSION
    }));
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

/* Sync de segundo plano: conserva el comportamiento de la cola IndexedDB de marcaciones. */
self.addEventListener('sync', event => {
  if (event.tag === 'hvac-outbox') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
        clients.forEach(client => client.postMessage('hvac-sync'));
      })
    );
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.hostname.endsWith('supabase.co')) return;

  // Versionado y lógica compartida: siempre consultar red primero para no servir JS obsoleto.
  const isVersionControlAsset =
    url.origin === self.location.origin &&
    (url.pathname.endsWith('/common.js') || url.pathname.endsWith('/version.json'));

  if (isVersionControlAsset) {
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: 'no-store' }));
        if (response && response.ok && url.pathname.endsWith('/common.js')) {
          const copyForRequest = response.clone();
          const copyForShell = response.clone();
          caches.open(CACHE_VERSION).then(async cache => {
            await cache.put(request, copyForRequest);
            // También guardar sin query para el fallback offline del shell precargado.
            await cache.put(url.pathname, copyForShell);
          }).catch(() => {});
        }
        return response;
      } catch (_) {
        // En modo offline se permite la última copia conocida, incluso si cambió el query de versión.
        return (await caches.match(request)) ||
          (await caches.match(url.pathname)) ||
          Response.error();
      }
    })());
    return;
  }

  // Navegación técnica: red primero; la copia de caché solo sirve como respaldo sin conexión.
  if (request.mode === 'navigate' && url.pathname.endsWith('/tecnico.html')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('./tecnico.html')))
    );
    return;
  }

  // Resto de recursos: caché primero, actualización en segundo plano.
  if (url.origin === self.location.origin || CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then(response => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })());
  }
});
