
/* ---------------- Configuración ---------------- */
const MX = {
  REQUIRE_QR: false,          // true = el formulario de un equipo solo se abre tras escanear su QR
  RADIO_DEFAULT_M: 150,       // radio si la sede no define uno propio
  BLOQUEAR_FUERA_RANGO: false,// true = no registra marcaciones fuera del radio
  FOTO_OBLIGATORIA: true,     // true = no se puede marcar sin foto
  TABLE: 'asistencia'
};
/* ---------------- Telegram (reemplaza a WhatsApp) ---------------- */
const TG = {
  TOKEN: '8861661480:AAFQ1DNU5Goc0vfHzylXCqEWlBvH572Tm_o',
  CHAT_ID: '-1004425523424',
  USE_PROXY: false,            // true = enviar vía /api/telegram (token en variables de Vercel, recomendado)
  PROXY_URL: '/api/telegram'
};
async function mxTgSend(mensaje) {            // 'ok' | 'retry' (sin red / 429 / 5xx) | 'fail' (error definitivo)
  try {
    const r = await fetch(TG.USE_PROXY ? TG.PROXY_URL : 'https://api.telegram.org/bot' + TG.TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TG.USE_PROXY ? { text: mensaje } : { chat_id: TG.CHAT_ID, text: mensaje, parse_mode: 'HTML' })
    });
    if (r.ok) return 'ok';
    console.warn('Telegram:', r.status, await r.text().catch(() => ''));
    return (r.status === 429 || r.status >= 500) ? 'retry' : 'fail';
  } catch (e) { return 'retry'; }
}
/* Se ejecuta en segundo plano tras guardar la marcación; si no hay red, se reintenta solo (cola IndexedDB) */
async function enviarMarcacionTelegram(mensaje) {
  const s = await mxTgSend(mensaje);
  if (s === 'retry') await HVAC.outbox.add({ id: 'tg-' + Date.now() + Math.random().toString(16).slice(2), type: 'telegram', msg: mensaje, tries: 0 });
  return s === 'ok';
}
function mxShowDone(saved, detail, warn) {
  mxQ('mx-done-icon').innerHTML = saved ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-cloud-arrow-up"></i>';
  mxQ('mx-done-icon').style.color = saved ? '#22c55e' : '#f59e0b';
  mxQ('mx-done-title').textContent = saved ? '¡Marcación registrada correctamente!' : 'Marcación guardada en el teléfono';
  mxQ('mx-done-text').textContent = saved ? 'El reporte ha sido enviado al sistema.' : 'Sin señal: se enviará automáticamente al reconectar.';
  const d = mxQ('mx-done-detail'); d.textContent = detail; d.className = 'mx-alert ' + (warn ? 'warn' : 'good');
  mxOpen('mx-done');
}
function mxDoneOk() { mxClose('mx-done'); mxClose('mx-att'); mxAttMsg(''); mxQ('mx-att-last').style.display = 'none'; }   // vuelve a la pantalla principal con el formulario limpio

const mxQ = id => document.getElementById(id);
const mxOpen = id => mxQ(id).classList.add('open');
function mxClose(id) { mxQ(id).classList.remove('open'); }
const mxValidated = new Set();
const mxMonthKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const mxMonthLabel = () => new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
const mxNorm = s => String(s == null ? '' : s).trim().toUpperCase();

/* ---------------- PWA ---------------- */
try { if (window.HVAC && HVAC.pwa && HVAC.pwa.register) HVAC.pwa.register(); } catch (e) { console.warn("PWA:", e); }
Promise.resolve(window.HVAC && HVAC.letterhead ? HVAC.letterhead.load() : { header: '', footer: '' }).then(r => { AFC_HEADER_IMG = r.header; AFC_FOOTER_IMG = r.footer; }).catch(e => console.warn('Membrete PDF:', e));

