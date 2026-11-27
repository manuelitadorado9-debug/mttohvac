/* HVAC PDF download worker. Scope: /pdf-download/ only. Does not cache pages or data. */
const HVAC_PDF_STREAMS = new Map();
const HVAC_PDF_PENDING_PORTS = new Map();

function notify(port, type, message) {
  try { if (port) port.postMessage({ type, message: message || '' }); } catch (_) {}
}

function cleanup(token, state, closePort = true) {
  HVAC_PDF_STREAMS.delete(token);
  HVAC_PDF_PENDING_PORTS.delete(token);
  if (state && state.timer) clearTimeout(state.timer);
  if (state && state.finishLifetime) state.finishLifetime();
  if (closePort && state && state.port) {
    try { state.port.close(); } catch (_) {}
  }
}

function attachPort(token, port, state) {
  state.port = port;
  port.onmessage = event => {
    const message = event && event.data || {};
    const current = HVAC_PDF_STREAMS.get(token);
    if (!current || !current.controller) {
      notify(port, 'HVAC_PDF_ERROR', 'El canal de descarga ya no está disponible.');
      cleanup(token, current, true);
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
          notify(port, 'HVAC_PDF_DONE');
          cleanup(token, current, false);
        }
      } else if (message.type === 'HVAC_PDF_ABORT') {
        try { current.controller.error(new Error(message.message || 'Generación de PDF cancelada.')); } catch (_) {}
        notify(port, 'HVAC_PDF_ERROR', message.message || 'Generación de PDF cancelada.');
        cleanup(token, current, false);
      }
    } catch (error) {
      try { current.controller.error(error); } catch (_) {}
      notify(port, 'HVAC_PDF_ERROR', error && error.message ? error.message : String(error));
      cleanup(token, current, false);
    }
  };
  if (port.start) port.start();
  if (state.controller) notify(port, 'HVAC_PDF_READY');
}

function createDownloadResponse(token, filename) {
  let finishLifetime;
  const lifetime = new Promise(resolve => { finishLifetime = resolve; });
  const state = {
    controller: null,
    port: HVAC_PDF_PENDING_PORTS.get(token) || null,
    finishLifetime,
    timer: null,
    ended: false
  };
  HVAC_PDF_STREAMS.set(token, state);
  if (state.port) attachPort(token, state.port, state);

  const stream = new ReadableStream({
    start(controller) {
      state.controller = controller;
      state.timer = setTimeout(() => {
        try { controller.error(new Error('Tiempo de espera agotado al entregar el PDF.')); } catch (_) {}
        notify(state.port, 'HVAC_PDF_ERROR', 'La descarga superó el tiempo permitido.');
        cleanup(token, state, false);
      }, 240000);
      if (state.port) notify(state.port, 'HVAC_PDF_READY');
    },
    cancel() {
      notify(state.port, 'HVAC_PDF_CANCELLED', 'El navegador canceló la descarga.');
      cleanup(token, state, false);
    }
  }, { highWaterMark: 2 });

  const safeName = String(filename || 'Informe_HVAC.pdf')
    .replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 140) || 'Informe_HVAC.pdf';
  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  return { response: new Response(stream, { status: 200, headers }), lifetime };
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'HVAC_PDF_STREAM_CONNECT' || !data.token || !event.ports || !event.ports[0]) return;
  const token = String(data.token);
  const port = event.ports[0];
  const state = HVAC_PDF_STREAMS.get(token);
  if (state) attachPort(token, port, state);
  else {
    HVAC_PDF_PENDING_PORTS.set(token, port);
    port.onmessage = messageEvent => {
      const message = messageEvent && messageEvent.data || {};
      if (message.type === 'HVAC_PDF_ABORT') {
        notify(port, 'HVAC_PDF_ERROR', message.message || 'Generación cancelada.');
        HVAC_PDF_PENDING_PORTS.delete(token);
        try { port.close(); } catch (_) {}
      }
    };
    if (port.start) port.start();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scopePath = new URL(self.registration.scope).pathname;
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath) || !url.pathname.endsWith('/download')) return;

  const token = String(url.searchParams.get('token') || '');
  const filename = String(url.searchParams.get('name') || 'Informe_HVAC.pdf');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(token)) {
    event.respondWith(new Response('Solicitud de descarga inválida.', { status: 400 }));
    return;
  }
  const result = createDownloadResponse(token, filename);
  event.waitUntil(result.lifetime);
  event.respondWith(Promise.resolve(result.response));
});
