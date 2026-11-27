/* Service Worker · Smart Maintenance HVAC.
   Nueva versión de caché: incrementar CACHE_VERSION en cada despliegue con cambios del shell. */
const CACHE_VERSION = 'hvac-v23-root-pdf-download-lifecycle-20261127';
const SHELL = [
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


/* Canal de descarga PDF bajo demanda. El admin está en /, por eso debe vivir en
   el SW raíz que controla esa página (un SW limitado a /pdf-download/ no recibe
   las navegaciones iniciadas desde la página raíz). */
const HVAC_PDF_STREAMS = new Map();
const HVAC_PDF_PENDING_PORTS = new Map();

function hvacPdfNotify(port, type, message) {
  try { if (port) port.postMessage({ type, message: message || '' }); } catch (_) {}
}
function hvacPdfReleasePending(token, pending) {
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  if (HVAC_PDF_PENDING_PORTS.get(token) === pending) HVAC_PDF_PENDING_PORTS.delete(token);
  if (typeof pending.release === 'function') {
    const release = pending.release;
    pending.release = null;
    try { release(); } catch (_) {}
  }
}
function hvacPdfCleanup(token, state, closePort = true) {
  HVAC_PDF_STREAMS.delete(token);
  const pending = HVAC_PDF_PENDING_PORTS.get(token);
  if (pending) hvacPdfReleasePending(token, pending);
  if (state && state.timer) clearTimeout(state.timer);
  if (state && state.finishLifetime) state.finishLifetime();
  if (closePort && state && state.port) { try { state.port.close(); } catch (_) {} }
}
function hvacPdfAttachPort(token, port, state, pending = null) {
  const waiting = pending || HVAC_PDF_PENDING_PORTS.get(token);
  if (waiting) hvacPdfReleasePending(token, waiting);
  state.port = port;
  port.onmessage = event => {
    const message = event && event.data || {};
    const current = HVAC_PDF_STREAMS.get(token);
    if (!current || !current.controller) {
      hvacPdfNotify(port, 'HVAC_PDF_ERROR', 'El canal de descarga ya no está disponible.');
      hvacPdfCleanup(token, current, true);
      return;
    }
    try {
      if (message.type === 'HVAC_PDF_CHUNK') {
        const buffer = message.buffer;
        if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) return;
        current.controller.enqueue(new Uint8Array(buffer));
      } else if (message.type === 'HVAC_PDF_END') {
        if (!current.ended) {
          current.ended = true;
          current.controller.close();
          hvacPdfNotify(port, 'HVAC_PDF_DONE');
          hvacPdfCleanup(token, current, false);
        }
      } else if (message.type === 'HVAC_PDF_ABORT') {
        try { current.controller.error(new Error(message.message || 'Generación de PDF cancelada.')); } catch (_) {}
        hvacPdfNotify(port, 'HVAC_PDF_ERROR', message.message || 'Generación de PDF cancelada.');
        hvacPdfCleanup(token, current, false);
      }
    } catch (error) {
      try { current.controller.error(error); } catch (_) {}
      hvacPdfNotify(port, 'HVAC_PDF_ERROR', error && error.message ? error.message : String(error));
      hvacPdfCleanup(token, current, false);
    }
  };
  if (port.start) port.start();
  if (state.controller) hvacPdfNotify(port, 'HVAC_PDF_READY');
}
function hvacPdfCreateResponse(token, filename) {
  let finishLifetime;
  const lifetime = new Promise(resolve => { finishLifetime = resolve; });
  const pending = HVAC_PDF_PENDING_PORTS.get(token) || null;
  const state = {
    controller: null,
    port: pending ? pending.port : null,
    finishLifetime,
    timer: null,
    ended: false
  };
  HVAC_PDF_STREAMS.set(token, state);
  if (pending && pending.port) hvacPdfAttachPort(token, pending.port, state, pending);
  const stream = new ReadableStream({
    start(controller) {
      state.controller = controller;
      state.timer = setTimeout(() => {
        try { controller.error(new Error('Tiempo de espera agotado al entregar el PDF.')); } catch (_) {}
        hvacPdfNotify(state.port, 'HVAC_PDF_ERROR', 'La descarga superó el tiempo permitido.');
        hvacPdfCleanup(token, state, false);
      }, 240000);
      if (state.port) hvacPdfNotify(state.port, 'HVAC_PDF_READY');
    },
    cancel() {
      hvacPdfNotify(state.port, 'HVAC_PDF_CANCELLED', 'El navegador canceló la descarga.');
      hvacPdfCleanup(token, state, false);
    }
  }, { highWaterMark: 2 });
  const safeName = String(filename || 'Informe_HVAC.pdf').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 140) || 'Informe_HVAC.pdf';
  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  return { response: new Response(stream, { status: 200, headers }), lifetime };
}

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'HVAC_PDF_STREAM_CONNECT' || !data.token || !event.ports || !event.ports[0]) return;
  const token = String(data.token);
  const port = event.ports[0];
  const state = HVAC_PDF_STREAMS.get(token);
  if (state) {
    hvacPdfAttachPort(token, port, state);
    return;
  }

  /* Importante en Chrome Android: el navegador puede terminar el Service Worker
     entre el evento message y la petición GET iniciada por el enlace. Mantener
     vivo este evento hasta que llegue el fetch evita perder el MessagePort y
     producir una descarga vacía ("Error: Sin archivos"). */
  let release;
  const keepAlive = new Promise(resolve => { release = resolve; });
  try { event.waitUntil(keepAlive); } catch (error) {
    hvacPdfNotify(port, 'HVAC_PDF_ERROR', 'No se pudo mantener activo el canal de descarga.');
    try { port.close(); } catch (_) {}
    return;
  }
  const pending = { port, release, timer: null };
  pending.timer = setTimeout(() => {
    hvacPdfNotify(port, 'HVAC_PDF_ERROR', 'No llegó la solicitud de descarga al Service Worker.');
    hvacPdfReleasePending(token, pending);
    try { port.close(); } catch (_) {}
  }, 18000);
  HVAC_PDF_PENDING_PORTS.set(token, pending);
  port.onmessage = messageEvent => {
    const message = messageEvent && messageEvent.data || {};
    if (message.type === 'HVAC_PDF_ABORT') {
      hvacPdfNotify(port, 'HVAC_PDF_ERROR', message.message || 'Generación cancelada.');
      hvacPdfReleasePending(token, pending);
      try { port.close(); } catch (_) {}
    }
  };
  if (port.start) port.start();
});

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
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co')) return;

  // Única ruta virtual: devuelve el PDF como attachment y recibe sus fragmentos por MessageChannel.
  if (url.origin === self.location.origin && url.pathname === '/__hvac_pdf_download') {
    const token = String(url.searchParams.get('token') || '');
    const filename = String(url.searchParams.get('name') || 'Informe_HVAC.pdf');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(token)) {
      event.respondWith(new Response('Solicitud de descarga inválida.', { status: 400 }));
      return;
    }
    const result = hvacPdfCreateResponse(token, filename);
    event.waitUntil(result.lifetime);
    event.respondWith(Promise.resolve(result.response));
    return;
  }

  // El panel administrador (/, index.html) es web y siempre debe ir a red.
  // Solo el técnico conserva el comportamiento offline-first.
  if (request.mode === 'navigate' && url.origin === self.location.origin &&
      !url.pathname.endsWith('/tecnico.html')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

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
      // Detectar solicitudes originadas por el panel administrador y no usar su caché.
      try {
        const client = event.clientId ? await self.clients.get(event.clientId) : null;
        if (client && client.url) {
          const clientPath = new URL(client.url).pathname;
          if (clientPath === '/' || clientPath.endsWith('/index.html')) {
            return fetch(new Request(request, { cache: 'no-store' }));
          }
        }
      } catch (_) {}
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