/* ---------------- 1) QR + validación de rutina del mes ---------------- */
function mxParseQr(raw) {
  let t = String(raw || '').trim();
  try { const j = JSON.parse(t); if (j && typeof j === 'object') t = String(j.code || j.codigo || j.id || j.eq || t); } catch (_) {}
  try { const u = new URL(t); t = u.searchParams.get('eq') || u.searchParams.get('code') || u.searchParams.get('id') || decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || t); } catch (_) {}
  return t.trim();
}
async function mxResolveEquipment(key) {
  let eq = techFindEq(key);
  if (eq) return eq;
  const k = pgQuote(key);
  const rows = await supabaseFetch('hvac_equipments?select=payload&or=' + encodeURIComponent('(id.eq.' + k + ',payload->>code.eq.' + k + ')') + '&limit=1', 'GET', null, null, { quiet: true });
  if (Array.isArray(rows) && rows[0] && rows[0].payload) { eq = rows[0].payload; equipmentCatalog.push(eq); return eq; }
  return null;
}
async function mxValidateEquipment(rawCode) {
  const key = mxParseQr(rawCode);
  if (!key) return { ok: false, title: 'Código no válido', reason: 'No se pudo leer un código válido.' };
  const eq = await mxResolveEquipment(key);
  const aliases = new Set([key, eq && eq.id, eq && eq.code].filter(Boolean).flatMap(v => [mxNorm(v), mxNorm(cloudCleanId(v))]));
  const label = (eq && (eq.code || eq.name)) || key;
  if (!eq) return { ok: false, title: 'Equipo no encontrado', reason: 'El código "' + key + '" no corresponde a ningún equipo registrado.' };
  // Fuente de verdad: Supabase (rutinas que el administrador programó). Sin señal: copia local.
  let orders = navigator.onLine ? await fetchMyActiveOrders() : null;
  if (!Array.isArray(orders)) orders = workOrders;
  const month = mxMonthKey();
  const me = techCurrentUserRecord();
  const mine = o => techMatches(o, me);
  const order = (orders || []).find(o => o && isPreventiveOrder(o) && String(o.status || 'PENDING').toUpperCase() === 'PENDING'
    && String(o.date || '').startsWith(month) && mine(o)
    && (o.equipmentIds || []).some(id => aliases.has(mxNorm(id)) || aliases.has(mxNorm(cloudCleanId(id)))));
  if (!order) {
    const sameEq = o => (o.equipmentIds || []).some(id => aliases.has(mxNorm(id)) || aliases.has(mxNorm(cloudCleanId(id))));
    const assigned = (orders || []).some(o => o && isPreventiveOrder(o) && String(o.status || 'PENDING').toUpperCase() === 'PENDING' && mine(o) && sameEq(o));
    if (!assigned) return { ok: false, eq, title: 'Sin rutinas asignadas', reason: 'No tienes rutinas asignadas para este equipo (' + label + '). Si crees que es un error, consulta con el administrador.' };
    return { ok: false, eq, title: 'Equipo sin rutina para este periodo', reason: 'El equipo ' + label + ' no tiene rutinas pendientes para el periodo actual (' + mxMonthLabel() + '). Puede corresponder a otro mes o no estar programado por el administrador.' };
  }
  const eqId = (order.equipmentIds || []).find(id => aliases.has(mxNorm(id)) || aliases.has(mxNorm(cloudCleanId(id))));
  return { ok: true, eq, order, eqId };
}
async function mxHandleCode(raw) {
  mxScanMsg('Validando equipo…', 'warn');
  const r = await mxValidateEquipment(raw);
  if (!r.ok) { mxScanClose(); mxQ('mx-block-title').textContent = r.title || 'Equipo sin rutina para este periodo'; mxQ('mx-block-body').textContent = r.reason; mxOpen('mx-block'); if (navigator.vibrate) navigator.vibrate([200, 80, 200]); return; }
  mxScanClose();
  if (!workOrders.find(o => o.id === r.order.id)) workOrders.push(r.order);
  await ensureOrderEquipments(r.order);
  mxValidated.add(r.order.id + '|' + r.eqId);
  openEquipmentExecutionModal(r.order.id, r.eqId);
}
function mxScanMsg(t, kind) { const m = mxQ('mx-scan-msg'); m.style.display = t ? 'block' : 'none'; m.className = 'mx-alert ' + (kind || 'warn'); m.textContent = t || ''; }
let mxStream = null, mxTimer = null, mxBusy = false;
async function mxScanOpen() {
  mxOpen('mx-scan'); mxScanMsg('');
  try {
    mxStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const v = mxQ('mx-video'); v.srcObject = mxStream; await v.play();
    let det = null;
    if ('BarcodeDetector' in window) det = new BarcodeDetector({ formats: ['qr_code'] });
    else if (!window.jsQR) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    mxTimer = setInterval(async () => {
      if (mxBusy || v.readyState < 2) return;
      mxBusy = true;
      try {
        let txt = '';
        if (det) { const f = await det.detect(v); txt = f[0] && f[0].rawValue; }
        else { cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0); const d = cx.getImageData(0, 0, cv.width, cv.height); const q = jsQR(d.data, d.width, d.height); txt = q && q.data; }
        if (txt) { clearInterval(mxTimer); await mxHandleCode(txt); }
      } catch (_) {} finally { mxBusy = false; }
    }, 300);
  } catch (e) { mxScanMsg('No se pudo abrir la cámara (' + (e.name || 'error') + '). Escribe el código del equipo manualmente.', 'bad'); }
}
function mxScanClose() {
  clearInterval(mxTimer); mxTimer = null;
  if (mxStream) { mxStream.getTracks().forEach(t => t.stop()); mxStream = null; }
  mxClose('mx-scan');
}
function mxScanManual() { const v = mxQ('mx-manual').value; if (v.trim()) { clearInterval(mxTimer); mxHandleCode(v); } }

