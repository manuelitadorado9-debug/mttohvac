/* common.js · Lógica compartida de Smart Maintenance HVAC (admin + técnico)
   Namespace global: HVAC.{cfg, net, idb, outbox, sb, storage, img, letterhead, pwa}
   Lee SUPABASE_URL / SUPABASE_KEY (definidas por la página) en el momento de usarse. */
(function (global) {
  'use strict';
  const HVAC = global.HVAC = global.HVAC || {};

  /* ---------- Configuración ---------- */
  HVAC.cfg = {
    url: () => 'https://ahmicbkxpudqafbiuiav.supabase.co',
    key: () => 'sb_publishable_WnOre9gtrRztesRXatpRdA_v302zi48',
    bucket: 'hvac-archivos',
    letterhead: { header: 'membrete/encabezado.jpg', footer: 'membrete/pie.jpg' }   // rutas dentro del bucket (público)
  };

  /* ---------- Estado de red ---------- */
  const netCbs = [];
  HVAC.net = {
    isOnline: () => navigator.onLine !== false,
    onChange(cb) { netCbs.push(cb); },
    waitOnline() { return HVAC.net.isOnline() ? Promise.resolve() : new Promise(r => { const f = () => { removeEventListener('online', f); r(); }; addEventListener('online', f); }); }
  };
  ['online', 'offline'].forEach(ev => addEventListener(ev, () => netCbs.forEach(cb => { try { cb(HVAC.net.isOnline()); } catch (_) {} })));

  /* ---------- IndexedDB (kv + outbox) ---------- */
  let dbp = null;
  function db() {
    if (!('indexedDB' in global)) return Promise.reject(new Error('IndexedDB no disponible'));
    return dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('hvac-common', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('outbox', { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  }
  const tx = (store, mode, fn) => db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store), q = fn(s);
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
  }));
  HVAC.idb = {
    get: k => tx('kv', 'readonly', s => s.get(k)).catch(() => undefined),
    set: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)).catch(() => false),
    del: k => tx('kv', 'readwrite', s => s.delete(k)).catch(() => false)
  };

  /* ---------- Cola offline (admite Blobs: fotos) ---------- */
  HVAC.outbox = {
    add: item => tx('outbox', 'readwrite', s => s.put(item)),
    all: () => tx('outbox', 'readonly', s => s.getAll()).then(r => r || []).catch(() => []),
    // Variante estricta para el guardián de actualizaciones: no confunde un fallo de IndexedDB con cola vacía.
    allStrict: () => tx('outbox', 'readonly', s => s.getAll()).then(r => r || []),
    remove: id => tx('outbox', 'readwrite', s => s.delete(id)),
    /* handler(item) debe devolver true si quedó sincronizado */
    async flush(handler) {
      if (!HVAC.net.isOnline()) return 0;
      let ok = 0;
      for (const it of await HVAC.outbox.all()) {
        try { if (await handler(it)) { await HVAC.outbox.remove(it.id); ok++; } } catch (_) {}
      }
      return ok;
    }
  };

  /* ----------  REST ---------- */
  HVAC.sb = {
    async fetch(endpoint, method = 'GET', body = null, extraHeaders = null, opts = {}) {
      if (!HVAC.net.isOnline()) return null;
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
      try {
        const headers = Object.assign({ apikey: HVAC.cfg.key(), Authorization: 'Bearer ' + HVAC.cfg.key(), 'Content-Type': 'application/json' }, extraHeaders || {});
        const res = await fetch(HVAC.cfg.url() + '/rest/v1/' + endpoint, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
        if (!res.ok) { if (!opts.quiet) console.warn('[sb]', res.status, await res.text().catch(() => '')); return null; }
        if (method === 'DELETE') return true;
        const txt = await res.text(); if (!txt) return true;
        try { return JSON.parse(txt); } catch (_) { return true; }
      } catch (e) { return null; } finally { clearTimeout(timer); }
    },
    insertIgnore: (table, rec) => HVAC.sb.fetch(table + '?on_conflict=id', 'POST', rec, { Prefer: 'resolution=ignore-duplicates,return=minimal' }, { quiet: true })
  };

  /* ---------- Storage (bucket público) ---------- */
  const enc = p => String(p).split('/').map(encodeURIComponent).join('/');
  HVAC.storage = {
    publicUrl: (path, bucket) => HVAC.cfg.url() + '/storage/v1/object/public/' + (bucket || HVAC.cfg.bucket) + '/' + enc(path),
    async upload(path, blob, contentType, upsert) {
      if (!HVAC.net.isOnline()) return false;
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 60000);
      try {
        const res = await fetch(HVAC.cfg.url() + '/storage/v1/object/' + HVAC.cfg.bucket + '/' + enc(path), {
          method: 'POST', signal: ctrl.signal, body: blob,
          headers: { apikey: HVAC.cfg.key(), Authorization: 'Bearer ' + HVAC.cfg.key(), 'Content-Type': contentType || blob.type || 'application/octet-stream', 'x-upsert': upsert ? 'true' : 'false' }
        });
        return res.ok || res.status === 409;   // 409 = ya existía (reintento)
      } catch (_) { return false; } finally { clearTimeout(timer); }
    }
  };

  /* ---------- Imágenes ---------- */
  HVAC.img = {
    /* Devuelve un Blob JPEG ≤ maxBytes (reduce calidad y tamaño de forma iterativa) */
    async compress(src, { maxW = 720, quality = 0.7, maxBytes = 120 * 1024 } = {}) {
      const bmp = await (global.createImageBitmap ? createImageBitmap(src) : new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(src); }));
      let w = bmp.width, h = bmp.height, q = quality, blob;
      for (let n = 0; n < 6; n++) {
        const sc = Math.min(1, maxW / Math.max(w, h)), cw = Math.round(w * sc), ch = Math.round(h * sc);
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(bmp, 0, 0, cw, ch);
        blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
        if (!blob || blob.size <= maxBytes) break;
        q = Math.max(0.35, q - 0.1); maxW = Math.round(maxW * 0.85);
      }
      return blob;
    },
    toDataUrl: blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); })
  };

  /* ---------- Membretes PDF (en  Storage, con caché en IndexedDB) ---------- */
  HVAC.letterhead = {
    errors: {},   // diagnóstico por clave (header/footer): qué falló al cargar
    async load() {
      const out = {}, self = HVAC.letterhead; self.errors = {};
      const isImg = d => typeof d === 'string' && /^data:image\//i.test(d);
      for (const k of ['header', 'footer']) {
        const path = HVAC.cfg.letterhead[k], key = 'letterhead:' + path;
        let data = await HVAC.idb.get(key);
        if (data && !isImg(data)) { data = ''; HVAC.idb.del(key); }   // caché corrupta o de tipo no imagen
        if (!data) {
          if (!HVAC.net.isOnline()) self.errors[k] = 'sin conexión';
          else {
            const url = HVAC.storage.publicUrl(path);
            try {
              const r = await fetch(url, { cache: 'no-cache' });
              if (!r.ok) self.errors[k] = 'HTTP ' + r.status + ' en ' + HVAC.cfg.bucket + '/' + path;
              else {
                let b = await r.blob();
                if (!/^image\//i.test(b.type)) b = new Blob([b], { type: /\.png$/i.test(path) ? 'image/png' : 'image/jpeg' });   // el bucket puede servir octet-stream
                data = await HVAC.img.toDataUrl(b);
                if (isImg(data) && b.size) HVAC.idb.set(key, data); else { self.errors[k] = 'archivo vacío o no es imagen'; data = ''; }
              }
            } catch (e) { self.errors[k] = 'red/CORS: ' + (e && e.message || e); }
          }
          if (self.errors[k]) console.warn('[membrete]', k, self.errors[k]);
        }
        out[k] = data || '';
      }
      return out;
    }
  };


  /* ---------- Imágenes remotas (R2): caché, prefetch y conversión síncrona para jsPDF ---------- */
  HVAC.img.cache = new Map();
  HVAC.img.isRemote = s => typeof s === 'string' && /^https?:\/\//i.test(s);
  const mimeOf = u => /\.png(\?|$)/i.test(u) ? 'image/png' : /\.webp(\?|$)/i.test(u) ? 'image/webp' : 'image/jpeg';
  HVAC.img.syncDataUrl = function (url) {            // jsPDF necesita los datos en el momento: lee de caché o hace una lectura síncrona
    if (HVAC.img.cache.has(url)) return HVAC.img.cache.get(url);
    try {
      const x = new XMLHttpRequest(); x.open('GET', url, false); x.overrideMimeType('text/plain; charset=x-user-defined'); x.send();
      if (x.status === 200) {
        const bin = x.responseText; let s = ''; for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin.charCodeAt(i) & 0xff);
        const d = 'data:' + mimeOf(url) + ';base64,' + btoa(s); HVAC.img.cache.set(url, d); return d;
      }
    } catch (e) { console.warn('[img] no se pudo leer', url, e); }
    return url;
  };
  HVAC.img.resolve = s => HVAC.img.isRemote(s) ? HVAC.img.syncDataUrl(s) : s;
  HVAC.img.collectUrls = function (obj, out) {
    out = out || new Set();
    (function walk(v) {
      if (typeof v === 'string') { if (HVAC.img.isRemote(v) && /\.(jpe?g|png|webp)(\?|$)/i.test(v)) out.add(v); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k]));
    })(obj);
    return out;
  };
  /* Re-codifica a JPEG (jsPDF solo lee JPEG/PNG: WEBP, GIF y HEIC fallaban sin avisar) */
  HVAC.img.toJpeg = function (src, maxDim, quality) {
    maxDim = maxDim || 1600; quality = quality || 0.85;
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        try {
          let w = im.naturalWidth, h = im.naturalHeight; if (!w || !h) return rej(new Error('Imagen vacía'));
          const k = Math.min(1, maxDim / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
          res(c.toDataURL('image/jpeg', quality));
        } catch (e) { rej(e); }
      };
      im.onerror = () => rej(new Error('No se pudo decodificar la imagen'));
      im.src = src;
    });
  };
  /* Descarga una imagen remota como data URI listo para jsPDF: timeout, 2 intentos (el 2.º sin caché, que
     soluciona respuestas cacheadas sin cabeceras CORS) y conversión a JPEG si el formato no es JPEG/PNG. */
  HVAC.img.fetchData = async function (url) {
    let lastErr;
    for (const bust of [false, true]) {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 20000);
      try {
        const u = bust ? url + (url.indexOf('?') > -1 ? '&' : '?') + '_cb=' + Date.now() : url;
        const r = await fetch(u, { mode: 'cors', credentials: 'omit', cache: bust ? 'reload' : 'default', signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob(); if (!blob || !blob.size) throw new Error('Respuesta vacía');
        let d = await HVAC.img.toDataUrl(blob);
        if (!/^data:image\/(jpe?g|png);base64,/i.test(d)) d = await HVAC.img.toJpeg(d);
        return d;
      } catch (e) { lastErr = e; } finally { clearTimeout(t); }
    }
    throw lastErr;
  };
  HVAC.img.prefetchIn = async function (obj) {      // descarga en paralelo las imágenes de una orden antes de crear el PDF
    const urls = [...HVAC.img.collectUrls(obj)].filter(u => !HVAC.img.cache.has(u)); let i = 0, failed = 0;
    const worker = async () => {
      while (i < urls.length) {
        const u = urls[i++];
        try { HVAC.img.cache.set(u, await HVAC.img.fetchData(u)); }
        catch (e) { failed++; console.warn('[img] no se pudo descargar', u, e && e.message); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
    return { total: urls.length, failed };
  };
  function patchPdf() {
    try {
      const J = window.jspdf && window.jspdf.jsPDF; if (!J || J.API.__hvacPatched) return;
      const orig = J.API.addImage;
      J.API.addImage = function (img) { if (HVAC.img.isRemote(img)) arguments[0] = HVAC.img.syncDataUrl(img); return orig.apply(this, arguments); };
      J.API.__hvacPatched = true;
    } catch (e) {}
  }
  addEventListener('DOMContentLoaded', patchPdf); addEventListener('load', patchPdf);

  /* ---------- Cloudflare R2: subida directa del navegador con URL firmada (/api/r2-sign) ---------- */
  HVAC.r2 = {
    signUrl: '/api/r2-sign', off: false, _keys: new Map(),
    dataUrlToBlob(d) {
      const m = /^data:([^;]+);base64,(.*)$/.exec(String(d || '')); if (!m) return null;
      const bin = atob(m[2]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new Blob([u], { type: m[1] });
    },
    async _sha1(buf) { const d = await crypto.subtle.digest('SHA-1', buf); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24); },
    /* Sube un Blob y devuelve la URL pública (o null si no se pudo: el llamador conserva la imagen en Base64) */
    async uploadBlob(blob, folder) {
      if (HVAC.r2.off || !blob || !HVAC.net.isOnline()) return null;
      const type = blob.type || 'image/jpeg', ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg', d = new Date();
      const key = (folder || 'reportes') + '/' + d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + (await HVAC.r2._sha1(await blob.arrayBuffer())) + '.' + ext;
      if (HVAC.r2._keys.has(key)) return HVAC.r2._keys.get(key);
      try {
        const r = await fetch(HVAC.r2.signUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, contentType: type, size: blob.size }) });
        if (r.status === 404 || r.status === 501 || r.status === 503) { HVAC.r2.off = true; console.warn('[R2] Servicio no configurado (/api/r2-sign): las imágenes se guardan en Base64.'); return null; }
        if (!r.ok) { console.warn('[R2] Firma rechazada', r.status, await r.text().catch(() => '')); return null; }
        const j = await r.json();
        const put = await fetch(j.uploadUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
        if (!put.ok) { console.warn('[R2] PUT falló', put.status, '→ revisa la política CORS del bucket'); return null; }
        HVAC.r2._keys.set(key, j.publicUrl); return j.publicUrl;
      } catch (e) { console.warn('[R2] Error de red', e); return null; }
    },
    /* Recibe una imagen Base64; devuelve la URL de R2 o, si falla, la misma imagen Base64 */
    async keep(dataUrl, folder) {
      if (typeof dataUrl !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(dataUrl)) return dataUrl;
      const url = await HVAC.r2.uploadBlob(HVAC.r2.dataUrlToBlob(dataUrl), folder);
      if (url) HVAC.img.cache.set(url, dataUrl);       // ya la tenemos en memoria: el PDF no necesita descargarla
      return url || dataUrl;
    },
    hasInline(obj) { try { return JSON.stringify(obj).indexOf('"data:image/') !== -1; } catch (e) { return false; } },
    /* Recorre un registro, sube cada imagen Base64 y la reemplaza por su URL. Devuelve Map(base64 → url) */
    async externalize(obj, table) {
      const map = new Map(), jobs = [];
      const folderFor = (path) => /firma|signature/i.test(path) ? 'firmas' : /receipt|comprobante/i.test(path) ? 'comprobantes' : (table === 'hvac_equipments' ? 'equipos' : 'reportes');
      (function walk(v, path, parent, key) {
        if (typeof v === 'string') { if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(v)) jobs.push({ v, path, parent, key }); }
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + '.' + i, v, i));
        else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], path + '.' + k, v, k));
      })(obj, '', null, null);
      for (const j of jobs) {
        if (map.has(j.v)) { j.parent[j.key] = map.get(j.v); continue; }
        const url = await HVAC.r2.keep(j.v, folderFor(j.path));
        if (url !== j.v) { map.set(j.v, url); j.parent[j.key] = url; }
      }
      return map;
    },
    replaceDeep(obj, map) {
      (function walk(v, parent, key) {
        if (typeof v === 'string') { if (map.has(v)) parent[key] = map.get(v); }
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, v, i));
        else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], v, k));
      })(obj, null, null);
    },
    /* Diagnóstico paso a paso: configuración → firma → PUT → lectura pública → tamaño > 0 */
    async selfTest() {
      try {
        const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), ch => ch.charCodeAt(0)), blob = new Blob([png], { type: 'image/png' });
        const r = await fetch(HVAC.r2.signUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'otros/test/ping-' + Date.now() + '.png', contentType: 'image/png', size: blob.size }) });
        if (r.status === 404) return { ok: false, msg: 'No existe /api/r2-sign. Despliega la carpeta api/ en Vercel (archivo api/r2-sign.js).' };
        const j = await r.json().catch(() => ({}));
        if (r.status === 503) return { ok: false, msg: 'Faltan variables de entorno en Vercel: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET y R2_PUBLIC_BASE. Después de crearlas haz Redeploy.' };
        if (!r.ok) return { ok: false, msg: 'La firma fue rechazada: ' + (j.error || r.status) };
        const put = await fetch(j.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: blob }).catch(() => null);
        if (!put) return { ok: false, msg: 'El navegador no pudo escribir en R2: casi seguro falta la política CORS del bucket (permitir PUT desde este dominio). Ver R2_SETUP.md.' };
        if (!put.ok) return { ok: false, msg: 'R2 respondió ' + put.status + ' al subir. Revisa que el token tenga permiso "Object Read & Write" y que R2_BUCKET / R2_ACCOUNT_ID sean correctos.' };
        const g = await fetch(j.publicUrl, { cache: 'no-store' }).catch(() => null);
        if (!g || !g.ok) return { ok: false, msg: 'La imagen subió, pero su URL pública no abre (' + (g ? g.status : 'CORS/red') + '). Activa el acceso público del bucket (r2.dev o dominio propio) y revisa R2_PUBLIC_BASE.' };
        const n = (await g.blob()).size;
        return n ? { ok: true, msg: 'R2 funciona. Archivo de prueba de ' + n + ' bytes: ' + j.publicUrl } : { ok: false, msg: 'El archivo quedó en 0 bytes en R2.' };
      } catch (e) { return { ok: false, msg: 'Error: ' + (e && e.message) }; }
    },
    /* Pasa a R2 las imágenes Base64 que siguen dentro de la base de datos (por lotes, sin tocar el resto del registro) */
    async migrateAll(tables, log) {
      let moved = 0, rows = 0; log = log || (() => {});
      for (const t of tables) {
        log('· ' + t + '…');
        for (let off = 0; ; off += 10) {
          const page = await HVAC.sb.fetch(t + '?select=id,payload&order=id.asc&limit=10&offset=' + off, 'GET', null, null, { quiet: true });
          if (!Array.isArray(page)) { log('  ⚠️ no se pudo leer ' + t); break; }
          for (const row of page) {
            if (!row.payload || !HVAC.r2.hasInline(row.payload)) continue;
            const m = await HVAC.r2.externalize(row.payload, t);
            if (!m.size) { log('  ⚠️ ' + row.id + ': no se pudo subir (se conserva sin cambios)'); continue; }
            const ok = await HVAC.sb.fetch(t + '?id=eq.' + encodeURIComponent(row.id), 'PATCH', { payload: row.payload }, { Prefer: 'return=minimal' }, { quiet: true });
            if (ok) { moved += m.size; rows++; log('  ✅ ' + row.id + ': ' + m.size + ' imagen(es)'); } else log('  ⚠️ ' + row.id + ': subió pero no se pudo actualizar el registro');
          }
          if (page.length < 10) break;
        }
      }
      return { moved, rows };
    },
    /* Mantiene la copia local alineada con lo ya subido (evita volver a cargar Base64) */
    applyLocal(table, id, map, colls) {
      const list = colls && colls[table]; if (!Array.isArray(list) || !map || !map.size) return;
      const o = list.find(x => x && String(x.id || x.code) === String(id)); if (o) HVAC.r2.replaceDeep(o, map);
    }
  };

  /* ---------- PWA: registro SW + actualización obligatoria segura ---------- */
  const HVAC_APP_VERSION = '2026.11.26.5';
  const HVAC_BUILD = 'pdf-download-on-demand-ai-recommendations-persistent-tech-badges-history-progress';   // lo reemplaza tools/stamp-build.mjs en cada despliegue
  global.HVAC_BUILD = HVAC_BUILD;
  global.HVAC_APP_VERSION = HVAC_APP_VERSION;
  HVAC.pwa = {
    _evt: null,
    _registration: null,
    _registrationPromise: null,
    _updateRequired: false,
    _updateReason: '',
    _remoteVersion: null,
    _checking: null,
    _syncing: false,
    _uiReady: false,
    version: HVAC_APP_VERSION,

    register() {
      if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) {
        HVAC.pwa.startVersionMonitor();
        return Promise.resolve(null);
      }
      if (HVAC.pwa._registrationPromise) return HVAC.pwa._registrationPromise;

      const registerNow = async () => {
        try {
          const hadController = !!navigator.serviceWorker.controller;
          const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
          HVAC.pwa._registration = reg;

          navigator.serviceWorker.addEventListener('message', e => {
            if (e.data === 'hvac-sync') document.dispatchEvent(new Event('hvac-sync'));
            if (e.data && e.data.type === 'HVAC_SW_ACTIVATED') {
              if (hadController) HVAC.pwa.requireSoftUpdate();
            }
          });

          navigator.serviceWorker.addEventListener('controllerchange', () => {
            // El primer control de SW no es una actualización; solo nos interesa reemplazar uno existente.
            if (hadController || HVAC.pwa._updateRequired) HVAC.pwa.requireSoftUpdate();
          });

          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                HVAC.pwa.requireSoftUpdate();
              }
            });
          });

          if (reg.waiting && navigator.serviceWorker.controller) HVAC.pwa.requireSoftUpdate();
          // Fuerza una comprobación en cada apertura; Vercel también entrega sw.js sin caché.
          try { await reg.update(); } catch (_) {}
          return reg;
        } catch (e) {
          console.warn('[PWA] No se pudo registrar el Service Worker:', e);
          return null;
        }
      };

      HVAC.pwa._registrationPromise = new Promise(resolve => {
        const run = () => registerNow().then(resolve);
        if (document.readyState === 'complete') run();
        else addEventListener('load', run, { once: true });
      });
      HVAC.pwa.startVersionMonitor();
      return HVAC.pwa._registrationPromise;
    },

    async install() {
      if (!HVAC.pwa._evt) return false;
      HVAC.pwa._evt.prompt();
      const r = await HVAC.pwa._evt.userChoice;
      HVAC.pwa._evt = null;
      return r.outcome === 'accepted';
    },

    compare(a, b) {
      const aa = String(a || '0').split(/[.-]/).map(x => Number(x) || 0);
      const bb = String(b || '0').split(/[.-]/).map(x => Number(x) || 0);
      const n = Math.max(aa.length, bb.length);
      for (let i = 0; i < n; i++) {
        const d = (aa[i] || 0) - (bb[i] || 0);
        if (d) return d > 0 ? 1 : -1;
      }
      return 0;
    },

    async checkVersion() {
      if (HVAC.pwa._checking) return HVAC.pwa._checking;
      if (!HVAC.net.isOnline()) return null;
      HVAC.pwa._checking = (async () => {
        try {
          const url = new URL('./version.json', location.href);
          url.searchParams.set('_hvac_check', String(Date.now()));
          const response = await fetch(url.toString(), {
            method: 'GET',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' }
          });
          if (!response.ok) throw new Error('HTTP ' + response.status + ' al consultar version.json');
          const remote = await response.json();
          if (!remote || !remote.version) throw new Error('version.json no contiene version');
          HVAC.pwa._remoteVersion = remote;

          const latest = String(remote.version);
          const minimum = String(remote.minimumVersion || latest);
          const behindLatest = HVAC.pwa.compare(HVAC_APP_VERSION, latest) < 0;
          const belowMinimum = HVAC.pwa.compare(HVAC_APP_VERSION, minimum) < 0;
          const buildChanged = !!(remote.build && HVAC_BUILD !== 'dev' && String(remote.build) !== HVAC_BUILD);
          if (belowMinimum) {
            HVAC.pwa.requireUpdate('version');            // solo versiones por debajo del mínimo: bloqueo obligatorio
          } else if (behindLatest || buildChanged) {
            HVAC.pwa.requireSoftUpdate();                 // actualización normal: aviso sin bloquear
          } else if (!HVAC.pwa._updateRequired || HVAC.pwa._updateReason === 'version') {
            HVAC.pwa._updateRequired = false;
            HVAC.pwa._updateReason = '';
            HVAC.pwa.hideUpdateUi();
          }
          return remote;
        } catch (e) {
          // Si no se puede consultar el servidor, no se destruye el trabajo ni se bloquea el modo offline.
          console.info('[PWA] No se pudo verificar la versión; se conserva la sesión actual:', e.message || e);
          return null;
        } finally {
          HVAC.pwa._checking = null;
        }
      })();
      return HVAC.pwa._checking;
    },

    startVersionMonitor() {
      if (HVAC.pwa._monitorStarted) return;
      HVAC.pwa._monitorStarted = true;
      const check = () => HVAC.pwa.checkVersion();
      if (document.readyState === 'loading') {
        addEventListener('DOMContentLoaded', check, { once: true });
      } else check();
      setInterval(() => {
        if (document.visibilityState !== 'hidden') check();
      }, 90000);
      // Si el usuario tenía un formulario abierto cuando llegó la actualización,
      // mostrar el bloqueo en cuanto lo cierre, sin interrumpir ese formulario.
      setInterval(() => {
        if (HVAC.pwa._updateRequired) HVAC.pwa.renderUpdateUi();
        else HVAC.pwa.renderSoftUi();
      }, 2500);
      addEventListener('focus', check);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
        HVAC.pwa.renderUpdateUi();
      });
      addEventListener('online', check);
    },

    requireUpdate(reason) {
      HVAC.pwa._updateRequired = true;
      HVAC.pwa._updateReason = reason || 'version';
      HVAC.pwa.renderUpdateUi();
    },


    /* ---------- Actualización normal (no bloquea): aviso + botón; nunca recarga sola ---------- */
    _softRequired: false,
    _softSnooze: 0,
    _dirty: 0,

    requireSoftUpdate() {
      if (HVAC.pwa._updateRequired) return;          // si hay bloqueo obligatorio, ese manda
      HVAC.pwa._softRequired = true;
      HVAC.pwa.renderSoftUi();
    },

    async flushPending() {
      if (typeof global.HVAC_UPDATE_SYNC === 'function') { await global.HVAC_UPDATE_SYNC(); return; }
      if (typeof global.hvacFlushStorageWrites === 'function') await global.hvacFlushStorageWrites();
      if (typeof global.cloudFlushOutbox === 'function') await global.cloudFlushOutbox();
      if (typeof global.auditEnviarCola === 'function') await global.auditEnviarCola();
      if (typeof global.mxFlushQueue === 'function') await global.mxFlushQueue();
      if (typeof global.hvacFlushStorageWrites === 'function') await global.hvacFlushStorageWrites();
    },

    renderSoftUi() {
      if (!HVAC.pwa._softRequired || HVAC.pwa._updateRequired || !document.body) return;
      let el = document.getElementById('hvac-soft-update');
      if (Date.now() < HVAC.pwa._softSnooze) { if (el) el.style.display = 'none'; return; }
      if (!el) {
        if (!document.getElementById('hvac-soft-style')) {
          const st = document.createElement('style'); st.id = 'hvac-soft-style';
          st.textContent = '#hvac-soft-update{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:99990;max-width:560px;margin:0 auto;background:#0f172a;color:#f1f5f9;border-radius:16px;padding:12px 14px;box-shadow:0 10px 40px rgba(0,0,0,.35);font:600 13px system-ui,-apple-system,sans-serif;display:grid;gap:10px}'
            + '#hvac-soft-update b{font-weight:800}#hvac-soft-update small{display:block;font-weight:500;color:#94a3b8;margin-top:2px;font-size:11.5px}'
            + '#hvac-soft-update .row{display:flex;gap:8px;justify-content:flex-end}#hvac-soft-update button{border:0;border-radius:10px;padding:9px 14px;font:800 12.5px system-ui;cursor:pointer}'
            + '#hvac-soft-update .go{background:#0b9e91;color:#fff}#hvac-soft-update .later{background:#334155;color:#e2e8f0}#hvac-soft-update button:disabled{opacity:.5}';
          document.head.appendChild(st);
        }
        el = document.createElement('div'); el.id = 'hvac-soft-update'; el.setAttribute('role', 'status');
        el.innerHTML = '<div><b>Hay una versión nueva disponible</b><small id="hvac-soft-msg">Guarda lo que estés editando y actualiza cuando quieras. Se sincroniza todo antes de recargar.</small></div>'
          + '<div class="row"><button type="button" class="later">Después</button><button type="button" class="go">Actualizar</button></div>';
        el.querySelector('.later').onclick = () => { HVAC.pwa._softSnooze = Date.now() + 30 * 60 * 1000; el.style.display = 'none'; };
        el.querySelector('.go').onclick = () => HVAC.pwa.softUpdateNow();
        document.body.appendChild(el);
      }
      el.style.display = 'grid';
    },

    async softUpdateNow() {
      const msg = document.getElementById('hvac-soft-msg');
      const go = document.querySelector('#hvac-soft-update .go');
      const say = t => { if (msg) msg.textContent = t; };
      if (!HVAC.net.isOnline()) return say('Sin conexión: conéctate a internet para actualizar. No se pierde nada.');
      if (go) go.disabled = true;
      try {
        say('Sincronizando información pendiente…');
        await HVAC.pwa.flushPending();
        const pending = await HVAC.pwa.pendingSnapshot();
        if (pending.total > 0) { say('Aún hay ' + pending.total + ' elemento(s) por sincronizar. Se conservan; reintenta en unos segundos.'); return; }
        if (Date.now() - HVAC.pwa._dirty < 15 * 60 * 1000 &&
            !global.confirm('Modificaste campos hace poco. Si no los guardaste, se perderán al recargar la página.\n\n¿Actualizar de todos modos?')) { say('Actualización en pausa. Guarda tus cambios y pulsa Actualizar.'); return; }
        say('Instalando la actualización…');
        try { const reg = HVAC.pwa._registration || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration()); if (reg && reg.waiting) reg.waiting.postMessage('skip-waiting'); } catch (_) {}
        const u = new URL(location.href);
        u.searchParams.set('_hvac_update', (HVAC.pwa._remoteVersion && (HVAC.pwa._remoteVersion.build || HVAC.pwa._remoteVersion.version)) || String(Date.now()));
        location.replace(u.toString());
      } catch (e) {
        say((e && e.message ? e.message : 'No se pudo sincronizar.') + ' Tus datos locales se conservan.');
      } finally { if (go) go.disabled = false; }
    },

    readArrayCount(key) {
      try {
        const raw = global.localStorage.getItem(key);
        if (!raw) return 0;
        const val = JSON.parse(raw);
        return Array.isArray(val) ? val.length : (val && typeof val === 'object' ? Object.keys(val).length : 0);
      } catch (_) { return 0; }
    },

    async pendingSnapshot() {
      const result = {
        cambios: HVAC.pwa.readArrayCount('HVAC_CLOUD_OUTBOX'),
        auditoria: HVAC.pwa.readArrayCount('HVAC_AUDIT_QUEUE'),
        marcacionesLegacy: HVAC.pwa.readArrayCount('HVAC_ATT_QUEUE'),
        colaIndexedDB: 0,
        colaIndexedDBNoVerificada: false
      };
      try {
        const items = await HVAC.outbox.allStrict();
        result.colaIndexedDB = Array.isArray(items) ? items.length : 0;
      } catch (_) {
        // Fallo al leer la cola no equivale a "cero pendientes": bloquear actualización por seguridad.
        result.colaIndexedDBNoVerificada = true;
      }
      result.total = result.cambios + result.auditoria + result.marcacionesLegacy + result.colaIndexedDB + (result.colaIndexedDBNoVerificada ? 1 : 0);
      return result;
    },

    activeWorkDialog() {
      const dialogs = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden), .mx-back.open, dialog[open]'));
      return dialogs.some(el => !['app-login-screen', 'hvac-update-overlay'].includes(el.id) && !el.closest('#hvac-update-overlay'));
    },

    ensureUpdateUi() {
      if (HVAC.pwa._uiReady || !document.body) return;
      HVAC.pwa._uiReady = true;
      const style = document.createElement('style');
      style.id = 'hvac-update-style';
      style.textContent = `
        #hvac-update-banner{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:100000;background:#fff7ed;color:#7c2d12;border:1px solid #fdba74;border-radius:15px;padding:13px 15px;box-shadow:0 12px 36px rgba(0,0,0,.25);font:600 13px/1.45 system-ui;display:none}
        #hvac-update-overlay{position:fixed;inset:0;z-index:100001;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(3,8,20,.82);backdrop-filter:blur(7px);font-family:system-ui,-apple-system,Segoe UI,sans-serif}
        #hvac-update-overlay .hvac-up-card{width:min(100%,470px);max-height:calc(100dvh - 36px);overflow:auto;background:#fff;color:#152039;border-radius:23px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.4)}
        #hvac-update-overlay .hvac-up-icon{width:54px;height:54px;border-radius:17px;display:grid;place-items:center;background:#e0f2fe;color:#0369a1;font-size:24px;margin-bottom:15px}
        #hvac-update-overlay h2{font-size:21px;line-height:1.2;margin:0 0 9px;font-weight:850}
        #hvac-update-overlay p{font-size:13px;line-height:1.55;color:#475569;margin:8px 0}
        #hvac-update-overlay .hvac-up-status{padding:11px 12px;border-radius:12px;background:#f1f5f9;color:#334155;font-size:12px;line-height:1.5;margin:14px 0}
        #hvac-update-overlay .hvac-up-actions{display:grid;gap:9px;margin-top:17px}
        #hvac-update-overlay button{min-height:47px;border:0;border-radius:12px;padding:0 15px;font:800 13px system-ui;cursor:pointer}
        #hvac-update-overlay button:disabled{opacity:.45;cursor:not-allowed}
        #hvac-update-sync{background:#e2e8f0;color:#1e293b}
        #hvac-update-reload{background:#0369a1;color:white}
        #hvac-update-overlay .hvac-up-safe{font-size:11px;color:#64748b;margin-top:13px}
        @media(prefers-color-scheme:dark){#hvac-update-overlay .hvac-up-card{background:#111c31;color:#e5edf9}#hvac-update-overlay p,#hvac-update-overlay .hvac-up-safe{color:#a8b6cc}#hvac-update-overlay .hvac-up-status{background:#1e2b43;color:#e2e8f0}#hvac-update-sync{background:#334155;color:#fff}}
      `;
      document.head.appendChild(style);

      const banner = document.createElement('div');
      banner.id = 'hvac-update-banner';
      banner.textContent = 'Hay una actualización obligatoria. Guarda y cierra el formulario abierto; después sincroniza para actualizar.';
      document.body.appendChild(banner);

      const overlay = document.createElement('div');
      overlay.id = 'hvac-update-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'hvac-update-title');
      overlay.innerHTML = `
        <section class="hvac-up-card">
          <div class="hvac-up-icon" aria-hidden="true">↻</div>
          <h2 id="hvac-update-title">Actualización obligatoria</h2>
          <p>Hay una nueva versión de Smart Maintenance. Para continuar trabajando debes actualizar la aplicación.</p>
          <div id="hvac-update-status" class="hvac-up-status">Comprobando que no haya información pendiente de sincronizar…</div>
          <div class="hvac-up-actions">
            <button id="hvac-update-sync" type="button">Sincronizar información pendiente</button>
            <button id="hvac-update-reload" type="button" disabled>Actualizar aplicación</button>
          </div>
          <p class="hvac-up-safe">Protección de datos: la actualización no borra IndexedDB, fotos, órdenes ni colas locales. No cierres la aplicación mientras se sincroniza.</p>
        </section>`;
      document.body.appendChild(overlay);

      document.getElementById('hvac-update-sync').addEventListener('click', () => HVAC.pwa.syncBeforeUpdate());
      document.getElementById('hvac-update-reload').addEventListener('click', () => HVAC.pwa.updateNow());
    },

    async syncBeforeUpdate() {
      if (HVAC.pwa._syncing) return;
      HVAC.pwa._syncing = true;
      HVAC.pwa.ensureUpdateUi();
      const syncButton = document.getElementById('hvac-update-sync');
      const reloadButton = document.getElementById('hvac-update-reload');
      const status = document.getElementById('hvac-update-status');
      syncButton.disabled = true;
      reloadButton.disabled = true;
      try {
        if (!HVAC.net.isOnline()) throw new Error('No hay conexión. Conéctate a internet para sincronizar los datos antes de actualizar.');
        status.textContent = 'Sincronizando órdenes, formularios, marcaciones, fotografías y auditoría…';
        if (typeof global.HVAC_UPDATE_SYNC === 'function') {
          await global.HVAC_UPDATE_SYNC();
        } else {
          if (typeof global.hvacFlushStorageWrites === 'function') await global.hvacFlushStorageWrites();
          if (typeof global.cloudFlushOutbox === 'function') await global.cloudFlushOutbox();
          if (typeof global.auditEnviarCola === 'function') await global.auditEnviarCola();
          if (typeof global.mxFlushQueue === 'function') await global.mxFlushQueue();
          if (typeof global.hvacFlushStorageWrites === 'function') await global.hvacFlushStorageWrites();
        }
        const pending = await HVAC.pwa.pendingSnapshot();
        const summary = [
          pending.cambios ? pending.cambios + ' cambios de nube' : '',
          pending.auditoria ? pending.auditoria + ' eventos de auditoría' : '',
          pending.marcacionesLegacy ? pending.marcacionesLegacy + ' marcaciones antiguas' : '',
          pending.colaIndexedDB ? pending.colaIndexedDB + ' elementos IndexedDB' : '',
          pending.colaIndexedDBNoVerificada ? 'cola IndexedDB no verificable' : ''
        ].filter(Boolean).join(', ');
        if (pending.total === 0) {
          status.textContent = 'Sincronización confirmada. No quedan elementos pendientes. Ya puedes instalar la nueva versión.';
          reloadButton.disabled = false;
        } else {
          status.textContent = 'Aún quedan ' + pending.total + ' elemento(s) sin confirmar: ' + summary + '. Se conservarán en este dispositivo; revisa la conexión y vuelve a intentar.';
        }
      } catch (e) {
        status.textContent = (e && e.message ? e.message : 'No se pudo completar la sincronización.') + ' Tus datos locales se conservan.';
      } finally {
        syncButton.disabled = false;
        HVAC.pwa._syncing = false;
      }
    },

    async updateNow() {
      const status = document.getElementById('hvac-update-status');
      const reloadButton = document.getElementById('hvac-update-reload');
      if (!HVAC.net.isOnline()) {
        if (status) status.textContent = 'Necesitas conexión a internet para descargar la nueva versión. Tus datos locales permanecen guardados.';
        return;
      }
      const pending = await HVAC.pwa.pendingSnapshot();
      if (pending.total > 0) {
        if (status) status.textContent = 'No se puede actualizar todavía: quedan ' + pending.total + ' elemento(s) pendientes de sincronizar.';
        if (reloadButton) reloadButton.disabled = true;
        return;
      }
      if (status) status.textContent = 'Instalando la actualización…';
      if (reloadButton) reloadButton.disabled = true;
      try {
        const reg = HVAC.pwa._registration || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
        if (reg && reg.waiting) reg.waiting.postMessage('skip-waiting');
      } catch (_) {}
      const u = new URL(location.href);
      u.searchParams.set('_hvac_update', (HVAC.pwa._remoteVersion && HVAC.pwa._remoteVersion.version) || 'latest');
      location.replace(u.toString());
    },

    renderUpdateUi() {
      if (!HVAC.pwa._updateRequired) return;
      const run = async () => {
        HVAC.pwa.ensureUpdateUi();
        const banner = document.getElementById('hvac-update-banner');
        const overlay = document.getElementById('hvac-update-overlay');
        if (!banner || !overlay) return;
        if (HVAC.pwa.activeWorkDialog()) {
          banner.style.display = 'block';
          overlay.style.display = 'none';
          return;
        }
        banner.style.display = 'none';
        overlay.style.display = 'flex';
        const status = document.getElementById('hvac-update-status');
        const reloadButton = document.getElementById('hvac-update-reload');
        const pending = await HVAC.pwa.pendingSnapshot();
        if (!status || !reloadButton) return;
        if (pending.total === 0 && HVAC.net.isOnline()) {
          status.textContent = 'No hay operaciones pendientes. Puedes instalar la nueva versión sin perder información.';
          reloadButton.disabled = false;
        } else if (pending.total > 0) {
          status.textContent = 'Antes de actualizar debemos sincronizar ' + pending.total + ' elemento(s) pendiente(s).';
          reloadButton.disabled = true;
        } else {
          status.textContent = 'Conéctate a internet para descargar la versión nueva. La información local seguirá guardada.';
          reloadButton.disabled = true;
        }
      };
      if (document.readyState === 'loading') addEventListener('DOMContentLoaded', run, { once: true });
      else run();
    },

    hideUpdateUi() {
      const sb = document.getElementById('hvac-soft-update'); if (sb) sb.style.display = 'none'; HVAC.pwa._softRequired = false;
      const b = document.getElementById('hvac-update-banner');
      const o = document.getElementById('hvac-update-overlay');
      if (b) b.style.display = 'none';
      if (o) o.style.display = 'none';
    }
  };

  // Marca que el usuario escribió algo hace poco (para avisar antes de recargar). Ignora buscadores y filtros.
  document.addEventListener('input', e => {
    const t = e.target; if (!t || !t.closest) return;
    if (t.closest('#app-login-screen,#hvac-soft-update,#hvac-update-overlay') || t.type === 'search' || /search|filter|buscar|filtro/i.test(t.id || '')) return;
    HVAC.pwa._dirty = Date.now();
  }, true);

  // El verificador funciona tanto en la app técnica PWA como en la administración web.
  HVAC.pwa.startVersionMonitor();
  /* El botón "Instalar" se integra en la barra superior de cada app (nunca flota sobre otros botones) */
  function mountInstall() {
    if (!HVAC.pwa._evt || document.getElementById('hvac-install-chip')) return;
    const theme = document.getElementById('btn-theme');   // solo la app de campo (tecnico.html) es instalable
    const b = document.createElement('button'); b.id = 'hvac-install-chip'; b.type = 'button'; b.title = 'Instalar app';
    if (theme && theme.parentNode) { b.className = 'icon-btn'; b.setAttribute('aria-label', 'Instalar app'); b.innerHTML = '<i class="fa-solid fa-download"></i>'; theme.parentNode.insertBefore(b, theme); }
    else return;
    b.onclick = async () => { if (await HVAC.pwa.install()) b.remove(); };
  }
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); HVAC.pwa._evt = e;
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mountInstall); else mountInstall();
  });
  addEventListener('appinstalled', () => { const b = document.getElementById('hvac-install-chip'); if (b) b.remove(); });
})(window);
