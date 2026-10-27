/* common.js · Lógica compartida de Smart Maintenance HVAC (admin + técnico)
   Namespace global: HVAC.{cfg, net, idb, outbox, sb, storage, img, letterhead, pwa}
   Lee SUPABASE_URL / SUPABASE_KEY (definidas por la página) en el momento de usarse. */
(function (global) {
  'use strict';
  const HVAC = global.HVAC = global.HVAC || {};

  /* ---------- Configuración ---------- */
  HVAC.cfg = {
    url: () => (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : ''),
    key: () => (typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''),
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

  /* ---------- Supabase REST ---------- */
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

  /* ---------- Membretes PDF (en Supabase Storage, con caché en IndexedDB) ---------- */
  HVAC.letterhead = {
    async load() {
      const out = {};
      for (const k of ['header', 'footer']) {
        const path = HVAC.cfg.letterhead[k], key = 'letterhead:' + path;
        let data = await HVAC.idb.get(key);
        if (!data && HVAC.net.isOnline()) {
          try { const r = await fetch(HVAC.storage.publicUrl(path), { cache: 'force-cache' }); if (r.ok) { data = await HVAC.img.toDataUrl(await r.blob()); HVAC.idb.set(key, data); } } catch (_) {}
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

  /* ---------- PWA: registro del SW + botón "Instalar" ---------- */
  HVAC.pwa = {
    _evt: null,
    register() {
      if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
      addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e)));
      navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'hvac-sync') document.dispatchEvent(new Event('hvac-sync')); });
    },
    async install() { if (!HVAC.pwa._evt) return false; HVAC.pwa._evt.prompt(); const r = await HVAC.pwa._evt.userChoice; HVAC.pwa._evt = null; return r.outcome === 'accepted'; }
  };
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