if (MX.REQUIRE_QR) {   // opcional: bloquea abrir el formulario sin QR
  const _open = window.openEquipmentExecutionModal;
  window.openEquipmentExecutionModal = function (orderId, eqId) {
    if (mxValidated.has(orderId + '|' + eqId)) return _open.apply(this, arguments);
    showToast('Escanea el QR del equipo para abrir su rutina.', 'error'); mxScanOpen();
  };
}

/* ---------------- 2) Check-In / Check-Out con GPS ---------------- */
const mxAttQueueKey = 'HVAC_ATT_QUEUE', mxAttTodayKey = 'HVAC_ATT_TODAY';
const mxRead = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || d); } catch (_) { return JSON.parse(d); } };
const mxToday = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD local
function mxDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function mxGetPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Este dispositivo no soporta geolocalización.'));
    navigator.geolocation.getCurrentPosition(res, e => rej(new Error(e.code === 1 ? 'Permiso de ubicación denegado. Actívalo para esta app en los ajustes del navegador.' : e.code === 3 ? 'Tiempo agotado obteniendo el GPS. Sal a un lugar abierto e intenta de nuevo.' : 'No se pudo obtener la ubicación.')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}
/* Lista oficial de clientes para marcación GPS. Solo se exponen clientes activos del directorio hvac_clients. */
const mxFold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s\u00a0\u200b]+/g, ' ').trim().toLowerCase();
let mxClientsStatusFresh = false;
const mxClientIsActiveRecord = c => {
  if (!c) return false;
  const raw = c.active !== undefined ? c.active : (c.isActive !== undefined ? c.isActive : c.activo);
  if (raw === false || raw === 0 || ['false','0','no','no activo','inactivo','inactive','desactivado','disabled'].includes(mxFold(raw))) return false;
  const status = mxFold(c.estado || c.status || c.estatus || '');
  return !['no activo','inactivo','inactive','desactivado','disabled'].includes(status);
};
function mxClientsCacheRead() {
  try { return JSON.parse(localStorage.getItem('HVAC_CLIENTS_ALL') || '[]'); } catch (_) { return []; }
}
function mxClientsCacheFresh() {
  try {
    const hasCache = !!localStorage.getItem('HVAC_CLIENTS_ALL');
    const version = localStorage.getItem('HVAC_CLIENTS_CACHE_VERSION');
    const at = Number(localStorage.getItem('HVAC_CLIENTS_AT') || 0);
    return hasCache && version === '2' && at > 0 && (Date.now() - at) < EGRESS.CLIENTS_TTL_MS;
  } catch (_) { return false; }
}
function mxClientsCacheWrite(list, refreshTimestamp) {
  // Mantener el estado de actividad junto con coordenadas: si no, el teléfono no podría excluir NO ACTIVOS offline.
  const compact = (list || []).filter(c => c && c.name).map(c => ({
    id: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng,
    latitud: c.latitud, longitud: c.longitud, geoRadius: c.geoRadius,
    active: c.active, isActive: c.isActive, activo: c.activo,
    estado: c.estado, status: c.status, estatus: c.estatus
  }));
  try {
    localStorage.setItem('HVAC_CLIENTS_ALL', JSON.stringify(compact));
    if (refreshTimestamp !== false) {
      localStorage.setItem('HVAC_CLIENTS_AT', String(Date.now()));
      localStorage.setItem('HVAC_CLIENTS_CACHE_VERSION', '2');
    }
    localStorage.setItem('HVAC_CLIENTS_BACKUP', JSON.stringify(list || []));
  } catch (e) { console.warn('[Asistencia] No se pudo actualizar la caché de clientes:', e); }
  mxClientsStatusFresh = mxClientsCacheFresh();
}
async function mxLoadAllClients(forceRefresh) {
  let all = null;
  const cache = mxClientsCacheRead();
  const freshLocal = mxClientsCacheFresh();
  if (navigator.onLine && (!freshLocal || forceRefresh)) {
    try {
      const remote = [];
      for (let off = 0; ; off += 1000) {
        const rows = await supabaseFetch('hvac_clients?select=payload&order=id.asc&limit=1000&offset=' + off, 'GET', null, null, { quiet: true });
        if (!Array.isArray(rows)) throw new Error('No se pudo actualizar el directorio de clientes.');
        remote.push(...rows.map(r => r && r.payload).filter(c => c && c.name));
        if (rows.length < 1000) break;
      }
      all = remote;
      egressSet('clients', '1');
      mxClientsCacheWrite(all);
    } catch (e) {
      console.warn('[Asistencia] No se pudo refrescar el directorio:', e);
      if (freshLocal) all = cache;
    }
  } else if (freshLocal) {
    all = cache;
  }
  if (!Array.isArray(all)) {
    // No permitir listas antiguas cuando no podemos confirmar el estado de actividad.
    mxClientsStatusFresh = false;
    clientsCatalog = [];
    return clientsCatalog;
  }
  // El catálogo para GPS se reemplaza por el directorio oficial; nunca se añaden nombres de órdenes viejas.
  const previousCatalog = Array.isArray(clientsCatalog) ? clientsCatalog : [];
  clientsCatalog = all.filter(c => c && c.name).map(c => {
    const previous = previousCatalog.find(x => x && (String(x.id) === String(c.id) || mxFold(x.name) === mxFold(c.name)));
    return { ...(previous || {}), ...c }; // los flags recién descargados siempre prevalecen sobre la copia local
  });
  mxClientsStatusFresh = mxClientsCacheFresh();
  return clientsCatalog;
}
function mxAttFill() {
  const sel = mxQ('mx-att-client'), q = mxFold(mxQ('mx-att-q').value), prev = sel.value, me = techCurrentUserRecord();
  if (!mxClientsStatusFresh || !mxClientsCacheFresh()) {
    sel.innerHTML = '<option value="">Conéctate para actualizar el estado de los clientes</option>';
    mxQ('mx-att-count').textContent = 'Lista de clientes pendiente de actualización';
    return;
  }
  const month = mxMonthKey(), withRoutine = new Set(), seen = new Set(), all = [];
  workOrders.forEach(o => { if (o && o.client && isPreventiveOrder(o) && String(o.date || '').startsWith(month) && techMatches(o, me)) withRoutine.add(mxFold(o.client)); });
  const add = n => { n = String(n || '').trim(); if (n && !seen.has(mxFold(n))) { seen.add(mxFold(n)); all.push(n); } };
  clientsCatalog.filter(mxClientIsActiveRecord).forEach(c => add(c.name));
  all.sort((a, b) => a.localeCompare(b, 'es'));
  const ok = n => !q || mxFold(n).includes(q), mine = all.filter(n => withRoutine.has(mxFold(n)) && ok(n)), rest = all.filter(n => !withRoutine.has(mxFold(n)) && ok(n));
  const opt = n => '<option value="' + esc(n) + '">' + esc(n) + '</option>';
  sel.innerHTML = '<option value="">' + (all.length ? '— Selecciona el cliente / sede —' : 'No hay clientes activos') + '</option>'
    + (mine.length ? '<optgroup label="Con rutina este mes">' + mine.map(opt).join('') + '</optgroup>' : '')
    + (rest.length ? '<optgroup label="' + (mine.length ? 'Otros clientes' : 'Todos los clientes activos') + '">' + rest.map(opt).join('') + '</optgroup>' : '');
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  mxQ('mx-att-count').textContent = all.length + ' clientes activos' + (q ? ' · ' + (mine.length + rest.length) + ' coinciden' : '');
}
function mxAttOpen() {
  mxQ('mx-att-q').value = ''; mxAttFill();
  mxQ('mx-att-msg').style.display = 'none';
  const last = mxRead(mxAttTodayKey, '{}'), l = last.date === mxToday() ? last : null;
  const b = mxQ('mx-att-last'); b.style.display = l ? 'block' : 'none';
  if (l) b.textContent = 'Última marcación de hoy: ' + l.tipo + ' · ' + l.cliente + ' · ' + new Date(l.hora).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  mxOpen('mx-att');
  mxLoadAllClients(true).then(() => { mxAttFill(); if (!mxClientsStatusFresh) mxAttMsg('No se pudo confirmar el estado actual de los clientes. Conéctate e inténtalo de nuevo.', 'warn'); }).catch(() => {
    mxClientsStatusFresh = false; mxAttFill(); mxAttMsg('No se pudo actualizar el directorio de clientes.', 'warn');
  });
}
function mxAttMsg(t, kind) { const m = mxQ('mx-att-msg'); m.style.display = t ? 'block' : 'none'; m.className = 'mx-alert ' + (kind || 'warn'); m.innerHTML = t || ''; }
async function mxVerifyActiveClientForMark(name) {
  let client = clientsCatalog.find(c => c && mxFold(c.name) === mxFold(name)) || null;
  if (navigator.onLine) {
    // Validación en vivo justo antes de registrar: una caché que quedó abierta no puede habilitar un cliente recién desactivado.
    const rows = await supabaseFetch('hvac_clients?select=payload&payload->>name=eq.' + encodeURIComponent(name) + '&limit=1', 'GET', null, null, { quiet: true });
    if (!Array.isArray(rows) || !rows[0] || !rows[0].payload) throw new Error('No se pudo verificar el estado del cliente en Supabase. Intenta nuevamente.');
    client = rows[0].payload;
    const idx = clientsCatalog.findIndex(c => c && (String(c.id) === String(client.id) || mxFold(c.name) === mxFold(client.name)));
    if (idx >= 0) clientsCatalog[idx] = { ...clientsCatalog[idx], ...client }; else clientsCatalog.push({ ...client });
    // Se actualiza el registro seleccionado, pero no se renueva la antigüedad del resto de la lista.
    mxClientsCacheWrite(clientsCatalog, false);
    if (!mxClientIsActiveRecord(client)) { mxAttFill(); throw new Error('Este cliente está marcado como NO ACTIVO. No se permiten marcaciones GPS.'); }
    return client;
  }
  if (!mxClientsStatusFresh || !mxClientsCacheFresh()) throw new Error('Estás sin conexión y la lista de clientes está desactualizada. Conéctate para validar su estado antes de marcar.');
  if (!client || !mxClientIsActiveRecord(client)) throw new Error('Este cliente está marcado como NO ACTIVO o ya no pertenece al directorio.');
  return client;
}
async function mxClientGeo(name, verifiedClient) {
  const c = verifiedClient || clientsCatalog.find(x => mxFold(x.name) === mxFold(name)) || null;
  const lat = c && c.lat !== '' ? parseFloat(c.lat) : NaN, lng = c && c.lng !== '' ? parseFloat(c.lng) : NaN;
  return { client: c, lat: isFinite(lat) ? lat : null, lng: isFinite(lng) ? lng : null, radius: (c && parseInt(c.geoRadius, 10)) || MX.RADIO_DEFAULT_M };
}
/* ---- Foto del técnico ---- */
let mxPhotoStream = null, mxPhotoResolve = null;
function mxPhotoMsg(t) { const m = mxQ('mx-photo-msg'); m.style.display = t ? 'block' : 'none'; m.textContent = t || ''; }
function mxPhotoStop() { if (mxPhotoStream) { mxPhotoStream.getTracks().forEach(x => x.stop()); mxPhotoStream = null; } mxClose('mx-photo'); }
function mxPhotoDone(blob) { const r = mxPhotoResolve; mxPhotoResolve = null; mxPhotoStop(); if (r) r(blob); }
async function mxTakePhoto() {
  return new Promise(async resolve => {
    mxPhotoResolve = resolve; mxPhotoMsg(''); mxOpen('mx-photo');
    try {
      mxPhotoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 } }, audio: false });
      const v = mxQ('mx-photo-video'); v.srcObject = mxPhotoStream; await v.play();
    } catch (e) { mxPhotoMsg('No se pudo abrir la cámara. Usa el botón "Galería/cámara" para tomar la foto.'); }
  });
}
function mxPhotoShoot() {
  const v = mxQ('mx-photo-video'); if (!mxPhotoStream || !v.videoWidth) return mxPhotoMsg('La cámara no está lista.');
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  c.toBlob(b => mxPhotoDone(b), 'image/jpeg', 0.92);
}
function mxPhotoFile(inp) { const f = inp.files && inp.files[0]; inp.value = ''; if (f) mxPhotoDone(f); }
function mxPhotoCancel() { mxPhotoDone(null); }

