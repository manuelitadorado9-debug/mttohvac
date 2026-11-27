
        const SUPABASE_URL = "https://ahmicbkxpudqafbiuiav.supabase.co";
        const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFobWljYmt4cHVkcWFmYml1aWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3MzAzNjAsImV4cCI6MjEwOTMwNjM2MH0.PkzGSE948meZUTinKaexHqWaTKu1Srh2gm0V7JpwZdc";

        // UUID obligatorio para claves primarias y relaciones offline. No usar consecutivos como PK.
        function hvacUUID() {
            if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
                throw new Error('Este navegador no soporta crypto.randomUUID(); abre la aplicación en HTTPS o localhost.');
            }
            return globalThis.crypto.randomUUID();
        }
        function hvacStorageError(err, context) {
            const quota = err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
            console.error('[Almacenamiento] ' + context, err);
            try { if (typeof showToast === 'function') showToast(quota ? 'El almacenamiento local está lleno. Libera espacio o sincroniza los cambios antes de continuar.' : 'No se pudo guardar en el almacenamiento local. Tus cambios podrían quedar pendientes.', 'error'); } catch (_) {}
            return err;
        }
        // ===== Almacenamiento local con respaldo IndexedDB (sin pérdida al agotar localStorage) =====
        const HVAC_FINANCIAL_PROJECTIONS_KEY = 'HVAC_FINANCIAL_PROJECTIONS_BACKUP';
        // Preferencias operativas compartidas: se guardan en hvac_app_state y aplican a todos los administradores.
        const HVAC_UI_SETTINGS_KEY = 'HVAC_UI_SETTINGS_BACKUP';
        const HVAC_UI_SETTINGS_SYNC_AT_KEY = 'HVAC_UI_SETTINGS_SYNC_AT';
        const HVAC_UI_SETTINGS_REMOTE_EXISTS_KEY = 'HVAC_UI_SETTINGS_REMOTE_EXISTS';
        const HVAC_PERIOD_ALERTS_HIDDEN_KEY = 'HVAC_PERIOD_ALERTS_HIDDEN_BACKUP';
        const CLOUD_STATE_KEYS = ['HVAC_PROJECTIONS_BACKUP', 'HVAC_AGENDA_BACKUP', 'HVAC_CAJA_BACKUP', 'HVAC_CAJA_SEQUENCE', 'HVAC_LEGALIZATIONS_BACKUP', 'HVAC_FORMS_CONFIG_BACKUP', HVAC_FINANCIAL_PROJECTIONS_KEY, HVAC_PERIOD_ALERTS_HIDDEN_KEY, HVAC_UI_SETTINGS_KEY];
        const cloudStateCtl = { muted: false, disabled: false, timers: {}, quotaWarnedAt: 0 };
        const hvacMemoryStorage = new Map();
        let hvacDbPromise = null;
        let hvacDbReady = false;
        let hvacStorageWriteTail = Promise.resolve();
        const hvacNativeGetItem = Storage.prototype.getItem;
        const hvacNativeSetItem = Storage.prototype.setItem;
        const hvacNativeRemoveItem = Storage.prototype.removeItem;
        function hvacOpenDb() {
            if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB no está disponible'));
            if (!hvacDbPromise) hvacDbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open('HVAC_GMAO_OFFLINE_V1', 1);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'id' });
                };
                request.onsuccess = () => { hvacDbReady = true; resolve(request.result); };
                request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
                request.onblocked = () => reject(new Error('IndexedDB está bloqueado por otra pestaña'));
            });
            return hvacDbPromise;
        }
        function hvacIDBSet(id, value) {
            return hvacOpenDb().then(db => new Promise((resolve, reject) => {
                let tx; try { tx = db.transaction('kv', 'readwrite'); const req = tx.objectStore('kv').put({ id: String(id), value: String(value), updatedAt: Date.now() }); req.onerror = () => { try { hvacStorageError(req.error, 'Escritura IndexedDB'); } catch (_) {} }; } catch (e) { reject(e); return; }
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => { const e = tx.error || new Error('No se pudo respaldar en IndexedDB'); hvacStorageError(e, 'Transacción IndexedDB'); reject(e); };
            }));
        }
        function hvacIDBDelete(id) {
            return hvacOpenDb().then(db => new Promise((resolve, reject) => {
                let tx; try { tx = db.transaction('kv', 'readwrite'); const req = tx.objectStore('kv').delete(String(id)); req.onerror = () => { try { hvacStorageError(req.error, 'Borrado IndexedDB'); } catch (_) {} }; } catch (e) { reject(e); return; }
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => { const e = tx.error || new Error('No se pudo borrar de IndexedDB'); hvacStorageError(e, 'Transacción IndexedDB'); reject(e); };
            }));
        }
        async function hvacRestoreIndexedStorage() {
            try {
                const db = await hvacOpenDb();
                const rows = await new Promise((resolve, reject) => {
                    const tx = db.transaction('kv', 'readonly');
                    const req = tx.objectStore('kv').getAll();
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => reject(req.error);
                });
                rows.forEach(row => {
                    if (!row || typeof row.id !== 'string' || row.id.indexOf('HVAC_') !== 0 || row.id.indexOf('HVAC_OUTBOX::') === 0) return;
                    let value = String(row.value);
                    try {
                        const localTs = Number(hvacNativeGetItem.call(window.localStorage, 'HVAC_TS_' + row.id)) || 0;
                        const localValue = hvacNativeGetItem.call(window.localStorage, row.id);
                        if (localValue !== null && localTs > Number(row.updatedAt || 0)) value = localValue;
                    } catch (_) {}
                    hvacMemoryStorage.set(row.id, value);
                    if (value.length <= 700 * 1024) {
                        try { hvacNativeSetItem.call(window.localStorage, row.id, value); } catch (_) {}
                    }
                });
            } catch (e) {
                console.info('[Storage] IndexedDB no disponible; se usará localStorage:', e && e.message || e);
            }
        }
        const hvacStorageReady = hvacRestoreIndexedStorage();
        function hvacFlushStorageWrites() { return hvacStorageWriteTail.catch(() => {}); }
        (function patchStorage() {
            try {
                const orig = hvacNativeSetItem;
                const origGet = hvacNativeGetItem;
                const origRemove = hvacNativeRemoveItem;
                Storage.prototype.getItem = function (k) {
                    const key = String(k);
                    if (this === window.localStorage && hvacMemoryStorage.has(key)) return hvacMemoryStorage.get(key);
                    return origGet.call(this, k);
                };
                Storage.prototype.setItem = function (k, v) {
                    const key = String(k), value = String(v);
                    const isHVAC = key.indexOf('HVAC_') === 0;
                    if (this === window.localStorage && isHVAC) {
                        hvacMemoryStorage.set(key, value);
                        hvacStorageWriteTail = hvacStorageWriteTail.then(() => hvacIDBSet(key, value)).catch(e => {
                            console.warn('[Storage] Respaldo IndexedDB pendiente/no disponible para ' + key, e);
                        });
                    }
                    const idbOnly = this === window.localStorage && isHVAC && hvacDbReady && value.length > 700 * 1024;
                    try {
                        if (!idbOnly) orig.call(this, k, value);
                    } catch (e) {
                        if (isHVAC) {
                            console.error('[Storage] No se pudo guardar ' + k + ' (cuota llena o bloqueado):', e);
                            if (Date.now() - cloudStateCtl.quotaWarnedAt > 60000) {
                                cloudStateCtl.quotaWarnedAt = Date.now();
                                try { showToast('Almacenamiento local casi lleno: respaldo offline guardado en IndexedDB.', 'error'); } catch (_) {}
                            }
                            return;
                        }
                        throw e;
                    }
                    if (this === window.localStorage && isHVAC && key.indexOf('HVAC_TS_') !== 0) {
                        try { orig.call(this, 'HVAC_TS_' + key, String(Date.now())); } catch (_) {}
                    }
                    if (this === window.localStorage && CLOUD_STATE_KEYS.indexOf(String(k)) !== -1 && !cloudStateCtl.muted) {
                        try { orig.call(this, 'HVAC_TS_' + k, String(Date.now())); } catch (_) {}
                        if (typeof cloudScheduleStatePush === 'function') cloudScheduleStatePush(String(k));
                    }
                };
                Storage.prototype.removeItem = function (k) {
                    const key = String(k);
                    if (this === window.localStorage && key.indexOf('HVAC_') === 0) {
                        hvacMemoryStorage.delete(key);
                        hvacStorageWriteTail = hvacStorageWriteTail.then(() => hvacIDBDelete(key)).catch(() => {});
                    }
                    return origRemove.call(this, k);
                };
            } catch (e) { console.warn('patchStorage', e); }
        })();

        let activeUser = null;
        let activeSessionRole = null;
        let activeSessionExpiresAt = null;
        let sessionAuthenticated = false;
        const AUTH_SESSION_KEY = 'HVAC_AUTH_SESSION_ADMIN';
        const AUTH_SESSION_TTL = 24 * 60 * 60 * 1000; // la sesión dura 24 h o hasta pulsar "Cerrar sesión"
        let currentExecOrderId = null;
        let currentExecEqId = null;
        let sigCanvas, sigCtx, isDrawing = false;
        let tempPhotosList = [];
        let adminAmendmentMode = false;
        let adminAmendmentIsPostCompletion = false;
        let adminAmendmentNewPhotos = [];
        let adminAmendmentExecKey = null;
        let currentHubTab = 'equipos'; // 'equipos' o 'correctivos'

        // Imágenes oficiales de encabezado y pie de página (1241x93 px c/u)
        let AFC_HEADER_IMG = ''; // se carga desde Supabase Storage (common.js)
        let AFC_FOOTER_IMG = ''; // se carga desde Supabase Storage (common.js)

        let systemUsers = [];
        let equipmentCatalog = [];
        let workOrders = [];
        let clientsCatalog = [];
        let monthlyProjections = [];
        let agendaItems = [];
        let cajaMenorItems = [];
        let cajaLegalizations = [];
        let equipmentFormsConfig = {
            "EXTRACTOR": { name: "EXTRACTOR", params: "Voltaje (V), Amperaje (A)", checklist: "Limpieza de Filtros de Aire\nLavado de Serpentín\nAjuste de Bornes Eléctricos" },
            "MINISPLIT": { name: "MINISPLIT", params: "Voltaje (V), Amperaje (A), Presión Succión (PSI), Presión Descarga (PSI)", checklist: "Limpieza de Filtros de Aire\nLavado de Serpentín Evaporador\nLavado de Serpentín Condensador\nLimpieza de Bandeja y Desagüe\nAjuste de Bornes Eléctricos\nVerificación de Presiones y Gas" }
        };

        // ===== Normalización de textos (filtros y relaciones cliente ↔ equipo) =====
        // normText: minúsculas, sin tildes, sin espacios extra → "Clínica  La Carolina " == "clinica la carolina"
        const normText = v => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[\s\u00a0\u200b]+/g, ' ').trim().toLowerCase();
        // Sufijos de ubicación que se agrupan bajo la raíz del cliente: "Jocol piso 16" → "Jocol".
        const CLIENT_SUFFIX_RE = /\s*[-–—,:]?\s*\b(?:pisos|piso|nivel|s[oó]tano|planta|oficina|ofc|of)(?![a-z])\.?\s*(?:n[°º.]?\s*)?#?\s*\d[\w\s.\-/]*$/i;
        const cleanSpaces = v => String(v == null ? '' : v).replace(/[\s\u00a0\u200b]+/g, ' ').trim();
        // Criterio único de orden alfabético para TODAS las listas de clientes de la app.
        // Respeta el alfabeto español, ignora mayúsculas/tildes y ordena números de forma natural.
        function compareClientNames(a, b) {
            const left = cleanSpaces(a), right = cleanSpaces(b);
            return left.localeCompare(right, 'es', { sensitivity: 'base', numeric: true }) ||
                left.localeCompare(right, 'es', { sensitivity: 'variant', numeric: true });
        }
        function getSortedClientRecords(source = clientsCatalog) {
            return (Array.isArray(source) ? source : []).filter(c => c && cleanSpaces(c.name))
                .slice().sort((a, b) => compareClientNames(a.name, b.name) ||
                    String(a.id == null ? '' : a.id).localeCompare(String(b.id == null ? '' : b.id), 'es', { numeric: true }));
        }
        function getSortedUniqueClientNames(source) {
            return [...new Set((Array.isArray(source) ? source : []).map(cleanSpaces).filter(Boolean))]
                .sort(compareClientNames);
        }
        // Ausencia de estado = cliente activo (compatibilidad con el catálogo histórico).
        // Un cliente NO ACTIVO se conserva en el directorio, facturación e histórico, pero no en selectores operativos.
        function isClientActiveRecord(client) {
            if (!client) return false;
            const raw = client.active !== undefined ? client.active : (client.isActive !== undefined ? client.isActive : client.activo);
            if (raw === false || raw === 0 || ['false','0','no','no activo','inactivo','inactive','desactivado','disabled'].includes(normText(raw))) return false;
            const status = normText(client.estado || client.status || client.estatus || '');
            return !['no activo','inactivo','inactive','desactivado','disabled'].includes(status);
        }
        function getActiveOfficialClientNames() {
            const seen = new Map();
            clientsCatalog.filter(isClientActiveRecord).forEach(c => { const n = cleanSpaces(c && c.name), k = normText(n); if (k && !seen.has(k)) seen.set(k, n); });
            return [...seen.values()].sort(compareClientNames);
        }
        const clientRootLabel = name => cleanSpaces(name).replace(CLIENT_SUFFIX_RE, '').trim() || cleanSpaces(name);
        const clientRootKey = name => normText(clientRootLabel(name));
        const sameClient = (a, b) => { const k = normText(a); return k !== '' && k === normText(b); };
        // Nombre de cliente de un equipo: soporta registros antiguos que guardaban clientName o clientId.
        // Nombre de cliente de un equipo. Prioriza el vínculo por clientId (sigue renombres del catálogo);
        // soporta registros antiguos que solo guardaban client / clientName.
        function eqClientName(e) {
            if (!e) return '';
            if (e.clientId != null && e.clientId !== '') {
                const c = clientsCatalog.find(x => String(x.id) === String(e.clientId));
                if (c && c.name) return c.name;
            }
            return e.client || e.clientName || '';
        }
        // Registro oficial del catálogo de clientes cuyo nombre coincide (sin tildes / espacios / mayúsculas).
        function findClientRecord(name) {
            const k = normText(name);
            return k ? (clientsCatalog.find(c => c && normText(c.name) === k) || null) : null;
        }
        // Vincula un registro (equipo u orden) con su cliente: nombre oficial + clientId.
        function linkClientFields(obj, name) {
            const rec = findClientRecord(name);
            if (rec) { obj.client = rec.name; obj.clientId = rec.id; }
            else { obj.client = cleanSpaces(name); delete obj.clientId; }
            return obj;
        }
        // ¿El equipo pertenece a ese cliente? Compara por clientId cuando existe; si no, por nombre normalizado.
        function eqBelongsToClient(e, clientName) {
            const rec = findClientRecord(clientName);
            if (rec && e && e.clientId != null && e.clientId !== '') return String(e.clientId) === String(rec.id);
            return sameClient(eqClientName(e), clientName);
        }
        // ID único (marca de tiempo completa en base 36 + sufijo aleatorio). Evita las colisiones de los IDs de 5 dígitos.
        function newUniqueId(prefix, takenList) {
            // prefix se conserva por compatibilidad con las llamadas existentes; la PK siempre es UUID.
            const taken = new Set((takenList || []).filter(Boolean).map(x => String(x.id)));
            let id; do { id = hvacUUID(); } while (taken.has(id));
            return id;
        }
        // ----- Consecutivos: PRE-0001 (preventivo) y COR-0001 (correctivo). Los PREV0001 heredados siguen ordenándose. -----
const CONSEC_PREF = { PREVENTIVO: 'PRE-', CORRECTIVO: 'COR-', REVISION: 'REV-' }, PREV_DIGITS = 4;
function prevFormat(n, pref = 'PRE-') { return pref + String(n).padStart(PREV_DIGITS, '0'); }
function consecParse(id, pref) { const m = new RegExp('^' + pref + '(\\d+)(?:-P\\d+)?$', 'i').exec(String(id || '').trim()); return m ? parseInt(m[1], 10) : 0; }
// Número ordenable: PREV#### (heredado) < PRE-#### / COR-####
function prevParse(id) {
    const s = String(id || '').trim(); let m = /^PREV(\d+)$/i.exec(s); if (m) return parseInt(m[1], 10);
    m = /^(?:PRE|COR|REV)-(\d+)(?:-P(\d+))?$/i.exec(s); return m ? 100000 + parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 1000 : 0) : 0;
}
function consecLocalMax(pref) {
    let max = 0;
    (workOrders || []).forEach(o => { const n = consecParse(o && o.id, pref); if (n > max) max = n; });
    try { const c = parseInt(localStorage.getItem('HVAC_CONSEC_' + pref), 10); if (c > max) max = c; } catch (e) {}
    return max;
}
let prevReserveChain = Promise.resolve();
// Consecutivos reservados en esta sesión que aún no se han guardado como orden (evita duplicados al crear varias seguidas).
const prevPendingIds = new Set();
const consecCloudCache = {};
// Números ya usados para un prefijo: órdenes locales + reservas pendientes + (si hay red) todas las órdenes de la nube.
async function consecUsedNumbers(pref) {
    const used = new Set();
    const add = id => { const n = consecParse(id, pref); if (n > 0) used.add(n); };
    (workOrders || []).forEach(o => add(o && o.id));
    prevPendingIds.forEach(add);
    const cached = consecCloudCache[pref];
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) { cached.ids.forEach(add); return used; }   // evita consultas repetidas (ahorra transferencia)
    if (navigator.onLine !== false) {
        try {
            const ids = [];
            for (let off = 0; off < 20000; off += 1000) {
                // Solo la columna id y solo las filas del prefijo: unos pocos KB aunque haya miles de órdenes.
                const rows = await Promise.race([
                    supabaseFetch('hvac_orders?select=id&id=like.' + pref + '*&order=id.asc&limit=1000&offset=' + off, 'GET', null, null, { quiet: true }),
                    new Promise(res => setTimeout(() => res(null), 5000))
                ]);
                if (!Array.isArray(rows)) break;
                rows.forEach(r => ids.push(r && r.id));
                if (rows.length < 1000) { consecCloudCache[pref] = { at: Date.now(), ids }; break; }
            }
            ids.forEach(add);
        } catch (e) { /* sin nube: se usa solo lo local */ }
    }
    return used;
}
// k-ésimo número libre (el más bajo disponible) según lo que hay cargado localmente; se usa en la vista previa.
function consecFreeLocal(pref, k = 1) {
    const used = new Set();
    (workOrders || []).forEach(o => { const n = consecParse(o && o.id, pref); if (n > 0) used.add(n); });
    prevPendingIds.forEach(id => { const n = consecParse(id, pref); if (n > 0) used.add(n); });
    let n = 0, found = 0;
    while (found < k) { n++; if (!used.has(n)) found++; }
    return n;
}
// Reserva el consecutivo MÁS BAJO disponible (rellena huecos de órdenes borradas) para PRE-, COR- o REV-.
function reservePrevId(tipo = 'PREVENTIVO') {
    const pref = CONSEC_PREF[tipo] || 'PRE-';
    const run = async () => {
        const used = await consecUsedNumbers(pref);
        let n = 1;
        while (used.has(n)) n++;
        const id = prevFormat(n, pref);
        prevPendingIds.add(id);
        deletedOrderIdClear(id); // si el consecutivo estaba borrado, vuelve a quedar habilitado
        return id;
    };
    const p = prevReserveChain.then(run, run);
    prevReserveChain = p.catch(() => {});
    return p;
}
// ----- Orden cronológico (más reciente primero) -----
        function parseFlexDate(v) {
            if (!v) return 0;
            let t = Date.parse(v);
            if (Number.isFinite(t)) return t;
            const m = String(v).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
            if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; t = Date.UTC(y, +m[2] - 1, +m[1]); return Number.isFinite(t) ? t : 0; }
            return 0;
        }
        // Momento de registro/asignación: createdAt o, en órdenes antiguas, la última actividad registrada.
        function orderActivityStamp(o) {
            if (!o) return 0;
            const created = parseFlexDate(o.createdAt);
            if (created) return created;
            let t = 0;
            const ex = o.executions || {};
            Object.keys(ex).forEach(k => { const v = parseFlexDate(ex[k] && ex[k].timestamp); if (v > t) t = v; });
            const sig = parseFlexDate(o.clientSignature && o.clientSignature.timestamp);
            return sig > t ? sig : t;
        }
        function compareOrdersDesc(a, b) {
            const da = parseFlexDate(a && a.date), db = parseFlexDate(b && b.date);
            if (da !== db) return db - da;
            const ta = orderActivityStamp(a), tb = orderActivityStamp(b);
            if (ta !== tb) return tb - ta;
            return String((b && b.id) || '').localeCompare(String((a && a.id) || ''), 'es', { numeric: true });
        }
        // Orden por consecutivo (PREV0007 > PREV0006 ...); las órdenes antiguas sin PREV quedan al final.
        function compareOrdersSeqDesc(a, b) {
            const na = prevParse(a && a.id), nb = prevParse(b && b.id);
            if (na !== nb) return nb - na;
            return compareOrdersDesc(a, b);
        }
        // Orden por fecha real de creación (createdAt); si falta, última actividad registrada o fecha programada.
        function orderCreatedStamp(o) { return orderActivityStamp(o) || parseFlexDate(o && o.date); }
        function compareOrdersCreatedDesc(a, b) {
            const ta = orderCreatedStamp(a), tb = orderCreatedStamp(b);
            if (ta !== tb) return tb - ta;
            return compareOrdersSeqDesc(a, b);
        }
        function historySortMode() { return (document.getElementById('hist-sort') || {}).value || 'recent'; }
        function getHistoryComparator() {
            switch (historySortMode()) {
                case 'oldest': return (a, b) => compareOrdersDesc(b, a);
                case 'seq-desc': return compareOrdersSeqDesc;
                case 'seq-asc': return (a, b) => compareOrdersSeqDesc(b, a);
                case 'created-desc': return compareOrdersCreatedDesc;
                case 'created-asc': return (a, b) => compareOrdersCreatedDesc(b, a);
                default: return compareOrdersDesc;
            }
        }
        function historyServerOrder() {
            switch (historySortMode()) {
                case 'oldest': return 'payload->>date.asc';
                case 'seq-desc': return 'id.desc';
                case 'seq-asc': return 'id.asc';
                case 'created-desc': return 'payload->>createdAt.desc.nullslast';
                case 'created-asc': return 'payload->>createdAt.asc.nullsfirst';
                default: return 'payload->>date.desc';
            }
        }
        function matchesClientFilter(name, filterValue) {
            return !filterValue || filterValue === 'ALL' || clientRootKey(name) === filterValue;
        }
        // Lista única de clientes (sin duplicados por tildes/espacios); el catálogo oficial tiene prioridad.
        function getCanonicalClientNames() {
            const seen = new Map();
            const add = n => { const k = normText(n); if (k && !seen.has(k)) seen.set(k, cleanSpaces(n)); };
            clientsCatalog.forEach(c => add(c && c.name));
            equipmentCatalog.forEach(e => add(eqClientName(e)));
            workOrders.forEach(o => add(o && (o.client || o.clientName)));
            if (typeof hvacManualInvoicesRead === 'function') hvacManualInvoicesRead().forEach(item => add(item && hvacManualInvoiceClientName(item)));
            return [...seen.values()].sort(compareClientNames);
        }
        function canonicalClientName(name) {
            const k = normText(name);
            return getCanonicalClientNames().find(n => normText(n) === k) || cleanSpaces(name);
        }
        // Tipo de mantenimiento/equipo: "Mini split", "MINISPLIT " y "mini-split" resuelven a la misma plantilla.
        const compactKey = v => normText(v).replace(/[^a-z0-9]/g, '').toUpperCase();
        function resolveFormTypeKey(raw) {
            const cfg = equipmentFormsConfig || {};
            const wanted = compactKey(raw || 'EXTRACTOR');
            const keys = Object.keys(cfg);
            const hit = keys.find(k => compactKey(k) === wanted) ||
                keys.find(k => cfg[k] && compactKey(cfg[k].name) === wanted);
            return hit || String(raw || 'EXTRACTOR').trim().toUpperCase();
        }

        // ===== SANITIZACION XSS =====
        // esc(): texto -> HTML seguro (contenido de etiquetas y atributos entre comillas).
        function esc(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/`/g, '&#96;');
        }
        // escJs(): texto -> argumento seguro dentro de onclick="fn('...')".
        function escJs(value) {
            return esc(String(value == null ? '' : value)
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\r?\n/g, '\\n'));
        }

        // =====================================================================
        //  SEGURIDAD DE CONTRASEÑAS  (PBKDF2-SHA256 + sal aleatoria, con CryptoJS)
        //  Requiere cargar CryptoJS 4.2.0 (cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js)
        //  con una etiqueta de script en el head de index.html y de tecnico.html.
        //  Formato guardado en el usuario:  passwordHash = "pbkdf2$10000$<sal>$<hash>"
        // =====================================================================
        const AUTH_ITERATIONS = 10000;
        const AUTH_MIN_LEN = 8;
        const AUTH_PREFIX = 'pbkdf2';
        const authIntentos = { n: 0, hasta: 0 };

        function authRandomSalt() {
            const bytes = new Uint8Array(16);
            (window.crypto || window.msCrypto).getRandomValues(bytes);
            return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        }

        function authDerive(password, saltHex, iterations) {
            return CryptoJS.PBKDF2(String(password), CryptoJS.enc.Hex.parse(saltHex), {
                keySize: 256 / 32,
                iterations: iterations,
                hasher: CryptoJS.algo.SHA256
            }).toString(CryptoJS.enc.Hex);
        }

        // Convierte una contraseña en texto plano al valor que se guarda en la base de datos.
        function hashPassword(password) {
            const salt = authRandomSalt();
            return AUTH_PREFIX + '$' + AUTH_ITERATIONS + '$' + salt + '$' + authDerive(password, salt, AUTH_ITERATIONS);
        }

        function authIgual(a, b) {                       // comparación en tiempo constante
            a = String(a); b = String(b);
            let diff = a.length ^ b.length;
            for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
            return diff === 0;
        }

        // Compara la contraseña escrita contra el hash guardado (reemplaza a u.password === passwordInput).
        function verifyPassword(password, stored) {
            if (typeof stored !== 'string') return false;
            const p = stored.split('$');
            if (p.length !== 4 || p[0] !== AUTH_PREFIX) return false;
            const iterations = parseInt(p[1], 10);
            if (!iterations || iterations < 1000) return false;
            return authIgual(authDerive(password, p[2], iterations), p[3]);
        }

        // ---- límite de intentos: 5 fallos = 30 s de bloqueo ----
        function authBloqueado() { return Date.now() < authIntentos.hasta; }
        function authFallo() { if (++authIntentos.n >= 5) { authIntentos.n = 0; authIntentos.hasta = Date.now() + 30000; } }
        function authAcierto() { authIntentos.n = 0; }

        // ---- pide una contraseña nueva (3 intentos) ----
                // ---- Diálogo propio para pedir datos sensibles (reemplaza window.prompt) ----
        // cfg: { title, intro, fields:[{label,type,autocomplete,placeholder}], submitText, cancelable, validate(valores)->texto de error o '' }
        // Devuelve una promesa con el arreglo de valores, o null si se cancela.
        function hvAuthDialog(cfg) {
            return new Promise(resolve => {
                const previo = document.activeElement;
                const wrap = document.createElement('div');
                wrap.className = 'hv-dlg-backdrop';
                wrap.setAttribute('role', 'dialog');
                wrap.setAttribute('aria-modal', 'true');
                wrap.setAttribute('aria-labelledby', 'hv-dlg-title');
                const campos = cfg.fields.map((f, i) =>
                    '<label class="hv-dlg-field" for="hv-dlg-f' + i + '"><span>' + esc(f.label) + '</span>' +
                    '<input id="hv-dlg-f' + i + '" type="' + (f.type || 'text') + '" autocomplete="' + (f.autocomplete || 'off') + '"' +
                    ' autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="' + esc(f.placeholder || '') + '"></label>').join('');
                wrap.innerHTML = '<form class="hv-dlg-card" novalidate>' +
                    '<h3 id="hv-dlg-title">' + esc(cfg.title) + '</h3>' + (cfg.intro ? '<p>' + esc(cfg.intro) + '</p>' : '') + campos +
                    '<div class="hv-dlg-err" role="alert" hidden></div>' +
                    '<div class="hv-dlg-actions">' + (cfg.cancelable === false ? '' : '<button type="button" class="hv-dlg-btn ghost" data-cancel>Cancelar</button>') +
                    '<button type="submit" class="hv-dlg-btn">' + esc(cfg.submitText || 'Continuar') + '</button></div></form>';
                const form = wrap.firstChild, err = form.querySelector('.hv-dlg-err');
                const cerrar = valor => { document.removeEventListener('keydown', onKey, true); wrap.remove(); try { previo && previo.focus && previo.focus(); } catch (_) {} resolve(valor); };
                const onKey = e => { if (e.key === 'Escape' && cfg.cancelable !== false) { e.preventDefault(); cerrar(null); } };
                form.addEventListener('submit', e => {
                    e.preventDefault();
                    const vals = Array.from(form.querySelectorAll('input')).map(i => i.value);
                    const msg = cfg.validate ? cfg.validate(vals) : '';
                    if (msg) { err.textContent = msg; err.hidden = false; return; }
                    cerrar(vals);
                });
                const btnCancel = form.querySelector('[data-cancel]');
                if (btnCancel) btnCancel.addEventListener('click', () => cerrar(null));
                document.addEventListener('keydown', onKey, true);
                document.body.appendChild(wrap);
                const primero = form.querySelector('input'); if (primero) primero.focus();
            });
        }

async function authPedirNuevaClave() {
            const r = await hvAuthDialog({
                title: 'Crea una nueva contraseña',
                intro: 'Por seguridad debes reemplazar tu contraseña actual. Mínimo ' + AUTH_MIN_LEN + ' caracteres.',
                fields: [
                    { label: 'Nueva contraseña', type: 'password', autocomplete: 'new-password' },
                    { label: 'Repite la nueva contraseña', type: 'password', autocomplete: 'new-password' }
                ],
                submitText: 'Guardar contraseña',
                validate: v => {
                    const a = v[0].trim(), b = v[1].trim();
                    if (a.length < AUTH_MIN_LEN || a === '123') return 'La contraseña debe tener al menos ' + AUTH_MIN_LEN + ' caracteres.';
                    return a === b ? '' : 'Las contraseñas no coinciden.';
                }
            });
            return r ? r[0].trim() : null;
        }

        // Verifica el login. Si la cuenta aún tiene contraseña en texto plano, la convierte a hash
        // (y exige cambiarla si es débil, p. ej. "123").
        // Devuelve { ok, changed }: si changed=true hay que guardar el usuario (authGuardarUsuario).
        async function authRevisarClave(user, passwordInput) {
            if (!user) return { ok: false, changed: false };
            let changed = false;
            if (user.passwordHash) {
                if (!verifyPassword(passwordInput, user.passwordHash)) return { ok: false, changed: false };
            } else if (typeof user.password === 'string' && user.password && authIgual(user.password, passwordInput)) {
                user.passwordHash = hashPassword(passwordInput);
                delete user.password;
                changed = true;
                if (passwordInput.length < AUTH_MIN_LEN) user.debeCambiarClave = true;
            } else {
                return { ok: false, changed: false };
            }
            if (user.debeCambiarClave) {
                const nueva = await authPedirNuevaClave();
                if (!nueva) return { ok: false, changed };
                user.passwordHash = hashPassword(nueva);
                delete user.debeCambiarClave;
                changed = true;
            }
            return { ok: true, changed };
        }

        // Guarda en la nube y en el respaldo local (backupKey: 'HVAC_USERS_BACKUP' en admin, 'HVAC_TECH_USERS_BACKUP' en técnico).
        function authGuardarUsuario(user, backupKey) {
            try { cloudSaveUser(user); } catch (e) { console.warn('[Auth] No se pudo guardar el usuario:', e); }
            try { localStorage.setItem(backupKey, JSON.stringify(systemUsers)); } catch (e) {}
        }

        // Primer ingreso: solo si la tabla de usuarios en la nube está VACÍA.
        async function authCrearAdminInicial() {
            const r = await hvAuthDialog({
                title: 'Primer ingreso: crea el administrador',
                intro: 'Todavía no hay usuarios en el sistema. Esta cuenta tendrá control total.',
                fields: [
                    { label: 'Nombre del administrador', type: 'text', autocomplete: 'name' },
                    { label: 'Usuario (sin espacios)', type: 'text', autocomplete: 'username' },
                    { label: 'Contraseña', type: 'password', autocomplete: 'new-password' },
                    { label: 'Repite la contraseña', type: 'password', autocomplete: 'new-password' }
                ],
                submitText: 'Crear administrador',
                validate: v => {
                    if (!v[0].trim() || !v[1].trim()) return 'Escribe el nombre y el usuario.';
                    if (/\s/.test(v[1].trim())) return 'El usuario no puede tener espacios.';
                    if (v[2].trim().length < AUTH_MIN_LEN) return 'La contraseña debe tener al menos ' + AUTH_MIN_LEN + ' caracteres.';
                    return v[2].trim() === v[3].trim() ? '' : 'Las contraseñas no coinciden.';
                }
            });
            if (!r) return null;
            const name = r[0].trim(), username = r[1].trim().toLowerCase(), p1 = r[2].trim();
            const admin = { id: 'ADMIN', username, name, role: 'ADMIN', passwordHash: hashPassword(p1) };
            systemUsers = [admin];
            await cloudSaveUser(admin);
            localStorage.setItem('HVAC_USERS_BACKUP', JSON.stringify(systemUsers));
            return admin;
        }

        // UNA SOLA VEZ (consola del admin):  await authMigrarTodasLasClaves()
        // Convierte todas las contraseñas antiguas en texto plano a hash y obliga a cambiar las débiles ("123").
        async function authMigrarTodasLasClaves() {
            let n = 0;
            for (const u of systemUsers) {
                if (typeof u.password === 'string' && u.password && !u.passwordHash) {
                    if (u.password.length < AUTH_MIN_LEN) u.debeCambiarClave = true;
                    u.passwordHash = hashPassword(u.password);
                    delete u.password;
                    await cloudSaveUser(u);
                    n++;
                }
            }
            localStorage.setItem('HVAC_USERS_BACKUP', JSON.stringify(systemUsers));
            showToast('Contraseñas convertidas a hash: ' + n);
            return n;
        }

        // =====================================================================
        //  SINCRONIZACIÓN POR FILAS (agenda, caja, proyecciones, legalizaciones)
        //  Reemplaza el "bloque JSON completo" de hvac_app_state por tablas reales.
        //  - Solo se envían las filas que cambiaron (no se reescribe todo).
        //  - Control de versión optimista: si otra persona modificó la misma fila,
        //    NO se pisa: se conserva lo ya guardado y tu copia queda respaldada.
        // =====================================================================
        const ESTADO_TABLAS = {
            HVAC_AGENDA_BACKUP: 'hvac_agenda',
            HVAC_CAJA_BACKUP: 'hvac_caja',
            HVAC_PROJECTIONS_BACKUP: 'hvac_proyecciones',
            HVAC_LEGALIZATIONS_BACKUP: 'hvac_legalizaciones'
        };
        const ESTADO_PAGINA = 200;
        const ESTADO_TTL_MS = 60000;   // no se vuelve a consultar una tabla consultada hace menos de 60 s (antes 20 s)
        const estadoCtl = { disabled: false, running: {}, again: {}, retry: {}, ultimo: {} };

        // ---------- utilidades ----------
        function estadoStable(v) {            // JSON con claves ordenadas (jsonb no conserva el orden)
            if (v === undefined) return 'null';
            if (v === null || typeof v !== 'object') return JSON.stringify(v);
            if (Array.isArray(v)) return '[' + v.map(estadoStable).join(',') + ']';
            return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
                .map(k => JSON.stringify(k) + ':' + estadoStable(v[k])).join(',') + '}';
        }
        function estadoHash(str) {
            let h1 = 0x811c9dc5, h2 = 5381;
            for (let i = 0; i < str.length; i++) {
                const c = str.charCodeAt(i);
                h1 ^= c; h1 = Math.imul(h1, 16777619);
                h2 = (Math.imul(h2, 33) + c) | 0;
            }
            return str.length + ':' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
        }
        function estadoHashObj(obj) { return estadoHash(estadoStable(JSON.parse(JSON.stringify(obj)))); }
        function estadoUsuario() {
            try {
                const u = (typeof systemUsers !== 'undefined' && typeof activeUser !== 'undefined')
                    ? systemUsers.find(x => String(x.id) === String(activeUser)) : null;
                return (u && (u.email || u.username)) || 'desconocido';
            } catch (e) { return 'desconocido'; }
        }
        function estadoLeerLocal(key) {
            try {
                const arr = JSON.parse(localStorage.getItem(key) || '[]');
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        }
        function estadoEscribirLocal(key, arr) {          // escritura "muda": no dispara un nuevo envío
            const prev = cloudStateCtl.muted;
            cloudStateCtl.muted = true;
            try { localStorage.setItem(key, JSON.stringify(arr)); } finally { cloudStateCtl.muted = prev; }
        }
        function estadoLeerSnap(key) {
            try { return JSON.parse(localStorage.getItem('HVAC_SYNC_SNAP_' + key) || '{}') || {}; } catch (e) { return {}; }
        }
        function estadoGuardarSnap(key, snap) {
            try { localStorage.setItem('HVAC_SYNC_SNAP_' + key, JSON.stringify(snap)); } catch (e) {}
        }
        function estadoSinTabla() {
            if (cloudCtl.lastStatus === 404) {
                estadoCtl.disabled = true;
                console.info('[Estado] Las tablas relacionales no existen todavía: se usa hvac_app_state. Ejecuta supabase_setup.sql.');
                return true;
            }
            return false;
        }
        function estadoGuardarConflicto(tabla, id, item) {   // respaldo de TU versión cuando pierdes un conflicto
            try {
                const log = JSON.parse(localStorage.getItem('HVAC_SYNC_CONFLICTS') || '[]');
                log.push({ at: new Date().toISOString(), tabla, id, item });
                localStorage.setItem('HVAC_SYNC_CONFLICTS', JSON.stringify(log.slice(-25)));
            } catch (e) {}
        }
        function estadoRefrescarUI() {
            try { if (typeof restoreLocalAppData === 'function') restoreLocalAppData(); } catch (e) {}
            try {
                if (typeof refreshAppFromCurrentData === 'function') refreshAppFromCurrentData();            // app del técnico
                else if (typeof renderSection === 'function') {                                              // panel admin
                    const sec = Array.from(document.querySelectorAll('main > section')).find(x => !x.classList.contains('hidden'));
                    if (sec && sec.id) renderSection(sec.id.replace('view-', ''));
                }
            } catch (e) {}
        }
        function estadoReemplazarLocal(key, remoteRow) {     // pone la versión remota de UNA fila en el arreglo local
            const arr = estadoLeerLocal(key);
            const id = String(remoteRow.id);
            const idx = arr.findIndex(x => x && String(x.id) === id);
            if (idx >= 0) arr[idx] = remoteRow.payload; else arr.push(remoteRow.payload);
            estadoEscribirLocal(key, arr);
        }
        function estadoProgramarReintento(key, ms) {
            clearTimeout(estadoCtl.retry[key]);
            estadoCtl.retry[key] = setTimeout(() => cloudScheduleStatePush(key, true), ms || 20000);
        }

        // ---------- conflicto: otra persona cambió la misma fila ----------
        async function estadoResolverConflicto(key, tabla, id, item, h, snap) {
            const rows = await supabaseFetch(`${tabla}?id=eq.${encodeURIComponent(id)}&select=id,payload,version`, 'GET', null, null, { quiet: true });
            if (!Array.isArray(rows)) return 'error';
            if (!rows.length) {                               // otra persona la borró: se vuelve a crear con tu versión
                delete snap[id];
                estadoCtl.again[key] = true;
                return 'recreado';
            }
            const remoto = rows[0];
            const hr = estadoHashObj(remoto.payload);
            if (hr === h) { snap[id] = { v: remoto.version, h }; return 'igual'; }   // misma información: no hay conflicto real
            estadoGuardarConflicto(tabla, id, item);          // tu versión queda en HVAC_SYNC_CONFLICTS
            estadoReemplazarLocal(key, remoto);
            snap[id] = { v: remoto.version, h: hr };
            try { showToast('El registro ' + id + ' fue modificado por otra persona. Se cargó su versión; tu copia quedó respaldada.', 'error'); } catch (e) {}
            return 'remoto';
        }

        // ---------- ENVÍO: solo filas nuevas, modificadas o borradas ----------
        async function estadoPushInterno(key, tabla) {
            const local = estadoLeerLocal(key);
            const snap = estadoLeerSnap(key);
            const user = estadoUsuario();
            const vistos = new Set();
            let todoOk = true, huboConflicto = false;

            for (const raw of local) {
                if (!raw || typeof raw !== 'object' || raw.id === undefined || raw.id === null || raw.id === '') continue;
                const id = String(raw.id);
                vistos.add(id);
                const item = JSON.parse(JSON.stringify(raw));
                const h = estadoHash(estadoStable(item));
                const s = snap[id];
                if (s && s.h === h) continue;                 // sin cambios

                let r;
                if (!s) {                                     // INSERT (si ya existe, se ignora y se revisa el conflicto)
                    r = await supabaseFetch(`${tabla}?on_conflict=id&select=id,version`, 'POST', [{ id, payload: item, updated_by: user }],
                        { 'Prefer': 'resolution=ignore-duplicates,return=representation' }, { quiet: true });
                } else {                                      // UPDATE solo si la versión sigue siendo la que leímos
                    r = await supabaseFetch(`${tabla}?id=eq.${encodeURIComponent(id)}&version=eq.${s.v}&select=id,version`, 'PATCH',
                        { payload: item, updated_by: user }, { 'Prefer': 'return=representation' }, { quiet: true });
                }
                if (!Array.isArray(r)) {                      // fallo de red / permisos / tabla inexistente
                    todoOk = false;
                    if (estadoSinTabla()) return false;
                    continue;
                }
                if (r.length) { snap[id] = { v: r[0].version, h }; continue; }
                const res = await estadoResolverConflicto(key, tabla, id, item, h, snap);
                if (res === 'error') todoOk = false;
                if (res === 'remoto') huboConflicto = true;
            }

            for (const id of Object.keys(snap)) {             // borrados locales
                if (vistos.has(id)) continue;
                const enc = encodeURIComponent(id);
                const del = await supabaseFetch(`${tabla}?id=eq.${enc}&version=eq.${snap[id].v}`, 'DELETE', null, null, { quiet: true });
                if (!del) { todoOk = false; if (estadoSinTabla()) return false; continue; }
                const check = await supabaseFetch(`${tabla}?id=eq.${enc}&select=id,payload,version`, 'GET', null, null, { quiet: true });
                if (!Array.isArray(check)) { todoOk = false; continue; }
                if (!check.length) { delete snap[id]; continue; }
                if (estadoHashObj(check[0].payload) === snap[id].h) {      // mismo contenido: solo cambió el contador de versión → se reintenta
                    const del2 = await supabaseFetch(`${tabla}?id=eq.${enc}&version=eq.${check[0].version}`, 'DELETE', null, null, { quiet: true });
                    const chk2 = del2 ? await supabaseFetch(`${tabla}?id=eq.${enc}&select=id`, 'GET', null, null, { quiet: true }) : null;
                    if (Array.isArray(chk2) && !chk2.length) { delete snap[id]; continue; }
                    console.error(`[Borrado] ${tabla}/${id} sigue existiendo tras el DELETE. Revisa la política DELETE (RLS) de Supabase.`);
                    snap[id] = { v: check[0].version, h: snap[id].h };       // sigue como borrado pendiente: no se resucita
                    todoOk = false; continue;
                }
                estadoReemplazarLocal(key, check[0]);         // otra persona la había modificado: no se borra
                snap[id] = { v: check[0].version, h: estadoHashObj(check[0].payload) };
                huboConflicto = true;
                try { showToast('El registro ' + id + ' fue modificado por otra persona y no se eliminó.', 'error'); } catch (e) {}
            }

            estadoGuardarSnap(key, snap);
            if (huboConflicto) estadoRefrescarUI();
            if (!todoOk) estadoProgramarReintento(key, 20000);
            return todoOk;
        }

        async function estadoPush(key) {
            const tabla = ESTADO_TABLAS[key];
            if (!tabla || estadoCtl.disabled) return null;
            if (estadoCtl.running[key]) { estadoCtl.again[key] = true; return estadoCtl.running[key]; }
            if (typeof navigator !== 'undefined' && navigator.onLine === false) { estadoProgramarReintento(key, 20000); return null; }
            const run = (async () => {
                try { return (await estadoPushInterno(key, tabla)) ? true : null; }
                catch (e) { console.warn('[Estado] Envío fallido (' + key + '):', e); estadoProgramarReintento(key, 20000); return null; }
            })();
            estadoCtl.running[key] = run;
            try { return await run; }
            finally {
                delete estadoCtl.running[key];
                if (estadoCtl.again[key]) { delete estadoCtl.again[key]; cloudScheduleStatePush(key, true); }
            }
        }

        // ---------- LECTURA: trae filas remotas y las mezcla sin perder cambios locales ----------
        // Descarga INCREMENTAL: primero un índice diminuto (id + version) y luego el payload SOLO de las filas
        // nuevas o cuya versión cambió respecto a la última sincronización. Antes se bajaban todas las filas
        // completas cada vez que se cambiaba de sección (≈ cada 20 s). Si algo no cuadra, cae a la descarga completa.
        async function estadoDescargar(tabla, key) {
            const completa = async () => {
                const todas = [];
                for (let offset = 0; ; offset += ESTADO_PAGINA) {
                    const rows = await supabaseFetch(
                        `${tabla}?select=id,payload,version&order=created_at.asc,id.asc&limit=${ESTADO_PAGINA}&offset=${offset}`,
                        'GET', null, null, { quiet: true });
                    if (!Array.isArray(rows)) return null;
                    todas.push(...rows);
                    if (rows.length < ESTADO_PAGINA) return todas;
                }
            };
            if (!key) return completa();
            const indice = [];
            for (let offset = 0; ; offset += 1000) {
                const rows = await supabaseFetch(
                    `${tabla}?select=id,version&order=created_at.asc,id.asc&limit=1000&offset=${offset}`,
                    'GET', null, null, { quiet: true });
                if (!Array.isArray(rows)) return null;
                indice.push(...rows);
                if (rows.length < 1000) break;
            }
            const snap = estadoLeerSnap(key), local = estadoLeerLocal(key);
            const localPorId = new Map();
            local.forEach(it => { if (it && it.id !== undefined && it.id !== null) localPorId.set(String(it.id), it); });
            const faltan = indice.map(r => String(r.id)).filter((id, i) => { const s = snap[id]; return !(s && String(s.v) === String(indice[i].version)); });
            const bajados = new Map();
            for (let i = 0; i < faltan.length; i += 25) {
                const lote = faltan.slice(i, i + 25);
                const rows = await supabaseFetch(
                    `${tabla}?select=id,payload,version&id=in.(${lote.map(encodeURIComponent).join(',')})`,
                    'GET', null, null, { quiet: true });
                if (!Array.isArray(rows)) return completa();
                rows.forEach(r => bajados.set(String(r.id), r));
            }
            if (faltan.some(id => !bajados.has(id))) return completa();      // algo no cuadró (p. ej. id con coma): no se adivina
            return indice.map(r => {
                const id = String(r.id);
                if (bajados.has(id)) return bajados.get(id);
                const loc = localPorId.get(id);                                // versión sin cambios: el payload remoto == el snapshot local
                return { id: r.id, version: r.version, payload: loc !== undefined ? loc : null };
            });
        }

        function estadoMezclar(key, rows) {
            const snap = estadoLeerSnap(key);
            const local = estadoLeerLocal(key);
            const localPorId = new Map();
            local.forEach(it => { if (it && it.id !== undefined && it.id !== null) localPorId.set(String(it.id), it); });
            const remotosIds = new Set();
            const salida = [], nuevoSnap = {};

            for (const row of rows) {
                const id = String(row.id);
                remotosIds.add(id);
                const remoto = row.payload, hRemoto = estadoHashObj(remoto);
                const loc = localPorId.get(id), s = snap[id];
                if (!loc) {
                    if (s) { nuevoSnap[id] = s; continue; }                    // borrado local pendiente de enviar: no se resucita
                    salida.push(remoto); nuevoSnap[id] = { v: row.version, h: hRemoto }; continue;
                }
                const hLocal = estadoHashObj(loc);
                if (s && s.h !== hLocal) { salida.push(loc); nuevoSnap[id] = s; continue; }   // cambios locales sin enviar: se conservan
                if (!s && hLocal !== hRemoto) { salida.push(loc); continue; }                 // sin base conocida: lo resuelve el envío
                salida.push(remoto); nuevoSnap[id] = { v: row.version, h: hRemoto };
            }
            for (const loc of local) {                                        // filas que solo existen en este equipo
                if (!loc || loc.id === undefined || loc.id === null) { salida.push(loc); continue; }
                const id = String(loc.id);
                if (remotosIds.has(id)) continue;
                const s = snap[id];
                if (s && s.h === estadoHashObj(loc)) continue;                // otra persona la borró y aquí no hubo cambios: se quita
                salida.push(loc);                                             // nueva o editada localmente: se enviará
            }
            const cambio = estadoStable(salida) !== estadoStable(local);
            if (cambio) estadoEscribirLocal(key, salida);
            estadoGuardarSnap(key, nuevoSnap);
            return cambio;
        }

        async function estadoPullKeys(keys, usarTtl) {
            if (estadoCtl.disabled || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
            let cambio = false;
            for (const key of keys) {
                const tabla = ESTADO_TABLAS[key];
                if (!tabla || estadoCtl.disabled) continue;
                if (usarTtl && Date.now() - (estadoCtl.ultimo[key] || 0) < ESTADO_TTL_MS) continue;
                await estadoPush(key);                                        // 1) primero se envía lo local
                if (estadoCtl.disabled) continue;
                const rows = await estadoDescargar(tabla, key);               // 2) luego se descarga (solo lo que cambió)
                if (!rows) { estadoSinTabla(); continue; }
                if (estadoCtl.running[key]) await estadoCtl.running[key];
                estadoCtl.ultimo[key] = Date.now();
                if (estadoMezclar(key, rows)) cambio = true;                  // 3) y se mezcla
            }
            return cambio;
        }

        window.addEventListener('online', () => {
            Object.keys(ESTADO_TABLAS).forEach(k => { if (localStorage.getItem(k) !== null) cloudScheduleStatePush(k, true); });
        });

        // ---------- consecutivo de caja único (lo entrega el servidor) ----------
        async function cajaReservarConsecutivo() {
            if (navigator.onLine !== false) {
                const r = await supabaseFetch('rpc/siguiente_consecutivo_caja', 'POST', {}, null, { quiet: true });
                if (typeof r === 'string' && /^CM-\d+$/.test(r)) {
                    try { localStorage.setItem('HVAC_CAJA_SEQUENCE', String(parseInt(r.slice(3), 10))); } catch (e) {}
                    return r;
                }
            }
            return nextCajaConsecutiveId();                   // sin conexión: consecutivo local (respaldo)
        }

        // =====================================================================
        //  FACTURAS PDF EN SUPABASE STORAGE (bucket "hvac-archivos", carpeta "facturas/")
        //  En la orden solo se guarda la URL:  order.invoice.pdfUrl
        // =====================================================================
        const STORAGE_BUCKET = 'hvac-archivos';
        const STORAGE_CARPETA_FACTURAS = 'facturas';
        const STORAGE_PUBLIC_BASE = SUPABASE_URL + '/storage/v1/object/public/' + STORAGE_BUCKET + '/';
        const FACTURA_MAX_MB = 10;

        function storageRuta(path) { return String(path).split('/').map(encodeURIComponent).join('/'); }

        function storageNombreSeguro(texto) {
            return String(texto || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'archivo';
        }

        function storageAleatorio() {
            const b = new Uint8Array(6);
            (window.crypto || window.msCrypto).getRandomValues(b);
            return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
        }

        function dataUrlToBlob(dataUrl) {
            const partes = String(dataUrl).split(',');
            const mime = (partes[0].match(/data:([^;]+)/) || [])[1] || 'application/pdf';
            const bin = atob(partes[1] || '');
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new Blob([bytes], { type: mime });
        }

        // Sube un archivo y devuelve su URL pública.
        async function storageSubir(path, blob, contentType) {
            if (navigator.onLine === false) throw new Error('Sin conexión a internet.');
            if (window.HVACSec) await HVACSec.throttle('POST');
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), 60000) : null;
            try {
                const res = await fetch(SUPABASE_URL + '/storage/v1/object/' + STORAGE_BUCKET + '/' + storageRuta(path), {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': 'Bearer ' + SUPABASE_KEY,
                        'Content-Type': contentType || blob.type || 'application/octet-stream',
                        'x-upsert': 'false'
                    },
                    body: blob,
                    signal: ctrl ? ctrl.signal : undefined
                });
                if (!res.ok) {
                    const detalle = await res.text().catch(() => '');
                    throw new Error('Storage respondió ' + res.status + ' ' + detalle.slice(0, 160));
                }
                return STORAGE_PUBLIC_BASE + storageRuta(path);
            } catch (err) {
                if (err && err.name === 'AbortError') throw new Error('La subida tardó demasiado.');
                throw err;
            } finally { if (timer) clearTimeout(timer); }
        }

        // Borra un archivo a partir de su URL pública (si falla no es grave: solo queda un PDF huérfano).
        async function storageBorrarPorUrl(url) {
            try {
                if (!url || String(url).indexOf(STORAGE_PUBLIC_BASE) !== 0) return false;
                const path = decodeURIComponent(String(url).slice(STORAGE_PUBLIC_BASE.length));
                const res = await fetch(SUPABASE_URL + '/storage/v1/object/' + STORAGE_BUCKET + '/' + storageRuta(path), {
                    method: 'DELETE',
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
                });
                return res.ok;
            } catch (e) { return false; }
        }

        async function storageSubirFacturaPdf(orderId, archivo) {
            const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
            const nombre = storageNombreSeguro(orderId) + '_' + stamp + '_' + storageAleatorio() + '.pdf';
            return storageSubir(STORAGE_CARPETA_FACTURAS + '/' + nombre, archivo, 'application/pdf');
        }


        // =====================================================================
        //  AUDITORÍA  ->  tabla audit_logs
        //  Funciona sin conexión: los eventos se guardan en una cola local
        //  (HVAC_AUDIT_QUEUE) y se envían cuando vuelve internet.
        // =====================================================================
        const AUDIT_COLA_KEY = 'HVAC_AUDIT_QUEUE';
        let auditEnviando = false;

        function auditUsuario() {
            try {
                const u = systemUsers.find(x => String(x.id) === String(activeUser));
                return (u && (u.email || u.username)) || 'desconocido';
            } catch (e) { return 'desconocido'; }
        }

        function auditUuid() {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
            const b = new Uint8Array(16);
            (window.crypto || window.msCrypto).getRandomValues(b);
            b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
            const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
            return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
        }

        function auditLeerCola() {
            try { const c = JSON.parse(localStorage.getItem(AUDIT_COLA_KEY) || '[]'); return Array.isArray(c) ? c : []; } catch (e) { return []; }
        }
        function auditEscribirCola(c) {
            try { localStorage.setItem(AUDIT_COLA_KEY, JSON.stringify(c)); } catch (e) {}
        }

        async function auditEnviarCola() {
            if (auditEnviando || navigator.onLine === false) return;
            auditEnviando = true;
            try {
                let cola = auditLeerCola();
                while (cola.length) {
                    const lote = cola.slice(0, 50);
                    const r = await supabaseFetch('audit_logs?on_conflict=id', 'POST', lote,
                        { 'Prefer': 'resolution=ignore-duplicates,return=minimal' }, { quiet: true });
                    if (!r) break;                                         // se reintenta luego; no se pierde nada
                    const enviados = new Set(lote.map(x => x.id));
                    cola = auditLeerCola().filter(x => !enviados.has(x.id));
                    auditEscribirCola(cola);
                }
            } finally { auditEnviando = false; }
        }

        // accion:     'CREAR' | 'EDITAR' | 'BORRAR' | 'FACTURAR' | 'LEGALIZAR' ...
        // tabla:      'hvac_orders' | 'hvac_caja' | 'hvac_legalizaciones' ...
        // registroId: id del registro afectado (p. ej. order.id, 'CAJA-1736...')
        function registrarAuditoria(accion, tabla, registroId) {
            try {
                const cola = auditLeerCola();
                cola.push({
                    id: auditUuid(),
                    user_email: auditUsuario(),
                    action: String(accion).toUpperCase(),
                    table_name: String(tabla),
                    record_id: registroId === undefined || registroId === null ? null : String(registroId),
                    timestamp: new Date().toISOString()
                });
                auditEscribirCola(cola.slice(-500));
            } catch (e) { console.warn('[Auditoría] No se pudo registrar:', e); }
            return auditEnviarCola().catch(() => {});
        }

        window.addEventListener('online', () => { auditEnviarCola().catch(() => {}); });
        setInterval(() => { if (auditLeerCola().length) auditEnviarCola().catch(() => {}); }, 60000);

        // ---------------------------------------------------------------------
        //  REEMPLAZA a saveInvoiceRecord() completa
        // ---------------------------------------------------------------------
        async function saveInvoiceRecord() {
            const orderId = document.getElementById('inv-f-order-id').value;
            let order = workOrders.find(o => o.id === orderId);
            if (!order) return;
            if (billingRoutineType(order) === 'REVISION') return showToast('Las revisiones no se facturan.', 'error');
            if (order._hvacSummaryOnly && typeof hvacEnsureFullOrder === 'function') order = await hvacEnsureFullOrder(orderId);
            if (!order) return showToast('No se pudo cargar el detalle de la orden.', 'error');

            // Regla estricta: no se factura la matriz si alguna parte -P# no está Completada
            const chk = await hvacAssertMatrixBillable(order);
            if (!chk.ok) return showToast(chk.reason, 'error');
            const holder = hvacMatrixHolder(order);

            const number = document.getElementById('inv-f-number').value.trim();
            const amount = parseFloat(document.getElementById('inv-f-amount').value) || 0;
            const expenses = parseFloat(document.getElementById('inv-f-expenses').value) || 0;
            if (!Number.isFinite(expenses) || expenses < 0) return showToast('Los gastos operativos deben ser un número igual o mayor que cero.', 'error');
            const fileInput = document.getElementById('inv-f-pdf');
            const archivo = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

            if (archivo) {
                if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) {
                    return showToast('El archivo de la factura debe ser un PDF.', 'error');
                }
                if (archivo.size > FACTURA_MAX_MB * 1024 * 1024) {
                    return showToast('El PDF supera ' + FACTURA_MAX_MB + ' MB. Comprímelo e inténtalo de nuevo.', 'error');
                }
            }

            // La regla global se consulta antes de subir el PDF o modificar la orden.
            if (!(await hvacCanSaveInvoiceWithZeroExpenses(expenses, 'inv-f-expenses', 'esta factura'))) return;

            const previa = holder.invoice || {};
            const urlAnterior = previa.pdfUrl || null;
            const yaFacturada = holder.status === 'BILLED';
            let pdfUrl = urlAnterior;

            try {
                if (archivo) {
                    pdfUrl = await storageSubirFacturaPdf(holder.id, archivo);                       // PDF nuevo
                } else if (!pdfUrl && previa.pdfData) {
                    pdfUrl = await storageSubirFacturaPdf(holder.id, dataUrlToBlob(previa.pdfData)); // factura antigua: se migra al guardar
                }
            } catch (err) {
                console.error('[Factura] Falló la subida del PDF:', err);
                return showToast('No se pudo subir el PDF de la factura: ' + (err && err.message ? err.message : err), 'error');
            }

            const invoice = { number, amount, expenses, pdfUrl: pdfUrl || null, date: (yaFacturada && previa.date) ? previa.date : new Date().toISOString() }; // ya sin pdfData (base64)
            // La factura vive en la parte titular; las demás partes -P# la referencian (sin duplicar valores)
            for (const p of (chk.parts.length ? chk.parts : [order])) {
                // Congela únicamente el conteo técnico al momento de facturar; el estado
                // BILLED no debe borrar ni alterar la barra de avance del histórico.
                const technicalProgress = hvacOrderProgress(p);
                p.progressSnapshot = {
                    total: technicalProgress.total,
                    done: technicalProgress.done,
                    percent: technicalProgress.percent,
                    capturedAt: invoice.date
                };
                p.invoice = (p === holder) ? invoice
                    : { matrixRef: chk.base, number, pdfUrl: invoice.pdfUrl, amount: 0, expenses: 0, date: invoice.date };
                p.status = 'BILLED';
                p.updatedAt = new Date().toISOString();
                await cloudSaveOrder(p);
            }
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            registrarAuditoria(yaFacturada ? 'EDITAR_FACTURA' : 'FACTURAR', 'hvac_orders', chk.base);
            if (archivo && urlAnterior && urlAnterior !== pdfUrl) storageBorrarPorUrl(urlAnterior);  // limpia el PDF reemplazado

            closeInvoiceModal();
            renderBillingModule();
            renderFinancialModule();
            renderAdminDashboard();
            showToast('Factura y gastos operativos registrados.');
        }

        // ---------------------------------------------------------------------
        //  REEMPLAZA a downloadInvoicePDF() completa (soporta URL nueva y base64 antiguo)
        // ---------------------------------------------------------------------
        async function downloadInvoicePDF(orderId) {
            let order = workOrders.find(o => o.id === orderId);
            if (order && order._hvacSummaryOnly && typeof hvacEnsureFullOrder === 'function') order = await hvacEnsureFullOrder(orderId);
            const inv = order && order.invoice;
            if (!inv || !(inv.pdfUrl || inv.pdfData)) return showToast('No hay PDF adjunto en esta orden.', 'error');

            const link = document.createElement('a');
            link.href = inv.pdfUrl || inv.pdfData;
            if (inv.pdfUrl) { link.target = '_blank'; link.rel = 'noopener'; }
            else link.download = 'Factura_' + (inv.number || order.id) + '.pdf';
            document.body.appendChild(link);
            link.click();
            link.remove();
        }

        // ---------------------------------------------------------------------
        //  UNA SOLA VEZ: migra TODAS las facturas antiguas (base64) a Storage.
        //  Ábrela con el admin dentro de la pestaña "Facturación" y ejecuta en la consola (F12):
        //      await migrarFacturasPdfAStorage()
        // ---------------------------------------------------------------------
        async function migrarFacturasPdfAStorage() {
            const pendientes = workOrders.filter(o => o.invoice && o.invoice.pdfData && !o.invoice.pdfUrl);
            let ok = 0, fallos = 0;
            for (const o of pendientes) {
                try {
                    const url = await storageSubirFacturaPdf(o.id, dataUrlToBlob(o.invoice.pdfData));
                    o.invoice.pdfUrl = url;
                    delete o.invoice.pdfData;
                    const guardado = await cloudSaveOrder(o);
                    if (!guardado) throw new Error('No se pudo guardar la orden en Supabase.');
                    ok++;
                } catch (err) {
                    console.warn('[Migración] Falló ' + o.id + ':', err);
                    fallos++;
                    if (o.invoice && o.invoice.pdfUrl) delete o.invoice.pdfUrl;   // se reintentará la próxima vez
                }
            }
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            renderBillingModule();
            showToast('Facturas migradas: ' + ok + (fallos ? ' · con error: ' + fallos : ''), fallos ? 'error' : 'success');
            return { migradas: ok, fallos, total: pendientes.length };
        }


        function showToast(message, type = "success") {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            const bgClass = type === 'error' ? 'bg-rose-600' : 'bg-slate-900';
            const icon = type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check text-teal-400';
            toast.className = `${bgClass} text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-bold transition transform duration-200 pointer-events-auto`;
            toast.innerHTML = `<i class="fa-solid ${icon} text-sm"></i> <span></span>`;
            toast.querySelector('span:last-child').textContent = String(message);
            container.appendChild(toast);
            setTimeout(() => {
                toast.classList.add('opacity-0', 'translate-x-4');
                setTimeout(() => toast.remove(), 250);
            }, 3500);
        }

        // Cloudflare R2: sube la imagen al capturarla; si no hay red o R2 no está configurado, se conserva en Base64
        const r2keep = (d, folder) => (window.HVAC && HVAC.r2) ? HVAC.r2.keep(d, folder) : Promise.resolve(d);
        const hvacPrefetch = o => (window.HVAC && HVAC.img && HVAC.img.prefetchIn) ? HVAC.img.prefetchIn(o) : Promise.resolve();
        async function compressImage(file, maxWidth = 1000, quality = 0.75) {
            const MAX_BYTES = 220 * 1024; // limita fotos para respaldos offline y carga móvil
            const fail = (msg, err) => {
                console.error('[compressImage]', msg, err || '');
                try { showToast(msg, 'error'); } catch (_) {}
                throw new Error(msg);
            };
            let dataUrl;
            try {
                dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(reader.error || new Error('read'));
                    reader.readAsDataURL(file);
                });
            } catch (e) { fail('No se pudo leer la imagen seleccionada.', e); }

            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('decode'));
                i.src = dataUrl;
            }).catch(e => fail('Formato de imagen no compatible. Usa una foto JPG o PNG.', e));

            const srcW = img.naturalWidth || img.width, srcH = img.naturalHeight || img.height;
            if (!srcW || !srcH) fail('La imagen está vacía o dañada.');
            let scale = Math.min(1, Math.min(maxWidth, 1200) / srcW, 1200 / srcH);
            let width = Math.max(1, Math.round(srcW * scale));
            let height = Math.max(1, Math.round(srcH * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) fail('Tu navegador no pudo procesar la imagen.');
            const draw = () => {
                canvas.width = width; canvas.height = height;
                ctx.fillStyle = '#ffffff'; // PNG con transparencia: fondo blanco
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
            };
            draw();
            let q = Math.min(quality, 0.72), out = canvas.toDataURL('image/jpeg', q);
            while (out.length * 0.75 > MAX_BYTES && q > 0.4) {
                q = Math.max(0.4, q - 0.08);
                out = canvas.toDataURL('image/jpeg', q);
            }
            while (out.length * 0.75 > MAX_BYTES && width > 640) {
                width = Math.max(640, Math.round(width * 0.82));
                height = Math.max(1, Math.round(width * srcH / srcW));
                draw();
                out = canvas.toDataURL('image/jpeg', 0.48);
            }
            if (!out || out.indexOf('data:image/jpeg') !== 0) fail('No se pudo comprimir la imagen.');
            return out;
        }

        // =========================================================================
        // CAPA DE NUBE ROBUSTA (Supabase): reintentos, cola por registro, bandeja de salida,
        // diagnóstico de credenciales y sincronización de módulos locales.
        // Los nombres y parámetros de las funciones cloud* se conservan.
        // =========================================================================
        const cloudCtl = { lastToast: 0, lastStatus: 0, queues: {}, bigWarned: {}, loading: null,
            inflight: 0, failStreak: 0, firstFailAt: 0, hard: {}, keyProblem: null, lastOkAt: 0, lastFailInfo: '', flushing: false, badgeTimer: null };
        const cloudSleep = ms => new Promise(r => setTimeout(r, ms));

        function cloudKeyProblem() {
            try {
                const parts = String(SUPABASE_KEY || '').split('.');
                if (parts.length !== 3) return 'La clave de Supabase no tiene formato JWT (debe tener 3 partes).';
                const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                const json = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
                const claims = JSON.parse(json);
                if (!claims.role) return 'La clave de Supabase no declara un rol (anon / service_role).';
                if (claims.role === 'service_role') return 'ATENCIÓN: se está usando la clave service_role en el navegador. Usa solo la clave anon pública.';
                return null;
            } catch (e) {
                return 'La clave SUPABASE_KEY está dañada o incompleta. Cópiala de nuevo en Supabase > Project Settings > API (anon public).';
            }
        }

        // ---- Indicador de sincronización (pestaña lateral) ----
        // Estados: ok · syncing · pending · retrying · offline · unreachable · error.
        // "error" (rojo) solo aparece ante un fallo real y persistente (credenciales, tabla inexistente...).
        // Los fallos pasajeros de red/timeout se muestran como "Reintentando…" y solo escalan si se sostienen.
        const CLOUD_ESCALATE_FAILS = 3, CLOUD_ESCALATE_MS = 20000;
        const cloudIsTransient = s => s === 'offline' || s === 'timeout' || s === 'network' || s === 429 || (typeof s === 'number' && s >= 500);
        function cloudStatusText(s) {
            if (s === 'offline') return 'sin conexión a internet';
            if (s === 'timeout') return 'la nube tardó demasiado en responder';
            if (s === 'network') return 'no se pudo alcanzar el servidor de la nube';
            if (s === 429) return 'la nube está limitando las peticiones (HTTP 429)';
            if (typeof s === 'number' && s >= 500) return 'fallo temporal de la nube (HTTP ' + s + ')';
            return 'HTTP ' + s;
        }
        const cloudTableOf = endpoint => String(endpoint || '').split('?')[0];
        function cloudNoteResult(ok, status, quiet, endpoint) {
            const key = cloudTableOf(endpoint);
            if (ok) {
                cloudCtl.failStreak = 0; cloudCtl.firstFailAt = 0; cloudCtl.lastFailInfo = '';
                cloudCtl.lastOkAt = Date.now();
                if (key) delete cloudCtl.hard[key]; // un acierto solo limpia el error de esa misma tabla
            } else if (cloudIsTransient(status)) {
                if (!cloudCtl.failStreak) cloudCtl.firstFailAt = Date.now();
                cloudCtl.failStreak++;
                cloudCtl.lastFailInfo = cloudStatusText(status);
            } else if (!quiet) {
                cloudCtl.hard[key || '_'] = { status, at: Date.now() };
            }
            cloudBadgeSchedule();
        }
        function cloudPendingCount() { return cloudOutboxRead().length; }
        function cloudBadgeState() {
            const pending = cloudPendingCount();
            const saved = pending
                ? pending + ' cambio(s) guardado(s) en este dispositivo (IndexedDB), pendientes de enviar.'
                : 'Tus datos están guardados en este dispositivo.';
            if (cloudCtl.keyProblem) return { s: 'error', label: 'Error de nube', detail: cloudCtl.keyProblem };
            const hardKeys = Object.keys(cloudCtl.hard);
            if (hardKeys.length) {
                const h = cloudCtl.hard[hardKeys[0]];
                let why = 'La nube devolvió un error (HTTP ' + h.status + ').';
                if (h.status === 401 || h.status === 403) why = 'La nube rechazó las credenciales (HTTP ' + h.status + '). Revisa SUPABASE_KEY y las políticas RLS.';
                else if (h.status === 404) why = 'Tabla no encontrada en Supabase (HTTP 404): ' + hardKeys[0] + '.';
                return { s: 'error', label: 'Error de nube', detail: why + ' ' + saved };
            }
            if (navigator.onLine === false) {
                return { s: 'offline', label: pending ? 'Sin conexión · ' + pending + ' pend.' : 'Sin conexión', detail: 'Sin conexión a internet. ' + saved + ' Se enviarán al reconectar.' };
            }
            const sustained = cloudCtl.failStreak >= CLOUD_ESCALATE_FAILS && Date.now() - cloudCtl.firstFailAt >= CLOUD_ESCALATE_MS;
            if (sustained) {
                return { s: 'unreachable', label: 'Nube sin respuesta', detail: 'Sin respuesta de la nube desde hace ' + Math.round((Date.now() - cloudCtl.firstFailAt) / 1000) + ' s (' + cloudCtl.lastFailInfo + '). ' + saved + ' Se reintentará automáticamente.' };
            }
            if (cloudCtl.inflight > 0 && (pending > 0 || cloudCtl.failStreak > 0)) {
                return { s: 'syncing', label: 'Sincronizando…' + (pending ? ' (' + pending + ')' : ''), detail: 'Enviando cambios a la nube en segundo plano. ' + saved };
            }
            if (cloudCtl.failStreak > 0) {
                return { s: 'retrying', label: 'Reintentando conexión…', detail: 'Fallo pasajero (' + cloudCtl.lastFailInfo + '). ' + saved };
            }
            if (pending > 0) {
                return { s: 'pending', label: pending + ' por sincronizar', detail: saved };
            }
            return { s: 'ok', label: 'Cloud Enlazado', detail: cloudCtl.lastOkAt ? 'Última sincronización: ' + new Date(cloudCtl.lastOkAt).toLocaleTimeString() : '' };
        }
        function cloudSetBadge(state, detail, label) {
            const b = document.getElementById('sidebar-sync-badge');
            if (!b) return;
            const map = {
                ok: ['fa-circle-check text-emerald-400', 'Cloud Enlazado'],
                syncing: ['fa-arrows-rotate fa-spin text-sky-400', 'Sincronizando…'],
                pending: ['fa-cloud-arrow-up text-sky-400', 'Por sincronizar'],
                retrying: ['fa-arrows-rotate text-amber-400', 'Reintentando conexión…'],
                offline: ['fa-cloud-bolt text-amber-400', 'Sin conexión'],
                unreachable: ['fa-cloud-bolt text-orange-400', 'Nube sin respuesta'],
                error: ['fa-triangle-exclamation text-rose-400', 'Error de nube']
            };
            const m = map[state] || map.ok;
            const text = label || m[1];
            const sig = state + '|' + text;
            if (b.dataset.sig !== sig) {
                b.dataset.sig = sig;
                b.innerHTML = '<i class="fa-solid ' + m[0] + '"></i> ' + text;
            }
            b.title = detail || '';
        }
        function cloudBadgeRender() { const st = cloudBadgeState(); cloudSetBadge(st.s, st.detail, st.label); }
        function cloudBadgeSchedule() {
            if (cloudCtl.badgeTimer) return;
            cloudCtl.badgeTimer = setTimeout(() => { cloudCtl.badgeTimer = null; cloudBadgeRender(); }, 120);
        }

        function cloudReport(ok, status, detail, method, endpoint) {
            if (ok) { cloudNoteResult(true, 0, false, endpoint); return; }
            cloudCtl.lastStatus = status;
            cloudNoteResult(false, status, false, endpoint);
            const transient = cloudIsTransient(status);
            (transient ? console.warn : console.error)('[Supabase] ' + method + ' ' + endpoint + ' -> ' + status, detail || '');
            // Fallo pasajero (timeout, red, 5xx): sin aviso hasta que se sostenga; así no hay falsas alarmas.
            if (transient && status !== 'offline' && cloudBadgeState().s !== 'unreachable') return;
            if (Date.now() - cloudCtl.lastToast < 45000) return;
            cloudCtl.lastToast = Date.now();
            let msg = 'La nube devolvió un error (HTTP ' + status + '). Tus datos están a salvo en este dispositivo.';
            if (status === 'offline') msg = 'Sin conexión con la nube. Los cambios se guardan aquí y se reenviarán al reconectar.';
            else if (transient) msg = 'La nube no responde (' + cloudStatusText(status) + '). Tus cambios están a salvo en este dispositivo y se reenviarán automáticamente.';
            else if (status === 401 || status === 403) msg = 'La nube rechazó las credenciales (HTTP ' + status + '). Revisa SUPABASE_KEY y las políticas RLS.';
            else if (status === 404) msg = 'Tabla no encontrada en Supabase (HTTP 404). Verifica que existan las tablas hvac_*.';
            try { showToast(msg, 'error'); } catch (_) {}
        }

        // Reintento automático: reenvía lo atascado y sondea la nube cuando hay fallos recientes.
        function cloudHealthTick() {
            if (navigator.onLine === false || cloudCtl.inflight > 0 || cloudCtl.flushing) return;
            const stuck = cloudOutboxRead().some(e => Date.now() - (e.ts || 0) > 15000);
            if (stuck) {
                cloudCtl.flushing = true;
                cloudFlushOutbox().catch(() => {}).finally(() => { cloudCtl.flushing = false; cloudBadgeSchedule(); });
                return;
            }
            if (cloudCtl.failStreak > 0) { supabaseFetch('hvac_users?select=id&limit=1', 'GET', null, null, { quiet: true }); return; }
            const t = Object.keys(cloudCtl.hard)[0];
            if (t && t !== '_') supabaseFetch(t + '?select=id&limit=1', 'GET', null, null, { quiet: true });
        }

        // Diagnóstico de una orden: hvacDiagOrder('PRE-0022') compara servidor (todas las filas con ese id), copia local y cola pendiente.
        window.hvacDiagOrder = async function (orderId) {
            const id = String(orderId || '').trim(); if (!id) return console.warn('Uso: hvacDiagOrder("PRE-0022")');
            const rows = await supabaseFetch('hvac_orders?select=fila:id,id_payload:payload->>id,actualizado:payload->>updatedAt,estado:payload->>status,equipos:payload->equipmentIds&or=' + encodeURIComponent('(id.eq.' + id + ',payload->>id.eq.' + id + ')'), 'GET', null, null, { quiet: true });
            const srv = Array.isArray(rows) ? rows.map(r => ({ fila: r.fila, id_payload: r.id_payload, actualizado: r.actualizado, estado: r.estado, n_equipos: (r.equipos || []).length, equipos: (r.equipos || []).join(', ') })) : null;
            const lo = (workOrders || []).find(o => String(o && o.id) === id);
            const loc = lo ? { n_equipos: (lo.equipmentIds || []).length, equipos: (lo.equipmentIds || []).join(', '), actualizado: lo.updatedAt, soloResumen: !!lo._hvacSummaryOnly } : null;
            const cola = cloudOutboxRead().filter(e => e && e.table === 'hvac_orders' && String(e.id) === cloudCleanId(id)).length;
            console.log('[Diag ' + id + '] filas en el servidor: ' + (srv ? srv.length : 'error de lectura') + (srv && srv.length > 1 ? '  ⚠️ DUPLICADAS' : ''));
            if (srv) console.table(srv); console.log('Local:', loc, '| cambios pendientes en cola:', cola);
            let reintento = null;
            if (cola) {   // hay un guardado atascado: se reintenta ahora y se muestra el motivo exacto del servidor
                reintento = await cloudFlushOutbox();
                console.log('Reintento de la cola →', reintento, '| último error:', cloudCtl.lastStatus, cloudCtl.lastEndpoint || '', cloudCtl.lastDetail || '');
            }
            return { servidor: srv, local: loc, cola, reintento, ultimoError: { status: cloudCtl.lastStatus, endpoint: cloudCtl.lastEndpoint, detalle: cloudCtl.lastDetail } };
        };

        // ===== Medidor de consumo (egress REST) — validar con datos reales =====
        // Consola: hvacEgressReport()  ·  Atajo: Ctrl+Alt+Shift+E  ·  Reiniciar: hvacEgress.reset()
        // Cuenta los bytes de texto descargados por endpoint (cota superior; el tráfico real va comprimido).
        // Avisa en consola cuando UNA respuesta supera 400 KB: así se detecta cualquier fuga nueva.
        const hvacEgress = (() => {
            const KEY = 'HVAC_EGRESS_SESSION';
            let data = { since: Date.now(), total: 0, rows: {} };
            try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s && s.rows) data = s; } catch (_) {}
            let timer = null;
            const persist = () => { clearTimeout(timer); timer = setTimeout(() => { try { sessionStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {} }, 1000); };
            const fmt = b => b > 1048576 ? (b / 1048576).toFixed(2) + ' MB' : b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';
            function note(endpoint, method, bytes) {
                bytes = Number(bytes) || 0;
                const k = method + ' ' + String(endpoint).split('?')[0];
                const r = data.rows[k] || (data.rows[k] = { n: 0, bytes: 0, max: 0 });
                r.n++; r.bytes += bytes; if (bytes > r.max) r.max = bytes;
                data.total += bytes; persist();
                if (bytes > 400 * 1024) console.warn('[Egress] Respuesta pesada: ' + fmt(bytes) + ' ← ' + method + ' ' + String(endpoint).slice(0, 140));
            }
            function report() {
                const list = Object.entries(data.rows)
                    .map(([k, r]) => ({ endpoint: k, llamadas: r.n, total: fmt(r.bytes), promedio: fmt(Math.round(r.bytes / r.n)), maximo: fmt(r.max), _b: r.bytes }))
                    .sort((a, b) => b._b - a._b);
                const minutos = Math.max(1, Math.round((Date.now() - data.since) / 60000));
                const detalle = list.map(x => ({ endpoint: x.endpoint, llamadas: x.llamadas, total: x.total, promedio: x.promedio, maximo: x.maximo }));
                console.log('[Egress] Últimos ' + minutos + ' min: ' + fmt(data.total) + ' descargados de Supabase (REST).');
                console.table(detalle);
                return { total: fmt(data.total), minutos, detalle };
            }
            function reset() { data = { since: Date.now(), total: 0, rows: {} }; persist(); }
            return { note, report, reset, fmt };
        })();
        window.hvacEgress = hvacEgress;
        window.hvacEgressReport = hvacEgress.report;
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
                const r = hvacEgress.report();
                alert('Consumo REST de esta sesión: ' + r.total + ' en ' + r.minutos + ' min\n\n' +
                    (r.detalle.slice(0, 8).map(x => x.total + ' · ' + x.llamadas + '× · ' + x.endpoint).join('\n') || '(sin datos todavía)'));
            }
        });

        // opts: { quiet: true } no reporta errores (se usa en intentos con plan B)
        async function supabaseFetch(endpoint, method = 'GET', body = null, extraHeaders = null, opts = null) {
            const quiet = !!(opts && opts.quiet);
            const fail = (status, detail) => {
                cloudCtl.lastStatus = status;
                cloudCtl.lastDetail = String(detail || '').slice(0, 300);
                cloudCtl.lastEndpoint = String(method) + ' ' + String(endpoint).split('?')[0];
                if (quiet) cloudNoteResult(false, status, true, endpoint);
                else cloudReport(false, status, detail, method, endpoint);
                return null;
            };
            if (navigator.onLine === false) return fail('offline', 'navigator.onLine=false');
            if (window.HVACSec) {                                            // validación + sanitización del cuerpo
                const g = HVACSec.guard(endpoint, method, body);
                if (!g.ok) return fail('blocked', g.reason);
                body = g.body;
            }
            const headers = {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            };
            if (method === 'POST') headers['Prefer'] = 'return=representation';
            if (extraHeaders) Object.assign(headers, extraHeaders);
            const payload = body ? JSON.stringify(body) : undefined;
            if (window.HVACSec) {
                if (!HVACSec.sizeOk(payload)) return fail('blocked', 'cuerpo demasiado grande');
                if (!(await HVACSec.throttle(method))) return fail('rate-limit', 'demasiadas solicitudes en cola');   // límite de ritmo
            }
            const MAX_TRIES = 2;
            cloudCtl.inflight++;
            cloudBadgeSchedule();
            try {
                for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
                    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
                    try {
                        const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, { method, headers, body: payload, signal: ctrl ? ctrl.signal : undefined, cache: opts && opts.noStore ? 'no-store' : 'default' });
                        if (timer) clearTimeout(timer);
                        if (res.ok) {
                            cloudNoteResult(true, 0, quiet, endpoint);
                            if (method === 'DELETE') {
                                if (!(extraHeaders && /return=representation/i.test(String(extraHeaders.Prefer || '')))) return true;
                                const dt = await res.text().catch(() => '');           // filas que el servidor eliminó de verdad
                                hvacEgress.note(endpoint, method, dt.length);
                                try { return dt ? JSON.parse(dt) : []; } catch (e) { return []; }
                            }
                            const txt = await res.text().catch(() => '');
                            hvacEgress.note(endpoint, method, txt.length);
                            if (!txt) return true;
                            try { return JSON.parse(txt); } catch (e) { return true; }
                        }
                        const detail = await res.text().catch(() => '');
                        if ((res.status === 429 || res.status >= 500) && attempt < MAX_TRIES) { if (res.status === 429 && window.HVACSec) HVACSec.cool(8000); await cloudSleep(700); continue; }
                        return fail(res.status, detail);
                    } catch (err) {
                        if (timer) clearTimeout(timer);
                        if (attempt < MAX_TRIES) { await cloudSleep(700); continue; }
                        return fail(err && err.name === 'AbortError' ? 'timeout' : (navigator.onLine === false ? 'offline' : 'network'), String(err));
                    }
                }
                return null;
            } finally {
                cloudCtl.inflight = Math.max(0, cloudCtl.inflight - 1);
                cloudBadgeSchedule();
            }
        }

        // ---- Bandeja de salida: cambios que no llegaron a la nube ----
        function cloudOutboxRead() { try { return JSON.parse(localStorage.getItem('HVAC_CLOUD_OUTBOX') || '[]'); } catch (e) { return []; } }
        function cloudOutboxWrite(a) { try { localStorage.setItem('HVAC_CLOUD_OUTBOX', JSON.stringify(a)); } catch (e) {} cloudBadgeSchedule(); }
        function cloudOutboxAdd(table, id, op, payload) {
            const a = cloudOutboxRead().filter(x => !(x.table === table && x.id === id));
            const e = { table, id, op, ts: Date.now() };
            if (payload !== undefined) e.payload = payload; // copia exacta de lo que se quiso guardar
            a.push(e);
            cloudOutboxWrite(a);
            // IndexedDB es una copia durable adicional, pero nunca debe bloquear indefinidamente
            // el guardado principal: el outbox ya quedó escrito en localStorage arriba.
            const idbWrite = Promise.resolve().then(() => hvacIDBSet('HVAC_OUTBOX::' + table + '::' + id, JSON.stringify(e)))
                .catch(err => {
                    console.error('[Offline] No se pudo guardar una operación en IndexedDB; se conserva el outbox local:', err);
                    return false;
                });
            const idbTimeout = new Promise(resolve => setTimeout(() => {
                console.warn('[Offline] IndexedDB tardó demasiado; se continúa con el outbox local.');
                resolve(false);
            }, 2500));
            return Promise.race([idbWrite, idbTimeout]);
        }
        function cloudOutboxClear(table, id) {
            const a = cloudOutboxRead();
            const b = a.filter(x => !(x.table === table && x.id === id));
            if (b.length !== a.length) cloudOutboxWrite(b);
            hvacStorageWriteTail = hvacStorageWriteTail.then(() => hvacIDBDelete('HVAC_OUTBOX::' + table + '::' + id)).catch(() => {});
        }

        function cloudCleanId(id) { return String(id).replace(/[\/\\]/g, '-'); }

        // Una sola escritura a la vez por registro: la última siempre gana en orden.
        function cloudEnqueue(key, run) {
            const prev = cloudCtl.queues[key] || Promise.resolve();
            const next = prev.then(run, run);
            cloudCtl.queues[key] = next;
            const cleanup = () => { if (cloudCtl.queues[key] === next) delete cloudCtl.queues[key]; };
            next.then(cleanup, cleanup);
            return next;
        }

        function cloudGuardSize(table, cleanId, payload) {
            try {
                const mb = JSON.stringify(payload).length / 1048576;
                if (mb > 1.5 && !cloudCtl.bigWarned[table + cleanId]) {
                    cloudCtl.bigWarned[table + cleanId] = true;
                    console.warn('[Supabase] Registro voluminoso ' + table + '/' + cleanId + ': ' + mb.toFixed(2) + ' MB (fotos incrustadas).');
                    if (mb > 4) showToast('El registro ' + cleanId + ' pesa ' + mb.toFixed(1) + ' MB por las fotos; podría fallar al sincronizar.', 'error');
                }
            } catch (e) {}
        }

        function cloudUpsert(table, rawId, obj) {
            const cleanId = cloudCleanId(rawId);
            if (table === 'hvac_orders' && typeof hvacInvalidateOrderQueries === 'function') hvacInvalidateOrderQueries();
            if (table !== 'hvac_app_state') cloudMarkDirty(table);
            tombClearIfOld(table, cleanId);
            const payload = JSON.parse(JSON.stringify(obj));
            cloudGuardSize(table, cleanId, payload);
            const durable = cloudOutboxAdd(table, cleanId, 'save', table === 'hvac_app_state' ? undefined : payload); // pendiente hasta confirmar
            return cloudEnqueue(table + ':' + cleanId, async () => {
                await durable;
                const enc = encodeURIComponent(cleanId);
                if (table !== 'hvac_app_state' && window.HVAC && HVAC.r2 && HVAC.r2.hasInline(payload)) {      // fotos tomadas sin señal: se suben a R2 al sincronizar
                    const m = await HVAC.r2.externalize(payload, table);
                    if (m.size) HVAC.r2.applyLocal(table, cleanId, m, { hvac_orders: workOrders, hvac_equipments: equipmentCatalog, hvac_clients: clientsCatalog });
                }
                // Plan A: upsert atómico (1 petición)
                let r = await supabaseFetch(`${table}?on_conflict=id`, 'POST', { id: cleanId, payload }, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }, { quiet: true });
                if (!r) {
                    // Plan B: verificar y actualizar / insertar
                    const check = await supabaseFetch(`${table}?id=eq.${enc}&select=id`, 'GET');
                    if (check && check.length > 0) r = await supabaseFetch(`${table}?id=eq.${enc}`, 'PATCH', { payload }, { 'Prefer': 'return=minimal' });
                    else if (check) r = await supabaseFetch(table, 'POST', { id: cleanId, payload }, { 'Prefer': 'return=minimal' });
                }
                if (r) cloudOutboxClear(table, cleanId);
                return r || null;
            });
        }

        const cloudDeleteWarned = {};
        // Borrado verificado: el servidor puede responder "204 OK" sin eliminar nada (política RLS, ID distinto…).
        // La operación solo sale de la bandeja cuando se CONFIRMA que la fila ya no existe en la nube.
        function cloudDeleteGeneric(table, rawId) {
            const cleanId = cloudCleanId(rawId);
            if (table === 'hvac_orders' && typeof hvacInvalidateOrderQueries === 'function') hvacInvalidateOrderQueries();
            cloudMarkDirty(table);
            tombMark(table, cleanId);                                   // desde ya, ninguna carga lo vuelve a mostrar
            const durable = cloudOutboxAdd(table, cleanId, 'delete');
            return cloudEnqueue(table + ':' + cleanId, async () => {
                await durable;
                const enc = encodeURIComponent(cleanId), q = { quiet: true };
                const del = await supabaseFetch(`${table}?id=eq.${enc}&select=id`, 'DELETE', null, { 'Prefer': 'return=representation' }, q); // &select=id: no devuelve el payload borrado
                if (!del) return null;                                  // sin red / error HTTP: queda pendiente y se reintenta
                const still = await supabaseFetch(`${table}?id=eq.${enc}&select=id`, 'GET', null, null, q);
                if (!Array.isArray(still)) return null;                 // no se pudo verificar: sigue pendiente
                if (still.length) {                                     // el servidor "aceptó" pero no borró
                    console.error(`[Borrado] ${table}/${cleanId} sigue existiendo en la nube tras el DELETE. Revisa la política DELETE (RLS) de Supabase.`);
                    if (!cloudDeleteWarned[table + cleanId]) {
                        cloudDeleteWarned[table + cleanId] = true;
                        try { showToast('El servidor no permitió eliminar el registro ' + cleanId + ' (permisos de Supabase). Permanecerá oculto en este equipo.', 'error'); } catch (_) {}
                    }
                    return null;
                }
                if (table === 'hvac_equipments') {                      // el mismo equipo pudo guardarse antes con otra clave (código vs id)
                    const dups = await supabaseFetch(`hvac_equipments?select=id&payload->>id=eq.${enc}`, 'GET', null, null, q);
                    if (Array.isArray(dups)) for (const d of dups) {
                        if (!d || d.id == null || String(d.id) === cleanId) continue;
                        await supabaseFetch(`hvac_equipments?id=eq.${encodeURIComponent(d.id)}`, 'DELETE', null, null, q);
                        tombMark(table, d.id);
                    }
                }
                cloudOutboxClear(table, cleanId);                       // confirmado: ya no existe en la nube
                return true;
            });
        }

        async function cloudSaveEquipment(eq) { return cloudUpsert('hvac_equipments', eq.id || eq.code, eq); }
        async function cloudDeleteEquipment(id) { return cloudDeleteGeneric('hvac_equipments', id); }
        // Otras filas de hvac_orders con el MISMO id de orden dentro del payload (duplicados): se igualan a la copia guardada.
        async function hvacSyncDuplicateOrderRows(full) {
            let n = 0;
            try {
                const mine = cloudCleanId(full.id);
                const rows = await supabaseFetch('hvac_orders?select=id&limit=20&payload->>id=eq.' + encodeURIComponent(full.id), 'GET', null, null, { quiet: true });
                if (Array.isArray(rows)) for (const r of rows) {
                    if (String(r.id) === mine) continue;
                    console.warn('[Rutina] Fila duplicada de la orden, se actualiza:', r.id);
                    if (await supabaseFetch('hvac_orders?id=eq.' + encodeURIComponent(r.id), 'PATCH', { payload: full }, { 'Prefer': 'return=minimal' }, { quiet: true })) n++;
                }
            } catch (e) { console.warn('[Rutina] No se pudieron sincronizar duplicados:', e); }
            return n;
        }
        // Une dos mapas de ejecuciones por equipo: si un equipo está en ambos gana el de timestamp más reciente (empate: el primero); ninguno se pierde.
        function hvacMergeExecutions(preferred, other) {
            const a = (preferred && typeof preferred === 'object') ? preferred : {};
            const b = (other && typeof other === 'object') ? other : {};
            const out = Object.assign({}, b);
            Object.keys(a).forEach(k => {
                const x = a[k], y = b[k];
                if (!y || typeof y !== 'object') { out[k] = x; return; }
                const tx = Date.parse((x && x.timestamp) || '') || 0, ty = Date.parse((y && y.timestamp) || '') || 0;
                out[k] = (ty > tx) ? y : x;
            });
            return out;
        }
        async function cloudSaveOrder(order, opts) {
            let target = order;
            if (target && target._hvacSummaryOnly && typeof hvacEnsureFullOrder === 'function') {
                target = await hvacEnsureFullOrder(target.id);
            }
            if (!target) return null;
            delete target._hvacSummaryOnly;
            // Protección: una copia SIN ejecuciones, o con detalle VIEJO (_hvacDetailStale), nunca debe sobrescribir las que ya existan en la nube.
            // (Corrección PRE-0024: una acción como recoger herramientas guardaba la orden con ejecuciones antiguas y borraba las nuevas.)
            if ((!Object.keys(target.executions || {}).length || target._hvacDetailStale === true) && navigator.onLine !== false) {
                const srv = await supabaseFetch('hvac_orders?select=ex:payload->executions&id=eq.' + encodeURIComponent(cloudCleanId(target.id)) + '&limit=1', 'GET', null, null, { quiet: true, noStore: true });
                if (!Array.isArray(srv)) return null;                                   // no se pudo verificar: no se guarda (queda pendiente y se reintenta)
                const remote = srv[0] && srv[0].ex;
                if (remote && typeof remote === 'object' && Object.keys(remote).length) target.executions = hvacMergeExecutions(target.executions, remote);
            }
            const res = await cloudUpsert('hvac_orders', target.id, target);
            if (res && opts && opts.dup) await hvacSyncDuplicateOrderRows(target);
            try { hvacInvalidateOrderQueries(); } catch (_) {}      // también al terminar: un listado en vuelo no deja datos viejos en caché
            return res;
        }
        // Caché local pequeña y separada: no reserializa el respaldo completo de órdenes/fotos.
        const HVAC_AI_RECOMMENDATIONS_KEY = 'HVAC_AI_RECOMMENDATIONS_V1';
        function hvacReadAIRecommendationCache() {
            try {
                const value = JSON.parse(localStorage.getItem(HVAC_AI_RECOMMENDATIONS_KEY) || '{}');
                return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
            } catch (_) { return {}; }
        }
        function hvacWriteAIRecommendationCache(cache) {
            try {
                // Límite de seguridad: conservar como máximo las 250 órdenes más recientes.
                const keys = Object.keys(cache || {}).sort((a, b) =>
                    String((cache[b] || {}).generatedAt || '').localeCompare(String((cache[a] || {}).generatedAt || ''))
                ).slice(0, 250);
                const compact = {};
                keys.forEach(key => { compact[key] = cache[key]; });
                localStorage.setItem(HVAC_AI_RECOMMENDATIONS_KEY, JSON.stringify(compact));
                return true;
            } catch (e) {
                console.warn('[IA] No se pudo persistir la caché local de recomendaciones:', e);
                return false;
            }
        }
        // Carga solo las recomendaciones que coinciden con la huella del contenido técnico actual.
        window.hvacLoadAIRecommendations = function(orderId, fingerprint, order) {
            const id = String(orderId || '').trim();
            if (!id || !fingerprint) return null;
            const entry = hvacReadAIRecommendationCache()[id];
            if (!entry || String(entry.fingerprint || '') !== String(fingerprint) || !Array.isArray(entry.recommendations)) return null;
            // Si la nube ya contiene una versión más reciente de la misma huella, prevalece la nube.
            const cloudSameFingerprint = order && Array.isArray(order.aiRecommendations) &&
                String(order.aiRecommendationsFingerprint || '') === String(fingerprint);
            const localTime = Date.parse(entry.generatedAt || '') || 0;
            const cloudTime = cloudSameFingerprint ? (Date.parse(order.aiRecommendationsGeneratedAt || '') || 0) : 0;
            if (cloudSameFingerprint && cloudTime >= localTime) return {
                recommendations: order.aiRecommendations.slice(0, 6),
                fingerprint: String(order.aiRecommendationsFingerprint),
                savedAt: String(order.aiRecommendationsSavedAt || ''),
                pendingCloud: false
            };
            const saved = {
                aiRecommendations: entry.recommendations.slice(0, 6),
                aiRecommendationsFingerprint: String(entry.fingerprint),
                aiRecommendationsGeneratedAt: String(entry.generatedAt || ''),
                aiRecommendationsSavedAt: String(entry.savedAt || ''),
                aiRecommendationsPendingCloud: entry.pendingCloud === true
            };
            if (order && typeof order === 'object') Object.assign(order, saved);
            return saved;
        };

        // Guarda recomendaciones IA en una clave local pequeña y mediante RPC acotada.
        // No reenvía el payload completo ni fotos/ejecuciones a Supabase.
        window.hvacStoreAIRecommendations = async function(orderId, recommendations, fingerprint, generatedAt) {
            const id = String(orderId || '').trim();
            const recs = Array.isArray(recommendations)
                ? recommendations.map(v => String(v || '').trim()).filter(Boolean).slice(0, 6)
                : null;
            if (!id || !recs || !String(fingerprint || '').trim()) {
                return { localSaved: false, cloudSaved: false, error: 'Datos de recomendaciones incompletos.' };
            }
            const stamp = String(generatedAt || new Date().toISOString());
            const cache = hvacReadAIRecommendationCache();
            cache[id] = {
                recommendations: recs,
                fingerprint: String(fingerprint),
                generatedAt: stamp,
                savedAt: '',
                pendingCloud: true
            };
            const localSaved = hvacWriteAIRecommendationCache(cache);
            const target = (workOrders || []).find(o => o && String(o.id) === id);
            if (target) {
                target.aiRecommendations = recs;
                target.aiRecommendationsFingerprint = String(fingerprint);
                target.aiRecommendationsGeneratedAt = stamp;
                delete target.aiRecommendationsSavedAt;
                target.aiRecommendationsPendingCloud = true;
            }
            if (navigator.onLine === false) {
                return { localSaved, cloudSaved: false, offline: true };
            }

            try {
                const result = await supabaseFetch('rpc/hvac_store_ai_recommendations', 'POST', {
                    p_order_id: id,
                    p_recommendations: recs,
                    p_fingerprint: String(fingerprint),
                    p_generated_at: stamp
                }, null, { quiet: true, noStore: true });
                const count = Number(result);
                if (typeof result === 'number' && Number.isFinite(count) && count > 0) {
                    const latest = hvacReadAIRecommendationCache();
                    const stored = latest[id];
                    // No marcar como sincronizada una entrada que otra descarga ya haya sustituido.
                    if (stored && stored.fingerprint === String(fingerprint)) {
                        stored.savedAt = stamp;
                        stored.pendingCloud = false;
                        hvacWriteAIRecommendationCache(latest);
                    }
                    if (target && target.aiRecommendationsFingerprint === String(fingerprint)) {
                        target.aiRecommendationsSavedAt = stamp;
                        target.aiRecommendationsPendingCloud = false;
                    }
                    try { hvacInvalidateOrderQueries(); } catch (_) {}
                    return { localSaved, cloudSaved: true, rows: count };
                }
                return { localSaved, cloudSaved: false, error: 'Supabase no confirmó el guardado de las recomendaciones.' };
            } catch (error) {
                console.warn('[IA] No se pudieron guardar las recomendaciones en Supabase:', error);
                return { localSaved, cloudSaved: false, error: error && error.message ? error.message : String(error) };
            }
        };

        async function hvacVerifyOrderEquipmentIds(orderId, expectedIds) {
            if (!navigator.onLine) return false;
            const enc = encodeURIComponent(String(orderId));
            const rows = await supabaseFetch('hvac_orders?select=id,equipmentIds:payload->equipmentIds&payload->>id=eq.' + enc + '&limit=20', 'GET', null, null, { quiet: true, noStore: true });
            if (!Array.isArray(rows) || !rows.length) return false;
            const expected = JSON.stringify([...new Set((expectedIds || []).map(String))].sort());
            // Si hay filas físicas duplicadas para el mismo consecutivo, todas deben reflejar la edición.
            return rows.every(row => JSON.stringify([...new Set((Array.isArray(row.equipmentIds) ? row.equipmentIds : []).map(String))].sort()) === expected);
        }
        async function cloudDeleteOrder(id) { return cloudDeleteGeneric('hvac_orders', id); }
        async function cloudSaveClient(cli) { return cloudUpsert('hvac_clients', cli.id, cli); }
        async function cloudDeleteClient(id) { return cloudDeleteGeneric('hvac_clients', id); }
        async function cloudSaveUser(usr) { return cloudUpsert('hvac_users', usr.id, usr); }
        async function cloudDeleteUser(id) { return cloudDeleteGeneric('hvac_users', id); }

        // Reaplica cambios pendientes (hechos sin conexión) ANTES de que la copia de la nube los pise.
        function cloudReconcileOutbox() {
            const box = cloudOutboxRead();
            if (!box.length) return;
            const cfg = {
                hvac_equipments: { get: () => equipmentCatalog, set: v => { equipmentCatalog = v; }, bk: 'HVAC_EQUIPMENTS_BACKUP', key: e => e.id || e.code, save: cloudSaveEquipment, del: cloudDeleteEquipment },
                hvac_orders: { get: () => workOrders, set: v => { workOrders = v; }, bk: 'HVAC_ORDERS_BACKUP', key: o => o.id, save: cloudSaveOrder, del: cloudDeleteOrder },
                hvac_clients: { get: () => clientsCatalog, set: v => { clientsCatalog = v; }, bk: 'HVAC_CLIENTS_BACKUP', key: c => c.id, save: cloudSaveClient, del: cloudDeleteClient },
                hvac_users: { get: () => systemUsers, set: v => { systemUsers = v; }, bk: 'HVAC_USERS_BACKUP', key: u => u.id, save: cloudSaveUser, del: cloudDeleteUser }
            };
            box.forEach(entry => {
                if (cloudCtl.queues[entry.table + ':' + entry.id]) return; // ya se está enviando
                if (entry.table === 'hvac_app_state') { cloudScheduleStatePush(entry.id, true); return; }
                const c = cfg[entry.table];
                if (!c) { cloudOutboxClear(entry.table, entry.id); return; }
                const same = rec => rec && cloudCleanId(c.key(rec)) === entry.id;
                if (entry.op === 'delete') {
                    tombMark(entry.table, entry.id);
                    c.set(c.get().filter(r => !same(r)));
                    if (c.del) c.del(entry.id);
                    return;
                }
                const local = entry.payload || null;
                if (!local) { cloudOutboxClear(entry.table, entry.id); return; }
                const arr = c.get().filter(r => !same(r));
                arr.push(local);
                c.set(arr);
                c.save(local);
            });
        }

        async function cloudFlushOutbox() {
            if (!navigator.onLine) return { sent: 0, pending: cloudOutboxRead().length };
            const entries = cloudOutboxRead().slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
            let sent = 0;
            for (const snap of entries) {
                // Se relee la entrada vigente (pudo actualizarse) y se omite si ya se está enviando.
                const entry = cloudOutboxRead().find(x => x.table === snap.table && x.id === snap.id);
                if (!entry || cloudCtl.queues[entry.table + ':' + entry.id]) continue;
                try {
                    let result = null;
                    if (entry.op === 'delete') result = await cloudDeleteGeneric(entry.table, entry.id);
                    else if (entry.table === 'hvac_app_state' && entry.payload) result = await cloudUpsert(entry.table, entry.id, entry.payload);
                    else {
                        const save = {
                            hvac_equipments: cloudSaveEquipment,
                            hvac_orders: cloudSaveOrder,
                            hvac_clients: cloudSaveClient,
                            hvac_users: cloudSaveUser
                        }[entry.table];
                        if (save && entry.payload) result = await save(entry.payload);
                        else if (entry.table === 'hvac_app_state') {
                            const stateKey = String(entry.id);
                            const raw = localStorage.getItem(stateKey);
                            if (raw !== null) result = await cloudUpsert('hvac_app_state', stateKey, {
                                key: stateKey,
                                updatedAt: Number(localStorage.getItem('HVAC_TS_' + stateKey)) || entry.ts || Date.now(),
                                data: raw
                            });
                        }
                    }
                    if (result) sent++;
                } catch (e) {
                    console.warn('[Offline] Se conserva operación pendiente para reintentar:', entry.table, entry.id, e);
                }
            }
            return { sent, pending: cloudOutboxRead().length };
        }

        // ---- Módulos que solo vivían en el navegador: se respaldan en la tabla hvac_app_state ----
        async function cloudStateProbe() {
            if (cloudStateCtl.disabled) return false;
            if (cloudStateCtl.probed) return true;
            const r = await supabaseFetch('hvac_app_state?select=id&limit=1', 'GET', null, null, { quiet: true });
            if (r) { cloudStateCtl.probed = true; return true; }
            if (cloudCtl.lastStatus === 404 || cloudCtl.lastStatus === 400) {
                cloudStateCtl.disabled = true;
                console.info('[Supabase] Tabla hvac_app_state no existe: agenda, caja, proyecciones y formularios permanecen solo en este dispositivo.');
            }
            return false;
        }

        function cloudScheduleStatePush(key, immediate) {
            if (cloudStateCtl.disabled) return;
            clearTimeout(cloudStateCtl.timers[key]);
            cloudStateCtl.timers[key] = setTimeout(() => cloudPushState(key), immediate ? 0 : 1500);
        }

        async function cloudPushState(key) {
            if (ESTADO_TABLAS[key] && !estadoCtl.disabled) return estadoPush(key);
            if (cloudStateCtl.disabled) return null;
            const data = localStorage.getItem(key);
            if (data === null) { cloudOutboxClear('hvac_app_state', key); return null; }
            const ts = parseInt(localStorage.getItem('HVAC_TS_' + key), 10) || Date.now();
            const r = await cloudUpsert('hvac_app_state', key, { key, updatedAt: ts, data });
            if (!r && cloudCtl.lastStatus === 404) { cloudStateCtl.disabled = true; cloudOutboxClear('hvac_app_state', cloudCleanId(key)); }
            return r;
        }



        function readLocalBackup(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) {
                console.warn('[Storage] No se pudo leer el respaldo local ' + key + ':', e);
                return fallback;
            }
        }

        function restoreLocalAppData() {
            const localEqs = readLocalBackup('HVAC_EQUIPMENTS_BACKUP', equipmentCatalog);
            const localOrds = readLocalBackup('HVAC_ORDERS_BACKUP', workOrders);
            const localClis = readLocalBackup('HVAC_CLIENTS_BACKUP', clientsCatalog);
            const localUsrs = readLocalBackup('HVAC_USERS_BACKUP', systemUsers);
            const localProjs = readLocalBackup('HVAC_PROJECTIONS_BACKUP', monthlyProjections);
            const localAgenda = readLocalBackup('HVAC_AGENDA_BACKUP', agendaItems);
            const localCaja = readLocalBackup('HVAC_CAJA_BACKUP', cajaMenorItems);
            const localLegs = readLocalBackup('HVAC_LEGALIZATIONS_BACKUP', cajaLegalizations);
            const localForms = readLocalBackup('HVAC_FORMS_CONFIG_BACKUP', equipmentFormsConfig);

            if (Array.isArray(localEqs)) equipmentCatalog = localEqs;
            if (Array.isArray(localOrds)) workOrders = localOrds;
            if (Array.isArray(localClis)) clientsCatalog = localClis;
            if (Array.isArray(localUsrs) && localUsrs.length) systemUsers = localUsrs;
            if (Array.isArray(localProjs)) monthlyProjections = localProjs;
            if (Array.isArray(localAgenda)) agendaItems = localAgenda;
            if (Array.isArray(localCaja)) cajaMenorItems = localCaja;
            if (Array.isArray(localLegs)) cajaLegalizations = localLegs;
            if (localForms && typeof localForms === 'object' && !Array.isArray(localForms)) equipmentFormsConfig = localForms;
        }

        // =====================================================================
        //  CARGA DIFERIDA (lazy loading)
        //  Al abrir la app NO se consulta nada: solo se muestra el Login.
        //  Cada módulo descarga únicamente sus tablas al entrar en él.
        // =====================================================================
        const cloudSectionsLoaded = new Set();
        const cloudSectionsInFlight = Object.create(null);
        const HVAC_FETCHED_AT_KEY = 'HVAC_TABLE_FETCHED_AT_V1';
        const HVAC_DIRTY_KEY = 'HVAC_TABLES_DIRTY_V1';
        // Una tabla con cambios locales (guardados/borrados) NO puede darse por "fresca" tras una recarga: la copia local que
        // se restaura puede ir por detrás del último cambio, así que la primera carga debe revalidar contra el servidor.
        function cloudMarkDirty(table) {
            try { const d = JSON.parse(localStorage.getItem(HVAC_DIRTY_KEY) || '{}'); if (!d[table]) { d[table] = 1; localStorage.setItem(HVAC_DIRTY_KEY, JSON.stringify(d)); } } catch (_) {}
        }
        const cloudTableFetchedAt = (() => {  // caché compartida entre secciones y persistente entre recargas
            let base = {};
            try { const raw = JSON.parse(localStorage.getItem(HVAC_FETCHED_AT_KEY) || '{}'); if (raw && typeof raw === 'object' && !Array.isArray(raw)) base = raw; } catch (_) {}
            try { Object.keys(JSON.parse(localStorage.getItem(HVAC_DIRTY_KEY) || '{}')).forEach(t => { delete base[t]; }); } catch (_) {}
            return new Proxy(base, { set(t, k, v) {
                t[k] = v;
                try {
                    localStorage.setItem(HVAC_FETCHED_AT_KEY, JSON.stringify(t));
                    if (v) { const d = JSON.parse(localStorage.getItem(HVAC_DIRTY_KEY) || '{}'); if (d[k]) { delete d[k]; localStorage.setItem(HVAC_DIRTY_KEY, JSON.stringify(d)); } }   // ya se revalidó con el servidor
                } catch (_) {}
                return true;
            } });
        })();
        const cloudTableInFlight = Object.create(null);  // evita dos descargas simultáneas de la misma tabla
        const CLOUD_TABLE_TTL = 5 * 60 * 1000;            // 5 min; la recarga manual sigue forzando sincronización
        const CLOUD_SECTION_CONFIG = {
            'admin-dashboard': { tables: ['hvac_orders'], state: ['HVAC_PROJECTIONS_BACKUP', HVAC_PERIOD_ALERTS_HIDDEN_KEY] },
            'admin-clients': { tables: ['hvac_clients'], state: [] },
            'admin-users': { tables: ['hvac_users'], state: [] },
            'admin-planning': { tables: ['hvac_orders', 'hvac_clients'], state: ['HVAC_PROJECTIONS_BACKUP'] }, // los equipos se piden por cliente al programar
            'admin-agenda': { tables: [], state: ['HVAC_AGENDA_BACKUP'] },
            'admin-caja': { tables: ['hvac_clients'], state: ['HVAC_CAJA_BACKUP', 'HVAC_LEGALIZATIONS_BACKUP'] },
            'admin-history': { tables: ['hvac_clients'], state: [], historyPage: true },      // órdenes: solo las más recientes, por páginas
            'admin-equipment': { tables: ['hvac_clients'], state: ['HVAC_FORMS_CONFIG_BACKUP'], equipmentsProgressive: true }, // equipos: por páginas
            'admin-billing': { tables: ['hvac_orders', 'hvac_clients'], state: ['HVAC_MANUAL_INVOICES_BACKUP', HVAC_UI_SETTINGS_KEY] }, // facturas históricas y política compartida
            'admin-transports': { tables: ['hvac_users', 'hvac_clients'], state: [] },     // transportes (datos en Supabase ops_*)
            'admin-overtime': { tables: ['hvac_users'], state: [] },                        // horas extras (datos en Supabase ops_*)
            'admin-tools': { tables: ['hvac_orders', 'hvac_clients'], state: [] },          // recogida de herramientas (campo toolPickup de cada orden)
            'admin-financial': { tables: ['hvac_orders', 'hvac_clients'], state: ['HVAC_PROJECTIONS_BACKUP', 'HVAC_FINANCIAL_PROJECTIONS_BACKUP', 'HVAC_CAJA_BACKUP', 'HVAC_LEGALIZATIONS_BACKUP', 'HVAC_MANUAL_INVOICES_BACKUP', HVAC_UI_SETTINGS_KEY] },
            'admin-settings': { tables: [], state: [HVAC_UI_SETTINGS_KEY] }
        };
        // Vencida = pasó el TTL, o no hay copia local con la que pintar (p. ej. tras limpiar el almacenamiento).
        const CLOUD_CATALOG_TTL = 10 * 60 * 1000;   // catálogos cambian poco; "Sincronizar" siempre fuerza
        function cloudTableStale(table) {
            const ttl = table === 'hvac_orders' ? CLOUD_TABLE_TTL : CLOUD_CATALOG_TTL;
            if (Date.now() - (cloudTableFetchedAt[table] || 0) > ttl) return true;
            try { const t = CLOUD_TABLE_TARGETS[table]; if (t && !(t.get() || []).length) return true; } catch (_) {}
            return false;
        }
        const CLOUD_TABLE_TARGETS = {
            hvac_equipments: { get: () => equipmentCatalog, set: v => { equipmentCatalog = v; }, backup: 'HVAC_EQUIPMENTS_BACKUP' },
            hvac_orders: { get: () => workOrders, set: v => { workOrders = v; }, backup: 'HVAC_ORDERS_BACKUP' },
            hvac_clients: { get: () => clientsCatalog, set: v => { clientsCatalog = v; }, backup: 'HVAC_CLIENTS_BACKUP' },
            hvac_users: { get: () => systemUsers, set: v => { systemUsers = v; }, backup: 'HVAC_USERS_BACKUP' }
        };
        const SECTION_RENDERERS = {
            'admin-dashboard': () => renderAdminDashboard(),
            'admin-clients': () => renderClientCatalog(),
            'admin-users': () => renderUsersModule(),
            'admin-planning': () => { renderPlanningModule(); planCalInit(); },
            'admin-agenda': () => renderAgendaModule(),
            'admin-caja': () => renderCajaModule(),
            'admin-history': () => renderHistoryModule(),
            'admin-attendance': () => attInit(),
            'admin-equipment': () => renderEquipmentCatalog(),
            'admin-billing': () => renderBillingModule(),
            'admin-transports': () => { if (typeof trInit === 'function') trInit(); },
            'admin-overtime': () => { if (typeof otInit === 'function') otInit(); },
            'admin-tools': () => renderToolsModule(),
            'admin-financial': () => renderFinancialModule(),
            'admin-settings': () => renderSettingsModule()
        };
        // Renderiza únicamente el módulo visible (nunca los ocultos).
        function renderSection(tabId) {
            const render = SECTION_RENDERERS[tabId];
            if (!render) return;
            try { populateClientDropdowns(); populateTechDropdown(); render(); if (typeof hvacUpdateToolsBadge === 'function') hvacUpdateToolsBadge(); }
            catch (e) { console.warn('[UI] No se pudo renderizar ' + tabId + ':', e); }
        }

        function sectionLoadingUI(tabId, status, message) {
            const section = document.getElementById('view-' + tabId);
            if (!section) return;
            let el = section.querySelector(':scope > .section-loading');
            if (status === 'hide') { if (el) el.remove(); return; }
            if (!el) {
                el = document.createElement('div');
                el.className = 'section-loading';
                el.setAttribute('role', 'status');
                el.setAttribute('aria-live', 'polite');
                section.prepend(el);
            }
            el.classList.toggle('section-loading-error', status === 'error');
            el.innerHTML = status === 'error'
                ? '<i class="fa-solid fa-circle-exclamation"></i><span></span>'
                : '<span class="processing-spinner" aria-hidden="true"></span><span></span>';
            el.lastElementChild.textContent = message || (status === 'error' ? 'No se pudieron actualizar los datos. Puedes volver a intentarlo.' : 'Actualizando esta sección…');
        }

        // La tabla hvac_orders guarda las fotos/ejecuciones dentro de payload. Nunca usar
        // select=payload para pintar listados: esta proyección solo trae metadatos pequeños.
        const HVAC_ORDER_SUMMARY_SELECT = [
            'row_id:id',
            'order_id:payload->>id',
            'client:payload->>client',
            'order_date:payload->>date',
            'created_at:payload->>createdAt',
            'updated_at:payload->>updatedAt',
            'status:payload->>status',
            'technician:payload->>technician',
            'technicians:payload->technicians',
            'equipment_ids:payload->equipmentIds',
            'zone_name:payload->>zoneName',
            'zone_base_id:payload->>zoneBaseId',
            'zone_part:payload->>zonePart',
            'zone_parts:payload->>zoneParts',
            'tipo_rutina:payload->>tipoRutina',
            'maintenance_type:payload->>maintenanceType',
            'routine_type:payload->>routineType',
            'invoice_date:payload->invoice->>date',
            'invoice_number:payload->invoice->>number',
            'invoice_amount:payload->invoice->>amount',
            'invoice_expenses:payload->invoice->>expenses',
            'invoice_pdf_url:payload->invoice->>pdfUrl',
            'invoice_matrix_ref:payload->invoice->>matrixRef',
            'pickup_status:payload->toolPickup->>status',
            'pickup_requested_at:payload->toolPickup->>requestedAt',
            'pickup_done_at:payload->toolPickup->>doneAt',
            'pickup_done_by:payload->toolPickup->>doneBy',
            'pickup_note:payload->toolPickup->>note',
            'pickup_history:payload->toolPickup->history',
            'signature_timestamp:payload->clientSignature->>timestamp',
            'signature_name:payload->clientSignature->>name',
            'signature_decision:payload->>signatureDecision',
            'signature_decision_at:payload->>signatureDecisionAt',
            'executions:payload->executions'
        ].join(',');

        function hvacOrderSummaryFromRow(row) {
            if (!row) return null;
            const id = row.order_id || row.row_id;
            if (id == null || id === '') return null;
            const invoice = {};
            if (row.invoice_date != null) invoice.date = row.invoice_date;
            if (row.invoice_number != null) invoice.number = row.invoice_number;
            if (row.invoice_amount != null) invoice.amount = Number(row.invoice_amount) || 0;
            if (row.invoice_expenses != null) invoice.expenses = Number(row.invoice_expenses) || 0;
            if (row.invoice_pdf_url) invoice.pdfUrl = row.invoice_pdf_url;
            if (row.invoice_matrix_ref) invoice.matrixRef = row.invoice_matrix_ref;
            const toolPickup = {};
            if (row.pickup_status) toolPickup.status = row.pickup_status;
            if (row.pickup_requested_at) toolPickup.requestedAt = row.pickup_requested_at;
            if (row.pickup_done_at) toolPickup.doneAt = row.pickup_done_at;
            if (row.pickup_done_by) toolPickup.doneBy = row.pickup_done_by;
            if (row.pickup_note) toolPickup.note = row.pickup_note;
            if (Array.isArray(row.pickup_history)) toolPickup.history = row.pickup_history;
            const n = v => v == null || v === '' ? undefined : Number(v);
            return {
                id: String(id), client: row.client || '', date: row.order_date || '',
                createdAt: row.created_at || '', updatedAt: row.updated_at || '',
                status: String(row.status || 'PENDING').toUpperCase(),
                technician: row.technician || '',
                technicians: Array.isArray(row.technicians) ? row.technicians : [],
                equipmentIds: Array.isArray(row.equipment_ids) ? row.equipment_ids : [],
                zoneName: row.zone_name || '', zoneBaseId: row.zone_base_id || '',
                zonePart: n(row.zone_part), zoneParts: n(row.zone_parts),
                tipoRutina: row.tipo_rutina || '', maintenanceType: row.maintenance_type || '',
                routineType: row.routine_type || '',
                invoice: Object.keys(invoice).length ? invoice : null,
                toolPickup: Object.keys(toolPickup).length ? toolPickup : null,
                signatureDecision: row.signature_decision || '',
                signatureDecisionAt: row.signature_decision_at || '',
                clientSignature: (row.signature_timestamp || row.signature_name)
                    ? { timestamp: row.signature_timestamp || '', name: row.signature_name || '' } : null,
                executions: (row.executions && typeof row.executions === 'object' && !Array.isArray(row.executions)) ? row.executions : {},
                _hvacSummaryOnly: true
            };
        }

        // ===== Avance por equipo: vista ligera como fuente común; RPC como respaldo =====
        // La lista del histórico nunca descarga payload de hvac_orders; el fallback solo
        // consulta hvac_orders_lite para las órdenes visibles (sin fotos base64).
        const HVAC_ORDER_SUMMARY_TTL = 60 * 1000; // metadatos escalares: revalidación ligera cada minuto
        const HVAC_PROGRESS_TTL = 10 * 60 * 1000;   // avance automático cada 10 min; el botón Sincronizar siempre consulta al instante
        const HVAC_PROGRESS_RETRY_MS = 15 * 1000;
        const hvacProgressCache = new Map();       // id -> { at, ok, total, done, started, source }
        const hvacProgressPending = new Set();
        const hvacProgressAttempt = new Map();
        let hvacProgressDisabled = false;
        let hvacProgressLiteViewMissing = false;

        async function hvacFetchLiteProgress(ids, sourceList) {
            if (hvacProgressLiteViewMissing || !ids.length || !navigator.onLine) return false;
            const query = 'hvac_orders_lite?select=id,order_id:payload->>id,executions:payload->executions&payload->>id=in.(' + pgList(ids) + ')';
            const rows = await supabaseFetch(query, 'GET', null, null, { quiet: true, noStore: true });
            if (!Array.isArray(rows)) {
                if (Number(cloudCtl.lastStatus) === 404) hvacProgressLiteViewMissing = true;
                return false;
            }
            const summaryById = new Map((sourceList || []).map(o => [String(o.id), o]));
            let changed = false;
            rows.forEach(row => {
                if (!row || (!row.order_id && row.id == null)) return;
                let executions = row.executions;
                if (typeof executions === 'string') { try { executions = JSON.parse(executions); } catch (_) { return; } }
                // La vista debe entregar un objeto JSON válido. Si falta o viene malformado,
                // NO se interpreta como cero: la orden queda sin resolver y pasa al respaldo RPC.
                if (!executions || typeof executions !== 'object' || Array.isArray(executions)) return;
                const executionEntries = Object.entries(executions);
                const executionValues = executionEntries.map(([, ex]) => ex);
                // Cada ejecución proyectada por hvac_orders_lite debe ser un objeto marcado _lite.
                // Una mezcla de objetos, nulos o respuestas de una vista antigua no se considera válida.
                if (executionValues.some(ex => !ex || typeof ex !== 'object' || Array.isArray(ex) || ex._lite !== true)) return;
                const id = String(row.order_id || row.id);
                const summary = summaryById.get(id);
                if (!summary) return;
                const progressOrder = Object.assign({}, summary, { id, executions });
                const p = hvacOrderProgress(progressOrder);
                const started = Object.values(executions || {}).filter(ex => ex && typeof ex === 'object' && (ex.timestamp || ex.status || ex.partial)).length;
                const prev = hvacProgressCache.get(id);
                const next = { at: Date.now(), ok: true, total: p.total, done: p.done, started, source: 'hvac_orders_lite' };
                if (!prev || !prev.ok || prev.done !== next.done || prev.total !== next.total || prev.started !== next.started) changed = true;
                hvacProgressCache.set(id, next);
            });
            // Las órdenes ausentes o con ejecuciones inválidas NO se convierten artificialmente
            // en 0% ni 100%. Al no guardarlas en caché, hvacRefreshProgress las deriva a la RPC.
            return changed;
        }

        let hvacOutboxMemo = { at: 0, set: new Set() };
        function hvacOrderHasPendingSave(id) {
            if (Date.now() - hvacOutboxMemo.at > 1500) {
                let set = new Set();
                try { set = new Set(cloudOutboxRead().filter(e => e && e.table === 'hvac_orders' && e.op !== 'delete').map(e => String(e.id))); } catch (_) {}
                hvacOutboxMemo = { at: Date.now(), set };
            }
            return hvacOutboxMemo.set.has(cloudCleanId(id));
        }
        // Avance confirmado por la nube hace poco para una orden con detalle local; null si no aplica (p. ej. hay cambios locales sin enviar).
        function hvacLiveProgress(o) {
            try {
                const pc = hvacProgressCache.get(String(o && o.id));
                const n = new Set(((o && o.equipmentIds) || []).map(String).filter(Boolean)).size;
                if (!pc || !pc.ok || Number(pc.total) !== n || Date.now() - pc.at > HVAC_PROGRESS_TTL + 60 * 1000) return null;
                if (hvacOrderHasPendingSave(o.id)) return null;
                return pc;
            } catch (_) { return null; }
        }
        async function hvacRefreshProgress(list) {
            if (!navigator.onLine || !Array.isArray(list)) return false;
            const now = Date.now();
            // Todas las filas visibles (no solo las "resumen"): una orden con detalle guardado localmente se quedaba con el % viejo.
            const eligible = [...new Set(list.filter(o => o && o.id && !String(o.id).startsWith('HIST-')).map(o => String(o.id)))]; // también consulta FACTURADAS: facturar no debe ocultar ni modificar el avance técnico
            const liteOnly = new Set(list.filter(o => o && o._hvacSummaryOnly).map(o => String(o.id)));
            // Detalle local AL DÍA (no marcado como viejo): el avance sale de ese detalle con la misma regla que usa el técnico; no se consulta la nube.
            const freshDetail = new Set(list.filter(o => o && o._hvacSummaryOnly !== true && o._hvacDetailStale !== true && o.executions && typeof o.executions === 'object' && Object.keys(o.executions).length).map(o => String(o.id)));
            const ids = eligible.filter(id => {
                const c = hvacProgressCache.get(id);
                const triedAt = hvacProgressAttempt.get(id) || 0;
                return !freshDetail.has(id) && !hvacProgressPending.has(id) && !(c && c.ok && now - c.at < HVAC_PROGRESS_TTL) && (now - triedAt >= HVAC_PROGRESS_RETRY_MS);
            });
            if (!ids.length) return false;

            ids.forEach(id => { hvacProgressPending.add(id); hvacProgressAttempt.set(id, now); });
            let changed = false;
            try {
                // Fuente primaria: ejecuciones proyectadas de hvac_orders_lite, calculadas
                // con la misma función local que usa el hub del técnico. Solo filas visibles.
                // Un error/timeout de la vista no debe impedir el respaldo RPC.
                let viewChanged = false;
                try {
                    // Vista ligera (trae ejecuciones) solo para filas resumen; las que ya tienen detalle usan la RPC numérica (~50 bytes por orden).
                    const liteIds = ids;   // filas resumen o con detalle viejo: se calcula con las ejecuciones de la nube y la regla de la app
                    viewChanged = liteIds.length ? await hvacFetchLiteProgress(liteIds, list) : false;
                } catch (viewError) {
                    console.warn('[Avance] La vista ligera no respondió; se intentará RPC:', viewError);
                    if (Number(cloudCtl.lastStatus) === 404) hvacProgressLiteViewMissing = true;
                }
                changed = viewChanged || changed;
                const unresolved = ids.filter(id => {
                    const c = hvacProgressCache.get(id);
                    return !(c && c.ok && c.source === 'hvac_orders_lite' && c.at >= now);
                });

                // Respaldo: RPC numérica. Se invoca siempre que la vista lite no resolvió alguna orden.
                // Una respuesta fallida nunca reemplaza el último valor bueno.
                if (unresolved.length && !hvacProgressDisabled) {
                    const rows = await supabaseFetch('rpc/hvac_orders_progress', 'POST', { p_ids: unresolved }, null, { quiet: true, noStore: true });
                    if (!Array.isArray(rows) && Number(cloudCtl.lastStatus) === 404) {
                        hvacProgressDisabled = true;
                        console.info('[Avance] RPC no disponible; se conserva el conteo de la vista ligera o se muestra — hasta obtener datos válidos.');
                    }
                    if (Array.isArray(rows)) {
                        rows.forEach(r => {
                            if (!r || r.id == null || r.total == null || r.done == null) return;
                            const id = String(r.id);
                            if (!unresolved.includes(id)) return;
                            const summary = list.find(o => o && String(o.id) === id);
                            const expectedTotal = summary && Array.isArray(summary.equipmentIds) ? new Set(summary.equipmentIds.map(String).filter(Boolean)).size : null;
                            const total = Math.max(0, Number(r.total) || 0);
                            // Solo descartar si el resumen tenía equipos Y el total no coincide.
                            // Si equipmentIds llegó vacío (expectedTotal === 0), se acepta el total de la nube.
                            if (expectedTotal != null && expectedTotal > 0 && total !== expectedTotal) return;
                            const prev = hvacProgressCache.get(id);
                            const nx = { at: Date.now(), ok: true, total, done: Math.min(total, Math.max(0, Number(r.done) || 0)), started: Math.max(0, Number(r.started) || 0), source: 'rpc' };
                            if (!prev || !prev.ok || prev.done !== nx.done || prev.started !== nx.started || prev.total !== nx.total) changed = true;
                            hvacProgressCache.set(id, nx);
                        });
                    }
                }
            } catch (e) {
                console.warn('[Avance] No se pudo actualizar el resumen ligero:', e);
            } finally {
                ids.forEach(id => hvacProgressPending.delete(id));
            }
            return changed;
        }

        // Caché por consulta: alternar pestañas/filtros repetidos no vuelve a llamar a Supabase dentro del TTL.
        // Se invalida entera al guardar/borrar una orden y se salta con { force: true } (botón Actualizar).
        const hvacOrderQueryCache = new Map();   // query -> { at, rows }
        const hvacOrderQueryInFlight = new Map(); // query -> Promise
        function hvacInvalidateOrderQueries() { hvacOrderQueryCache.clear(); hvacProgressCache.clear(); }
        window.hvacInvalidateOrderQueries = hvacInvalidateOrderQueries;
        async function cloudFetchOrderSummaries(query = '&order=payload->>date.desc&limit=1000', opts) {
            const force = !!(opts && opts.force);
            const clone = rows => JSON.parse(JSON.stringify(rows));
            if (!force) {
                const hit = hvacOrderQueryCache.get(query);
                if (hit && Date.now() - hit.at < HVAC_ORDER_SUMMARY_TTL) return clone(hit.rows);
                if (hvacOrderQueryInFlight.has(query)) { const r = await hvacOrderQueryInFlight.get(query); return r ? clone(r) : r; }
            }
            const task = (async () => {
                const rows = await supabaseFetch('hvac_orders?select=' + HVAC_ORDER_SUMMARY_SELECT + query, 'GET', null, null, { quiet: true, noStore: true });
                if (!Array.isArray(rows)) return null;
                const list = rows.map(hvacOrderSummaryFromRow).filter(Boolean);
                hvacOrderQueryCache.set(query, { at: Date.now(), rows: list });
                if (hvacOrderQueryCache.size > 60) hvacOrderQueryCache.delete(hvacOrderQueryCache.keys().next().value);
                return list;
            })();
            hvacOrderQueryInFlight.set(query, task);
            try { const r = await task; return r ? clone(r) : r; }
            finally { if (hvacOrderQueryInFlight.get(query) === task) hvacOrderQueryInFlight.delete(query); }
        }

        async function cloudFetchTable(table, force) {
            // Una petición antigua en curso no debe satisfacer un clic explícito en Sincronizar.
            if (cloudTableInFlight[table]) {
                const running = cloudTableInFlight[table];
                if (!force) return running;
                try { await running; } catch (_) {}
                if (cloudTableInFlight[table] === running) delete cloudTableInFlight[table];
            }
            const task = (async () => {
                if (table === 'hvac_orders') return cloudFetchOrderSummaries(undefined, { force: !!force });
                const rows = await supabaseFetch(table + '?select=payload', 'GET', null, null, { quiet: true, noStore: !!force });   // sin caché solo al pulsar Sincronizar
                return Array.isArray(rows) ? rows.map(r => r && r.payload).filter(Boolean) : null;
            })();
            cloudTableInFlight[table] = task;
            try { return await task; }
            finally { if (cloudTableInFlight[table] === task) delete cloudTableInFlight[table]; }
        }


        // =====================================================================
        //  CARGA BAJO DEMANDA DE EQUIPOS Y ÓRDENES (rápida y liviana)
        // =====================================================================
        const pgQuote = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        const pgList = arr => arr.map(pgQuote).join(',');
        // Patrón ilike tolerante a tildes: "Clínica La Carolina" → "*Cl_nica*La*Carolina*"
        function pgLikePattern(txt) {
            const clean = cleanSpaces(txt).replace(/[,()"\\%*]/g, '').split(' ').filter(Boolean)
                .map(w => w.replace(/[^\x20-\x7E]/g, '_')).join('*');
            return '*' + clean + '*';
        }
        function mergeEquipmentsIntoCatalog(list) {
            list.forEach(eq => {
                if (!eq || tombHas('hvac_equipments', eq.id || eq.code)) return;
                const idx = equipmentCatalog.findIndex(e => (eq.id && String(e.id) === String(eq.id)));
                if (idx >= 0) equipmentCatalog[idx] = eq; else equipmentCatalog.push(eq);
            });
        }
        // ---------------------------------------------------------------------
        //  LÁPIDAS: un registro borrado NO vuelve a mostrarse ni a guardarse por una respuesta atrasada,
        //  una copia vieja o un servidor que ignoró el borrado. Se conservan 14 días.
        //  Aplican a rutinas, equipos, clientes y usuarios.
        // ---------------------------------------------------------------------
        const HVAC_TOMB_KEY = 'HVAC_TOMBSTONES_V2', HVAC_TOMB_TTL = 14 * 24 * 3600 * 1000;
        const HVAC_DELETED_ORDER_IDS_KEY = 'HVAC_DELETED_ORDER_IDS_V1';        // formato anterior (solo rutinas): se migra solo
        const tombKeyOf = { hvac_orders: o => o && o.id, hvac_equipments: e => e && (e.id || e.code), hvac_clients: c => c && c.id, hvac_users: u => u && u.id };
        function tombRead() {
            let all = {}, dirty = false;
            try { const raw = JSON.parse(localStorage.getItem(HVAC_TOMB_KEY) || '{}'); if (raw && typeof raw === 'object' && !Array.isArray(raw)) all = raw; } catch (_) {}
            try {
                const old = JSON.parse(localStorage.getItem(HVAC_DELETED_ORDER_IDS_KEY) || 'null');
                if (old && typeof old === 'object' && !Array.isArray(old)) { all.hvac_orders = Object.assign({}, old, all.hvac_orders || {}); localStorage.removeItem(HVAC_DELETED_ORDER_IDS_KEY); dirty = true; }
            } catch (_) {}
            const now = Date.now();
            Object.keys(all).forEach(t => {
                const m = all[t];
                if (!m || typeof m !== 'object') { delete all[t]; dirty = true; return; }
                Object.keys(m).forEach(id => { if (now - Number(m[id]) > HVAC_TOMB_TTL) { delete m[id]; dirty = true; } });
            });
            if (dirty) { try { localStorage.setItem(HVAC_TOMB_KEY, JSON.stringify(all)); } catch (_) {} }
            return all;
        }
        function tombWrite(all) { try { localStorage.setItem(HVAC_TOMB_KEY, JSON.stringify(all)); } catch (_) {} }
        function tombHas(table, id) { const t = tombRead()[table]; return !!(t && Object.prototype.hasOwnProperty.call(t, cloudCleanId(id))); }
        function tombMark(table, id) { const all = tombRead(); (all[table] = all[table] || {})[cloudCleanId(id)] = Date.now(); tombWrite(all); }
        function tombClear(table, id) { const all = tombRead(); if (all[table]) { delete all[table][cloudCleanId(id)]; tombWrite(all); } }
        // Un guardado de ese mismo ID, 60 s o más después del borrado, es una re-creación intencional: levanta la lápida.
        function tombClearIfOld(table, id) { const t = tombRead()[table], k = t && t[cloudCleanId(id)]; if (k && Date.now() - Number(k) > 60000) tombClear(table, id); }
        function tombFilter(table, list) {
            const t = tombRead()[table], key = tombKeyOf[table];
            if (!t || !key || !Array.isArray(list) || !Object.keys(t).length) return list;
            return list.filter(x => { const id = key(x); return id == null || !Object.prototype.hasOwnProperty.call(t, cloudCleanId(id)); });
        }
        // Compatibilidad con el código existente (rutinas)
        function deletedOrderIdsRead() { return tombRead().hvac_orders || {}; }
        function deletedOrderIdHas(id) { return tombHas('hvac_orders', id); }
        function deletedOrderIdMark(id) { tombMark('hvac_orders', id); }
        function deletedOrderIdClear(id) { tombClear('hvac_orders', id); }
        // Si la nube tiene una versión POSTERIOR al borrado (otro equipo reutilizó el consecutivo o re-creó la orden), la lápida ya no aplica.
        function orderTombSuperseded(id, updatedAt) {
            const t = (tombRead().hvac_orders || {})[cloudCleanId(id)];
            if (!t) return false;
            const u = Date.parse(updatedAt || '');
            if (Number.isFinite(u) && u > Number(t) + 1000) { tombClear('hvac_orders', id); return true; }
            return false;
        }
        function mergeOrdersIntoList(list) {
            list.forEach(o => {
                if (!o || !o.id || (deletedOrderIdHas(o.id) && !orderTombSuperseded(o.id, o.updatedAt))) return;
                const idx = workOrders.findIndex(x => String(x.id) === String(o.id));
                if (idx >= 0) workOrders[idx] = o; else workOrders.push(o);
            });
        }

        // Fusiona metadatos de nube con la copia local. Si la orden ya tiene detalles,
        // conserva executions/fotos/firmas; si no, queda marcada para hidratarla al abrirla.
        function mergeOrderSummariesIntoList(list, replaceAll = false) {
            if (!Array.isArray(list)) return;
            {   // Si hay varias filas con el mismo id de orden, se queda la de updatedAt más reciente (resultado determinista)
                const byId = new Map();
                list.forEach(s => { if (!s || !s.id) return; const k = String(s.id), p = byId.get(k); if (!p || String(s.updatedAt || '') >= String(p.updatedAt || '')) byId.set(k, s); });
                list = Array.from(byId.values());
            }
            const previous = new Map((workOrders || []).map(o => [String(o && o.id), o]));
            const merged = replaceAll ? new Map() : new Map(previous);
            let pendingSave = new Set();
            try {
                                // Un cambio local sin confirmar en la nube se conserva SIEMPRE (nunca se descarta automáticamente: puede contener el trabajo del técnico).
                pendingSave = new Set(cloudOutboxRead().filter(e => e && e.table === 'hvac_orders' && e.op !== 'delete').map(e => String(e.id)));
            } catch (_) {}
            list.forEach(summary => {
                if (!summary || !summary.id || (deletedOrderIdHas(summary.id) && !orderTombSuperseded(summary.id, summary.updatedAt))) return;
                const key = String(summary.id), old = previous.get(key);
                if (!old) { merged.set(key, summary); return; }
                if (pendingSave.has(cloudCleanId(key))) { merged.set(key, old); return; }   // cambio local aún sin confirmar en la nube: no se pisa con la copia vieja del servidor
                const hadDetails = old._hvacSummaryOnly !== true;
                const next = Object.assign({}, hadDetails ? old : {}, summary);
                if (hadDetails) {
                    next.invoice = summary.invoice ? Object.assign({}, old.invoice || {}, summary.invoice) : null;
                    next.toolPickup = summary.toolPickup ? Object.assign({}, old.toolPickup || {}, summary.toolPickup) : null;
                    if (summary.clientSignature) next.clientSignature = Object.assign({}, old.clientSignature || {}, summary.clientSignature);
                    else if (old.clientSignature) next.clientSignature = old.clientSignature;
                    if (old.executions) next.executions = old.executions; // un resultado parcial de trazabilidad no pisa todos los detalles
                    // Si la versión de la nube es distinta a la del detalle guardado, ese detalle está viejo: se vuelve a bajar al abrir la orden.
                    if (!old._hvacDetailUpdatedAt || String(summary.updatedAt || '') !== String(old._hvacDetailUpdatedAt)) next._hvacDetailStale = true;
                    delete next._hvacSummaryOnly;
                    if (old._hvacDetailFetchedAt) next._hvacDetailFetchedAt = old._hvacDetailFetchedAt;
                } else {
                    next._hvacSummaryOnly = true;
                    if (old.executions || summary.executions) next.executions = Object.assign({}, old.executions || {}, summary.executions || {});
                }
                merged.set(key, next);
            });
            workOrders = Array.from(merged.values());
        }

        const hvacOrderDetailInFlight = Object.create(null);
        async function hvacEnsureFullOrder(orderId) {
            const key = String(orderId == null ? '' : orderId);
            if (!key) return null;
            let current = workOrders.find(o => String(o && o.id) === key);
            if (!current) return null;
            if (current._hvacSummaryOnly !== true && !navigator.onLine) return current;   // sin red se usa lo local
            // Copia local "completa" pero SIN ejecuciones (p. ej. un resto vacío): se vuelve a pedir a la nube (máx. 1 vez por minuto).
            const hvacLocalEmpty = current._hvacSummaryOnly !== true && !Object.keys(current.executions || {}).length && (!Number(current._hvacDetailFetchedAt || 0) || Date.now() - Number(current._hvacDetailFetchedAt) > 60000);
            if (current._hvacSummaryOnly !== true && !hvacLocalEmpty && !current._hvacDetailStale) {
                // Ya hay detalle en memoria. Dentro del TTL (o sin red, o con cambios locales pendientes) se reutiliza.
                const fetchedAt = Number(current._hvacDetailFetchedAt || 0);
                if (!fetchedAt || Date.now() - fetchedAt < CLOUD_TABLE_TTL || !navigator.onLine) return current;
                let pending = false;
                try { pending = cloudOutboxRead().some(e => e && e.table === 'hvac_orders' && String(e.id) === cloudCleanId(key)); } catch (_) {}
                if (pending) return current;
                if (hvacOrderDetailInFlight[key]) return hvacOrderDetailInFlight[key];
                // Revalidación de ~100 bytes: solo se re-descarga el payload si la orden cambió en la nube.
                const light = await supabaseFetch('hvac_orders?select=u:payload->>updatedAt&id=eq.' + encodeURIComponent(cloudCleanId(key)) + '&limit=1', 'GET', null, null, { quiet: true });
                if (!Array.isArray(light) || !light.length) return current;
                if (String(light[0].u || '') === String(current._hvacDetailUpdatedAt || '')) { current._hvacDetailFetchedAt = Date.now(); return current; }
            }
            if (hvacOrderDetailInFlight[key]) return hvacOrderDetailInFlight[key];
            const task = (async () => {
                const cleanId = cloudCleanId(key);
                let rows = await supabaseFetch('hvac_orders?select=payload&id=eq.' + encodeURIComponent(cleanId) + '&limit=1', 'GET', null, null, { quiet: true });
                if (!Array.isArray(rows) || !rows.length || !rows[0] || !rows[0].payload) {
                    rows = await supabaseFetch('hvac_orders?select=payload&payload->>id=eq.' + encodeURIComponent(key) + '&limit=1', 'GET', null, null, { quiet: true });
                }
                const payload = Array.isArray(rows) && rows[0] && rows[0].payload;
                if (!payload || typeof payload !== 'object') return null;
                current = workOrders.find(o => String(o && o.id) === key) || current;
                // El servidor aporta el documento completo; los campos ligeros actuales preservan
                // cualquier cambio local reciente y se combinan con los objetos anidados completos.
                let hasPending = false;
                try { hasPending = cloudOutboxRead().some(e => e && e.table === 'hvac_orders' && e.op !== 'delete' && String(e.id) === cloudCleanId(key)); } catch (_) {}
                const full = hasPending ? Object.assign({}, payload, current) : Object.assign({}, current, payload);   // sin cambios pendientes, manda la nube
                // Las recomendaciones que quedaron guardadas localmente por una caída del RPC
                // no deben desaparecer al revalidar la orden desde Supabase. En la siguiente
                // descarga se reintenta únicamente el guardado, sin volver a llamar a la IA.
                if (current.aiRecommendationsPendingCloud === true &&
                    Array.isArray(current.aiRecommendations) && current.aiRecommendationsFingerprint &&
                    !(Array.isArray(payload.aiRecommendations) &&
                      String(payload.aiRecommendationsFingerprint || '') === String(current.aiRecommendationsFingerprint))) {
                    full.aiRecommendations = current.aiRecommendations;
                    full.aiRecommendationsFingerprint = current.aiRecommendationsFingerprint;
                    full.aiRecommendationsGeneratedAt = current.aiRecommendationsGeneratedAt || '';
                    full.aiRecommendationsPendingCloud = true;
                    delete full.aiRecommendationsSavedAt;
                }
                full.invoice = Object.assign({}, payload.invoice || {}, current.invoice || {});
                full.toolPickup = Object.assign({}, payload.toolPickup || {}, current.toolPickup || {});
                full.clientSignature = Object.assign({}, payload.clientSignature || {}, current.clientSignature || {});
                full.executions = hvacMergeExecutions(hasPending ? current.executions : payload.executions, hasPending ? payload.executions : current.executions);
                delete full._hvacSummaryOnly;
                delete full._hvacDetailStale;
                full._hvacDetailFetchedAt = Date.now();
                full._hvacDetailUpdatedAt = String(payload.updatedAt || '');
                const idx = workOrders.findIndex(o => String(o && o.id) === key);
                if (idx >= 0) workOrders[idx] = full; else workOrders.push(full);
                return full;
            })();
            hvacOrderDetailInFlight[key] = task;
            try { return await task; }
            finally { delete hvacOrderDetailInFlight[key]; }
        }
        window.hvacEnsureFullOrder = hvacEnsureFullOrder;
        function persistEquipmentBackup() { try { localStorage.setItem('HVAC_EQUIPMENTS_BACKUP', JSON.stringify(equipmentCatalog)); } catch (_) {} }

        // Equipos de UN cliente (modales de programación). No descarga el resto del catálogo.
        const clientEquipmentFetchedAt = Object.create(null);
        async function ensureClientEquipments(clientName) {
            const key = normText(clientName);
            if (!key || !navigator.onLine) return false;
            if (Date.now() - (clientEquipmentFetchedAt[key] || 0) < CLOUD_TABLE_TTL) return true;
            const pat = pgLikePattern(clientRootLabel(clientName));
            const rec = findClientRecord(clientName);
            const parts = ['payload->>client.ilike.' + pat, 'payload->>clientName.ilike.' + pat];
            if (rec) parts.push('payload->>clientId.eq.' + pgQuote(rec.id));
            const rows = await supabaseFetch('hvac_equipments?select=payload&order=id&limit=1000&or=' + encodeURIComponent('(' + parts.join(',') + ')'), 'GET', null, null, { quiet: true });
            if (!Array.isArray(rows)) return false;
            mergeEquipmentsIntoCatalog(rows.map(r => r && r.payload).filter(Boolean));
            clientEquipmentFetchedAt[key] = Date.now();
            persistEquipmentBackup();
            return true;
        }

        // Equipos de UNA orden (hub, PDF): solo los IDs que la orden referencia.
        async function ensureOrderEquipments(order) {
            if (!order || !navigator.onLine) return false;
            const ids = [...new Set((order.equipmentIds || []).map(String).filter(Boolean))];
            const missing = ids.filter(id => !equipmentCatalog.some(e => String(e.id) === id || String(e.code) === id));
            if (!missing.length) return true;
            const keys = [...new Set(missing.concat(missing.map(cloudCleanId)))];
            let ok = true;
            for (let i = 0; i < keys.length; i += 40) {
                const list = pgList(keys.slice(i, i + 40));
                const rows = await supabaseFetch('hvac_equipments?select=payload&or=' + encodeURIComponent('(id.in.(' + list + '),payload->>code.in.(' + list + '))'), 'GET', null, null, { quiet: true });
                if (!Array.isArray(rows)) { ok = false; continue; }
                mergeEquipmentsIntoCatalog(rows.map(r => r && r.payload).filter(Boolean));
            }
            persistEquipmentBackup();
            return ok;
        }

        // Pestaña Equipos: la primera página llega de inmediato; el resto se completa en segundo plano.
        const EQ_FETCH_PAGE = 500;
        let eqProgressiveToken = 0;
        let eqProgressivePromise = null;
        let eqBackgroundLoading = false;
        async function loadEquipmentsProgressive(tabId) {
            const token = ++eqProgressiveToken;
            const previous = equipmentCatalog.slice();
            let offset = 0;
            const page = () => supabaseFetch(`hvac_equipments?select=payload&order=id&limit=${EQ_FETCH_PAGE}&offset=${offset}`, 'GET', null, null, { quiet: true });
            const first = await page();
            if (!Array.isArray(first)) return false;
            equipmentCatalog = tombFilter('hvac_equipments', first.map(r => r && r.payload).filter(Boolean));
            cloudReconcileOutbox(); // reaplica cambios que la nube aún no confirmó
            cloudTableFetchedAt.hvac_equipments = Date.now();
            persistEquipmentBackup();
            if (first.length < EQ_FETCH_PAGE) { eqBackgroundLoading = false; return true; }

            eqBackgroundLoading = true;
            const refreshView = () => {
                const sec = document.getElementById('view-admin-equipment');
                if (sec && !sec.classList.contains('hidden')) { try { renderEquipmentCatalog(); } catch (_) {} }
            };
            eqProgressivePromise = (async () => {
                let rows = first, failed = false;
                while (rows.length === EQ_FETCH_PAGE) {
                    if (token !== eqProgressiveToken) return;
                    offset += EQ_FETCH_PAGE;
                    rows = await page();
                    if (!Array.isArray(rows)) { failed = true; break; }
                    const have = new Set(equipmentCatalog.map(e => String(e.id)));
                    rows.forEach(r => { const e = r && r.payload; if (e && !have.has(String(e.id)) && !tombHas('hvac_equipments', e.id || e.code)) { equipmentCatalog.push(e); have.add(String(e.id)); } });
                    sectionLoadingUI(tabId, 'loading', `Cargando equipos… ${equipmentCatalog.length}`);
                    refreshView();
                }
                if (token !== eqProgressiveToken) return;
                if (failed) { // conserva lo que ya había en el dispositivo
                    const have = new Set(equipmentCatalog.map(e => String(e.id)));
                    previous.forEach(e => { if (e && !have.has(String(e.id)) && !tombHas('hvac_equipments', e.id || e.code)) equipmentCatalog.push(e); });
                }
                cloudReconcileOutbox();
                persistEquipmentBackup();
                eqBackgroundLoading = false;
                if (failed) sectionLoadingUI(tabId, 'error', 'No se pudieron cargar todos los equipos. Se muestran los disponibles.');
                else sectionLoadingUI(tabId, 'hide');
                refreshView();
            })().finally(() => { eqBackgroundLoading = false; eqProgressivePromise = null; });
            sectionLoadingUI(tabId, 'loading', `Cargando equipos… ${equipmentCatalog.length}`);
            return true;
        }

        // ----- Histórico: solo las órdenes más recientes, ordenadas de nuevo a antiguo -----
        const HIST_FETCH_PAGE = 40;
        const historyState = { offset: 0, hasMore: true, loading: false, token: 0, timer: null, sig: '' };
        function historyServerFilters() {
            const text = (document.getElementById('hist-search-input')?.value || '').trim();
            const sel = document.getElementById('hist-filter-client');
            const clientKey = (sel && sel.value) || 'ALL';
            const label = clientKey !== 'ALL' && sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : '';
            const status = (document.getElementById('hist-filter-status') || {}).value || 'ALL';
            return { text, clientKey, label, status };
        }
        async function fetchHistoryPage(reset, force) {
            if (!navigator.onLine) return false;
            const st = historyState;
            const f = historyServerFilters();
            if (reset) { st.offset = 0; st.hasMore = true; }
            if (force) { hvacProgressCache.clear(); hvacProgressLiteViewMissing = false; hvacProgressDisabled = false; }   // botón Sincronizar: avance también se refresca
            st.sig = f.text + '|' + f.clientKey + '|' + f.status;
            const token = ++st.token;
            st.loading = true;
            let filters = '';
            if (f.text) {
                const pat = pgLikePattern(f.text);
                filters += '&or=' + encodeURIComponent(`(id.ilike.${pat},payload->>client.ilike.${pat},payload->>technician.ilike.${pat})`);
            }
            if (f.label) filters += '&payload->>client=ilike.' + encodeURIComponent(pgLikePattern(clientRootLabel(f.label)));
            // Estados guardados en la orden: se piden ya filtrados. Pendiente / En proceso se calculan con el avance real, en pantalla.
            if (f.status === 'COMPLETED' || f.status === 'BILLED') filters += '&payload->>status=eq.' + f.status;
            // Paginación liviana: no descarga fotos, ejecuciones ni firmas en base64.
            let rows = await cloudFetchOrderSummaries(`&order=${historyServerOrder()}&limit=${HIST_FETCH_PAGE}&offset=${st.offset}${filters}`, { force: !!force });
            let paged = true;
            if (!Array.isArray(rows)) {
                // Plan B acotado: conserva el límite y ordena por la PK, nunca descarga todo el payload.
                rows = await cloudFetchOrderSummaries(`&order=id.desc&limit=${HIST_FETCH_PAGE}&offset=${st.offset}${filters}`, { force: !!force });
                paged = false;
            }
            if (token !== st.token) return false; // llegó una consulta más nueva
            st.loading = false;
            if (!Array.isArray(rows)) return false;
            mergeOrderSummariesIntoList(rows);
            st.offset += rows.length;
            st.hasMore = paged && rows.length === HIST_FETCH_PAGE;
            return true;
        }
        function historyFiltersChanged() {
            historyPager.page = 1;
            renderHistoryModule(); // respuesta inmediata con lo ya cargado
            clearTimeout(historyState.timer);
            historyState.timer = setTimeout(async () => {
                const ok = await fetchHistoryPage(true);
                if (ok) renderHistoryModule();
            }, 320);
        }

        // ----- Paginador de tablas por DATOS (solo se pintan las filas de la página actual) -----
        const PAGER_ROWS = 15;
        const pagerHandlers = Object.create(null);
        function updatePager(tbodyId, info) {
            const body = document.getElementById(tbodyId);
            if (!body) return;
            const host = body.closest('.overflow-x-auto') || body.parentElement;
            let c = document.getElementById(tbodyId + '-pagination');
            if (!c) {
                c = document.createElement('div');
                c.className = 'client-pagination';
                c.id = tbodyId + '-pagination';
                c.setAttribute('aria-label', 'Paginación de resultados');
                c.innerHTML = '<span class="pagination-meta" data-pg-meta></span><div class="pagination-controls"><button type="button" data-pg-prev>Anterior</button><span class="pagination-page" data-pg-page></span><button type="button" data-pg-next>Siguiente</button></div>';
                host.insertAdjacentElement('afterend', c);
                c.querySelector('[data-pg-prev]').addEventListener('click', () => pagerHandlers[tbodyId] && pagerHandlers[tbodyId].prev());
                c.querySelector('[data-pg-next]').addEventListener('click', () => pagerHandlers[tbodyId] && pagerHandlers[tbodyId].next());
            }
            pagerHandlers[tbodyId] = { prev: info.onPrev, next: info.onNext };
            c.querySelector('[data-pg-meta]').textContent = info.meta;
            c.querySelector('[data-pg-page]').textContent = `Página ${info.page} / ${info.pages}`;
            c.querySelector('[data-pg-prev]').disabled = info.page <= 1;
            c.querySelector('[data-pg-next]').disabled = !info.hasNext;
        }
        const historyPager = { page: 1 };
        const equipmentPager = { page: 1, sig: '' };

        // Devuelve true si algún módulo local fue reemplazado por una versión más nueva de la nube.
        async function loadCloudStateKeys(keys, force) {
            let cambioEstado = false;
            if (keys && keys.some(k => ESTADO_TABLAS[k]) && !estadoCtl.disabled) {
                cambioEstado = await estadoPullKeys(keys.filter(k => ESTADO_TABLAS[k]), !force);
                if (!estadoCtl.disabled) keys = keys.filter(k => !ESTADO_TABLAS[k]);
            }
            if (!keys || !keys.length || cloudStateCtl.disabled || !navigator.onLine) return cambioEstado;
            if (!(await cloudStateProbe())) return false;
            const filter = keys.map(k => encodeURIComponent(cloudCleanId(k))).join(',');
            const rows = await supabaseFetch('hvac_app_state?select=id,payload&id=in.(' + filter + ')', 'GET', null, null, { quiet: true });
            if (!Array.isArray(rows)) return false;
            const byId = {};
            rows.forEach(row => { if (row && row.payload) byId[row.id] = row.payload; });
            let changed = false;
            cloudStateCtl.muted = true;
            try {
                keys.forEach(key => {
                    const payload = byId[cloudCleanId(key)];
                    if (!payload || typeof payload.data !== 'string') return;
                    const localTs = Number(localStorage.getItem('HVAC_TS_' + key)) || 0;
                    const hasPendingLocalWrite = key === HVAC_UI_SETTINGS_KEY && cloudOutboxRead().some(entry =>
                        entry && entry.table === 'hvac_app_state' && String(entry.id) === cloudCleanId(key) && entry.op !== 'delete');
                    // Esta preferencia es global: no se conserva una preferencia vieja de otro administrador.
                    // Solo se respeta la copia local cuando tiene una escritura propia aún pendiente de sincronizar.
                    if (!localStorage.getItem(key) || Number(payload.updatedAt || 0) > localTs || (key === HVAC_UI_SETTINGS_KEY && !hasPendingLocalWrite)) {
                        localStorage.setItem(key, payload.data);
                        localStorage.setItem('HVAC_TS_' + key, String(payload.updatedAt || Date.now()));
                        changed = true;
                    }
                });
                if (keys.includes(HVAC_UI_SETTINGS_KEY)) {
                    const sharedRow = byId[cloudCleanId(HVAC_UI_SETTINGS_KEY)];
                    localStorage.setItem(HVAC_UI_SETTINGS_REMOTE_EXISTS_KEY, sharedRow && typeof sharedRow.data === 'string' ? '1' : '0');
                    const previousSync = Number(localStorage.getItem(HVAC_UI_SETTINGS_SYNC_AT_KEY)) || 0;
                    localStorage.setItem(HVAC_UI_SETTINGS_SYNC_AT_KEY, String(Math.max(Date.now(), previousSync + 1)));
                }
            } finally { cloudStateCtl.muted = false; }
            return changed || cambioEstado;
        }

        // Login: única consulta previa al ingreso (tabla de usuarios, muy liviana).
        async function refreshUsersFromCloud() {
            if (!navigator.onLine) return false;
            const records = await cloudFetchTable('hvac_users');
            if (!records || !records.length) return false;
            systemUsers = tombFilter('hvac_users', records);
            cloudReconcileOutbox();
            localStorage.setItem('HVAC_USERS_BACKUP', JSON.stringify(systemUsers));
            return true;
        }

        window.loadCloudSection = async function (tabId, force = false) {
            if (!restoreActiveSession()) return;
            const cfg = CLOUD_SECTION_CONFIG[tabId];
            if (!cfg) return;
            if (!force && cloudSectionsLoaded.has(tabId)) {
                const stale = (cfg.tables || []).some(table => cloudTableStale(table));
                const sharedSettingsStale = (cfg.state || []).includes(HVAC_UI_SETTINGS_KEY) &&
                    (Date.now() - (Number(localStorage.getItem(HVAC_UI_SETTINGS_SYNC_AT_KEY)) || 0) > 30000);
                if (!stale && !sharedSettingsStale) return;
                cloudSectionsLoaded.delete(tabId);
            }
            if (cloudSectionsInFlight[tabId]) {
                const running = cloudSectionsInFlight[tabId];
                if (!force) return running;
                // Esperar la carga anterior y ejecutar después la revalidación forzada.
                try { await running; } catch (_) {}
                if (cloudSectionsInFlight[tabId] === running) delete cloudSectionsInFlight[tabId];
            }
            const section = document.getElementById('view-' + tabId);
            if (!section || section.classList.contains('hidden')) return;
            sectionLoadingUI(tabId, 'loading', 'Cargando datos de esta sección…');
            const task = (async () => {
                const failed = [];
                let fetched = false;
                try {
                    await hvacStorageReady;
                    if (navigator.onLine) {
                        if (cloudOutboxRead().length) await cloudFlushOutbox(); // primero se envían los cambios pendientes
                        const stale = cfg.tables.filter(table => force || cloudTableStale(table));
                        const results = await Promise.all(stale.map(async table => ({ table, records: await cloudFetchTable(table, force) })));
                        results.forEach(({ table, records }) => {
                            if (!records) { failed.push(table); return; }
                            cloudTableFetchedAt[table] = Date.now();
                            if (table === 'hvac_users' && !records.length) return;
                            records = tombFilter(table, records);        // lo borrado no se re-inserta
                            if (table === 'hvac_orders') mergeOrderSummariesIntoList(records, true);
                            else CLOUD_TABLE_TARGETS[table].set(records);
                        });
                        cloudReconcileOutbox(); // reaplica lo que aún no confirmó la nube
                        results.forEach(({ table }) => {
                            if (failed.indexOf(table) !== -1) return;
                            const t = CLOUD_TABLE_TARGETS[table];
                            localStorage.setItem(t.backup, JSON.stringify(t.get()));
                        });
                        if (await loadCloudStateKeys(cfg.state, force)) restoreLocalAppData();
                        if (cfg.equipmentsProgressive && (force || cloudTableStale('hvac_equipments'))) {
                            if (!(await loadEquipmentsProgressive(tabId))) failed.push('hvac_equipments');
                        }
                        if (cfg.historyPage && !(await fetchHistoryPage(true, force))) failed.push('hvac_orders');
                        fetched = true;
                    }
                    if (section.isConnected && !section.classList.contains('hidden')) renderSection(tabId);
                    if (failed.length) {
                        cloudReport(false, cloudCtl.lastStatus || 'offline', failed.join(', '), 'GET', failed[0]);
                        sectionLoadingUI(tabId, 'error', 'No se pudieron actualizar algunos datos desde la nube. Se muestran los guardados en este dispositivo.');
                    } else {
                        if (fetched) cloudSectionsLoaded.add(tabId);
                        sectionLoadingUI(tabId, 'hide');
                    }
                } catch (err) {
                    console.warn('[Supabase] Carga modular fallida (' + tabId + '):', err);
                    sectionLoadingUI(tabId, 'error', 'No se pudieron actualizar los datos. Los datos locales siguen disponibles.');
                } finally {
                    delete cloudSectionsInFlight[tabId];
                }
            })();
            cloudSectionsInFlight[tabId] = task;
            return task;
        };

        // Sincronización explícita del administrador: fuerza la consulta remota de la sección
        // visible, invalida resúmenes y avance, y repinta la vista al terminar.
        window.hvacAdminManualSync = async function (button) {
            if (!restoreActiveSession()) return;
            if (!navigator.onLine) {
                showToast('No hay conexión a internet. Los cambios locales se conservarán para sincronizar después.', 'error');
                return;
            }
            const active = document.querySelector('main > section[id^="view-"]:not(.hidden)');
            const tabId = active && active.id ? active.id.replace(/^view-/, '') : 'admin-dashboard';
            const cfg = CLOUD_SECTION_CONFIG[tabId];

            // Asistencia y GPS usa su propia consulta a la tabla `asistencia`;
            // no forma parte del cargador modular CLOUD_SECTION_CONFIG.
            // Por eso se sincroniza directamente mediante attLoad(), respetando filtros.
            if (tabId === 'admin-attendance') {
                const btn = button || document.getElementById('admin-manual-sync-btn');
                const original = btn ? btn.innerHTML : '';
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> <span>Actualizando…</span>';
                }
                try {
                    await hvacStorageReady;
                    if (cloudOutboxRead().length) await cloudFlushOutbox();
                    if (typeof attLoad !== 'function') throw new Error('No está disponible el módulo de Asistencia y GPS.');
                    const refreshed = await attLoad();
                    if (refreshed === false) {
                        showToast('No se pudieron consultar las marcaciones en Supabase. Se conservan los datos locales.', 'error');
                    } else {
                        showToast('Asistencia y GPS se actualizaron desde Supabase.', 'success');
                    }
                } catch (error) {
                    console.error('[Admin] Sincronización de Asistencia y GPS fallida:', error);
                    showToast('No se pudo actualizar Asistencia y GPS. Revisa la conexión y vuelve a intentar.', 'error');
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = original || '<i class="fa-solid fa-rotate"></i> <span>Sincronizar</span>';
                    }
                    cloudBadgeSchedule();
                }
                return;
            }

            if (!cfg) { showToast('No se pudo identificar la sección que deseas actualizar.', 'error'); return; }

            const btn = button || document.getElementById('admin-manual-sync-btn');
            const original = btn ? btn.innerHTML : '';
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> <span>Actualizando…</span>'; }
            sectionLoadingUI(tabId, 'loading', 'Sincronizando órdenes y datos con Supabase…');
            try {
                await hvacStorageReady;
                // Primero se envían operaciones locales pendientes; luego se leen los datos confirmados.
                if (cloudOutboxRead().length) await cloudFlushOutbox();
                hvacInvalidateOrderQueries();
                hvacProgressAttempt.clear();
                cloudSectionsLoaded.delete(tabId);

                await window.loadCloudSection(tabId, true);

                // El módulo histórico calcula el avance de las órdenes visibles aparte del listado.
                if (tabId === 'admin-history' && typeof hvacRefreshProgress === 'function') {
                    const visible = (historyState.lastPage || []).filter(Boolean);
                    if (visible.length) {
                        visible.forEach(o => hvacProgressCache.delete(String(o.id)));
                        const changed = await hvacRefreshProgress(visible);
                        if (changed) renderHistoryModule();
                    }
                }
                localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
                showToast('Sincronización finalizada. Las órdenes se actualizaron desde Supabase.', 'success');
            } catch (error) {
                console.error('[Admin] Sincronización manual fallida:', error);
                showToast('No se pudieron actualizar las órdenes. Se conservan los datos locales; revisa la conexión y vuelve a intentar.', 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = original || '<i class="fa-solid fa-rotate"></i> <span>Sincronizar</span>'; }
                cloudBadgeSchedule();
            }
        };

        window.addEventListener('offline', () => cloudBadgeSchedule());
        window.addEventListener('online', () => {
            cloudBadgeSchedule();
            showToast('Conexión recuperada. Sincronizando cambios guardados offline…');
            cloudFlushOutbox().catch(e => console.warn('[Offline] Reintento de cola fallido:', e));
            const active = document.querySelector('main > section:not(.hidden)');
            if (active && active.id) window.loadCloudSection(active.id.replace('view-', ''), true);
        });
        window.addEventListener('DOMContentLoaded', () => { // validación local de la clave, sin red
            setInterval(cloudBadgeRender, 5000);     // el indicador siempre refleja el estado real
            setInterval(cloudHealthTick, 20000);     // reintento automático de la bandeja de salida
            try { hvacStorageReady.then(cloudBadgeRender); } catch (_) { cloudBadgeRender(); }
            const problem = cloudKeyProblem();
            if (!problem) return;
            console.error('[Supabase] ' + problem);
            cloudCtl.keyProblem = problem;
            cloudBadgeRender();
            cloudCtl.lastToast = Date.now();
            try { showToast(problem, 'error'); } catch (_) {}
        });

        function clearStoredAuthSession() {
            activeUser = null;
            activeSessionRole = null;
            activeSessionExpiresAt = null;
            sessionAuthenticated = false;
            try { sessionStorage.removeItem(AUTH_SESSION_KEY); } catch (_) {}
            try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (_) {}
            try { localStorage.removeItem('HVAC_ACTIVE_USER_ADMIN'); } catch (_) {}
        }

        function restoreActiveSession() {
            if (sessionAuthenticated) {
                const currentUser = systemUsers.find(u => String(u.id) === String(activeUser));
                if (currentUser && currentUser.role === 'ADMIN' && (!activeSessionRole || currentUser.role === activeSessionRole) &&
                    activeSessionExpiresAt > Date.now()) return true;
                clearStoredAuthSession();
                return false;
            }

            let rawSession = null;
            let legacyUserId = null;
            try { rawSession = localStorage.getItem(AUTH_SESSION_KEY); } catch (_) {}
            if (!rawSession) { try { rawSession = sessionStorage.getItem(AUTH_SESSION_KEY); } catch (_) {} }
            try { legacyUserId = localStorage.getItem('HVAC_ACTIVE_USER_ADMIN'); } catch (_) {}
            if (!rawSession) {
                clearStoredAuthSession();
                return false;
            }

            try {
                const savedSession = JSON.parse(rawSession);
                const userId = savedSession && savedSession.userId;
                const expiresAt = Number(savedSession && savedSession.expiresAt);
                const user = systemUsers.find(u =>
                    String(u.id) === String(userId) && u.role === savedSession.role
                );
                if (!user || user.role !== 'ADMIN' || !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
                    (legacyUserId && String(legacyUserId) !== String(userId))) {
                    clearStoredAuthSession();
                    return false;
                }
                activeUser = user.id;
                activeSessionRole = user.role;
                activeSessionExpiresAt = expiresAt;
                sessionAuthenticated = true;
                return true;
            } catch (_) {
                clearStoredAuthSession();
                return false;
            }
        }

        function beginActiveSession(user) {
            activeUser = user.id;
            activeSessionRole = user.role;
            sessionAuthenticated = true;
            activeSessionExpiresAt = Date.now() + AUTH_SESSION_TTL;
            const savedSession = JSON.stringify({
                userId: user.id,
                role: user.role,
                expiresAt: activeSessionExpiresAt
            });
            try { localStorage.setItem('HVAC_ACTIVE_USER_ADMIN', user.id); } catch (_) {}
            try { localStorage.setItem(AUTH_SESSION_KEY, savedSession); } catch (e) {
                console.warn('[Auth] No se pudo guardar la sesión persistente:', e);
            }
            try { sessionStorage.setItem(AUTH_SESSION_KEY, savedSession); } catch (e) {
                console.warn('[Auth] No se pudo persistir la sesión de esta pestaña:', e);
            }
        }

        async function executeLogin() {
            const usernameInput = document.getElementById('login-username').value.trim().toLowerCase();
            const passwordInput = document.getElementById('login-password').value.trim();
            const errorBox = document.getElementById('login-error-msg');
            const errorText = document.getElementById('login-error-text');
            const mostrarError = msg => { errorBox.classList.remove('hidden'); errorText.innerText = msg; };

            if (authBloqueado()) return mostrarError('Demasiados intentos fallidos. Espera 30 segundos e inténtalo de nuevo.');

            try { await refreshUsersFromCloud(); } catch (e) { console.warn('[Login] Usuarios locales:', e); }

            let matchedUser = null;
            if (!systemUsers.length) {
                if (navigator.onLine === false) return mostrarError('No hay usuarios en este equipo. Conéctate a internet para el primer ingreso.');
                const enNube = await cloudFetchTable('hvac_users');
                if (!Array.isArray(enNube)) return mostrarError('No se pudo verificar los usuarios. Revisa tu conexión e inténtalo de nuevo.');
                if (enNube.length === 0) {
                    matchedUser = await authCrearAdminInicial();
                    if (!matchedUser) return mostrarError('No se creó el administrador inicial.');
                }
            }
            if (!matchedUser) {
                const candidato = systemUsers.find(u => u.username && u.username.toLowerCase() === usernameInput);
                const check = await authRevisarClave(candidato, passwordInput);
                if (check.changed) authGuardarUsuario(candidato, 'HVAC_USERS_BACKUP');
                if (!check.ok) { authFallo(); return mostrarError('Usuario o contraseña incorrectos.'); }
                authAcierto();
                matchedUser = candidato;
            }

            if (matchedUser.role !== 'ADMIN') {
                return mostrarError('Este panel es solo para administradores. Los técnicos deben usar la app de campo (tecnico.html).');
            }

            errorBox.classList.add('hidden');
            beginActiveSession(matchedUser);
            try { if (window.opsSessionLogin) await window.opsSessionLogin(matchedUser, passwordInput); } catch (_) {}
            document.getElementById('app-login-screen').classList.add('hidden');
            document.getElementById('header-role-badge').innerText = matchedUser.role;
            document.getElementById('header-user-welcome').innerText = matchedUser.name || matchedUser.username || '';

            updateSidebarLinks();
            switchTab('admin-dashboard');
            try { if (window.hvacSyncUser) window.hvacSyncUser(); } catch (e) {}
        }

        function logoutSession() {
            try { if (window.opsSessionLogout) window.opsSessionLogout(); } catch (_) {}
            clearStoredAuthSession();
            updateSidebarLinks();
            document.getElementById('header-user-welcome').innerText = '';
            document.getElementById('header-role-badge').innerText = '';
            document.getElementById('app-login-screen').classList.remove('hidden');
            document.getElementById('login-password').value = '';
            document.getElementById('login-error-msg').classList.add('hidden');
            toggleSidebar(false);
        }

        function toggleSidebar(show) {
            const drawer = document.getElementById('sidebar-drawer');
            const overlay = document.getElementById('sidebar-overlay');
            if (!drawer || !overlay) return;
            const mobile = window.matchMedia('(max-width: 1023.98px)').matches;
            if (show && mobile) {
                drawer.classList.remove('-translate-x-full');
                drawer.classList.add('sidebar-open');
                overlay.classList.add('sidebar-open');
                overlay.style.display = 'block';
                document.body.style.overflow = 'hidden';
            } else {
                drawer.classList.remove('sidebar-open');
                overlay.classList.remove('sidebar-open');
                overlay.style.display = 'none';
                document.body.style.overflow = '';
                // Conserva compatibilidad con el mecanismo anterior basado en Tailwind.
                drawer.classList.add('-translate-x-full');
            }
        }
        window.addEventListener('resize', () => {
            if (window.matchMedia('(min-width: 1024px)').matches) {
                const drawer = document.getElementById('sidebar-drawer');
                const overlay = document.getElementById('sidebar-overlay');
                if (drawer) drawer.classList.remove('sidebar-open');
                if (overlay) { overlay.classList.remove('sidebar-open'); overlay.style.display = 'none'; }
                document.body.style.overflow = '';
            }
        });

        const NAV_GESTION_TABS = ['admin-clients', 'admin-equipment', 'admin-users'];
        const NAV_NOMINA_TABS = ['admin-transports', 'admin-overtime'];
        const NAV_PLAN_TABS = ['admin-planning', 'admin-agenda'];
        let navGestionOpen = (() => { try { return sessionStorage.getItem('HVAC_NAV_GESTION') === '1'; } catch (_) { return false; } })();
        let navNominaOpen = (() => { try { return sessionStorage.getItem('HVAC_NAV_NOMINA') === '1'; } catch (_) { return false; } })();
        let navPlanOpen = (() => { try { return sessionStorage.getItem('HVAC_NAV_PLAN') === '1'; } catch (_) { return false; } })();

        function updateSidebarLinks() {
            const list = document.getElementById('sidebar-nav-list');
            list.innerHTML = '';
            const u = systemUsers.find(x => String(x.id) === String(activeUser));
            const settingsButton = document.getElementById('sidebar-settings-btn');
            if (settingsButton) settingsButton.classList.toggle('hidden', !(u && sessionAuthenticated && u.role === 'ADMIN'));
            if (!u || !sessionAuthenticated) return;

            const makeLink = (icon, label, tabId, highlight = false) => {
                const a = document.createElement('a');
                a.href = 'javascript:void(0)';
                a.dataset.tab = tabId;
                a.onclick = () => { switchTab(tabId); toggleSidebar(false); };
                a.className = `flex items-center gap-3 px-3.5 py-3 rounded-2xl font-bold text-xs transition ${highlight ? 'bg-teal-600 text-white shadow-lg shadow-teal-600/20' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`;
                a.innerHTML = `<i class="fa-solid ${icon} w-5 text-center text-sm"></i> <span>${label}</span>`;
                return a;
            };

            if (u.role === 'ADMIN') {
                const curSec = document.querySelector('main > section:not(.hidden)');
                const curTab = curSec ? curSec.id.replace('view-', '') : '';

                // Grupo desplegable "Gestión": Clientes · Equipos · Usuarios
                const groupOpen = navGestionOpen || NAV_GESTION_TABS.includes(curTab);
                const group = document.createElement('div');
                group.className = 'nav-group' + (groupOpen ? ' open' : '');
                group.innerHTML = `
                    <button type="button" class="nav-group-btn" aria-expanded="${groupOpen}" aria-controls="nav-sub-gestion">
                        <span class="ng-ico"><i class="fa-solid fa-layer-group"></i></span>
                        <span class="ng-label">Gestión</span>
                        <i class="fa-solid fa-chevron-down ng-chev"></i>
                    </button>
                    <div class="nav-sub" id="nav-sub-gestion"><div class="nav-sub-in"></div></div>`;
                const sub = group.querySelector('.nav-sub-in');
                sub.appendChild(makeLink('fa-users', 'Clientes', 'admin-clients'));
                sub.appendChild(makeLink('fa-screwdriver-wrench', 'Equipos', 'admin-equipment'));
                sub.appendChild(makeLink('fa-user-shield', 'Usuarios', 'admin-users'));
                group.querySelector('.nav-group-btn').onclick = function () {
                    const open = !group.classList.contains('open');
                    group.classList.toggle('open', open);
                    this.setAttribute('aria-expanded', String(open));
                    navGestionOpen = open;
                    try { sessionStorage.setItem('HVAC_NAV_GESTION', open ? '1' : '0'); } catch (_) {}
                };

                // Grupo desplegable "Planificación": Planificación + Agenda de Gestión
                const planOpen = navPlanOpen || NAV_PLAN_TABS.includes(curTab);
                const groupPlan = document.createElement('div');
                groupPlan.className = 'nav-group' + (planOpen ? ' open' : '');
                groupPlan.innerHTML = `
                    <button type="button" class="nav-group-btn" aria-expanded="${planOpen}" aria-controls="nav-sub-plan">
                        <span class="ng-ico"><i class="fa-solid fa-calendar-days"></i></span>
                        <span class="ng-label">Planificación</span>
                        <i class="fa-solid fa-chevron-down ng-chev"></i>
                    </button>
                    <div class="nav-sub" id="nav-sub-plan"><div class="nav-sub-in"></div></div>`;
                const subPlan = groupPlan.querySelector('.nav-sub-in');
                subPlan.appendChild(makeLink('fa-calendar-plus', 'Programación', 'admin-planning'));
                subPlan.appendChild(makeLink('fa-clipboard-list', 'Agenda de Gestión', 'admin-agenda'));
                groupPlan.querySelector('.nav-group-btn').onclick = function () {
                    const open = !groupPlan.classList.contains('open');
                    groupPlan.classList.toggle('open', open);
                    this.setAttribute('aria-expanded', String(open));
                    navPlanOpen = open;
                    try { sessionStorage.setItem('HVAC_NAV_PLAN', open ? '1' : '0'); } catch (_) {}
                };

                // Grupo desplegable "Nómina Operativa": Transportes · Horas Extras
                const nominaOpen = navNominaOpen || NAV_NOMINA_TABS.includes(curTab);
                const groupNomina = document.createElement('div');
                groupNomina.className = 'nav-group' + (nominaOpen ? ' open' : '');
                groupNomina.innerHTML = `
                    <button type="button" class="nav-group-btn" aria-expanded="${nominaOpen}" aria-controls="nav-sub-nomina">
                        <span class="ng-ico"><i class="fa-solid fa-people-arrows"></i></span>
                        <span class="ng-label">Nómina Operativa</span>
                        <i class="fa-solid fa-chevron-down ng-chev"></i>
                    </button>
                    <div class="nav-sub" id="nav-sub-nomina"><div class="nav-sub-in"></div></div>`;
                const subNomina = groupNomina.querySelector('.nav-sub-in');
                subNomina.appendChild(makeLink('fa-route', 'Transportes', 'admin-transports'));
                subNomina.appendChild(makeLink('fa-user-clock', 'Horas Extras', 'admin-overtime'));
                groupNomina.querySelector('.nav-group-btn').onclick = function () {
                    const open = !groupNomina.classList.contains('open');
                    groupNomina.classList.toggle('open', open);
                    this.setAttribute('aria-expanded', String(open));
                    navNominaOpen = open;
                    try { sessionStorage.setItem('HVAC_NAV_NOMINA', open ? '1' : '0'); } catch (_) {}
                };

                // Recogida de Herramientas: ítem suelto (con badge)
                const toolsLink = makeLink('fa-toolbox', 'Recogida de Herramientas', 'admin-tools');
                toolsLink.insertAdjacentHTML('beforeend', '<span id="nav-tools-badge" class="ml-auto hidden bg-amber-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">0</span>');

                list.appendChild(makeLink('fa-chart-pie', 'Panel Principal', 'admin-dashboard'));
                list.appendChild(group);
                list.appendChild(groupPlan);
                list.appendChild(makeLink('fa-wallet', 'Caja Menor', 'admin-caja'));
                list.appendChild(makeLink('fa-clock-rotate-left', 'Histórico & Avance', 'admin-history'));
                list.appendChild(makeLink('fa-location-crosshairs', 'Asistencia & GPS', 'admin-attendance'));
                list.appendChild(toolsLink);
                list.appendChild(groupNomina);
                list.appendChild(makeLink('fa-file-invoice-dollar', 'Facturación', 'admin-billing'));
                list.appendChild(makeLink('fa-chart-line', 'Finanzas', 'admin-financial'));
                if (typeof hvacUpdateToolsBadge === 'function') hvacUpdateToolsBadge();
            }
        }

        function switchTab(tabId) {
            if (!restoreActiveSession()) {
                document.getElementById('header-user-welcome').innerText = '';
                document.getElementById('header-role-badge').innerText = '';
                updateSidebarLinks();
                document.getElementById('app-login-screen').classList.remove('hidden');
                return;
            }
            const user = systemUsers.find(x => String(x.id) === String(activeUser));
            if (!user) {
                clearStoredAuthSession();
                document.getElementById('app-login-screen').classList.remove('hidden');
                return;
            }
            if (user.role !== 'ADMIN') {
                clearStoredAuthSession();
                updateSidebarLinks();
                document.getElementById('app-login-screen').classList.remove('hidden');
                return;
            }
            document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
            const target = document.getElementById(`view-${tabId}`);
            const settingsButton = document.getElementById('sidebar-settings-btn');
            if (settingsButton) settingsButton.classList.toggle('is-active', tabId === 'admin-settings');
            if (target) {
                target.classList.remove('hidden');
                renderSection(tabId); // pintado inmediato con la caché local
                // La nube se consulta únicamente cuando se entra al módulo solicitado.
                if (typeof window.loadCloudSection === 'function') window.loadCloudSection(tabId);
            }
        }

        function openFormulariosModal() {
            document.getElementById('formularios-modal-backdrop').classList.remove('hidden');
            renderFormulariosList();
        }

        function closeFormulariosModal() {
            document.getElementById('formularios-modal-backdrop').classList.add('hidden');
        }

        function renderFormulariosList() {
            const container = document.getElementById('formularios-list-container');
            container.innerHTML = '';
            const types = [...new Set([...Object.keys(equipmentFormsConfig), ...equipmentCatalog.map(e => (e.type || 'General').toUpperCase())])];

            types.forEach(typeName => {
                const cfg = equipmentFormsConfig[typeName] || {
                    name: typeName,
                    params: "Voltaje (V), Amperaje (A)",
                    checklist: "Limpieza general\nRevisión eléctrica"
                };

                container.insertAdjacentHTML('beforeend', `
                    <div class="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-center justify-between shadow-sm">
                        <div>
                            <span class="font-black text-xs text-purple-900 bg-purple-100 px-2.5 py-1 rounded-lg">${esc(cfg.name)}</span>
                            <p class="text-[11px] text-slate-500 mt-1">Parámetros: ${esc(cfg.params)}</p>
                        </div>
                        <button onclick="openFormTypeEditorModal('${escJs(cfg.name)}')" class="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs px-3 py-2 rounded-xl transition shadow-sm">
                            <i class="fa-solid fa-pen"></i> Editar Formulario
                        </button>
                    </div>
                `);
            });
        }

        function openNewFormTypeModal() {
            document.getElementById('ft-modal-title').innerText = "Crear Nuevo Formulario por Tipo de Equipo";
            document.getElementById('ft-f-old-name').value = '';
            document.getElementById('ft-f-name').value = '';
            document.getElementById('ft-f-params').value = "Voltaje (V), Amperaje (A), Presión Succión (PSI), Presión Descarga (PSI)";
            document.getElementById('ft-f-checklist').value = "Limpieza de Filtros de Aire\nLavado de Serpentín Evaporador\nLavado de Serpentín Condensador\nLimpieza de Bandeja y Desagüe\nAjuste de Bornes Eléctricos\nVerificación de Presiones y Gas";
            document.getElementById('form-type-editor-modal-backdrop').classList.remove('hidden');
        }

        function openFormTypeEditorModal(typeName) {
            const cfg = equipmentFormsConfig[typeName] || { name: typeName, params: "", checklist: "" };
            document.getElementById('ft-modal-title').innerText = `Editar Formulario: ${typeName}`;
            document.getElementById('ft-f-old-name').value = typeName;
            document.getElementById('ft-f-name').value = cfg.name;
            document.getElementById('ft-f-params').value = cfg.params;
            document.getElementById('ft-f-checklist').value = cfg.checklist;
            document.getElementById('form-type-editor-modal-backdrop').classList.remove('hidden');
        }

        function closeFormTypeEditorModal() {
            document.getElementById('form-type-editor-modal-backdrop').classList.add('hidden');
        }

        function saveFormTypeRecord() {
            const oldName = document.getElementById('ft-f-old-name').value.trim().toUpperCase();
            const name = document.getElementById('ft-f-name').value.trim().toUpperCase();
            const params = document.getElementById('ft-f-params').value.trim();
            const checklist = document.getElementById('ft-f-checklist').value.trim();

            if (!name) return showToast("El nombre del tipo de equipo es obligatorio.", "error");

            if (oldName && oldName !== name) {
                delete equipmentFormsConfig[oldName];
            }

            equipmentFormsConfig[name] = { name, params, checklist };
            localStorage.setItem('HVAC_FORMS_CONFIG_BACKUP', JSON.stringify(equipmentFormsConfig));

            closeFormTypeEditorModal();
            renderFormulariosList();
            showToast(`Formulario para '${name}' guardado correctamente.`);
        }

        function getClientCostCenterName(client) {
            return client ? String(client.name || '') : '';
        }

        function getClientCostCenterNumber(client) {
            return client ? String(client.costCenterNumber || client.costCenterCode || client.costCenter || '') : '';
        }

        function getClientCostCenterLabel(client) {
            if (!client) return 'Sin centro de costo';
            const name = getClientCostCenterName(client);
            const number = getClientCostCenterNumber(client);
            return [name, number].filter(Boolean).join(' · ') || 'Sin centro de costo';
        }

        function getCajaClient(item) {
            if (!item) return null;
            return clientsCatalog.find(c => String(c.id) === String(item.clientId)) ||
                clientsCatalog.find(c => c.name === (item.clientName || item.client)) || null;
        }

        // Finanzas: solo clientes oficiales del directorio que tengan al menos una factura numerada.
        // No se toman nombres sueltos de equipos, órdenes antiguas ni registros huérfanos.
        function hvacFinancialOrderClientName(order) {
            if (!order) return '';
            const byId = order.clientId != null
                ? clientsCatalog.find(c => c && String(c.id) === String(order.clientId))
                : null;
            const record = byId || findClientRecord(order.client || order.clientName || '');
            return record && record.name ? record.name : cleanSpaces(order.client || order.clientName || '');
        }

        function getFinancialInvoiceClientNames() {
            const found = new Map();
            const addInvoiceClient = source => {
                if (!source) return;
                let client = null;
                if (source.clientId != null && source.clientId !== '') {
                    client = clientsCatalog.find(c => c && String(c.id) === String(source.clientId)) || null;
                }
                if (!client) client = findClientRecord(source.client || source.clientName || '');
                if (!client || !cleanSpaces(client.name)) return; // sin registro oficial = no mostrar
                const name = cleanSpaces(client.name), key = normText(name);
                if (key && !found.has(key)) found.set(key, name);
            };
            (workOrders || []).forEach(order => {
                const invoice = order && order.invoice;
                if (String(order && order.status || '').toUpperCase() === 'BILLED' && invoice && String(invoice.number || '').trim()) {
                    addInvoiceClient(order);
                }
            });
            (typeof hvacManualInvoicesRead === 'function' ? hvacManualInvoicesRead() : []).forEach(item => {
                const invoice = item && item.invoice;
                if (invoice && String(invoice.number || '').trim()) addInvoiceClient(item);
            });
            return [...found.values()].sort(compareClientNames);
        }

        function populateFinancialClientDropdown() {
            const el = document.getElementById('fin-filter-client');
            if (!el) return;
            const prev = el.value || 'ALL';
            const groups = new Map();
            getFinancialInvoiceClientNames().forEach(name => {
                const key = clientRootKey(name);
                if (key && !groups.has(key)) groups.set(key, clientRootLabel(name));
            });
            const options = [...groups.entries()]
                .sort((a, b) => compareClientNames(a[1], b[1]))
                .map(([key, label]) => `<option value="${corrEsc(key)}">${corrEsc(label)}</option>`).join('');
            el.innerHTML = '<option value="ALL">Todos</option>' + options;
            el.value = [...el.options].some(option => option.value === prev) ? prev : 'ALL';
        }

        function populateClientDropdowns() {
            const filterIds = ['dash-filter-client', 'hist-filter-client']; // Finanzas tiene una lista propia basada solo en facturas numeradas.
            const formIds = ['nr-client', 'ag-f-client'];
            const names = getCanonicalClientNames();

            // Filtros generales: agrupados por raíz ("Jocol piso 16" y "Jocol piso 3" → "Jocol")
            const groups = new Map();
            names.forEach(n => { const k = clientRootKey(n); if (k && !groups.has(k)) groups.set(k, clientRootLabel(n)); });
            const filterOptions = [...groups.entries()].map(([k, label]) => `<option value="${corrEsc(k)}">${corrEsc(label)}</option>`).join('');
            // Formularios (rutina / agenda): solo clientes oficiales activos de hvac_clients.
            const officialNames = getOfficialClientNames();
            const activeNames = getActiveOfficialClientNames();
            const formOptions = activeNames.map(n => `<option value="${corrEsc(n)}">${corrEsc(n)}</option>`).join('');

            const fill = (id, head, options) => {
                const el = document.getElementById(id);
                if (!el) return;
                const prev = el.value;
                el.innerHTML = head + options;
                if (prev && Array.from(el.options).some(o => o.value === prev)) el.value = prev;
            };
            filterIds.forEach(id => fill(id, '<option value="ALL">Todos los Clientes</option>', filterOptions));
            populateFinancialClientDropdown();
            formIds.forEach(id => fill(id, '<option value="">-- Selecciona un Cliente --</option>', formOptions));
            // Histórico: el filtro solo muestra los clientes del directorio (Gestión de Clientes), agrupados por raíz.
            if (officialNames.length) {
                const histGroups = new Map();
                officialNames.forEach(n => { const k = clientRootKey(n); if (k && !histGroups.has(k)) histGroups.set(k, clientRootLabel(n)); });
                fill('hist-filter-client', '<option value="ALL">Todos los Clientes</option>',
                    [...histGroups.entries()].map(([k, label]) => `<option value="${corrEsc(k)}">${corrEsc(label)}</option>`).join(''));
            }
            populateCajaClientDropdown();
            syncEquipmentClientSelectors(true);
        }

        // Vuelve a leer hvac_clients en Supabase y reemplaza clientsCatalog. Sin conexión o si falla, conserva la lista actual.
        async function hvacRefreshOfficialClients() {
            if (navigator.onLine === false) return false;
            try {
                const rows = await supabaseFetch('hvac_clients?select=id,payload', 'GET', null, null, { quiet: true });
                if (!Array.isArray(rows)) return false;
                clientsCatalog = rows.filter(r => r && r.payload && String(r.payload.name || '').trim()).map(r => ({ ...r.payload, id: r.payload.id || r.id }));
                try { localStorage.setItem('HVAC_CLIENTS_BACKUP', JSON.stringify(clientsCatalog)); } catch (e) {}
                return true;
            } catch (e) { console.warn('[Clientes] No se pudo refrescar hvac_clients', e); return false; }
        }
        // Clientes OFICIALES = únicamente los del módulo "Gestión de Clientes" (sin nombres sueltos de equipos u órdenes antiguas)
        function getOfficialClientNames() {
            const seen = new Map();
            clientsCatalog.forEach(c => { const n = cleanSpaces(c && c.name), k = normText(n); if (k && !seen.has(k)) seen.set(k, n); });
            return [...seen.values()].sort(compareClientNames);
        }
        let eqClientSelSig = '';
        // Reconstruye filtro y selector del catálogo de equipos; solo toca el DOM si cambió la lista oficial
        function syncEquipmentClientSelectors(force) {
            const names = getActiveOfficialClientNames();
            const sig = names.map(normText).join('|');
            const f = document.getElementById('eq-filter-client'), fm = document.getElementById('eq-f-client');
            if (!force && sig === eqClientSelSig && f && f.options.length) return;
            eqClientSelSig = sig;
            if (f) {
                const prev = f.value, groups = new Map();
                names.forEach(n => { const k = clientRootKey(n); if (k && !groups.has(k)) groups.set(k, clientRootLabel(n)); });
                f.innerHTML = '<option value="ALL">Todos los Clientes</option>' + [...groups.entries()].map(([k, l]) => `<option value="${corrEsc(k)}">${corrEsc(l)}</option>`).join('');
                f.value = Array.from(f.options).some(o => o.value === prev) ? prev : 'ALL';
            }
            if (fm) {
                const prev = fm.value;
                fm.innerHTML = '<option value="">-- Selecciona un Cliente --</option>' + names.map(n => `<option value="${corrEsc(n)}">${corrEsc(n)}</option>`).join('');
                if (prev && Array.from(fm.options).some(o => o.value === prev)) fm.value = prev;
            }
        }

        function populateCajaClientDropdown(selectedId = '') {
            const el = document.getElementById('caja-f-client');
            if (!el) return;
            const prev = selectedId || el.value;
            const options = getSortedClientRecords().map(client =>
                `<option value="${esc(client.id)}">${esc(client.name)}</option>`
            ).join('');
            el.innerHTML = '<option value="">-- Selecciona un Cliente --</option>' + options;
            if (prev && Array.from(el.options).some(option => option.value === String(prev))) el.value = String(prev);
        }

        function handleCajaClientChange() {
            const client = clientsCatalog.find(c => String(c.id) === String(document.getElementById('caja-f-client').value));
            document.getElementById('caja-f-cost-center-name').innerText = getClientCostCenterName(client) || 'Es el nombre del cliente seleccionado';
            document.getElementById('caja-f-cost-center-number').value = getClientCostCenterNumber(client);
        }

        function techPickerValues(id) { const el = document.getElementById(id); return el ? [...el.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value) : []; }
        function populateTechDropdown() {
            ['sch-tech', 'nr-tech', 'sch-agenda-tech'].forEach(id => {
                const el = document.getElementById(id); if (!el) return;
                const prev = new Set(techPickerValues(id)), techs = systemUsers.filter(u => u.role === 'TECH');
                el.innerHTML = techs.length ? techs.map(u => `<label class="tech-opt"><input type="checkbox" value="${esc(u.name)}" ${prev.has(u.name) ? 'checked' : ''}><span>${esc(u.name)} <small>(@${esc(u.username)})</small></span></label>`).join('') : '<div class="text-xs text-slate-400 p-2">No hay técnicos registrados.</div>';
            });
        }
        // Una rutina puede tener varios técnicos: technicians (arreglo) + technician (texto "A, B" para compatibilidad)
        const orderTechs = o => (o && Array.isArray(o.technicians) && o.technicians.length) ? o.technicians : (o && o.technician ? [o.technician] : []);

        // Marca/desmarca SOLO los equipos visibles (los que pasan el filtro de zona actual).
        function toggleSelectAllCheckboxes(selector, btn) {
            const visible = Array.from(document.querySelectorAll(selector)).filter(cb => {
                const row = cb.closest('label');
                return !(row && row.style.display === 'none') && !cb.disabled;
            });
            if (!visible.length) return;
            const allChecked = visible.every(cb => cb.checked);
            visible.forEach(cb => cb.checked = !allChecked);
            hvacSyncSelectAllButtons();
        }
        // El texto de cada botón "Seleccionar todos" sigue el estado real de las casillas (no el último clic)
        function hvacSyncSelectAllButtons() {
            document.querySelectorAll('button[onclick*="toggleSelectAllCheckboxes("]').forEach(btn => {
                const m = /toggleSelectAllCheckboxes\('([^']+)'/.exec(btn.getAttribute('onclick') || '');
                if (!m) return;
                const visible = Array.from(document.querySelectorAll(m[1])).filter(cb => {
                    const row = cb.closest('label');
                    return !(row && row.style.display === 'none') && !cb.disabled;
                });
                const allChecked = visible.length > 0 && visible.every(cb => cb.checked);
                const html = allChecked ? '<i class="fa-solid fa-xmark mr-1"></i> Deseleccionar todos' : '<i class="fa-solid fa-check-double mr-1"></i> Seleccionar todos';
                if (btn.innerHTML !== html) btn.innerHTML = html;
            });
        }

        const DASH_ORDERS_PER_PAGE = 7;
        let dashOrdersRows = [];
        let dashOrdersPage = 1;

        function renderAdminDashboard() {
            const filterClient = document.getElementById('dash-filter-client').value || 'ALL';
            const filteredOrders = workOrders.filter(o => !String(o.id || '').startsWith('HIST-') && matchesClientFilter(o.client, filterClient));

            document.getElementById('kpi-dash-total').innerText = filteredOrders.length;
            document.getElementById('kpi-dash-prog').innerText = filteredOrders.filter(o => ['PENDING', 'IN_PROGRESS'].includes(hvacOrderState(o))).length;
            document.getElementById('kpi-dash-done').innerText = filteredOrders.filter(o => hvacOrderState(o) === 'COMPLETED').length;
            document.getElementById('kpi-dash-bill').innerText = filteredOrders.filter(o => hvacOrderState(o) === 'BILLED').length;

            const dashKey = o => String(o.createdAt || o.date || '');
            const dashSorted = [...filteredOrders].sort((x, y) => dashKey(y).localeCompare(dashKey(x)) || String(y.date || '').localeCompare(String(x.date || '')) || (prevParse(y.id) - prevParse(x.id)) || String(y.id).localeCompare(String(x.id)));
            dashOrdersRows = dashSorted;
            dashOrdersPage = Math.min(dashOrdersPage, Math.max(1, Math.ceil(dashSorted.length / DASH_ORDERS_PER_PAGE)));
            renderDashOrdersPage();
        }

        function renderDashOrdersPage() {
            const tbody = document.getElementById('dash-orders-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            const total = dashOrdersRows.length;
            const pages = Math.max(1, Math.ceil(total / DASH_ORDERS_PER_PAGE));
            dashOrdersPage = Math.min(Math.max(1, dashOrdersPage), pages);
            const from = (dashOrdersPage - 1) * DASH_ORDERS_PER_PAGE;
            dashOrdersRows.slice(from, from + DASH_ORDERS_PER_PAGE).forEach(o => {
                const statusBadge = hvacStateBadge(hvacOrderState(o)) + hvacToolChip(o);

                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td class="font-bold text-slate-900">${esc(o.id)}</td>
                    <td class="font-bold text-teal-700">${esc(o.client)}</td>
                    <td><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-semibold text-xs">${(o.equipmentIds || []).length} Equipos</span></td>
                    <td class="font-medium text-slate-600">${esc(o.technician || 'Sin asignar')}</td>
                    <td class="font-medium">${esc(o.date || '-')}</td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        <div class="flex items-center justify-end gap-1.5 flex-wrap">
                            <button onclick="openOrderHub('${escJs(o.id)}')" class="btn-teal text-xs py-1.5 px-3"><i class="fa-solid fa-folder-open"></i> Revisar</button>
                            <select id="hvac-report-type-${escJs(o.id)}" aria-label="Tipo de informe para ${esc(o.id)}" class="input-box text-xs" style="width:150px;min-width:130px;padding:6px 8px">
                                ${(() => { const rt = billingRoutineType(o); return [['REVISION','Revisión / Diagnóstico'],['PREVENTIVO','Mantenimiento preventivo'],['CORRECTIVO','Mantenimiento correctivo']].map(([v,l]) => `<option value="${v}"${v === rt ? ' selected' : ''}>${l}</option>`).join(''); })()}
                            </select>
                            <button onclick="hvacGenerateOrderReport('${escJs(o.id)}', document.getElementById('hvac-report-type-${escJs(o.id)}').value)" class="text-xs py-1.5 px-3 rounded-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white" title="Generar informe PDF"><i class="fa-solid fa-file-pdf"></i> Informe PDF</button>
                        </div>
                    </td>
                </tr>`);
            });
            if (!total) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-xs text-slate-400 py-6">No hay órdenes para mostrar.</td></tr>';
            const pager = document.getElementById('dash-orders-pager');
            if (pager) {
                const btn = (label, page, disabled) => `<button type="button" ${disabled ? 'disabled' : ''} onclick="dashOrdersGo(${page})" class="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50'}">${label}</button>`;
                pager.style.display = total > DASH_ORDERS_PER_PAGE ? '' : 'none';
                pager.innerHTML = `<span class="text-xs text-slate-500">${from + 1}–${Math.min(from + DASH_ORDERS_PER_PAGE, total)} de ${total} órdenes</span>
                    <div class="flex items-center gap-1.5">${btn('<i class="fa-solid fa-chevron-left"></i> Anterior', dashOrdersPage - 1, dashOrdersPage <= 1)}<span class="text-xs font-bold text-slate-700 px-1">Página ${dashOrdersPage} de ${pages}</span>${btn('Siguiente <i class="fa-solid fa-chevron-right"></i>', dashOrdersPage + 1, dashOrdersPage >= pages)}</div>`;
            }
        }
        function dashOrdersGo(page) { dashOrdersPage = page; renderDashOrdersPage(); }

        // ===== CORRECTIVOS AGRUPADOS POR CLIENTE =====
        let currentCorrClientItemId = null;

        function corrEsc(v) {
            return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }
        function corrPersist() {
            localStorage.setItem('HVAC_AGENDA_BACKUP', JSON.stringify(agendaItems));
        }
        function findOpenCorrItem(client) {
            return agendaItems.find(x => x.type === 'CORRECTIVO' && sameClient(x.client, client) && x.status !== 'Cerrado');
        }
        function corrRefreshItem(item) {
            const eqs = item.correctiveEquipments || [];
            const pend = eqs.filter(e => e.state === 'Pendiente').length;
            const rest = eqs.length - pend;
            item.description = `${pend} equipo(s) con correctivo pendiente` + (rest > 0 ? ` · ${rest} ya gestionado(s)` : '');
            item.date = new Date().toISOString().split('T')[0];
        }
        function corrAutoStatus(item) {
            const eqs = item.correctiveEquipments || [];
            if (!eqs.length) return;
            const pend = eqs.filter(e => e.state === 'Pendiente').length;
            const prog = eqs.filter(e => e.state === 'Programado').length;
            if (pend > 0) { if (item.status === 'Programado') item.status = 'Pendiente por gestionar'; }
            else item.status = prog > 0 ? 'Programado' : 'Cerrado';
        }

        // Llamada desde la captura del técnico: 1 ítem de agenda por cliente
        function syncClientCorrective(order, eq, corrective, correctiveDesc, reportedAt) {
            const client = order.client;
            const eqKey = (eq && eq.id) || currentExecEqId;
            let item = findOpenCorrItem(client);

            if (corrective) {
                if (!item) {
                    item = {
                        id: `AG-CORR-${Date.now()}`,
                        type: 'CORRECTIVO',
                        origin: 'Rutinas de mantenimiento',
                        client,
                        status: 'Pendiente por gestionar',
                        description: '',
                        date: new Date().toISOString().split('T')[0],
                        correctiveEquipments: []
                    };
                    agendaItems.push(item);
                }
                item.correctiveEquipments = item.correctiveEquipments || [];
                const data = {
                    eqKey,
                    code: eq ? eq.code : String(eqKey),
                    name: eq ? (eq.name || '') : '',
                    type: eq ? (eq.type || '') : '',
                    serial: eq ? (eq.serial || '') : '',
                    desc: correctiveDesc || 'Sin descripción',
                    orderId: order.id,
                    reportedAt: reportedAt || new Date().toISOString()
                };
                const idx = item.correctiveEquipments.findIndex(x => x.eqKey === eqKey);
                if (idx >= 0) {
                    const prev = item.correctiveEquipments[idx];
                    item.correctiveEquipments[idx] = { ...prev, ...data, state: prev.state === 'Resuelto' ? 'Pendiente' : prev.state };
                } else {
                    item.correctiveEquipments.push({ ...data, state: 'Pendiente' });
                }
            } else if (item) {
                // El técnico desmarcó el correctivo: se retira solo si aún está pendiente y viene de esta orden
                item.correctiveEquipments = (item.correctiveEquipments || []).filter(x => !(x.eqKey === eqKey && x.state === 'Pendiente' && x.orderId === order.id));
                if (item.correctiveEquipments.length === 0) {
                    agendaItems = agendaItems.filter(x => x !== item);
                    item = null;
                }
            }

            if (item) { corrRefreshItem(item); corrAutoStatus(item); }
            corrPersist();
        }

        // Convierte los ítems individuales antiguos (AG-CORR-...) en el ítem agrupado por cliente
        function migrateLegacyCorrectiveItems() {
            const legacy = agendaItems.filter(x => !x.type && String(x.id || '').startsWith('AG-CORR-') && x.status !== 'Cerrado');
            if (!legacy.length) return;
            legacy.forEach(old => {
                const m = String(old.description || '').match(/^\[Correctivo Equipo (.*?)\]\s*([\s\S]*)$/);
                const code = m ? m[1].trim() : '';
                const desc = m ? m[2].trim() : (old.description || 'Sin descripción');
                const om = String(old.origin || '').match(/Orden\s+(\S+)/);
                const eq = equipmentCatalog.find(e => e.code === code && sameClient(eqClientName(e), old.client)) || equipmentCatalog.find(e => e.code === code);
                let target = findOpenCorrItem(old.client);
                if (!target) {
                    target = {
                        id: `AG-CORR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        type: 'CORRECTIVO', origin: 'Rutinas de mantenimiento', client: old.client,
                        status: old.status || 'Pendiente por gestionar', description: '', date: old.date || '', correctiveEquipments: []
                    };
                    agendaItems.push(target);
                }
                const eqKey = (eq && eq.id) || code;
                if (!target.correctiveEquipments.some(x => x.eqKey === eqKey)) {
                    target.correctiveEquipments.push({
                        eqKey, code: code || String(eqKey), name: eq ? (eq.name || '') : '', type: eq ? (eq.type || '') : '',
                        serial: eq ? (eq.serial || '') : '', desc, orderId: om ? om[1] : '',
                        reportedAt: old.date || '', state: old.status === 'Programado' ? 'Programado' : 'Pendiente'
                    });
                }
                agendaItems = agendaItems.filter(x => x !== old);
                corrRefreshItem(target);
                corrAutoStatus(target);
            });
            corrPersist();
        }

        function renderAgendaModule() {
            const tbody = document.getElementById('agenda-table-body');
            if (!tbody) return;
            migrateLegacyCorrectiveItems();
            tbody.innerHTML = '';

            if (agendaItems.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400 font-medium">No hay elementos en la agenda de gestión actualmente.</td></tr>`;
                return;
            }

            agendaItems.forEach(item => {
                let badgeColor = 'bg-slate-100 text-slate-700';
                if (item.status === 'Pendiente por gestionar') badgeColor = 'bg-amber-50 text-amber-700 border border-amber-200';
                if (item.status === 'Propuesta enviada') badgeColor = 'bg-indigo-50 text-indigo-700 border border-indigo-200';
                if (item.status === 'Aprobado') badgeColor = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
                if (item.status === 'Programado') badgeColor = 'bg-purple-50 text-purple-700 border border-purple-200';
                if (item.status === 'Cerrado') badgeColor = 'bg-slate-100 text-slate-500';

                if (item.type === 'CORRECTIVO') {
                    const eqs = item.correctiveEquipments || [];
                    const pend = eqs.filter(e => e.state === 'Pendiente').length;
                    const tag = pend > 0
                        ? `<span class="inline-flex items-center gap-1.5 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 border border-amber-300 w-fit"><i class="fa-solid fa-triangle-exclamation"></i> CORRECTIVO PENDIENTE</span>`
                        : `<span class="inline-flex items-center gap-1.5 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 w-fit"><i class="fa-solid fa-check"></i> CORRECTIVO GESTIONADO</span>`;
                    tbody.insertAdjacentHTML('beforeend', `<tr class="cursor-pointer hover:bg-amber-50/40" onclick="openCorrectiveClientModal('${escJs(item.id)}')">
                        <td><div class="flex flex-col gap-1">${tag}<span class="font-mono text-[10px] text-slate-500">${corrEsc(item.id)} · ${esc(eqs.length)} equipo(s)</span></div></td>
                        <td class="font-bold text-slate-900">${corrEsc(item.client)}</td>
                        <td class="text-xs text-slate-700 max-w-xs truncate">${corrEsc(item.description)}</td>
                        <td class="text-xs text-slate-500">${esc(item.date || '-')}</td>
                        <td><span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${badgeColor}">${esc(item.status)}</span></td>
                        <td class="text-right">
                            <div class="inline-flex gap-1.5">
                                <button onclick="event.stopPropagation(); openCorrectiveClientModal('${escJs(item.id)}')" class="btn-teal text-xs py-1.5 px-3"><i class="fa-solid fa-list-check"></i> Ver equipos</button>
                                <button onclick="event.stopPropagation(); deleteAgendaItem('${escJs(item.id)}')" class="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>`);
                    return;
                }

                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td class="font-semibold text-xs text-slate-600">${esc(item.origin || 'Manual')}</td>
                    <td class="font-bold text-slate-900">${esc(item.client)}</td>
                    <td class="text-xs text-slate-700 max-w-xs truncate">${esc(item.description)}</td>
                    <td class="text-xs text-slate-500">${esc(item.date || '-')}</td>
                    <td><span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${badgeColor}">${esc(item.status)}</span></td>
                    <td class="text-right">
                        <div class="inline-flex gap-1.5">
                            ${item.status === 'Aprobado' ? `<button onclick="openScheduleAgendaModal('${escJs(item.id)}')" class="btn-teal text-xs py-1.5 px-3"><i class="fa-solid fa-calendar-plus"></i> Programar</button>` : ''}
                            <button onclick="openAgendaItemModal('${escJs(item.id)}')" class="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="deleteAgendaItem('${escJs(item.id)}')" class="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                </tr>`);
            });
        }

        // ----- Vista detallada del cliente -----
        function openCorrectiveClientModal(id) {
            const item = agendaItems.find(x => x.id === id);
            if (!item) return;
            currentCorrClientItemId = id;
            document.getElementById('corrective-client-modal-backdrop').classList.remove('hidden');
            renderCorrectiveClientModal();
        }

        function closeCorrectiveClientModal() {
            document.getElementById('corrective-client-modal-backdrop').classList.add('hidden');
            currentCorrClientItemId = null;
        }

        function renderCorrectiveClientModal() {
            const item = agendaItems.find(x => x.id === currentCorrClientItemId);
            if (!item) { closeCorrectiveClientModal(); return; }
            const eqs = item.correctiveEquipments || [];
            const pend = eqs.filter(e => e.state === 'Pendiente').length;
            const prog = eqs.filter(e => e.state === 'Programado').length;
            const res = eqs.filter(e => e.state === 'Resuelto').length;

            document.getElementById('corr-modal-client').innerText = item.client;
            document.getElementById('corr-modal-summary').innerText = `${eqs.length} equipo(s) reportados · ${pend} pendiente(s) · ${prog} programado(s) · ${res} resuelto(s)`;
            document.getElementById('corr-modal-status').value = item.status;
            document.getElementById('corr-modal-schedule-btn').classList.toggle('hidden', pend === 0);

            const list = document.getElementById('corr-modal-list');
            if (!eqs.length) {
                list.innerHTML = '<div class="text-center py-8 text-slate-400 font-medium text-xs bg-slate-50 rounded-2xl border border-slate-100">Este cliente no tiene equipos con correctivo registrados.</div>';
                return;
            }

            const stateStyle = {
                'Pendiente': 'bg-amber-50 text-amber-700 border border-amber-200',
                'Programado': 'bg-purple-50 text-purple-700 border border-purple-200',
                'Resuelto': 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            };

            list.innerHTML = eqs.map(p => {
                const cat = equipmentCatalog.find(e => e.id === p.eqKey || e.code === p.code) || {};
                const code = cat.code || p.code;
                const name = cat.name || p.name || '—';
                const serial = cat.serial || p.serial || '—';
                const reported = p.reportedAt ? String(p.reportedAt).split('T')[0] : '—';
                const key = corrEsc(p.eqKey);
                return `<div class="p-3.5 bg-white border border-slate-200/80 rounded-2xl shadow-sm">
                    <div class="flex items-start gap-3">
                        ${p.state === 'Pendiente' ? `<input type="checkbox" value="${esc(key)}" class="corr-eq-checkbox rounded text-teal-600 w-4 h-4 mt-1" checked>` : '<span class="w-4"></span>'}
                        <div class="flex-1 min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-mono font-black text-slate-900 text-xs bg-slate-100 px-2 py-0.5 rounded-md">${corrEsc(code)}</span>
                                <span class="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full ${stateStyle[p.state] || stateStyle['Pendiente']}">${corrEsc(p.state)}</span>
                            </div>
                            <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
                                <p><strong class="text-slate-800">Nombre:</strong> ${corrEsc(name)}</p>
                                <p><strong class="text-slate-800">Serial:</strong> ${corrEsc(serial)}</p>
                                <p><strong class="text-slate-800">Orden origen:</strong> ${corrEsc(p.orderId || '—')}</p>
                                <p><strong class="text-slate-800">Reportado:</strong> ${corrEsc(reported)}</p>
                                ${p.scheduledOrderId ? `<p class="sm:col-span-2"><strong class="text-slate-800">Orden correctiva:</strong> ${corrEsc(p.scheduledOrderId)} (${corrEsc(p.scheduledDate || '')})</p>` : ''}
                            </div>
                            <p class="text-xs text-amber-800 font-medium mt-2 bg-amber-50 p-2 rounded-xl border border-amber-200"><strong>Novedad:</strong> ${corrEsc(p.desc)}</p>
                        </div>
                        <div class="flex flex-col gap-1.5 shrink-0">
                            ${p.orderId && workOrders.some(o => o.id === p.orderId) ? `<button type="button" onclick="openOrderHub('${corrEsc(p.orderId)}')" class="px-2.5 py-1.5 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"><i class="fa-solid fa-folder-open"></i> Orden</button>` : ''}
                            ${p.state !== 'Resuelto' ? `<button type="button" onclick="resolveCorrectiveEquipment('${escJs(item.id)}', '${escJs(key)}')" class="px-2.5 py-1.5 text-[11px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg transition"><i class="fa-solid fa-check"></i> Resuelto</button>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        function resolveCorrectiveEquipment(itemId, eqKey) {
            const item = agendaItems.find(x => x.id === itemId);
            if (!item) return;
            const p = (item.correctiveEquipments || []).find(x => String(x.eqKey) === String(eqKey));
            if (!p) return;
            p.state = 'Resuelto';
            corrRefreshItem(item);
            corrAutoStatus(item);
            corrPersist();
            renderCorrectiveClientModal();
            renderAgendaModule();
            showToast(`Correctivo del equipo ${p.code} marcado como resuelto.`);
        }

        function saveCorrectiveStatus() {
            const item = agendaItems.find(x => x.id === currentCorrClientItemId);
            if (!item) return;
            item.status = document.getElementById('corr-modal-status').value;
            corrPersist();
            renderAgendaModule();
            showToast("Estado del pendiente actualizado.");
        }

        function scheduleSelectedCorrectives() {
            const item = agendaItems.find(x => x.id === currentCorrClientItemId);
            if (!item) return;
            const keys = Array.from(document.querySelectorAll('.corr-eq-checkbox:checked')).map(c => c.value);
            if (!keys.length) return showToast("Selecciona al menos un equipo pendiente para programar.", "error");
            openScheduleAgendaModal(item.id, keys);
        }

        async function openAgendaItemModal(id) {
            document.getElementById('agenda-item-modal-backdrop').classList.remove('hidden');
            populateClientDropdowns();
            if (await hvacRefreshOfficialClients()) populateClientDropdowns();   // lista siempre actual de hvac_clients
            if (id) {
                const item = agendaItems.find(x => x.id === id);
                document.getElementById('ag-modal-title').innerText = "Editar Ítem de Agenda";
                document.getElementById('ag-f-id').value = item.id;
                { const cs = document.getElementById('ag-f-client'); if (item.client && !Array.from(cs.options).some(o => o.value === item.client)) cs.insertAdjacentHTML('beforeend', `<option value="${esc(item.client)}">${esc(item.client)}</option>`); cs.value = item.client; }   // cliente ya no oficial: se conserva visible
                document.getElementById('ag-f-status').value = item.status;
                document.getElementById('ag-f-desc').value = item.description;
            } else {
                document.getElementById('ag-modal-title').innerText = "Nuevo Ítem en Agenda";
                document.getElementById('ag-f-id').value = '';
                document.getElementById('ag-f-client').value = '';
                document.getElementById('ag-f-status').value = 'Pendiente por gestionar';
                document.getElementById('ag-f-desc').value = '';
            }
        }

        function closeAgendaItemModal() {
            document.getElementById('agenda-item-modal-backdrop').classList.add('hidden');
        }

        function saveAgendaItemRecord() {
            const id = document.getElementById('ag-f-id').value || `AG-${Date.now()}`;
            const client = document.getElementById('ag-f-client').value;
            const status = document.getElementById('ag-f-status').value;
            const description = document.getElementById('ag-f-desc').value.trim();

            if (!client || !description) return showToast("Cliente y descripción son obligatorios.", "error");

            const itemObj = { id, origin: 'Manual (Administrador)', client, status, description, date: new Date().toISOString().split('T')[0] };
            const idx = agendaItems.findIndex(x => x.id === id);
            if (idx >= 0) agendaItems[idx] = { ...agendaItems[idx], ...itemObj };
            else agendaItems.push(itemObj);

            localStorage.setItem('HVAC_AGENDA_BACKUP', JSON.stringify(agendaItems));
            renderAgendaModule();
            closeAgendaItemModal();
            showToast("Agenda actualizada correctamente.");
        }

        function deleteAgendaItem(id) {
            const target = agendaItems.find(x => x.id === id);
            if (target && target.type === 'CORRECTIVO' && !confirm(`Se eliminará el pendiente de correctivos de ${target.client} con ${(target.correctiveEquipments || []).length} equipo(s). ¿Continuar?`)) return;
            agendaItems = agendaItems.filter(x => x.id !== id);
            localStorage.setItem('HVAC_AGENDA_BACKUP', JSON.stringify(agendaItems));
            renderAgendaModule();
            showToast("Ítem eliminado de la agenda.");
        }

        async function openScheduleAgendaModal(agendaId, preselectKeys) {
            const item = agendaItems.find(x => x.id === agendaId);
            if (!item) return;

            document.getElementById('schedule-agenda-modal-backdrop').classList.remove('hidden');
            document.getElementById('sch-agenda-id').value = item.id;
            document.getElementById('sch-agenda-client-display').value = item.client;
            document.getElementById('sch-agenda-date').value = new Date().toISOString().split('T')[0];
            populateTechDropdown();

            const container = document.getElementById('sch-agenda-equipments-picker');
            container.innerHTML = '';
            const isCorr = item.type === 'CORRECTIVO';
            const pre = (preselectKeys || []).map(String);
            let list;
            container.innerHTML = '<p class="text-slate-400 p-2 text-center text-xs">Cargando equipos del cliente…</p>';
            await ensureClientEquipments(item.client);
            if (isCorr) {
                const pendientes = (item.correctiveEquipments || []).filter(x => x.state === 'Pendiente');
                await ensureOrderEquipments({ equipmentIds: pendientes.map(x => x.eqKey).filter(Boolean) });
                list = pendientes
                    .map(x => equipmentCatalog.find(e => String(e.id) === String(x.eqKey)) ||
                        equipmentCatalog.find(e => (e.code === x.eqKey || e.code === x.code) && eqBelongsToClient(e, item.client)))
                    .filter(Boolean);
            } else {
                list = equipmentCatalog.filter(e => eqBelongsToClient(e, item.client));
            }
            container.innerHTML = '';

            if (list.length === 0) {
                container.innerHTML = '<p class="text-slate-400 p-2 text-center text-xs">Este cliente no tiene equipos registrados.</p>';
                return;
            }

            list.forEach(e => {
                container.insertAdjacentHTML('beforeend', `<label class="flex items-center gap-3 p-2 bg-white hover:bg-slate-100/70 rounded-xl cursor-pointer border border-slate-100 transition">
                    <input type="checkbox" value="${esc(e.id)}" class="sch-agenda-eq-checkbox rounded text-teal-600 w-4 h-4" ${isCorr && (!pre.length || pre.includes(String(e.id))) ? 'checked' : ''}>
                    <span class="font-mono font-bold text-slate-800 text-xs">${esc(e.code)}</span>
                    <span class="text-slate-500 text-xs font-medium">- ${esc(e.name || e.type || 'Sin nombre')} (${esc(eqClientName(e))})</span>
                </label>`);
            });
        }

        function closeScheduleAgendaModal() {
            document.getElementById('schedule-agenda-modal-backdrop').classList.add('hidden');
        }

        async function saveScheduleAgendaRoutine() {
            const agendaId = document.getElementById('sch-agenda-id').value;
            const item = agendaItems.find(x => x.id === agendaId);
            if (!item) return;

            const date = document.getElementById('sch-agenda-date').value;
            const technicians = techPickerValues('sch-agenda-tech'); const technician = technicians.join(', ');
            const checkboxes = document.querySelectorAll('.sch-agenda-eq-checkbox:checked');
            const equipmentIds = Array.from(checkboxes).map(c => c.value);

            if (!date || !technician) return showToast("Fecha y al menos un técnico son obligatorios.", "error");
            if (equipmentIds.length === 0) return showToast("Selecciona al menos un equipo.", "error");

            const orderId = item.type === 'CORRECTIVO' ? await reservePrevId('CORRECTIVO') : newUniqueId('ORD-IND', workOrders); // COR-0001 para correctivos
            const orderObj = { id: orderId, client: item.client, date, technician, technicians, equipmentIds, executions: {}, status: 'PENDING', clientSignature: null, invoice: null, createdAt: new Date().toISOString(), maintenanceType: item.type === 'CORRECTIVO' ? 'CORRECTIVO' : 'OTRO' };
            linkClientFields(orderObj, item.client);

            workOrders.push(orderObj);
            if (item.type === 'CORRECTIVO') {
                (item.correctiveEquipments || []).forEach(p => {
                    const matched = equipmentIds.some(id => id === p.eqKey || ((equipmentCatalog.find(e => e.id === id) || {}).code === p.code));
                    if (p.state === 'Pendiente' && matched) { p.state = 'Programado'; p.scheduledOrderId = orderId; p.scheduledDate = date; }
                });
                corrRefreshItem(item);
                corrAutoStatus(item);
            } else {
                item.status = 'Programado';
            }

            await cloudSaveOrder(orderObj);
            registrarAuditoria('CREAR', 'hvac_orders', orderObj.id);
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            localStorage.setItem('HVAC_AGENDA_BACKUP', JSON.stringify(agendaItems));

            renderAdminDashboard();
            renderAgendaModule();
            closeScheduleAgendaModal();
            if (currentCorrClientItemId) renderCorrectiveClientModal();
            showToast(`Orden independiente ${orderId} programada con éxito.`);
        }

        function ensureCajaConsecutiveIds() {
            let maxSequence = Math.max(0, parseInt(localStorage.getItem('HVAC_CAJA_SEQUENCE') || '0', 10) || 0);
            (cajaMenorItems || []).forEach(item => {
                const match = String(item.consecutiveId || '').match(/^CM-(\d+)$/);
                if (match) maxSequence = Math.max(maxSequence, parseInt(match[1], 10) || 0);
            });
            let changed = false;
            const seen = new Set();
            cajaMenorItems.forEach(item => {
                let match = String(item.consecutiveId || '').match(/^CM-(\d+)$/);
                if (!match || seen.has(item.consecutiveId)) {
                    maxSequence += 1;
                    item.consecutiveId = `CM-${String(maxSequence).padStart(3, '0')}`;
                    changed = true;
                }
                seen.add(item.consecutiveId);
                if (!item.clientName && item.client) { item.clientName = item.client; changed = true; }
                if (!item.clientName && item.relatedOrder) {
                    const linkedOrder = workOrders.find(order => String(order.id) === String(item.relatedOrder));
                    if (linkedOrder && linkedOrder.client) {
                        item.clientName = linkedOrder.client;
                        changed = true;
                    }
                }
                const linkedClient = getCajaClient(item);
                if (linkedClient) {
                    if (!item.clientId && linkedClient.id) { item.clientId = linkedClient.id; changed = true; }
                    if (!item.clientName) { item.clientName = linkedClient.name; changed = true; }
                    const name = getClientCostCenterName(linkedClient);
                    if (name && item.costCenterName !== name) { item.costCenterName = name; changed = true; }
                    if (!item.costCenterNumber) {
                        const number = getClientCostCenterNumber(linkedClient);
                        if (number) { item.costCenterNumber = number; changed = true; }
                    }
                }
                if (item.clientName && item.costCenterName !== item.clientName) {
                    item.costCenterName = item.clientName;
                    changed = true;
                }
            });
            const storedSequence = parseInt(localStorage.getItem('HVAC_CAJA_SEQUENCE') || '0', 10) || 0;
            if (storedSequence !== maxSequence || changed) {
                localStorage.setItem('HVAC_CAJA_SEQUENCE', String(maxSequence));
                if (changed) localStorage.setItem('HVAC_CAJA_BACKUP', JSON.stringify(cajaMenorItems));
            }
        }

        function nextCajaConsecutiveId() {
            ensureCajaConsecutiveIds();
            let maxSequence = parseInt(localStorage.getItem('HVAC_CAJA_SEQUENCE') || '0', 10) || 0;
            cajaMenorItems.forEach(item => {
                const match = String(item.consecutiveId || '').match(/^CM-(\d+)$/);
                if (match) maxSequence = Math.max(maxSequence, parseInt(match[1], 10) || 0);
            });
            maxSequence += 1;
            localStorage.setItem('HVAC_CAJA_SEQUENCE', String(maxSequence));
            return `CM-${String(maxSequence).padStart(3, '0')}`;
        }

        function renderCajaModule() {
            const tbody = document.getElementById('caja-unified-table-body');
            if (!tbody) return;
            ensureCajaConsecutiveIds();
            tbody.innerHTML = '';

            let unifiedList = [
                ...cajaMenorItems.map((c, sourceIndex) => ({ ...c, isLeg: false, _sourceIndex: sourceIndex })),
                ...cajaLegalizations.map((l, sourceIndex) => ({ ...l, isLeg: true, _sourceIndex: sourceIndex }))
            ];
            const createdSortValue = item => {
                const parsed = Date.parse(item.createdAt || item.created_at || item.timestamp || '');
                if (Number.isFinite(parsed)) return parsed;
                const fromId = String(item.id || '').match(/(?:^|[-_])(\d{10,13})(?:$|[-_])/);
                if (fromId) return Number(fromId[1]);
                const fromConsecutive = String(item.consecutiveId || '').match(/(\d+)/);
                if (fromConsecutive) return Number(fromConsecutive[1]);
                return Number(item._sourceIndex || 0);
            };
            unifiedList.sort((a, b) => createdSortValue(b) - createdSortValue(a));

            if (unifiedList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 font-medium text-xs">No hay registros en la caja menor.</td></tr>`;
                return;
            }

            unifiedList.forEach(item => {
                if (item.isLeg) {
                    const diff = item.capital - item.totalSpent;
                    let diffText = diff >= 0 ? `Vuelto: $ ${diff.toLocaleString()}` : `Reembolso: $ ${Math.abs(diff).toLocaleString()}`;
                    tbody.insertAdjacentHTML('beforeend', `<tr class="caja-leg-row bg-purple-50/70 border-y border-purple-200">
                        <td class="font-bold text-xs text-purple-900"><i class="fa-solid fa-file-invoice-dollar text-purple-600 mr-1"></i> ${esc(item.date)}</td>
                        <td><span class="bg-purple-600 text-white px-2.5 py-1 rounded-lg text-[10px] font-black uppercase">Corte de Legalización</span></td>
                        <td class="text-xs text-purple-900 font-bold">${esc(item.concept)} <span class="text-purple-600 font-normal">(${(item.expenseIds || []).length} facturas)</span></td>
                        <td class="font-mono font-bold text-purple-700">Recibido: $ ${(item.capital || 0).toLocaleString()} | Gastado: $ ${(item.totalSpent || 0).toLocaleString()}</td>
                        <td class="font-bold text-xs text-slate-700">${diffText}</td>
                        <td><span class="text-slate-400 text-xs">N/A</span></td>
                        <td class="text-right whitespace-nowrap">
                            <button onclick="downloadLegalizationReceipt('${escJs(item.id)}')" class="p-2 text-indigo-600 hover:bg-indigo-100 rounded-xl transition" title="Descargar recibo de legalización"><i class="fa-solid fa-file-pdf"></i></button>
                            <button onclick="deleteLegalizationRecord('${escJs(item.id)}')" class="p-2 text-rose-600 hover:bg-rose-100 rounded-xl transition" title="Revertir Corte"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>`);
                } else {
                    const isLegalized = !!item.legalized;
                    const statusBadge = isLegalized ? `<span class="bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold px-2 py-0.5 rounded-full ml-1.5">Legalizado</span>` : `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full ml-1.5">Pendiente</span>`;
                    const clientName = item.clientName || item.client || 'Cliente no asignado';
                    const costCenter = item.costCenterNumber || 'Sin número registrado';

                    tbody.insertAdjacentHTML('beforeend', `<tr>
                        <td class="font-medium text-xs"><span class="block font-black text-indigo-700">${esc(item.consecutiveId)}</span><span class="text-slate-500">${esc(item.date)}</span></td>
                        <td><span class="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-bold">${esc(item.classification)}</span></td>
                        <td class="text-xs text-slate-800 font-medium">${item.description ? esc(item.description) : '<span class="text-slate-400 italic">Sin detalle</span>'} ${statusBadge}</td>
                        <td class="font-mono font-bold text-rose-600">$ ${(item.amount || 0).toLocaleString()}</td>
                        <td class="text-xs"><span class="block font-bold text-teal-700">${esc(clientName)}</span><span class="text-slate-500">Centro de Costo N.º ${esc(costCenter)}</span></td>
                        <td>${item.receiptImg ? `<button onclick="openReceiptViewer('${escJs(item.id)}')" class="text-xs text-blue-600 font-bold hover:underline inline-flex items-center gap-1"><i class="fa-solid fa-image"></i> Ver Comprobante</button>` : '<span class="text-slate-400 text-xs">Sin foto</span>'}</td>
                        <td class="text-right">
                            <div class="inline-flex gap-1.5">
                                <button onclick="openCajaModal('${escJs(item.id)}')" class="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition" title="Editar Gasto"><i class="fa-solid fa-pen"></i></button>
                                <button onclick="deleteCajaRecord('${escJs(item.id)}')" class="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition" title="Eliminar Gasto"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>`);
                }
            });
        }

        function handleCajaClassChange() {
            const classification = document.getElementById('caja-f-class').value;
            const descLabel = document.getElementById('caja-desc-label');
            const descField = document.getElementById('caja-f-desc');
            if (classification === 'Otro') {
                descLabel.innerHTML = 'Concepto / Detalle (Obligatorio por ser Otro) *';
                descField.required = true;
            } else {
                descLabel.innerHTML = 'Concepto / Detalle (Opcional)';
                descField.required = false;
            }
        }

        function openCajaModal(id) {
            document.getElementById('caja-modal-backdrop').classList.remove('hidden');
            populateCajaClientDropdown();
            if (id) {
                const item = cajaMenorItems.find(c => c.id === id);
                if (!item) return;
                document.getElementById('caja-modal-title').innerText = "Editar Gasto de Caja Menor";
                document.getElementById('caja-f-id').value = item.id;
                document.getElementById('caja-f-consecutive').innerText = item.consecutiveId || 'Se asigna al guardar';
                document.getElementById('caja-f-date').value = item.date;
                document.getElementById('caja-f-class').value = item.classification;
                document.getElementById('caja-f-amount').value = item.amount;
                document.getElementById('caja-f-desc').value = item.description || '';
                const client = getCajaClient(item);
                document.getElementById('caja-f-client').value = client ? String(client.id) : '';
                handleCajaClientChange();
                if (item.costCenterNumber) document.getElementById('caja-f-cost-center-number').value = item.costCenterNumber;
                handleCajaClassChange();
                if (item.receiptImg) {
                    document.getElementById('caja-receipt-preview').innerHTML = `<img src="${esc(item.receiptImg)}" id="temp-receipt-data" class="w-20 h-20 object-cover rounded-xl border border-slate-200">`;
                } else {
                    document.getElementById('caja-receipt-preview').innerHTML = '';
                }
            } else {
                document.getElementById('caja-modal-title').innerText = "Registro de Caja Menor";
                document.getElementById('caja-f-id').value = '';
                document.getElementById('caja-f-consecutive').innerText = 'Se asigna al guardar';
                document.getElementById('caja-f-date').value = new Date().toISOString().split('T')[0];
                document.getElementById('caja-f-class').value = 'Traslado de insumos';
                document.getElementById('caja-f-amount').value = '';
                document.getElementById('caja-f-desc').value = '';
                document.getElementById('caja-f-client').value = '';
                document.getElementById('caja-f-cost-center-name').innerText = 'Es el nombre del cliente seleccionado';
                document.getElementById('caja-f-cost-center-number').value = '';
                document.getElementById('caja-receipt-preview').innerHTML = '';
                handleCajaClassChange();
            }
        }

        function closeCajaModal() {
            document.getElementById('caja-modal-backdrop').classList.add('hidden');
        }

        document.getElementById('caja-f-receipt').addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const compressedBase64 = await r2keep(await compressImage(file, 900, 0.7), 'comprobantes');
            document.getElementById('caja-receipt-preview').innerHTML = `<img src="${compressedBase64}" id="temp-receipt-data" class="w-20 h-20 object-cover rounded-xl border border-slate-200">`;
        });

        async function saveCajaRecord() {
            const existingId = document.getElementById('caja-f-id').value;
            const id = existingId || `CAJA-${Date.now()}`;
            const date = document.getElementById('caja-f-date').value;
            const classification = document.getElementById('caja-f-class').value;
            const amount = parseFloat(document.getElementById('caja-f-amount').value) || 0;
            const description = document.getElementById('caja-f-desc').value.trim();
            const clientId = document.getElementById('caja-f-client').value;
            const client = clientsCatalog.find(c => String(c.id) === String(clientId));
            const clientName = client ? client.name : '';
            const costCenterName = clientName;
            const costCenterNumber = document.getElementById('caja-f-cost-center-number').value.trim();
            const imgEl = document.getElementById('temp-receipt-data');
            const receiptImg = imgEl ? imgEl.src : null;

            if (!date || !amount) return showToast("Completa la fecha y el valor del gasto.", "error");
            if (!client) return showToast("Selecciona un cliente registrado.", "error");
            if (!costCenterNumber) return showToast("Completa el número del centro de costo en la ficha del cliente.", "error");
            if (classification === 'Otro' && !description) return showToast("La descripción es obligatoria cuando la clasificación es 'Otro'.", "error");

            const existingIdx = cajaMenorItems.findIndex(c => c.id === id);
            const isLegalized = existingIdx >= 0 ? !!cajaMenorItems[existingIdx].legalized : false;
            const consecutiveId = (existingIdx >= 0 && cajaMenorItems[existingIdx].consecutiveId) ? cajaMenorItems[existingIdx].consecutiveId : await cajaReservarConsecutivo();

            const cajaObj = {
                id, consecutiveId, date, classification, amount, description,
                clientId: client.id, clientName, costCenterName, costCenterNumber,
                receiptImg: receiptImg || (existingIdx >= 0 ? cajaMenorItems[existingIdx].receiptImg : null),
                createdAt: existingIdx >= 0 ? (cajaMenorItems[existingIdx].createdAt || cajaMenorItems[existingIdx].timestamp || null) : new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                legalized: isLegalized
            };

            if (existingIdx >= 0) cajaMenorItems[existingIdx] = cajaObj;
            else cajaMenorItems.push(cajaObj);
            registrarAuditoria(existingIdx >= 0 ? 'EDITAR' : 'CREAR', 'hvac_caja', id);

            localStorage.setItem('HVAC_CAJA_BACKUP', JSON.stringify(cajaMenorItems));
            renderCajaModule();
            closeCajaModal();
            showToast("Gasto de caja menor guardado correctamente.");
        }

        function deleteCajaRecord(id) {
            const item = cajaMenorItems.find(c => c.id === id);
            if (!item) return showToast("No se encontró el gasto que quieres eliminar.", "error");
            if (item.legalized && !window.confirm(
                `El gasto ${item.consecutiveId || ''} ya está legalizado. Si lo eliminas, se quitará del corte asociado y el total gastado de ese corte se recalculará. Esta acción no se puede deshacer. ¿Continuar?`
            )) return;

            cajaLegalizations.forEach(legalization => {
                if (!Array.isArray(legalization.expenseIds) || !legalization.expenseIds.includes(id)) return;
                legalization.expenseIds = legalization.expenseIds.filter(expenseId => expenseId !== id);
                legalization.totalSpent = legalization.expenseIds.reduce((total, expenseId) => {
                    const expense = cajaMenorItems.find(record => record.id === expenseId);
                    return total + Number(expense ? expense.amount || 0 : 0);
                }, 0);
            });
            cajaMenorItems = cajaMenorItems.filter(c => c.id !== id);
            registrarAuditoria('BORRAR', 'hvac_caja', id);
            localStorage.setItem('HVAC_CAJA_BACKUP', JSON.stringify(cajaMenorItems));
            localStorage.setItem('HVAC_LEGALIZATIONS_BACKUP', JSON.stringify(cajaLegalizations));
            renderCajaModule();
            showToast("Registro eliminado.");
        }

        function openReceiptViewer(id) {
            const item = cajaMenorItems.find(c => c.id === id);
            if (!item || !item.receiptImg) return showToast("No hay comprobante disponible.", "error");
            document.getElementById('receipt-viewer-img').src = item.receiptImg;
            document.getElementById('receipt-viewer-modal-backdrop').classList.remove('hidden');
        }

        function closeReceiptViewerModal() {
            document.getElementById('receipt-viewer-modal-backdrop').classList.add('hidden');
        }

        // El consecutivo CM-### se reserva al registrar cada gasto y representa el orden
        // de incorporación del administrador; nunca se ordena por la fecha de la factura.
        function orderCajaItemsByUploadSequence(items) {
            return (Array.isArray(items) ? items : []).map((item, index) => {
                const match = String(item && item.consecutiveId || '').match(/^CM-(\d+)$/i);
                return { item, index, sequence: match ? Number(match[1]) : null };
            }).sort((a, b) => {
                if (a.sequence != null && b.sequence != null) return a.sequence - b.sequence || a.index - b.index;
                if (a.sequence != null) return -1;
                if (b.sequence != null) return 1;
                return a.index - b.index;
            }).map(entry => entry.item);
        }

        function getPrintLegalizationCutItems() {
            const cutSelect = document.getElementById('print-legalization-cut');
            const cutId = cutSelect ? cutSelect.value : '';
            const cut = cajaLegalizations.find(l => String(l.id) === String(cutId));
            // Mantener exactamente la secuencia guardada en el corte (la misma del recibo oficial).
            return (cut && Array.isArray(cut.expenseIds) ? cut.expenseIds : [])
                .map(id => cajaMenorItems.find(item => String(item.id) === String(id)))
                .filter(Boolean);
        }

        function getPrintLegalizationCandidates() {
            const scope = (document.getElementById('print-legalization-scope') || {}).value || 'pending';
            if (scope === 'pending') return orderCajaItemsByUploadSequence(cajaMenorItems.filter(item => !item.legalized));
            if (scope === 'cut') return getPrintLegalizationCutItems();
            return orderCajaItemsByUploadSequence(cajaMenorItems.slice());
        }

        function updatePrintLegalizationSelectionCount() {
            const count = document.querySelectorAll('.legalization-print-checkbox:checked').length;
            const countEl = document.getElementById('print-legalization-selected-count');
            const pagesEl = document.getElementById('print-legalization-page-count');
            if (countEl) countEl.innerText = String(count);
            if (pagesEl) pagesEl.innerText = String(Math.ceil(count / 4));
        }

        function renderPrintLegalizationCandidates(selectedIds) {
            const tbody = document.getElementById('print-legalization-list');
            if (!tbody) return;
            const selected = selectedIds instanceof Set ? selectedIds : new Set();
            // El arreglo ya viene ordenado por consecutivo o por la secuencia propia del corte.
            const items = getPrintLegalizationCandidates();
            tbody.innerHTML = '';
            if (!items.length) {
                const scope = (document.getElementById('print-legalization-scope') || {}).value || 'pending';
                const message = scope === 'pending' ? 'No hay gastos pendientes por legalizar.' : scope === 'cut' ? 'Este corte no tiene facturas asociadas disponibles.' : 'No hay gastos registrados para seleccionar.';
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-400 font-medium text-xs">${esc(message)}</td></tr>`;
                updatePrintLegalizationSelectionCount();
                return;
            }
            items.forEach(item => {
                const clientName = item.clientName || item.client || 'Cliente no asignado';
                const costCenter = item.costCenterNumber || 'Sin número registrado';
                const checked = selected.has(String(item.id)) ? 'checked' : '';
                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td><input type="checkbox" value="${esc(item.id)}" class="legalization-print-checkbox rounded text-indigo-600 w-4 h-4" ${checked} onchange="handlePrintLegalizationSelection(this)"></td>
                    <td class="font-black text-indigo-700">${esc(item.consecutiveId)}</td>
                    <td class="text-xs"><span class="block">${esc(item.date || '-')}</span><span class="font-bold text-teal-700">${esc(clientName)}</span></td>
                    <td class="text-xs">${esc(costCenter)}</td>
                    <td class="font-mono text-xs">$ ${(Number(item.amount) || 0).toLocaleString('es-CO')}</td>
                </tr>`);
            });
            updatePrintLegalizationSelectionCount();
        }

        function openPrintLegalizationModal() {
            ensureCajaConsecutiveIds();
            if (!cajaMenorItems.length) return showToast("No hay gastos registrados para imprimir.", "error");

            const scopeSelect = document.getElementById('print-legalization-scope');
            const cutSelect = document.getElementById('print-legalization-cut');
            const cutWrap = document.getElementById('print-legalization-cut-wrap');
            const cuts = cajaLegalizations.slice().sort((a, b) => (Date.parse(b.date || b.createdAt || '') || 0) - (Date.parse(a.date || a.createdAt || '') || 0));
            if (cutSelect) {
                cutSelect.innerHTML = cuts.length
                    ? cuts.map((cut, index) => `<option value="${esc(cut.id)}">${esc(cut.concept || 'Corte sin concepto')} · ${esc(cut.date || '-')} · ${(Array.isArray(cut.expenseIds) ? cut.expenseIds.length : 0)} facturas</option>`).join('')
                    : '<option value="">No hay cortes disponibles</option>';
                if (cuts.length) cutSelect.value = String(cuts[0].id);
            }
            if (scopeSelect) scopeSelect.value = 'pending';
            if (cutWrap) cutWrap.classList.add('hidden');
            applyPrintLegalizationScope();
            document.getElementById('print-legalization-modal-backdrop').classList.remove('hidden');
        }

        function applyPrintLegalizationScope() {
            const scope = (document.getElementById('print-legalization-scope') || {}).value || 'pending';
            const cutWrap = document.getElementById('print-legalization-cut-wrap');
            const hint = document.getElementById('print-legalization-scope-hint');
            if (cutWrap) cutWrap.classList.toggle('hidden', scope !== 'cut');

            const candidates = getPrintLegalizationCandidates();
            const selectedIds = new Set(scope === 'manual' ? [] : candidates.map(item => String(item.id)));
            if (hint) {
                hint.textContent = scope === 'pending'
                    ? `Se seleccionaron automáticamente ${candidates.length} gasto(s) pendientes por legalizar.`
                    : scope === 'cut'
                        ? `Se seleccionaron automáticamente ${candidates.length} factura(s) asociada(s) al corte elegido.`
                        : 'Marca individualmente los comprobantes que deseas incluir; no hay límite de selección.';
            }
            renderPrintLegalizationCandidates(selectedIds);
        }

        function handlePrintLegalizationSelection() {
            updatePrintLegalizationSelectionCount();
        }

        function selectAllVisiblePrintLegalization() {
            document.querySelectorAll('.legalization-print-checkbox').forEach(checkbox => { checkbox.checked = true; });
            updatePrintLegalizationSelectionCount();
        }

        function closePrintLegalizationModal() {
            document.getElementById('print-legalization-modal-backdrop').classList.add('hidden');
        }

        async function generateCajaLegalizationPDF() {
            const selectedIds = Array.from(new Set(Array.from(document.querySelectorAll('.legalization-print-checkbox:checked')).map(el => el.value)));
            if (!selectedIds.length) return showToast("Selecciona al menos un comprobante para generar el PDF.", "error");
            if (!window.jspdf || !window.jspdf.jsPDF) return showToast("No se pudo cargar el generador PDF. Verifica tu conexión e inténtalo de nuevo.", "error");

            const selectedSet = new Set(selectedIds.map(String));
            // Filtrar sobre la lista ordenada, no sobre la selección del DOM ni sobre la fecha de factura.
            // Así la impresión por corte coincide con el detalle del recibo oficial.
            const selectedItems = getPrintLegalizationCandidates().filter(item => selectedSet.has(String(item.id)));
            if (!selectedItems.length) return showToast("No se encontraron los gastos seleccionados.", "error");
            ensureCajaConsecutiveIds();
            try { await afcPreloadPhotos(selectedItems.map(i => i.receiptImg).filter(Boolean)); } catch (e) { console.warn('[PDF] fotos de caja', e); }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('portrait', 'mm', 'letter');
            const pageW = doc.internal.pageSize.getWidth();
            const pageH = doc.internal.pageSize.getHeight();
            const margin = 5;
            const gap = 2.5;
            const pad = 3;
            const LH = 3.9;
            const cellW = (pageW - margin * 2 - gap) / 2;
            const cellH = (pageH - margin * 2 - gap) / 2;
            const innerW = cellW - pad * 2;

            // Un solo PDF para todo el lote: cada grupo de 4 comprobantes ocupa una página.
            for (let index = 0; index < selectedItems.length; index++) {
                if (index > 0 && index % 4 === 0) doc.addPage();
                const pageSlot = index % 4;
                const col = pageSlot % 2;
                const row = Math.floor(pageSlot / 2);
                const x = margin + col * (cellW + gap);
                const y = margin + row * (cellH + gap);
                doc.setDrawColor(148, 163, 184);
                doc.setLineWidth(0.35);
                doc.roundedRect(x, y, cellW, cellH, 2, 2);
                const item = selectedItems[index];

                // 1) Se miden los datos primero: la foto recibe todo el espacio restante del cuadro.
                const centerName = item.clientName || item.client || 'Cliente no asignado';
                const centerNumber = item.costCenterNumber || 'Sin número registrado';
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8.5);
                const centerLines = doc.splitTextToSize(`Centro de Costo: ${centerName}`, innerW);
                const numberLines = doc.splitTextToSize(`Número: ${centerNumber}`, innerW);
                const textH = 9.9 + (centerLines.length + numberLines.length) * LH;
                const textTop = y + cellH - pad - textH;

                // 2) Foto del recibo: caja de imagen máxima, centrada y sin deformarse.
                const boxX = x + pad, boxY = y + pad, boxW = innerW, boxH = textTop - 2.5 - boxY;
                const src = (typeof AFC_PHOTO_CACHE !== 'undefined' && AFC_PHOTO_CACHE.get(afcPhotoSrc(item.receiptImg))) || item.receiptImg;
                let drawn = false;
                if (src) {
                    try {
                        const props = doc.getImageProperties(src);
                        const scale = Math.min(boxW / props.width, boxH / props.height);
                        const imageW = props.width * scale;
                        const imageH = props.height * scale;
                        doc.addImage(src, props.fileType || 'JPEG', boxX + (boxW - imageW) / 2, boxY + (boxH - imageH) / 2, imageW, imageH);
                        drawn = true;
                    } catch (e) { console.warn('No se pudo colocar la foto del comprobante en el PDF.', e); }
                }
                if (!drawn) {
                    doc.setDrawColor(203, 213, 225);
                    doc.rect(boxX, boxY, boxW, boxH);
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(100, 116, 139);
                    doc.text(src ? 'No se pudo cargar la foto' : 'Sin foto de factura / comprobante', x + cellW / 2, boxY + boxH / 2, { align: 'center' });
                }

                // 3) Datos del comprobante.
                doc.setDrawColor(226, 232, 240);
                doc.setLineWidth(0.2);
                doc.line(x + pad, textTop - 1.2, x + cellW - pad, textTop - 1.2);
                let ty = textTop + 3;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(15, 23, 42);
                doc.text(`Gasto ${item.consecutiveId || ''}`, x + pad, ty);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(100, 116, 139);
                doc.text(`Fecha: ${item.date || '-'}`, x + cellW - pad, ty, { align: 'right' });
                ty += 4.2;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8.5);
                doc.setTextColor(15, 23, 42);
                doc.text(centerLines, x + pad, ty);
                ty += centerLines.length * LH;
                doc.setFont('helvetica', 'normal');
                doc.text(numberLines, x + pad, ty);
                ty += numberLines.length * LH + 1.2;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9.5);
                doc.text(`Valor de la factura: $ ${Number(item.amount || 0).toLocaleString('es-CO')}`, x + pad, ty);
            }

            const stamp = new Date().toISOString().slice(0, 10);
            doc.save(`Legalizacion_Caja_Menor_${stamp}_${selectedItems.length}_comprobantes.pdf`);
            closePrintLegalizationModal();
            showToast(`PDF del lote descargado: ${selectedItems.length} comprobante(s) en ${Math.ceil(selectedItems.length / 4)} página(s).`);
        }

        // ===== Recibo oficial de legalización de Caja Menor (PDF) =====
        function formatReceiptDate(value) {
            const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
            return m ? `${m[3]}/${m[2]}/${m[1]}` : (value || '-');
        }

        async function afcLoadCajaReceiptLetterhead() {
            if ((!AFC_HEADER_IMG || !AFC_FOOTER_IMG) && window.HVAC && HVAC.letterhead && typeof HVAC.letterhead.load === 'function') {
                try {
                    const loaded = await HVAC.letterhead.load();
                    if (loaded && loaded.header) AFC_HEADER_IMG = loaded.header;
                    if (loaded && loaded.footer) AFC_FOOTER_IMG = loaded.footer;
                } catch (e) {
                    console.warn('[Caja PDF] No se pudo consultar el membrete desde Storage; se usará el respaldo oficial.', e);
                }
            }

            const fallback = window.HVACReportLetterhead || {};
            const rawHeader = AFC_HEADER_IMG || (typeof fallback.getHeader === 'function' ? fallback.getHeader() : '');
            const rawFooter = AFC_FOOTER_IMG || (typeof fallback.getFooter === 'function' ? fallback.getFooter() : '');
            const absoluteSrc = value => {
                const src = afcPhotoSrc(value);
                if (!src) return '';
                if (/^(?:data:image\/|https?:\/\/|\/\/|blob:)/i.test(src)) return src;
                // También resuelve rutas relativas simples como "assets/encabezado.jpg".
                try { return new URL(src, window.location.href).href; } catch (_) { return src; }
            };
            const [header, footer] = await Promise.all([
                afcResolvePhoto(absoluteSrc(rawHeader)),
                afcResolvePhoto(absoluteSrc(rawFooter))
            ]);
            if (!header || !footer) {
                const det = (window.HVAC && HVAC.letterhead && HVAC.letterhead.errors) ? Object.entries(HVAC.letterhead.errors).map(([k, v]) => (k === 'header' ? 'Encabezado' : 'Pie') + ': ' + v).join(' · ') : '';
                throw new Error('No fue posible cargar el encabezado y el pie de página oficiales. Verifica el bucket de membretes en Supabase Storage.' + (det ? ' (' + det + ')' : ''));
            }
            return { header, footer };
        }

        async function downloadLegalizationReceipt(legId) {
            const leg = cajaLegalizations.find(l => String(l.id) === String(legId));
            if (!leg) return showToast("No se encontró el corte de legalización.", "error");
            if (!window.jspdf || !window.jspdf.jsPDF) return showToast("No se pudo cargar el generador PDF. Verifica tu conexión e inténtalo de nuevo.", "error");
            ensureCajaConsecutiveIds();
            let letterhead;
            try {
                letterhead = await afcLoadCajaReceiptLetterhead();
            } catch (e) {
                console.error('[Caja PDF] Membrete no disponible:', e);
                return showToast(e && e.message ? e.message : 'No se pudo cargar el encabezado y pie de página.', 'error');
            }

            const ids = Array.isArray(leg.expenseIds) ? leg.expenseIds : [];
            const expenses = ids.map(id => cajaMenorItems.find(c => String(c.id) === String(id))).filter(Boolean);
            const money = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CO');
            const totalSpent = expenses.reduce((t, e) => t + (Number(e.amount) || 0), 0);
            const capital = Number(leg.capital) || 0;
            const diff = capital - totalSpent;

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('portrait', 'mm', 'letter');
            const PW = doc.internal.pageSize.getWidth();
            const PH = doc.internal.pageSize.getHeight();
            const M = 15, CW = PW - 2 * M;
            const IMG_H = CW * 93 / 1241;
            const HEAD_Y = 6, FOOT_Y = PH - 6 - IMG_H;
            const TOP = HEAD_Y + IMG_H + 8, BOTTOM = FOOT_Y - 8;
            const NAVY = [27, 54, 93];
            let y = TOP;

            const decorate = () => {
                // Los recursos ya fueron descargados/convertidos a JPEG Data URL antes de crear el PDF.
                doc.addImage(letterhead.header, 'JPEG', M, HEAD_Y, CW, IMG_H);
                doc.addImage(letterhead.footer, 'JPEG', M, FOOT_Y, CW, IMG_H);
            };
            const newPage = () => { doc.addPage(); decorate(); y = TOP; };
            const ensure = h => { if (y + h > BOTTOM) { newPage(); return true; } return false; };
            const sectionTitle = text => {
                ensure(16);
                doc.setFillColor(...NAVY);
                doc.rect(M, y, CW, 6.4, 'F');
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
                doc.text(text.toUpperCase(), M + 3, y + 4.4);
                y += 6.4;
            };
            // Tabla genérica: cols = [{h, w, right}], rows = [[celda, ...]], bold = última columna en negrita
            const drawTable = (cols, rows, emptyText) => {
                const header = () => {
                    doc.setFillColor(226, 232, 240); doc.rect(M, y, CW, 6, 'F');
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(15, 23, 42);
                    let x = M;
                    cols.forEach(c => {
                        if (c.right) doc.text(c.h, x + c.w - 2, y + 4, { align: 'right' }); else doc.text(c.h, x + 2, y + 4);
                        x += c.w;
                    });
                    y += 6;
                };
                header();
                if (!rows.length) {
                    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
                    doc.text(emptyText, M + 2, y + 5); y += 8; return;
                }
                rows.forEach((row, i) => {
                    const wrapped = row.map((cell, ci) => doc.splitTextToSize(String(cell), cols[ci].w - 4));
                    const rowH = Math.max(...wrapped.map(l => l.length), 1) * 3.5 + 3;
                    if (y + rowH > BOTTOM) { newPage(); header(); }
                    if (i % 2 === 1) { doc.setFillColor(244, 247, 251); doc.rect(M, y, CW, rowH, 'F'); }
                    let x = M;
                    wrapped.forEach((lines, ci) => {
                        const last = ci === cols.length - 1;
                        doc.setFont('helvetica', last ? 'bold' : 'normal'); doc.setFontSize(7.5); doc.setTextColor(30, 41, 59);
                        if (cols[ci].right) doc.text(lines, x + cols[ci].w - 2, y + 4, { align: 'right' }); else doc.text(lines, x + 2, y + 4);
                        x += cols[ci].w;
                    });
                    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(M, y + rowH, M + CW, y + rowH);
                    y += rowH;
                });
            };
            const totalRow = (label, value) => {
                ensure(9);
                doc.setFillColor(...NAVY); doc.rect(M, y, CW, 7, 'F');
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
                doc.text(label, M + 3, y + 4.8);
                doc.text(value, M + CW - 3, y + 4.8, { align: 'right' });
                y += 7;
            };

            decorate();
            // --- Título
            doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(15, 23, 42);
            doc.text('RECIBO DE LEGALIZACIÓN DE CAJA MENOR', PW / 2, y + 5, { align: 'center' });
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139);
            doc.text(`Documento N.º ${leg.id}`, PW / 2, y + 10.5, { align: 'center' });
            y += 16;

            // --- Datos generales (2 columnas)
            const info = [
                ['Fecha de legalización', formatReceiptDate(leg.date)],
                ['Concepto', leg.concept || '-'],
                ['Quién legaliza', leg.legalizedBy || 'Sin registrar'],
                ['Quién supervisa', leg.supervisedBy || 'Sin registrar'],
                ['Quién recibe', leg.receivedBy || 'Sin registrar'],
                ['Capital recibido', money(capital)],
                ['Facturas asociadas', String(expenses.length)],
                ['Total gastado', money(totalSpent)]
            ];
            const colW = CW / 2;
            for (let i = 0; i < info.length; i += 2) {
                const cells = [info[i], info[i + 1]];
                const lines = cells.map(c => doc.splitTextToSize(String(c[1]), colW - 8));
                const h = Math.max(...lines.map(l => l.length)) * 4 + 8;
                ensure(h + 2);
                cells.forEach((c, k) => {
                    const x = M + k * colW;
                    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.25); doc.rect(x, y, colW, h);
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(100, 116, 139);
                    doc.text(c[0].toUpperCase(), x + 3, y + 4);
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(15, 23, 42);
                    doc.text(lines[k], x + 3, y + 8.5);
                });
                y += h;
            }
            y += 6;

            // --- Detalle de facturas con centro de costo
            sectionTitle('Detalle de facturas asociadas');
            const detailCols = [{ h: 'N.º', w: 20 }, { h: 'Fecha', w: 20 }, { h: 'Detalle', w: 52 }, { h: 'Centro de costo', w: 58 }, { h: 'Valor', w: CW - 150, right: true }];
            drawTable(detailCols, expenses.map(e => [
                e.consecutiveId || '-',
                formatReceiptDate(e.date),
                e.description || e.classification || 'Sin detalle',
                `${e.clientName || e.client || 'Cliente no asignado'} · C.C. ${e.costCenterNumber || 'sin número'}`,
                money(e.amount)
            ]), 'Este corte no tiene facturas asociadas.');
            y += 5;

            totalRow(`TOTAL GASTADO (${expenses.length} facturas)`, money(totalSpent));
            y += 5;

            // --- Balance del corte
            sectionTitle('Balance del corte');
            drawTable(
                [{ h: 'Concepto', w: CW - 50 }, { h: 'Valor', w: 50, right: true }],
                [
                    ['Capital recibido', money(capital)],
                    ['Total gastado en facturas', money(totalSpent)],
                    [diff >= 0 ? 'Saldo a devolver (vuelto)' : 'Reembolso a favor de quien legaliza', money(Math.abs(diff))]
                ], ''
            );
            y += 4;

            // --- Tres espacios de firma: legaliza, supervisa y recibe.
            ensure(38);
            y += 15;
            doc.setDrawColor(100, 116, 139); doc.setLineWidth(0.3);
            const sigGap = 7;
            const sigW = (CW - sigGap * 2) / 3;
            [
                ['Quién legaliza', leg.legalizedBy],
                ['Quién supervisa', leg.supervisedBy || leg.supervisor],
                ['Quién recibe', leg.receivedBy]
            ].forEach(([role, person], k) => {
                const x = M + k * (sigW + sigGap);
                doc.line(x, y, x + sigW, y);
                doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(15, 23, 42);
                const nameLines = doc.splitTextToSize(String(person || ''), sigW - 2).slice(0, 2);
                if (nameLines.length) doc.text(nameLines, x + sigW / 2, y + 4.2, { align: 'center' });
                doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
                doc.text(role + ' · Firma', x + sigW / 2, y + 12.5, { align: 'center' });
            });

            // --- Numeración de páginas
            const pages = doc.getNumberOfPages();
            for (let p = 1; p <= pages; p++) {
                doc.setPage(p);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
                doc.text(`Página ${p} de ${pages}`, PW - M, FOOT_Y - 2, { align: 'right' });
            }

            doc.save(`Recibo_Legalizacion_${String(leg.id).replace(/[^\w-]/g, '')}.pdf`);
            showToast("Recibo de legalización descargado.");
        }

        function openLegalizationModal() {
            ensureCajaConsecutiveIds();
            const pending = orderCajaItemsByUploadSequence(cajaMenorItems.filter(c => !c.legalized));
            if (pending.length === 0) return showToast("No hay gastos pendientes para legalizar.", "error");
            const totalSpent = pending.reduce((acc, curr) => acc + (curr.amount || 0), 0);
            document.getElementById('legalization-modal-backdrop').classList.remove('hidden');
            document.getElementById('leg-pending-count').innerText = pending.length;
            document.getElementById('leg-total-gastado').innerText = `$ ${totalSpent.toLocaleString()}`;
            document.getElementById('leg-f-concept').value = `Legalización de Caja - ${new Date().toLocaleDateString()}`;
            document.getElementById('leg-f-capital').value = totalSpent;
            document.getElementById('leg-f-date').value = new Date().toISOString().split('T')[0];
            const me = systemUsers.find(u => String(u.id) === String(activeUser));
            document.getElementById('leg-f-by').value = me ? (me.name || me.username || '') : '';
            document.getElementById('leg-f-supervisor').value = '';
            document.getElementById('leg-f-receiver').value = '';
        }

        function closeLegalizationModal() {
            document.getElementById('legalization-modal-backdrop').classList.add('hidden');
        }

        function processCajaLegalization() {
            ensureCajaConsecutiveIds();
            const concept = document.getElementById('leg-f-concept').value.trim();
            const capital = parseFloat(document.getElementById('leg-f-capital').value) || 0;
            const date = document.getElementById('leg-f-date').value;
            const legalizedBy = document.getElementById('leg-f-by').value.trim();
            const supervisedBy = document.getElementById('leg-f-supervisor').value.trim();
            const receivedBy = document.getElementById('leg-f-receiver').value.trim();
            if (!legalizedBy || !supervisedBy || !receivedBy) return showToast("Indica quién legaliza, quién supervisa y quién recibe.", "error");
            // Congelar el corte en el orden de consecutivo (orden de incorporación de los gastos).
            const pending = orderCajaItemsByUploadSequence(cajaMenorItems.filter(c => !c.legalized));
            if (!pending.length) return showToast("No hay gastos pendientes para legalizar.", "error");
            const totalSpent = pending.reduce((acc, curr) => acc + (curr.amount || 0), 0);
            const expenseIds = pending.map(c => c.id);

            pending.forEach(c => c.legalized = true);
            const legObj = { id: `LEG-${Date.now()}`, createdAt: new Date().toISOString(), concept, capital, totalSpent, date, expenseIds, legalizedBy, supervisedBy, receivedBy };
            cajaLegalizations.push(legObj);
            registrarAuditoria('LEGALIZAR', 'hvac_legalizaciones', legObj.id);

            localStorage.setItem('HVAC_CAJA_BACKUP', JSON.stringify(cajaMenorItems));
            localStorage.setItem('HVAC_LEGALIZATIONS_BACKUP', JSON.stringify(cajaLegalizations));
            renderCajaModule();
            closeLegalizationModal();
            showToast("¡Legalización consolidada con éxito!");
            downloadLegalizationReceipt(legObj.id); // recibo oficial para firmar y archivar
        }

        function deleteLegalizationRecord(id) {
            const leg = cajaLegalizations.find(l => l.id === id);
            if (leg && leg.expenseIds) {
                cajaMenorItems.forEach(c => {
                    if (leg.expenseIds.includes(c.id)) c.legalized = false;
                });
            }
            cajaLegalizations = cajaLegalizations.filter(l => l.id !== id);
            registrarAuditoria('REVERTIR_LEGALIZACION', 'hvac_legalizaciones', id);
            localStorage.setItem('HVAC_CAJA_BACKUP', JSON.stringify(cajaMenorItems));
            localStorage.setItem('HVAC_LEGALIZATIONS_BACKUP', JSON.stringify(cajaLegalizations));
            renderCajaModule();
            showToast("Corte de legalización revertido.");
        }

        function openBatchProjectionModal() {
            document.getElementById('batch-projection-modal-backdrop').classList.remove('hidden');
        }

        function closeBatchProjectionModal() {
            document.getElementById('batch-projection-modal-backdrop').classList.add('hidden');
            document.getElementById('batch-projection-file').value = '';
        }

        function openBatchEquipmentModal() {
            document.getElementById('batch-equipment-modal-backdrop').classList.remove('hidden');
        }

        function closeBatchEquipmentModal() {
            document.getElementById('batch-equipment-modal-backdrop').classList.add('hidden');
            document.getElementById('batch-equipment-file').value = '';
        }

        function downloadProjectionTemplate() {
            const templateData = [
                { "Cliente": "EDIFICIO 9/78", "Mes": 1, "Año": 2026, "Periodicidad": "Trimestral", "Valor Presupuestado": 1500000 }
            ];
            const ws = XLSX.utils.json_to_sheet(templateData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Proyeccion");
            XLSX.writeFile(wb, "Plantilla_Proyeccion_Mantenimiento.xlsx");
            showToast("Plantilla modelo descargada.");
        }

        function downloadEquipmentTemplate() {
            const templateData = [
                { "Código": "AC-101", "Cliente": "EDIFICIO 9/78", "Nombre del equipo": "Aire Sala", "Serial": "SN-998877", "Tipo de equipo": "Chiller", "Marca": "Carrier", "Modelo": "40QHG", "Capacidad": "5 TR" }
            ];
            const ws = XLSX.utils.json_to_sheet(templateData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Equipos");
            XLSX.writeFile(wb, "Plantilla_Equipos_HVAC.xlsx");
            showToast("Plantilla equipos descargada.");
        }

        async function processBatchProjectionUpload() {
            const fileInput = document.getElementById('batch-projection-file');
            if (!fileInput.files || !fileInput.files[0]) return showToast("Selecciona un archivo Excel.", "error");

            const file = fileInput.files[0];
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            let headerIdx = -1;
            let colMap = { client: 0, month: 1, year: 2, periodicity: 3, budget: 4 };

            for (let i = 0; i < json.length; i++) {
                const row = json[i].map(c => String(c || '').toLowerCase().trim());
                if (row.some(cell => cell.includes('cliente') || cell.includes('mes'))) {
                    headerIdx = i;
                    json[i].forEach((cell, cIdx) => {
                        const val = String(cell || '').toLowerCase().trim();
                        if (val.includes('cliente')) colMap.client = cIdx;
                        if (val.includes('mes')) colMap.month = cIdx;
                        if (val.includes('año') || val.includes('anio')) colMap.year = cIdx;
                        if (val.includes('periodicidad')) colMap.periodicity = cIdx;
                        if (val.includes('valor')) colMap.budget = cIdx;
                    });
                    break;
                }
            }

            const startRow = headerIdx >= 0 ? headerIdx + 1 : 0;
            let addedCount = 0;

            // Equipos solo de los clientes que aparecen en el archivo (no se descarga todo el catálogo).
            const fileClients = new Set();
            for (let i = startRow; i < json.length; i++) {
                const c = String((json[i] && json[i][colMap.client]) || '').trim();
                if (c) fileClients.add(c);
            }
            for (const c of fileClients) await ensureClientEquipments(c);

            for (let i = startRow; i < json.length; i++) {
                const r = json[i];
                if (!r || r.length === 0) continue;
                const client = String(r[colMap.client] || '').trim();
                if (!client) continue;

                const month = parseInt(r[colMap.month]) || 1;
                const year = parseInt(r[colMap.year]) || 2026;
                const periodicity = String(r[colMap.periodicity] || 'Trimestral').trim();
                const budget = parseFloat(r[colMap.budget]) || 0;
                const projId = `PROJ-${year}-${month}-${client.replace(/[\/\\]/g, '-')}-${Date.now().toString().slice(-4)}`;
                const eqIds = equipmentCatalog.filter(e => eqBelongsToClient(e, client)).map(e => e.id);

                monthlyProjections.push({ id: projId, client, periodicity, month, year, budget, equipmentIds: eqIds, status: 'PENDING', orderId: null });
                addedCount++;
            }

            if (addedCount === 0) return showToast("No se encontraron registros válidos.", "error");

            localStorage.setItem('HVAC_PROJECTIONS_BACKUP', JSON.stringify(monthlyProjections));
            renderPlanningModule();
            closeBatchProjectionModal();
            showToast(`¡Se importaron ${addedCount} proyecciones correctamente!`);
        }

        async function processBatchEquipmentUpload() {
            const fileInput = document.getElementById('batch-equipment-file');
            if (!fileInput.files || !fileInput.files[0]) return showToast("Selecciona un archivo Excel.", "error");

            const file = fileInput.files[0];
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            let headerIdx = -1;
            let colMap = { code: 0, client: 1, name: 2, serial: 3, type: 4, brand: 5, model: 6, capacity: 7 };

            for (let i = 0; i < json.length; i++) {
                const row = json[i].map(c => String(c || '').toLowerCase().trim());
                if (row.some(cell => cell.includes('código') || cell.includes('codigo') || cell.includes('cliente'))) {
                    headerIdx = i;
                    json[i].forEach((cell, cIdx) => {
                        const val = String(cell || '').toLowerCase().trim();
                        if (val.includes('código') || val.includes('codigo')) colMap.code = cIdx;
                        if (val.includes('cliente')) colMap.client = cIdx;
                        if (val.includes('nombre')) colMap.name = cIdx;
                        if (val.includes('serial')) colMap.serial = cIdx;
                        if (val.includes('tipo')) colMap.type = cIdx;
                        if (val.includes('marca')) colMap.brand = cIdx;
                        if (val.includes('modelo')) colMap.model = cIdx;
                        if (val.includes('capacidad')) colMap.capacity = cIdx;
                    });
                    break;
                }
            }

            const startRow = headerIdx >= 0 ? headerIdx + 1 : 0;
            let addedCount = 0;
            const unmatchedClients = new Set();
            // La importación compara contra el catálogo completo: se espera a que termine la carga de equipos.
            if (typeof eqProgressivePromise !== 'undefined' && eqProgressivePromise) { try { await eqProgressivePromise; } catch (_) {} }

            for (let i = startRow; i < json.length; i++) {
                const r = json[i];
                if (!r || r.length === 0) continue;
                const code = String(r[colMap.code] || '').trim();
                const client = String(r[colMap.client] || '').trim();
                if (!code || !client) continue;

                const eqId = hvacUUID();
                const eqObj = {
                    id: eqId, code, client,
                    name: String(r[colMap.name] || '').trim(),
                    serial: String(r[colMap.serial] || '').trim(),
                    type: String(r[colMap.type] || '').trim(),
                    brand: String(r[colMap.brand] || '').trim(),
                    model: String(r[colMap.model] || '').trim(),
                    capacity: String(r[colMap.capacity] || '').trim()
                };

                linkClientFields(eqObj, client); // nombre oficial + clientId (evita cruces entre clientes)
                if (!eqObj.clientId) unmatchedClients.add(cleanSpaces(client));

                const existingIdx = equipmentCatalog.findIndex(e => e.code === code && eqBelongsToClient(e, eqObj.client));
                if (existingIdx >= 0) {
                    eqObj.id = equipmentCatalog[existingIdx].id;
                    if (equipmentCatalog[existingIdx].qr) eqObj.qr = equipmentCatalog[existingIdx].qr; // conserva el QR ya generado
                    equipmentCatalog[existingIdx] = eqObj;
                } else {
                    equipmentCatalog.push(eqObj);
                }

                await cloudSaveEquipment(eqObj);
                addedCount++;
            }

            if (addedCount === 0) return showToast("No se encontraron equipos válidos.", "error");

            localStorage.setItem('HVAC_EQUIPMENTS_BACKUP', JSON.stringify(equipmentCatalog));
            populateClientDropdowns();
            renderEquipmentCatalog();
            closeBatchEquipmentModal();
            showToast(`¡Se importaron ${addedCount} equipos correctamente!` + (unmatchedClients.size ? ` ${unmatchedClients.size} cliente(s) no existen en el catálogo (${[...unmatchedClients].slice(0, 3).join(', ')}${unmatchedClients.size > 3 ? '…' : ''}); créalos en Clientes y vuelve a importar.` : ''), unmatchedClients.size ? 'error' : 'success');
        }

        function renderPlanningModule() {
            const month = parseInt(document.getElementById('plan-filter-month').value);
            const year = parseInt(document.getElementById('plan-filter-year').value);
            const filterStatus = document.getElementById('plan-filter-status').value || 'ALL';
            const tbody = document.getElementById('planning-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';

            const list = monthlyProjections.filter(p => {
                const matchMonth = p.month === month && p.year === year;
                const matchStatus = filterStatus === 'ALL' || p.status === filterStatus;
                return matchMonth && matchStatus;
            });

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400 font-medium">No hay mantenimientos proyectados para los filtros seleccionados.</td></tr>`;
                return;
            }

            list.forEach(p => {
                let statusBadge = '<span class="bg-amber-50 text-amber-700 border border-amber-200/60 text-[10px] font-bold px-2.5 py-1 rounded-full">Pendiente de Programar</span>';
                if (p.status === 'SCHEDULED') {
                    statusBadge = `<span class="bg-emerald-50 text-emerald-700 border border-emerald-200/60 text-[10px] font-bold px-2.5 py-1 rounded-full">Programado (${esc((p.orderIds||[p.orderId]).filter(Boolean).join(', '))})</span>`;
                } else if (p.status === 'PARTIAL') {
                    statusBadge = `<span class="bg-sky-50 text-sky-700 border border-sky-200/60 text-[10px] font-bold px-2.5 py-1 rounded-full">Programación parcial</span>`;
                }

                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td class="font-bold text-slate-900">${esc(p.client)}</td>
                    <td class="font-semibold text-teal-700">${esc(p.periodicity)}</td>
                    <td><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md text-xs font-bold">${esc(p.month)}/${esc(p.year)}</span></td>
                    <td class="font-mono font-bold text-slate-800">$ ${(p.budget || 0).toLocaleString()}</td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        ${p.status !== 'SCHEDULED' ? `
                            <button onclick="openScheduleModalFromProjection('${escJs(p.id)}')" class="btn-teal text-xs py-1.5 px-3">
                                <i class="fa-solid fa-calendar-days"></i> Programar
                            </button>
                        ` : `
                            <span class="text-xs text-slate-400 font-semibold">Ya programado</span>
                        `}
                    </td>
                </tr>`);
            });
        }

        async function openScheduleModalFromProjection(projId) {
            const proj = monthlyProjections.find(p => p.id === projId);
            if (!proj) return;

            document.getElementById('schedule-modal-backdrop').classList.remove('hidden');
            document.getElementById('sch-projection-id').value = proj.id;
            document.getElementById('sch-client-display').value = proj.client;
            document.getElementById('sch-date').value = `${proj.year}-${String(proj.month).padStart(2, '0')}-01`;
            populateTechDropdown();

            const container = document.getElementById('sch-equipments-picker');
            container.innerHTML = '';
            container.innerHTML = '<p class="text-slate-400 p-2 text-center text-xs">Cargando equipos del cliente…</p>';
            await ensureClientEquipments(proj.client);
            await window.hvacPopulateRoutineZoneFilter?.(proj.client, 'sch');
            container.innerHTML = '';
            const list = equipmentCatalog.filter(e => eqBelongsToClient(e, proj.client));

            if (list.length === 0) {
                container.innerHTML = '<p class="text-slate-400 p-2 text-center text-xs">Este cliente no tiene equipos registrados.</p>';
                return;
            }

            list.forEach(e => {
                const isSelected = (proj.equipmentIds || []).includes(e.id) && !(proj.scheduledEquipmentIds || []).map(String).includes(String(e.id));
                const zoneLabel=String(e.zoneName||'').trim()||'Sin zona asignada';
                container.insertAdjacentHTML('beforeend', `<label class="flex items-center gap-3 p-2 bg-white hover:bg-slate-100/70 rounded-xl cursor-pointer border border-slate-100 transition">
                    <input type="checkbox" value="${esc(e.id)}" ${isSelected ? 'checked' : ''} class="sch-eq-checkbox rounded text-teal-600 w-4 h-4">
                    <span class="font-mono font-bold text-slate-800 text-xs">${esc(e.code)}</span>
                    <span class="text-slate-500 text-xs font-medium">- ${esc(e.name || e.type || 'Sin nombre')} · ${esc(zoneLabel)}</span>
                </label>`);
            });
            window.hvacApplyRoutineZoneFilter?.('sch');
        }

        function closeScheduleModal() {
            document.getElementById('schedule-modal-backdrop').classList.add('hidden');
        }

        async function saveScheduleRoutine() {
            const projId=document.getElementById('sch-projection-id').value, proj=monthlyProjections.find(p=>p.id===projId);if(!proj)return;
            const date=document.getElementById('sch-date').value,technicians=techPickerValues('sch-tech'),technician=technicians.join(', ');
            const equipmentIds=Array.from(document.querySelectorAll('.sch-eq-checkbox:checked')).map(c=>c.value);
            if(!date||!technician)return showToast('Fecha y al menos un técnico son obligatorios.','error');if(!equipmentIds.length)return showToast('Selecciona al menos un equipo de la zona elegida.','error');
            const alreadyScheduled=new Set((proj.scheduledEquipmentIds||[]).map(String));
            const projectionType=String(proj.maintenanceType||'PREVENTIVO').toUpperCase();
            if(projectionType==='PREVENTIVO' && equipmentIds.some(id=>alreadyScheduled.has(String(id))))return showToast('Uno o más equipos ya están programados en esta proyección preventiva.','error');
            try{
              const baseId=await hvacBaseIdForProjection(proj),groups=((document.getElementById('sch-no-split')||{}).checked)?hvacMergeZoneGroups(hvacGroupEquipmentByZone(equipmentIds)):hvacGroupEquipmentByZone(equipmentIds);
              const orders=hvacBuildZoneOrders({client:proj.client,date,technician,technicians,groups,base:baseId,type:projectionType});
              orders.forEach(o=>{o.maintenanceBudget=Number(proj.budget)||0;o.maintenancePeriodicity=proj.periodicity||'Sin periodicidad';});
              workOrders.push(...orders);
              proj.zoneBaseId=baseId;
              proj.orderId=proj.orderId||orders[0].id;proj.orderIds=[...new Set([...(proj.orderIds||[]),...orders.map(o=>o.id)])];
              proj.scheduledEquipmentIds=[...new Set([...(proj.scheduledEquipmentIds||[]).map(String),...equipmentIds.map(String)])];
              const allProjectionEquipment=(proj.equipmentIds&&proj.equipmentIds.length?proj.equipmentIds:equipmentCatalog.filter(e=>eqBelongsToClient(e,proj.client)).map(e=>e.id)).map(String);
              if(!proj.equipmentIds||!proj.equipmentIds.length)proj.equipmentIds=allProjectionEquipment.slice();
              proj.status=allProjectionEquipment.length>0&&allProjectionEquipment.every(id=>proj.scheduledEquipmentIds.includes(id))?'SCHEDULED':'PARTIAL';
              localStorage.setItem('HVAC_ORDERS_BACKUP',JSON.stringify(workOrders));localStorage.setItem('HVAC_PROJECTIONS_BACKUP',JSON.stringify(monthlyProjections));
              let allSaved=true;for(const o of orders){try{if(!await cloudSaveOrder(o))allSaved=false;else registrarAuditoria('CREAR','hvac_orders',o.id);}catch(e){allSaved=false;}}
              localStorage.setItem('HVAC_ORDERS_BACKUP',JSON.stringify(workOrders));renderAdminDashboard();renderPlanningModule();closeScheduleModal();
              showToast(allSaved?`Órdenes programadas: ${orders.map(o=>o.id).join(', ')}.`:'Órdenes guardadas localmente; sincronización pendiente.',allSaved?'success':'error');
            }catch(e){console.error('[Rutinas] Programación por zona',e);showToast('No se pudo programar la rutina.','error');}
        }

        // ===== Rutina: modo CREAR / modo EDITAR (el cliente queda bloqueado al editar) =====
        let nrEditingId = null;

        function nrApplyMode(order) {
            const editing = !!order;
            const proj = editing ? hvacProjForOrder(order.id) : null;
            const sel = document.getElementById('nr-client');
            if (sel) sel.disabled = editing;                                   // integridad: no se cambia el cliente
            const typeSel = document.getElementById('nr-type');
            if (typeSel) {                                                      // el tipo define el consecutivo: no se cambia al editar
                typeSel.disabled = editing;
                if (editing) { try { typeSel.value = billingRoutineType(order); } catch (e) { typeSel.value = 'PREVENTIVO'; } }
            }
            document.getElementById('nr-client-lock').classList.toggle('hidden', !editing);
            document.getElementById('nr-modal-title').innerText = editing ? `Editar Rutina ${order.id}` : 'Nueva Rutina de Mantenimiento (Manual)';
            document.getElementById('nr-submit-label').innerText = editing ? 'Guardar Cambios' : 'Registrar y Programar Rutina';
            document.querySelector('#nr-submit-btn i').className = editing ? 'fa-solid fa-floppy-disk' : 'fa-solid fa-circle-plus';
            // Compatibilidad: normalmente el presupuesto vive en la proyección; las rutinas
            // editadas/creadas desde versiones nuevas también lo conservan en la orden.
            const orderBudget = editing ? (order.maintenanceBudget !== undefined && order.maintenanceBudget !== null && order.maintenanceBudget !== '' ? order.maintenanceBudget : order.budget) : null;
            const hasOrderBudget = editing && orderBudget !== undefined && orderBudget !== null && orderBudget !== '';
            const showPB = !editing || !!proj || hasOrderBudget;
            document.getElementById('nr-pb-row').classList.toggle('hidden', !showPB);
            document.getElementById('nr-periodicity').required = showPB;
            document.getElementById('nr-budget').required = showPB;
            nrTypeChanged();
        }

        // === Referencia de valores facturados (últimas 2 facturas PREVENTIVO para el cliente) ===
        function nrShowBillingRef() {
            const refEl = document.getElementById('nr-billing-ref');
            if (!refEl) return;
            const client = (document.getElementById('nr-client') || {}).value || '';
            const type   = String((document.getElementById('nr-type')   || {}).value || '').toUpperCase();
            if (!client || type !== 'PREVENTIVO') { refEl.innerHTML = ''; refEl.classList.add('hidden'); return; }

            // Buscar las últimas órdenes BILLED de tipo PREVENTIVO para este cliente, con monto real
            const billed = (workOrders || []).filter(o => {
                if (!o || String(o.id || '').startsWith('HIST-')) return false;
                if (String(o.status || '').toUpperCase() !== 'BILLED') return false;
                if (billingRoutineType(o) !== 'PREVENTIVO') return false;
                const clientMatch = normText(o.client || o.clientName || '') === normText(client);
                if (!clientMatch) return false;
                // Para matrices: solo el titular (evita contar las partes por separado)
                if (hvacIsMatrixOrder(o)) { const h = hvacMatrixHolder(o); if (!h || String(h.id) !== String(o.id)) return false; }
                const inv = o.invoice || {};
                // matrixRef indica que es parte secundaria con amount=0: descartarla
                if (inv.matrixRef) return false;
                return Number(inv.amount || 0) > 0;
            });

            // Ordenar por fecha de factura (más reciente primero)
            billed.sort((a, b) => {
                const da = parseFlexDate((a.invoice || {}).date || a.date) || 0;
                const db = parseFlexDate((b.invoice || {}).date || b.date) || 0;
                return db - da;
            });

            const last2 = billed.slice(0, 2);
            if (!last2.length) { refEl.innerHTML = ''; refEl.classList.add('hidden'); return; }

            const fmt = v => '$ ' + Number(v).toLocaleString('es-CO');
            const fmtDate = v => { const d = parseFlexDate(v); return d ? new Date(d).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' }) : ''; };

            const a1 = Number((last2[0].invoice || {}).amount || 0);
            const a2 = last2.length > 1 ? Number((last2[1].invoice || {}).amount || 0) : null;

            // Si hay 2 valores iguales (o diferencia <= 1%), mostrar solo uno
            const similar = a2 !== null && a1 > 0 && Math.abs(a1 - a2) / a1 <= 0.01;

            let html = '<div class="flex items-start gap-2 bg-sky-50 border border-sky-200/70 rounded-xl px-3 py-2 text-xs text-sky-800">'
                + '<i class="fa-solid fa-circle-info mt-0.5 text-sky-400 flex-none"></i>'
                + '<div><span class="font-bold">Referencia preventivo:</span> ';

            if (similar || a2 === null) {
                const d1 = fmtDate((last2[0].invoice || {}).date || last2[0].date);
                html += '<span class="font-black">' + fmt(a1) + '</span>'
                    + (d1 ? ' <span class="text-sky-600 font-normal">(' + d1 + ')</span>' : '');
            } else {
                const d1 = fmtDate((last2[0].invoice || {}).date || last2[0].date);
                const d2 = fmtDate((last2[1].invoice || {}).date || last2[1].date);
                html += '<span class="font-black">' + fmt(a1) + '</span>'
                    + (d1 ? ' <span class="text-sky-600">(' + d1 + ')</span>' : '')
                    + ' &nbsp;·&nbsp; '
                    + '<span class="font-black">' + fmt(a2) + '</span>'
                    + (d2 ? ' <span class="text-sky-600">(' + d2 + ')</span>' : '');
            }
            html += '</div></div>';

            refEl.innerHTML = html;
            refEl.classList.remove('hidden');
        }

        // Solo el PREVENTIVO es programado/recurrente. Correctivo y Revisión nacen de una novedad del cliente: sin periodicidad.
        let nrLastPeriodicity = 'Trimestral';
        function nrTypeChanged() {
            const type = String((document.getElementById('nr-type') || {}).value || 'PREVENTIVO').toUpperCase();
            const isPrev = type === 'PREVENTIVO';
            const per = document.getElementById('nr-periodicity');
            const wrap = document.getElementById('nr-periodicity-wrap');
            const budgetWrap = document.getElementById('nr-budget-wrap');
            if (!per || !wrap) return;
            if (isPrev) {
                if (per.value === 'Sin periodicidad' && nrLastPeriodicity && nrLastPeriodicity !== 'Sin periodicidad') per.value = nrLastPeriodicity;
            } else {
                if (per.value !== 'Sin periodicidad') nrLastPeriodicity = per.value;
                per.value = 'Sin periodicidad';          // no genera recordatorios de vencimiento ni ciclo recurrente
            }
            const pbHidden = (document.getElementById('nr-pb-row') || {}).classList.contains('hidden');
            const isRev = type === 'REVISION';          // la revisión no tiene valor: no se pide ni se guarda presupuesto
            wrap.classList.toggle('hidden', !isPrev);
            per.required = isPrev && !pbHidden;
            const budget = document.getElementById('nr-budget');
            if (budgetWrap) { budgetWrap.classList.toggle('hidden', isRev); budgetWrap.classList.toggle('col-span-2', !isPrev); }
            if (budget) { budget.required = !isRev && !pbHidden; if (isRev) budget.value = ''; }
            try { if (typeof window.hvacNrUpdateZonePreview === 'function') window.hvacNrUpdateZonePreview(); } catch (_) {}
            nrShowBillingRef();
        }

        function nrResetForm() {
            document.getElementById('nr-client').value = '';
            document.getElementById('nr-date').value = '';
            document.getElementById('nr-budget').value = '';
            const per = document.getElementById('nr-periodicity'); if (per) per.selectedIndex = 0;
            const nrT = document.getElementById('nr-type'); if (nrT) nrT.value = 'PREVENTIVO';
            nrTypeChanged();
            document.querySelectorAll('#nr-tech input[type=checkbox]').forEach(c => { c.checked = false; });
        }

        async function openNewRoutineModal() {
            nrEditingId = null;
            document.getElementById('new-routine-modal-backdrop').classList.remove('hidden');
            const keepClient = (document.getElementById('nr-client') || {}).value || '';   // útil al crear varias rutinas seguidas del mismo cliente
            nrResetForm();                                   // fecha, presupuesto, técnicos, periodicidad
            nrApplyMode(null);
            populateClientDropdowns();
            populateTechDropdown();
            const zf = document.getElementById('nr-zone-filter'); if (zf) zf.value = 'ALL';
            document.getElementById('nr-equipments-picker').innerHTML = '<p class="text-slate-400 p-2 text-center text-xs">Selecciona un cliente para ver sus equipos.</p>';
            if (await hvacRefreshOfficialClients()) populateClientDropdowns();               // 1) lista oficial actualizada
            const sel = document.getElementById('nr-client');
            if (keepClient && Array.from(sel.options).some(o => o.value === keepClient)) sel.value = keepClient;
            else sel.value = '';
            await renderAvailableEquipmentForNewRoutine();                                    // 2) equipos cargados sin tener que cambiar de cliente
        }

        function closeNewRoutineModal() {
            document.getElementById('new-routine-modal-backdrop').classList.add('hidden');
            if (nrEditingId !== null) { nrEditingId = null; nrApplyMode(null); nrResetForm(); }
            const pk = document.getElementById('nr-equipments-picker');
            if (pk) pk.innerHTML = '<p class="text-slate-400 p-2 text-center text-xs">Selecciona un cliente para ver sus equipos.</p>';
        }

        // ¿El equipo ya tiene ejecución registrada en esa rutina? (entonces no se puede quitar)
        function nrEqHasExec(order, eqId) {
            const ex = order.executions || {};
            const eq = equipmentCatalog.find(e => String(e.id) === String(eqId) || String(e.code) === String(eqId));
            return !!(ex[eqId] || (eq && (ex[eq.id] || ex[eq.code])));
        }

        // Abre el MISMO formulario de una rutina nueva, pre-cargado, con el cliente bloqueado
        async function openEditRoutineModal(orderId) {
            let order = workOrders.find(o => String(o.id) === String(orderId));
            if (!order) return showToast('No se encontró la rutina.', 'error');
            // El histórico puede entregar una fila ligera (solo resumen). Nunca se editan
            // equipos/técnicos sobre ese resumen: primero se hidrata el detalle completo.
            if (order._hvacSummaryOnly === true || order._hvacDetailStale === true) {
                if (!navigator.onLine && order._hvacSummaryOnly === true) {
                    return showToast('Esta rutina solo tiene un resumen descargado. Conéctate a internet para cargar su detalle antes de editarla.', 'error');
                }
                const full = await hvacEnsureFullOrder(order.id);
                if (!full || full._hvacSummaryOnly === true) {
                    return showToast('No se pudo cargar el detalle completo de la rutina. No se abrió la edición para evitar perder equipos o ejecuciones.', 'error');
                }
                order = workOrders.find(o => String(o.id) === String(orderId)) || full;
            }
            nrEditingId = order.id;
            document.getElementById('new-routine-modal-backdrop').classList.remove('hidden');
            populateClientDropdowns();
            populateTechDropdown();

            const client = order.client || order.clientName || '';
            const sel = document.getElementById('nr-client');
            if (client && !Array.from(sel.options).some(o => o.value === client)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(client)}">${esc(client)}</option>`);
            sel.value = client;
            nrApplyMode(order);

            const proj = hvacProjForOrder(order.id);
            if (proj) {
                document.getElementById('nr-periodicity').value = proj.periodicity || order.maintenancePeriodicity || 'Trimestral';
                document.getElementById('nr-budget').value = proj.budget !== undefined && proj.budget !== null ? String(proj.budget) : '';
            } else {
                if (order.maintenancePeriodicity) document.getElementById('nr-periodicity').value = order.maintenancePeriodicity;
                const retainedBudget = order.maintenanceBudget !== undefined && order.maintenanceBudget !== null && order.maintenanceBudget !== '' ? order.maintenanceBudget : order.budget;
                document.getElementById('nr-budget').value = retainedBudget !== undefined && retainedBudget !== null ? String(retainedBudget) : '';
            }
            nrTypeChanged();
            document.getElementById('nr-date').value = String(order.date || '').slice(0, 10);

            // Técnicos: marca los asignados; los que ya no están activos se conservan como opción
            const box = document.getElementById('nr-tech');
            const names = orderTechs(order);
            const boxes = Array.from(box.querySelectorAll('input[type=checkbox]'));
            boxes.forEach(c => { c.checked = names.includes(c.value); });
            names.filter(n => !boxes.some(c => c.value === n)).forEach(n =>
                box.insertAdjacentHTML('beforeend', `<label class="tech-opt"><input type="checkbox" value="${esc(n)}" checked><span>${esc(n)} <small>(inactivo)</small></span></label>`));

            // Equipos del cliente + marca los de la rutina (los ya ejecutados quedan bloqueados)
            await renderAvailableEquipmentForNewRoutine();
            if (nrEditingId !== order.id) return;                              // se cerró/cambió mientras cargaba
            const picker = document.getElementById('nr-equipments-picker');
            const ids = (order.equipmentIds || []).map(String);
            const have = new Set(Array.from(picker.querySelectorAll('.nr-eq-checkbox')).map(c => String(c.value)));
            if (picker.querySelector('p')) picker.innerHTML = '';              // mensaje "sin equipos"
            ids.filter(id => !have.has(id)).forEach(id => {
                const e = equipmentCatalog.find(x => String(x.id) === id || String(x.code) === id) || { id, code: id };
                picker.insertAdjacentHTML('beforeend', `<label class="flex items-center gap-3 p-2 bg-white hover:bg-slate-100/70 rounded-xl cursor-pointer border border-slate-100 transition">
                    <input type="checkbox" value="${esc(e.id)}" class="nr-eq-checkbox rounded text-teal-600 w-4 h-4">
                    <span class="font-mono font-bold text-slate-800 text-xs">${esc(e.code)}</span>
                    <span class="text-slate-500 text-xs font-medium">- ${esc(e.name || e.type || 'Sin nombre')}</span>
                </label>`);
            });
            picker.querySelectorAll('.nr-eq-checkbox').forEach(cb => {
                const on = ids.includes(String(cb.value));
                cb.checked = on;
                if (on && nrEqHasExec(order, cb.value)) {
                    cb.disabled = true;
                    cb.parentElement.insertAdjacentHTML('beforeend', '<span class="ml-auto text-[10px] font-black uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">Ejecutado</span>');
                }
            });
        }

        async function saveEditedRoutine() {
            const order = workOrders.find(o => String(o.id) === String(nrEditingId));
            if (!order) return showToast('No se encontró la rutina a editar.', 'error');

            const date = document.getElementById('nr-date').value;
            const technicians = techPickerValues('nr-tech');
            if (!date || !technicians.length) return showToast('Completa los campos obligatorios (fecha y técnico).', 'error');

            const prevIds = (order.equipmentIds || []).map(String);
            const previousStatus = String(order.status || '').toUpperCase();
            const equipmentIds = Array.from(document.querySelectorAll('.nr-eq-checkbox:checked')).map(c => String(c.value));
            prevIds.forEach(id => { if (!equipmentIds.includes(id) && nrEqHasExec(order, id)) equipmentIds.push(id); });  // nunca se pierde una ejecución
            if (!equipmentIds.length) return showToast('Selecciona al menos un equipo.', 'error');

            const added = equipmentIds.filter(id => !prevIds.includes(id));
            if (added.length && (order.status === 'COMPLETED' || order.status === 'BILLED') &&
                !confirm(`La rutina ya está ${order.status === 'BILLED' ? 'facturada' : 'completada'}. Los ${added.length} equipo(s) nuevo(s) quedarán sin ejecutar. ¿Continuar?`)) return;

            order.date = date;
            order.technicians = technicians;
            order.technician = technicians.join(', ');
            order.equipmentIds = equipmentIds;
            order.updatedAt = new Date().toISOString();
            if (equipmentIds.some(id => !prevIds.includes(String(id))) && previousStatus === 'COMPLETED') {
                order.status = 'PENDING';
                order.clientSignature = null;
            } else if (previousStatus === 'COMPLETED' && !hvacOrderProgress(order).complete) {
                order.status = 'PENDING';
                order.clientSignature = null;
            }

            const proj = hvacProjForOrder(order.id);
            const budgetInput = document.getElementById('nr-budget');
            const budgetRaw = budgetInput ? String(budgetInput.value || '').trim() : '';
            const isRevision = String(billingRoutineType(order) || '').toUpperCase() === 'REVISION';
            if (!isRevision && budgetRaw !== '') order.maintenanceBudget = Number(budgetRaw) || 0;
            else if (!isRevision && proj && proj.budget !== undefined && proj.budget !== null) order.maintenanceBudget = Number(proj.budget) || 0;
            if (proj) {
                const d = new Date(date + 'T00:00:00');
                proj.month = d.getMonth() + 1; proj.year = d.getFullYear();
                proj.periodicity = document.getElementById('nr-periodicity').value || proj.periodicity;
                if (!isRevision && budgetRaw !== '') proj.budget = Number(budgetRaw) || 0;
                proj.equipmentIds = equipmentIds.slice();
                order.maintenancePeriodicity = proj.periodicity;
            } else if (document.getElementById('nr-periodicity').value) {
                order.maintenancePeriodicity = document.getElementById('nr-periodicity').value;
            }

            // cloudUpsert usa return=minimal: un HTTP 2xx no demuestra por sí solo que
            // la lista de equipos quedó en el payload. Se verifica lectura real y se reintenta una vez.
            const expectedEquipmentIds = [...new Set(equipmentIds.map(String))].sort();
            let savedCloud = null, cloudVerified = false;
            try {
                savedCloud = await cloudSaveOrder(order, { dup: true });
                if (savedCloud && navigator.onLine) {
                    cloudVerified = await hvacVerifyOrderEquipmentIds(order.id, expectedEquipmentIds);
                    if (!cloudVerified) {
                        console.warn('[Rutina] Primera escritura no reflejó todos los equipos; se reintenta una vez:', order.id);
                        savedCloud = await cloudSaveOrder(order, { dup: true });
                        cloudVerified = !!savedCloud && await hvacVerifyOrderEquipmentIds(order.id, expectedEquipmentIds);
                    }
                }
            } catch (e) { console.warn('[Rutina] Error al guardar/verificar en la nube:', e); }
            registrarAuditoria('EDITAR', 'hvac_orders', order.id);
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            localStorage.setItem('HVAC_PROJECTIONS_BACKUP', JSON.stringify(monthlyProjections));

            if (savedCloud && navigator.onLine && !cloudVerified) {
                // Conserva el formulario abierto y la copia local para que el usuario pueda reintentar.
                try { await cloudOutboxAdd('hvac_orders', cloudCleanId(order.id), 'save', order); } catch (_) {}
                showToast('El servidor aceptó el envío, pero no pudimos confirmar los equipos guardados. La edición permanece abierta para reintentar; no se marcó como sincronizada.', 'error');
                return;
            }

            closeNewRoutineModal();
            [renderAdminDashboard, renderPlanningModule, renderHistoryModule, renderBillingModule].forEach(fn => { try { fn(); } catch (e) { console.warn(e); } });
            if (savedCloud && (cloudVerified || !navigator.onLine)) showToast(cloudVerified ? `Rutina ${order.id} actualizada y verificada en la nube.` : `Rutina ${order.id} guardada localmente; se sincronizará cuando vuelva la conexión.`);
            else showToast(`Rutina ${order.id}: cambio guardado localmente; la nube no confirmó la escritura (${cloudCtl.lastStatus || 'sin respuesta'}${cloudCtl.lastDetail ? ' · ' + cloudCtl.lastDetail.slice(0, 120) : ''}). Quedó en cola y se reintentará.`, 'error');
        }

        async function renderAvailableEquipmentForNewRoutine() {
            const client = document.getElementById('nr-client').value;
            const container = document.getElementById('nr-equipments-picker');
            container.innerHTML = '';
            if (!client) {
                container.innerHTML = '<p class="text-slate-400 p-2 text-center text-xs">Selecciona un cliente primero.</p>';
                return;
            }

            container.innerHTML = '<p class="text-slate-400 p-2 text-center text-xs">Cargando equipos del cliente…</p>';
            nrShowBillingRef();
            await ensureClientEquipments(client);
            if (document.getElementById('nr-client').value !== client) return; // cambió de cliente mientras cargaba
            nrShowBillingRef(); // actualizar con datos completos si se cargaron órdenes adicionales
            await window.hvacPopulateRoutineZoneFilter?.(client, 'nr');
            container.innerHTML = '';
            const list = equipmentCatalog.filter(e => eqBelongsToClient(e, client));

            if (list.length === 0) {
                container.innerHTML = '<p class="text-slate-400 p-2 text-center text-xs">Este cliente no tiene equipos registrados.</p>';
                return;
            }

            list.forEach(e => {
                const zoneLabel=String(e.zoneName||'').trim()||'Sin zona asignada';
                container.insertAdjacentHTML('beforeend', `<label class="flex items-center gap-3 p-2 bg-white hover:bg-slate-100/70 rounded-xl cursor-pointer border border-slate-100 transition">
                    <input type="checkbox" value="${esc(e.id)}" class="nr-eq-checkbox rounded text-teal-600 w-4 h-4">
                    <span class="font-mono font-bold text-slate-800 text-xs">${esc(e.code)}</span>
                    <span class="text-slate-500 text-xs font-medium">- ${esc(e.name || e.type || 'Sin nombre')} · ${esc(zoneLabel)}</span>
                </label>`);
            });
            window.hvacApplyRoutineZoneFilter?.('nr');
        }

        let nrSaving = false;
        // ===== Zonas: etiqueta, proyección del periodo y códigos PRE-0007-P1 =====
        function hvacOrderZoneLabel(order) {
            if (!order) return '';
            const own = String(order.zoneName || '').trim(); if (own) return own;
            const names = [...new Set((order.equipmentIds || []).map(id => { const e = (equipmentCatalog || []).find(x => String(x.id) === String(id) || String(x.code) === String(id)); return String((e && e.zoneName) || '').trim(); }).filter(Boolean))];
            return names.join(' · ');
        }
        function hvacProjForOrder(orderId) {
            return (monthlyProjections || []).find(p => p && (String(p.orderId) === String(orderId) || (p.orderIds || []).map(String).includes(String(orderId))));
        }
        function hvacStripZoneSuffix(id) { return String(id || '').replace(/-P\d+$/i, ''); }
        // Consecutivo base de un cliente+periodo: el de la proyección si ya tiene órdenes; si no, uno nuevo.
        async function hvacBaseIdForProjection(proj) {
            if (proj && proj.zoneBaseId) return proj.zoneBaseId;
            const first = proj && (proj.orderIds && proj.orderIds[0] || proj.orderId);
            if (first) { const o = (workOrders || []).find(x => String(x.id) === String(first)); return (o && o.zoneBaseId) || hvacStripZoneSuffix(first); }
            return reservePrevId();
        }
        // Asigna ids por zona: "Piso 7" → BASE-P7, "Piso 8" → BASE-P8 (el número del nombre de la zona).
        // Zonas sin número ("Torre A") o con número ya usado → siguiente BASE-P{n} libre. Sin zona → BASE si está libre.
        function hvacZoneOrderIds(base, groups) {
            const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-P(\\d+)$', 'i');
            const taken = new Set((workOrders || []).map(o => String(o && o.id)));
            let n = 0; (workOrders || []).forEach(o => { const m = re.exec(String(o && o.id || '')); if (m) n = Math.max(n, +m[1]); });
            const out = new Array(groups.length);
            groups.forEach((g, i) => {                       // 1.ª pasada: el número del piso manda
                const m = g.zoneId && /(\d+)/.exec(g.zoneName || ''); if (!m) return;
                const num = parseInt(m[1], 10), id = `${base}-P${num}`; if (!num || taken.has(id)) return;
                taken.add(id); n = Math.max(n, num); out[i] = { id, part: num };
            });
            groups.forEach((g, i) => {                       // 2.ª pasada: el resto toma el siguiente libre
                if (out[i]) return;
                if (!g.zoneId && !taken.has(base)) { taken.add(base); out[i] = { id: base, part: null }; return; }
                let id; do { n++; id = `${base}-P${n}`; } while (taken.has(id));
                taken.add(id); out[i] = { id, part: n };
            });
            return out;
        }
        function hvacBuildZoneOrders({ client, date, technician, technicians, groups, base, type = 'PREVENTIVO' }) {
            const ids = hvacZoneOrderIds(base, groups);
            return groups.map((g, i) => {
                const o = { id: ids[i].id, client, date, technician, technicians, equipmentIds: g.ids, zoneId: g.zoneId, zoneName: g.zoneName, ...(g.zoneNames ? { zoneNames: g.zoneNames } : {}), zonePart: ids[i].part, zoneParts: groups.length, zoneBaseId: base, executions: {}, status: 'PENDING', clientSignature: null, invoice: null, createdAt: new Date().toISOString(), maintenanceType: type, tipoRutina: type };
                linkClientFields(o, client); return o;
            });
        }

        function hvacGroupEquipmentByZone(ids) {
            const map=new Map();
            (ids||[]).forEach(id=>{const e=(equipmentCatalog||[]).find(x=>String(x.id)===String(id)||String(x.code)===String(id))||{};const zid=String(e.zoneId||'');const zname=String(e.zoneName||'').trim()||(zid?'Zona asignada':'Sin zona');const key=zid||'__NO_ZONE__';if(!map.has(key))map.set(key,{zoneId:zid,zoneName:zname,ids:[]});map.get(key).ids.push(id);});
            return Array.from(map.values()).sort((a,b)=>a.zoneName.localeCompare(b.zoneName,'es'));
        }
        // Une varias zonas en UN solo grupo: una sola orden y un solo informe con todos los equipos (sin partes -P#)
        function hvacMergeZoneGroups(groups) {
            if (!groups || groups.length < 2) return groups;
            const names = groups.map(g => g.zoneName).filter(Boolean);
            return [{ zoneId: '', zoneName: names.join(' · '), zoneNames: names, ids: groups.reduce((a, g) => a.concat(g.ids || []), []) }];
        }

        // Compara semanas calendario ISO usando fechas locales YYYY-MM-DD (sin desfases de zona horaria).
        function hvacIsoWeekKey(value) {
            if (!value) return '';
            const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
            const d = m ? new Date(Date.UTC(+m[1], +m[2]-1, +m[3])) : new Date(value);
            if (isNaN(d.getTime())) return '';
            d.setUTCHours(0,0,0,0);
            d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
            const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
            return d.getUTCFullYear() + '-W' + String(week).padStart(2,'0');
        }
        function hvacProjectionDate(proj) {
            if (!proj) return '';
            if (proj.date) return proj.date;
            const ids = (proj.orderIds || [proj.orderId]).filter(Boolean).map(String);
            const linked = (workOrders || []).find(o => ids.includes(String(o.id)) && o.date);
            return linked ? linked.date : '';
        }

        async function saveNewRoutineManual() {
            if (nrSaving) return;
            if (nrEditingId !== null) return saveEditedRoutine();
            const client = document.getElementById('nr-client').value;
            const activeClientRecord = clientsCatalog.find(c => c && sameClient(c.name, client));
            if (!activeClientRecord || !isClientActiveRecord(activeClientRecord)) return showToast('Este cliente está marcado como NO ACTIVO. No se pueden generar nuevas rutinas de mantenimiento para esta sede.', 'error');
            const routineType = (document.getElementById('nr-type') || {}).value || 'PREVENTIVO';
            const periodicity = routineType === 'PREVENTIVO' ? document.getElementById('nr-periodicity').value : 'Sin periodicidad';   // correctivo/revisión: no programados
            const budget = parseFloat(document.getElementById('nr-budget').value) || 0;
            const date = document.getElementById('nr-date').value;
            const technicians = techPickerValues('nr-tech'); const technician = technicians.join(', ');
            const equipmentIds = Array.from(document.querySelectorAll('.nr-eq-checkbox:checked')).map(c => c.value);
            if (!client || !periodicity || !date || !technician) return showToast("Completa todos los campos obligatorios.", "error");
            if (!equipmentIds.length) return showToast("Selecciona al menos un equipo.", "error");
            nrSaving = true;
            const submitBtn=document.getElementById('nr-submit-btn'), submitLabel=document.getElementById('nr-submit-label');
            const originalLabel=submitLabel?submitLabel.textContent:''; if(submitBtn)submitBtn.disabled=true;if(submitLabel)submitLabel.textContent='Guardando…';
            try {
                const dObj=new Date(date+'T00:00:00'), month=dObj.getMonth()+1, year=dObj.getFullYear();
                const projId=`PROJ-${year}-${month}-${client.replace(/[\/\\]/g,'-')}-${Date.now().toString().slice(-5)}`;
                // Los preventivos conservan una sola programación por equipo y mes.
                // Los correctivos son intervenciones independientes: se puede crear más
                // de uno para los mismos equipos incluso en la misma semana o mes, y cada
                // uno recibe su propia proyección y consecutivo. Las revisiones tampoco
                // se bloquean por repetición dentro de una semana.
                const selectedWeek = hvacIsoWeekKey(date);
                const periodProjs = routineType === 'CORRECTIVO' ? [] : monthlyProjections.filter(p=>{
                    if(!p || p.client!==client || !p.zoneBaseId || (p.maintenanceType||'PREVENTIVO')!==routineType) return false;
                    if(routineType==='REVISION') return hvacIsoWeekKey(hvacProjectionDate(p))===selectedWeek && !!selectedWeek;
                    return Number(p.month)===month && Number(p.year)===year;
                });
                const already=new Set();periodProjs.forEach(p=>(p.scheduledEquipmentIds||p.equipmentIds||[]).forEach(id=>already.add(String(id))));
                if(routineType==='PREVENTIVO' && equipmentIds.some(id=>already.has(String(id))))return showToast('Uno o más equipos ya están programados en este mes para este cliente.','error');
                // Plan de facturación: cada grupo = un consecutivo (PRE-000X) con una parte -P# por zona. Sin selección: un solo grupo.
                const plan=(typeof hvacNrGetPlan==='function'&&hvacNrGetPlan())||[{n:1,groups:hvacGroupEquipmentByZone(equipmentIds),equipmentIds,value:budget,target:periodProjs.length?periodProjs[0].id:'NEW'}];
                const orderObjs=[];
                let k=0;
                for(const pg of plan){
                    k++;
                    const sameProj=pg.target&&pg.target!=='NEW'&&(((monthlyProjections.find(p=>p&&p.id===pg.target)||{}).maintenanceType||'PREVENTIVO')===routineType)?monthlyProjections.find(p=>p&&p.id===pg.target):null;
                    const baseId=sameProj?await hvacBaseIdForProjection(sameProj):await reservePrevId(routineType);
                    const objs=hvacBuildZoneOrders({client,date,technician,technicians,groups:pg.groups,base:baseId,type:routineType});
                    objs.forEach(o => { o.maintenanceBudget = Number(pg.value) || 0; o.maintenancePeriodicity = periodicity; });
                    if(sameProj){
                        sameProj.orderIds=[...new Set([...(sameProj.orderIds||[sameProj.orderId]).filter(Boolean),...objs.map(o=>o.id)])];
                        sameProj.equipmentIds=[...new Set([...(sameProj.equipmentIds||[]).map(String),...pg.equipmentIds.map(String)])];
                        sameProj.scheduledEquipmentIds=[...new Set([...(sameProj.scheduledEquipmentIds||[]).map(String),...pg.equipmentIds.map(String)])];
                        sameProj.budget=(Number(sameProj.budget)||0)+(Number(pg.value)||0);
                    }else{
                        monthlyProjections.push({id:plan.length>1?`${projId}-${k}`:projId,client,periodicity,month,year,date,budget:Number(pg.value)||0,equipmentIds:pg.equipmentIds,scheduledEquipmentIds:pg.equipmentIds,status:'SCHEDULED',orderId:objs[0].id,orderIds:objs.map(o=>o.id),zoneBaseId:baseId,maintenanceType:routineType});
                    }
                    orderObjs.push(...objs);
                }
                workOrders.push(...orderObjs);
                localStorage.setItem('HVAC_ORDERS_BACKUP',JSON.stringify(workOrders));localStorage.setItem('HVAC_PROJECTIONS_BACKUP',JSON.stringify(monthlyProjections));
                try{renderAdminDashboard();}catch(e){} try{renderPlanningModule();}catch(e){}
                closeNewRoutineModal();showToast(`Rutina creada en ${orderObjs.length} orden(es). Sincronizando…`);
                let cloudSaved=true;
                for(const o of orderObjs){try{const result=await Promise.race([cloudSaveOrder(o),new Promise(resolve=>setTimeout(()=>resolve('__HVAC_SAVE_TIMEOUT__'),20000))]);if(result==='__HVAC_SAVE_TIMEOUT__'||!result)cloudSaved=false;else try{registrarAuditoria('CREAR','hvac_orders',o.id);}catch(e){}}catch(e){cloudSaved=false;console.error('[Rutinas]',o.id,e);}}
                localStorage.setItem('HVAC_ORDERS_BACKUP',JSON.stringify(workOrders));localStorage.setItem('HVAC_PROJECTIONS_BACKUP',JSON.stringify(monthlyProjections));
                showToast(cloudSaved?`Rutina sincronizada: ${orderObjs.map(o=>o.id).join(', ')}.`:'Órdenes guardadas localmente; sincronización pendiente.',cloudSaved?'success':'error');
            }catch(err){console.error('[Rutinas] No se pudo crear:',err);showToast('No se pudo completar la creación. Revisa la conexión e inténtalo de nuevo.','error');}
            finally{nrSaving=false;if(submitBtn)submitBtn.disabled=false;if(submitLabel)submitLabel.textContent=originalLabel||'Registrar y Programar Rutina';}
        }

        function renderClientCatalog() {
            const tbody = document.getElementById('clients-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            const cq = normText((document.getElementById('client-search') || {}).value || ''), cqd = cq.replace(/\D/g, '');
            const filteredClients = !cq ? clientsCatalog : clientsCatalog.filter(c => [c.name, c.nit, c.phone, c.address].some(v => normText(v).includes(cq))
                || (cqd.length >= 3 && [c.nit, c.phone].some(v => String(v || '').replace(/\D/g, '').includes(cqd))));
            const clientList = getSortedClientRecords(filteredClients);
            const cnt = document.getElementById('client-search-count'); if (cnt) cnt.textContent = cq ? clientList.length + ' de ' + clientsCatalog.length : clientsCatalog.length + ' clientes';
            if (!clientList.length) tbody.innerHTML = '<tr><td colspan="8" class="text-center text-xs text-slate-400 py-8">Sin resultados para la búsqueda.</td></tr>';
            clientList.forEach(c => {
                const active = isClientActiveRecord(c);
                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td class="font-bold text-slate-900">${esc(c.name)}</td>
                    <td class="font-mono text-slate-600 text-xs">${esc(c.nit || '-')}</td>
                    <td>${esc(c.phone || '-')}</td>
                    <td class="text-slate-600">${esc(c.email || '-')}</td>
                    <td>${esc(c.address || '-')}</td>
                    <td><span class="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg font-mono text-xs font-semibold">${esc(getClientCostCenterLabel(c))}</span></td>
                    <td>${active ? '<span class="inline-flex px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">ACTIVO</span>' : '<span class="inline-flex px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 border border-slate-300">NO ACTIVO</span>'}</td>
                    <td class="text-right">
                        <div class="inline-flex gap-1.5 items-center">
                            <button onclick="toggleClientActive('${escJs(c.id)}')" class="px-2 py-1.5 text-[10px] font-bold rounded-lg ${active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}" title="${active ? 'Desactivar cliente' : 'Reactivar cliente'}">${active ? 'Desactivar' : 'Activar'}</button>
                            <button onclick="openClientModal('${escJs(c.id)}')" class="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition" title="Editar"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="deleteClientRecord('${escJs(c.id)}')" class="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                </tr>`);
            });
        }

        function openClientModal(id) {
            document.getElementById('client-modal-backdrop').classList.remove('hidden');
            if (id) {
                const c = clientsCatalog.find(x => x.id === id);
                document.getElementById('cli-modal-title').innerText = "Editar Cliente";
                document.getElementById('cli-f-id').value = c.id;
                document.getElementById('cli-f-name').value = c.name;
                document.getElementById('cli-f-nit').value = c.nit || '';
                document.getElementById('cli-f-phone').value = c.phone || '';
                document.getElementById('cli-f-email').value = c.email || '';
                document.getElementById('cli-f-address').value = c.address || '';
                document.getElementById('cli-f-costcenter-number').value = getClientCostCenterNumber(c);
                document.getElementById('cli-f-lat').value = c.lat ?? '';
                document.getElementById('cli-f-lng').value = c.lng ?? '';
                document.getElementById('cli-f-georadius').value = c.geoRadius || 150;
                document.getElementById('cli-f-active').checked = isClientActiveRecord(c);
                cliGeoInit(c);
            } else {
                document.getElementById('cli-modal-title').innerText = "Nuevo Cliente (Regular o Esporádico)";
                document.getElementById('cli-f-id').value = '';
                document.getElementById('cli-f-name').value = '';
                document.getElementById('cli-f-nit').value = '';
                document.getElementById('cli-f-phone').value = '';
                document.getElementById('cli-f-email').value = '';
                document.getElementById('cli-f-address').value = '';
                document.getElementById('cli-f-costcenter-number').value = '';
                document.getElementById('cli-f-lat').value = '';
                document.getElementById('cli-f-lng').value = '';
                document.getElementById('cli-f-georadius').value = 150;
                document.getElementById('cli-f-active').checked = true;
                cliGeoInit(null);
            }
        }

        function closeClientModal() {
            document.getElementById('client-modal-backdrop').classList.add('hidden');
        }

        async function saveClientRecord() {
            const id = document.getElementById('cli-f-id').value || `CLI-${Date.now()}`;
            const name = document.getElementById('cli-f-name').value.trim();
            if (!name) return showToast("El nombre del cliente es obligatorio.", "error");
            await cliGeoEnsure();   // si cambió la dirección, obtiene las coordenadas en segundo plano

            const costCenterNumber = document.getElementById('cli-f-costcenter-number').value.trim();
            const clientObj = {
                id, name,
                nit: document.getElementById('cli-f-nit').value.trim(),
                phone: document.getElementById('cli-f-phone').value.trim(),
                email: document.getElementById('cli-f-email').value.trim(),
                address: document.getElementById('cli-f-address').value.trim(),
                costCenterNumber,
                costCenterName: name,
                costCenter: costCenterNumber,
                lat: (parseFloat(document.getElementById('cli-f-lat').value) || parseFloat(document.getElementById('cli-f-lat').value) === 0) ? parseFloat(document.getElementById('cli-f-lat').value) : null,
                lng: (parseFloat(document.getElementById('cli-f-lng').value) || parseFloat(document.getElementById('cli-f-lng').value) === 0) ? parseFloat(document.getElementById('cli-f-lng').value) : null,
                latitud: parseFloat(document.getElementById('cli-f-lat').value) || null,
                longitud: parseFloat(document.getElementById('cli-f-lng').value) || null,
                geoRadius: parseInt(document.getElementById('cli-f-georadius').value, 10) || 150,
                active: !!document.getElementById('cli-f-active').checked
            };

            const idx = clientsCatalog.findIndex(c => c.id === id);
            const prevClient = idx >= 0 ? Object.assign({}, clientsCatalog[idx]) : null;   // para detectar si cambió la ubicación
            if (idx >= 0) clientsCatalog[idx] = clientObj;
            else clientsCatalog.push(clientObj);

            await cloudSaveClient(clientObj);
            try {   // recalcula todas las marcaciones del cliente con la ubicación guardada
                if (clientObj.lat != null && clientObj.lng != null) {
                    const nRec = await supabaseFetch('rpc/recalcular_marcaciones_cliente', 'POST', { p_cliente_id: String(clientObj.id) }, null, { quiet: true });
                    if (typeof nRec === 'number' && nRec > 0) showToast(nRec + ' marcación(es) recalculada(s) con la nueva ubicación.');
                    if (typeof attLoad === 'function' && document.getElementById('view-admin-attendance') && !document.getElementById('view-admin-attendance').classList.contains('hidden')) attLoad();
                }
            } catch (e) { console.warn('recalculo marcaciones', e); }
            try { attAfterClientSaved(clientObj, prevClient); } catch (e) { console.warn(e); }   // reevalúa y guarda el rango GPS de TODAS las marcaciones del cliente
            localStorage.setItem('HVAC_CLIENTS_BACKUP', JSON.stringify(clientsCatalog));
            populateClientDropdowns();
            renderClientCatalog();
            closeClientModal();
            showToast("Cliente guardado correctamente.");
        }

        async function toggleClientActive(id) {
            if (!isCurrentAdmin()) return showToast('Solo el administrador puede cambiar el estado de los clientes.', 'error');
            const client = clientsCatalog.find(c => String(c.id) === String(id));
            if (!client) return showToast('No se encontró el cliente.', 'error');
            const nextActive = !isClientActiveRecord(client);
            if (!window.confirm(nextActive
                ? `¿Reactivar a ${client.name}? Volverá a aparecer para crear rutinas y marcaciones GPS.`
                : `¿Marcar a ${client.name} como NO ACTIVO? Se conservará en el directorio, facturación e histórico, pero dejará de aparecer en los selectores operativos.`)) return;
            client.active = nextActive;
            if (!nextActive) client.estado = 'NO ACTIVO';
            else if (normText(client.estado) === 'no activo') client.estado = 'ACTIVO';
            localStorage.setItem('HVAC_CLIENTS_BACKUP', JSON.stringify(clientsCatalog));
            const saved = await cloudSaveClient(client);
            populateClientDropdowns();
            renderClientCatalog();
            if (saved) showToast(nextActive ? 'Cliente reactivado correctamente.' : 'Cliente marcado como NO ACTIVO. Sus datos e historial se conservaron.');
            else showToast('El cambio quedó guardado localmente y pendiente de sincronización.', 'error');
        }

        async function deleteClientRecord(id) {
            clientsCatalog = clientsCatalog.filter(c => c.id !== id);
            const okDel = await cloudDeleteClient(id);
            localStorage.setItem('HVAC_CLIENTS_BACKUP', JSON.stringify(clientsCatalog));
            populateClientDropdowns();
            renderClientCatalog();
            if (okDel) showToast("Cliente eliminado.");
            else showToast("Cliente quitado de este equipo; la eliminación en la nube queda pendiente y se reintentará.", "error");
        }

        function renderUsersModule() {
            const tbody = document.getElementById('users-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            systemUsers.forEach(u => {
                const isCurrent = u.id === activeUser;
                const roleBadge = u.role === 'ADMIN' ? '<span class="bg-amber-50 text-amber-700 border border-amber-200/60 text-[10px] font-black px-2.5 py-1 rounded-full">ADMIN</span>' : '<span class="bg-blue-50 text-blue-700 border border-blue-200/60 text-[10px] font-black px-2.5 py-1 rounded-full">TÉCNICO</span>';
                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td class="font-bold text-slate-900">${esc(u.name)} ${isCurrent ? '<span class="text-teal-600 text-xs font-semibold">(Tú)</span>' : ''}</td>
                    <td class="font-mono text-slate-700 text-xs font-bold">${esc(u.username)}</td>
                    <td>${roleBadge}</td>
                    <td class="font-mono text-slate-400">••••••••</td>
                    <td class="text-right">
                        <div class="inline-flex gap-1.5">
                            <button onclick="openUserEditorModal('${escJs(u.id)}')" class="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition"><i class="fa-solid fa-pen"></i></button>
                            ${!isCurrent ? `<button onclick="deleteUserRecord('${escJs(u.id)}')" class="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition"><i class="fa-solid fa-trash"></i></button>` : ''}
                        </div>
                    </td>
                </tr>`);
            });
        }

        function openUserEditorModal(id) {
            document.getElementById('user-edit-modal-backdrop').classList.remove('hidden');
            const pwd = document.getElementById('usr-f-password');
            pwd.value = '';
            if (id) {
                const u = systemUsers.find(x => x.id === id);
                document.getElementById('usr-modal-title').innerText = "Editar Usuario";
                document.getElementById('usr-f-id').value = u.id;
                document.getElementById('usr-f-name').value = u.name;
                document.getElementById('usr-f-username').value = u.username;
                document.getElementById('usr-f-role').value = u.role;
                pwd.required = false;
                pwd.placeholder = 'Dejar vacío para conservar la actual';
            } else {
                document.getElementById('usr-modal-title').innerText = "Nuevo Usuario";
                document.getElementById('usr-f-id').value = '';
                document.getElementById('usr-f-name').value = '';
                document.getElementById('usr-f-username').value = '';
                document.getElementById('usr-f-role').value = 'TECH';
                pwd.required = true;
                pwd.placeholder = 'Mínimo ' + AUTH_MIN_LEN + ' caracteres';
            }
        }

        function closeUserEditorModal() {
            document.getElementById('user-edit-modal-backdrop').classList.add('hidden');
        }

        async function saveUserRecord() {
            const id = document.getElementById('usr-f-id').value || `USR-${Date.now()}`;
            const name = document.getElementById('usr-f-name').value.trim();
            const username = document.getElementById('usr-f-username').value.trim().toLowerCase();
            const role = document.getElementById('usr-f-role').value;
            const password = document.getElementById('usr-f-password').value.trim();
            const existente = systemUsers.find(u => u.id === id);

            if (!name || !username) return showToast("Completa todos los campos obligatorios.", "error");
            if (!existente && !password) return showToast("La contraseña es obligatoria para usuarios nuevos.", "error");
            if (password && (password.length < AUTH_MIN_LEN || password === '123')) {
                return showToast("La contraseña debe tener al menos " + AUTH_MIN_LEN + " caracteres.", "error");
            }

            const dup = systemUsers.find(u => u.username.toLowerCase() === username && u.id !== id);
            if (dup) return showToast("El usuario ya existe en el sistema.", "error");

            const userObj = Object.assign({}, existente || {}, { id, name, username, role });
            if (password) {
                userObj.passwordHash = hashPassword(password);
                delete userObj.password;
                if (id === activeUser) delete userObj.debeCambiarClave; else userObj.debeCambiarClave = true; // el usuario la cambia en su primer ingreso
            } else if (!userObj.passwordHash && userObj.password) {
                userObj.passwordHash = hashPassword(userObj.password);
                delete userObj.password;
            }
            const idx = systemUsers.findIndex(u => u.id === id);
            if (idx >= 0) systemUsers[idx] = userObj;
            else systemUsers.push(userObj);

            await cloudSaveUser(userObj);
            localStorage.setItem('HVAC_USERS_BACKUP', JSON.stringify(systemUsers));
            populateTechDropdown();
            renderUsersModule();
            closeUserEditorModal();
            showToast("Usuario guardado con éxito.");
        }

        async function deleteUserRecord(id) {
            if (id === activeUser) return showToast("No puedes eliminar el usuario en sesión activa.", "error");
            systemUsers = systemUsers.filter(u => u.id !== id);
            const okDel = await cloudDeleteUser(id);
            localStorage.setItem('HVAC_USERS_BACKUP', JSON.stringify(systemUsers));
            populateTechDropdown();
            renderUsersModule();
            if (okDel) showToast("Usuario eliminado.");
            else showToast("Usuario quitado de este equipo; la eliminación en la nube queda pendiente y se reintentará.", "error");
        }

        function getChecklistProgressMetrics(eq, exec) {
            const typeKey = String((eq && eq.type) || 'EXTRACTOR').trim().toUpperCase();
            const cfg = (exec && exec.formConfigSnapshot) || equipmentFormsConfig[typeKey] || equipmentFormsConfig['EXTRACTOR'] || {};
            const items = String(cfg.checklist || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
            const checks = (exec && exec.checklist) || {};
            const missing = [];
            let done = 0;
            items.forEach((label, i) => {
                const checked = checks['chk_' + (i + 1)] === true || checks['check_' + (i + 1)] === true || checks[i] === true;
                if (checked) done++; else missing.push(label);
            });
            return { done, total: items.length, missing, percent: items.length ? Math.round(done / items.length * 100) : 0 };
        }

        function getLatestEquipmentProgress(eq) {
            const matches = [];
            (workOrders || []).forEach(order => {
                const ids = (order.equipmentIds || []).map(String);
                const included = ids.includes(String(eq.id)) || ids.includes(String(eq.code));
                if (!included && !eqBelongsToClient(eq, order.client)) return;
                const executions = order.executions || {};
                const exec = executions[eq.id] || executions[eq.code] || executions[String(eq.id)] || executions[String(eq.code)];
                if (!exec) return;
                matches.push({ order, exec });
            });
            matches.sort((a, b) => compareOrdersDesc(a.order, b.order));
            if (!matches.length) return null;
            return { ...matches[0], metrics: getChecklistProgressMetrics(eq, matches[0].exec) };
        }

        function renderEquipmentCatalog() {
            syncEquipmentClientSelectors();      // en tiempo real: refleja altas/bajas de Gestión de Clientes
            const filterClient = document.getElementById('eq-filter-client').value || 'ALL';
            const query = normText(document.getElementById('eq-search-input').value);
            const tbody = document.getElementById('equipments-table-body');
            tbody.innerHTML = '';

            const list = equipmentCatalog.filter(e => {
                const matchClient = matchesClientFilter(eqClientName(e), filterClient);
                const matchQuery = !query || [e.code, e.name, e.serial, e.brand, e.model, e.type].some(v => normText(v).includes(query));
                return matchClient && matchQuery;
            });

            const sig = filterClient + '|' + query;
            if (sig !== equipmentPager.sig) { equipmentPager.sig = sig; equipmentPager.page = 1; }
            const total = list.length;
            const pages = Math.max(1, Math.ceil(total / PAGER_ROWS));
            equipmentPager.page = Math.min(Math.max(1, equipmentPager.page), pages);
            const startIdx = (equipmentPager.page - 1) * PAGER_ROWS;
            const pageList = list.slice(startIdx, startIdx + PAGER_ROWS);
            if (!total) {
                tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 font-medium">${eqBackgroundLoading ? 'Cargando equipos…' : 'No hay equipos que coincidan con los filtros.'}</td></tr>`;
            }

            pageList.forEach(e => {
                const latestProgress = getLatestEquipmentProgress(e);
                let progressCell = '<span class="text-xs text-slate-400">Sin intervención</span>';
                if (latestProgress) {
                    const m = latestProgress.metrics;
                    const state = m.total > 0 && m.done === m.total ? 'Completo' : m.done > 0 ? 'En progreso' : 'Pendiente';
                    const stateClass = state === 'Completo' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : state === 'En progreso' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-slate-600 bg-slate-100 border-slate-200';
                    const missingText = m.missing.length ? 'Ítems faltantes: ' + m.missing.join(' · ') : 'Checklist completo';
                    progressCell = `<div title="${esc(missingText)}" class="min-w-[150px] space-y-1"><div class="flex items-center justify-between gap-2"><span class="text-[10px] font-bold px-2 py-1 rounded-full border ${stateClass}">${state}</span><span class="text-[10px] font-black text-slate-700">${m.percent}%</span></div><div class="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden"><div class="bg-teal-500 h-1.5 rounded-full" style="width:${m.percent}%"></div></div><div class="text-[10px] text-slate-500">${m.done}/${m.total} ítems · Orden ${esc(latestProgress.order.id || '—')}</div>${m.missing.length ? `<div class="text-[10px] text-amber-700">Faltan: ${esc(m.missing.slice(0,3).join(', '))}${m.missing.length > 3 ? '…' : ''}</div>` : ''}</div>`;
                }
                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td class="font-bold font-mono text-teal-700 text-xs">${esc(e.code || '-')}</td>
                    <td class="font-bold text-slate-800">${esc(eqClientName(e) || '-')}</td>
                    <td class="font-bold text-slate-900">${esc(e.name || '-')}</td>
                    <td class="font-mono text-slate-600 text-xs">${esc(e.serial || '-')}</td>
                    <td><span class="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-semibold">${esc(e.type || '-')}</span></td>
                    <td class="font-semibold text-slate-700">${esc(e.brand || '-')}</td>
                    <td class="text-slate-600 text-xs">${esc(e.model || '-')}</td>
                    <td class="font-medium text-slate-700">${esc(e.capacity || '-')}</td>
                    <td>${progressCell}</td>
                    <td class="text-right">
                        <div class="inline-flex gap-1.5">
                            <button onclick="openEquipmentHistoryModal('${escJs(e.id)}')" class="p-2 text-purple-600 hover:bg-purple-50 rounded-xl transition" title="Historial del Equipo"><i class="fa-solid fa-clock-rotate-left"></i></button>
                            <button onclick="openEquipmentModal('${escJs(e.id)}')" class="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition" title="Editar Equipo"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="deleteEquipmentRecord('${escJs(e.id)}')" class="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition" title="Eliminar Equipo"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                </tr>`);
            });
            updatePager('equipments-table-body', {
                page: equipmentPager.page, pages, hasNext: equipmentPager.page < pages,
                meta: `Mostrando ${total ? startIdx + 1 : 0}-${Math.min(startIdx + PAGER_ROWS, total)} de ${total} equipos${eqBackgroundLoading ? ' · cargando más…' : ''}`,
                onPrev: () => { equipmentPager.page = Math.max(1, equipmentPager.page - 1); renderEquipmentCatalog(); },
                onNext: () => { equipmentPager.page = Math.min(pages, equipmentPager.page + 1); renderEquipmentCatalog(); }
            });
        }

        async function openEquipmentModal(id) {
            // Para registrar/editar equipos, el selector usa exclusivamente la tabla oficial hvac_clients.
            // No se rellena desde respaldos locales: si la nube falla, se bloquea el formulario para evitar clientes obsoletos.
            const clientRows = navigator.onLine
                ? await supabaseFetch('hvac_clients?select=id,payload', 'GET', null, null, { quiet: true })
                : null;
            if (!Array.isArray(clientRows)) {
                showToast('No fue posible consultar Gestión de Clientes en Supabase. Verifica la conexión e inténtalo de nuevo.', 'error');
                return;
            }
            clientsCatalog = clientRows
                .filter(row => row && row.payload && String(row.payload.name || '').trim())
                .map(row => ({ ...row.payload, id: row.payload.id || row.id }));
            populateClientDropdowns();
            const zoneNewInput=document.getElementById('eq-f-zone-new');if(zoneNewInput)zoneNewInput.value='';
            const clientSelect = document.getElementById('eq-f-client');
            if (clientSelect) {
                clientSelect.innerHTML = '<option value="">-- Selecciona un Cliente --</option>' +
                    getSortedClientRecords().filter(isClientActiveRecord).map(c => `<option value="${corrEsc(c.name)}">${corrEsc(c.name)}</option>`).join('');
            }
            await window.hvacLoadZonesForClient?.(document.getElementById('eq-f-client')?.value || '');
            document.getElementById('equipment-modal-backdrop').classList.remove('hidden');
            if (id) {
                const e = equipmentCatalog.find(x => x.id === id);
                document.getElementById('eq-modal-title').innerText = "Editar Equipo";
                document.getElementById('eq-f-id').value = e.id;
                {
                    const cs = document.getElementById('eq-f-client'), cn = canonicalClientName(eqClientName(e));
                    if (cn && !Array.from(cs.options).some(o => o.value === cn)) cs.insertAdjacentHTML('beforeend', `<option value="${corrEsc(cn)}">${corrEsc(cn)} (no registrado en Gestión de Clientes)</option>`);
                    cs.value = cn;
                }
                await window.hvacLoadZonesForClient?.(eqClientName(e));
                document.getElementById('eq-f-zone').value = e.zoneId || '';
                document.getElementById('eq-f-code').value = e.code || '';
                document.getElementById('eq-f-name').value = e.name || '';
                document.getElementById('eq-f-serial').value = e.serial || '';
                document.getElementById('eq-f-type').value = e.type || '';
                document.getElementById('eq-f-brand').value = e.brand || '';
                document.getElementById('eq-f-model').value = e.model || '';
                document.getElementById('eq-f-capacity').value = e.capacity || '';
            } else {
                document.getElementById('eq-modal-title').innerText = "Nuevo Equipo";
                document.getElementById('eq-f-id').value = '';
                document.getElementById('eq-f-code').value = '';
                document.getElementById('eq-f-name').value = '';
                document.getElementById('eq-f-serial').value = '';
                document.getElementById('eq-f-type').value = '';
                document.getElementById('eq-f-brand').value = '';
                document.getElementById('eq-f-model').value = '';
                document.getElementById('eq-f-capacity').value = '';
                document.getElementById('eq-f-zone').value = '';
                const zoneNew=document.getElementById('eq-f-zone-new');if(zoneNew)zoneNew.value='';
            }
        }

        function closeEquipmentModal() {
            document.getElementById('equipment-modal-backdrop').classList.add('hidden');
        }

        async function saveEquipmentRecord() {
            const client = document.getElementById('eq-f-client').value;
            const code = document.getElementById('eq-f-code').value.trim();
            if (!client || !code) return showToast("Cliente y Código son campos obligatorios.", "error");
            if (!clientsCatalog.some(c => String(c.name || '') === String(client))) {
                return showToast("El cliente seleccionado ya no existe en Gestión de Clientes. Actualiza el listado y vuelve a intentarlo.", "error");
            }

            const id = document.getElementById('eq-f-id').value || hvacUUID();
            const eqObj = {
                id, client, code,
                name: document.getElementById('eq-f-name').value.trim(),
                serial: document.getElementById('eq-f-serial').value.trim(),
                type: document.getElementById('eq-f-type').value.trim(),
                brand: document.getElementById('eq-f-brand').value.trim(),
                model: document.getElementById('eq-f-model').value.trim(),
                capacity: document.getElementById('eq-f-capacity').value.trim(),
                zoneId: document.getElementById('eq-f-zone')?.value || '',
                zoneName: (window.HVAC_ZONES_CACHE || []).find(z => String(z.id) === String(document.getElementById('eq-f-zone')?.value || ''))?.name || ''
            };
            linkClientFields(eqObj, client); // nombre oficial + clientId

            const idx = equipmentCatalog.findIndex(e => e.id === id);
            if (idx >= 0 && equipmentCatalog[idx].qr) eqObj.qr = equipmentCatalog[idx].qr; // el QR generado se conserva siempre
            if (idx >= 0) equipmentCatalog[idx] = eqObj;
            else equipmentCatalog.push(eqObj);

            await cloudSaveEquipment(eqObj);
            localStorage.setItem('HVAC_EQUIPMENTS_BACKUP', JSON.stringify(equipmentCatalog));
            renderEquipmentCatalog();
            closeEquipmentModal();
            showToast("Equipo guardado correctamente.");
        }

        async function deleteEquipmentRecord(id) {
            equipmentCatalog = equipmentCatalog.filter(e => e.id !== id);
            const okDel = await cloudDeleteEquipment(id);
            localStorage.setItem('HVAC_EQUIPMENTS_BACKUP', JSON.stringify(equipmentCatalog));
            renderEquipmentCatalog();
            if (okDel) showToast("Equipo eliminado.");
            else showToast("Equipo quitado de este equipo; la eliminación en la nube queda pendiente y se reintentará.", "error");
        }

        async function openEquipmentHistoryModal(eqId) {
            const eq = equipmentCatalog.find(e => e.id === eqId) || equipmentCatalog.find(e => e.code === eqId);
            if (!eq) return;

            document.getElementById('equipment-history-modal-backdrop').classList.remove('hidden');
            document.getElementById('eq-hist-modal-title').innerText = `Trazabilidad: ${eq.code} - ${eq.name || 'Sin nombre'}`;
            document.getElementById('eq-hist-modal-subtitle').innerText = `Cliente: ${eqClientName(eq)} | Serial: ${eq.serial || 'N/A'}`;

            const container = document.getElementById('eq-hist-timeline-container');
            container.innerHTML = '<div class="text-center py-10 text-slate-400 font-medium text-xs">Buscando intervenciones de este equipo…</div>';

            // Trazabilidad liviana: solo metadatos y observaciones del equipo.
            // Las fotos/ejecuciones completas se descargan al pulsar Revisar o generar el PDF.
            if (navigator.onLine) {
                const keys = [...new Set([eq.id, eq.code].filter(Boolean).map(String))];
                const idPath = encodeURIComponent(String(eq.id));
                const codePath = encodeURIComponent(String(eq.code));
                const select = [
                    'order_id:payload->>id', 'client:payload->>client',
                    'order_date:payload->>date', 'technician:payload->>technician',
                    'equipment_ids:payload->equipmentIds',
                    'exec_obs_by_id:payload->executions->' + idPath + '->>obs',
                    'exec_obs_by_code:payload->executions->' + codePath + '->>obs'
                ].join(',');
                const found = await Promise.all(keys.map(k => supabaseFetch(
                    'hvac_orders?select=' + select + '&order=payload->>date.desc&limit=100&payload=cs.' + encodeURIComponent(JSON.stringify({ equipmentIds: [k] })),
                    'GET', null, null, { quiet: true })));
                found.forEach(rows => {
                    if (!Array.isArray(rows)) return;
                    mergeOrderSummariesIntoList(rows.map(r => {
                        if (!r || !r.order_id) return null;
                        const executions = {};
                        if (r.exec_obs_by_id != null) executions[eq.id] = { obs: r.exec_obs_by_id };
                        if (r.exec_obs_by_code != null) executions[eq.code] = { obs: r.exec_obs_by_code };
                        return {
                            id: String(r.order_id), client: r.client || '', date: r.order_date || '',
                            technician: r.technician || '', equipmentIds: Array.isArray(r.equipment_ids) ? r.equipment_ids : [],
                            executions, _hvacSummaryOnly: true
                        };
                    }).filter(Boolean));
                });
            }

            container.innerHTML = '';
            const historyRecords = [];
            workOrders.forEach(order => {
                const ex = order.executions || {};
                const ids = (order.equipmentIds || []).map(String);
                let exec = null;
                if (ids.includes(String(eq.id))) exec = ex[eq.id] || ex[eq.code];
                else if ((ids.includes(String(eq.code)) || !ids.length) && eqBelongsToClient(eq, order.client)) exec = ex[eq.code]; // códigos repetidos entre clientes: solo el mismo cliente
                if (exec) historyRecords.push({ orderId: order.id, date: order.date, technician: order.technician, exec, order });
            });

            historyRecords.sort((a, b) => compareOrdersDesc(a.order, b.order));

            if (historyRecords.length === 0) {
                container.innerHTML = `<div class="text-center py-10 text-slate-400 font-medium text-xs bg-slate-50 rounded-2xl border border-slate-100">Este equipo no registra intervenciones técnicas guardadas todavía.</div>`;
                return;
            }

            historyRecords.forEach(item => {
                const ex = item.exec;
                container.insertAdjacentHTML('beforeend', `
                    <div class="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-sm space-y-2.5">
                        <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                            <div>
                                <span class="font-mono font-bold text-xs text-teal-700 bg-teal-50 px-2.5 py-1 rounded-lg">Orden: ${esc(item.orderId)}</span>
                                <span class="text-xs text-slate-500 ml-2"><i class="fa-solid fa-calendar text-teal-600"></i> ${esc(item.date)}</span>
                            </div>
                            <button onclick="generateSingleEquipmentPDF('${escJs(item.orderId)}', '${escJs(eq.id)}')" class="bg-purple-600 hover:bg-purple-700 text-white font-bold text-[11px] px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition shadow-sm">
                                <i class="fa-solid fa-file-pdf"></i> PDF de este Equipo
                            </button>
                        </div>
                        <p class="text-xs text-slate-700"><strong>Técnico:</strong> ${esc(item.technician)}</p>
                        <p class="text-xs text-slate-600 bg-slate-50 p-2 rounded-xl"><strong>Observaciones:</strong> ${esc(ex.obs || 'Sin observaciones registradas.')}</p>
                    </div>
                `);
            });
        }

        function closeEquipmentHistoryModal() {
            document.getElementById('equipment-history-modal-backdrop').classList.add('hidden');
        }

        // =========================================================================
        // HUB DE MANTENIMIENTO CON PESTAÑAS Y GESTIÓN DE EQUIPOS AISLADA DE LA BASE
        // =========================================================================
        async function openOrderHub(orderId) {
            currentExecOrderId = orderId;
            let order = workOrders.find(o => String(o.id) === String(orderId));
            if (!order) return;
            if (order._hvacSummaryOnly && typeof hvacEnsureFullOrder === 'function') {
                order = await hvacEnsureFullOrder(orderId);
                if (!order) { showToast('No se pudo cargar el detalle de la orden. Revisa la conexión e inténtalo de nuevo.', 'error'); return; }
            }

            document.getElementById('order-hub-modal-backdrop').classList.remove('hidden');
            document.getElementById('hub-order-title').innerText = `Orden ${order.id}${order.zoneName ? ' · ' + order.zoneName : ''} - ${order.client}`;
            document.getElementById('hub-order-subtitle').innerText = `Técnico: ${order.technician} | Fecha: ${order.date}`;

            currentHubTab = 'equipos';
            updateHubTabButtons();
            renderOrderHubEquipments(order);
            if ((order.equipmentIds || []).some(id => !equipmentCatalog.some(e => String(e.id) === String(id) || String(e.code) === String(id)))) {
                await ensureOrderEquipments(order); // solo los equipos de esta orden
                if (String(currentExecOrderId) === String(orderId)) renderOrderHubEquipments(order);
            }
        }

        function closeOrderHubModal() {
            document.getElementById('order-hub-modal-backdrop').classList.add('hidden');
            currentExecOrderId = null;
        }

        function switchHubTab(tab) {
            currentHubTab = tab;
            updateHubTabButtons();
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (order) renderOrderHubEquipments(order);
        }

        function updateHubTabButtons() {
            const btnEq = document.getElementById('hub-tab-btn-equipos');
            const btnCorr = document.getElementById('hub-tab-btn-correctivos');
            const pdfBtnText = document.getElementById('btn-hub-pdf-text');

            if (currentHubTab === 'equipos') {
                btnEq.className = "pb-2 font-black text-xs text-teal-600 border-b-2 border-teal-600 transition";
                btnCorr.className = "pb-2 font-black text-xs text-slate-400 hover:text-slate-700 transition";
                pdfBtnText.innerText = "Informe General";
            } else {
                btnEq.className = "pb-2 font-black text-xs text-slate-400 hover:text-slate-700 transition";
                btnCorr.className = "pb-2 font-black text-xs text-amber-600 border-b-2 border-amber-600 transition";
                pdfBtnText.innerText = "Informe Correctivos";
            }
        }

        function handleHubPdfDownload() {
            if (currentHubTab === 'equipos') {
                generateConsolidatedRoutinePDFDirect(false);
            } else {
                generateConsolidatedRoutinePDFDirect(true);
            }
        }

        async function openAddEquipmentToJobModal() {
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (!order) return;
            const selectEl = document.getElementById('select-eq-to-add');
            selectEl.innerHTML = '<option value="">-- Selecciona un equipo del catálogo --</option>';

            document.getElementById('add-eq-job-modal-backdrop').classList.remove('hidden');
            await ensureClientEquipments(order.client);
            // Solo equipos del MISMO cliente de la orden (evita asignar equipos de otro cliente).
            equipmentCatalog.filter(e => eqBelongsToClient(e, order.client)).forEach(e => {
                if (!(order.equipmentIds || []).includes(e.id)) {
                    selectEl.innerHTML += `<option value="${esc(e.id)}">${esc(e.code)} - ${esc(e.name || e.type || 'Sin nombre')} (${esc(eqClientName(e))})</option>`;
                }
            });

            document.getElementById('add-eq-job-modal-backdrop').classList.remove('hidden');
        }

        function closeAddEquipmentToJobModal() {
            document.getElementById('add-eq-job-modal-backdrop').classList.add('hidden');
        }

        async function confirmAddEquipmentToJob() {
            const order = workOrders.find(o => o.id === currentExecOrderId);
            const eqId = document.getElementById('select-eq-to-add').value;
            if (!order || !eqId) return showToast("Selecciona un equipo válido.", "error");

            if (!order.equipmentIds) order.equipmentIds = [];
            if (order.equipmentIds.some(id => String(id) === String(eqId))) return showToast('Ese equipo ya está asignado a la orden.', 'error');
            const wasCompleted = String(order.status || '').toUpperCase() === 'COMPLETED';
            order.equipmentIds.push(eqId);
            if (wasCompleted) {
                order.status = 'PENDING';
                order.clientSignature = null;
            }
            order.updatedAt = new Date().toISOString();

            await cloudSaveOrder(order, { dup: true });
            registrarAuditoria('EDITAR', 'hvac_orders', order.id);
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            closeAddEquipmentToJobModal();
            renderOrderHubEquipments(order);
            showToast("Equipo agregado a la orden (el catálogo general permanece intacto).");
        }

        async function removeEquipmentFromJob(eqId) {
            const actingUser = systemUsers.find(u => String(u.id) === String(activeUser));
            if (!actingUser || actingUser.role !== 'ADMIN' || activeSessionRole !== 'ADMIN') {
                showToast("Solo el perfil de administrador puede quitar equipos de una rutina.", "error");
                return;
            }
            const order = workOrders.find(o => String(o.id) === String(currentExecOrderId));
            if (!order) return;

            // Quitar por id, código o cualquier alias (sin depender del tipo string/número)
            const eq = equipmentCatalog.find(e => String(e.id) === String(eqId) || String(e.code) === String(eqId));
            const alias = new Set([eqId, eq && eq.id, eq && eq.code].filter(Boolean).map(String));
            order.equipmentIds = (order.equipmentIds || []).filter(id => !alias.has(String(id)));
            Object.keys(order.executions || {}).forEach(k => { if (alias.has(String(k))) delete order.executions[k]; });
            order.updatedAt = new Date().toISOString();
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            renderOrderHubEquipments(order);

            // Guardar y VERIFICAR en la nube (incluye filas duplicadas de la misma orden)
            const saved = await cloudSaveOrder(order);
            let verified = false;
            if (saved) {
                const mine = cloudCleanId(order.id);
                const rows = await supabaseFetch('hvac_orders?select=id&limit=20&payload->>id=eq.' + encodeURIComponent(order.id), 'GET', null, null, { quiet: true });
                if (Array.isArray(rows)) {
                    for (const r of rows) {
                        if (String(r.id) === mine) continue;
                        console.warn('[Rutina] Fila duplicada de la orden, se actualiza:', r.id);
                        await supabaseFetch('hvac_orders?id=eq.' + encodeURIComponent(r.id), 'PATCH', { payload: order }, { 'Prefer': 'return=minimal' }, { quiet: true });
                    }
                }
                const own = await supabaseFetch('hvac_orders?select=equipment_ids:payload->equipmentIds&id=eq.' + encodeURIComponent(mine), 'GET', null, null, { quiet: true });
                verified = Array.isArray(own) && !!own[0] && (own[0].equipment_ids || []).length === order.equipmentIds.length;
            }
            registrarAuditoria('EDITAR', 'hvac_orders', order.id);
            showToast(verified ? "Equipo removido y confirmado en la nube." : "Se quitó aquí, pero la nube NO confirmó el cambio (" + (cloudCtl.lastStatus || 'sin respuesta') + (cloudCtl.lastDetail ? ' · ' + cloudCtl.lastDetail.slice(0, 120) : '') + "). Quedó en cola y se reintentará.", verified ? 'success' : 'error');
        }

        function renderOrderHubEquipments(order) {
            const container = document.getElementById('hub-equipments-list');
            container.innerHTML = '';

            const eqIds = order.equipmentIds || [];
            let completedCount = 0;
            let displayList = [];

            eqIds.forEach(eqId => {
                const eq = equipmentCatalog.find(e => e.id === eqId || e.code === eqId) || { code: eqId, name: 'Desconocido', type: 'HVAC' };
                const exec = (order.executions && (order.executions[eqId] || order.executions[eq.id] || order.executions[eq.code]));
                const isDone = hvacExecutionIsFinalized(order, eqId);
                if (isDone) completedCount++;

                const itemObj = { eqId, eq, exec, isDone };

                if (currentHubTab === 'correctivos') {
                    if (exec && exec.corrective) displayList.push(itemObj);
                } else {
                    displayList.push(itemObj);
                }
            });

            if (displayList.length === 0) {
                const msg = currentHubTab === 'correctivos' 
                    ? "No hay equipos con novedades correctivas registrados en esta rutina." 
                    : "No hay equipos asignados a esta orden. Usa el botón 'Agregar Equipo'.";
                container.innerHTML = `<div class="text-center py-8 text-slate-400 font-medium text-xs bg-slate-50 rounded-2xl border border-slate-100">${msg}</div>`;
            }

            displayList.forEach(({ eqId, eq, exec, isDone }) => {
                container.insertAdjacentHTML('beforeend', `<div class="p-4 bg-white border border-slate-200/80 rounded-2xl flex items-center justify-between shadow-sm">
                    <div>
                        <div class="flex items-center gap-2.5">
                            <span class="font-mono font-black text-slate-900 text-xs bg-slate-100 px-2 py-0.5 rounded-md">${esc(eq.code)}</span>
                            <span class="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full ${isDone ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-slate-100 text-slate-600'}">${isDone ? 'REALIZADO' : 'PENDIENTE'}</span>
                            ${exec && exec.corrective ? '<span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shadow-sm">CORRECTIVO</span>' : ''}
                        </div>
                        <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
                            <p><strong class="text-slate-800">Nombre:</strong> ${esc(eq.name || '—')}</p>
                            <p><strong class="text-slate-800">Tipo:</strong> ${esc(eq.type || '—')}</p>
                            <p><strong class="text-slate-800">Capacidad:</strong> ${esc(eq.capacity || '—')}</p>
                            <p><strong class="text-slate-800">Marca:</strong> ${esc(eq.brand || '—')}</p>
                            <p><strong class="text-slate-800">Modelo:</strong> ${esc(eq.model || '—')}</p>
                            <p><strong class="text-slate-800">Serie:</strong> ${esc(eq.serial || '—')}</p>
                            <p><strong class="text-slate-800">Código:</strong> ${esc(eq.code || '—')}</p>
                        </div>
                        ${exec && exec.corrective ? `<p class="text-xs text-amber-800 font-medium mt-1 bg-amber-50 p-2 rounded-xl border border-amber-200"><strong>Novedad:</strong> ${esc(exec.correctiveDesc || 'Sin descripción')}</p>` : ''}
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="openEquipmentExecutionModal('${escJs(order.id)}', '${escJs(eqId)}')" class="px-3.5 py-2 text-xs font-bold rounded-xl transition ${isDone ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'btn-teal'}">
                            ${isDone ? '<i class="fa-solid fa-pen"></i> Editar' : '<i class="fa-solid fa-play"></i> Intervenir'}
                        </button>
                        ${activeSessionRole === 'ADMIN' && systemUsers.some(u => String(u.id) === String(activeUser) && u.role === 'ADMIN')
                            ? `<button onclick="removeEquipmentFromJob('${escJs(eqId)}')" class="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition" title="Quitar equipo de la orden"><i class="fa-solid fa-trash"></i></button>`
                            : ''}
                    </div>
                `);
            });

            const percent = eqIds.length > 0 ? Math.round((completedCount / eqIds.length) * 100) : 0;
            document.getElementById('hub-progress-bar').style.width = `${percent}%`;
            document.getElementById('hub-progress-text').innerText = `${completedCount} de ${eqIds.length} equipos finalizados (${percent}%)`;

            const finalizeBox = document.getElementById('hub-finalize-container');
            const allFinalized = eqIds.length > 0 && completedCount === eqIds.length;
            if (!allFinalized) {
                finalizeBox.classList.remove('hidden');
                const h = finalizeBox.querySelector('h4');
                const p = finalizeBox.querySelector('p');
                const btn = finalizeBox.querySelector('button');
                if (h) h.textContent = 'Rutina pendiente de ejecución';
                if (p) p.textContent = `${eqIds.length - completedCount} equipo(s) pendiente(s). Continúa trabajando antes de cerrar la orden.`;
                if (btn) { btn.innerHTML = '<i class="fa-solid fa-play"></i> Continuar Ejecutando Rutina'; btn.onclick = () => { const pending = eqIds.find(id => !hvacExecutionIsFinalized(order, id)); if (pending != null) openEquipmentExecutionModal(order.id, String(pending)); }; }
            } else if (String(order.status || '').toUpperCase() !== 'COMPLETED' && String(order.status || '').toUpperCase() !== 'BILLED') {
                finalizeBox.classList.remove('hidden');
                const h = finalizeBox.querySelector('h4');
                const p = finalizeBox.querySelector('p');
                const btn = finalizeBox.querySelector('button');
                if (h) h.textContent = '¡Todos los equipos finalizados!';
                if (p) p.textContent = 'Todos los equipos tienen su informe completo. Ya puedes cerrar la orden.';
                if (btn) { btn.innerHTML = '<i class="fa-solid fa-file-signature"></i> Finalizar Rutina y Recabar Firma'; btn.onclick = () => openGlobalSignatureModal(); }
            } else {
                finalizeBox.classList.add('hidden');
            }
        }

        // Edición de texto/evidencias sin reejecutar ni sustituir un informe ya guardado.
        function hvacAdminExecPhotos(exec) {
            const out = [], seen = new Set();
            ['photos', 'fotosAntes', 'fotosDespues', 'fotosAdicionales'].forEach(key => {
                (Array.isArray(exec && exec[key]) ? exec[key] : []).forEach(photo => {
                    if (!photo) return;
                    const signature = typeof photo === 'string' ? photo : JSON.stringify(photo);
                    if (!seen.has(signature)) { seen.add(signature); out.push(photo); }
                });
            });
            return out;
        }
        function hvacAdminHasExecPhoto(exec) {
            return Number(exec && exec.photosCount) > 0 || hvacAdminExecPhotos(exec).length > 0;
        }
        function hvacAdminShowAmendmentMode(enabled) {
            const set = (id, show) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !show); };
            ['exec-admin-params-section', 'exec-admin-checklist-section', 'exec-admin-corrective-section', 'exec-admin-obs-section', 'exec-admin-photos-section']
                .forEach(id => set(id, !enabled));
            set('exec-admin-amendment-panel', enabled);
            const button = document.querySelector('#exec-equipment-modal-backdrop form button[type="submit"]');
            if (button) button.innerHTML = enabled
                ? '<i class="fa-solid fa-clock-rotate-left"></i> Guardar modificación posterior'
                : '<i class="fa-solid fa-floppy-disk"></i> Guardar Intervención';
        }
        async function adminAmendProcessWithAI() {
            const order = workOrders.find(o => String(o.id) === String(currentExecOrderId));
            if (!order) return showToast('No se encontró la orden para procesar.', 'error');
            const routineType = String(billingRoutineType(order) || '').toUpperCase();
            if (!['REVISION', 'CORRECTIVO'].includes(routineType)) {
                return showToast('El procesamiento administrativo con IA está disponible para revisión y correctivo.', 'info');
            }

            const eq = equipmentCatalog.find(e => String(e.id) === String(currentExecEqId) || String(e.code) === String(currentExecEqId)) || { id: currentExecEqId, code: currentExecEqId, name: 'Equipo HVAC' };
            const obs = String(document.getElementById('exec-admin-amend-obs')?.value || '').trim();
            const development = String(document.getElementById('exec-admin-amend-development')?.value || '').trim();
            const technical = String(document.getElementById('exec-admin-amend-technical')?.value || '').trim();
            const corrective = String(document.getElementById('exec-admin-amend-corrective')?.value || '').trim();
            const rawParts = [];
            if (obs) rawParts.push('Notas originales del técnico:\n' + obs);
            if (development) rawParts.push('Desarrollo u observaciones ya registradas:\n' + development);
            if (technical) rawParts.push('Observaciones técnicas adicionales:\n' + technical);
            if (corrective) rawParts.push('Novedad o correctivo registrado:\n' + corrective);
            const raw = rawParts.join('\n\n').trim();
            if (raw.replace(/\s/g, '').length < 5) {
                return showToast('No hay notas ni desarrollo para enviar a la IA. Agrega primero el texto del informe.', 'error');
            }

            const out = document.getElementById('exec-admin-amend-development');
            const conclusion = document.getElementById('exec-admin-amend-conclusion');
            const correctiveField = document.getElementById('exec-admin-amend-corrective');
            const btn = document.getElementById('exec-admin-amend-ai-btn');
            const status = document.getElementById('exec-admin-amend-ai-status');
            const hasExistingOutput = !!(out.value.trim() || conclusion.value.trim());
            if (hasExistingOutput && !confirm('La IA volverá a redactar el desarrollo y la conclusión de este equipo usando las notas disponibles. ¿Deseas reemplazar esos dos campos? Las notas originales y las demás observaciones se conservarán.')) return;

            const originalLabel = btn ? btn.innerHTML : '';
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando…'; }
            if (status) { status.classList.remove('hidden'); status.textContent = 'Procesando…'; }
            try {
                const response = await fetch('/api/ia/asistente-notas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        notas_brutas: raw,
                        tipo_servicio: routineType,
                        equipo_codigo: String(eq.code || currentExecEqId || ''),
                        equipo_nombre: String(eq.name || eq.type || 'Equipo HVAC')
                    })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !String(data.notas_analiticas || '').trim() || !String(data.conclusion || '').trim()) {
                    throw new Error(data.error || `La IA respondió con estado ${response.status}.`);
                }
                out.value = String(data.notas_analiticas).trim();
                conclusion.value = String(data.conclusion).trim();
                // Solo completa la novedad si la IA detecta un correctivo y el campo estaba vacío; nunca borra lo ya escrito.
                if (data.requiere_correctivo === true && !correctiveField.value.trim() && data.descripcion_correctivo) {
                    correctiveField.value = String(data.descripcion_correctivo).trim();
                }
                if (status) { status.classList.remove('hidden'); status.textContent = 'Texto procesado. Revisa los campos y guarda los cambios.'; }
                showToast('IA procesó el informe de este equipo. Revisa y guarda los cambios.', 'success');
            } catch (error) {
                console.error('[IA Administración] No se pudo procesar el informe:', error);
                if (status) { status.classList.remove('hidden'); status.textContent = 'No se pudo procesar: ' + String(error.message || error).slice(0, 220); }
                showToast('No se pudo procesar con IA: ' + String(error.message || error).slice(0, 140), 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = originalLabel || '✨ Procesar texto con IA'; }
            }
        }

        function renderAdminAmendmentPhotoPreview() {
            const box = document.getElementById('exec-admin-amend-photo-preview');
            if (!box) return;
            const order = workOrders.find(o => String(o.id) === String(currentExecOrderId));
            const exec = order && order.executions && (order.executions[adminAmendmentExecKey] || order.executions[currentExecEqId]) || {};
            const existing = hvacAdminExecPhotos(exec);
            const renderCard = (src, label) => `<div class="admin-amend-photo-card relative w-20 h-20 rounded-xl overflow-hidden"><img src="${esc(typeof src === 'string' ? src : (src.url || src.src || src.dataUrl || ''))}" alt="${esc(label)}" class="w-full h-full object-cover"><span class="absolute inset-x-0 bottom-0 bg-slate-950/70 text-white text-[9px] text-center py-1">${esc(label)}</span></div>`;
            box.innerHTML = existing.map((src, i) => renderCard(src, 'Existente ' + (i + 1))).join('') +
                adminAmendmentNewPhotos.map((src, i) => `<div class="relative">${renderCard(src, 'Nueva ' + (i + 1))}<button type="button" onclick="removeAdminAmendmentPhoto(${i})" class="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-600 text-white text-xs" aria-label="Quitar foto nueva">×</button></div>`).join('');
            if (!box.innerHTML) box.innerHTML = '<p class="text-[11px] text-slate-400">No hay fotografías adjuntas en este equipo.</p>';
        }
        function removeAdminAmendmentPhoto(index) {
            adminAmendmentNewPhotos.splice(Number(index), 1);
            renderAdminAmendmentPhotoPreview();
        }
        async function handleAdminAmendmentPhotoChange(input) {
            const files = Array.from(input && input.files || []);
            if (input) input.value = '';
            if (!files.length) return;
            appBusyStart('Comprimiendo y subiendo evidencias adicionales…');
            try {
                for (const file of files) {
                    if (adminAmendmentNewPhotos.length >= 8) {
                        showToast('Puedes anexar máximo 8 fotografías nuevas por modificación.', 'error');
                        break;
                    }
                    try {
                        const stored = await r2keep(await compressImage(file, 1000, 0.72), 'reportes');
                        if (stored) adminAmendmentNewPhotos.push(stored);
                        else showToast('Una fotografía no pudo guardarse en el almacenamiento.', 'error');
                    } catch (error) {
                        console.warn('[Modificación posterior] Foto no agregada:', error);
                        showToast('No se pudo procesar una de las fotografías.', 'error');
                    }
                }
                renderAdminAmendmentPhotoPreview();
            } finally { appBusyEnd(); }
        }
        const adminAmendPhotoInput = document.getElementById('exec-admin-amend-photos');
        if (adminAmendPhotoInput) adminAmendPhotoInput.addEventListener('change', e => handleAdminAmendmentPhotoChange(e.currentTarget));

        async function saveAdminExecutionAmendment() {
            const order = workOrders.find(o => String(o.id) === String(currentExecOrderId));
            if (!order) return showToast('No se encontró la orden que deseas modificar.', 'error');
            const eq = equipmentCatalog.find(e => String(e.id) === String(currentExecEqId) || String(e.code) === String(currentExecEqId)) || { id: currentExecEqId, code: currentExecEqId };
            if (!order.executions) order.executions = {};
            const key = adminAmendmentExecKey || currentExecEqId;
            const storedExisting = order.executions[key] || order.executions[eq.id] || order.executions[eq.code];
            if ((!storedExisting || typeof storedExisting !== 'object') && !adminAmendmentIsPostCompletion) {
                return showToast('Todavía no existe una ejecución guardada para modificar. La orden permanece intacta.', 'error');
            }

            const now = new Date().toISOString();
            // Algunas órdenes históricas quedaron cerradas sin que existiera un objeto de ejecución.
            // En ese caso se crea un registro documental mínimo, sin inventar checklist/mediciones,
            // y sin cambiar estado, firma ni cierre de la orden.
            const createdPostCompletionRecord = !storedExisting || typeof storedExisting !== 'object';
            const existing = createdPostCompletionRecord ? {
                status: 'FINALIZADO',
                timestamp: now,
                typeKey: resolveFormTypeKey(eq.type),
                maintenanceType: billingRoutineType(order),
                formConfigSnapshot: { params: '', checklist: '' },
                paramsValues: {},
                checklist: {},
                legacyPostCompletionRecord: true
            } : storedExisting;
            const next = { ...existing };
            const fields = {
                obs: document.getElementById('exec-admin-amend-obs').value,
                notasAnaliticas: document.getElementById('exec-admin-amend-development').value,
                conclusion: document.getElementById('exec-admin-amend-conclusion').value,
                correctiveDesc: document.getElementById('exec-admin-amend-corrective').value,
                observaciones_tecnicas: document.getElementById('exec-admin-amend-technical').value
            };
            const changedFields = [];
            Object.entries(fields).forEach(([field, value]) => {
                const normalized = String(value == null ? '' : value);
                if (String(existing[field] == null ? '' : existing[field]) !== normalized) changedFields.push(field);
                next[field] = normalized;
            });

            const oldAdditional = Array.isArray(existing.fotosAdicionales) ? existing.fotosAdicionales : [];
            const additions = adminAmendmentNewPhotos.slice();
            if (additions.length) {
                next.fotosAdicionales = [...oldAdditional, ...additions];
                const oldGeneric = Array.isArray(existing.photos) ? existing.photos : [];
                next.photos = [...oldGeneric, ...additions];
                changedFields.push('fotosAdicionales');
            } else if (!Array.isArray(next.fotosAdicionales)) {
                next.fotosAdicionales = oldAdditional;
            }

            if (!changedFields.length && !additions.length) {
                return showToast('No hay cambios para guardar. La orden y su firma permanecen intactas.', 'info');
            }

            // En órdenes que siguen abiertas, también se exige evidencia para contar el equipo como completado.
            // En órdenes cerradas se conserva la compatibilidad histórica y jamás se retira su firma.
            if (!adminAmendmentIsPostCompletion) {
                next.evidenceRequired = true;
                next.evidenceRequirementVersion = 1;
                next.evidenceMissing = !hvacAdminHasExecPhoto(next);
            }

            const previousHistory = Array.isArray(existing.adminModifications) ? existing.adminModifications : [];
            const changes = changedFields.filter(field => Object.prototype.hasOwnProperty.call(fields, field)).map(field => ({
                field,
                before: String(existing[field] == null ? '' : existing[field]),
                after: String(next[field] == null ? '' : next[field])
            }));
            next.adminModifications = previousHistory.concat([{
                id: (window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : 'ADM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                at: now,
                by: auditUsuario(),
                type: billingRoutineType(order),
                afterClosure: !!adminAmendmentIsPostCompletion,
                createdPostCompletionRecord,
                fieldsChanged: [...new Set(changedFields)],
                changes,
                photosAdded: additions.length,
                preservedOrderStatus: order.status || null,
                preservedSignature: !!(order.clientSignature && (order.clientSignature.signatureImg || order.clientSignature.image || order.clientSignature.timestamp))
            }]).slice(-50);
            next.adminModifiedAt = now;
            next.adminModifiedBy = auditUsuario();

            order.executions[key] = next;
            if (eq.id != null) order.executions[eq.id] = next;
            if (eq.code) order.executions[eq.code] = next;
            // No se modifica status, clientSignature, signatureDecision ni technicianFinished.
            order.updatedAt = now;

            const saved = await cloudSaveOrder(order);
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            registrarAuditoria(adminAmendmentIsPostCompletion ? 'MODIFICACION_POSTERIOR' : 'EDICION_ADMINISTRATIVA', 'hvac_orders', order.id);
            adminAmendmentNewPhotos = [];
            closeEquipmentExecutionModal();
            renderOrderHubEquipments(order);
            if (typeof renderAgendaModule === 'function') renderAgendaModule();
            showToast(saved
                ? 'Modificación guardada en la orden. Se conservaron el cierre y la firma del cliente.'
                : 'Modificación guardada localmente y pendiente de sincronización. Se conservaron el cierre y la firma.', saved ? 'success' : 'error');
        }

        // =========================================================================
        // FORMULARIO DINÁMICO SEGÚN TIPO DE EQUIPO (EXTRACTOR, MINISPLIT, ETC.)
        // =========================================================================
        function openEquipmentExecutionModal(orderId, eqId) {
            currentExecOrderId = orderId;
            currentExecEqId = eqId;
            const order = workOrders.find(o => o.id === orderId);
            const eq = equipmentCatalog.find(e => String(e.id) === String(eqId) || String(e.code) === String(eqId)) || { id: eqId, code: eqId, type: 'EXTRACTOR' };
            const executionMap = order.executions || {};
            const execKey = executionMap[eqId] ? eqId : (executionMap[eq.id] ? eq.id : (executionMap[eq.code] ? eq.code : eqId));
            const exec = (executionMap[execKey] || executionMap[eqId] || executionMap[eq.id] || executionMap[eq.code]) || {};

            const routineType = typeof billingRoutineType === 'function' ? billingRoutineType(order) : String(order.maintenanceType || order.tipoRutina || 'PREVENTIVO').toUpperCase();
            const signatureDecision = String(order.signatureDecision || '').toUpperCase();
            const hasSignature = !!(order.clientSignature && (order.clientSignature.signatureImg || order.clientSignature.image || order.clientSignature.timestamp));
            adminAmendmentIsPostCompletion = ['COMPLETED', 'BILLED'].includes(String(order.status || '').toUpperCase()) || ['SIGNED', 'DECLINED'].includes(signatureDecision) || hasSignature;
            adminAmendmentMode = adminAmendmentIsPostCompletion || routineType !== 'PREVENTIVO';
            adminAmendmentExecKey = execKey;
            adminAmendmentNewPhotos = [];
            hvacAdminShowAmendmentMode(adminAmendmentMode);

            const typeKey = resolveFormTypeKey(eq.type);
            const formCfg = equipmentFormsConfig[typeKey] || equipmentFormsConfig['EXTRACTOR'] || {
                params: "Voltaje (V), Amperaje (A)",
                checklist: "Limpieza general"
            };

            document.getElementById('exec-equipment-modal-backdrop').classList.remove('hidden');
            document.getElementById('exec-modal-eq-title').innerText = `Intervención: ${eq.code} - ${eq.name || ''} (${typeKey})`;
            document.getElementById('exec-modal-eq-subtitle').innerText =
                `${order.client} | ${eq.name || 'Sin nombre'} | ${eq.type || 'Sin tipo'} | Capacidad: ${eq.capacity || 'N/A'} | Marca: ${eq.brand || 'N/A'} | Modelo: ${eq.model || 'N/A'} | Serie: ${eq.serial || 'N/A'} | Código: ${eq.code || 'N/A'}`;

            // Renderizar Parámetros Técnicos dinámicos
            const paramsContainer = document.getElementById('exec-params-container');
            paramsContainer.innerHTML = '';
            const paramList = formCfg.params.split(',').map(p => p.trim()).filter(Boolean);

            paramList.forEach((paramName, idx) => {
                const paramKey = `param_${idx}`;
                const val = exec.paramsValues ? exec.paramsValues[paramKey] : (exec[paramKey] || '');
                paramsContainer.insertAdjacentHTML('beforeend', `
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">${esc(paramName)}</label>
                        <input type="text" data-param-key="${paramKey}" class="input-box text-xs font-bold exec-param-input" value="${esc(val)}" placeholder="Valor...">
                    </div>
                `);
            });

            // Renderizar Checklist dinámico
            const checkContainer = document.getElementById('exec-checklist-container');
            checkContainer.innerHTML = '';
            const checkListItems = formCfg.checklist.split('\n').map(c => c.trim()).filter(Boolean);

            checkListItems.forEach((checkText, idx) => {
                const chkKey = `chk_${idx + 1}`;
                const chks = exec.checklist || {};
                const isChecked = !!chks[chkKey];
                checkContainer.insertAdjacentHTML('beforeend', `
                    <label class="flex items-center gap-2.5 p-2.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl cursor-pointer font-medium text-slate-700 transition">
                        <input type="checkbox" data-chk-key="${chkKey}" ${isChecked ? 'checked' : ''} class="rounded text-teal-600 focus:ring-teal-500 w-4 h-4 exec-chk-input">
                        <span>${checkText}</span>
                    </label>
                `);
            });

            document.getElementById('exec-f-obs').value = exec.obs || '';

            const chkCorr = document.getElementById('exec-chk-correctivo');
            chkCorr.checked = !!exec.corrective;
            document.getElementById('exec-corrective-desc').value = exec.correctiveDesc || '';
            toggleCorrectiveSection();

            tempPhotosList = hvacAdminExecPhotos(exec);
            renderExecPhotosPreview();

            if (adminAmendmentMode) {
                document.getElementById('exec-modal-eq-title').innerText = `Modificar informe: ${eq.code} · ${routineType}`;
                document.getElementById('exec-admin-amend-obs').value = String(exec.obs || '');
                document.getElementById('exec-admin-amend-development').value = String(
                    exec.notasAnaliticas || exec.observaciones_tecnicas || exec.observaciones || exec.notas_tecnicas || exec.correctiveDesc || ''
                );
                document.getElementById('exec-admin-amend-conclusion').value = String(exec.conclusion || '');
                document.getElementById('exec-admin-amend-corrective').value = String(exec.correctiveDesc || '');
                document.getElementById('exec-admin-amend-technical').value = String(exec.observaciones_tecnicas || exec.observaciones || exec.notas_tecnicas || '');
                const corrWrap = document.getElementById('exec-admin-amend-corrective-wrap');
                if (corrWrap) corrWrap.classList.toggle('hidden', routineType !== 'CORRECTIVO' && !exec.corrective && !exec.correctiveDesc);
                const aiWrap = document.getElementById('exec-admin-amend-ai-wrap');
                if (aiWrap) aiWrap.classList.toggle('hidden', !['REVISION', 'CORRECTIVO'].includes(routineType));
                const aiStatus = document.getElementById('exec-admin-amend-ai-status');
                if (aiStatus) { aiStatus.textContent = ''; aiStatus.classList.add('hidden'); }
                renderAdminAmendmentPhotoPreview();
            }
        }

        function closeEquipmentExecutionModal() {
            document.getElementById('exec-equipment-modal-backdrop').classList.add('hidden');
            currentExecEqId = null;
            adminAmendmentMode = false;
            adminAmendmentIsPostCompletion = false;
            adminAmendmentNewPhotos = [];
            adminAmendmentExecKey = null;
            hvacAdminShowAmendmentMode(false);
        }

        function toggleCorrectiveSection() {
            const chk = document.getElementById('exec-chk-correctivo').checked;
            const box = document.getElementById('corrective-details-box');
            box.classList.toggle('hidden', !chk);
            renderExecPhotosPreview();
        }

        document.getElementById('exec-f-photos').addEventListener('change', async function(e) {
            const files = e.target.files;
            if (!files) return;
            appBusyStart('Comprimiendo fotos de evidencia…');
            try {
            const isCorrective = document.getElementById('exec-chk-correctivo').checked;
            const maxAllowed = isCorrective ? 6 : 5;

            for (let i = 0; i < files.length; i++) {
                if (tempPhotosList.length >= maxAllowed) {
                    showToast(`Has alcanzado el límite máximo de ${maxAllowed} fotos permitidas.`, "error");
                    break;
                }
                try {
                    const compressedBase64 = await r2keep(await compressImage(files[i], 1000, 0.72), 'reportes');
                    tempPhotosList.push(compressedBase64);
                    renderExecPhotosPreview();
                } catch (err) {
                    console.warn('[Fotos] No se agregó la imagen seleccionada:', err);
                }
            }
            } finally {
                appBusyEnd();
            }
            e.target.value = '';
        });

        function viewExecutionPhoto(index) {
            const photo = tempPhotosList[index];
            if (!photo) return;
            document.getElementById('receipt-viewer-img').src = photo;
            document.getElementById('receipt-viewer-modal-backdrop').classList.remove('hidden');
        }

        function renderExecPhotosPreview() {
            const cont = document.getElementById('exec-photos-preview');
            cont.innerHTML = '';
            tempPhotosList.forEach((p, idx) => {
                cont.insertAdjacentHTML('beforeend', `<div class="relative w-24 h-24 rounded-xl overflow-hidden border border-slate-200 shadow-sm group">
                    <button type="button" onclick="viewExecutionPhoto(${idx})" class="w-full h-full cursor-zoom-in" title="Ampliar foto cargada">
                        <img src="${p}" alt="Foto de evidencia ${idx + 1}" class="w-full h-full object-cover">
                    </button>
                    <button type="button" aria-label="Eliminar foto ${idx + 1}" onclick="tempPhotosList.splice(${idx},1); renderExecPhotosPreview();" class="absolute top-1 right-1 bg-rose-600 text-white min-w-7 h-7 px-1 text-[10px] rounded-lg flex items-center justify-center gap-1 shadow"><i class="fa-solid fa-trash"></i></button>
                    <span class="absolute bottom-0 inset-x-0 bg-slate-950/70 text-white text-[9px] font-bold text-center py-1">Foto ${idx + 1} · Quitar con papelera</span>
                </div>`);
            });
        }

        async function saveEquipmentExecution() {
            if (adminAmendmentMode) return saveAdminExecutionAmendment();
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (!order) return;
            if (!Array.isArray(tempPhotosList) || tempPhotosList.length < 1) {
                showToast('No puedes completar este equipo sin evidencia fotográfica. Agrega mínimo una foto.', 'error');
                const photoInput = document.getElementById('exec-f-photos');
                if (photoInput) photoInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            if (!order.executions) order.executions = {};

            const missingParams = Array.from(document.querySelectorAll('.exec-param-input')).filter(input => !String(input.value || '').trim());
            const uncheckedItems = Array.from(document.querySelectorAll('.exec-chk-input')).filter(input => !input.checked);
            if (missingParams.length || uncheckedItems.length) {
                const firstMissing = missingParams[0] || uncheckedItems[0];
                showToast(missingParams.length
                    ? `Completa todos los parámetros técnicos obligatorios (${missingParams.length} pendiente(s)).`
                    : `Marca todos los puntos del checklist (${uncheckedItems.length} pendiente(s)).`, "error");
                if (firstMissing) {
                    firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    firstMissing.focus();
                }
                return;
            }

            const paramsValues = {};
            document.querySelectorAll('.exec-param-input').forEach(input => {
                paramsValues[input.getAttribute('data-param-key')] = input.value;
            });

            const checklist = {};
            document.querySelectorAll('.exec-chk-input').forEach(chk => {
                checklist[chk.getAttribute('data-chk-key')] = chk.checked;
            });

            const corrective = document.getElementById('exec-chk-correctivo').checked;
            const correctiveDesc = document.getElementById('exec-corrective-desc').value.trim();

            const eq = equipmentCatalog.find(e => e.id === currentExecEqId || e.code === currentExecEqId);
            const typeKey = resolveFormTypeKey(eq && eq.type);
            const formCfg = equipmentFormsConfig[typeKey] || equipmentFormsConfig['EXTRACTOR'];

            const execData = {
                status: 'FINALIZADO',
                finalizedAt: new Date().toISOString(),
                typeKey,
                formConfigSnapshot: formCfg, // Guardamos la foto exacta del formulario activo para que el PDF refleje exactamente los campos editados
                paramsValues,
                checklist,
                obs: document.getElementById('exec-f-obs').value,
                corrective,
                correctiveDesc,
                photos: tempPhotosList,
                evidenceRequired: true,
                evidenceRequirementVersion: 1,
                evidenceMissing: false,
                timestamp: new Date().toISOString()
            };

            order.executions[currentExecEqId] = execData;
            if (eq && eq.code) order.executions[eq.code] = execData;
            // Una edición administrativa nunca retira la firma ya registrada.

            // Un único ítem de agenda por cliente: agrega, actualiza o retira este equipo del pendiente del cliente
            syncClientCorrective(order, eq, corrective, correctiveDesc, execData.timestamp);

            await cloudSaveOrder(order);
            registrarAuditoria('EDITAR', 'hvac_orders', order.id);
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            closeEquipmentExecutionModal();
            renderOrderHubEquipments(order);
            renderAgendaModule();
            showToast("Intervención de equipo registrada con su formulario adaptado.");
        }

        function openGlobalSignatureModal() {
            document.getElementById('global-signature-modal-backdrop').classList.remove('hidden');
            setTimeout(initSignatureCanvas, 100);
        }

        function closeGlobalSignatureModal() {
            document.getElementById('global-signature-modal-backdrop').classList.add('hidden');
        }

        function initSignatureCanvas() {
            sigCanvas = document.getElementById('global-sig-canvas');
            sigCtx = sigCanvas.getContext('2d');
            sigCanvas.width = sigCanvas.offsetWidth;
            sigCanvas.height = sigCanvas.offsetHeight;
            sigCtx.strokeStyle = '#0f172a';
            sigCtx.lineWidth = 2.5;
            sigCtx.lineCap = 'round';

            const getPos = e => {
                const rect = sigCanvas.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return { x: clientX - rect.left, y: clientY - rect.top };
            };

            const start = e => { isDrawing = true; const p = getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); };
            const draw = e => { if (!isDrawing) return; const p = getPos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); };
            const stop = () => { isDrawing = false; };

            sigCanvas.onmousedown = start;
            sigCanvas.onmousemove = draw;
            window.onmouseup = stop;
            sigCanvas.ontouchstart = start;
            sigCanvas.ontouchmove = draw;
            sigCanvas.ontouchend = stop;
        }

        function clearSignatureCanvas() {
            if (sigCtx) sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
        }

        async function submitGlobalSignature() {
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (!order) return;
            const progress = hvacOrderProgress(order);
            if (!progress.complete) return showToast(`No se puede cerrar: ${progress.pending} equipo(s) siguen pendientes.`, 'error');
            const clientName = document.getElementById('sig-client-name').value.trim();
            const sigData = await r2keep(sigCanvas.toDataURL('image/png'), 'firmas');

            order.clientSignature = { name: clientName || order.client, signatureImg: sigData, timestamp: new Date().toISOString() };
            order.status = 'COMPLETED';
            hvacToolPickupRequest(order);   // camino 2: queda pendiente la recogida de herramientas

            await cloudSaveOrder(order);
            registrarAuditoria('COMPLETAR', 'hvac_orders', order.id);
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            closeGlobalSignatureModal();
            closeOrderHubModal();
            renderAdminDashboard();
            renderPlanningModule();
            renderBillingModule();
            showToast(billingRoutineType(order) === 'REVISION' ? "Revisión completada con firma." : "Rutina completada con firma. Lista para facturar; herramientas pendientes de recogida.");
        }

        async function finalizeRoutineWithoutSignature() {
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (!order) return;
            const progress = hvacOrderProgress(order);
            if (!progress.complete) return showToast(`No se puede cerrar: ${progress.pending} equipo(s) siguen pendientes.`, 'error');

            order.clientSignature = { name: 'Completado sin firma', signatureImg: null, timestamp: new Date().toISOString() };
            order.status = 'COMPLETED';
            hvacToolPickupRequest(order);   // camino 2: queda pendiente la recogida de herramientas

            await cloudSaveOrder(order);
            registrarAuditoria('COMPLETAR', 'hvac_orders', order.id);
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            closeGlobalSignatureModal();
            closeOrderHubModal();
            renderAdminDashboard();
            renderPlanningModule();
            renderBillingModule();
            showToast(billingRoutineType(order) === 'REVISION' ? "Revisión finalizada sin firma." : "Rutina finalizada sin firma. Lista para facturar; herramientas pendientes de recogida.");
        }

        // =========================================================================
        // GENERACIÓN DE PDF OFICIAL (LOGOTIPO AFC CORPORATIVO REAL Y FORMULARIO DINÁMICO)
        // =========================================================================
        // =========================================================================
        // MOTOR PDF AFC (estructura visual de hoja1.html) - encabezado/pie en cada hoja
        // =========================================================================
        const AFC_NAVY = [27, 54, 93];

        // ============================================================
        // FOTOS EN EL PDF: descarga robusta (R2 / Supabase / base64) -> JPEG en base64
        // jsPDF.addImage() NO acepta URLs: necesita data URI. Aquí se convierten todas
        // las fotos antes de dibujar el PDF, con reintentos, timeout y cache-busting.
        // ============================================================
        const AFC_PHOTO_CACHE = new Map();   // src original -> data:image/jpeg;base64,...
        function afcPhotoSrc(p) {
            if (!p) return '';
            if (typeof p === 'string') return p.trim();
            return String(p.url || p.src || p.data || p.dataUrl || p.path || '').trim();
        }
        function afcBlobToDataUrl(blob) {
            return new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onload = () => res(fr.result);
                fr.onerror = () => rej(new Error('FileReader'));
                fr.readAsDataURL(blob);
            });
        }
        // Re-codifica a JPEG (jsPDF no soporta WEBP/HEIC/GIF) y limita el lado mayor para PDFs livianos.
        function afcToJpegDataUrl(src, maxDim = 1600, quality = 0.85) {
            return new Promise((res, rej) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        let w = img.naturalWidth, h = img.naturalHeight;
                        if (!w || !h) return rej(new Error('Imagen vacía'));
                        const k = Math.min(1, maxDim / Math.max(w, h));
                        w = Math.round(w * k); h = Math.round(h * k);
                        const c = document.createElement('canvas'); c.width = w; c.height = h;
                        const x = c.getContext('2d');
                        x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);   // evita fondo negro en PNG/WEBP transparentes
                        x.drawImage(img, 0, 0, w, h);
                        res(c.toDataURL('image/jpeg', quality));
                    } catch (e) { rej(e); }
                };
                img.onerror = () => rej(new Error('No se pudo decodificar la imagen'));
                img.src = src;
            });
        }
        async function afcFetchBlob(url, bust) {
            const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
            try {
                const u = bust ? url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now() : url;
                const r = await fetch(u, { mode: 'cors', credentials: 'omit', cache: bust ? 'reload' : 'default', signal: ctl.signal });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const b = await r.blob();
                if (!b || !b.size) throw new Error('Respuesta vacía');
                return b;
            } finally { clearTimeout(t); }
        }
        // <img crossOrigin> + canvas: último recurso si fetch() es bloqueado pero el bucket sí envía CORS en imágenes
        function afcLoadViaCanvas(url) {
            return new Promise((res, rej) => {
                const img = new Image(); img.crossOrigin = 'anonymous';
                const t = setTimeout(() => rej(new Error('Timeout')), 20000);
                img.onload = () => { clearTimeout(t); afcToJpegDataUrl(img.src).then(res, rej); };
                img.onerror = () => { clearTimeout(t); rej(new Error('Canvas/CORS')); };
                img.src = url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
            });
        }
        async function afcResolvePhoto(raw) {
            const src = afcPhotoSrc(raw);
            if (!src) return null;
            if (AFC_PHOTO_CACHE.has(src)) return AFC_PHOTO_CACHE.get(src);
            let val = src;
            // Solo caché de HVAC.img (NO resolve(): hace una lectura XHR síncrona que bloquea la pantalla)
            try { if (window.HVAC && HVAC.img && HVAC.img.cache && HVAC.img.cache.has(src)) val = HVAC.img.cache.get(src) || src; } catch (e) {}
            let out = null;
            try {
                if (/^data:image\//i.test(val)) {
                    out = /^data:image\/jpe?g/i.test(val) ? val : await afcToJpegDataUrl(val).catch(() => val);
                } else if (/^(https?:)?\/\//i.test(val) || /^blob:/i.test(val)) {
                    let blob = null, lastErr = null;
                    for (const bust of [false, true]) {          // 2.º intento ignora caché sin CORS
                        try { blob = await afcFetchBlob(val, bust); break; } catch (e) { lastErr = e; }
                    }
                    if (blob) {
                        const d = await afcBlobToDataUrl(blob);
                        out = /^data:image\/jpe?g/i.test(d) ? d : await afcToJpegDataUrl(d);
                    } else {
                        try { out = await afcLoadViaCanvas(val); }
                        catch (e2) { throw lastErr || e2; }
                    }
                } else {
                    console.warn('[PDF] Formato de foto no reconocido:', src.slice(0, 80));
                }
            } catch (e) {
                console.warn('[PDF] No se pudo cargar la foto:', src.slice(0, 120), e && e.message);
            }
            if (out) AFC_PHOTO_CACHE.set(src, out);   // los fallos no se cachean: se reintentan en la próxima descarga
            return out;
        }
        // Descarga todas las fotos (4 en paralelo). Devuelve { total, failed }.
        async function afcPreloadPhotos(photoList) {
            const list = (photoList || []).filter(p => afcPhotoSrc(p));
            let i = 0, failed = 0;
            const worker = async () => { while (i < list.length) { const p = list[i++]; if (!(await afcResolvePhoto(p))) failed++; } };
            await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
            return { total: list.length, failed };
        }
        function afcCollectPhotos(order, eqIds) {
            const all = [];
            (eqIds || []).forEach(id => {
                const eq = equipmentCatalog.find(e => e.id === id || e.code === id);
                const ex = order.executions && (order.executions[id] || (eq && (order.executions[eq.id] || order.executions[eq.code])));
                if (ex && Array.isArray(ex.photos)) all.push(...ex.photos);
            });
            return all;
        }
        function afcReportPhotoStats(st) {
            if (st && st.failed) showToast(`${st.failed} de ${st.total} foto(s) no se pudieron descargar y no aparecerán en el PDF. Revisa la conexión o el CORS del bucket.`, 'error');
        }

        // ===== Mes y fecha de ejecución para la cabecera del informe PDF =====
        const AFC_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const AFC_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        function afcExecInfo(order, execs) {
            const p2 = n => String(n).padStart(2, '0'), m = String(order.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
            const info = { month: 'No registrado', date: 'No registrada', short: '', time: 'No registrada' };
            if (m) {                                             // la fecha "YYYY-MM-DD" se lee tal cual: sin desfases de zona horaria
                const y = +m[1], mo = +m[2], d = +m[3], wd = AFC_DIAS[new Date(y, mo - 1, d).getDay()];
                info.month = `${AFC_MESES[mo - 1]} ${y}`;
                info.short = `${p2(d)}/${p2(mo)}/${y}`;
                info.date = `${wd.charAt(0).toUpperCase() + wd.slice(1)}, ${d} de ${AFC_MESES[mo - 1].toLowerCase()} de ${y}`;
            }
            // Hora real de la intervención: marcas de tiempo con que el técnico guardó cada equipo
            const ts = (execs || []).map(e => e && e.timestamp ? new Date(e.timestamp) : null).filter(t => t && !isNaN(t)).sort((a, b) => a - b);
            if (ts.length) {
                const day = t => `${p2(t.getDate())}/${p2(t.getMonth() + 1)}/${t.getFullYear()}`, hm = t => `${p2(t.getHours())}:${p2(t.getMinutes())}`, a = ts[0], z = ts[ts.length - 1];
                info.time = day(a) === day(z) ? `${day(a)} · ${hm(a)}${hm(a) === hm(z) ? '' : ' – ' + hm(z)}` : `${day(a)} ${hm(a)} → ${day(z)} ${hm(z)}`;
            }
            return info;
        }
        function afcSetMeta(doc, order, info) {                  // metadatos del archivo PDF
            try { doc.setProperties({ title: `Informe de mantenimiento ${order.id} - ${order.client || ''}${hvacOrderZoneLabel(order) ? ' - ' + hvacOrderZoneLabel(order) : ''}`, subject: `Mes de ejecución: ${info.month} · Fecha: ${info.short || info.date}`, author: 'Alejandro Faccini y Compañía S.A.S.', keywords: `${order.id}, ${info.month}` }); } catch (e) { console.warn('[PDF] metadatos', e); }
        }

        function afcPdfCreate(orderId) {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('portrait', 'mm', 'letter');
            const PW = doc.internal.pageSize.getWidth();
            const PH = doc.internal.pageSize.getHeight();
            const M = 15, CW = PW - 2 * M;
            const IMG_H = CW * 93 / 1241;            // proporción real de las imágenes (1241x93)
            const HEAD_Y = 6, FOOT_Y = PH - 6 - IMG_H;
            const TOP = HEAD_Y + IMG_H + 12;         // inicio útil del contenido
            const BOTTOM = FOOT_Y - 4;               // fin útil (nunca invade el pie)
            const ctx = { doc, PW, PH, M, CW, TOP, BOTTOM, y: TOP };

            ctx.decorate = () => {
                try { doc.addImage(AFC_HEADER_IMG, 'JPEG', M, HEAD_Y, CW, IMG_H); } catch (e) { console.warn('Header img', e); }
                try { doc.addImage(AFC_FOOTER_IMG, 'JPEG', M, FOOT_Y, CW, IMG_H); } catch (e) { console.warn('Footer img', e); }
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(15, 23, 42);
                doc.text(`ORDEN: ${orderId}`, M + 1, HEAD_Y + IMG_H + 5);
                doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
                doc.text('Bogotá, D.C. Colombia', PW - M - 1, HEAD_Y + IMG_H + 5, { align: 'right' });
                doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.25);
                doc.line(M, HEAD_Y + IMG_H + 7.5, PW - M, HEAD_Y + IMG_H + 7.5);
                ctx.y = TOP;
            };
            ctx.newPage = () => { doc.addPage(); ctx.decorate(); };
            ctx.ensure = (h) => { if (ctx.y + h > BOTTOM) { ctx.newPage(); return true; } return false; };
            ctx.gap = (h) => { ctx.y += h; };

            ctx.pageTitle = (text, size = 11) => {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(15, 23, 42);
                const lines = doc.splitTextToSize(String(text), CW);
                ctx.ensure(lines.length * (size * 0.45) + 3);
                doc.text(lines, M, ctx.y + size * 0.3);
                ctx.y += lines.length * (size * 0.45) + 3;
            };
            ctx.paragraph = (text, size = 8.5, color = [51, 65, 85]) => {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
                const lines = doc.splitTextToSize(String(text), CW);
                const lh = size * 0.43;
                ctx.ensure(lines.length * lh + 3);
                doc.text(lines, M, ctx.y + size * 0.32);
                ctx.y += lines.length * lh + 3;
            };
            ctx.sectionTitle = (text, followH = 14) => {
                ctx.ensure(6.4 + followH);
                doc.setFillColor(...AFC_NAVY);
                doc.roundedRect(M, ctx.y, CW, 6.4, 1.2, 1.2, 'F');
                doc.rect(M, ctx.y + 3.2, CW, 3.2, 'F');
                doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255);
                doc.text(String(text).toUpperCase(), M + 3, ctx.y + 4.4);
                ctx.y += 6.4;
            };
            // Cuadrícula de datos (etiqueta pequeña + valor), 2 columnas
            ctx.infoGrid = (pairs) => {
                const colW = CW / 2;
                for (let i = 0; i < pairs.length; i += 2) {
                    const cells = [pairs[i], pairs[i + 1]].filter(Boolean);
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
                    const vLines = cells.map(c => doc.splitTextToSize(String(c[1] ?? '-'), colW - 6));
                    const h = 6.2 + Math.max(...vLines.map(l => l.length)) * 3.6 + 1.2;
                    ctx.ensure(h);
                    doc.setFillColor(248, 250, 252); doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.2);
                    doc.rect(M, ctx.y, CW, h, 'FD');
                    if (cells.length > 1) doc.line(M + colW, ctx.y, M + colW, ctx.y + h);
                    cells.forEach((c, k) => {
                        const x = M + k * colW + 2.5;
                        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(148, 163, 184);
                        doc.text(String(c[0]).toUpperCase(), x, ctx.y + 3.4);
                        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
                        doc.text(vLines[k], x, ctx.y + 7.3);
                    });
                    ctx.y += h;
                }
                ctx.y += 3.5;
            };
            // Fila de 2 columnas (etiqueta | valor) con alternancia de color
            ctx.row2 = (left, right, idx, rightStyle = {}) => {
                const colW = CW / 2;
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                const lL = doc.splitTextToSize(String(left), colW - 5);
                doc.setFont('helvetica', 'bold');
                const rL = doc.splitTextToSize(String(right), colW - 5);
                const h = Math.max(lL.length, rL.length) * 3.3 + 3.4;
                ctx.ensure(h);
                doc.setFillColor(...(idx % 2 ? [248, 250, 252] : [255, 255, 255]));
                doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.2);
                doc.rect(M, ctx.y, CW, h, 'FD');
                doc.line(M + colW, ctx.y, M + colW, ctx.y + h);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(51, 65, 85);
                doc.text(lL, M + 2.5, ctx.y + 4.2);
                doc.setFont('helvetica', 'bold'); doc.setTextColor(...(rightStyle.color || [15, 23, 42]));
                doc.text(rL, M + colW + 2.5, ctx.y + 4.2);
                ctx.y += h;
            };
            // Caja de texto que puede continuar en la página siguiente
            ctx.textBox = (text, fill = [248, 250, 252], border = [203, 213, 225], color = [71, 85, 105]) => {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
                const lines = doc.splitTextToSize(String(text), CW - 6);
                let i = 0;
                while (i < lines.length) {
                    const n = Math.floor((BOTTOM - ctx.y - 4) / 3.4);
                    if (n < 2) { ctx.newPage(); continue; }
                    const chunk = lines.slice(i, i + n);
                    const h = chunk.length * 3.4 + 4;
                    doc.setFillColor(...fill); doc.setDrawColor(...border); doc.setLineWidth(0.2);
                    doc.rect(M, ctx.y, CW, h, 'FD');
                    doc.setTextColor(...color);
                    doc.text(chunk, M + 3, ctx.y + 4.6);
                    ctx.y += h; i += chunk.length;
                }
            };
            ctx.photos = (photos, label) => {
                // Registro fotográfico adaptable: conserva proporciones, marco y márgenes.
                const gap = 5;
                const framePad = 3;
                const minRowH = 32;
                const maxScale = 1.55;
                // Topes estrictos para evitar que una foto aislada se sobredimensione.
                const MAX_PHOTO_H = 85; // mm: altura máxima del marco/fila fotográfica
                const MAX_SINGLE_PHOTO_W = Math.min(CW, 150); // mm: ancho máximo para foto individual
                const rawPhotos = (photos || []).filter(p => afcPhotoSrc(p));
                const photoList = rawPhotos.map(p => AFC_PHOTO_CACHE.get(afcPhotoSrc(p))).filter(Boolean);
                if (!photoList.length) {
                    if (rawPhotos.length) {   // había fotos pero no se pudieron descargar: se deja constancia en el PDF
                        ctx.sectionTitle(label, 14);
                        ctx.paragraph(`No fue posible incorporar ${rawPhotos.length} fotografía(s) en este informe (error de descarga). Vuelva a generar el informe con conexión estable.`);
                    }
                    return;
                }

                const getImageRatio = (photo) => {
                    try {
                        const props = doc.getImageProperties(photo);
                        if (props && props.width > 0 && props.height > 0) return props.width / props.height;
                    } catch (e) {}
                    return 4 / 3;
                };

                const drawPhotoRow = (rowPhotos, rowY, rowH) => {
                    const cols = rowPhotos.length;
                    const boxW = cols === 1 ? MAX_SINGLE_PHOTO_W : (CW - gap) / 2;
                    const rowStartX = cols === 1 ? M + (CW - boxW) / 2 : M;
                    rowPhotos.forEach((photo, index) => {
                        const px = rowStartX + index * (boxW + gap);
                        doc.setFillColor(248, 250, 252);
                        doc.setDrawColor(203, 213, 225);
                        doc.setLineWidth(0.2);
                        doc.rect(px, rowY, boxW, rowH, 'FD');

                        const maxW = boxW - framePad * 2;
                        const maxH = rowH - framePad * 2;
                        const ratio = getImageRatio(photo);
                        let w = maxW, h = w / ratio;
                        if (h > maxH) { h = maxH; w = h * ratio; }
                        const ix = px + (boxW - w) / 2;
                        const iy = rowY + (rowH - h) / 2;
                        try { doc.addImage(photo, 'JPEG', ix, iy, w, h); }
                        catch (e1) { try { doc.addImage(photo, ix, iy, w, h); } catch (e2) { console.warn('[PDF] addImage falló', e2); } }
                    });
                };

                // El encabezado mantiene la estructura corporativa. Se reserva espacio
                // suficiente para que al menos una fila fotográfica pueda quedar debajo.
                const baseTwoColH = ((CW - gap) / 2) * 0.68;
                ctx.sectionTitle(label, Math.min(baseTwoColH, 38) + 4);
                ctx.gap(2.5);

                let index = 0;
                let isContinuation = false;
                while (index < photoList.length) {
                    const remainingPhotos = photoList.length - index;
                    const cols = remainingPhotos === 1 ? 1 : 2;
                    const boxW = cols === 1 ? MAX_SINGLE_PHOTO_W : (CW - gap) / 2;
                    const baseH = Math.min(boxW * 0.68, MAX_PHOTO_H);
                    let available = BOTTOM - ctx.y;

                    // Si no cabe una fila legible, iniciar una hoja limpia.
                    if (available < minRowH + 2) {
                        ctx.newPage();
                        if (!isContinuation) isContinuation = true;
                        ctx.sectionTitle(label + ' (continuación)', Math.min(baseTwoColH, 38) + 4);
                        ctx.gap(2.5);
                        available = BOTTOM - ctx.y;
                    }

                    const rowsAfterThis = Math.ceil((remainingPhotos - cols) / 2);
                    const requiredAfter = rowsAfterThis > 0
                        ? rowsAfterThis * (baseTwoColH + gap)
                        : 0;

                    // Solo ampliar de forma marcada cuando esta es la última fila que
                    // puede aprovechar la hoja; nunca invadir el pie ni los márgenes.
                    let rowH = baseH;
                    const usableForThisRow = Math.max(minRowH, available - requiredAfter - (rowsAfterThis ? gap : 0));
                    if (usableForThisRow > baseH + 8) {
                        rowH = Math.min(usableForThisRow, baseH * maxScale);
                    }
                    rowH = Math.min(rowH, MAX_PHOTO_H, available - 1);

                    // Protección ante medidas atípicas: salto de página antes de dibujar.
                    if (rowH < minRowH || ctx.y + rowH > BOTTOM) {
                        ctx.newPage();
                        ctx.sectionTitle(label + ' (continuación)', Math.min(baseTwoColH, 38) + 4);
                        ctx.gap(2.5);
                        available = BOTTOM - ctx.y;
                        rowH = Math.min(baseH, MAX_PHOTO_H, available - 1);
                    }

                    drawPhotoRow(photoList.slice(index, index + cols), ctx.y, rowH);
                    ctx.y += rowH + gap;
                    index += cols;
                }
            };
            ctx.decorate();
            return ctx;
        }

        // Bloque completo de un equipo (estructura hoja1.html). Usado por ambos PDFs.
        function afcRenderEquipment(ctx, order, eq, exec, typeKey, formCfg) {
            const doc = ctx.doc, M = ctx.M, CW = ctx.CW;
            ctx.pageTitle(`${eq.code || 'EQ'} - ${eq.name || 'Equipo HVAC'}`, 10.5);

            if (exec.corrective) {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
                const nl = doc.splitTextToSize(`Novedad: ${exec.correctiveDesc || 'Sin descripción'}`, CW - 6);
                const h = 9 + nl.length * 3.4;
                ctx.ensure(h + 3);
                doc.setFillColor(255, 251, 235); doc.setDrawColor(253, 230, 138); doc.setLineWidth(0.3);
                doc.roundedRect(M, ctx.y, CW, h, 1.5, 1.5, 'FD');
                doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(120, 53, 15);
                doc.text('AVISO DE MANTENIMIENTO CORRECTIVO REQUERIDO', M + 3, ctx.y + 4.6);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(146, 64, 14);
                doc.text(nl, M + 3, ctx.y + 9);
                ctx.y += h + 3;
            }

            // 1. Información del equipo
            ctx.sectionTitle('1. Información del Equipo', 22);
            ctx.infoGrid([
                ['Código', eq.code || '-'], ['Tipo de sistema', typeKey],
                ['Marca', eq.brand || 'No registra'], ['Modelo / Capacidad', `${eq.model || 'N/A'} / ${eq.capacity || 'N/A'}`],
                ['Zona / Piso', hvacOrderZoneLabel(order) || String(eq.zoneName || '').trim() || 'Sin zona asignada']
            ]);

            // 2. Parámetros técnicos
            ctx.sectionTitle('2. Parámetros Técnicos y Mediciones Reales', 8);
            const paramList = (formCfg.params || '').split(',').map(p => p.trim()).filter(Boolean);
            paramList.forEach((paramName, pIdx) => {
                const paramKey = `param_${pIdx}`;
                const raw = exec.paramsValues ? exec.paramsValues[paramKey] : exec[paramKey];
                ctx.row2(paramName, (raw === undefined || raw === null || raw === '') ? 'N/A' : raw, pIdx);
            });
            ctx.gap(3.5);

            // 3. Lista de chequeo
            ctx.sectionTitle('3. Lista de Chequeo de Labores Realizadas', 8);
            const checkListItems = (formCfg.checklist || '').split('\n').map(c => c.trim()).filter(Boolean);
            const chks = exec.checklist || {};
            checkListItems.forEach((chkText, cIdx) => {
                const ok = !!chks[`chk_${cIdx + 1}`];
                ctx.row2(chkText, ok ? 'Sí' : 'No', cIdx, { color: ok ? [13, 148, 136] : [100, 116, 139] });
            });
            ctx.gap(3.5);

            // 4. Observaciones: prioriza el campo nuevo y conserva compatibilidad con registros anteriores.
            const isRevisionExec = String(exec.tipoRutina || '').toUpperCase() === 'REVISION';
            ctx.sectionTitle(isRevisionExec ? '4. Desarrollo del Mantenimiento' : '4. Observaciones Técnicas', 8);
            const technicalObs = (isRevisionExec ? [exec.notasAnaliticas] : [
                exec.observaciones_tecnicas, exec.observaciones, exec.notas_tecnicas,
                exec.obs, exec.notasAnaliticas
            ]).find(value => value != null && String(value).trim() !== '') || (isRevisionExec ? 'Sin desarrollo registrado.' : 'Sin observaciones adicionales.');
            ctx.textBox(String(technicalObs));
            ctx.gap(3.5);

            // 5. Registro fotográfico
            if (exec.photos && exec.photos.length > 0) ctx.photos(exec.photos, '5. Registro Fotográfico');
        }

        async function generateConsolidatedRoutinePDFDirect(onlyCorrective = false) {
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (!order) return;
            await ensureOrderEquipments(order);
            try { await hvacPrefetch(order); } catch (e) { console.warn('[PDF] prefetch', e); }   // fotos y firma alojadas en R2

            showToast(onlyCorrective ? "Generando informe exclusivo de correctivos..." : "Generando informe técnico general oficial...");

            let eqIds = order.equipmentIds || [];
            if (onlyCorrective) {
                eqIds = eqIds.filter(id => {
                    const ex = order.executions && (order.executions[id] || order.executions[equipmentCatalog.find(e => e.id === id)?.code]);
                    return ex && ex.corrective;
                });
            }

            if (eqIds.length === 0) {
                showToast(onlyCorrective ? "No hay equipos con correctivos para generar este informe." : "La orden no tiene equipos para generar el informe.", "error");
                return;
            }

            // Convierte TODAS las fotos a base64 antes de dibujar (jsPDF no admite URLs)
            afcReportPhotoStats(await afcPreloadPhotos(afcCollectPhotos(order, eqIds)));

            const ctx = afcPdfCreate(order.id);
            const doc = ctx.doc;

            // Página 1: Presentación
            ctx.pageTitle(onlyCorrective ? "INFORME TÉCNICO EXCLUSIVO DE MANTENIMIENTO CORRECTIVO" : "INFORME TÉCNICO GENERAL DE MANTENIMIENTO", 11);
            ctx.paragraph("A través del presente informe oficial, se detallan las actividades técnicas y mediciones llevadas a cabo en las instalaciones del cliente.");
            ctx.gap(3);
            ctx.sectionTitle("Datos Generales de la Orden", 24);
            const execInfo = afcExecInfo(order, eqIds.map(id => { const q = equipmentCatalog.find(e => e.id === id || e.code === id); return order.executions && (order.executions[id] || (q && (order.executions[q.id] || order.executions[q.code]))); }));
            afcSetMeta(doc, order, execInfo);
            ctx.infoGrid([
                ["Orden", order.id], ["Cliente / Sede", order.client || '-'], ["Zona / Piso", hvacOrderZoneLabel(order) || 'Sin zona asignada'],
                ["Mes de ejecución", execInfo.month], ["Fecha de ejecución", execInfo.date],
                ["Intervención del técnico", execInfo.time], ["Técnico encargado", order.technician || 'N/A'],
                ["Equipos reportados", String(eqIds.length)]
            ]);

            // Una hoja (o más, si hay muchas fotos/ítems) por cada equipo
            eqIds.forEach((eqId) => {
                const eq = equipmentCatalog.find(e => e.id === eqId || e.code === eqId) || { code: eqId, name: 'Equipo HVAC', client: order.client, type: 'EXTRACTOR' };
                const exec = (order.executions && (order.executions[eqId] || order.executions[eq.code])) || {};
                const typeKey = resolveFormTypeKey(eq.type);
                const formCfg = exec.formConfigSnapshot || equipmentFormsConfig[typeKey] || equipmentFormsConfig['EXTRACTOR'] || {
                    params: "Voltaje (V), Amperaje (A)",
                    checklist: "Limpieza general"
                };
                ctx.newPage();
                afcRenderEquipment(ctx, order, eq, exec, typeKey, formCfg);
            });

            // Página Final: Conclusiones y recibido a satisfacción del cliente
            ctx.newPage();

            const panelX = ctx.M;
            const panelW = ctx.CW;
            const panelY = ctx.y;
            const pad = 7; // padding interior compacto (mm)
            const innerX = panelX + pad;
            const innerW = panelW - pad * 2;
            const conclusions = [
                'El mantenimiento realizado ha mejorado significativamente el rendimiento de los sistemas de aire acondicionado. Sin embargo, se recomienda una supervisión continua y la implementación de las recomendaciones mencionadas para garantizar un funcionamiento continuo y eficiente.',
                'Este informe técnico proporciona una visión detallada de las actividades de mantenimiento realizadas en los sistemas de aire acondicionado, sirviendo como herramienta de referencia para futuras intervenciones y mejoras.',
                'La misión de Alejandro Faccini Y Compañía Sas es la de brindarles el mejor servicio.'
            ];

            // Medir y dibujar el texto antes de calcular el alto total del panel.
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(51, 51, 51);
            let textY = panelY + pad + 3;
            const paraGap = 4;
            conclusions.forEach((paragraph) => {
                const lines = doc.splitTextToSize(paragraph, innerW);
                doc.text(lines, innerX, textY);
                textY += lines.length * 4.2 + paraGap;
            });

            // Separación moderada entre conclusiones y tarjeta de recepción.
            const cardGap = 7;
            // Altura ampliada para firma, nombre del firmante y fecha/hora exactas.
            const cardH = 68;
            const cardX = innerX;
            const cardW = innerW;
            const cardY = textY - paraGap + cardGap;
            const panelH = (cardY - panelY) + cardH + pad;

            // Contenedor gris principal ajustado al contenido real; nunca se estira al pie.
            doc.setFillColor(238, 237, 246);
            doc.setDrawColor(190, 187, 207);
            doc.setLineWidth(0.3);
            doc.roundedRect(panelX, panelY, panelW, panelH, 1.5, 1.5, 'FD');

            // Redibujar los párrafos por encima del fondo del contenedor.
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(51, 51, 51);
            textY = panelY + pad + 3;
            conclusions.forEach((paragraph) => {
                const lines = doc.splitTextToSize(paragraph, innerW);
                doc.text(lines, innerX, textY);
                textY += lines.length * 4.2 + paraGap;
            });

            // Tarjeta blanca a ancho completo, colocada inmediatamente después del texto.
            doc.setFillColor(255, 255, 255);
            doc.setDrawColor(190, 187, 207);
            doc.setLineWidth(0.3);
            doc.roundedRect(cardX, cardY, cardW, cardH, 1.5, 1.5, 'FD');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(64, 56, 120);
            doc.text('RECIBÍ A SATISFACCIÓN', cardX + 4, cardY + 8);

            const signatureRecord = order.clientSignature || {};
            const signerName = signatureRecord.name || order.client || 'No registrado';
            const signatureDate = signatureRecord.timestamp ? new Date(signatureRecord.timestamp) : null;
            const signatureDateText = signatureDate && !Number.isNaN(signatureDate.getTime())
                ? signatureDate.toLocaleString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                : 'No registrada';

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(51, 51, 51);
            doc.text(`Cliente: ${order.client || 'N/A'}`, cardX + 4, cardY + 16);
            const signerLines = doc.splitTextToSize(`Nombre de quien firma: ${signerName}`, cardW - 8);
            doc.text(signerLines, cardX + 4, cardY + 23);
            doc.text(`Fecha y hora de firma: ${signatureDateText}`, cardX + 4, cardY + 30);

            // Firma centrada en una zona propia, debajo de la identidad del firmante.
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.text('Firma digital del cliente', cardX + 4, cardY + 38);
            doc.setDrawColor(64, 56, 120);
            doc.setLineWidth(0.35);
            doc.line(cardX + 4, cardY + 59, cardX + cardW - 4, cardY + 59);

            const signature = (window.HVAC && HVAC.img ? HVAC.img.resolve : (x => x))(signatureRecord.signatureImg);
            if (signature && typeof signature === 'string' && signature.startsWith('data:image')) {
                try {
                    const imageType = /^data:image\/jpe?g/.test(signature) ? 'JPEG' : 'PNG';
                    const sigW = Math.min(68, cardW - 16);
                    const sigH = 18;
                    const sigX = cardX + (cardW - sigW) / 2;
                    const sigY = cardY + 39;
                    doc.addImage(signature, imageType, sigX, sigY, sigW, sigH);
                } catch (e) {
                    console.warn('No fue posible insertar la firma del cliente en el PDF.', e);
                }
            } else {
                doc.setFont('helvetica', 'italic');
                doc.setFontSize(8);
                doc.setTextColor(120, 120, 120);
                doc.text('Sin firma digital registrada', cardX + cardW / 2, cardY + 49, { align: 'center' });
            }

            const fileName = onlyCorrective ? `Informe_Correctivos_AFC_${order.id}.pdf` : `Informe_Oficial_AFC_${order.id}.pdf`;
            doc.save(fileName);
            showToast(onlyCorrective ? "¡Informe exclusivo de correctivos generado con éxito!" : "¡Informe oficial corporativo generado con éxito!");
        }

        async function generateSingleEquipmentPDF(orderId, eqId) {
            const order = workOrders.find(o => o.id === orderId);
            if (!order) return;
            await ensureOrderEquipments({ equipmentIds: [eqId] });
            try { await hvacPrefetch(order); } catch (e) { console.warn('[PDF] prefetch', e); }
            const eq = equipmentCatalog.find(e => e.id === eqId || e.code === eqId) || { code: eqId, type: 'EXTRACTOR' };
            const exec = (order.executions && (order.executions[eq.id] || order.executions[eq.code] || order.executions[eqId])) || {};

            const typeKey = resolveFormTypeKey(eq.type);
            const formCfg = exec.formConfigSnapshot || equipmentFormsConfig[typeKey] || equipmentFormsConfig['EXTRACTOR'] || {
                params: "Voltaje (V), Amperaje (A)",
                checklist: "Limpieza general"
            };

            showToast(`Generando informe individual para equipo ${eq.code}...`);
            afcReportPhotoStats(await afcPreloadPhotos(exec.photos || []));

            const ctx = afcPdfCreate(order.id);
            const execInfo = afcExecInfo(order, [exec]);
            afcSetMeta(ctx.doc, order, execInfo);
            ctx.sectionTitle('Datos de la Orden', 22);
            ctx.infoGrid([
                ['Orden', order.id], ['Cliente / Sede', order.client || '-'],
                ['Zona / Piso', hvacOrderZoneLabel(order) || 'Sin zona asignada'],
                ['Mes de ejecución', execInfo.month], ['Fecha de ejecución', execInfo.date],
                ['Técnico encargado', order.technician || 'N/A'], ['Intervención del técnico', execInfo.time]
            ]);
            afcRenderEquipment(ctx, order, eq, exec, typeKey, formCfg);

            ctx.doc.save(`Informe_Equipo_${eq.code}_${order.id}.pdf`);
            showToast("¡PDF del equipo generado con éxito!");
        }

        // Mes (YYYY-MM) de una fecha: las fechas "YYYY-MM-DD" se leen tal cual (sin desfase de zona horaria)
        function billingMonthKey(v) {
            if (!v) return '';
            const str = String(v);
            if (/^\d{4}-\d{2}(-\d{2})?$/.test(str)) return str.slice(0, 7);
            const d = new Date(str);
            return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        }
        function billingRoutineType(o) {
            if (!o || typeof o !== 'object') return 'PREVENTIVO';

            const normalize = value => String(value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()
                .toUpperCase();
            const aliases = {
                PRE: 'PREVENTIVO', PREVENTIVO: 'PREVENTIVO',
                COR: 'CORRECTIVO', CORRECTIVO: 'CORRECTIVO',
                REV: 'REVISION', REVISION: 'REVISION'
            };

            // El técnico escribe `tipoRutina`; priorizarlo evita que el valor inicial
            // `maintenanceType: PREVENTIVO` tape una Revisión guardada posteriormente.
            const explicit = [o.tipoRutina, o.maintenanceType, o.routineType, o.type, o.invoice && o.invoice.maintenanceType]
                .map(normalize)
                .map(value => aliases[value])
                .find(Boolean);
            if (explicit) return explicit;

            // Compatibilidad con órdenes antiguas que identifican el tipo por prefijo
            // aun cuando el consecutivo venga pegado: COR004, REV0010, COR-004, etc.
            const id = String(o.id || '');
            if (/^COR(?:RECTIVO|[-_]|\d|$)/i.test(id)) return 'CORRECTIVO';
            if (/^REV(?:ISION|[-_]|\d|$)/i.test(id)) return 'REVISION';

            const executionTypes = [...new Set(Object.values(o.executions || {})
                .map(exec => aliases[normalize(exec && exec.tipoRutina)])
                .filter(Boolean))];
            return executionTypes.length === 1 ? executionTypes[0] : 'PREVENTIVO';
        }
        function billingClearFilters() {
            document.getElementById('billing-filter-status').value = 'ALL';
            document.getElementById('billing-filter-exec-month').value = '';
            document.getElementById('billing-filter-billed-month').value = '';
            document.getElementById('billing-filter-type').value = 'ALL';
            renderBillingModule();
        }
        const billingMoney = n => '$ ' + Number(n || 0).toLocaleString();
        const billingMonthLabel = k => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' }); };

        // Si faltan partes de una matriz en memoria (histórico paginado), las trae una vez y repinta
        var hvacBillingMatrixTried = new Set();
        function hvacBillingLoadMissingParts() {
            try {
                (workOrders || []).forEach(o => {
                    if (!o || String(o.id || '').startsWith('HIST-') || !hvacIsMatrixOrder(o)) return;
                    const base = hvacMatrixBase(o);
                    if (!base || hvacBillingMatrixTried.has(base)) return;
                    const expected = Number(o.zoneParts || 0);
                    if (expected > 1 && hvacMatrixParts(o).length < expected) {
                        hvacBillingMatrixTried.add(base);
                        if (typeof hvacLoadMatrixParts === 'function') hvacLoadMatrixParts(o).then(ok => { if (ok) renderBillingModule(); });
                    }
                });
            } catch (e) { console.warn('[Facturación] No se pudieron verificar las partes de la matriz:', e); }
        }
        // =====================================================================
        // FACTURAS HISTÓRICAS / MANUALES (sin orden ni rutina de mantenimiento)
        // Se respaldan en hvac_app_state usando la sincronización genérica existente.
        // =====================================================================
        const HVAC_MANUAL_INVOICES_KEY = 'HVAC_MANUAL_INVOICES_BACKUP';

        function hvacManualInvoiceClientRecord(item) {
            if (!item) return null;
            const byId = item.clientId != null
                ? clientsCatalog.find(c => String(c.id) === String(item.clientId))
                : null;
            return byId || findClientRecord(item.client || item.clientName || '');
        }
        function hvacManualInvoiceClientName(item) {
            const client = hvacManualInvoiceClientRecord(item);
            return client && client.name ? client.name : String(item && (item.client || item.clientName) || '');
        }
        function hvacManualInvoicesRead() {
            const data = readLocalBackup(HVAC_MANUAL_INVOICES_KEY, []);
            if (!Array.isArray(data)) return [];
            return data.filter(item => item && item.id && item.invoice).map(item => {
                const client = hvacManualInvoiceClientRecord(item);
                // Reenlaza registros históricos por clientId (o por nombre exacto normalizado en el directorio).
                return client ? { ...item, client: client.name, clientId: client.id } : item;
            });
        }

        function hvacManualInvoicesWrite(items) {
            try {
                const key = HVAC_MANUAL_INVOICES_KEY;
                localStorage.setItem(key, JSON.stringify(Array.isArray(items) ? items : []));
                localStorage.setItem('HVAC_TS_' + key, String(Date.now()));
                if (typeof cloudScheduleStatePush === 'function') cloudScheduleStatePush(key, true);
                return true;
            } catch (err) {
                console.error('[Facturas manuales] No se pudo guardar el respaldo local:', err);
                showToast('No se pudo guardar la factura en este dispositivo. Revisa el espacio disponible.', 'error');
                return false;
            }
        }

        function hvacLocalDateValue(date) {
            const d = date instanceof Date ? date : new Date();
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }

        function openManualInvoiceModal(id) {
            if (!isCurrentAdmin()) return showToast('Solo el perfil de administrador puede registrar facturas históricas.', 'error');
            const list = hvacManualInvoicesRead();
            const item = id ? list.find(x => String(x.id) === String(id)) : null;
            if (id && !item) return showToast('No se encontró la factura histórica.', 'error');
            const inv = item && item.invoice ? item.invoice : {};
            const title = document.getElementById('manual-invoice-modal-title');
            document.getElementById('manual-inv-id').value = item ? item.id : '';
            const linkedClient = item && item.clientId != null
                ? clientsCatalog.find(c => String(c.id) === String(item.clientId))
                : null;
            document.getElementById('manual-inv-client').value = item ? ((linkedClient && linkedClient.name) || item.client || '') : '';
            document.getElementById('manual-inv-concept').value = item ? (item.concept || '') : '';
            document.getElementById('manual-inv-type').value = item ? (hvacNormalizeMaintenanceType(item.maintenanceType || item.tipoRutina || item.routineType || '') || '') : '';
            document.getElementById('manual-inv-number').value = inv.number || '';
            document.getElementById('manual-inv-date').value = String(inv.date || item?.date || hvacLocalDateValue()).slice(0, 10);
            document.getElementById('manual-inv-amount').value = (inv.amount == null ? '' : inv.amount);
            document.getElementById('manual-inv-expenses').value = (inv.expenses == null ? '' : inv.expenses);
            document.getElementById('manual-inv-pdf').value = '';
            const notice = document.getElementById('manual-inv-pdf-notice');
            if (inv.pdfUrl) {
                notice.textContent = 'Esta factura ya tiene un PDF adjunto. Sube otro únicamente si deseas reemplazarlo.';
                notice.classList.remove('hidden');
            } else {
                notice.textContent = '';
                notice.classList.add('hidden');
            }
            if (title) title.textContent = item ? 'Editar factura histórica' : 'Registrar factura histórica';
            const datalist = document.getElementById('manual-inv-clients');
            if (datalist) datalist.innerHTML = getSortedClientRecords(clientsCatalog).map(c => `<option value="${esc(c.name)}"></option>`).join('');
            document.getElementById('manual-invoice-modal-backdrop').classList.remove('hidden');
        }

        function closeManualInvoiceModal() {
            document.getElementById('manual-invoice-modal-backdrop').classList.add('hidden');
        }

        // El botón único "Cargar facturas" ofrece carga individual o masiva.
        function openInvoiceUploadOptions() {
            if (!isCurrentAdmin()) return showToast('Solo el perfil de administrador puede cargar facturas históricas.', 'error');
            const cfg = hvacReadAppFeatureSettings();
            if (!cfg.showManualInvoice && !cfg.showBulkInvoice) return showToast('Las opciones de carga de facturas están ocultas en Configuración.', 'error');
            applyAppFeatureVisibility();
            document.getElementById('invoice-upload-options-modal-backdrop').classList.remove('hidden');
        }
        function closeInvoiceUploadOptions() {
            document.getElementById('invoice-upload-options-modal-backdrop').classList.add('hidden');
        }
        function chooseManualInvoiceUpload() {
            if (!hvacReadAppFeatureSettings().showManualInvoice) return showToast('La carga manual está oculta en Configuración.', 'error');
            closeInvoiceUploadOptions();
            openManualInvoiceModal();
        }
        function chooseBulkManualInvoiceUpload() {
            if (!hvacReadAppFeatureSettings().showBulkInvoice) return showToast('La carga masiva está oculta en Configuración.', 'error');
            closeInvoiceUploadOptions();
            openManualInvoicesBulkModal();
        }

        let hvacManualInvoicesExcelPreview = null;
        let hvacManualInvoicesExcelResultShown = false;

        function openManualInvoicesBulkModal() {
            if (!isCurrentAdmin()) return showToast('Solo el perfil de administrador puede importar facturas históricas.', 'error');
            hvacManualInvoicesExcelPreview = null;
            hvacManualInvoicesExcelResultShown = false;
            const input = document.getElementById('manual-invoices-excel-file');
            if (input) input.value = '';
            const preview = document.getElementById('manual-invoices-bulk-preview');
            if (preview) preview.innerHTML = 'Selecciona un archivo para revisar su contenido antes de importarlo.';
            const submit = document.getElementById('manual-invoices-bulk-submit');
            if (submit) {
                submit.disabled = true;
                submit.classList.add('opacity-50');
                submit.innerHTML = '<i class="fa-solid fa-file-import mr-1"></i> Importar facturas válidas';
            }
            document.getElementById('manual-invoices-bulk-modal-backdrop').classList.remove('hidden');
        }
        function closeManualInvoicesBulkModal() {
            document.getElementById('manual-invoices-bulk-modal-backdrop').classList.add('hidden');
            hvacManualInvoicesExcelPreview = null;
            hvacManualInvoicesExcelResultShown = false;
        }

        function downloadManualInvoicesTemplate() {
            if (!window.XLSX) return showToast('No se ha cargado el componente Excel. Recarga la página e inténtalo de nuevo.', 'error');
            const wb = XLSX.utils.book_new();
            const data = [['Cliente', 'TipoMantenimiento', 'Concepto', 'NumeroFactura', 'Fecha', 'ValorFacturado', 'GastosReales']];
            const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 48 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 16 }];
            XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
            const help = [
                ['INSTRUCCIONES PARA CARGAR FACTURAS HISTÓRICAS'],
                ['En la hoja Facturas, registra una factura por fila debajo de los encabezados.'],
                ['Cliente', 'Nombre de un cliente existente en Gestión de Clientes. Se valida contra el directorio oficial; no se crean clientes desde este archivo.'],
                ['TipoMantenimiento', 'Tipo de mantenimiento obligatorio. Usa Preventivo, Correctivo o Revisión. También se aceptan PRE, COR y REV.'],
                ['Concepto', 'Servicio o concepto facturado. Obligatorio.'],
                ['NumeroFactura', 'Número exacto de la factura. Obligatorio.'],
                ['Fecha', 'Fecha real de emisión. Formato recomendado: AAAA-MM-DD. Obligatorio.'],
                ['ValorFacturado', 'Valor antes de IVA, numérico y mayor que cero. Obligatorio.'],
                ['GastosReales', 'Gastos asociados a esa factura. Si la política global lo permite, puede quedar vacío y se registra como cero; si está bloqueado, debe ser mayor que cero.'],
                ['Validación de cliente', 'Debe existir en Gestión de Clientes. Se ignoran mayúsculas, tildes y espacios extra, pero el nombre debe corresponder a un registro del directorio.'],
                ['Importante', 'No agregues símbolos de moneda si puedes evitarlo. No repitas la misma factura para el mismo cliente. Las filas rechazadas se mostrarán con su motivo.'],
                ['Ejemplo', 'Nombre registrado en Gestión de Clientes', 'Preventivo', 'Mantenimiento preventivo de equipos', 'FE-1001', '2026-03-15', 1500000, 250000]
            ];
            const helpSheet = XLSX.utils.aoa_to_sheet(help);
            helpSheet['!cols'] = [{ wch: 24 }, { wch: 92 }, { wch: 24 }, { wch: 48 }, { wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 18 }];
            XLSX.utils.book_append_sheet(wb, helpSheet, 'Instrucciones');
            XLSX.writeFile(wb, 'Plantilla_facturas_historicas.xlsx');
        }

        function hvacExcelHeaderKey(value) {
            return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        }
        function hvacExcelColumnIndex(headers, aliases) {
            const keys = headers.map(hvacExcelHeaderKey);
            for (const alias of aliases) {
                const i = keys.indexOf(hvacExcelHeaderKey(alias));
                if (i >= 0) return i;
            }
            return -1;
        }
        function hvacNormalizeMaintenanceType(value) {
            const raw = String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
            if (['PRE', 'PREVENTIVO', 'PREVENTIVA'].includes(raw)) return 'PREVENTIVO';
            if (['COR', 'CORRECTIVO', 'CORRECTIVA'].includes(raw)) return 'CORRECTIVO';
            if (['REV', 'REVISION', 'DIAGNOSTICO', 'DIAGNOSTICO TECNICO'].includes(raw)) return 'REVISION';
            return '';
        }
        function hvacMaintenanceTypeLabel(value) {
            const type = hvacNormalizeMaintenanceType(value);
            return type === 'PREVENTIVO' ? 'Preventivo' : type === 'CORRECTIVO' ? 'Correctivo' : type === 'REVISION' ? 'Revisión' : 'Sin clasificar';
        }
        function hvacManualInvoiceMaintenanceType(item) {
            const inv = item && item.invoice ? item.invoice : {};
            return hvacNormalizeMaintenanceType(item && (item.maintenanceType || item.tipoRutina || item.routineType || item.type) || inv.maintenanceType || inv.tipoRutina || '') || 'SIN_CLASIFICAR';
        }
        function hvacParseExcelMoney(value) {
            if (value === '' || value == null) return null;
            if (typeof value === 'number') return Number.isFinite(value) ? value : null;
            let raw = String(value).trim().replace(/[\s$\u00a0]/g, '').replace(/COP/ig, '');
            if (!raw) return null;
            const comma = raw.lastIndexOf(',');
            const dot = raw.lastIndexOf('.');
            if (comma >= 0 && dot >= 0) {
                raw = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
            } else if (comma >= 0) {
                const tail = raw.length - comma - 1;
                raw = tail > 0 && tail <= 2 ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
            } else if ((raw.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(raw)) {
                raw = raw.replace(/\./g, '');
            }
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? parsed : null;
        }
        function hvacParseExcelDate(value) {
            if (value instanceof Date && !isNaN(value.getTime())) return hvacLocalDateValue(value);
            if (typeof value === 'number' && window.XLSX && XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
                const d = XLSX.SSF.parse_date_code(value);
                if (d && d.y && d.m && d.d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
            }
            const str = String(value == null ? '' : value).trim();
            if (!str) return '';
            let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
            if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
            m = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
            if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
            return '';
        }
        function hvacManualInvoiceDuplicateKey(client, number) {
            return normText(String(client || '')) + '|' + normText(String(number || ''));
        }
        function hvacExistingInvoiceKeys() {
            const keys = new Set();
            hvacManualInvoicesRead().forEach(item => {
                if (hvacManualInvoiceClientName(item) && item.invoice && item.invoice.number) keys.add(hvacManualInvoiceDuplicateKey(hvacManualInvoiceClientName(item), item.invoice.number));
            });
            (workOrders || []).forEach(order => {
                const inv = order && order.invoice;
                if (order && String(order.status || '').toUpperCase() === 'BILLED' && inv && inv.number && !inv.matrixRef) {
                    keys.add(hvacManualInvoiceDuplicateKey(order.client || order.clientName, inv.number));
                }
            });
            return keys;
        }

        function hvacRenderManualInvoicesExcelCheck(rows, finalResult) {
            const preview = document.getElementById('manual-invoices-bulk-preview');
            const submit = document.getElementById('manual-invoices-bulk-submit');
            if (!preview) return;
            const ready = rows.filter(x => finalResult ? x.imported : x.ok).length;
            const notReady = rows.length - ready;
            const noClient = rows.filter(x => x.clientMissing).length;
            const duplicates = rows.filter(x => x.duplicate).length;
            const invalid = rows.filter(x => x.errors && x.errors.length).length;
            const card = (label, value, cls) => `<div class="rounded-lg ${cls} p-2"><div class="text-[10px] uppercase font-bold">${label}</div><div class="text-xl font-black">${value}</div></div>`;
            const rowHtml = rows.map(item => {
                let statusHtml = '';
                if (finalResult && item.imported) {
                    statusHtml = '<span class="text-emerald-700 font-bold">Cargada correctamente</span>';
                } else {
                    const reasons = [];
                    if (item.clientMissing) reasons.push('Cliente no registrado en Gestión de Clientes');
                    if (item.duplicate) reasons.push('Factura duplicada para este cliente');
                    if (item.errors && item.errors.length) reasons.push(...item.errors);
                    if (item.importReason) reasons.push(item.importReason);
                    if (reasons.length) {
                        statusHtml = `<span class="text-rose-700 font-bold">No se cargó</span><div class="text-[10px] text-rose-600">${esc(reasons.join(' · '))}</div>`;
                    } else if (finalResult) {
                        statusHtml = '<span class="text-rose-700 font-bold">No se cargó</span>';
                    } else {
                        statusHtml = '<span class="text-emerald-700 font-bold">Lista para importar</span>';
                    }
                }
                const clientLabel = item.clientMatched ? (item.canonicalClient || item.client) : (item.client || '-');
                return `<tr>
                    <td class="px-2 py-2 align-top">${item.rowNumber}</td>
                    <td class="px-2 py-2 align-top">${esc(clientLabel)}</td>
                    <td class="px-2 py-2 align-top">${esc(hvacMaintenanceTypeLabel(item.maintenanceType || ''))}</td>
                    <td class="px-2 py-2 align-top">${esc(item.concept || '-')}</td>
                    <td class="px-2 py-2 align-top">${esc(item.number || '-')}</td>
                    <td class="px-2 py-2 align-top">${esc(item.date || '-')}</td>
                    <td class="px-2 py-2 align-top text-right">${item.amount == null ? '-' : Number(item.amount).toLocaleString('es-CO')}</td>
                    <td class="px-2 py-2 align-top text-right">${Number(item.expenses || 0).toLocaleString('es-CO')}</td>
                    <td class="px-2 py-2 align-top">${statusHtml}</td>
                </tr>`;
            }).join('');
            const title = finalResult ? 'Resultado de la importación' : 'Comprobación antes de importar';
            const summary = finalResult
                ? `${ready} facturas cargadas correctamente. ${notReady} filas no se cargaron y se detallan abajo.`
                : `${rows.length} filas revisadas. Solo se cargarán las que estén listas y vinculadas a un cliente del directorio oficial.`;
            preview.innerHTML = `
                <div class="mb-2 text-sm font-black text-slate-800">${title}</div>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    ${card(finalResult ? 'Cargadas' : 'Listas para cargar', ready, 'bg-emerald-50 text-emerald-800')}
                    ${card('Cliente no registrado', noClient, 'bg-rose-50 text-rose-800')}
                    ${card('Duplicadas', duplicates, 'bg-amber-50 text-amber-800')}
                    ${card('Otros errores', invalid, 'bg-slate-100 text-slate-700')}
                </div>
                <p class="text-[11px] text-slate-600 mb-2">${esc(summary)}${!finalResult ? ' Los nombres se comparan ignorando mayúsculas, tildes y espacios extra, pero deben corresponder a un cliente existente en Gestión de Clientes.' : ''}</p>
                <div class="overflow-auto max-h-[48vh] rounded-lg border border-slate-200"><table class="text-[11px] min-w-[1100px]"><thead class="sticky top-0"><tr><th class="px-2 py-2">Fila</th><th class="px-2 py-2">Cliente</th><th class="px-2 py-2">Tipo mtto</th><th class="px-2 py-2">Concepto</th><th class="px-2 py-2">Factura</th><th class="px-2 py-2">Fecha</th><th class="px-2 py-2 text-right">Valor</th><th class="px-2 py-2 text-right">Gastos</th><th class="px-2 py-2">Resultado</th></tr></thead><tbody>${rowHtml}</tbody></table></div>`;
            if (submit) {
                submit.disabled = finalResult ? false : ready === 0;
                submit.classList.toggle('opacity-50', !finalResult && ready === 0);
                submit.innerHTML = finalResult
                    ? '<i class="fa-solid fa-check mr-1"></i> Cerrar comprobación'
                    : `<i class="fa-solid fa-file-import mr-1"></i> Importar ${ready} facturas válidas`;
            }
        }

        async function previewManualInvoicesExcel(input) {
            if (!isCurrentAdmin()) return showToast('Solo el perfil de administrador puede importar facturas históricas.', 'error');
            const file = input && input.files && input.files[0];
            const preview = document.getElementById('manual-invoices-bulk-preview');
            const submit = document.getElementById('manual-invoices-bulk-submit');
            hvacManualInvoicesExcelPreview = null;
            hvacManualInvoicesExcelResultShown = false;
            if (submit) {
                submit.disabled = true;
                submit.classList.add('opacity-50');
                submit.innerHTML = '<i class="fa-solid fa-file-import mr-1"></i> Importar facturas válidas';
            }
            if (!file) { if (preview) preview.textContent = 'Selecciona un archivo para revisar su contenido antes de importarlo.'; return; }
            if (!/\.(xlsx|xls)$/i.test(file.name)) { if (preview) preview.textContent = 'Formato no válido. Selecciona un archivo Excel .xlsx o .xls.'; return showToast('Selecciona un archivo Excel .xlsx o .xls.', 'error'); }
            if (file.size > 10 * 1024 * 1024) { if (preview) preview.textContent = 'El archivo supera el límite de 10 MB.'; return showToast('El Excel supera 10 MB.', 'error'); }
            if (!window.XLSX) { if (preview) preview.textContent = 'No se pudo cargar el componente Excel. Recarga la página.'; return showToast('No se ha cargado el componente Excel.', 'error'); }
            if (!Array.isArray(clientsCatalog) || !getSortedClientRecords(clientsCatalog).length) {
                if (preview) preview.innerHTML = '<span class="text-rose-700 font-bold">No se pudo validar el archivo: el directorio de Gestión de Clientes no está cargado o no tiene clientes. Sincroniza Gestión de Clientes y vuelve a intentarlo.</span>';
                return showToast('No hay clientes oficiales disponibles para validar. Sincroniza Gestión de Clientes.', 'error');
            }
            if (preview) preview.innerHTML = '<div class="flex items-center gap-2"><span class="processing-spinner"></span> Leyendo y validando el archivo…</div>';
            try {
                const globalSettingsCheck = await hvacRefreshSharedAppSettings();
                const zeroExpensesAllowed = globalSettingsCheck.verified && hvacReadAppFeatureSettings().allowZeroExpenses;
                const buffer = await file.arrayBuffer();
                const book = XLSX.read(buffer, { type: 'array', cellDates: true });
                const sheetName = book.SheetNames && book.SheetNames[0];
                if (!sheetName) throw new Error('El libro no contiene hojas.');
                const sheet = book.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
                if (!rows.length || !Array.isArray(rows[0])) throw new Error('La primera hoja está vacía.');
                const headers = rows[0];
                const cols = {
                    client: hvacExcelColumnIndex(headers, ['Cliente', 'NombreCliente', 'RazonSocial']),
                    maintenanceType: hvacExcelColumnIndex(headers, ['TipoMantenimiento', 'TipoDeMantenimiento', 'TipoMtto', 'TipoRutina', 'Tipo']),
                    concept: hvacExcelColumnIndex(headers, ['Concepto', 'Servicio', 'Detalle', 'Descripcion']),
                    number: hvacExcelColumnIndex(headers, ['NumeroFactura', 'NumeroDeFactura', 'Factura', 'NroFactura', 'NoFactura']),
                    date: hvacExcelColumnIndex(headers, ['Fecha', 'FechaEmision', 'FechaFactura']),
                    amount: hvacExcelColumnIndex(headers, ['ValorFacturado', 'Valor', 'ValorDeLaFactura', 'Subtotal', 'MontoFactura']),
                    expenses: hvacExcelColumnIndex(headers, ['GastosReales', 'Gastos', 'GastosOperativos', 'Costos'])
                };
                const missing = ['client', 'maintenanceType', 'concept', 'number', 'date', 'amount'].filter(k => cols[k] < 0);
                if (missing.length) throw new Error('Faltan encabezados obligatorios. Incluye TipoMantenimiento y descarga la plantilla oficial actualizada.');

                const existingKeys = hvacExistingInvoiceKeys();
                const seenInFile = new Set();
                const parsed = [];
                rows.slice(1).forEach((row, index) => {
                    if (!Array.isArray(row) || row.every(v => v === '' || v == null)) return;
                    const get = key => cols[key] >= 0 ? row[cols[key]] : '';
                    const client = String(get('client') == null ? '' : get('client')).trim();
                    const maintenanceTypeRaw = String(get('maintenanceType') == null ? '' : get('maintenanceType')).trim();
                    const maintenanceType = hvacNormalizeMaintenanceType(maintenanceTypeRaw);
                    const concept = String(get('concept') == null ? '' : get('concept')).trim();
                    const number = String(get('number') == null ? '' : get('number')).trim();
                    const date = hvacParseExcelDate(get('date'));
                    const amount = hvacParseExcelMoney(get('amount'));
                    const expRaw = get('expenses');
                    const expenses = expRaw === '' || expRaw == null ? 0 : hvacParseExcelMoney(expRaw);
                    const clientRecord = client ? findClientRecord(client) : null; // SOLO Gestión de Clientes
                    const errors = [];
                    if (!client) errors.push('Cliente vacío');
                    if (!maintenanceTypeRaw) errors.push('Tipo de mantenimiento vacío');
                    else if (!maintenanceType) errors.push('Tipo de mantenimiento inválido: usa Preventivo, Correctivo o Revisión');
                    if (!concept) errors.push('Concepto vacío');
                    if (!number) errors.push('Número de factura vacío');
                    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Fecha inválida');
                    if (amount == null || amount <= 0) errors.push('Valor facturado inválido');
                    if (expenses == null || !Number.isFinite(expenses) || expenses < 0) errors.push('Gastos inválidos');
                    if (expenses === 0 && !zeroExpensesAllowed) errors.push(globalSettingsCheck.verified
                        ? 'Gastos en $0 bloqueados por la política global; ingresa un valor mayor que cero.'
                        : 'No se pudo verificar la política global; sincroniza antes de importar facturas con gastos en $0.');
                    const clientMissing = !!client && !clientRecord;
                    const canonicalClient = clientRecord ? clientRecord.name : client;
                    const key = clientRecord && number ? hvacManualInvoiceDuplicateKey(clientRecord.name, number) : '';
                    const duplicate = !!key && (existingKeys.has(key) || seenInFile.has(key));
                    if (key) seenInFile.add(key);
                    parsed.push({
                        rowNumber: index + 2,
                        client,
                        canonicalClient,
                        clientId: clientRecord ? clientRecord.id : null,
                        clientMatched: !!clientRecord,
                        clientMissing,
                        maintenanceType,
                        maintenanceTypeRaw,
                        concept,
                        number,
                        date,
                        amount,
                        expenses: expenses == null ? 0 : expenses,
                        errors,
                        duplicate,
                        ok: errors.length === 0 && !!clientRecord && !duplicate
                    });
                });
                if (!parsed.length) throw new Error('No se encontraron filas con facturas. Verifica que los datos estén debajo de los encabezados.');
                hvacManualInvoicesExcelPreview = parsed;
                hvacRenderManualInvoicesExcelCheck(parsed, false);
            } catch (err) {
                console.error('[Facturas históricas] Error al leer Excel:', err);
                hvacManualInvoicesExcelPreview = null;
                if (preview) preview.innerHTML = `<span class="text-rose-600 font-bold">No se pudo procesar el archivo: ${esc(err && err.message ? err.message : err)}</span>`;
                showToast('No se pudo leer el Excel. Verifica que uses la plantilla de facturas.', 'error');
            }
        }

        async function importManualInvoicesExcel() {
            if (!isCurrentAdmin()) return showToast('Solo el perfil de administrador puede importar facturas históricas.', 'error');
            if (hvacManualInvoicesExcelResultShown) return closeManualInvoicesBulkModal();
            if (window.hvacManualInvoicesBulkSaving) return;
            const preview = Array.isArray(hvacManualInvoicesExcelPreview) ? hvacManualInvoicesExcelPreview : [];
            let valid = preview.filter(item => item.ok);
            if (!valid.length) return showToast('No hay facturas válidas para importar. Revisa los motivos de rechazo en la comprobación.', 'error');
            const zeroRows = valid.filter(item => Number(item.expenses) === 0);
            if (zeroRows.length) {
                const globalSettingsCheck = await hvacRefreshSharedAppSettings();
                if (!globalSettingsCheck.verified) return showToast('No se pudo verificar la política global. Conéctate y sincroniza antes de importar facturas con gastos en $0.', 'error');
                if (!hvacReadAppFeatureSettings().allowZeroExpenses) {
                    const blocked = preview.map(item => item.ok && Number(item.expenses) === 0
                        ? { ...item, ok: false, errors: [...(item.errors || []), 'Gastos en $0 bloqueados por la política global; ingresa un valor mayor que cero.'] }
                        : item);
                    hvacManualInvoicesExcelPreview = blocked;
                    hvacRenderManualInvoicesExcelCheck(blocked, false);
                    return showToast('La política global bloquea las filas con gastos en $0. Corrige el Excel y vuelve a revisarlo.', 'error');
                }
            }
            const confirmText = `Se cargarán ${valid.length} facturas cuyo cliente existe en Gestión de Clientes. Las filas sin cliente registrado, duplicadas o con errores no se cargarán.` +
                (zeroRows.length ? `\n\nAtención: ${zeroRows.length} factura(s) tienen gastos en $0. La configuración permite cargarlas, pero debes confirmar que es correcto.` : '') +
                '\n\n¿Continuar?';
            if (!window.confirm(confirmText)) return;

            window.hvacManualInvoicesBulkSaving = true;
            const button = document.getElementById('manual-invoices-bulk-submit');
            if (button) { button.disabled = true; button.classList.add('opacity-50'); }
            try {
                const current = hvacManualInvoicesRead();
                const existingKeys = hvacExistingInvoiceKeys();
                const now = new Date().toISOString();
                const finalRows = preview.map(row => {
                    if (!row.ok) return { ...row, imported: false };
                    const clientRecord = findClientRecord(row.canonicalClient || row.client);
                    if (!clientRecord) return { ...row, clientMissing: true, clientMatched: false, imported: false, importReason: 'El cliente ya no aparece en Gestión de Clientes.' };
                    const key = hvacManualInvoiceDuplicateKey(clientRecord.name, row.number);
                    if (existingKeys.has(key)) return { ...row, duplicate: true, imported: false, importReason: 'La factura ya existe para este cliente.' };
                    existingKeys.add(key);
                    return { ...row, canonicalClient: clientRecord.name, clientId: clientRecord.id, clientMatched: true, imported: true };
                });
                const rowsToSave = finalRows.filter(row => row.imported);
                if (!rowsToSave.length) {
                    hvacManualInvoicesExcelPreview = finalRows;
                    hvacManualInvoicesExcelResultShown = true;
                    hvacRenderManualInvoicesExcelCheck(finalRows, true);
                    return;
                }
                const newItems = rowsToSave.map(row => {
                    const clientRecord = findClientRecord(row.canonicalClient || row.client);
                    const id = window.crypto && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'MANUAL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
                    return {
                        id,
                        manual: true,
                        importSource: 'EXCEL',
                        client: clientRecord.name,
                        clientId: clientRecord.id,
                        maintenanceType: row.maintenanceType,
                        concept: row.concept,
                        date: row.date,
                        invoice: { number: row.number, amount: row.amount, expenses: row.expenses, date: row.date, pdfUrl: null },
                        createdAt: now,
                        updatedAt: now
                    };
                });
                if (!hvacManualInvoicesWrite(current.concat(newItems))) {
                    const failedRows = finalRows.map(row => row.imported ? { ...row, imported: false, importReason: 'No se pudo guardar el lote en el almacenamiento local.' } : row);
                    hvacManualInvoicesExcelPreview = failedRows;
                    hvacManualInvoicesExcelResultShown = true;
                    hvacRenderManualInvoicesExcelCheck(failedRows, true);
                    return;
                }
                registrarAuditoria('IMPORTAR_FACTURAS_HISTORICAS_EXCEL', 'hvac_app_state', String(newItems.length));
                hvacManualInvoicesExcelPreview = finalRows;
                hvacManualInvoicesExcelResultShown = true;
                populateClientDropdowns();
                renderManualInvoicesModule();
                renderFinancialModule();
                hvacRenderManualInvoicesExcelCheck(finalRows, true);
                showToast(`${newItems.length} facturas cargadas. ${finalRows.length - newItems.length} filas no se cargaron; consulta el detalle del resultado.`);
            } catch (err) {
                console.error('[Facturas históricas] Error durante importación masiva:', err);
                showToast('No se pudo completar la importación: ' + (err && err.message ? err.message : err), 'error');
            } finally {
                window.hvacManualInvoicesBulkSaving = false;
                if (button && !hvacManualInvoicesExcelResultShown) { button.disabled = false; button.classList.remove('opacity-50'); }
            }
        }

        async function saveManualInvoiceRecord() {
            if (!isCurrentAdmin()) return showToast('Solo el perfil de administrador puede registrar facturas históricas.', 'error');
            if (window.hvacManualInvoiceSaving) return;
            window.hvacManualInvoiceSaving = true;
            try {
                const idInput = document.getElementById('manual-inv-id').value;
                const all = hvacManualInvoicesRead();
                const old = idInput ? all.find(x => String(x.id) === String(idInput)) : null;
                const clientRaw = document.getElementById('manual-inv-client').value.trim();
                const clientRecord = findClientRecord(clientRaw);
                if (!clientRecord) return showToast('El cliente no existe en Gestión de Clientes. Regístralo primero o selecciona uno del listado oficial.', 'error');
                const concept = document.getElementById('manual-inv-concept').value.trim();
                const maintenanceType = hvacNormalizeMaintenanceType(document.getElementById('manual-inv-type').value);
                const number = document.getElementById('manual-inv-number').value.trim();
                const date = document.getElementById('manual-inv-date').value;
                const amountRaw = document.getElementById('manual-inv-amount').value;
                const expensesRaw = document.getElementById('manual-inv-expenses').value;
                const amount = Number(amountRaw);
                const expenses = expensesRaw === '' ? 0 : Number(expensesRaw);
                const fileInput = document.getElementById('manual-inv-pdf');
                const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

                if (!clientRaw || !concept || !maintenanceType || !number || !date || amountRaw === '' || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(expenses) || expenses < 0) {
                    return showToast('Completa cliente, tipo de mantenimiento, concepto, número, fecha y un valor facturado mayor que cero.', 'error');
                }
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showToast('La fecha de la factura no es válida.', 'error');
                if (!(await hvacCanSaveInvoiceWithZeroExpenses(expenses, 'manual-inv-expenses', 'esta factura histórica'))) return;
                if (file) {
                    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return showToast('El archivo adjunto debe ser un PDF.', 'error');
                    if (file.size > FACTURA_MAX_MB * 1024 * 1024) return showToast('El PDF supera ' + FACTURA_MAX_MB + ' MB. Comprímelo e inténtalo de nuevo.', 'error');
                }

                const id = old ? old.id : (window.crypto && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'MANUAL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
                const previousInvoice = old && old.invoice ? old.invoice : {};
                let pdfUrl = previousInvoice.pdfUrl || null;
                if (file) {
                    try { pdfUrl = await storageSubirFacturaPdf(id, file); }
                    catch (err) {
                        console.error('[Facturas manuales] Error al subir el PDF:', err);
                        return showToast('No se pudo subir el PDF: ' + (err && err.message ? err.message : err), 'error');
                    }
                }

                const now = new Date().toISOString();
                const record = {
                    id,
                    manual: true,
                    client: clientRecord.name,
                    clientId: clientRecord.id,
                    maintenanceType,
                    concept,
                    date,
                    invoice: { number, amount, expenses, date, pdfUrl },
                    createdAt: old && old.createdAt ? old.createdAt : now,
                    updatedAt: now
                };
                const next = all.filter(x => String(x.id) !== String(id));
                next.push(record);
                if (!hvacManualInvoicesWrite(next)) return;

                if (file && previousInvoice.pdfUrl && previousInvoice.pdfUrl !== pdfUrl) storageBorrarPorUrl(previousInvoice.pdfUrl);
                registrarAuditoria(old ? 'EDITAR_FACTURA_HISTORICA' : 'CREAR_FACTURA_HISTORICA', 'hvac_app_state', id);
                closeManualInvoiceModal();
                populateClientDropdowns();
                renderManualInvoicesModule();
                renderFinancialModule();
                showToast(old ? 'Factura histórica actualizada.' : 'Factura histórica registrada.');
            } catch (err) {
                console.error('[Facturas manuales] Error al guardar:', err);
                showToast('No se pudo guardar la factura histórica: ' + (err && err.message ? err.message : err), 'error');
            } finally {
                window.hvacManualInvoiceSaving = false;
            }
        }

        function renderManualInvoicesModule() {
            const tbody = document.getElementById('manual-invoices-table-body');
            const summary = document.getElementById('manual-invoices-summary');
            if (!tbody || !summary) return;
            const query = (document.getElementById('manual-invoices-search')?.value || '').trim().toLocaleLowerCase('es-CO');
            const all = hvacManualInvoicesRead();
            const visible = all.filter(item => {
                const inv = item.invoice || {};
                const haystack = [hvacManualInvoiceClientName(item), hvacMaintenanceTypeLabel(hvacManualInvoiceMaintenanceType(item)), item.concept, inv.number, inv.date].join(' ').toLocaleLowerCase('es-CO');
                return !query || haystack.includes(query);
            }).sort((a, b) => String((b.invoice || {}).date || b.date || '').localeCompare(String((a.invoice || {}).date || a.date || '')));
            const total = all.reduce((acc, item) => {
                const inv = item.invoice || {};
                acc.amount += Number(inv.amount || 0);
                acc.expenses += Number(inv.expenses || 0);
                return acc;
            }, { amount: 0, expenses: 0 });
            const fmt = value => '$ ' + Number(value || 0).toLocaleString('es-CO');
            summary.innerHTML = `
                <div class="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3"><span class="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Facturas manuales</span><p class="text-xl font-black text-indigo-900 mt-1">${all.length}</p></div>
                <div class="rounded-xl border border-slate-200 bg-slate-50 p-3"><span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valor facturado</span><p class="text-lg font-black text-slate-900 mt-1">${fmt(total.amount)}</p></div>
                <div class="rounded-xl border border-rose-100 bg-rose-50 p-3"><span class="text-[10px] font-bold uppercase tracking-wider text-rose-700">Gastos reales</span><p class="text-lg font-black text-rose-700 mt-1">${fmt(total.expenses)}</p></div>`;
            tbody.innerHTML = '';
            if (!visible.length) {
                tbody.innerHTML = `<tr><td colspan="9" class="text-center text-slate-400 text-xs font-medium py-8">${all.length ? 'No hay facturas históricas que coincidan con la búsqueda.' : 'Todavía no has registrado facturas históricas.'}</td></tr>`;
                return;
            }
            visible.forEach(item => {
                const inv = item.invoice || {};
                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td class="text-xs">${esc(inv.date || item.date || '-')}</td>
                    <td class="font-bold text-teal-700">${esc(hvacManualInvoiceClientName(item) || '-')}</td>
                    <td class="text-xs font-bold">${esc(hvacMaintenanceTypeLabel(hvacManualInvoiceMaintenanceType(item)))}</td>
                    <td class="text-xs">${esc(item.concept || '-')}</td>
                    <td class="font-mono font-bold text-xs">${esc(inv.number || '-')}</td>
                    <td class="font-bold text-slate-900">${fmt(inv.amount)}</td>
                    <td class="font-bold text-rose-600">${fmt(inv.expenses)}</td>
                    <td>${inv.pdfUrl ? `<button onclick="downloadManualInvoicePDF('${escJs(item.id)}')" class="text-xs text-blue-600 font-bold hover:underline"><i class="fa-solid fa-file-pdf"></i> Ver PDF</button>` : '<span class="text-xs text-slate-400">Sin PDF</span>'}</td>
                    <td class="text-right"><div class="inline-flex items-center justify-end gap-1">
                        <button onclick="openManualInvoiceModal('${escJs(item.id)}')" class="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"><i class="fa-solid fa-pen"></i> Editar</button>
                        <button onclick="deleteManualInvoiceRecord('${escJs(item.id)}')" class="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    </div></td>
                </tr>`);
            });
        }

        async function downloadManualInvoicePDF(id) {
            const item = hvacManualInvoicesRead().find(x => String(x.id) === String(id));
            const url = item && item.invoice && item.invoice.pdfUrl;
            if (!url) return showToast('Esta factura histórica no tiene PDF adjunto.', 'error');
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            link.remove();
        }

        async function deleteManualInvoiceRecord(id) {
            if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) return showToast('Solo el administrador puede eliminar facturas históricas.', 'error');
            const all = hvacManualInvoicesRead();
            const item = all.find(x => String(x.id) === String(id));
            if (!item) return showToast('No se encontró la factura histórica.', 'error');
            if (!window.confirm(`¿Eliminar la factura ${item.invoice?.number || ''} de ${item.client || ''}? Esta acción no se puede deshacer.`)) return;
            if (!hvacManualInvoicesWrite(all.filter(x => String(x.id) !== String(id)))) return;
            if (item.invoice && item.invoice.pdfUrl) storageBorrarPorUrl(item.invoice.pdfUrl);
            registrarAuditoria('ELIMINAR_FACTURA_HISTORICA', 'hvac_app_state', id);
            renderManualInvoicesModule();
            renderFinancialModule();
            showToast('Factura histórica eliminada.');
        }

        // Revierte una factura asociada a una orden/matriz y devuelve todas sus partes
        // a COMPLETED, que es el estado que Facturación presenta como pendiente.
        async function revertInvoiceRecord(orderId) {
            if (!isCurrentAdmin()) return showToast('Solo el perfil de administrador puede revertir facturas.', 'error');
            if (window.hvacInvoiceReverting) return;
            window.hvacInvoiceReverting = true;
            try {
            let order = workOrders.find(o => String(o.id) === String(orderId));
            if (!order) return showToast('No se encontró la orden seleccionada.', 'error');
            if (order._hvacSummaryOnly && typeof hvacEnsureFullOrder === 'function') order = await hvacEnsureFullOrder(orderId);
            if (!order) return showToast('No se pudo cargar el detalle de la orden.', 'error');

            if (hvacIsMatrixOrder(order)) {
                await hvacLoadMatrixParts(order);
            }
            let parts = hvacIsMatrixOrder(order) ? hvacMatrixParts(order) : [order];
            if (!parts.length) parts = [order];
            if (hvacIsMatrixOrder(order)) {
                const expected = Math.max(Number(order.zoneParts || 1), parts.length);
                if (parts.length < expected) return showToast('No se pudieron cargar todas las zonas de esta orden. Sincroniza e inténtalo de nuevo para evitar una reversión parcial.', 'error');
            }
            const holder = parts.find(p => p.invoice && !p.invoice.matrixRef && (p.invoice.number || p.invoice.amount)) || hvacMatrixHolder(order) || order;
            const snapshot = holder.invoice && !holder.invoice.matrixRef ? JSON.parse(JSON.stringify(holder.invoice)) : null;
            if (!parts.some(p => String(p.status || '').toUpperCase() === 'BILLED') && !snapshot) {
                return showToast('La orden no tiene una factura activa para revertir.', 'error');
            }
            const label = hvacIsMatrixOrder(order) ? hvacMatrixBase(order) : order.id;
            const invoiceNumber = snapshot && snapshot.number ? snapshot.number : 'sin número';
            if (!window.confirm(`¿Revertir la factura ${invoiceNumber} de la orden ${label}? La factura dejará de aparecer en Finanzas y la orden volverá a Pendiente por facturar. El soporte PDF no se borrará.`)) return;

            const now = new Date().toISOString();
            if (snapshot) {
                holder.invoiceHistory = Array.isArray(holder.invoiceHistory) ? holder.invoiceHistory : [];
                holder.invoiceHistory.push({ ...snapshot, reversedAt: now, reversedBy: (systemUsers.find(u => String(u.id) === String(activeUser)) || {}).name || String(activeUser || '') });
                holder.invoiceHistory = holder.invoiceHistory.slice(-20);
            }
            parts.forEach(part => {
                delete part.invoice;
                part.status = 'COMPLETED';
                part.updatedAt = now;
            });
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));

            let allSaved = true;
            for (const part of parts) {
                try { if (!(await cloudSaveOrder(part))) allSaved = false; }
                catch (err) { allSaved = false; console.warn('[Facturación] Reversión pendiente de sincronizar:', part.id, err); }
            }
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            registrarAuditoria('REVERTIR_FACTURA', 'hvac_orders', label);
            renderBillingModule();
            renderFinancialModule();
            renderAdminDashboard();
            showToast(allSaved ? 'Factura revertida. La orden quedó pendiente por facturar.' : 'Reversión guardada en este dispositivo; queda pendiente de sincronización con Supabase.', allSaved ? 'success' : 'error');
            } finally {
                window.hvacInvoiceReverting = false;
            }
        }

        function renderBillingModule() {
            const status = document.getElementById('billing-filter-status').value || 'ALL';
            const execMonth = document.getElementById('billing-filter-exec-month').value || '';
            const billedMonth = document.getElementById('billing-filter-billed-month').value || '';
            const typeFilter = document.getElementById('billing-filter-type').value || 'ALL';
            const tbody = document.getElementById('billing-table-body');
            tbody.innerHTML = '';
            renderManualInvoicesModule(); // las facturas históricas no se mezclan con órdenes ni rutinas

            // Solo se listan rutinas que el técnico dejó COMPLETADAS al 100% (o las ya facturadas): nunca las programadas, en proceso o con avance parcial
            const billingReady = o => {
                const st = String(o.status || '').toUpperCase();
                return st === 'BILLED' || (st === 'COMPLETED' && hvacOrderState(o) === 'COMPLETED');
            };
            // Matriz (rutina dividida por zonas -P#): UNA sola fila por matriz, a nombre de su parte titular, y solo cuando TODAS las partes están completadas.
            hvacBillingLoadMissingParts();
            // Los filtros son independientes y se combinan entre sí (AND)
            const list = workOrders.filter(o => {
                if (String(o.id || '').startsWith('HIST-')) return false;
                if (hvacIsMatrixOrder(o)) {
                    const holder = hvacMatrixHolder(o);
                    if (!holder || String(holder.id) !== String(o.id)) return false;
                    const ms = hvacMatrixState(o);
                    if (ms !== 'COMPLETED' && ms !== 'BILLED') return false;
                } else if (!billingReady(o)) return false;
                if (billingRoutineType(o) === 'REVISION' && o.status !== 'BILLED') return false;   // las revisiones no se facturan (solo se conservan las ya facturadas en el pasado)
                if (status === 'PENDING' && o.status !== 'COMPLETED') return false;
                if (status === 'BILLED' && o.status !== 'BILLED') return false;
                if (execMonth && billingMonthKey(o.date) !== execMonth) return false;
                if (billedMonth && billingMonthKey(o.invoice && o.invoice.date) !== billedMonth) return false;
                if (typeFilter !== 'ALL' && billingRoutineType(o) !== typeFilter) return false;
                return true;
            });

            // ---- Totales dinámicos (según los filtros aplicados) ----
            const mk = () => ({ n: 0, billed: 0, amount: 0, expenses: 0, pending: 0 });
            const T = mk(), byType = { PREVENTIVO: mk(), CORRECTIVO: mk(), REVISION: mk() };
            list.forEach(o => {
                const inv = o.invoice || {}, isBilled = o.status === 'BILLED', t = byType[billingRoutineType(o)];
                [T, t].forEach(x => {
                    x.n++;
                    if (isBilled) { x.billed++; x.amount += Number(inv.amount || 0); x.expenses += Number(inv.expenses || 0); }
                    else if (o.status === 'COMPLETED') x.pending++;
                });
            });
            const net = x => x.amount - x.expenses, margin = x => x.amount > 0 ? Math.round(net(x) / x.amount * 100) : 0;
            // ---- Desglose del mes base: facturado en el mes M según su ejecución sea del mismo mes o de otros ----
            // M = mes facturado (si se eligió); si no, el mes de ejecución se usa como mes base.
            // Respeta estado y tipo de rutina. El mes de ejecución solo restringe cuando hay mes facturado
            // (si fuese el mes base, dejaría vacía la fila "otros meses").
            const baseMonth = billedMonth || execMonth;
            let bd = null;
            if (baseMonth) {
                const pool = workOrders.filter(o => {
                    if (String(o.id || '').startsWith('HIST-')) return false;
                    if (hvacIsMatrixOrder(o) && String((hvacMatrixHolder(o) || {}).id) !== String(o.id)) return false;   // una matriz = una factura
                    if (o.status !== 'BILLED' || billingMonthKey(o.invoice && o.invoice.date) !== baseMonth) return false;
                    if (status === 'PENDING') return false;
                    if (typeFilter !== 'ALL' && billingRoutineType(o) !== typeFilter) return false;
                    if (billedMonth && execMonth && billingMonthKey(o.date) !== execMonth) return false;
                    return true;
                });
                const sum = arr => arr.reduce((a, o) => { const inv = o.invoice || {}; a.n++; a.amount += Number(inv.amount || 0); a.expenses += Number(inv.expenses || 0); return a; }, { n: 0, amount: 0, expenses: 0 });
                const sameArr = pool.filter(o => billingMonthKey(o.date) === baseMonth);
                const otherArr = pool.filter(o => billingMonthKey(o.date) !== baseMonth);
                const otherMonths = {};
                otherArr.forEach(o => { const k = billingMonthKey(o.date) || 'sin fecha'; otherMonths[k] = (otherMonths[k] || 0) + 1; });
                bd = { same: sum(sameArr), other: sum(otherArr), total: sum(pool), otherMonths };
            }
            const chips = [];
            if (status !== 'ALL') chips.push(status === 'PENDING' ? 'Pendientes por facturar' : 'Facturadas');
            if (execMonth) chips.push('Ejecución: ' + billingMonthLabel(execMonth));
            if (billedMonth) chips.push('Facturado: ' + billingMonthLabel(billedMonth));
            if (typeFilter !== 'ALL') chips.push(({ PREVENTIVO: 'Preventivo', CORRECTIVO: 'Correctivo', REVISION: 'Revisión' })[typeFilter] || typeFilter);
            const card = (label, value, cls) => `<div class="bill-mini"><span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">${label}</span><p class="text-lg font-black mt-1 ${cls || 'text-slate-900'}">${value}</p></div>`;
            const row = (label, x) => `<tr><td class="font-bold text-slate-800">${label}</td><td class="text-center">${x.n}</td><td class="text-center">${x.billed}</td><td class="text-center">${x.pending}</td><td class="font-bold">${billingMoney(x.amount)}</td><td class="font-bold text-rose-600">${billingMoney(x.expenses)}</td><td class="font-bold text-emerald-600">${billingMoney(net(x))}</td><td class="font-bold text-teal-600">${margin(x)}%</td></tr>`;
            const bdNet = x => x.amount - x.expenses;
            const bdCard = (cls, label, sub, x, extra) => `<div class="bbd-card ${cls}">
                    <div class="bbd-lbl"><span class="bbd-dot"></span>${label}</div>
                    <div class="bbd-sub">${sub}</div>
                    <div class="bbd-val">${billingMoney(x.amount)}</div>
                    <div class="bbd-meta"><span><b>${x.n}</b> ${x.n === 1 ? 'orden' : 'órdenes'}</span><span class="neg">Gastos <b>${billingMoney(x.expenses)}</b></span><span class="pos">Neto <b>${billingMoney(bdNet(x))}</b></span></div>
                    ${extra || ''}
                </div>`;
            let breakdownHTML;
            if (bd) {
                const ML = billingMonthLabel(baseMonth), typeTxt = typeFilter === 'ALL' ? '' : ' · ' + (({ PREVENTIVO: 'Preventivo', CORRECTIVO: 'Correctivo', REVISION: 'Revisión' })[typeFilter] || typeFilter);
                const om = Object.keys(bd.otherMonths).sort().map(k => `${k === 'sin fecha' ? 'Sin fecha' : esc(billingMonthLabel(k))} (${bd.otherMonths[k]})`).join(' · ');
                breakdownHTML = `<div class="bbd-wrap">
                    <div class="bbd-head">
                        <span class="bbd-title"><i class="fa-solid fa-sitemap"></i> Subtotales facturados en ${esc(ML)}${typeTxt}</span>
                        <span class="bbd-base">Base: ${billedMonth ? 'mes facturado' : 'mes de ejecución'}</span>
                    </div>
                    <div class="bbd-grid">
                        ${bdCard('same', 'Del mismo mes', `Facturado en ${esc(ML)} y ejecutado en ${esc(ML)}`, bd.same)}
                        ${bdCard('other', 'De otros meses', `Facturado en ${esc(ML)} pero ejecutado en otros meses`, bd.other, om ? `<div class="bbd-months">Ejecutado en: ${om}</div>` : '')}
                        ${bdCard('total', 'Total facturado', `Suma de ambas filas · ${esc(ML)}`, bd.total)}
                    </div>
                </div>`;
            } else {
                breakdownHTML = `<div class="bbd-wrap"><div class="bbd-hint"><i class="fa-solid fa-circle-info"></i> Elige un <b>mes facturado</b> (o un mes de ejecución) para ver cuánto de lo facturado corresponde a ese mismo mes y cuánto a otros meses.</div></div>`;
            }
            document.getElementById('billing-totals').innerHTML = `
                <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
                    <h3 class="text-sm font-black text-slate-900 tracking-tight"><i class="fa-solid fa-calculator text-teal-600 mr-1.5"></i>Totales</h3>
                    <span class="text-[11px] text-slate-500 font-medium">${chips.length ? esc(chips.join(' · ')) : 'Sin filtros: todas las órdenes'}</span>
                </div>
                ${breakdownHTML}
                <div class="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
                    ${card('Órdenes', `${T.n} <span class="text-[11px] font-bold text-slate-500">(${T.billed} fact. · ${T.pending} pend.)</span>`)}
                    ${card('Valor cobrado', billingMoney(T.amount))}
                    ${card('Gastos reales', billingMoney(T.expenses), 'text-rose-600')}
                    ${card('Neto', billingMoney(net(T)), 'text-emerald-600')}
                    ${card('Margen', margin(T) + '%', 'text-teal-600')}
                </div>
                <div class="overflow-x-auto mt-3">
                    <table>
                        <thead><tr><th>Subtotal por tipo</th><th class="text-center">Órdenes</th><th class="text-center">Facturadas</th><th class="text-center">Pendientes</th><th>Cobrado</th><th>Gastos</th><th>Neto</th><th>Margen</th></tr></thead>
                        <tbody>${row('Preventivo', byType.PREVENTIVO)}${row('Correctivo', byType.CORRECTIVO)}${byType.REVISION.n ? row('Revisión', byType.REVISION) : ''}</tbody>
                    </table>
                </div>`;

            if (!list.length) {
                tbody.innerHTML = '<tr><td colspan="10" class="text-center text-slate-400 text-xs font-medium py-8">No hay órdenes que coincidan con los filtros seleccionados.</td></tr>';
                return;
            }
            list.forEach(o => {
                const inv = o.invoice || {};
                const isBilled = o.status === 'BILLED';
                const routineType = billingRoutineType(o);
                const routineLabel = ({ PREVENTIVO: 'Preventivo', CORRECTIVO: 'Correctivo', REVISION: 'Revisión' })[routineType] || routineType;
                const routineClass = routineType === 'CORRECTIVO' ? 'corr' : routineType === 'REVISION' ? 'rev' : 'prev';
                const billedOn = isBilled && inv.date ? billingMonthKey(inv.date) : '';
                const isMx = hvacIsMatrixOrder(o), mxN = isMx ? hvacMatrixParts(o).length : 0;
                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td class="font-bold text-slate-900">${esc(isMx ? hvacMatrixBase(o) : o.id)}${mxN > 1 ? ` <span class="text-[10px] font-bold text-slate-500">(${mxN} zonas)</span>` : ''}</td>
                    <td class="font-bold text-teal-700">${esc(o.client)}</td>
                    <td><span class="bill-chip ${routineClass}">${routineLabel}</span></td>
                    <td>${esc(o.date)}</td>
                    <td class="text-xs">${billedOn ? esc(billedOn) : '<span class="text-slate-400">-</span>'}</td>
                    <td class="font-mono font-bold text-xs">${esc(inv.number || '-')}</td>
                    <td class="font-bold text-slate-900">$ ${Number(inv.amount || 0).toLocaleString()}</td>
                    <td class="font-bold text-rose-600">$ ${Number(inv.expenses || 0).toLocaleString()}</td>
                    <td>${(inv.pdfUrl || inv.pdfData) ? `<button onclick="downloadInvoicePDF('${escJs(o.id)}')" class="text-xs text-blue-600 font-bold hover:underline inline-flex items-center gap-1"><i class="fa-solid fa-file-pdf"></i> Descargar</button>` : '<span class="text-slate-400 text-xs font-medium">Sin PDF</span>'}</td>
                    <td class="text-right">
                        <div class="inline-flex items-center justify-end gap-1.5 flex-wrap">
                            <button onclick="openInvoiceModal('${escJs(o.id)}')" class="px-3.5 py-1.5 text-xs font-bold rounded-xl transition ${isBilled ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'btn-teal'}">
                                ${isBilled ? '<i class="fa-solid fa-pen"></i> Editar' : '<i class="fa-solid fa-receipt"></i> Facturar'}
                            </button>
                            ${isBilled ? `<button onclick="revertInvoiceRecord('${escJs(o.id)}')" class="px-3 py-1.5 text-xs font-bold rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700" title="Revertir a pendiente por facturar"><i class="fa-solid fa-rotate-left"></i> Revertir</button>` : ''}
                        </div>
                    </td>
                </tr>`);
            });
        }

        // Recomendaciones de facturación: solo compara el mismo cliente y tipo de mantenimiento.
        // Se prioriza la coincidencia de equipos y, en caso de empate, la factura más reciente.
        let hvacInvoiceSuggestionCurrent = null;
        function hvacInvoiceNormalizeClient(value) {
            return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
        }
        function hvacInvoiceEquipmentSet(order) {
            const ids = new Set((order && order.equipmentIds || []).map(String).filter(Boolean));
            try {
                const parts = hvacIsMatrixOrder(order) ? hvacMatrixParts(order) : [order];
                parts.forEach(part => (part && part.equipmentIds || []).forEach(id => ids.add(String(id))));
            } catch (_) {}
            return ids;
        }
        function hvacFindInvoiceSuggestion(order) {
            const clientKey = hvacInvoiceNormalizeClient(order && order.client);
            const type = billingRoutineType(order);
            // Las sugerencias históricas se habilitan exclusivamente para preventivos.
            // COR y REV siempre se facturan/registran manualmente, sin referencias anteriores.
            if (type !== 'PREVENTIVO') return null;
            const currentIds = hvacInvoiceEquipmentSet(order);
            if (!clientKey || !currentIds.size) return null;
            const candidates = [];
            (workOrders || []).forEach(candidate => {
                if (!candidate || candidate === order || candidate._hvacSummaryOnly || String(candidate.status || '').toUpperCase() !== 'BILLED') return;
                if (hvacInvoiceNormalizeClient(candidate.client) !== clientKey) return;
                if (billingRoutineType(candidate) !== 'PREVENTIVO') return;
                const holder = hvacMatrixHolder(candidate);
                const inv = holder && holder.invoice;
                if (!inv || !(Number(inv.amount) > 0)) return;
                const otherIds = hvacInvoiceEquipmentSet(candidate);
                if (!otherIds.size) return;
                let intersection = 0;
                currentIds.forEach(id => { if (otherIds.has(id)) intersection++; });
                const union = new Set([...currentIds, ...otherIds]).size;
                const similarity = union ? intersection / union : 0;
                if (similarity <= 0) return;
                const date = inv.date || candidate.updatedAt || candidate.date || candidate.createdAt || '';
                candidates.push({ order: candidate, invoice: inv, similarity, intersection, timestamp: Date.parse(date) || 0 });
            });
            candidates.sort((a,b) => b.similarity - a.similarity || b.timestamp - a.timestamp || b.intersection - a.intersection);
            return candidates[0] || null;
        }
        function renderInvoiceSuggestion(order) {
            const box = document.getElementById('inv-smart-suggestion');
            const detail = document.getElementById('inv-smart-suggestion-detail');
            if (!box || !detail) return;
            const match = hvacFindInvoiceSuggestion(order);
            hvacInvoiceSuggestionCurrent = match;
            if (!match) { box.classList.add('hidden'); return; }
            const inv = match.invoice;
            const date = inv.date ? new Date(inv.date).toLocaleDateString('es-CO') : 'fecha no disponible';
            detail.textContent = `Referencia: ${match.order.id} · Factura ${inv.number || 'sin número'} · ${date} · Coincidencia de equipos: ${Math.round(match.similarity * 100)}%.`;
            document.getElementById('inv-smart-amount').textContent = '$ ' + Number(inv.amount || 0).toLocaleString('es-CO');
            document.getElementById('inv-smart-expenses').textContent = '$ ' + Number(inv.expenses || 0).toLocaleString('es-CO');
            box.classList.remove('hidden');
        }
        function applyInvoiceSuggestion(field) {
            const match = hvacInvoiceSuggestionCurrent;
            if (!match || !match.invoice) return;
            const target = document.getElementById(field === 'amount' ? 'inv-f-amount' : 'inv-f-expenses');
            if (!target) return;
            target.value = Number(field === 'amount' ? match.invoice.amount : match.invoice.expenses) || 0;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            showToast(field === 'amount' ? 'Valor de factura sugerido aplicado.' : 'Gastos sugeridos aplicados.');
        }

        async function openInvoiceModal(orderId) {
            let order = workOrders.find(o => o.id === orderId);
            if (!order) return;
            if (billingRoutineType(order) === 'REVISION') return showToast('Las revisiones no se facturan.', 'error');
            if (order._hvacSummaryOnly && typeof hvacEnsureFullOrder === 'function') order = await hvacEnsureFullOrder(orderId);
            if (!order) return showToast('No se pudo cargar el detalle de la orden.', 'error');
            const inv = hvacMatrixHolder(order).invoice || {};
            const projInv = hvacProjForOrder(order.id);

            document.getElementById('invoice-modal-backdrop').classList.remove('hidden');
            document.getElementById('inv-f-order-id').value = order.id;
            const invLabel = hvacIsMatrixOrder(order) ? `${hvacMatrixBase(order)} · ${hvacMatrixParts(order).length} zonas` : order.id;
            document.getElementById('inv-modal-title').innerText = inv.number ? `Editar Factura (${invLabel})` : `Facturar Orden (${invLabel})`;
            document.getElementById('inv-f-number').value = inv.number || '';
            document.getElementById('inv-f-amount').value = inv.amount || (projInv && projInv.budget) || '';
            document.getElementById('inv-f-expenses').value = inv.expenses || '';
            renderInvoiceSuggestion(order);

            const notice = document.getElementById('inv-pdf-current-notice');
            if (inv.pdfUrl || inv.pdfData) {
                notice.innerText = "Ya tiene un PDF guardado. Puedes subir uno nuevo para reemplazarlo.";
                notice.classList.remove('hidden');
            } else {
                notice.classList.add('hidden');
            }
        }

        function closeInvoiceModal() {
            document.getElementById('invoice-modal-backdrop').classList.add('hidden');
            hvacInvoiceSuggestionCurrent = null;
            const suggestion = document.getElementById('inv-smart-suggestion');
            if (suggestion) suggestion.classList.add('hidden');
        }

        function handleFinancePeriodChange() {
            const type = document.getElementById('fin-period-type')?.value || 'YTD';
            const monthInput = document.getElementById('fin-filter-month');
            const yearInput = document.getElementById('fin-filter-year');
            const monthField = document.getElementById('fin-filter-month-field');
            const yearField = document.getElementById('fin-filter-year-field');
            const now = new Date();
            if (monthInput && type === 'MONTH' && !monthInput.value) monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
            if (yearInput && type === 'YEAR' && !yearInput.value) yearInput.value = String(now.getFullYear());
            if (monthInput) monthInput.classList.toggle('hidden', type !== 'MONTH');
            if (yearInput) yearInput.classList.toggle('hidden', type !== 'YEAR');
            if (monthField) monthField.classList.toggle('hidden', type !== 'MONTH');
            if (yearField) yearField.classList.toggle('hidden', type !== 'YEAR');
            renderFinancialModule();
        }

        // ================= FINANZAS: PROYECCIÓN ANUAL VS FACTURACIÓN =================
        let hvacFinancialProjectionPreview = null;
        const FIN_PROJ_MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        function hvacFinancialProjectionsRead() {
            try { const data = JSON.parse(localStorage.getItem(HVAC_FINANCIAL_PROJECTIONS_KEY) || '[]'); return Array.isArray(data) ? data : []; }
            catch (e) { console.warn('[Finanzas] No se pudo leer la proyección anual:', e); return []; }
        }
        function hvacFinancialProjectionsSave(data) {
            try {
                localStorage.setItem(HVAC_FINANCIAL_PROJECTIONS_KEY, JSON.stringify(Array.isArray(data) ? data : []));
                localStorage.setItem('HVAC_TS_' + HVAC_FINANCIAL_PROJECTIONS_KEY, String(Date.now()));
                if (typeof cloudScheduleStatePush === 'function') cloudScheduleStatePush(HVAC_FINANCIAL_PROJECTIONS_KEY, true);
                return true;
            } catch (e) { hvacStorageError(e, 'Guardar proyección financiera'); return false; }
        }
        const finProjHeader = v => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        function finProjMonthNumber(value) {
            if (value instanceof Date && !isNaN(value)) return value.getMonth() + 1;
            if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 12) return Math.round(value);
            const raw = String(value == null ? '' : value).trim();
            if (/^\d{4}[-/]\d{1,2}/.test(raw)) { const n = parseInt(raw.split(/[-/]/)[1], 10); return n >= 1 && n <= 12 ? n : 0; }
            const key = finProjHeader(raw);
            const aliases = [['enero','ene','january','jan'],['febrero','feb','february'],['marzo','mar','march'],['abril','abr','april','apr'],['mayo','may'],['junio','jun','june'],['julio','jul','july'],['agosto','ago','august','aug'],['septiembre','setiembre','sep','sept','september'],['octubre','oct','october'],['noviembre','nov','november'],['diciembre','dic','december','dec']];
            for (let i = 0; i < aliases.length; i++) if (aliases[i].some(a => key === a || key.startsWith(a))) return i + 1;
            const n = parseInt(raw, 10); return n >= 1 && n <= 12 ? n : 0;
        }
        function finProjYearNumber(value, fallback) {
            if (value instanceof Date && !isNaN(value)) return value.getFullYear();
            const m = String(value == null ? '' : value).match(/(?:19|20|21)\d{2}/);
            const n = m ? Number(m[0]) : Number(value);
            return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback;
        }
        function finProjMoney(value) {
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            let raw = String(value == null ? '' : value).trim().replace(/[^0-9,.-]/g, '');
            if (!raw) return NaN;
            if (raw.includes(',') && raw.includes('.')) raw = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
            else if ((raw.match(/\./g) || []).length > 1) raw = raw.replace(/\./g, '');
            else if ((raw.match(/,/g) || []).length > 1) raw = raw.replace(/,/g, '');
            else if (raw.includes(',')) raw = /,\d{1,2}$/.test(raw) ? raw.replace(',', '.') : raw.replace(',', '');
            return Number(raw);
        }
        function finProjParseRows(rows, fallbackYear) {
            const valid = [], errors = [];
            if (!Array.isArray(rows) || !rows.length) return { valid, errors: ['La primera hoja está vacía.'] };
            const monthNames = FIN_PROJ_MONTHS.map(finProjHeader);
            const aliases = { year: ['ano','anio','year'], month: ['mes','month','periodo'], amount: ['valorproyectado','proyectado','proyeccion','presupuesto','meta','valor','monto','presupuestomensual','meta mensual'].map(finProjHeader) };
            let headerIdx = -1, headers = [], yearIdx = -1, monthIdx = -1, amountIdx = -1, monthCols = [];
            for (let i = 0; i < Math.min(rows.length, 15); i++) {
                const candidate = (rows[i] || []).map(finProjHeader);
                const yi = candidate.findIndex(h => aliases.year.includes(h));
                const mi = candidate.findIndex(h => aliases.month.includes(h));
                const ai = candidate.findIndex(h => aliases.amount.includes(h) || h.includes('proyect') || h.includes('presupuesto') || h === 'meta');
                const mc = candidate.map((h, idx) => ({ h, idx })).filter(x => monthNames.some((m, j) => x.h === m || x.h.startsWith(m) || ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][j] === x.h));
                if ((mi >= 0 && ai >= 0) || mc.length >= 2) { headerIdx = i; headers = candidate; yearIdx = yi; monthIdx = mi; amountIdx = ai; monthCols = mc; break; }
            }
            if (headerIdx < 0) return { valid, errors: ['No se reconocieron las columnas. Usa Año, Mes y ValorProyectado, o una tabla con columnas Enero a Diciembre.'] };
            const seen = new Set();
            const addRecord = (year, month, amount, rowNo) => {
                const y = finProjYearNumber(year, fallbackYear), m = finProjMonthNumber(month), v = finProjMoney(amount);
                if (!y || m < 1 || m > 12 || !Number.isFinite(v) || v < 0) { errors.push(`Fila ${rowNo}: año, mes o valor proyectado no válido.`); return; }
                const id = `${y}-${String(m).padStart(2, '0')}`;
                if (seen.has(id)) { errors.push(`Fila ${rowNo}: el mes ${id} está duplicado dentro del archivo.`); return; }
                seen.add(id); valid.push({ id, year: y, month: m, projectedAmount: v, updatedAt: Date.now() });
            };
            for (let i = headerIdx + 1; i < rows.length; i++) {
                const r = rows[i] || [];
                if (!r.some(v => String(v == null ? '' : v).trim() !== '')) continue;
                if (monthCols.length >= 2 && (monthIdx < 0 || amountIdx < 0)) {
                    const year = yearIdx >= 0 ? r[yearIdx] : fallbackYear;
                    monthCols.forEach(mc => {
                        const val = r[mc.idx];
                        if (val !== '' && val != null) addRecord(year, mc.h, val, i + 1);
                    });
                } else {
                    addRecord(yearIdx >= 0 ? r[yearIdx] : fallbackYear, r[monthIdx], r[amountIdx], i + 1);
                }
            }
            if (!valid.length && !errors.length) errors.push('No se encontraron valores mensuales diligenciados.');
            return { valid, errors };
        }
        function openFinancialProjectionModal() {
            if (!isCurrentAdmin()) return showToast('Solo el administrador puede cargar la proyección financiera.', 'error');
            hvacFinancialProjectionPreview = null;
            const file = document.getElementById('fin-proj-import-file'); if (file) file.value = '';
            const year = document.getElementById('fin-proj-import-year'); if (year) year.value = new Date().getFullYear();
            const preview = document.getElementById('fin-proj-import-preview'); if (preview) preview.textContent = 'Selecciona el archivo para validar los 12 meses antes de guardar.';
            const btn = document.getElementById('fin-proj-import-submit'); if (btn) { btn.disabled = true; btn.classList.add('opacity-50'); }
            document.getElementById('financial-projection-modal-backdrop').classList.remove('hidden');
        }
        function closeFinancialProjectionModal() {
            document.getElementById('financial-projection-modal-backdrop').classList.add('hidden');
            hvacFinancialProjectionPreview = null;
        }
        function downloadFinancialProjectionTemplate() {
            if (!window.XLSX) return showToast('No se ha cargado el componente Excel. Recarga la página.', 'error');
            const year = Number(document.getElementById('fin-proj-import-year')?.value) || new Date().getFullYear();
            const rows = [['Año','Mes','ValorProyectado'], ...FIN_PROJ_MONTHS.map(m => [year, m, ''])];
            const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 22 }];
            const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Proyección anual');
            XLSX.writeFile(wb, `Plantilla_Proyeccion_Financiera_${year}.xlsx`);
        }
        async function previewFinancialProjectionFile(input) {
            const file = input && input.files && input.files[0], preview = document.getElementById('fin-proj-import-preview'), btn = document.getElementById('fin-proj-import-submit');
            hvacFinancialProjectionPreview = null;
            if (btn) { btn.disabled = true; btn.classList.add('opacity-50'); }
            if (!file) { if (preview) preview.textContent = 'Selecciona un archivo para validar.'; return; }
            if (!/\.(xlsx|xls|csv)$/i.test(file.name) || file.size > 10 * 1024 * 1024) { if (preview) preview.textContent = 'Selecciona un Excel o CSV de máximo 10 MB.'; return showToast('Formato o tamaño de archivo no válido.', 'error'); }
            if (!window.XLSX) return showToast('No se ha cargado el componente Excel. Recarga la página.', 'error');
            try {
                if (preview) preview.innerHTML = '<span class="processing-spinner"></span> Validando proyección…';
                const buffer = await file.arrayBuffer(), book = XLSX.read(buffer, { type: 'array', cellDates: true });
                const sheet = book.Sheets[book.SheetNames[0]]; if (!sheet) throw new Error('El archivo no contiene una hoja.');
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
                const fallbackYear = Number(document.getElementById('fin-proj-import-year')?.value) || new Date().getFullYear();
                const result = finProjParseRows(rows, fallbackYear);
                hvacFinancialProjectionPreview = result.valid.length ? result : null;
                const existing = new Set(hvacFinancialProjectionsRead().map(x => String(x.id)));
                const replacing = result.valid.filter(x => existing.has(x.id)).length;
                if (preview) preview.innerHTML = `<div class="font-black text-slate-800">${result.valid.length} mes(es) válido(s) · ${replacing} reemplazo(s)</div><div class="text-[11px] text-slate-500 mt-1">${result.valid.length ? 'Años encontrados: ' + [...new Set(result.valid.map(x => x.year))].join(', ') : 'No hay datos válidos.'}</div>${result.errors.length ? `<div class="mt-2 text-rose-700">${result.errors.map(esc).join('<br>')}</div>` : '<div class="mt-2 text-emerald-700 font-semibold">La proyección está lista para guardarse.</div>'}`;
                if (btn) { btn.disabled = !result.valid.length; btn.classList.toggle('opacity-50', !result.valid.length); }
            } catch (e) { console.error('[Finanzas] Error al leer proyección:', e); if (preview) preview.textContent = e.message || 'No se pudo leer el archivo.'; }
        }
        function importFinancialProjectionExcel() {
            if (!isCurrentAdmin()) return showToast('Solo el administrador puede guardar la proyección.', 'error');
            const parsed = hvacFinancialProjectionPreview;
            if (!parsed || !parsed.valid || !parsed.valid.length) return showToast('Primero selecciona y valida un archivo con meses y valores.', 'error');
            const current = hvacFinancialProjectionsRead(), existing = new Set(current.map(x => String(x.id)));
            const replacing = parsed.valid.filter(x => existing.has(x.id)).length;
            if (replacing && !window.confirm(`El archivo reemplazará ${replacing} mes(es) que ya tienen proyección. Los demás meses y años se conservarán. ¿Continuar?`)) return;
            const map = new Map(current.map(x => [String(x.id), x]));
            parsed.valid.forEach(x => map.set(String(x.id), x));
            if (!hvacFinancialProjectionsSave([...map.values()].sort((a,b) => String(a.id).localeCompare(String(b.id))))) return;
            const count = parsed.valid.length; closeFinancialProjectionModal(); renderFinancialModule();
            showToast(`Proyección financiera guardada: ${count} mes(es).`);
        }
        function renderFinancialProjectionComparison() {
            const section = document.getElementById('financial-projection-comparison');
            const body = document.getElementById('fin-projection-table-body');
            if (!section || !body) return;

            const periodType = document.getElementById('fin-period-type')?.value || 'YTD';
            const selectedClient = document.getElementById('fin-filter-client')?.value || 'ALL';
            const selectedMaintenanceType = document.getElementById('fin-filter-maintenance-type')?.value || 'ALL';
            const note = document.getElementById('fin-proj-months-note');

            // La proyección que se importa es un presupuesto global por mes: no está segmentada por cliente ni por tipo.
            // Ocultar la comparación cuando esos filtros se usan evita enfrentar un presupuesto global con una parte de la facturación.
            if (selectedClient !== 'ALL' || selectedMaintenanceType !== 'ALL') {
                section.classList.add('hidden');
                return;
            }
            section.classList.remove('hidden');

            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;
            const monthInput = document.getElementById('fin-filter-month');
            const yearInput = document.getElementById('fin-filter-year');
            if (periodType === 'MONTH' && monthInput && !monthInput.value) monthInput.value = currentYear + '-' + String(currentMonth).padStart(2, '0');
            if (periodType === 'YEAR' && yearInput && !yearInput.value) yearInput.value = String(currentYear);

            const projectionMap = new Map();
            hvacFinancialProjectionsRead().forEach(p => {
                const id = String(p.id || '');
                const year = Number(p.year || id.slice(0, 4));
                const month = Number(p.month || id.slice(5, 7));
                const amount = Number(p.projectedAmount ?? p.amount ?? p.value);
                if (Number.isInteger(year) && month >= 1 && month <= 12 && Number.isFinite(amount) && amount >= 0) {
                    projectionMap.set(year + '-' + String(month).padStart(2, '0'), amount);
                }
            });

            const actualMap = new Map();
            const addActual = (date, amount) => {
                const key = billingMonthKey(date);
                if (!/^\d{4}-\d{2}$/.test(key)) return;
                actualMap.set(key, (actualMap.get(key) || 0) + (Number(amount) || 0));
            };
            workOrders.filter(o => o && String(o.status || '').toUpperCase() === 'BILLED' && o.invoice && String(o.invoice.number || '').trim())
                .forEach(o => addActual(o.invoice.date || o.date, o.invoice.amount));
            hvacManualInvoicesRead().forEach(x => {
                const inv = x && x.invoice || {};
                if (String(inv.number || '').trim()) addActual(inv.date || x.date, inv.amount);
            });

            let keys = [];
            let periodLabel = '';
            if (periodType === 'MONTH') {
                const selected = String(monthInput?.value || (currentYear + '-' + String(currentMonth).padStart(2, '0')));
                if (/^\d{4}-\d{2}$/.test(selected)) keys = [selected];
                const [yy, mm] = selected.split('-').map(Number);
                periodLabel = Number.isFinite(yy) && mm >= 1 && mm <= 12 ? FIN_PROJ_MONTHS[mm - 1] + ' ' + yy : 'Mes seleccionado';
            } else if (periodType === 'YEAR') {
                const year = Number(yearInput?.value) || currentYear;
                keys = Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));
                periodLabel = 'Año completo ' + year;
            } else if (periodType === 'ALL') {
                keys = [...new Set([...projectionMap.keys(), ...actualMap.keys()])].sort();
                periodLabel = 'Todo el historial';
            } else {
                keys = Array.from({ length: currentMonth }, (_, i) => currentYear + '-' + String(i + 1).padStart(2, '0'));
                periodLabel = 'YTD · Enero a ' + FIN_PROJ_MONTHS[currentMonth - 1] + ' ' + currentYear;
            }

            const label = document.getElementById('fin-proj-period-label');
            if (label) label.textContent = 'Comparación global · ' + periodLabel;
            const actualLabel = document.getElementById('fin-actual-label');
            if (actualLabel) actualLabel.textContent = 'Facturado del periodo';
            const projLabel = document.getElementById('fin-proj-label');
            if (projLabel) projLabel.textContent = 'Proyectado del periodo';

            body.innerHTML = '';
            let sumProjected = 0, sumActual = 0, projectedCount = 0;
            keys.forEach(key => {
                const [year, month] = key.split('-').map(Number);
                const has = projectionMap.has(key);
                const projected = has ? projectionMap.get(key) : null;
                const actual = actualMap.get(key) || 0;
                if (has) { sumProjected += projected; projectedCount++; }
                sumActual += actual;
                const difference = has ? actual - projected : null;
                const percent = has && projected > 0 ? actual / projected * 100 : null;
                const diffClass = difference == null ? 'text-slate-400' : difference >= 0 ? 'text-emerald-600' : 'text-rose-600';
                const monthLabel = (FIN_PROJ_MONTHS[month - 1] || 'Mes') + (periodType === 'ALL' ? ' ' + year : '');
                body.insertAdjacentHTML('beforeend', `<tr><td class="font-bold capitalize">${monthLabel}</td><td class="text-right font-mono">${has ? '$ ' + projected.toLocaleString('es-CO') : '<span class="text-slate-400">Sin proyección</span>'}</td><td class="text-right font-mono font-bold">$ ${actual.toLocaleString('es-CO')}</td><td class="text-right font-mono font-bold ${diffClass}">${has ? (difference < 0 ? '- $ ' + Math.abs(difference).toLocaleString('es-CO') : '$ ' + difference.toLocaleString('es-CO')) : '—'}</td><td class="text-right font-bold">${percent == null ? '—' : percent.toFixed(1).replace('.', ',') + '%'}</td></tr>`);
            });
            if (!keys.length) body.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 text-xs py-5">No hay meses con proyección ni facturación para el periodo seleccionado.</td></tr>';

            const fmt = n => '$ ' + Number(n || 0).toLocaleString('es-CO');
            const completeProjection = keys.length > 0 && projectedCount === keys.length;
            const projectedEl = document.getElementById('fin-proj-total');
            const actualEl = document.getElementById('fin-actual-total');
            const differenceEl = document.getElementById('fin-proj-difference');
            const complianceEl = document.getElementById('fin-proj-compliance');
            if (projectedEl) projectedEl.textContent = projectedCount ? fmt(sumProjected) : 'Sin cargar';
            if (actualEl) actualEl.textContent = fmt(sumActual);
            const diff = sumActual - sumProjected;
            if (differenceEl) {
                differenceEl.textContent = completeProjection ? (diff < 0 ? '- ' + fmt(Math.abs(diff)) : fmt(diff)) : '—';
                differenceEl.classList.add('fd-compare-number');
                differenceEl.classList.toggle('fd-negative', completeProjection && diff < 0);
            }
            if (complianceEl) complianceEl.textContent = !completeProjection || sumProjected <= 0 ? '—' : (sumActual / sumProjected * 100).toFixed(1).replace('.', ',') + '%';
            const progressFill = document.getElementById('fin-proj-progress-fill');
            const progressMarker = document.getElementById('fin-proj-progress-marker');
            const progressTrack = section.querySelector('.fd-progress-track');
            const hasComparableProgress = completeProjection && sumProjected > 0;
            const complianceValue = hasComparableProgress ? (sumActual / sumProjected * 100) : 0;
            if (complianceEl) complianceEl.style.color = !hasComparableProgress ? '#929CAB' : (complianceValue >= 100 ? 'var(--fd-green-dark)' : 'var(--fd-gold)');
            const progressWidth = Math.max(0, Math.min(100, complianceValue));
            // Si el avance supera la meta, la barra queda llena y la marca del 100%
            // se desplaza al punto proporcional dentro del total facturado.
            const markerPosition = complianceValue >= 100 && complianceValue > 0 ? (100 / complianceValue) * 100 : 100;
            if (progressFill) progressFill.style.width = hasComparableProgress ? progressWidth + '%' : '0%';
            if (progressMarker) {
                progressMarker.style.left = markerPosition + '%';
                progressMarker.style.display = hasComparableProgress && sumActual > 0 ? 'block' : 'none';
            }
            if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(Math.round(progressWidth)));
            if (note) {
                if (!keys.length) note.textContent = 'No hay datos para comparar en este periodo. Puedes importar la proyección del año desde el botón superior.';
                else if (completeProjection) note.textContent = `Proyección completa: ${projectedCount} de ${keys.length} mes(es). Diferencia = facturado menos proyectado; cumplimiento = facturado / proyectado.`;
                else note.textContent = `Proyección cargada para ${projectedCount} de ${keys.length} mes(es). Se muestra el proyectado disponible, pero la diferencia y el cumplimiento quedan pendientes hasta completar todos los meses del periodo.`;
            }
            const summary = document.getElementById('fin-projection-summary');
            if (summary) summary.setAttribute('data-difference', String(completeProjection ? diff : ''));
        }

        // ================= CONFIGURACIÓN: APARIENCIA Y PREFERENCIAS GLOBALES =================
        function hvacReadAppFeatureSettings() {
            const defaults = { showManualInvoice: true, showBulkInvoice: true, showFinancialProjection: true, allowZeroExpenses: true };
            try {
                const stored = JSON.parse(localStorage.getItem(HVAC_UI_SETTINGS_KEY) || '{}');
                return { ...defaults, ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) };
            } catch (_) { return defaults; }
        }

        // La cuenta creada en el primer ingreso tiene el ID fijo ADMIN y es la administradora principal.
        function hvacIsPrimaryAdmin() {
            const user = systemUsers.find(u => String(u.id) === String(activeUser));
            return !!(user && user.role === 'ADMIN' && String(user.id) === 'ADMIN' && activeSessionRole === 'ADMIN');
        }

        async function hvacRefreshSharedAppSettings() {
            await hvacStorageReady;
            const hasLocal = localStorage.getItem(HVAC_UI_SETTINGS_KEY) !== null;
            const hasRemoteSnapshot = localStorage.getItem(HVAC_UI_SETTINGS_REMOTE_EXISTS_KEY) === '1';
            if (!navigator.onLine) return { verified: hasRemoteSnapshot || hvacIsPrimaryAdmin(), offline: true, hasLocal, hasRemoteSnapshot };
            const before = Number(localStorage.getItem(HVAC_UI_SETTINGS_SYNC_AT_KEY)) || 0;
            try {
                if (!(await cloudStateProbe())) return { verified: false, offline: false, hasLocal };
                await loadCloudStateKeys([HVAC_UI_SETTINGS_KEY], true);
                const after = Number(localStorage.getItem(HVAC_UI_SETTINGS_SYNC_AT_KEY)) || 0;
                const remoteExists = localStorage.getItem(HVAC_UI_SETTINGS_REMOTE_EXISTS_KEY) === '1';
                return { verified: after > before && (remoteExists || hvacIsPrimaryAdmin()), offline: false, hasLocal: localStorage.getItem(HVAC_UI_SETTINGS_KEY) !== null, hasRemoteSnapshot: remoteExists };
            } catch (err) {
                console.warn('[Configuración] No se pudieron actualizar las preferencias globales:', err);
                return { verified: false, offline: false, hasLocal };
            }
        }

        async function hvacPersistSharedAppSettings(settings) {
            const user = systemUsers.find(u => String(u.id) === String(activeUser)) || {};
            const next = {
                showManualInvoice: settings.showManualInvoice !== false,
                showBulkInvoice: settings.showBulkInvoice !== false,
                showFinancialProjection: settings.showFinancialProjection !== false,
                allowZeroExpenses: settings.allowZeroExpenses !== false,
                updatedAt: Date.now(),
                updatedBy: String(activeUser || ''),
                updatedByName: String(user.name || user.username || 'Administrador')
            };
            try {
                localStorage.setItem(HVAC_UI_SETTINGS_KEY, JSON.stringify(next));
                localStorage.setItem('HVAC_TS_' + HVAC_UI_SETTINGS_KEY, String(next.updatedAt));
            } catch (err) {
                hvacStorageError(err, 'Guardar preferencias globales');
                return { saved: false, synced: false };
            }
            applyAppFeatureVisibility();
            clearTimeout(cloudStateCtl.timers[HVAC_UI_SETTINGS_KEY]);
            try {
                if (navigator.onLine && await cloudStateProbe()) {
                    const synced = await cloudPushState(HVAC_UI_SETTINGS_KEY);
                    if (synced) {
                        localStorage.setItem(HVAC_UI_SETTINGS_REMOTE_EXISTS_KEY, '1');
                        const previousSync = Number(localStorage.getItem(HVAC_UI_SETTINGS_SYNC_AT_KEY)) || 0;
                        localStorage.setItem(HVAC_UI_SETTINGS_SYNC_AT_KEY, String(Math.max(Date.now(), previousSync + 1)));
                        return { saved: true, synced: true };
                    }
                }
            } catch (err) { console.warn('[Configuración] Preferencias guardadas localmente; falta sincronizar:', err); }
            // El valor queda respaldado localmente y en la cola offline; otros administradores lo recibirán al sincronizar.
            if (!cloudStateCtl.disabled) cloudScheduleStatePush(HVAC_UI_SETTINGS_KEY, true);
            return { saved: true, synced: false };
        }

        async function hvacCanSaveInvoiceWithZeroExpenses(expenses, fieldId, contextLabel) {
            if (Number(expenses) !== 0) return true;
            const refreshed = await hvacRefreshSharedAppSettings();
            if (!refreshed.verified) {
                const message = refreshed.offline
                    ? 'No hay una preferencia global sincronizada en este dispositivo. Conéctate a internet y vuelve a intentar para verificar si se permiten gastos en $0.'
                    : 'No se pudo consultar la política global de facturación en Supabase. Por seguridad, no se permite guardar una factura con gastos en $0 hasta verificarla.';
                showToast(message, 'error');
                return false;
            }
            const cfg = hvacReadAppFeatureSettings();
            const field = document.getElementById(fieldId);
            if (!cfg.allowZeroExpenses) {
                showToast('Facturación bloqueada: el administrador principal deshabilitó las facturas con gastos en $0. Ingresa un gasto operativo mayor que cero.', 'error');
                if (field) { field.focus(); try { field.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {} }
                return false;
            }
            const confirmed = window.confirm(
                'ATENCIÓN: los gastos operativos de ' + (contextLabel || 'esta factura') + ' están en $0.\n\n' +
                'La factura se registrará sin costos y el dashboard financiero puede mostrar una utilidad del 100%.\n\n' +
                '¿Confirmas que deseas continuar con los gastos en cero?'
            );
            return !!confirmed;
        }

        function applyAppFeatureVisibility() {
            const cfg = hvacReadAppFeatureSettings();
            const one = document.getElementById('btn-choice-manual-invoice'), bulk = document.getElementById('btn-choice-bulk-invoice');
            const launcher = document.getElementById('btn-manual-invoice-upload'), projection = document.getElementById('btn-financial-projection-upload');
            if (one) one.classList.toggle('hidden', !cfg.showManualInvoice);
            if (bulk) bulk.classList.toggle('hidden', !cfg.showBulkInvoice);
            if (launcher) launcher.classList.toggle('hidden', !(cfg.showManualInvoice || cfg.showBulkInvoice));
            if (projection) projection.classList.toggle('hidden', !cfg.showFinancialProjection);
        }

        function renderSettingsModule() {
            const cfg = hvacReadAppFeatureSettings();
            const ids = ['setting-show-manual-invoice', 'setting-show-bulk-invoice', 'setting-show-financial-projection', 'setting-allow-zero-expenses'];
            const fields = ids.map(id => document.getElementById(id));
            if (fields[0]) fields[0].checked = !!cfg.showManualInvoice;
            if (fields[1]) fields[1].checked = !!cfg.showBulkInvoice;
            if (fields[2]) fields[2].checked = !!cfg.showFinancialProjection;
            if (fields[3]) fields[3].checked = !!cfg.allowZeroExpenses;
            const canEdit = hvacIsPrimaryAdmin();
            fields.forEach(field => { if (field) field.disabled = !canEdit; });
            const reset = document.getElementById('setting-reset-access');
            if (reset) reset.disabled = !canEdit;
            const save = document.getElementById('setting-save-global');
            if (save) save.disabled = !canEdit || hvacAppSettingsSaving;
            const note = document.getElementById('app-settings-permission-note');
            if (note) note.textContent = canEdit
                ? 'Puedes modificar estas reglas globales. Se sincronizan con Supabase para todos los administradores.'
                : 'Vista de solo lectura: únicamente el administrador principal (cuenta inicial) puede cambiar estas preferencias.';
            const syncStatus = document.getElementById('app-settings-sync-status');
            if (syncStatus) {
                const last = Number(localStorage.getItem(HVAC_UI_SETTINGS_SYNC_AT_KEY)) || 0;
                const remoteExists = localStorage.getItem(HVAC_UI_SETTINGS_REMOTE_EXISTS_KEY) === '1';
                syncStatus.textContent = !navigator.onLine
                    ? (remoteExists ? 'Sin conexión: se está usando la última preferencia global publicada.' : 'Sin conexión: todavía no se ha publicado una preferencia global.')
                    : (remoteExists ? (last ? 'Preferencias globales publicadas. Última consulta: ' + new Date(last).toLocaleString('es-CO') : 'Preferencias globales publicadas en Supabase.') : 'Aún no hay preferencias globales publicadas. El administrador principal debe pulsar «Guardar preferencias para todos».');
            }
            applyAppFeatureVisibility();
            try { const theme = document.documentElement.getAttribute('data-theme') || 'light'; ['light','dark'].forEach(k => { const b = document.getElementById('theme-btn-' + k); if (b) b.setAttribute('aria-pressed', String(k === theme)); }); } catch (_) {}
        }

        let hvacAppSettingsSaving = false;
        async function saveAppFeatureSettings() {
            if (hvacAppSettingsSaving) return;
            if (!hvacIsPrimaryAdmin()) {
                renderSettingsModule();
                return showToast('Solo el administrador principal puede modificar las preferencias globales.', 'error');
            }
            hvacAppSettingsSaving = true;
            const fields = ['setting-show-manual-invoice', 'setting-show-bulk-invoice', 'setting-show-financial-projection', 'setting-allow-zero-expenses'].map(id => document.getElementById(id));
            fields.forEach(field => { if (field) field.disabled = true; });
            try {
                const cfg = {
                    showManualInvoice: !!fields[0]?.checked,
                    showBulkInvoice: !!fields[1]?.checked,
                    showFinancialProjection: !!fields[2]?.checked,
                    allowZeroExpenses: !!fields[3]?.checked
                };
                const result = await hvacPersistSharedAppSettings(cfg);
                if (!result.saved) {
                    showToast('No se pudieron guardar las preferencias. Revisa el almacenamiento del dispositivo.', 'error');
                } else if (result.synced) {
                    showToast('Preferencias guardadas en Supabase y aplicadas a todos los administradores.');
                } else {
                    showToast('Preferencias guardadas en este dispositivo; la sincronización global está pendiente.', 'error');
                }
            } finally {
                hvacAppSettingsSaving = false;
                renderSettingsModule();
            }
        }

        async function resetAppFeatureSettings() {
            if (!hvacIsPrimaryAdmin()) return showToast('Solo el administrador principal puede restablecer las preferencias globales.', 'error');
            const current = hvacReadAppFeatureSettings();
            const result = await hvacPersistSharedAppSettings({
                ...current,
                showManualInvoice: true,
                showBulkInvoice: true,
                showFinancialProjection: true,
                allowZeroExpenses: current.allowZeroExpenses
            });
            renderSettingsModule();
            showToast(result.synced ? 'Se restablecieron los accesos y el cambio se compartió con todos los administradores.' : 'Se restablecieron los accesos localmente; la sincronización global está pendiente.', result.synced ? 'success' : 'error');
        }

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyAppFeatureVisibility);
        else applyAppFeatureVisibility();

        function renderFinancialModule() {
            const type = document.getElementById('fin-period-type').value || 'YTD';
            populateFinancialClientDropdown(); // Reconstruye la lista desde facturas existentes y clientes oficiales antes de aplicar el filtro.
            const selectedClient = document.getElementById('fin-filter-client').value || 'ALL';
            const selectedMaintenanceType = document.getElementById('fin-filter-maintenance-type')?.value || 'ALL';
            const matchesMaintenanceType = value => selectedMaintenanceType === 'ALL' || String(value || 'SIN_CLASIFICAR') === selectedMaintenanceType;
            const selMonth = document.getElementById('fin-filter-month').value;
            const selYear = parseInt(document.getElementById('fin-filter-year').value, 10);
            const currentYear = new Date().getFullYear();

            const inSelectedPeriod = dateValue => {
                const monthKey = billingMonthKey(dateValue);
                if (!monthKey) return true;
                const recordYear = parseInt(monthKey.slice(0, 4), 10);
                if (type === 'YTD') return recordYear === currentYear && parseInt(monthKey.slice(5, 7), 10) <= (new Date().getMonth() + 1);
                if (type === 'MONTH') return !selMonth || monthKey === selMonth;
                if (type === 'YEAR') return !selYear || recordYear === selYear;
                return true;
            };

            const billedOrders = workOrders.filter(o => String(o.status || '').toUpperCase() === 'BILLED' && o.invoice && String(o.invoice.number || '').trim());
            const filteredOrders = billedOrders.filter(o =>
                matchesClientFilter(hvacFinancialOrderClientName(o), selectedClient) && inSelectedPeriod(o.invoice.date || o.date) &&
                matchesMaintenanceType(billingRoutineType(o))
            );
            const manualInvoices = hvacManualInvoicesRead();
            const filteredManual = manualInvoices.filter(item => {
                const inv = item && item.invoice ? item.invoice : {};
                return !!inv.number && matchesClientFilter(hvacManualInvoiceClientName(item), selectedClient) &&
                    inSelectedPeriod(inv.date || item.date) && matchesMaintenanceType(hvacManualInvoiceMaintenanceType(item));
            });

            let totalBilled = 0;
            let totalExpenses = 0;
            const tbody = document.getElementById('financial-table-body');
            tbody.innerHTML = '';

            const rows = [
                ...filteredOrders.map(order => ({ kind: 'order', item: order, invoice: order.invoice })),
                ...filteredManual.map(item => ({ kind: 'manual', item: { ...item, client: hvacManualInvoiceClientName(item) }, invoice: item.invoice }))
            ];

            rows.forEach(record => {
                const item = record.item;
                const inv = record.invoice || {};
                const billed = Number(inv.amount || 0);
                const expenses = Number(inv.expenses || 0);
                const net = billed - expenses;
                const margin = billed > 0 ? Math.round((net / billed) * 100) : 0;
                totalBilled += billed;
                totalExpenses += expenses;

                const firstCell = record.kind === 'manual'
                    ? `<span class="font-bold text-indigo-700">Factura manual</span><div class="text-[10px] text-slate-500 mt-0.5">${esc(item.concept || 'Registro histórico')}</div>`
                    : `<span class="font-bold text-slate-900">${esc(item.id)}</span>`;
                const dateCell = record.kind === 'manual' ? esc(inv.date || item.date || '-') : esc(item.date || '-');
                const maintenanceType = record.kind === 'manual'
                    ? hvacManualInvoiceMaintenanceType(item)
                    : (billingRoutineType(item) || 'PREVENTIVO');
                const maintenanceTypeLabel = maintenanceType === 'SIN_CLASIFICAR' ? 'Sin clasificar' : hvacMaintenanceTypeLabel(maintenanceType);
                const financeClientLabel = record.kind === 'manual' ? hvacManualInvoiceClientName(item) : hvacFinancialOrderClientName(item);
                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td>${firstCell}</td>
                    <td class="font-bold text-teal-700">${esc(financeClientLabel || '-')}</td>
                    <td class="text-xs font-bold">${esc(maintenanceTypeLabel)}</td>
                    <td>${dateCell}</td>
                    <td class="font-mono font-bold text-xs">${esc(inv.number || '-')}</td>
                    <td class="font-bold text-slate-900">$ ${billed.toLocaleString('es-CO')}</td>
                    <td class="font-bold text-rose-600">$ ${expenses.toLocaleString('es-CO')}</td>
                    <td class="font-bold text-emerald-600">$ ${net.toLocaleString('es-CO')}</td>
                    <td class="font-bold text-teal-600">${margin}%</td>
                </tr>`);
            });

            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center text-slate-400 text-xs font-medium py-8">No hay facturas para los filtros seleccionados.</td></tr>';
            }

            const netTotal = totalBilled - totalExpenses;
            const totalMargin = totalBilled > 0 ? Math.round((netTotal / totalBilled) * 100) : 0;
            document.getElementById('kpi-fin-billed').innerText = `$ ${totalBilled.toLocaleString('es-CO')}`;
            document.getElementById('kpi-fin-expenses').innerText = `$ ${totalExpenses.toLocaleString('es-CO')}`;
            document.getElementById('kpi-fin-net').innerText = `$ ${netTotal.toLocaleString('es-CO')}`;
            document.getElementById('kpi-fin-margin').innerText = `${totalMargin}%`;
            renderFinancialProjectionComparison();
            applyAppFeatureVisibility();
        }

        function isCurrentAdmin() {
            const user = systemUsers.find(u => String(u.id) === String(activeUser));
            return !!(user && user.role === 'ADMIN' && activeSessionRole === 'ADMIN');
        }

        async function deleteRoutineFromHistory(orderId) {
            if (!isCurrentAdmin()) return showToast('Solo el perfil de administrador puede eliminar rutinas.', 'error');
            const order = workOrders.find(o => String(o.id) === String(orderId));
            if (!order) return showToast('No se encontró la rutina seleccionada.', 'error');
            if (!window.confirm(`¿Eliminar la rutina ${order.id} de ${order.client || 'este cliente'} y sus intervenciones? Esta acción no se puede deshacer.`)) return;
            // Registrar primero la intención de borrado: una carga remota que ya esté en
            // vuelo no debe volver a añadir esta rutina al arreglo local.
            deletedOrderIdMark(orderId);
            workOrders = workOrders.filter(o => String(o.id) !== String(orderId));
            // El borrado prevalece sobre cualquier guardado pendiente de esa misma orden.
            cloudOutboxAdd('hvac_orders', cloudCleanId(orderId), 'delete');
            registrarAuditoria('BORRAR', 'hvac_orders', orderId);
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            renderHistoryModule();
            renderAdminDashboard();
            try {
                const saved = await cloudDeleteOrder(orderId);
                if (!saved) showToast('La rutina se quitó del histórico local y quedó pendiente de sincronización.', 'error');
                else showToast('Rutina eliminada del histórico.');
            } catch (e) {
                console.warn('[Supabase] Eliminación pendiente para sincronizar:', e);
                showToast('La rutina se quitó localmente y se reintentará al recuperar conexión.', 'error');
            }
        }

        // Estado por equipo: una ejecución solo cuenta como finalizada si tiene informe,
        // parámetros completos y checklist completo. Compatibilidad con informes antiguos.
        // Regla única de finalización por equipo: requiere timestamp y todos los
        // parámetros/checklist obligatorios; FINALIZADO explícito conserva compatibilidad.
        function hvacExecutionIsFinalized(order, eqId) {
            const eq = equipmentCatalog.find(e => String(e.id) === String(eqId) || String(e.code) === String(eqId)) || { id: eqId, code: eqId, type: 'EXTRACTOR' };
            const executions = (order && order.executions) || {};
            const exec = executions[eqId] || executions[eq.id] || executions[eq.code] || executions[String(eq.id)] || executions[String(eq.code)];
            if (!exec || typeof exec !== 'object' || !exec.timestamp) return false;
            const evidenceRequired = exec.evidenceRequired === true || Number(exec.evidenceRequirementVersion) >= 1;
            const orderStatus = String(order.status || '').toUpperCase();
            const signatureDecision = String(order.signatureDecision || '').toUpperCase();
            const signature = order.clientSignature || {};
            const alreadyClosed = orderStatus === 'BILLED' || ['SIGNED', 'DECLINED'].includes(signatureDecision) ||
                !!(signature && (signature.signatureImg || signature.image || (signature.timestamp && String(signature.name || '').trim())));
            if (evidenceRequired || (!alreadyClosed && exec.timestamp)) {
                const photoArrays = ['photos', 'fotosAntes', 'fotosDespues', 'fotosAdicionales'];
                const hasEvidence = exec._liteHasEvidence === true || Number(exec.photosCount) > 0 || photoArrays.some(k => Array.isArray(exec[k]) && exec[k].some(Boolean));
                if (!hasEvidence) return false;
            }

            // Correctivo/Revisión: el formulario extendido del técnico neutraliza checklist
            // dinámico y exige estas tres lecturas para marcar el equipo como finalizado.
            const routine = String(exec.tipoRutina || '').trim().toUpperCase();
            if (routine && routine !== 'PREVENTIVO') {
                return ['voltaje', 'amperaje', 'presionOtros'].every(k => String(exec[k] == null ? '' : exec[k]).trim() !== '');
            }
            if (String(exec.status || '').toUpperCase() === 'FINALIZADO') return true;

            const cfg = exec.formConfigSnapshot || equipmentFormsConfig[String(exec.typeKey || eq.type || 'EXTRACTOR').toUpperCase()] || equipmentFormsConfig['EXTRACTOR'] || {};
            const params = String(cfg.params || '').split(',').map(v => v.trim()).filter(Boolean);
            const checklist = String(cfg.checklist || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
            const values = exec.paramsValues || {};
            const checks = exec.checklist || {};
            const paramsComplete = params.every((_, i) => String(values['param_' + i] ?? exec['param_' + i] ?? '').trim() !== '');
            const checklistComplete = checklist.every((_, i) => checks['chk_' + (i + 1)] === true || checks['check_' + (i + 1)] === true || checks[i] === true);
            return (params.length + checklist.length) > 0 && paramsComplete && checklistComplete;
        }

        function hvacOrderProgress(order) {
            const ids = [...new Set((order && order.equipmentIds || []).map(String).filter(Boolean))];
            const total = ids.length;
            const done = ids.filter(id => hvacExecutionIsFinalized(order, id)).length;
            // Fórmula contractual compartida con tecnico.html: equipos finalizados / asignados.
            const percent = total ? Math.round(done / total * 100) : 0;
            return { total, done, pending: Math.max(0, total - done), percent, complete: total > 0 && done === total };
        }

        // ===== 3 estados + matriz de facturación =====
        var HVAC_ST_LABEL = { PENDING: 'Pendiente', IN_PROGRESS: 'En proceso', COMPLETED: 'Completado', BILLED: 'Facturado' };
        var HVAC_ST_CLASS = {
            PENDING: 'bg-amber-50 text-amber-700 border border-amber-200/60',
            IN_PROGRESS: 'bg-sky-50 text-sky-700 border border-sky-200/60',
            COMPLETED: 'bg-emerald-50 text-emerald-700 border border-emerald-200/60',
            BILLED: 'bg-indigo-50 text-indigo-700 border border-indigo-200/60'
        };
        function hvacStateBadge(state, extra) {
            return '<span class="' + HVAC_ST_CLASS[state] + ' text-[10px] font-bold px-2.5 py-1 rounded-full uppercase">' + HVAC_ST_LABEL[state] + (extra ? ' · ' + esc(extra) : '') + '</span>';
        }
        function hvacOrderHasExecution(o) {
            return Object.values((o && o.executions) || {}).some(x => x && typeof x === 'object' && (x.timestamp || x.status));
        }
        // Estado derivado de UNA orden (no se persiste: tecnico.html sigue viendo 'PENDING')
        function hvacOrderState(o) {
            const s = String(o && o.status || '').toUpperCase();
            if (s === 'BILLED') return 'BILLED';
            // En una fila resumen no existe executions (se carga solo al revisar/PDF).
            // status COMPLETED ya es el estado persistido y se respeta sin bajar las fotos.
            if (o && o._hvacSummaryOnly) {
                if (s === 'COMPLETED') return 'COMPLETED';
                if (s === 'IN_PROGRESS') return 'IN_PROGRESS';
                const pc = hvacProgressCache.get(String(o.id));
                return (pc && pc.ok && (pc.done > 0 || pc.started > 0)) ? 'IN_PROGRESS' : 'PENDING';
            }
            const live = hvacLiveProgress(o);
            if (live) {
                if (s === 'COMPLETED' && live.total > 0 && live.done >= live.total) return 'COMPLETED';
                return (live.done > 0 || live.started > 0) ? 'IN_PROGRESS' : 'PENDING';
            }
            const p = hvacOrderProgress(o);
            if (s === 'COMPLETED' && p.complete) return 'COMPLETED';
            return (p.done > 0 || hvacOrderHasExecution(o)) ? 'IN_PROGRESS' : 'PENDING';
        }
        // Matriz = orden base (PREV0005) y sus partes PREV0005-P1, -P2…
        function hvacMatrixBase(o) { return (o && (o.zoneBaseId || hvacStripZoneSuffix(o.id))) || ''; }
        function hvacMatrixParts(o) {
            const base = hvacMatrixBase(o);
            return (workOrders || []).filter(x => x && !String(x.id).startsWith('HIST-') &&
                (x.zoneBaseId === base || hvacStripZoneSuffix(x.id) === base));
        }
        function hvacMatrixState(o) {
            const st = hvacMatrixParts(o).map(hvacOrderState);
            if (!st.length) return hvacOrderState(o);
            if (st.every(x => x === 'BILLED')) return 'BILLED';
            if (st.every(x => x === 'COMPLETED' || x === 'BILLED')) return 'COMPLETED';
            return st.some(x => x !== 'PENDING') ? 'IN_PROGRESS' : 'PENDING';
        }
        // Trae de Supabase las hermanas que el histórico paginado aún no cargó
        async function hvacLoadMatrixParts(o) {
            const base = encodeURIComponent(hvacMatrixBase(o));
            try {
                const rows = await cloudFetchOrderSummaries('&or=' + encodeURIComponent('(id.eq.' + base + ',id.like.' + base + '-P*)') + '&limit=100');
                if (!Array.isArray(rows)) return false;
                mergeOrderSummariesIntoList(rows);
                return true;
            } catch (e) { console.warn('[Matriz] No se pudieron verificar las partes:', e); return false; }
        }
        // Regla estricta: no se factura la matriz si alguna parte no está Completada/Facturada
        async function hvacAssertMatrixBillable(order) {
            const base = hvacMatrixBase(order);
            const verified = await hvacLoadMatrixParts(order);
            const parts = hvacMatrixParts(order);
            const expected = Math.max(order.zoneParts || 1, parts.length);
            if (!verified && parts.length < expected) {
                return { ok: false, base, parts, blocking: [], reason: 'No se pudieron verificar las partes de ' + base + '. Revisa la conexión e inténtalo de nuevo.' };
            }
            const blocking = parts.filter(p => !['COMPLETED', 'BILLED'].includes(String(p.status || '').toUpperCase())).map(p => p.id);
            return {
                ok: blocking.length === 0, base, parts, blocking,
                reason: blocking.length ? 'No se puede facturar ' + base + ': faltan por completar ' + blocking.join(', ') + '.' : ''
            };
        }
        // La factura vive en una sola parte (titular) para no duplicar valores en Finanzas
        function hvacMatrixHolder(o) {
            const parts = hvacMatrixParts(o);
            return parts.find(p => p.invoice && !p.invoice.matrixRef && (p.invoice.number || p.invoice.amount))
                || [...parts].sort((a, b) => (a.zonePart || 0) - (b.zonePart || 0))[0] || o;
        }

        // ===== Recogida de herramientas (personal administrativo) =====
        // Al cerrar la rutina la orden sigue dos caminos: facturación y recogida (order.toolPickup).
        var HVAC_TOOLPICKUP_FROM = Date.parse('2026-10-30T00:00:00');   // fecha de puesta en marcha: no marca como pendientes las órdenes anteriores
        function hvacToolPickupRequest(order) {
            if (billingRoutineType(order) === 'REVISION') { order.toolPickup = null; return; }   // las revisiones no requieren recogida de herramientas
            order.toolPickup = { status: 'PENDING', requestedAt: new Date().toISOString() };
        }
        // Matriz (rutina dividida en partes -P1, -P2…): la recogida es UNA sola, a nombre de la primera parte, y solo aparece cuando todas las partes están completadas.
        function hvacIsMatrixOrder(o) {
            return !!(o && (o.zoneBaseId || /-P\d+$/i.test(String(o.id || '')) || Number(o.zoneParts || 1) > 1));
        }
        function hvacToolPickupHolder(o) {
            const parts = hvacMatrixParts(o);
            return [...parts].sort((a, b) => (Number(a.zonePart || 0) - Number(b.zonePart || 0)) || String(a.id).localeCompare(String(b.id), 'es', { numeric: true }))[0] || o;
        }
        // null = no aplica | 'PENDING' | 'DONE'. Cubre también órdenes cerradas desde otra app (sin campo toolPickup).
        function hvacToolPickupState(o) {
            if (!o) return null;
            if (billingRoutineType(o) === 'REVISION') return null;               // revisión: nunca hay recogida
            const st = String(o.status || '').toUpperCase();
            if (st !== 'COMPLETED' && st !== 'BILLED') return null;
            if (hvacIsMatrixOrder(o)) {
                const parts = hvacMatrixParts(o);
                const holder = hvacToolPickupHolder(o);
                if (!holder || String(holder.id) !== String(o.id)) return null;  // solo la primera parte representa a toda la matriz
                const expected = Math.max(Number(o.zoneParts || 1), parts.length);
                if (parts.length < expected) return null;                         // aún no se han cargado todas las partes
                if (!parts.every(p => ['COMPLETED', 'BILLED'].includes(hvacOrderState(p)))) return null;   // faltan partes por completar
                const tpOf = x => (x && x.toolPickup && x.toolPickup.status) ? x.toolPickup : null;
                if (tpOf(o)) return tpOf(o).status === 'DONE' ? 'DONE' : 'PENDING';
                if (parts.every(p => tpOf(p) && tpOf(p).status === 'DONE')) return 'DONE';
                const lastSig = Math.max(...parts.map(p => parseFlexDate(p.clientSignature && p.clientSignature.timestamp) || 0));
                return (lastSig && lastSig >= HVAC_TOOLPICKUP_FROM) ? 'PENDING' : null;
            }
            if (o.toolPickup && o.toolPickup.status) return o.toolPickup.status === 'DONE' ? 'DONE' : 'PENDING';
            const t = parseFlexDate(o.clientSignature && o.clientSignature.timestamp);
            return (t && t >= HVAC_TOOLPICKUP_FROM) ? 'PENDING' : null;
        }
        function hvacToolDoneAt(o) {
            if (hvacIsMatrixOrder(o)) {   // la matriz se considera terminada cuando termina su última parte
                const t = Math.max(...hvacMatrixParts(o).map(p => parseFlexDate((p.toolPickup && p.toolPickup.requestedAt) || (p.clientSignature && p.clientSignature.timestamp)) || 0));
                if (t > 0) return t;
            }
            return parseFlexDate((o.toolPickup && o.toolPickup.requestedAt) || (o.clientSignature && o.clientSignature.timestamp)) || 0;
        }
        function hvacToolChip(o) {
            if (hvacToolPickupState(o) !== 'PENDING') return '';
            return '<div class="mt-1"><span class="bg-amber-50 text-amber-700 border border-amber-200/60 text-[10px] font-bold px-2 py-0.5 rounded-full"><i class="fa-solid fa-toolbox mr-1"></i>Herramientas por recoger</span></div>';
        }
        function hvacUpdateToolsBadge() {
            const b = document.getElementById('nav-tools-badge'); if (!b) return;
            const n = (workOrders || []).filter(o => hvacToolPickupState(o) === 'PENDING').length;
            b.textContent = n > 99 ? '99+' : String(n);
            b.classList.toggle('hidden', n === 0);
        }
        async function hvacToolPickupSet(ids, done, note) {
            const u = systemUsers.find(x => String(x.id) === String(activeUser));
            const who = u ? (u.name || u.username || '') : '';
            for (const id of ids) {
                const o = workOrders.find(x => String(x.id) === String(id)); if (!o) continue;
                const prev = o.toolPickup || { requestedAt: new Date(hvacToolDoneAt(o) || Date.now()).toISOString() };
                const now = new Date().toISOString();
                const history = Array.isArray(prev.history) ? prev.history.slice() : [];
                // Migración transparente: conserva como evento la recogida actual de versiones anteriores.
                if (!history.length && prev.status === 'DONE' && prev.doneAt) {
                    history.push({ action: 'RECOGIDA', at: prev.doneAt, by: prev.doneBy || '', note: prev.note || '' });
                }
                history.push({ action: done ? 'RECOGIDA' : 'REAPERTURA', at: now, by: who, note: done ? (note || '') : (note || 'Recogida reabierta') });
                o.toolPickup = done
                    ? { ...prev, status: 'DONE', doneAt: now, doneBy: who, note: note || '', history }
                    : { ...prev, status: 'PENDING', history };
                await cloudSaveOrder(o);
                try { registrarAuditoria(done ? 'RECOGER_HERRAMIENTAS' : 'REABRIR_RECOGIDA', 'hvac_orders', o.id); } catch (e) {}
            }
            localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders));
            renderToolsModule(); // ya llama a renderToolsHistory() internamente
            showToast(done ? 'Recogida de herramientas registrada.' : 'Recogida reabierta.', 'success');
        }
        function renderToolsModule() {
            const list = document.getElementById('tools-list'); if (!list) return;
            const f = (document.getElementById('tools-filter') || {}).value || 'PENDING';
            const q = normText((document.getElementById('tools-search') || {}).value || '');
            const all = (workOrders || []).filter(o => o && !String(o.id).startsWith('HIST-') && hvacToolPickupState(o));
            const pend = all.filter(o => hvacToolPickupState(o) === 'PENDING');
            const days = o => Math.max(0, Math.floor((Date.now() - hvacToolDoneAt(o)) / 86400000));
            const late = pend.filter(o => days(o) > 2).length;
            const kpi = (label, val, cls) => '<div class="bg-white p-3 rounded-2xl border border-slate-200/80 shadow-sm"><div class="text-[10px] font-bold text-slate-500 uppercase">' + label + '</div><div class="text-xl font-black ' + cls + '">' + val + '</div></div>';
            document.getElementById('tools-kpis').innerHTML = kpi('Pendientes', pend.length, 'text-amber-600') + kpi('Con +2 días', late, late ? 'text-rose-600' : 'text-slate-900');
            renderToolsHistory();
            let rows = f === 'PENDING' ? pend : f === 'DONE' ? all.filter(o => hvacToolPickupState(o) === 'DONE') : all;
            if (q) rows = rows.filter(o => normText([o.id, o.client, o.zoneName, o.technician].join(' ')).includes(q));
            if (!rows.length) { list.innerHTML = '<div class="bg-white p-8 rounded-2xl border border-slate-200/80 text-center text-xs text-slate-400">' + (f === 'PENDING' ? 'No hay herramientas pendientes por recoger.' : 'Sin resultados.') + '</div>'; return; }
            const groups = new Map();
            rows.forEach(o => { const b = hvacMatrixBase(o) || o.id; if (!groups.has(b)) groups.set(b, []); groups.get(b).push(o); });
            const fmt = t => t ? new Date(t).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
            const arr = Array.from(groups.entries()).map(([base, os]) => ({ base, os: os.sort((a, b) => String(a.id).localeCompare(String(b.id), 'es', { numeric: true })), t: Math.min(...os.map(hvacToolDoneAt)) }));
            arr.sort((a, b) => f === 'DONE' ? b.t - a.t : a.t - b.t);
            list.innerHTML = arr.map(g => {
                const pendIds = g.os.filter(o => hvacToolPickupState(o) === 'PENDING').map(o => o.id);
                const head = g.os.length > 1
                    ? '<div class="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-slate-100"><div><div class="text-sm font-black text-slate-900 leading-tight">' + esc(g.os[0].client || 'Sin cliente') + '</div><span class="font-mono font-bold text-xs text-slate-500">' + esc(g.base) + '</span><span class="text-[11px] text-slate-500 ml-2">· ' + g.os.length + ' partes</span></div>' +
                      (pendIds.length > 1 ? '<button type="button" data-act="group" data-ids="' + esc(pendIds.join('|')) + '" class="btn-teal text-[11px]"><i class="fa-solid fa-check-double"></i> Marcar toda la matriz (' + pendIds.length + ')</button>' : '') + '</div>'
                    : '';
                const items = g.os.map(o => {
                    const st = hvacToolPickupState(o), d = days(o);
                    const chip = st === 'PENDING'
                        ? '<span class="' + (d > 2 ? 'bg-rose-50 text-rose-700 border border-rose-200/60' : 'bg-amber-50 text-amber-700 border border-amber-200/60') + ' text-[10px] font-bold px-2 py-0.5 rounded-full">' + (d === 0 ? 'Hoy' : d + ' día(s) esperando') + '</span>'
                        : '<span class="bg-emerald-50 text-emerald-700 border border-emerald-200/60 text-[10px] font-bold px-2 py-0.5 rounded-full">Recogida</span>';
                    const tp = o.toolPickup || {};
                    const body = st === 'PENDING'
                        ? '<div class="flex gap-2 items-center mt-2"><input type="text" class="tp-note input-box text-xs flex-1" placeholder="Observación (opcional)"><button type="button" data-act="one" data-ids="' + esc(o.id) + '" class="btn-teal text-[11px]" style="flex:none"><i class="fa-solid fa-check"></i> Recogida</button></div>'
                        : '<div class="flex items-center justify-between gap-2 mt-1.5 flex-wrap"><span class="text-[11px] text-slate-500">Recogida el ' + fmt(parseFlexDate(tp.doneAt)) + (tp.doneBy ? ' por ' + esc(tp.doneBy) : '') + (tp.note ? ' · ' + esc(tp.note) : '') + '</span><button type="button" data-act="reopen" data-ids="' + esc(o.id) + '" class="text-[11px] font-bold text-slate-500 hover:text-slate-800 underline">Reabrir</button></div>';
                    return '<div class="pt-2"><div class="flex items-center justify-between gap-2 flex-wrap"><div><div class="text-sm font-black text-slate-900 leading-tight">' + esc(o.client || 'Sin cliente') + '</div><span class="font-mono font-bold text-xs text-slate-500">' + esc(hvacIsMatrixOrder(o) ? hvacMatrixBase(o) : o.id) + '</span>' +
                        (hvacIsMatrixOrder(o) ? '<span class="text-[11px] text-slate-600 ml-2">Rutina completa (' + hvacMatrixParts(o).length + ' partes)</span>' : (o.zoneName ? '<span class="text-[11px] text-slate-600 ml-2">' + esc(o.zoneName) + '</span>' : '')) + '</div>' + chip + '</div>' +
                        '<div class="text-[11px] text-slate-500 mt-0.5">Técnico(s): ' + esc(o.technician || '-') + ' · Finalizada: ' + fmt(hvacToolDoneAt(o)) + '</div>' + body + '</div>';
                }).join('');
                return '<div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">' + head + items + '</div>';
            }).join('');
            list.onclick = function (e) {
                const b = e.target.closest('button[data-act]'); if (!b) return;
                const ids = String(b.dataset.ids || '').split('|').filter(Boolean);
                const act = b.dataset.act;
                if (act === 'reopen') return hvacToolPickupSet(ids, false);
                const note = act === 'one' ? ((b.closest('.pt-2') || {}).querySelector ? (b.closest('.pt-2').querySelector('.tp-note') || {}).value : '') : '';
                b.disabled = true;
                hvacToolPickupSet(ids, true, (note || '').trim());
            };
        }

        function renderToolsHistory() {
            const host = document.getElementById('tools-history-list'); if (!host) return;
            const q = normText((document.getElementById('tools-history-search') || {}).value || '');
            const events = [];
            (workOrders || []).forEach(o => {
                if (!o || String(o.id || '').startsWith('HIST-')) return;
                const tp = o.toolPickup || {};
                let history = Array.isArray(tp.history) ? tp.history : [];
                // Compatibilidad con recogidas realizadas antes de activar el historial detallado.
                if (!history.length && tp.status === 'DONE' && tp.doneAt) {
                    history = [{ action: 'RECOGIDA', at: tp.doneAt, by: tp.doneBy || '', note: tp.note || '', legacy: true }];
                }
                history.forEach(ev => events.push({
                    order: o.id, client: o.client || '', zone: o.zoneName || '', technician: o.technician || '',
                    action: ev.action || 'RECOGIDA', at: ev.at || ev.timestamp || '', by: ev.by || ev.doneBy || '',
                    note: ev.note || '', legacy: !!ev.legacy
                }));
            });
            // Solo se puede revertir la ÚLTIMA recogida de una orden que hoy sigue como recogida
            const lastByOrder = {};
            events.forEach(ev => { const t = parseFlexDate(ev.at) || 0; if (!(ev.order in lastByOrder) || t >= lastByOrder[ev.order]) lastByOrder[ev.order] = t; });
            events.forEach(ev => {
                const ord = (workOrders || []).find(x => String(x.id) === String(ev.order));
                ev.canRevert = ev.action === 'RECOGIDA' && !!ord && hvacToolPickupState(ord) === 'DONE' && (parseFlexDate(ev.at) || 0) === lastByOrder[ev.order];
            });
            const matches = events.filter(e => !q || normText([e.order,e.client,e.zone,e.technician,e.by,e.note,e.action].join(' ')).includes(q));
            matches.sort((a,b) => (parseFlexDate(b.at) || 0) - (parseFlexDate(a.at) || 0));
            const fmtDate = value => {
                const d = parseFlexDate(value); return d ? new Date(d).toLocaleString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Fecha no disponible';
            };
            if (!matches.length) {
                host.innerHTML = '<div class="py-8 text-center text-xs text-slate-400">' + (events.length ? 'No hay movimientos que coincidan con la búsqueda.' : 'Aún no hay recogidas registradas. Las nuevas aparecerán aquí automáticamente.') + '</div>';
                return;
            }
            host.innerHTML = '<table class="min-w-full text-xs"><thead><tr><th>Fecha y hora</th><th>Movimiento</th><th>Orden / Cliente</th><th>Técnico(s)</th><th>Responsable</th><th>Observación</th><th></th></tr></thead><tbody>' +
                matches.map(e => '<tr><td class="whitespace-nowrap">' + esc(fmtDate(e.at)) + (e.legacy ? '<div class="text-[10px] text-slate-400">Registro anterior</div>' : '') + '</td>' +
                    '<td><span class="inline-flex rounded-full px-2 py-1 text-[10px] font-bold ' + (e.action === 'REAPERTURA' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700') + '">' + (e.action === 'REAPERTURA' ? 'Reapertura' : 'Recogida') + '</span></td>' +
                    '<td><div class="text-sm font-black text-slate-900 leading-tight">' + esc(e.client || 'Sin cliente') + '</div><div class="text-[11px] text-slate-500"><strong class="font-mono">' + esc(e.order) + '</strong>' + (e.zone ? ' · ' + esc(e.zone) : '') + '</div></td>' +
                    '<td>' + esc(e.technician || '-') + '</td><td>' + esc(e.by || 'No registrado') + '</td><td>' + esc(e.note || '-') + '</td><td class="whitespace-nowrap">' + (e.canRevert ? '<button type="button" data-revert="' + esc(e.order) + '" data-client="' + esc(e.client) + '" class="text-[11px] font-bold text-rose-600 hover:text-rose-800 underline">Revertir</button>' : '') + '</td></tr>').join('') +
                '</tbody></table><div class="text-[10px] text-slate-400 mt-2">' + matches.length + ' movimiento(s) · más recientes primero</div>';
            host.onclick = function (ev) {
                const b = ev.target.closest('button[data-revert]'); if (!b) return;
                const id = b.dataset.revert, cli = b.dataset.client || '';
                if (!confirm('¿Revertir la recogida de herramientas de la orden ' + id + (cli ? ' (' + cli + ')' : '') + '?\n\nVolverá a la lista de pendientes y quedará registrado en el historial.')) return;
                b.disabled = true;
                hvacToolPickupSet([id], false, 'Recogida revertida (confirmada por error)');
            };
        }

        function hvacReactivateOrderIfNeeded(order, previousIds) {
            if (!order) return false;
            const before = new Set((previousIds || []).map(String));
            const added = (order.equipmentIds || []).some(id => !before.has(String(id)));
            const progress = hvacOrderProgress(order);
            if ((added || !progress.complete) && String(order.status || '').toUpperCase() === 'COMPLETED') {
                order.status = 'PENDING';
                order.clientSignature = null;
                order.updatedAt = new Date().toISOString();
                return true;
            }
            if (added && !['BILLED'].includes(String(order.status || '').toUpperCase())) {
                order.status = progress.complete ? 'COMPLETED' : 'PENDING';
                order.updatedAt = new Date().toISOString();
                return true;
            }
            return false;
        }

        function renderHistoryModule() {
            const tbody = document.getElementById('history-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            
            const searchText = normText(document.getElementById('hist-search-input')?.value);
            const selectedClient = document.getElementById('hist-filter-client')?.value || 'ALL';
            const selectedStatus = document.getElementById('hist-filter-status')?.value || 'ALL';
            // Todas las órdenes visibles (incluidas COMPLETED) necesitan avance real si son summaryOnly sin caché.
            if (navigator.onLine) {
                const need = workOrders.filter(o => o && o._hvacSummaryOnly && !String(o.id || '').startsWith('HIST-')
                    && !['BILLED'].includes(String(o.status || '').toUpperCase())
                    && matchesClientFilter(String(o.client || o.clientName || ''), selectedClient)
                    && !(hvacProgressCache.get(String(o.id)) || {}).ok).slice(0, 40);
                if (need.length) hvacRefreshProgress(need).then(changed => { if (changed && hvacHistoryVisible()) renderHistoryModule(); }).catch(() => {});
            }
            const filteredHistory = workOrders.filter(o => {
                const orderId = String(o.id || '');
                const client = String(o.client || o.clientName || '');
                const technician = String(o.technician || '');
                const matchesText = !searchText || [orderId, client, technician].some(value => normText(value).includes(searchText));
                const matchesClient = matchesClientFilter(client, selectedClient);
                const matchesStatus = selectedStatus === 'ALL' || hvacOrderState(o) === selectedStatus;
                return matchesText && matchesClient && matchesStatus;
            }).sort(getHistoryComparator()); // orden elegido (por defecto: más reciente arriba)

            const total = filteredHistory.length;
            const pages = Math.max(1, Math.ceil(total / PAGER_ROWS));
            historyPager.page = Math.min(Math.max(1, historyPager.page), pages);
            const startIdx = (historyPager.page - 1) * PAGER_ROWS;
            const pageList = filteredHistory.slice(startIdx, startIdx + PAGER_ROWS);
            const atEnd = historyPager.page >= pages;
            updatePager('history-table-body', {
                page: historyPager.page, pages, hasNext: !atEnd || historyState.hasMore,
                meta: `Mostrando ${total ? startIdx + 1 : 0}-${Math.min(startIdx + PAGER_ROWS, total)} de ${total} órdenes cargadas${historyState.hasMore ? ' · hay más antiguas (Siguiente las carga)' : ''}`,
                onPrev: () => { historyPager.page = Math.max(1, historyPager.page - 1); renderHistoryModule(); },
                onNext: async () => {
                    if (!atEnd) historyPager.page++;
                    else if (historyState.hasMore) { await fetchHistoryPage(false); historyPager.page++; }
                    renderHistoryModule();
                }
            });
            if (total === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 font-medium">No hay órdenes que coincidan con los filtros seleccionados.</td></tr>`;
                return;
            }

            pageList.forEach(o => {
                const eqIds = [...new Set((o.equipmentIds || []).map(String).filter(Boolean))];
                let doneCount = null, percent = null;
                let progressTitle = 'Consultando avance real; el listado no descarga fotos ni payload completo.';
                if (o._hvacSummaryOnly) {
                    // Fuente directa: executions ya viene en el resumen desde Supabase.
                    if (o.executions && Object.keys(o.executions).length && eqIds.length) {
                        const p = hvacOrderProgress(o);
                        doneCount = p.done;
                        percent = p.percent;
                        progressTitle = 'Avance calculado desde ejecuciones de la orden.';
                    }
                    const pc = hvacProgressCache.get(String(o.id));
                    // Se acepta el caché cuando el total coincide con eqIds, O cuando eqIds aún
                    // no llegó del resumen (eqIds.length === 0) pero el caché sí tiene datos válidos.
                    const pcTotal = pc && pc.ok ? Number(pc.total) : -1;
                    const eqLen = eqIds.length;
                    const pcMatches = percent == null && pc && pc.ok && (pcTotal === eqLen || (eqLen === 0 && pcTotal > 0));
                    if (pcMatches) {
                        const refLen = eqLen > 0 ? eqLen : pcTotal;
                        doneCount = Math.min(Math.max(0, pc.done), refLen);
                        percent = refLen ? Math.round(doneCount / refLen * 100) : 0;
                        progressTitle = pc.source === 'rpc' ? 'Avance actualizado desde RPC.' : 'Avance actualizado desde la vista ligera.';
                    } else if (o.progressSnapshot && Number.isFinite(Number(o.progressSnapshot.done)) && Number(o.progressSnapshot.total) > 0 &&
                               (eqIds.length === 0 || Number(o.progressSnapshot.total) === eqIds.length)) {
                        const snapTotal = Number(o.progressSnapshot.total);
                        doneCount = Math.min(Math.max(0, Number(o.progressSnapshot.done)), snapTotal);
                        percent = Math.round(doneCount / snapTotal * 100);
                        progressTitle = 'Avance técnico conservado al momento de facturar.';
                    } else if (o.executions && Object.keys(o.executions).length) {
                        const localProgress = hvacOrderProgress(o);
                        doneCount = localProgress.done;
                        percent = localProgress.percent;
                        progressTitle = 'Avance calculado desde ejecuciones locales disponibles.';
                    } else if (['COMPLETED', 'BILLED'].includes(String(o.status || '').toUpperCase()) && eqIds.length) {
                        // Orden cerrada sin caché ni snapshot: se muestra 100% mientras llega el dato real de la nube.
                        doneCount = eqIds.length;
                        percent = 100;
                        progressTitle = 'Avance confirmado al cierre; actualizando desde la nube…';
                    }
                } else {
                    const missingByEquipment = [];
                    eqIds.forEach(eqId => {
                        const eq = equipmentCatalog.find(e => String(e.id) === String(eqId) || String(e.code) === String(eqId)) || { id: eqId, code: eqId, type: 'EXTRACTOR' };
                        if (!hvacExecutionIsFinalized(o, eqId)) missingByEquipment.push(`${eq.code || eqId}: pendiente de finalizar informe`);
                    });
                    const progress = hvacOrderProgress(o);
                    const live = hvacLiveProgress(o);
                    if (live) {
                        doneCount = Math.min(Math.max(0, live.done), eqIds.length);
                        percent = eqIds.length ? Math.round(doneCount / eqIds.length * 100) : 0;
                        progressTitle = 'Avance actualizado desde la nube.';
                    } else {
                        doneCount = progress.done;
                        percent = progress.percent;
                        progressTitle = missingByEquipment.length ? missingByEquipment.join(' | ') : 'Todos los equipos están finalizados.';
                    }
                }
                const percentLabel = percent == null ? '—' : percent + '%';
                const progressWidth = percent == null ? 0 : percent;
                const doneLabel = doneCount == null ? '—' : doneCount;
                // Si el resumen llegó sin equipmentIds, usar el total del caché para el label
                const pc2 = hvacProgressCache.get(String(o.id));
                const totalLabel = eqIds.length > 0 ? eqIds.length : (pc2 && pc2.ok && pc2.total > 0 ? pc2.total : (o.progressSnapshot && Number(o.progressSnapshot.total) > 0 ? Number(o.progressSnapshot.total) : eqIds.length));
                const ownState = hvacOrderState(o);
                const mParts = hvacMatrixParts(o);
                let statusBadge = hvacStateBadge(ownState) + hvacToolChip(o);
                if (mParts.length > 1) {
                    const ms = hvacMatrixState(o);
                    const okParts = mParts.filter(p => ['COMPLETED', 'BILLED'].includes(hvacOrderState(p))).length;
                    statusBadge += `<div class="text-[10px] text-slate-500 mt-1">Matriz ${esc(hvacMatrixBase(o))}: <b>${HVAC_ST_LABEL[ms]}</b> (${okParts}/${mParts.length} partes)</div>`;
                }

                tbody.insertAdjacentHTML('beforeend', `<tr>
                    <td class="font-bold text-slate-900">${esc(o.id)}</td>
                    <td class="font-bold text-teal-700">${esc(o.client)}</td>
                    <td class="font-medium text-slate-600">${esc(o.technician || 'Sin asignar')}</td>
                    <td class="font-medium">${esc(o.date || '-')}</td>
                    <td>
                        <div class="w-44 space-y-1" title="${esc(progressTitle)}">
                            <div class="flex items-center gap-2">
                                <div class="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
                                    <div class="bg-teal-500 h-2 rounded-full transition-all duration-300" style="width: ${progressWidth}%;"></div>
                                </div>
                                <span class="text-[11px] font-bold text-slate-600 w-9 text-right">${percentLabel}</span>
                            </div>
                            <div class="text-[10px] text-slate-500">${doneLabel}/${esc(totalLabel)} equipos completos</div>
                        </div>
                    </td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        <div class="inline-flex items-center gap-1.5">
                            <button onclick="openEditRoutineModal('${escJs(o.id)}')" class="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition" title="Editar rutina (técnicos, equipos y fechas)"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="openOrderHub('${escJs(o.id)}')" class="btn-teal text-xs py-1.5 px-3"><i class="fa-solid fa-folder-open"></i> Revisar</button>
                            ${isCurrentAdmin() ? `<button onclick="deleteRoutineFromHistory('${escJs(o.id)}')" class="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition" title="Eliminar rutina y sus intervenciones"><i class="fa-solid fa-trash"></i></button>` : ''}
                        </div>
                    </td>
                </tr>`);
            });
            // Avance real de las filas visibles (una llamada diminuta; solo repinta si algo cambió)
            historyState.lastPage = pageList;
            hvacRefreshProgress(pageList).then(changed => { if (changed && hvacHistoryVisible()) renderHistoryModule(); }).catch(() => {});
        }
        function hvacHistoryVisible() {
            const sec = document.getElementById('view-admin-history');
            return !!(sec && !sec.classList.contains('hidden'));
        }
        // Mientras el histórico esté a la vista y la pestaña activa: revisa el avance cada 60 s (≈1 KB) y al volver a la pestaña.
        function hvacHistoryProgressTick() {
            if (document.hidden || !navigator.onLine || !hvacHistoryVisible() || !historyState.lastPage) return;
            hvacRefreshProgress(historyState.lastPage).then(changed => { if (changed && hvacHistoryVisible()) renderHistoryModule(); }).catch(() => {});
        }
        setInterval(hvacHistoryProgressTick, HVAC_PROGRESS_TTL);
        // Caja menor, agenda y financiero: mientras la pestaña esté a la vista y activa, se revisa cada 10 min si otro equipo cambió algo.
        // La consulta solo trae id+versión y descarga únicamente las filas que cambiaron (unos pocos KB).
        const HVAC_STATE_TICK_MS = 10 * 60 * 1000;
        async function hvacStateSectionTick() {
            try {
                if (document.hidden || !navigator.onLine || typeof estadoPullKeys !== 'function') return;
                const active = document.querySelector('main > section[id^="view-"]:not(.hidden)');
                const tabId = active && active.id ? active.id.replace(/^view-/, '') : '';
                const cfg = CLOUD_SECTION_CONFIG[tabId];
                if (!cfg || appBusyCount > 0) return;
                // Secciones que dependen de hvac_orders: se refresca la tabla si está vencida (TTL 5 min)
                // y se repinta la vista. Esto evita el retraso de ~10 min para ver nuevas rutinas finalizadas.
                if (['admin-billing', 'admin-tools'].includes(tabId)) {
                    if (cloudTableStale('hvac_orders')) {
                        await loadCloudSection(tabId, false);
                    }
                    return;
                }
                // Resto de secciones: solo revisan claves de estado (caja, agenda, financiero, dashboard)
                if (!cfg.state || !cfg.state.length || !['admin-dashboard', 'admin-caja', 'admin-agenda', 'admin-financial'].includes(tabId)) return;
                const tableKeys = cfg.state.filter(k => ESTADO_TABLAS[k]);
                const genericKeys = cfg.state.filter(k => !ESTADO_TABLAS[k]);
                let changed = tableKeys.length ? await estadoPullKeys(tableKeys, true) : false;
                if (genericKeys.length) changed = (await loadCloudStateKeys(genericKeys, true)) || changed;
                if (changed) { restoreLocalAppData(); if (document.getElementById('view-' + tabId) && !document.getElementById('view-' + tabId).classList.contains('hidden')) renderSection(tabId); }
            } catch (e) { console.warn('[Estado] Refresco periódico omitido:', e); }
        }
        setInterval(hvacStateSectionTick, HVAC_STATE_TICK_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) hvacStateSectionTick(); });
        document.addEventListener('visibilitychange', hvacHistoryProgressTick);

        let appBusyCount = 0;
        let appBusyTimer = null;
        function appBusyStart(label, immediate) {
            appBusyCount++;
            if (appBusyTimer) { clearTimeout(appBusyTimer); appBusyTimer = null; }
            const show = () => {
                const overlay = document.getElementById('app-processing-overlay');
                const text = document.getElementById('app-processing-label');
                if (overlay && appBusyCount > 0) {
                    if (text) text.textContent = label || 'Procesando información…';
                    overlay.classList.add('is-visible');
                    overlay.setAttribute('aria-hidden', 'false');
                }
            };
            if (immediate) show(); else appBusyTimer = setTimeout(show, 80);
        }
        function appBusyEnd() {
            appBusyCount = Math.max(0, appBusyCount - 1);
            if (appBusyCount) return;
            if (appBusyTimer) clearTimeout(appBusyTimer);
            appBusyTimer = null;
            const overlay = document.getElementById('app-processing-overlay');
            if (overlay) {
                overlay.classList.remove('is-visible');
                overlay.setAttribute('aria-hidden', 'true');
            }
        }
        // Cede un cuadro de pintura para que el spinner se vea antes de un trabajo síncrono pesado (PDF, Excel).
        const appNextPaint = () => new Promise(resolve => {
            let done = false;
            const go = () => { if (!done) { done = true; resolve(); } };
            requestAnimationFrame(() => setTimeout(go, 0));
            setTimeout(go, 60);
        });
        // instant = true: el spinner aparece de inmediato y se espera a que se pinte antes de ejecutar.
        function wrapWithGlobalProcessing(name, label, instant) {
            const original = window[name];
            if (typeof original !== 'function' || original.__hvacBusyWrapped) return;
            const wrapped = async function (...args) {
                appBusyStart(label, instant);
                try {
                    if (instant) await appNextPaint();
                    return await original.apply(this, args);
                } finally { appBusyEnd(); }
            };
            wrapped.__hvacBusyWrapped = true;
            window[name] = wrapped;
        }
        [
            ['executeLogin', 'Verificando credenciales…', true],
            ['saveEquipmentExecution', 'Guardando intervención…'],
            ['saveEquipmentRecord', 'Guardando equipo…'],
            ['deleteEquipmentRecord', 'Eliminando equipo…'],
            ['saveCajaRecord', 'Guardando caja menor…'],
            ['deleteCajaRecord', 'Eliminando gasto…'],
            ['deleteLegalizationRecord', 'Revirtiendo legalización…'],
            ['processCajaLegalization', 'Guardando legalización…', true],
            ['saveNewRoutineManual', 'Creando rutina…'],
            ['saveScheduleRoutine', 'Programando mantenimiento…'],
            ['saveScheduleAgendaRoutine', 'Programando intervención…'],
            ['saveClientRecord', 'Guardando cliente…'],
            ['deleteClientRecord', 'Eliminando cliente…'],
            ['saveUserRecord', 'Guardando usuario…'],
            ['deleteUserRecord', 'Eliminando usuario…'],
            ['saveInvoiceRecord', 'Guardando factura…'],
            ['saveManualInvoiceRecord', 'Guardando factura histórica…'],
            ['revertInvoiceRecord', 'Revirtiendo factura…', true],
            ['submitGlobalSignature', 'Guardando firma y cierre…'],
            ['finalizeRoutineWithoutSignature', 'Cerrando rutina…'],
            ['deleteRoutineFromHistory', 'Eliminando rutina…'],
            ['removeEquipmentFromJob', 'Actualizando rutina…'],
            ['confirmAddEquipmentToJob', 'Agregando equipo…'],
            ['processBatchProjectionUpload', 'Procesando archivo…', true],
            ['processBatchEquipmentUpload', 'Procesando archivo…', true],
            ['generateConsolidatedRoutinePDFDirect', 'Generando PDF…', true],
            ['generateSingleEquipmentPDF', 'Generando PDF…', true],
            ['generateCajaLegalizationPDF', 'Generando PDF…', true],
            ['downloadLegalizationReceipt', 'Generando recibo de legalización…', true]
        ].forEach(([name, label, instant]) => wrapWithGlobalProcessing(name, label, instant));

        window.addEventListener('DOMContentLoaded', async () => {
            // Finanzas abre por defecto en YTD (hasta la fecha actual).
            const finPeriodDefault = document.getElementById('fin-period-type');
            if (finPeriodDefault) finPeriodDefault.value = 'YTD';
            const finMonthDefault = document.getElementById('fin-filter-month');
            const finYearDefault = document.getElementById('fin-filter-year');
            const finNow = new Date();
            if (finMonthDefault && !finMonthDefault.value) finMonthDefault.value = finNow.getFullYear() + '-' + String(finNow.getMonth() + 1).padStart(2, '0');
            if (finYearDefault && !finYearDefault.value) finYearDefault.value = String(finNow.getFullYear());
            document.getElementById('fin-filter-month-field')?.classList.add('hidden');
            document.getElementById('fin-filter-year-field')?.classList.add('hidden');
            await hvacStorageReady;
            await hvacFlushStorageWrites();
            restoreLocalAppData();
            const hasSession = restoreActiveSession();
            updateSidebarLinks();
            if (hasSession) {
                const user = systemUsers.find(x => String(x.id) === String(activeUser));
                document.getElementById('app-login-screen').classList.add('hidden');
                if (user) switchTab('admin-dashboard');
                try { if (window.hvacSyncUser) window.hvacSyncUser(); } catch (e) {}
            } else {
                document.getElementById('app-login-screen').classList.remove('hidden');
            }
            // Sin consultas a Supabase aquí: cada módulo carga sus datos al abrirse (loadCloudSection).
        });
    