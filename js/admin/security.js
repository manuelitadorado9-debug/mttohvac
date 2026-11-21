
/* HVAC · Blindaje básico del cliente
   1) Sanitización anti-XSS de textos (formularios y cuerpos enviados a Supabase)
   2) Validación de peticiones REST (endpoint, método, filtros obligatorios, tamaños)
   3) Límite de ritmo (rate limit) + enfriamiento ante 429 para evitar ráfagas automatizadas
   Nota: son defensas del lado del cliente; la protección real contra abuso debe reforzarse en Supabase (RLS / límites). */
(function (w) {
  'use strict';
  if (w.HVACSec) return;

  /* ---------- 1) Sanitización ---------- */
  var CTRL  = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029\u202A-\u202E\uFEFF]/g;               // control / invisibles / bidi
  var TAGS  = /<\s*\/?\s*(?:script|iframe|frame|frameset|object|embed|applet|style|link|meta|base|form|svg|math|template|noscript)\b[^>]*>?/gi;
  var EVTAG = /<[^>]*\bon[a-z]{3,20}\s*=[^>]*>?/gi;                                                          // <img onerror=...>
  var BLOCK = /<\s*(script|style|iframe|object|embed|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;     // bloque completo con su contenido
  var JSTAG = /<[^>]*\b(?:javascript|vbscript)\s*:[^>]*>?/gi;                                                 // <a href="javascript:...">
  var PROTO = /\b(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/gi;
  function scrub(s) {                                                                                         // quita solo lo peligroso, no recorta ni altera el resto
    if (s.indexOf('<') > -1 || /(?:javascript|vbscript|data)\s*:/i.test(s)) s = s.replace(BLOCK, '').replace(TAGS, '').replace(EVTAG, '').replace(JSTAG, '').replace(PROTO, '');
    return s.replace(CTRL, '');
  }
  function clean(v, max) {
    if (typeof v !== 'string' || !v) return v;
    var s = scrub(v).trim();
    return (max && s.length > max) ? s.slice(0, max) : s;
  }
  var SKIP_KEY = /^(?:password|passwordhash|pass|hash|token|apikey)$/i, BAD_KEY = /^(?:__proto__|constructor|prototype)$/;
  var BINARY = /^(?:data:(?:image|application\/pdf)\/|blob:|https?:\/\/)/i;
  function deep(v, d) {
    if (typeof v === 'string') return (v.length > 20000 || BINARY.test(v)) ? v : scrub(v);
    if (!v || typeof v !== 'object' || d > 10) return v;
    if (Array.isArray(v)) return v.map(function (x) { return deep(x, d + 1); });
    if (Object.prototype.toString.call(v) !== '[object Object]') return v;
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && !BAD_KEY.test(k)) o[k] = SKIP_KEY.test(k) ? v[k] : deep(v[k], d + 1);
    return o;
  }

  /* ---------- Campos de formulario ---------- */
  var FIELD = 'input:not([type]),input[type=text],input[type=search],input[type=email],input[type=tel],input[type=url],textarea';
  var warnT = 0;
  function notify() {
    if (Date.now() - warnT < 2500) return; warnT = Date.now();
    if (typeof w.showToast === 'function') w.showToast('Se eliminó contenido no permitido del texto ingresado.', 'error');
  }
  function cleanField(el) {
    if (!el || !el.matches || !el.matches(FIELD) || el.readOnly || el.disabled) return;
    var v = el.value; if (!v) return;
    var max = el.maxLength > 0 ? el.maxLength : (el.tagName === 'TEXTAREA' ? 5000 : 500);
    var c = clean(v, max);
    if (c !== v) { el.value = c; if (scrub(v) !== v) notify(); }
  }
  document.addEventListener('submit', function (e) { var f = e.target; if (f && f.querySelectorAll) f.querySelectorAll(FIELD).forEach(cleanField); }, true);
  document.addEventListener('focusout', function (e) { cleanField(e.target); }, true);

  /* ---------- 2) Validación de peticiones ---------- */
  var CFG = { winMs: 10000, reads: 150, writes: 60, maxQueue: 400, maxUrl: 4000, maxBody: 15 * 1024 * 1024, maxRows: 1000, maxLimit: 10000 };
  var METHODS = { GET: 1, HEAD: 1, POST: 1, PATCH: 1, PUT: 1, DELETE: 1 };
  var EP = /^(?:rpc\/)?[a-z_][a-z0-9_-]{0,62}(?:\?[^\s#]*)?$/i;
  var FILTER = /[?&][a-z_][a-z0-9_.]*=(?:eq|in)\./i;
  function deny(reason) { console.warn('[Seguridad] Petición bloqueada:', reason); return { ok: false, reason: reason }; }
  function guard(endpoint, method, body) {
    method = String(method || 'GET').toUpperCase();
    var ep = String(endpoint == null ? '' : endpoint);
    if (!METHODS[method]) return deny('método HTTP no permitido');
    if (ep.length > CFG.maxUrl) return deny('URL demasiado larga');
    if (!EP.test(ep)) return deny('endpoint inválido');
    if ((method === 'DELETE' || method === 'PATCH' || method === 'PUT') && ep.indexOf('rpc/') !== 0 && !FILTER.test(ep)) return deny('operación masiva sin filtro');
    var m = ep.match(/[?&]limit=(\d+)/i);
    if (m && +m[1] > CFG.maxLimit) return deny('límite de filas excesivo');
    var b = body;
    if (b != null && typeof b === 'object') {
      if (Array.isArray(b) && b.length > CFG.maxRows) return deny('lote demasiado grande');
      b = deep(b, 0);
    }
    return { ok: true, body: b };
  }
  function sizeOk(payload) { return !payload || String(payload).length <= CFG.maxBody; }

  /* ---------- 3) Límite de ritmo ---------- */
  var hist = { r: [], w: [] }, waiting = 0, coolUntil = 0;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function cool(ms) { coolUntil = Math.max(coolUntil, Date.now() + (ms || 8000)); }
  async function throttle(method) {                                         // retrasa (no rechaza) las ráfagas; rechaza solo si la cola se desborda
    var k = (method === 'GET' || method === 'HEAD') ? 'r' : 'w', h = hist[k], lim = k === 'r' ? CFG.reads : CFG.writes, queued = false;
    for (;;) {
      var now = Date.now();
      while (h.length && now - h[0] > CFG.winMs) h.shift();
      if (now >= coolUntil && h.length < lim) { if (queued) waiting--; h.push(now); return true; }
      if (!queued) { if (waiting >= CFG.maxQueue) return false; waiting++; queued = true; }
      var wait = Math.max(coolUntil - now, h.length >= lim ? CFG.winMs - (now - h[0]) : 0, 25);
      await sleep(Math.min(wait + 5, 2000));
    }
  }

  w.HVACSec = { clean: clean, cleanDeep: function (v) { return deep(v, 0); }, guard: guard, sizeOk: sizeOk, throttle: throttle, cool: cool, cfg: CFG };
})(window);