/* ---- Registro (foto → Storage → fila en Supabase) con cola offline en IndexedDB ---- */
/* Foto de asistencia: R2 primero (no consume transferencia de Supabase); si R2 no responde, Supabase Storage como respaldo.
   Devuelve la URL pública o null si no se pudo subir (queda en la cola offline). */
async function mxUploadPhoto(blob, path) {
  try {
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
    const url = await Promise.race([r2keep(dataUrl, 'asistencia'), new Promise(res => setTimeout(() => res(null), 12000))]);
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
  } catch (e) { console.warn('[Asistencia] R2 no disponible; se usa Supabase Storage:', e); }
  return (await HVAC.storage.upload(path, blob, 'image/jpeg')) ? HVAC.storage.publicUrl(path) : null;
}
const mxSyncItem = async it => {
  if (it.type === 'telegram') {
    const s = await mxTgSend(it.msg);
    if (s === 'retry') { it.tries = (it.tries || 0) + 1; if (it.tries < 8) { await HVAC.outbox.add(it); return false; } }
    return true;
  }
  if (it.type !== 'asistencia') return false;
  if (it.photo) {                                           // foto pendiente de subir (marcación hecha sin señal)
    const url = await mxUploadPhoto(it.photo, it.path);
    if (!url) return false;
    it.rec.foto_url = url;
    if (it.msg) it.msg += '\n📸 <b>Foto:</b> ' + url;
  }
  const ok = !!(await HVAC.sb.insertIgnore(MX.TABLE, it.rec));
  if (ok && it.msg) enviarMarcacionTelegram(it.msg);        // marcación hecha sin señal: ahora sí se notifica
  return ok;
};
const mxFlushQueue = () => HVAC.outbox.flush(mxSyncItem);
async function mxMark(tipo) {
  const name = mxQ('mx-att-client').value;
  if (!name) return mxAttMsg('Selecciona el cliente / sede.', 'bad');
  const u = techCurrentUserRecord() || {};
  const btns = [mxQ('mx-btn-in'), mxQ('mx-btn-out')]; btns.forEach(b => b.disabled = true);
  try {
    const verifiedClient = await mxVerifyActiveClientForMark(name);
    const raw = await mxTakePhoto();
    if (!raw && MX.FOTO_OBLIGATORIA) return mxAttMsg('La foto es obligatoria para registrar la marcación.', 'bad');
    mxAttMsg('<i class="fa-solid fa-satellite-dish"></i> Obteniendo ubicación GPS…', 'warn');
    const [pos, geo] = await Promise.all([mxGetPosition(), mxClientGeo(name, verifiedClient)]);
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const dist = geo.lat != null ? mxDistance(lat, lng, geo.lat, geo.lng) : null;
    const inRange = dist == null ? null : dist <= geo.radius;
    if (inRange === false && MX.BLOQUEAR_FUERA_RANGO) { mxAttMsg('Estás a <b>' + Math.round(dist) + ' m</b> de la sede (máximo ' + geo.radius + ' m). Acércate para marcar.', 'bad'); return; }
    const now = new Date(), id = (crypto.randomUUID ? crypto.randomUUID() : 'a' + Date.now() + Math.random().toString(16).slice(2));
    let blob = null, path = null, fotoUrl = null;
    if (raw) {
      mxAttMsg('Comprimiendo foto…', 'warn');
      blob = await HVAC.img.compress(raw, { maxW: 720, quality: 0.7, maxBytes: 120 * 1024 });
      path = 'asistencia/' + mxToday().replace(/-/g, '/') + '/' + id + '.jpg';
      mxAttMsg('Subiendo foto…', 'warn');
      fotoUrl = await mxUploadPhoto(blob, path);       // null = sin señal: queda en la cola y se sube al sincronizar
    }
    const rec = {
      id, tecnico_id: u.id ? String(u.id) : null, tecnico_nombre: u.name || u.username || 'Técnico',
      cliente_id: geo.client ? String(geo.client.id) : null, cliente_nombre: name, tipo, fecha: mxToday(), hora: now.toISOString(),
      lat, lng, precision_m: Math.round(accuracy), sede_lat: geo.lat, sede_lng: geo.lng, radio_permitido_m: geo.radius,
      distancia_m: dist == null ? null : Math.round(dist), dentro_rango: inRange, order_id: null, foto_url: fotoUrl
    };
    const estado = inRange === true ? '✅ Dentro del rango (' + Math.round(dist) + ' m)' : inRange === false ? '⚠️ FUERA de rango (' + Math.round(dist) + ' m de ' + geo.radius + ' m)' : 'ℹ️ Sede sin coordenadas registradas';
    const hora = now.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
    const h = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const msg = [tipo === 'CHECK-IN' ? '🟢 <b>ENTRADA (Check-In)</b>' : '🔴 <b>SALIDA (Check-Out)</b>',
      '👷 <b>Técnico:</b> ' + h(rec.tecnico_nombre), '🏢 <b>Cliente / Sede:</b> ' + h(name), '🕒 <b>Fecha y hora:</b> ' + h(hora), '📡 <b>GPS:</b> ' + h(estado),
      '📍 <b>Ubicación:</b> https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6)].concat(fotoUrl ? ['📸 <b>Foto:</b> ' + fotoUrl] : []).join('\n');
    mxAttMsg('Guardando registro…', 'warn');
    const uploaded = blob ? !!fotoUrl : true;
    const saved = uploaded && !!(await HVAC.sb.insertIgnore(MX.TABLE, rec));
    if (!saved) {
      await HVAC.outbox.add({ id, type: 'asistencia', rec, path, photo: uploaded ? null : blob, msg });
      navigator.serviceWorker && navigator.serviceWorker.ready.then(r => r.sync && r.sync.register('hvac-outbox')).catch(() => {});
    }
    if (saved) enviarMarcacionTelegram(msg);   // segundo plano: no bloquea la confirmación
    localStorage.setItem(mxAttTodayKey, JSON.stringify({ date: rec.fecha, tipo, cliente: name, hora: rec.hora }));
    mxShowDone(saved, estado + ' · Precisión GPS ±' + Math.round(accuracy) + ' m', inRange === false);
  } catch (e) { mxAttMsg(esc(e.message || 'Error al marcar.'), 'bad'); }
  finally { btns.forEach(b => b.disabled = false); }
}
HVAC.net.onChange(on => on && mxFlushQueue());
document.addEventListener('hvac-sync', mxFlushQueue);
setTimeout(mxFlushQueue, 4000);
{ const a = new URLSearchParams(location.search).get('accion'); if (a) setTimeout(() => { if (techCurrentUserRecord()) (a === 'qr' ? mxScanOpen : mxAttOpen)(); }, 2500); }

/* ---------------- Rutinas compartidas: refresco en vivo cada 30 s ---------------- */
async function mxPullShared() {
  if (!navigator.onLine || document.hidden || !techCurrentUserRecord()) return;
  if (!(workOrders || []).some(o => o && String(o.status).toUpperCase() !== 'COMPLETED' && orderTechs(o).length > 1)) return;   // sin rutinas compartidas abiertas no hay nada que fusionar
  const remote = await fetchMyActiveOrders({ maxAge: 300000 }); if (!Array.isArray(remote)) return;   // como máximo 1 petición cada 5 min
  let changed = false;
  remote.filter(r => orderTechs(r).length > 1).forEach(r => {
    const lo = workOrders.find(o => o && o.id === r.id);
    if (!lo) { workOrders.push(r); changed = true; return; }
    lo.executions = lo.executions || {};
    Object.entries(r.executions || {}).forEach(([k, v]) => { if (!lo.executions[k] || execTs(v) > execTs(lo.executions[k])) { lo.executions[k] = v; changed = true; } });
    const mergedIds = [...new Set([...(lo.equipmentIds || []), ...(r.equipmentIds || [])].map(String))];
    if (mergedIds.length !== (lo.equipmentIds || []).length) { lo.equipmentIds = mergedIds; changed = true; }
    const remoteDecisionTs = Date.parse(r.signatureDecisionAt || (r.clientSignature && r.clientSignature.timestamp) || '') || 0;
    const localDecisionTs = Date.parse(lo.signatureDecisionAt || (lo.clientSignature && lo.clientSignature.timestamp) || '') || 0;
    if (remoteDecisionTs > localDecisionTs && techSignatureDecision(r) !== 'PENDING') {
      ['signatureDecision', 'signatureDecisionAt', 'signatureDecisionBy', 'signatureDecisionReason'].forEach(k => { if (r[k] !== undefined) lo[k] = r[k]; });
      if (r.clientSignature && (!r.clientSignature._lite || !lo.clientSignature)) lo.clientSignature = r.clientSignature;
      changed = true;
    }
    if (r.technicianFinished && !lo.technicianFinished) { lo.technicianFinished = true; lo.technicianFinishedAt = r.technicianFinishedAt; changed = true; }
    const effective = techEffectiveStatus(lo);
    if (effective === 'PENDING' && String(lo.status).toUpperCase() !== 'PENDING') { lo.status = 'PENDING'; lo.technicianFinished = false; changed = true; }
    else if (effective === 'COMPLETED' && String(r.status).toUpperCase() === 'COMPLETED' && String(lo.status).toUpperCase() === 'PENDING') { lo.status = 'COMPLETED'; changed = true; }
  });
  if (!changed) return;
  try { localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders)); } catch (e) {}
  try { renderTechAgenda(); } catch (e) {}
  const hub = document.getElementById('order-hub-modal-backdrop');
  if (hub && !hub.classList.contains('hidden')) { const o = workOrders.find(x => x && x.id === currentExecOrderId); if (o) try { renderOrderHubEquipments(o); } catch (e) {} }
}
setInterval(mxPullShared, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) mxPullShared(); });

/* ---------------- Botones en la barra inferior ---------------- */
(function () {
  const bar = document.querySelector('#tech-tabbar .tabbar-in'); if (!bar) return;
  bar.classList.add('mx-5');
  const b1 = document.createElement('button'); b1.className = 'tab'; b1.innerHTML = '<i class="fa-solid fa-qrcode"></i>Escanear'; b1.onclick = mxScanOpen;
  const b2 = document.createElement('button'); b2.className = 'tab'; b2.innerHTML = '<i class="fa-solid fa-location-dot"></i>Asistencia'; b2.onclick = mxAttOpen;
  bar.insertBefore(b2, bar.children[1]); bar.insertBefore(b1, bar.children[1]);
})();
