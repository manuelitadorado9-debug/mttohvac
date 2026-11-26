
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
        // La app del técnico solo sincroniza: agenda (correctivos que reporta) y formularios (solo lectura).
        const CLOUD_STATE_KEYS = ['HVAC_AGENDA_BACKUP', 'HVAC_FORMS_CONFIG_BACKUP'];
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
        function hvacIsQuotaError(err) {
            return !!err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
        }
        function hvacIDBWriteOnce(id, value) {
            return hvacOpenDb().then(db => new Promise((resolve, reject) => {
                let tx; try { tx = db.transaction('kv', 'readwrite'); const req = tx.objectStore('kv').put({ id: String(id), value: String(value), updatedAt: Date.now() }); req.onerror = () => { try { hvacStorageError(req.error, 'Escritura IndexedDB'); } catch (_) {} }; } catch (e) { reject(e); return; }
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => { const e = tx.error || new Error('No se pudo respaldar en IndexedDB'); hvacStorageError(e, 'Transacción IndexedDB'); reject(e); };
            }));
        }
        function hvacEvictRedundantIndexedBackups(protectedId) {
            const optionalKeys = ['HVAC_EQUIPMENTS_BACKUP', 'HVAC_TECH_USERS_BACKUP', 'HVAC_CLIENTS_BACKUP'];
            return hvacOpenDb().then(db => new Promise((resolve, reject) => {
                const tx = db.transaction('kv', 'readwrite');
                const store = tx.objectStore('kv');
                optionalKeys.forEach(key => {
                    if (key === String(protectedId)) return;
                    const req = store.get(key);
                    req.onsuccess = () => {
                        const row = req.result;
                        let localValue = null;
                        try { localValue = hvacNativeGetItem.call(window.localStorage, key); } catch (_) {}
                        // Solo quitar una copia de IDB si la copia idéntica sigue en localStorage.
                        if (row && localValue !== null && String(row.value) === localValue) store.delete(key);
                    };
                });
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => reject(tx.error || new Error('No se pudieron liberar respaldos duplicados'));
            }));
        }
        function hvacIDBSet(id, value) {
            return hvacIDBWriteOnce(id, value).catch(async err => {
                if (!hvacIsQuotaError(err)) throw err;
                try { await hvacEvictRedundantIndexedBackups(String(id)); } catch (_) {}
                return hvacIDBWriteOnce(id, value);
            });
        }
        function hvacCleanupOldLocalBackups(protectedKey) {
            const optionalKeys = ['HVAC_EQUIPMENTS_BACKUP', 'HVAC_TECH_USERS_BACKUP', 'HVAC_CLIENTS_BACKUP'];
            return hvacOpenDb().then(db => new Promise((resolve, reject) => {
                const tx = db.transaction('kv', 'readonly');
                const store = tx.objectStore('kv');
                const candidates = [];
                optionalKeys.forEach(key => {
                    if (key === String(protectedKey)) return;
                    const req = store.get(key);
                    req.onsuccess = () => {
                        const row = req.result;
                        let localValue = null;
                        try { localValue = hvacNativeGetItem.call(window.localStorage, key); } catch (_) {}
                        if (row && localValue !== null && String(row.value) === localValue) candidates.push({ key, value: String(row.value) });
                    };
                });
                tx.oncomplete = () => {
                    candidates.forEach(item => {
                        hvacMemoryStorage.set(item.key, item.value);
                        try { hvacNativeRemoveItem.call(window.localStorage, item.key); } catch (_) {}
                    });
                    resolve(candidates.length);
                };
                tx.onerror = tx.onabort = () => reject(tx.error || new Error('No se pudieron limpiar respaldos locales duplicados'));
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
                            hvacStorageError(e, 'Cuota de localStorage para ' + k); console.warn('[Storage] El dato queda en memoria mientras se recupera espacio:', k, e);
                            if (hvacIsQuotaError(e)) {
                                hvacStorageWriteTail = hvacStorageWriteTail
                                    .then(() => hvacCleanupOldLocalBackups(key))
                                    .then(() => {
                                        try {
                                            if (!idbOnly) {
                                                hvacNativeSetItem.call(window.localStorage, key, value);
                                                if (key.indexOf('HVAC_TS_') !== 0) {
                                                    hvacNativeSetItem.call(window.localStorage, 'HVAC_TS_' + key, String(Date.now()));
                                                }
                                            }
                                        } catch (retryError) {
                                            console.warn('[Storage] Se mantiene el respaldo en memoria/IndexedDB:', key, retryError);
                                        }
                                    })
                                    .catch(cleanupError => console.warn('[Storage] No se pudo limpiar caché redundante:', cleanupError));
                            }
                            if (Date.now() - cloudStateCtl.quotaWarnedAt > 60000) {
                                cloudStateCtl.quotaWarnedAt = Date.now();
                                try { showToast('Liberando espacio local y completando el respaldo offline en segundo plano.', 'success'); } catch (_) {}
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
        const AUTH_SESSION_KEY = 'HVAC_AUTH_SESSION_TECH';
        const AUTH_SESSION_TTL = 24 * 60 * 60 * 1000; // la sesión dura 24 h o hasta pulsar "Cerrar sesión"
        let currentExecOrderId = null;
        let currentExecEqId = null;
        let sigCanvas, sigCtx, isDrawing = false;
        let tempPhotosList = [];
        let currentHubTab = 'equipos'; // 'equipos' o 'correctivos'
        let AFC_HEADER_IMG = ''; // se carga desde Supabase Storage (common.js)
        let AFC_FOOTER_IMG = ''; // se carga desde Supabase Storage (common.js)
        let systemUsers = [];
        let equipmentCatalog = [];
        let workOrders = [];
        let clientsCatalog = [];
        let agendaItems = [];
        let equipmentFormsConfig = {
            "EXTRACTOR": { name: "EXTRACTOR", params: "Voltaje (V), Amperaje (A)", checklist: "Limpieza de Filtros de Aire\nLavado de Serpentín\nAjuste de Bornes Eléctricos" },
            "MINISPLIT": { name: "MINISPLIT", params: "Voltaje (V), Amperaje (A), Presión Succión (PSI), Presión Descarga (PSI)", checklist: "Limpieza de Filtros de Aire\nLavado de Serpentín Evaporador\nLavado de Serpentín Condensador\nLimpieza de Bandeja y Desagüe\nAjuste de Bornes Eléctricos\nVerificación de Presiones y Gas" }
        };

        // =========================================================================
        // INTERFAZ MÓVIL DEL TÉCNICO (solo presentación; la lógica de datos es la original)
        // =========================================================================

        // Busca un equipo priorizando el ID único (el código puede repetirse entre clientes).
        function techFindEq(key) {
            const k = String(key);
            return equipmentCatalog.find(e => String(e.id) === k) || equipmentCatalog.find(e => String(e.code) === k);
        }

        // Se muestran rutinas PREVENTIVAS, de REVISIÓN y correctivos planificados. Las órdenes de la agenda de correctivos son exclusivas del administrador.
        function isPreventiveOrder(o) {
            if (!o) return false;
            const id = String(o.id || '');
            if (id.startsWith('HIST-') || id.startsWith('ORD-IND-')) return false;
            const t = String(o.maintenanceType || o.type || 'PREVENTIVO').toUpperCase();
            const planned = String(o.tipoRutina || '').toUpperCase();
            if (t === 'REVISION' || t === 'REV' || planned === 'REVISION') return true;     // revisión técnica planificada por el administrador
            if (t === 'CORRECTIVO' || t === 'COR') return planned === 'CORRECTIVO';       // correctivo planificado en Planificación; los de la agenda siguen siendo solo del admin
            return t === 'PREVENTIVO';
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

        // =====================================================================
        //  SINCRONIZACIÓN POR FILAS (agenda, caja, proyecciones, legalizaciones)
        //  Reemplaza el "bloque JSON completo" de hvac_app_state por tablas reales.
        //  - Solo se envían las filas que cambiaron (no se reescribe todo).
        //  - Control de versión optimista: si otra persona modificó la misma fila,
        //    NO se pisa: se conserva lo ya guardado y tu copia queda respaldada.
        // =====================================================================
        const ESTADO_TABLAS = {
            HVAC_AGENDA_BACKUP: 'hvac_agenda'
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
                    r = await supabaseFetch(`${tabla}?on_conflict=id`, 'POST', [{ id, payload: item, updated_by: user }],
                        { 'Prefer': 'resolution=ignore-duplicates,return=representation' }, { quiet: true });
                } else {                                      // UPDATE solo si la versión sigue siendo la que leímos
                    r = await supabaseFetch(`${tabla}?id=eq.${encodeURIComponent(id)}&version=eq.${s.v}`, 'PATCH',
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


        function showToast(message, type = "success") {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            const icon = type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check';
            toast.className = 'toast ' + (type === 'error' ? 'toast-error' : 'toast-ok');
            toast.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
            toast.querySelector('span:last-child').textContent = String(message);
            container.appendChild(toast);
            setTimeout(() => {
                toast.classList.add('toast-out');
                setTimeout(() => toast.remove(), 250);
            }, 3500);
        }

        // Las credenciales de administradores nunca se conservan en el teléfono del técnico.
        function techStripAdminUsers() {
            if (Array.isArray(systemUsers)) systemUsers = systemUsers.filter(u => u && u.role !== 'ADMIN');
        }

        function restoreLocalAppData() {
            const localEqs = readLocalBackup('HVAC_EQUIPMENTS_BACKUP', equipmentCatalog);
            const localOrds = readLocalBackup('HVAC_ORDERS_BACKUP', workOrders);
            const localClis = readLocalBackup('HVAC_CLIENTS_BACKUP', clientsCatalog);
            const localUsrs = readLocalBackup('HVAC_TECH_USERS_BACKUP', systemUsers);
            const localAgenda = readLocalBackup('HVAC_AGENDA_BACKUP', agendaItems);
            const localForms = readLocalBackup('HVAC_FORMS_CONFIG_BACKUP', equipmentFormsConfig);

            if (Array.isArray(localEqs)) equipmentCatalog = localEqs;
            if (Array.isArray(localOrds)) workOrders = localOrds;
            if (Array.isArray(localClis)) clientsCatalog = localClis;
            if (Array.isArray(localUsrs) && localUsrs.length) systemUsers = localUsrs;
            if (Array.isArray(localAgenda)) agendaItems = localAgenda;
            if (localForms && typeof localForms === 'object' && !Array.isArray(localForms)) equipmentFormsConfig = localForms;
            techStripAdminUsers();
        }

        function refreshAppFromCurrentData() {
            try { renderTechAgenda(); } catch (e) { console.warn('[UI] No se pudo actualizar la agenda del técnico:', e); }
            try {
                if (restoreActiveSession()) {
                    document.getElementById('app-login-screen').classList.add('hidden');
                    syncTechUser();
                } else {
                    syncTechUser();
                    document.getElementById('app-login-screen').classList.remove('hidden');
                }
            } catch (e) {
                console.warn('[UI] No se pudo actualizar la sesión:', e);
            }
        }

        // Cloudflare R2: sube la imagen al capturarla; si no hay red o R2 no está configurado, se conserva en Base64
        const r2keep = (d, folder) => (window.HVAC && HVAC.r2) ? HVAC.r2.keep(d, folder) : Promise.resolve(d);
        const hvacPrefetch = o => (window.HVAC && HVAC.img && HVAC.img.prefetchIn) ? HVAC.img.prefetchIn(o) : Promise.resolve();
        async function compressImage(file, maxWidth = 800, quality = 0.65, maxBytes = 150 * 1024, silent = false) {
            // maxBytes se conserva por compatibilidad con las llamadas existentes.
            // Esta versión prioriza una única codificación: no vuelve a comprimir en bucle.
            if (!file || !file.type || !file.type.startsWith('image/')) {
                const error = new Error('Selecciona un archivo de imagen válido.');
                console.error('[compressImage]', error);
                if (!silent) try { showToast(error.message, 'error'); } catch (_) {}
                throw error;
            }

            let objectUrl = null;
            let img = null;
            let canvas = null;

            try {
                objectUrl = URL.createObjectURL(file);
                img = new Image();
                img.decoding = 'async';

                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = () => reject(new Error('No se pudo decodificar la imagen. Usa una foto JPG o PNG.'));
                    img.src = objectUrl;
                });

                // La imagen ya está decodificada; liberamos el Blob URL inmediatamente.
                URL.revokeObjectURL(objectUrl);
                objectUrl = null;

                const srcW = img.naturalWidth || img.width;
                const srcH = img.naturalHeight || img.height;
                if (!srcW || !srcH) throw new Error('La imagen está vacía o dañada.');

                // Una sola operación matemática. Ningún lado supera 800 px.
                const requestedEdge = Number(maxWidth);
                const edgeLimit = Math.max(1, Math.min(
                    800,
                    Number.isFinite(requestedEdge) && requestedEdge > 0 ? requestedEdge : 800
                ));
                const scale = Math.min(1, edgeLimit / Math.max(srcW, srcH));
                const width = Math.max(1, Math.round(srcW * scale));
                const height = Math.max(1, Math.round(srcH * scale));

                const requestedQuality = Number(quality);
                const jpegQuality = Math.max(0.3, Math.min(
                    0.65,
                    Number.isFinite(requestedQuality) && requestedQuality > 0 ? requestedQuality : 0.65
                ));

                canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d', { alpha: false });
                if (!ctx) throw new Error('Tu navegador no pudo procesar la imagen.');

                ctx.fillStyle = '#ffffff'; // Mantiene fondo blanco en imágenes PNG transparentes.
                ctx.fillRect(0, 0, width, height);
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                // Una sola codificación JPEG asíncrona a calidad balanceada.
                const blob = await new Promise((resolve, reject) => {
                    if (typeof canvas.toBlob !== 'function') {
                        reject(new Error('Este navegador no permite codificar imágenes.'));
                        return;
                    }
                    canvas.toBlob(
                        result => result ? resolve(result) : reject(new Error('No se pudo codificar la imagen.')),
                        'image/jpeg',
                        jpegQuality
                    );
                });

                // Se conserva el contrato previo: la función devuelve un dataURL Base64.
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen comprimida.'));
                    reader.readAsDataURL(blob);
                });

                if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;')) {
                    throw new Error('No se pudo comprimir la imagen.');
                }
                return dataUrl;

            } catch (error) {
                const message = error && error.message ? error.message : 'No se pudo comprimir la imagen seleccionada.';
                console.error('[compressImage]', message, error);
                if (!silent) try { showToast(message, 'error'); } catch (_) {}
                throw error instanceof Error ? error : new Error(message);

            } finally {
                if (objectUrl) {
                    try { URL.revokeObjectURL(objectUrl); } catch (_) {}
                }
                if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                }
                if (img) {
                    img.onload = null;
                    img.onerror = null;
                    img.src = '';
                }
            }
        }

        // =========================================================================
        // CAPA DE NUBE ROBUSTA (Supabase): reintentos, cola por registro, bandeja de salida,
        // diagnóstico de credenciales y sincronización de módulos locales.
        // Los nombres y parámetros de las funciones cloud* se conservan.
        // =========================================================================
        const cloudCtl = { lastToast: 0, lastStatus: 0, lastOutboxTs: 0, queues: {}, bigWarned: {}, loading: null, flushing: null, durability: {} };
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

        function cloudSetBadge(state, detail) {
            const b = document.getElementById('sidebar-sync-badge');
            if (!b) return;
            const map = {
                ok: ['fa-circle-check text-emerald-400', 'Cloud Enlazado'],
                offline: ['fa-cloud-bolt text-amber-400', 'Sin conexión'],
                error: ['fa-triangle-exclamation text-rose-400', 'Error de nube'],
                syncing: ['fa-arrows-rotate fa-spin text-amber-400', 'Sincronizando…']
            };
            const m = map[state] || map.ok;
            b.innerHTML = '<i class="fa-solid ' + m[0] + '"></i> ' + m[1];
            b.title = detail || '';
        }

        function cloudReport(ok, status, detail, method, endpoint) {
            if (ok) {
                cloudCtl.lastStatus = 200;
                const pending = cloudOutboxRead().length;
                cloudSetBadge(pending ? 'syncing' : 'ok', pending ? pending + ' cambio(s) pendiente(s)' : '');
                return;
            }
            cloudCtl.lastStatus = status;
            console.warn('[Supabase] ' + method + ' ' + endpoint + ' -> ' + status, detail || '');
            if (status === 401 || status === 403) {
                cloudSetBadge('error', 'HTTP ' + status + '; cambios locales conservados para sincronizar.');
                return;
            }
            if (status === 429 || status === 'network' || status === 'timeout') {
                cloudSetBadge('syncing', 'Cambios locales en cola; se reintentará automáticamente.');
                return;
            }
            const offline = status === 'offline';
            cloudSetBadge(offline ? 'offline' : 'error', 'HTTP ' + status);
            if (Date.now() - cloudCtl.lastToast < 45000) return;
            cloudCtl.lastToast = Date.now();
            let msg = 'No se pudo sincronizar con la nube (' + status + '). Tus datos están a salvo en este dispositivo.';
            if (offline) msg = 'Sin conexión con la nube. Los cambios se guardan aquí y se reenviarán al reconectar.';
            else if (status === 401 || status === 403) msg = 'La nube rechazó las credenciales (HTTP ' + status + '). Revisa SUPABASE_KEY y las políticas RLS.';
            else if (status === 404) msg = 'Tabla no encontrada en Supabase (HTTP 404). Verifica que existan las tablas hvac_*.';
            try { showToast(msg, 'error'); } catch (_) {}
        }

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
            const headers = {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            };
            if (method === 'POST') headers['Prefer'] = 'return=representation';
            if (extraHeaders) Object.assign(headers, extraHeaders);
            const payload = body ? JSON.stringify(body) : undefined;
            const MAX_TRIES = 2;
            for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
                const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const timer = ctrl ? setTimeout(() => ctrl.abort(), 25000) : null;
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, { method, headers, body: payload, signal: ctrl ? ctrl.signal : undefined, cache: opts && opts.noStore ? 'no-store' : 'default' });
                    if (res.ok) {
                        cloudCtl.lastStatus = 200;
                        if (!quiet) cloudReport(true);
                        if (method === 'DELETE') return true;
                        const txt = await res.text();
                        hvacEgress.note(endpoint, method, txt.length);
                        if (!txt) return true;
                        try { return JSON.parse(txt); } catch (e) { return true; }
                    }
                    const detail = await res.text().catch(() => '');
                    if ((res.status === 429 || res.status >= 500) && attempt < MAX_TRIES) {
                        if (timer) clearTimeout(timer);
                        await cloudSleep(res.status === 429 ? 1200 : 700);
                        continue;
                    }
                    cloudCtl.lastStatus = res.status;
                    if (!quiet) cloudReport(false, res.status, detail, method, endpoint);
                    return null;
                } catch (err) {
                    if (attempt < MAX_TRIES) { await cloudSleep(700); continue; }
                    const status = err && err.name === 'AbortError' ? 'timeout' : 'network';
                    cloudCtl.lastStatus = status;
                    if (!quiet) cloudReport(false, status, String(err), method, endpoint);
                    return null;
                } finally {
                    if (timer) clearTimeout(timer);
                }
            }
            return null;
        }

        // Indicador visible y sincronización manual de la bandeja de salida.
        let techSyncCloseTimer = null;
        function techSyncAutoClose(ms) { clearTimeout(techSyncCloseTimer); techSyncCloseTimer = setTimeout(closeTechSyncStatus, ms); }
        function setTechSyncStatus(title, subtitle, detail, percent, pending) {
            clearTimeout(techSyncCloseTimer);
            const modal = document.getElementById('tech-sync-modal');
            if (modal) modal.classList.remove('hidden');
            const put = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
            put('tech-sync-title', title); put('tech-sync-subtitle', subtitle); put('tech-sync-detail', detail);
            put('tech-sync-count', 'Bandeja de salida: ' + Number(pending || 0));
            put('tech-sync-percent', Math.max(0, Math.min(100, Number(percent || 0))) + '%');
            const value = Math.max(0, Math.min(100, Number(percent || 0)));
            const bar = document.getElementById('tech-sync-progress'); if (bar) bar.style.width = value + '%';
            const track = document.getElementById('tech-sync-progress-track'); if (track) track.setAttribute('aria-valuenow', String(value));
            const icon = document.getElementById('tech-sync-icon');
            if (icon) {
                const t = String(title || '').toLowerCase();
                const isSuccess = t.includes('completada');
                const isError = t.includes('no se pudo') || t.includes('pendiente') || t.includes('parcial');
                icon.innerHTML = isSuccess ? '<i class="fa-solid fa-circle-check"></i>' : isError ? '<i class="fa-solid fa-triangle-exclamation"></i>' : '<i class="fa-solid fa-arrows-rotate"></i>';
                icon.style.background = isSuccess ? 'rgba(34,197,94,.14)' : isError ? 'rgba(245,158,11,.14)' : 'rgba(59,130,246,.13)';
                icon.style.color = isSuccess ? '#22c55e' : isError ? '#f59e0b' : 'var(--primary)';
            }
        }
        function closeTechSyncStatus() { clearTimeout(techSyncCloseTimer); const el = document.getElementById('tech-sync-modal'); if (el) el.classList.add('hidden'); }
        async function syncTechNow() {
            const pendingBefore = cloudOutboxRead().length;
            if (!navigator.onLine) {
                setTechSyncStatus('Esperando red', 'No hay conexión a internet en este momento.', 'Los datos permanecen guardados localmente y se reintentará cuando vuelva la conexión.', 0, pendingBefore);
                return;
            }
            setTechSyncStatus('Preparando sincronización', 'Protegiendo los cambios locales antes de enviarlos.', 'Guardando la bandeja de salida en el almacenamiento persistente…', 10, pendingBefore);
            try {
                await hvacStorageReady;
                await hvacFlushStorageWrites();
                setTechSyncStatus('Sincronizando datos…', 'Procesando rutinas y cambios pendientes.', 'Enviando ' + pendingBefore + ' cambio(s) de la bandeja de salida y actualizando las rutinas asignadas.', 35, cloudOutboxRead().length);
                await cloudFlushOutbox();
                await window.loadAllCloudData(true);
                await cloudFlushOutbox();
                await hvacFlushStorageWrites();
                const pendingAfter = cloudOutboxRead().length;
                if (!navigator.onLine) {
                    setTechSyncStatus('Esperando red', 'La conexión se interrumpió durante la sincronización.', 'Los elementos no confirmados siguen en la bandeja de salida.', 60, pendingAfter);
                } else if (pendingAfter === 0 && cloudCtl.lastStatus !== 401 && cloudCtl.lastStatus !== 403) {
                    setTechSyncStatus('Sincronización completada', 'Los cambios pendientes fueron procesados.', 'Rutinas cargadas: ' + workOrders.length + '. No quedan operaciones en la bandeja de salida.', 100, 0);
                    techSyncAutoClose(1000);   // se quita sola 1 segundo después de completarse
                } else {
                    setTechSyncStatus('Sincronización parcial', 'Algunos cambios no recibieron confirmación de la nube.', pendingAfter + ' operación(es) siguen guardadas y se reintentará automáticamente.', 70, pendingAfter);
                }
            } catch (err) {
                console.warn('[Sync] La sincronización manual quedó pendiente:', err);
                setTechSyncStatus(navigator.onLine ? 'Sincronización pendiente' : 'Esperando red', 'No se pudo confirmar el envío de todos los cambios.', 'Los datos locales se conservan; revisa la conexión y vuelve a sincronizar.', 35, cloudOutboxRead().length);
            }
        }

        // ---- Bandeja de salida: cambios que no llegaron a la nube ----
        function cloudOutboxRead() { try { return JSON.parse(localStorage.getItem('HVAC_CLOUD_OUTBOX') || '[]'); } catch (e) { return []; } }
        function cloudOutboxWrite(a) { try { localStorage.setItem('HVAC_CLOUD_OUTBOX', JSON.stringify(a)); } catch (e) {} }
        function cloudOutboxAdd(table, id, op, payload) {
            const existing = cloudOutboxRead();
            const latestTs = existing.reduce((max, entry) => Math.max(max, Number(entry.ts) || 0), 0);
            const a = existing.filter(x => !(x.table === table && x.id === id));
            cloudCtl.lastOutboxTs = Math.max(Date.now(), cloudCtl.lastOutboxTs + 1, latestTs + 1);
            const e = { table, id, op, ts: cloudCtl.lastOutboxTs };
            if (payload !== undefined) e.payload = payload; // copia exacta de lo que se quiso guardar
            a.push(e);
            cloudOutboxWrite(a);
            cloudSetBadge('syncing', 'Cambio guardado localmente; sincronización en segundo plano.');
            const durable = hvacIDBSet('HVAC_OUTBOX::' + table + '::' + id, JSON.stringify(e)).then(() => ({ ts: e.ts, persisted: true })).catch(err => {
                console.error('[Offline] No se pudo guardar una operación en IndexedDB:', err);
                return { ts: e.ts, persisted: false };
            });
            cloudCtl.durability[table + ':' + id] = durable;
            durable.then(() => {
                if (cloudCtl.durability[table + ':' + id] === durable) delete cloudCtl.durability[table + ':' + id];
            });
            return durable;
        }
        function cloudOutboxClear(table, id, expectedTs) {
            const a = cloudOutboxRead();
            const b = a.filter(x => {
                if (!(x.table === table && x.id === id)) return true;
                return expectedTs != null && Number(x.ts || 0) > Number(expectedTs);
            });
            if (b.length !== a.length) cloudOutboxWrite(b);
            const newer = b.find(x => x.table === table && x.id === id);
            hvacStorageWriteTail = hvacStorageWriteTail.then(() => newer
                ? hvacIDBSet('HVAC_OUTBOX::' + table + '::' + id, JSON.stringify(newer))
                : hvacIDBDelete('HVAC_OUTBOX::' + table + '::' + id)).catch(() => {});
            const pending = b.length;
            cloudSetBadge(pending ? 'syncing' : 'ok', pending ? pending + ' cambio(s) pendiente(s)' : '');
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

        // ---- Rutinas compartidas por varios técnicos: se conserva el avance más reciente de cada equipo ----
        const execTs = e => String((e && e.timestamp) || '');
        // Datos que solo modifica el administrador: siempre manda la versión de la nube
        const ADMIN_ORDER_FIELDS = ['client', 'date', 'technician', 'technicians', 'equipmentIds', 'zoneId', 'zoneName', 'zonePart', 'zoneParts', 'zoneBaseId', 'budget', 'periodicity', 'maintenanceType'];
        function adoptAdminFields(target, remote) {
            if (!target || !remote) return target;
            ADMIN_ORDER_FIELDS.forEach(k => { if (remote[k] !== undefined) target[k] = Array.isArray(remote[k]) ? remote[k].slice() : remote[k]; });
            return target;
        }
        function mergeSharedOrder(local, remote) {
            const out = Object.assign({}, remote, local), ex = Object.assign({}, remote.executions || {});
            // La resolución de firma se decide por su propia fecha, no por el timestamp
            // de una edición posterior de cualquier equipo.
            const decisionTime = value => {
                const v = value && (value.signatureDecisionAt || (value.clientSignature && value.clientSignature.timestamp));
                const n = Date.parse(v || '');
                return Number.isFinite(n) ? n : 0;
            };
            if (decisionTime(remote) > decisionTime(local)) {
                ['signatureDecision', 'signatureDecisionAt', 'signatureDecisionBy', 'signatureDecisionReason', 'clientSignature']
                    .forEach(k => { if (remote[k] !== undefined) out[k] = remote[k]; });
            }
            Object.entries(local.executions || {}).forEach(([k, v]) => { if (!ex[k] || execTs(v) >= execTs(ex[k])) ex[k] = v; });
            out.executions = ex;
            if (remote.technicianFinished) { out.technicianFinished = true; out.technicianFinishedAt = remote.technicianFinishedAt; }
            adoptAdminFields(out, remote);
            const ids = [...new Set((Array.isArray(out.equipmentIds) ? out.equipmentIds : (Array.isArray(local.equipmentIds) ? local.equipmentIds : [])).map(String))];
            out.equipmentIds = ids;
            const remoteIds = [...new Set((Array.isArray(remote.equipmentIds) ? remote.equipmentIds : []).map(String))].sort();
            const localIds = [...new Set((Array.isArray(local.equipmentIds) ? local.equipmentIds : []).map(String))].sort();
            const assignmentChanged = remoteIds.length && (remoteIds.length !== localIds.length || remoteIds.some((id, i) => id !== localIds[i]));
            if (assignmentChanged) { // si el administrador cambia los equipos, la firma y la decisión anteriores ya no cubren la nueva orden
                out.clientSignature = null;
                out.signatureDecision = 'PENDING';
                out.signatureDecisionAt = null;
                out.signatureDecisionBy = null;
                out.signatureDecisionReason = '';
                out.technicianFinished = false;
                out.technicianFinishedAt = null;
            }
            const allDone = ids.length > 0 && ids.every(id => { const e = ex[id]; return !!e && !e.partial && String(e.status || '').toLowerCase() !== 'pending' && String(e.status || '').toLowerCase() !== 'in progress'; });
            const signatureDecision = techSignatureDecision(out);
            if (!allDone || signatureDecision === 'PENDING') {
                out.status = 'PENDING';
                out.technicianFinished = false;
                out.technicianFinishedAt = null;
            } else {
                out.status = 'COMPLETED';
                out.technicianFinished = true;
                out.technicianFinishedAt = out.technicianFinishedAt || out.signatureDecisionAt || (out.clientSignature && out.clientSignature.timestamp) || null;
            }
            return out;
        }
        function applyMergedToLocal(id, merged) {
            const lo = (typeof workOrders !== 'undefined') && workOrders.find(o => o && o.id === id); if (!lo) return;
            lo.executions = Object.assign({}, merged.executions); adoptAdminFields(lo, merged); lo.equipmentIds = [...new Set((merged.equipmentIds || lo.equipmentIds || []).map(String))]; lo.status = merged.status;
            ['signatureDecision', 'signatureDecisionAt', 'signatureDecisionBy', 'signatureDecisionReason'].forEach(k => {
                if (merged[k] !== undefined) lo[k] = merged[k];
            });
            if (merged.clientSignature === null) lo.clientSignature = null;
            else if (merged.clientSignature && (!merged.clientSignature._lite || !lo.clientSignature)) lo.clientSignature = merged.clientSignature;
            lo.technicianFinished = !!merged.technicianFinished;
            if (merged.technicianFinishedAt) lo.technicianFinishedAt = merged.technicianFinishedAt;
            else delete lo.technicianFinishedAt;
        }
        // id de orden -> sync_ts (sello que pone un trigger de la base en cada escritura) la última vez que nuestra copia quedó al día
        const ORDER_SEEN_TS = new Map();
        function cloudUpsert(table, rawId, obj) {
            const cleanId = cloudCleanId(rawId);
            if (table === 'hvac_orders') { try { localStorage.setItem('HVAC_LIST_DIRTY', '1'); } catch (_) {} }
            const payload = JSON.parse(JSON.stringify(obj));
            cloudGuardSize(table, cleanId, payload);
            const durable = cloudOutboxAdd(table, cleanId, 'save', table === 'hvac_app_state' ? undefined : payload); // pendiente hasta confirmar
            return cloudEnqueue(table + ':' + cleanId, async () => {
                const queuedEntry = await durable;
                const enc = encodeURIComponent(cleanId);
                if (window.HVAC && HVAC.r2 && HVAC.r2.hasInline(payload)) {        // fotos tomadas sin señal: se suben a R2 al sincronizar
                    const m = await HVAC.r2.externalize(payload, table);
                    if (m.size) HVAC.r2.applyLocal(table, cleanId, m, { hvac_orders: workOrders });
                }
                let body = payload;
                if (table === 'hvac_orders') {      // fusiona con la nube: conserva lo que cambió el administrador y lo que guardaron otros técnicos
                    // Sonda: si nadie tocó la orden desde nuestra última lectura/escritura, se evita bajar el payload completo
                    // (antes se descargaba entero en CADA guardado). Requiere la columna sync_ts; sin ella se usa el camino anterior.
                    let skipRead = false;
                    const seen = ORDER_SEEN_TS.get(cleanId);
                    if (seen && !EGRESS.tsMissing && !hvacHasLite(payload) && navigator.onLine !== false) {
                        const probe = await supabaseFetch(`hvac_orders?id=eq.${enc}&select=sync_ts`, 'GET', null, null, { quiet: true });
                        if (Array.isArray(probe)) { if (probe[0] && probe[0].sync_ts && probe[0].sync_ts === seen) skipRead = true; }
                        else if ([400, 404].includes(Number(cloudCtl.lastStatus))) EGRESS.tsMissing = true;
                    }
                    let remote = [];
                    if (!skipRead) {
                        remote = await supabaseFetch(`hvac_orders?id=eq.${enc}&select=${EGRESS.tsMissing ? 'payload' : 'payload,sync_ts'}`, 'GET', null, null, { quiet: true });
                        if (!Array.isArray(remote) && !EGRESS.tsMissing && [400, 404].includes(Number(cloudCtl.lastStatus))) {
                            EGRESS.tsMissing = true;
                            remote = await supabaseFetch(`hvac_orders?id=eq.${enc}&select=payload`, 'GET', null, null, { quiet: true });
                        }
                    } else { EGRESS.stats.skipped = (EGRESS.stats.skipped || 0) + 1; }
                    const hasRemote = Array.isArray(remote) && remote[0] && remote[0].payload;
                    if (hvacHasLite(payload)) {
                        // La copia local viene de un listado liviano (sin fotos): jamás se sube recortada.
                        if (!Array.isArray(remote)) return null;                     // sin lectura confiable: queda en la bandeja de salida
                        if (hasRemote) hvacRestoreHeavy(payload, remote[0].payload);
                        hvacStripLiteFlags(payload);
                    }
                    if (skipRead) { body = mergeSharedOrder(payload, payload); applyMergedToLocal(cleanId, body); }   // mismo saneo de estado, sin datos remotos nuevos
                    else if (hasRemote) {
                        body = mergeSharedOrder(payload, remote[0].payload); applyMergedToLocal(cleanId, body);
                        const lo = workOrders.find(o => o && (o.id === cleanId || cloudCleanId(o.id) === cleanId));
                        if (lo && hvacHasLite(lo)) { if (lo.clientSignature && lo.clientSignature._lite && body.clientSignature) lo.clientSignature = body.clientSignature; hvacStripLiteFlags(lo); }
                    }
                }
                // Plan A: upsert atómico (1 petición)
                const wantTs = table === 'hvac_orders' && !EGRESS.tsMissing;      // el upsert devuelve solo sync_ts (unos bytes)
                let r = await supabaseFetch(`${table}?on_conflict=id${wantTs ? '&select=sync_ts' : ''}`, 'POST', { id: cleanId, payload: body }, { 'Prefer': 'resolution=merge-duplicates,' + (wantTs ? 'return=representation' : 'return=minimal') }, { quiet: true });
                if (!r && wantTs && Number(cloudCtl.lastStatus) === 400) EGRESS.tsMissing = true;
                if (!r && [400, 404].includes(Number(cloudCtl.lastStatus))) {
                    // Plan B: verificar y actualizar / insertar
                    const check = await supabaseFetch(`${table}?id=eq.${enc}&select=id`, 'GET', null, null, { quiet: true });
                    if (check && check.length > 0) r = await supabaseFetch(`${table}?id=eq.${enc}`, 'PATCH', { payload: body }, { 'Prefer': 'return=minimal' }, { quiet: true });
                    else if (check) r = await supabaseFetch(table, 'POST', { id: cleanId, payload: body }, null, { quiet: true });
                }
                if (r) {
                    cloudOutboxClear(table, cleanId, queuedEntry.ts);
                    if (table === 'hvac_orders') { const wts = Array.isArray(r) && r[0] && r[0].sync_ts; if (wts) ORDER_SEEN_TS.set(cleanId, wts); else ORDER_SEEN_TS.delete(cleanId); }
                    if (table === 'hvac_orders') { try { egressSet('full:' + cleanId, JSON.stringify(body)); } catch (_) {} }   // lo recién guardado ya es la copia completa más reciente
                }
                return r || null;
            });
        }

        function cloudDeleteGeneric(table, rawId) {
            const cleanId = cloudCleanId(rawId);
            const durable = cloudOutboxAdd(table, cleanId, 'delete');
            return cloudEnqueue(table + ':' + cleanId, async () => {
                const queuedEntry = await durable;
                const r = await supabaseFetch(`${table}?id=eq.${encodeURIComponent(cleanId)}`, 'DELETE');
                if (r) cloudOutboxClear(table, cleanId, queuedEntry.ts);
                return r || null;
            });
        }

        async function cloudSaveEquipment(eq) { return cloudUpsert('hvac_equipments', eq.id || eq.code, eq); }
        async function cloudDeleteEquipment(id) { return cloudDeleteGeneric('hvac_equipments', id); }
        async function cloudSaveOrder(order) { return cloudUpsert('hvac_orders', order.id, order); }
        async function cloudDeleteOrder(id) { return cloudDeleteGeneric('hvac_orders', id); }
        async function cloudSaveClient(cli) { return cloudUpsert('hvac_clients', cli.id, cli); }
        async function cloudDeleteClient(id) { return cloudDeleteGeneric('hvac_clients', id); }
        async function cloudSaveUser(usr) { return cloudUpsert('hvac_users', usr.id, usr); }
        async function cloudDeleteUser(id) { return cloudDeleteGeneric('hvac_users', id); }

        function hvacDataUrlToBlob(dataUrl) {
            try {
                const comma = String(dataUrl).indexOf(',');
                const meta = String(dataUrl).slice(0, comma);
                if (comma < 0 || !/;base64$/i.test(meta)) return null;
                const mime = /^data:([^;]+)/i.exec(meta);
                const binary = atob(String(dataUrl).slice(comma + 1));
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return new Blob([bytes], { type: mime ? mime[1] : 'image/jpeg' });
            } catch (_) {
                return null;
            }
        }

        async function hvacCompressOrderPhotos(order) {
            let changed = false;
            const seen = new Set();
            for (const exec of Object.values(order.executions || {})) {
                if (!exec || seen.has(exec) || !Array.isArray(exec.photos)) continue;
                seen.add(exec);
                for (let i = 0; i < exec.photos.length; i++) {
                    const original = exec.photos[i];
                    if (typeof original !== 'string' || !original.startsWith('data:image/')) continue;
                    const blob = hvacDataUrlToBlob(original);
                    if (!blob) continue;
                    try {
                        const reduced = await compressImage(blob, 640, 0.5, 100 * 1024, true);
                        if (reduced.length < original.length) {
                            exec.photos[i] = reduced;
                            changed = true;
                        }
                    } catch (e) {
                        console.warn('[Offline] No se pudo reducir más una foto durante la recuperación:', e);
                    }
                }
            }
            return changed;
        }

        function persistOrderLocallyAndSync(order) {
            order.updatedAt = new Date().toISOString();
            registrarAuditoria(order.status === 'COMPLETED' ? 'COMPLETAR' : 'EDITAR', 'hvac_orders', order.id);
            const backupKey = 'HVAC_ORDERS_BACKUP';
            const writeOrderBackup = () => {
                const serializedOrders = JSON.stringify(workOrders);
                try {
                    // Actualización sincrónica de localStorage/memoria; IndexedDB continúa aparte.
                    localStorage.setItem(backupKey, serializedOrders);
                } catch (e) {
                    console.warn('[Offline] localStorage no aceptó el respaldo; se conserva en memoria/IndexedDB:', e);
                }
                let localStorageConfirmed = false;
                try { localStorageConfirmed = hvacNativeGetItem.call(window.localStorage, backupKey) === serializedOrders; } catch (_) {}
                const indexedBackup = hvacIDBSet(backupKey, serializedOrders).then(() => true).catch(e => {
                    console.warn('[Offline] Se reintentará el respaldo IndexedDB:', e);
                    return false;
                });
                return { serializedOrders, localStorageConfirmed, indexedBackup };
            };
            let backup = writeOrderBackup();
            cloudSetBadge('syncing', 'Orden respaldada localmente; sincronización en segundo plano.');
            const cloudSync = cloudSaveOrder(order).then(result => {
                if (!result) cloudSetBadge('syncing', 'Orden local en cola; se reintentará automáticamente.');
                return result;
            }).catch(err => {
                console.warn('[Supabase] La orden permanece guardada localmente y pendiente de reintento:', err);
                cloudSetBadge('syncing', 'Orden local en cola; se reintentará automáticamente.');
                return null;
            });
            const recovery = (async () => {
                const firstIdb = await Promise.race([backup.indexedBackup, cloudSleep(450).then(() => false)]);
                if (backup.localStorageConfirmed || firstIdb) return;

                // Si la cuota está ajustada, elimina solo cachés que tienen una copia íntegra en IDB,
                // reduce fotos de esta orden y vuelve a intentar el respaldo sin bloquear la interfaz.
                try { await hvacCleanupOldLocalBackups(backupKey); } catch (e) {
                    console.warn('[Offline] Limpieza de cachés opcionales omitida:', e);
                }
                let photosReduced = false;
                try { photosReduced = await hvacCompressOrderPhotos(order); } catch (e) {
                    console.warn('[Offline] Compresión secundaria omitida:', e);
                }
                if (photosReduced) {
                    order.updatedAt = new Date().toISOString();
                    cloudSaveOrder(order).catch(e => console.warn('[Offline] Reintento cloud de la orden:', e));
                }
                try {
                    backup = writeOrderBackup();
                } catch (e) {
                    console.warn('[Offline] No se pudo reserializar la orden durante la recuperación:', e);
                }
                const retryIdb = await Promise.race([backup.indexedBackup, cloudSleep(450).then(() => false)]);
                let nativeSaved = false;
                try { nativeSaved = hvacNativeGetItem.call(window.localStorage, backupKey) === backup.serializedOrders; } catch (_) {}
                if (!nativeSaved && !retryIdb) {
                    cloudSetBadge('syncing', 'Respaldo local en recuperación; conserva la aplicación abierta mientras se reintenta.');
                    showToast('El teléfono está liberando espacio y reintentando el respaldo local en segundo plano.', 'error');
                }
            })().catch(e => {
                console.warn('[Offline] La recuperación local sigue pendiente:', e);
                cloudSetBadge('syncing', 'Respaldo local pendiente; reintento en segundo plano.');
            });
            cloudSync.catch(() => {});
            recovery.catch(() => {});
            return { saved: true, cloudSync, recovery };
        }

        // Reaplica cambios pendientes (hechos sin conexión) ANTES de que la copia de la nube los pise.
        function cloudReconcileOutbox() {
            const box = cloudOutboxRead();
            if (!box.length) return;
            const cfg = {
                hvac_equipments: { get: () => equipmentCatalog, set: v => { equipmentCatalog = v; }, bk: 'HVAC_EQUIPMENTS_BACKUP', key: e => e.id || e.code, save: cloudSaveEquipment, del: cloudDeleteEquipment },
                hvac_orders: { get: () => workOrders, set: v => { workOrders = v; }, bk: 'HVAC_ORDERS_BACKUP', key: o => o.id, save: cloudSaveOrder, del: cloudDeleteOrder },
                hvac_clients: { get: () => clientsCatalog, set: v => { clientsCatalog = v; }, bk: 'HVAC_CLIENTS_BACKUP', key: c => c.id, save: cloudSaveClient, del: cloudDeleteClient },
                hvac_users: { get: () => systemUsers, set: v => { systemUsers = v; }, bk: 'HVAC_TECH_USERS_BACKUP', key: u => u.id, save: cloudSaveUser, del: cloudDeleteUser }
            };
            box.forEach(entry => {
                if (cloudCtl.queues[entry.table + ':' + entry.id]) return; // ya se está enviando
                if (entry.table === 'hvac_app_state') { cloudScheduleStatePush(entry.id, true); return; }
                const c = cfg[entry.table];
                if (!c) { cloudOutboxClear(entry.table, entry.id); return; }
                const same = rec => rec && cloudCleanId(c.key(rec)) === entry.id;
                if (entry.op === 'delete') {
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

        function cloudFlushOutbox() {
            if (cloudCtl.flushing) return cloudCtl.flushing;
            const run = async () => {
                const entries = cloudOutboxRead().slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
                let sent = 0;
                for (const entry of entries) {
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
                        else { console.warn('[Sync] Operación no confirmada; se conserva para reintento:', entry.table, entry.id, cloudCtl.lastStatus); }
                    } catch (e) {
                        console.warn('[Offline] Se conserva operación pendiente para reintentar:', entry.table, entry.id, e);
                    }
                }
                return { sent, pending: cloudOutboxRead().length };
            };
            cloudCtl.flushing = run().finally(() => { cloudCtl.flushing = null; });
            return cloudCtl.flushing;
        }

        // ---- Módulos que solo vivían en el navegador: se respaldan en la tabla hvac_app_state ----
        async function cloudStateProbe() {
            if (cloudStateCtl.disabled) return false;
            const r = await supabaseFetch('hvac_app_state?select=id&limit=1', 'GET', null, null, { quiet: true });
            if (r) return true;
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
            if (key === 'HVAC_FORMS_CONFIG_BACKUP') return null; // el técnico nunca reescribe los formularios del admin
            const data = localStorage.getItem(key);
            if (data === null) { cloudOutboxClear('hvac_app_state', key); return null; }
            const ts = parseInt(localStorage.getItem('HVAC_TS_' + key), 10) || Date.now();
            const r = await cloudUpsert('hvac_app_state', key, { key, updatedAt: ts, data });
            if (!r && cloudCtl.lastStatus === 404) { cloudStateCtl.disabled = true; cloudOutboxClear('hvac_app_state', cloudCleanId(key)); }
            return r;
        }

        function cloudMergeState(key, localVal, cloudVal) {
            try {
                const l = JSON.parse(localVal), c = JSON.parse(cloudVal);
                if (Array.isArray(l) && Array.isArray(c)) {
                    const out = c.slice();
                    l.forEach(it => { if (!it || it.id === undefined || !out.some(o => o && o.id === it.id)) out.push(it); });
                    return JSON.stringify(out);
                }
                if (l && c && typeof l === 'object' && typeof c === 'object') return JSON.stringify(Object.assign({}, l, c));
            } catch (e) {}
            return cloudVal;
        }

        async function cloudHydrateState() {
            try { await estadoPullKeys(['HVAC_AGENDA_BACKUP'], true); } catch (e) { console.warn('[Estado] Agenda:', e); }
            if (cloudStateCtl.disabled) return;
            if (!(await cloudStateProbe())) return;
            const rows = await supabaseFetch('hvac_app_state?select=id,payload&id=in.(' + CLOUD_STATE_KEYS.map(k => encodeURIComponent(cloudCleanId(k))).join(',') + ')', 'GET', null, null, { quiet: true });
            if (!Array.isArray(rows)) return;
            const byId = {};
            rows.forEach(r => { if (r && r.payload) byId[r.id] = r.payload; });
            cloudStateCtl.muted = true;
            try {
                CLOUD_STATE_KEYS.forEach(key => {
                    if (ESTADO_TABLAS[key] && !estadoCtl.disabled) return;
                    const cloud = byId[cloudCleanId(key)];
                    const localVal = localStorage.getItem(key);
                    const localTs = parseInt(localStorage.getItem('HVAC_TS_' + key), 10) || 0;
                    if (cloud && typeof cloud.data === 'string') {
                        if (localVal === null || (localTs > 0 && cloud.updatedAt > localTs)) {
                            localStorage.setItem(key, cloud.data);
                            localStorage.setItem('HVAC_TS_' + key, String(cloud.updatedAt || Date.now()));
                        } else if (localTs === 0) {
                            const merged = cloudMergeState(key, localVal, cloud.data);
                            localStorage.setItem(key, merged);
                            localStorage.setItem('HVAC_TS_' + key, String(Date.now()));
                            cloudScheduleStatePush(key, true);
                        } else if (localTs > (cloud.updatedAt || 0)) {
                            cloudScheduleStatePush(key, true);
                        }
                    } else if (localVal !== null) {
                        if (!localTs) localStorage.setItem('HVAC_TS_' + key, String(Date.now()));
                        cloudScheduleStatePush(key, true);
                    }
                });
            } finally { cloudStateCtl.muted = false; }
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

        function orderTimestamp(order) {
            if (!order || typeof order !== 'object') return 0;
            const toMillis = value => {
                if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
                if (typeof value !== 'string' || !value.trim()) return 0;
                const text = value.trim();
                if (/^\d{10,13}$/.test(text)) {
                    const numeric = Number(text);
                    return numeric < 1e12 ? numeric * 1000 : numeric;
                }
                const parsed = Date.parse(text);
                return Number.isFinite(parsed) ? parsed : 0;
            };
            const times = [
                order.updatedAt, order.modifiedAt, order.lastModifiedAt,
                order.timestamp, order.clientSignature && order.clientSignature.timestamp,
                order.signatureDecisionAt, order.technicianFinishedAt
            ].map(toMillis);
            Object.values(order.executions || {}).forEach(exec => {
                if (exec) times.push(toMillis(exec.timestamp), toMillis(exec.updatedAt));
            });
            return Math.max(0, ...times);
        }

        function mergeOrdersByTimestamp(cloudOrders, localOrders) {
            const localById = new Map((Array.isArray(localOrders) ? localOrders : [])
                .filter(order => order && order.id != null)
                .map(order => [String(order.id), order]));
            return cloudOrders.map(cloudOrder => {
                if (!cloudOrder || cloudOrder.id == null) return cloudOrder;
                const localOrder = localById.get(String(cloudOrder.id));
                if (!localOrder) return cloudOrder;
                // No permitir que una respuesta remota atrasada borre progreso local más reciente.
                if (orderTimestamp(localOrder) >= orderTimestamp(cloudOrder) && orderTimestamp(localOrder) > 0) {
                    const adopted = Object.assign({}, localOrder);
                    adoptAdminFields(adopted, cloudOrder);                       // el progreso local se conserva, la asignación manda la nube
                    const cloudIds = [...new Set((cloudOrder.equipmentIds || []).map(String))].sort();
                    const localIds = [...new Set((localOrder.equipmentIds || []).map(String))].sort();
                    if (cloudIds.length !== localIds.length || cloudIds.some((id, i) => id !== localIds[i])) {
                        adopted.clientSignature = cloudOrder.clientSignature || null;
                        adopted.signatureDecision = cloudOrder.signatureDecision || 'PENDING';
                        adopted.signatureDecisionAt = cloudOrder.signatureDecisionAt || null;
                        adopted.signatureDecisionBy = cloudOrder.signatureDecisionBy || null;
                        adopted.technicianFinished = false;
                        adopted.technicianFinishedAt = null;
                        adopted.status = 'PENDING';
                    }
                    return adopted;
                }
                return hvacMergeLiteWithLocal(cloudOrder, localOrder);   // listado liviano: conserva lo completo que ya hay aquí
            });
        }

        // =========================================================================
        // CARGA OPTIMIZADA (lazy loading)
        //  - Al iniciar solo se descargan: los usuarios (livianos, sin administradores) y
        //    las rutinas PREVENTIVAS pendientes de ESTE técnico.
        //  - Los equipos NO se descargan en bloque: se piden a Supabase únicamente
        //    cuando el técnico abre una rutina (solo los equipos de esa rutina).
        //  - Los clientes ya no se descargan (el técnico no los usa).
        // =========================================================================
        const pgQuote = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        const pgList = arr => arr.map(pgQuote).join(',');

        // Una rutina puede tener varios técnicos asignados (technicians) o uno solo (technician)
        function orderTechs(o) { return (o && Array.isArray(o.technicians) && o.technicians.length) ? o.technicians : (o && o.technician ? [o.technician] : []); }
        function techMatches(o, u) {
            if (!u) return true;
            const mine = [u.name, u.username].filter(Boolean).map(s => String(s).trim().toLowerCase());
            return orderTechs(o).some(x => mine.includes(String(x).trim().toLowerCase()));
        }
        function techCurrentUserRecord() {
            return activeUser ? systemUsers.find(x => String(x.id) === String(activeUser)) : null;
        }

        // =========================================================================
        // EGRESS: caché en memoria + listados livianos + carga bajo demanda
        //  - El listado NUNCA trae fotos ni firmas: solo lo necesario para pintar las tarjetas.
        //    Usa la vista `hvac_orders_lite` (ver supabase_hvac_orders_lite.sql). Si la vista aún
        //    no existe, usa un respaldo que lee solo campos escalares de hvac_orders.
        //  - El payload completo (fotos) se descarga solo al abrir un equipo con fotos previas.
        //  - Toda lectura repetida dentro de su TTL se responde desde memoria (sin red).
        // =========================================================================
        const EGRESS = {
            LIST_TTL_MS: 3 * 60 * 1000,      // listado de rutinas del técnico
            USERS_TTL_MS: 10 * 60 * 1000,    // usuarios
            STATE_TTL_MS: 3 * 60 * 1000,     // agenda / formularios compartidos
            FULL_TTL_MS: 10 * 60 * 1000,     // payload completo de una orden
            HIST_TTL_MS: 10 * 60 * 1000,     // historial de un equipo
            EQ_TTL_MS: 10 * 60 * 1000,       // equipos de una rutina
            CLIENTS_TTL_MS: 5 * 60 * 1000,   // estado de clientes GPS: refresco máximo cada 5 minutos
            MAX_FULL: 3,                     // máx. de órdenes completas guardadas en memoria
            LITE_VIEW: 'hvac_orders_lite',
            liteViewMissing: false,
            tsMissing: false,
            mem: new Map(),
            inflight: new Map(),
            stats: { hits: 0, net: 0 }
        };
        function egressGet(key, ttl) {
            const e = EGRESS.mem.get(key);
            if (e && (Date.now() - e.t) < ttl) { EGRESS.stats.hits++; return e.v; }
            return undefined;
        }
        function egressSet(key, v) {
            EGRESS.mem.set(key, { t: Date.now(), v });
            const fulls = [...EGRESS.mem.entries()].filter(([k]) => k.startsWith('full:')).sort((a, b) => a[1].t - b[1].t);
            while (fulls.length > EGRESS.MAX_FULL) EGRESS.mem.delete(fulls.shift()[0]);
            if (EGRESS.mem.size > 60) {
                const oldest = [...EGRESS.mem.entries()].sort((a, b) => a[1].t - b[1].t)[0];
                if (oldest) EGRESS.mem.delete(oldest[0]);
            }
            return v;
        }
        function egressInvalidate(prefix) { [...EGRESS.mem.keys()].forEach(k => { if (k.startsWith(prefix)) EGRESS.mem.delete(k); }); }
        function egressOnce(key, fn) {     // evita peticiones idénticas simultáneas
            if (EGRESS.inflight.has(key)) return EGRESS.inflight.get(key);
            const p = Promise.resolve().then(fn).finally(() => EGRESS.inflight.delete(key));
            EGRESS.inflight.set(key, p);
            return p;
        }
        window.egressStats = () => ({ ...EGRESS.stats, entradas: EGRESS.mem.size, vistaLite: !EGRESS.liteViewMissing });

        // ---- Órdenes "livianas": marcas _lite indican que faltan partes pesadas (fotos / imagen de firma) ----
        function hvacHasLite(o) {
            if (!o) return false;
            if (o._lite) return true;
            if (o.clientSignature && o.clientSignature._lite) return true;
            return Object.values(o.executions || {}).some(e => e && e._lite);
        }
        function hvacStripLiteFlags(o) {
            if (!o) return o;
            delete o._lite;
            if (o.clientSignature && o.clientSignature._lite) delete o.clientSignature._lite;
            Object.values(o.executions || {}).forEach(e => { if (e && e._lite) delete e._lite; });
            return o;
        }
        // Reemplaza los sub-objetos recortados por los completos de la nube.
        function hvacRestoreHeavy(local, remote) {
            if (!local || !remote) return local;
            const rex = remote.executions || {};
            Object.keys(local.executions || {}).forEach(k => {
                const v = local.executions[k];
                if (v && v._lite) { if (rex[k]) local.executions[k] = rex[k]; else delete v._lite; }
            });
            const cs = local.clientSignature;
            if (cs && cs._lite) { if (remote.clientSignature) local.clientSignature = remote.clientSignature; else delete cs._lite; }
            return local;
        }
        // Cuando el listado de la nube es más nuevo, conserva lo completo que ya hay en el dispositivo.
        function hvacMergeLiteWithLocal(cloud, local) {
            if (!cloud || !hvacHasLite(cloud) || !local || typeof local !== 'object') return cloud;
            const out = Object.assign({}, cloud);
            out.executions = Object.assign({}, cloud.executions || {});
            Object.entries(local.executions || {}).forEach(([k, v]) => {
                if (!v || v._lite) return;
                const c = out.executions[k];
                if (!c || (c._lite && execTs(v) >= execTs(c))) out.executions[k] = v;
            });
            const lcs = local.clientSignature, ccs = out.clientSignature;
            if (ccs && ccs._lite && lcs && !lcs._lite && String(lcs.timestamp || '') === String(ccs.timestamp || '')) out.clientSignature = lcs;
            return out;
        }

        // ---- Listado del técnico ----
        const EGRESS_SCALAR_SELECT = [
            'id', 'status:payload->>status', 'date:payload->>date', 'client:payload->>client',
            'technician:payload->>technician', 'technicians:payload->technicians', 'equipmentIds:payload->equipmentIds',
            'maintenanceType:payload->>maintenanceType', 'type:payload->>type', 'tipoRutina:payload->>tipoRutina',
            'zoneName:payload->>zoneName', 'zoneId:payload->>zoneId', 'periodicity:payload->>periodicity',
            'technicianFinished:payload->>technicianFinished', 'technicianFinishedAt:payload->>technicianFinishedAt',
            'signatureDecision:payload->>signatureDecision', 'signatureDecisionAt:payload->>signatureDecisionAt',
            'signatureDecisionBy:payload->>signatureDecisionBy', 'signatureDecisionReason:payload->>signatureDecisionReason',
            'updatedAt:payload->>updatedAt', 'sigName:payload->clientSignature->>name', 'sigTs:payload->clientSignature->>timestamp'
        ].join(',');
        function egressScalarToOrder(r) {
            if (!r || r.id == null) return null;
            const o = { id: r.id, executions: {}, _lite: 'scalar' };
            ['status', 'date', 'client', 'technician', 'maintenanceType', 'type', 'tipoRutina', 'zoneName', 'zoneId', 'periodicity', 'technicianFinishedAt', 'signatureDecision', 'signatureDecisionAt', 'signatureDecisionBy', 'signatureDecisionReason', 'updatedAt']
                .forEach(k => { if (r[k] != null) o[k] = r[k]; });
            if (Array.isArray(r.technicians)) o.technicians = r.technicians;
            o.equipmentIds = Array.isArray(r.equipmentIds) ? r.equipmentIds : [];
            o.technicianFinished = String(r.technicianFinished) === 'true';
            if (r.sigTs || r.sigName) o.clientSignature = { name: r.sigName || '', timestamp: r.sigTs || '', _lite: true };
            return o;
        }
        async function egressFetchOrdersFromNet(u) {
            const names = [...new Set([u.name, u.username].filter(Boolean))];
            if (!names.length) return [];
            EGRESS.stats.net++;
            const q = { quiet: true, noStore: true };
            // La vista hvac_orders_lite debe retirar fotos/firmas base64. Seleccionamos
            // columnas concretas (metadatos + executions recortadas), nunca payload completo.
            if (!EGRESS.liteViewMissing) {
                const techOrV = names.map(n => 'technician.eq.' + pgQuote(n)).concat(names.map(n => 'technician.ilike.' + pgQuote('*' + n + '*'))).concat(names.map(n => 'technicians.cs.' + JSON.stringify([n]))).join(',');
                const liteSelect = [
                    'id', 'orderId:payload->>id', 'client:payload->>client', 'date:payload->>date',
                    'status:payload->>status', 'technician:payload->>technician', 'technicians:payload->technicians',
                    'equipmentIds:payload->equipmentIds', 'maintenanceType:payload->>maintenanceType',
                    'type:payload->>type', 'tipoRutina:payload->>tipoRutina', 'zoneName:payload->>zoneName',
                    'zoneId:payload->>zoneId', 'periodicity:payload->>periodicity',
                    'technicianFinished:payload->>technicianFinished', 'technicianFinishedAt:payload->>technicianFinishedAt',
                    'signatureDecision:payload->>signatureDecision', 'signatureDecisionAt:payload->>signatureDecisionAt',
                    'signatureDecisionBy:payload->>signatureDecisionBy', 'signatureDecisionReason:payload->>signatureDecisionReason',
                    'sigName:payload->clientSignature->>name', 'sigTs:payload->clientSignature->>timestamp',
                    'updatedAt:payload->>updatedAt', 'executions:payload->executions'
                ].join(',');
                const baseV = EGRESS.LITE_VIEW + '?select=' + liteSelect + '&id=not.like.HIST-*&status=in.(PENDING,COMPLETED)&or=' + encodeURIComponent('(' + techOrV + ')');
                const rows = await supabaseFetch(baseV + '&tech_open=is.true&order=date.desc&limit=200', 'GET', null, null, q);
                if (!Array.isArray(rows) && Number(cloudCtl.lastStatus) === 404) EGRESS.liteViewMissing = true;
                if (Array.isArray(rows)) return rows.map(r => {
                    if (!r) return null;
                    const id = r.orderId || r.id;
                    if (id == null) return null;
                    const o = { id: String(id), _lite: 'view' };
                    ['client', 'date', 'status', 'technician', 'maintenanceType', 'type', 'tipoRutina', 'zoneName', 'zoneId', 'periodicity', 'technicianFinishedAt', 'signatureDecision', 'signatureDecisionAt', 'signatureDecisionBy', 'signatureDecisionReason', 'updatedAt']
                        .forEach(k => { if (r[k] != null) o[k] = r[k]; });
                    if (Array.isArray(r.technicians)) o.technicians = r.technicians;
                    o.equipmentIds = Array.isArray(r.equipmentIds) ? r.equipmentIds : [];
                    o.technicianFinished = String(r.technicianFinished) === 'true';
                    if (r.sigTs || r.sigName) o.clientSignature = { name: r.sigName || '', timestamp: r.sigTs || '', _lite: true };
                    o.executions = r.executions && typeof r.executions === 'object' ? r.executions : {};
                    Object.values(o.executions).forEach(ex => { if (ex && typeof ex === 'object') ex._lite = ex._lite || true; });
                    return o;
                }).filter(Boolean);
                if (!EGRESS.liteViewMissing) return null;
            }
            // Respaldo seguro: solo campos escalares (incluye updatedAt), sin executions ni fotos.
            const techOr = names.map(n => 'payload->>technician.eq.' + pgQuote(n)).concat(names.map(n => 'payload->>technician.ilike.' + pgQuote('*' + n + '*'))).concat(names.map(n => 'payload->technicians.cs.' + JSON.stringify([n]))).join(',');
            const base = 'hvac_orders?select=' + EGRESS_SCALAR_SELECT + '&id=not.like.HIST-*&payload->>status=in.(PENDING,COMPLETED)&or=' + encodeURIComponent('(' + techOr + ')');
            let rows = await supabaseFetch(base + '&order=payload->>date.desc&limit=200', 'GET', null, null, q);
            if (!Array.isArray(rows)) rows = await supabaseFetch(base + '&limit=200', 'GET', null, null, q);
            return Array.isArray(rows) ? rows.map(egressScalarToOrder).filter(Boolean) : null;
        }
        // opts.force / opts.revalidate: omite memoria y respaldo reciente; valida siempre con Supabase.
        async function fetchMyActiveOrders(opts) {
            opts = opts || {};
            const u = techCurrentUserRecord();
            if (!u) return null;
            const uid = String(u.id);
            const ckey = 'orders:' + uid;
            const ttl = Number(opts.maxAge) > 0 ? Number(opts.maxAge) : EGRESS.LIST_TTL_MS;
            const force = !!(opts.force || opts.revalidate);
            const finish = list => (Array.isArray(list) ? list.filter(o => o && techMatches(o, u)) : null);
            if (!force) {
                const hit = egressGet(ckey, ttl);
                if (hit) return finish(JSON.parse(hit));
                let last = 0; try { last = Number(localStorage.getItem('HVAC_LIST_AT_' + uid)) || 0; } catch (_) {}
                let dirty = false; try { dirty = localStorage.getItem('HVAC_LIST_DIRTY') === '1'; } catch (_) {}
                if (!dirty && last && (Date.now() - last) < ttl && Array.isArray(workOrders) && workOrders.length) { EGRESS.stats.hits++; return finish(workOrders.slice()); }
            }
            return egressOnce(ckey + ':net', async () => {
                const list = await egressFetchOrdersFromNet(u);
                if (!Array.isArray(list)) return null;
                egressSet(ckey, JSON.stringify(list));
                try { localStorage.setItem('HVAC_LIST_AT_' + uid, String(Date.now())); localStorage.removeItem('HVAC_LIST_DIRTY'); } catch (_) {}
                return finish(list);
            });
        }

        // Conteos de avance en lote: mismo RPC y contrato que usa index.html.
        // Solo devuelve números por orden; nunca descarga fotos ni payload.
        let techProgressRpcDisabled = false;
        async function techRefreshServerProgress(list, serverList) {
            if (!navigator.onLine || !Array.isArray(list) || !list.length || techProgressRpcDisabled) return false;
            const source = Array.isArray(serverList) ? serverList : list;
            const ids = [...new Set(list.filter(o => {
                if (!o || o.id == null) return false;
                // Con la vista ligera se calcula localmente; la RPC solo rescata el respaldo scalar.
                return o._lite === 'scalar' && (!o.executions || Object.keys(o.executions).length === 0);
            }).map(o => String(o.id)))];
            if (!ids.length) return false;
            let rows = await supabaseFetch('rpc/hvac_orders_progress', 'POST', { p_ids: ids }, null, { quiet: true, noStore: true });
            if (!Array.isArray(rows)) {
                if (Number(cloudCtl.lastStatus) === 404) techProgressRpcDisabled = true;
                return false;
            }
            let changed = false;
            rows.forEach(r => {
                if (!r || r.id == null || r.total == null || r.done == null) return;
                const order = list.find(o => o && String(o.id) === String(r.id));
                const serverOrder = source.find(o => o && String(o.id) === String(r.id));
                if (!order || !serverOrder) return;
                // Si existe una edición local posterior a la lectura remota, no aplicar un conteo viejo.
                if (orderTimestamp(order) > orderTimestamp(serverOrder) && orderTimestamp(order) > 0) return;
                const total = [...new Set((serverOrder.equipmentIds || []).map(String).filter(Boolean))].length;
                if (Number(r.total) !== total) return; // no mezclar denominadores diferentes
                const done = Math.min(total, Math.max(0, Number(r.done) || 0));
                const serverVersion = String(serverOrder.updatedAt || '');
                const previous = order._serverProgress;
                if (!previous || Number(previous.done) !== done || Number(previous.total) !== total || String(previous.orderUpdatedAt || '') !== serverVersion) changed = true;
                order._serverProgress = { done, total, started: Math.max(0, Number(r.started) || 0), at: Date.now(), orderUpdatedAt: serverVersion };
            });
            return changed;
        }

        // Revalida las órdenes activas en cada regreso al primer plano; fusiona sin pisar
        // ejecuciones locales más nuevas y conserva registros que aún están en la outbox.
        let techOrdersRefreshInFlight = null;
        async function refreshMyOrdersFromServer() {
            if (navigator.onLine === false || document.visibilityState !== 'visible' || !techCurrentUserRecord()) return false;
            if (techOrdersRefreshInFlight) return techOrdersRefreshInFlight;
            techOrdersRefreshInFlight = (async () => {
                const remote = await fetchMyActiveOrders({ force: true, revalidate: true });
                if (!Array.isArray(remote)) return false;
                const local = readLocalBackup('HVAC_ORDERS_BACKUP', workOrders);
                const merged = mergeOrdersByTimestamp(remote, local);
                const remoteIds = new Set(merged.map(o => String(o && o.id)));
                let pendingIds = new Set();
                try { pendingIds = new Set(cloudOutboxRead().filter(e => e && e.table === 'hvac_orders' && e.op !== 'delete').map(e => cloudCleanId(e.id))); } catch (_) {}
                const localPending = (Array.isArray(local) ? local : []).filter(o => o && o.id != null && !remoteIds.has(String(o.id)) && pendingIds.has(cloudCleanId(o.id)));
                workOrders = merged.concat(localPending);
                cloudReconcileOutbox();
                await techRefreshServerProgress(workOrders, remote);
                try { localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders)); } catch (_) {}
                renderTechAgenda();
                const hub = document.getElementById('order-hub-modal-backdrop');
                if (hub && !hub.classList.contains('hidden')) {
                    const current = workOrders.find(o => String(o.id) === String(currentExecOrderId));
                    if (current) renderOrderHubEquipments(current);
                }
                return true;
            })().finally(() => { techOrdersRefreshInFlight = null; });
            return techOrdersRefreshInFlight;
        }

        // ---- Payload completo de UNA orden (bajo demanda) ----
        async function egressFetchFullPayload(orderId, force) {
            const id = cloudCleanId(orderId);
            const key = 'full:' + id;
            if (!force) { const hit = egressGet(key, EGRESS.FULL_TTL_MS); if (hit) return JSON.parse(hit); }
            return egressOnce(key + ':net', async () => {
                EGRESS.stats.net++;
                const rows = await supabaseFetch('hvac_orders?id=eq.' + encodeURIComponent(id) + '&select=payload', 'GET', null, null, { quiet: true });
                const payload = Array.isArray(rows) && rows[0] && rows[0].payload;
                if (!payload) return null;
                egressSet(key, JSON.stringify(payload));
                return JSON.parse(JSON.stringify(payload));
            });
        }
        // Completa en el mismo objeto (los modales conservan su referencia) lo que el listado no traía.
        async function hvacEnsureFullOrder(orderId, force) {
            const find = () => workOrders.find(o => o && String(o.id) === String(orderId));
            let cur = find();
            if (!cur) return false;
            if (!hvacHasLite(cur)) return true;
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
            const remote = await egressFetchFullPayload(orderId, force);
            if (!remote) return false;
            cur = find(); if (!cur) return false;
            hvacRestoreHeavy(cur, remote);
            Object.keys(remote).forEach(k => { if (cur[k] === undefined) cur[k] = remote[k]; });
            cur.executions = cur.executions || {};
            Object.entries(remote.executions || {}).forEach(([k, v]) => {
                const l = cur.executions[k];
                if (!l || l._lite || execTs(v) > execTs(l)) cur.executions[k] = v;
            });
            hvacStripLiteFlags(cur);
            try { localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders)); } catch (_) {}
            return true;
        }
        // ¿Abrir este equipo exige las fotos que el listado no trajo?
        function hvacExecNeedsHeavy(order, eqId) {
            if (!order || !hvacHasLite(order)) return false;
            const eq = techFindEq(eqId) || {};
            const ex = order.executions && (order.executions[eqId] || (eq.code && order.executions[eq.code]));
            if (ex && ex._lite) return Number(ex.photosCount) > 0;
            return order._lite === 'scalar';
        }

        // Pide a Supabase SOLO los equipos de la rutina indicada y los fusiona en memoria.
        async function ensureOrderEquipments(order) {
            if (!order) return false;
            const ids = [...new Set((order.equipmentIds || []).map(String).filter(Boolean))];
            if (!ids.length) return true;
            // Si los equipos de esta rutina ya se leyeron hace poco y siguen en memoria, no se vuelve a pedir nada.
            if (ids.every(id => techFindEq(id)) && egressGet('eqs:' + order.id, EGRESS.EQ_TTL_MS)) return true;
            const keys = [...new Set(ids.concat(ids.map(cloudCleanId)))];
            let ok = true;
            for (let i = 0; i < keys.length; i += 40) {
                const list = pgList(keys.slice(i, i + 40));
                const filter = '(id.in.(' + list + '),payload->>code.in.(' + list + '))';
                const rows = await supabaseFetch('hvac_equipments?select=payload&or=' + encodeURIComponent(filter), 'GET', null, null, { quiet: true });
                if (!Array.isArray(rows)) { ok = false; continue; }
                rows.map(r => r && r.payload).filter(Boolean).forEach(eq => {
                    const idx = equipmentCatalog.findIndex(e => String(e.id) === String(eq.id) || (!eq.id && e.code === eq.code));
                    if (idx >= 0) equipmentCatalog[idx] = eq; else equipmentCatalog.push(eq);
                });
            }
            try { localStorage.setItem('HVAC_EQUIPMENTS_BACKUP', JSON.stringify(equipmentCatalog)); } catch (_) {}
            if (ok) egressSet('eqs:' + order.id, '1');
            return ok;
        }

        window.loadAllCloudData = async function(forceSync = false) {
            try {
                restoreLocalAppData();
                refreshAppFromCurrentData();

                // Usuarios: tabla liviana y SIN administradores (sus credenciales nunca llegan al teléfono)
                let usrData = null;
                if (!forceSync && Array.isArray(systemUsers) && systemUsers.length) { const hit = egressGet('users', EGRESS.USERS_TTL_MS); if (hit) usrData = JSON.parse(hit); }
                if (!usrData) {
                    usrData = await supabaseFetch('hvac_users?select=payload&payload->>role=neq.ADMIN', 'GET', null, null, { quiet: true })
                        || await supabaseFetch('hvac_users?select=payload', 'GET');
                    if (Array.isArray(usrData) && usrData.length) egressSet('users', JSON.stringify(usrData));
                }
                if (Array.isArray(usrData) && usrData.length > 0) systemUsers = usrData.map(r => r.payload).filter(Boolean);
                techStripAdminUsers();

                // Rutinas del técnico (solo las suyas y activas)
                const myOrders = await fetchMyActiveOrders({ force: navigator.onLine !== false || !!forceSync });
                const cloudReadComplete = Array.isArray(usrData) && (myOrders !== null);
                if (Array.isArray(myOrders)) {
                    const localOrders = readLocalBackup('HVAC_ORDERS_BACKUP', workOrders);
                    workOrders = mergeOrdersByTimestamp(myOrders, localOrders);
                }
                cloudReconcileOutbox(); // conserva cambios hechos sin conexión
                if (navigator.onLine !== false) await techRefreshServerProgress(workOrders, myOrders);

                try {
                    const localAgenda = JSON.parse(localStorage.getItem('HVAC_AGENDA_BACKUP') || '[]');
                    const localForms = JSON.parse(localStorage.getItem('HVAC_FORMS_CONFIG_BACKUP') || 'null');
                    if (localForms) equipmentFormsConfig = localForms;
                    agendaItems = localAgenda;
                } catch (e) {}

                try { localStorage.setItem('HVAC_ORDERS_BACKUP', JSON.stringify(workOrders)); } catch (_) {}
                localStorage.setItem('HVAC_TECH_USERS_BACKUP', JSON.stringify(systemUsers));

                if (forceSync) {
                    const pendingCount = cloudOutboxRead().length;
                    if (cloudReadComplete && pendingCount === 0) {
                        showToast(`Sincronizado con Supabase: ${workOrders.length} rutina(s) asignada(s).`);
                    } else {
                        const reason = !cloudReadComplete ? 'No se pudo confirmar la lectura completa desde la nube.' : 'La nube no confirmó todos los cambios.';
                        showToast(`${reason} ${pendingCount ? pendingCount + ' cambio(s) quedan en cola.' : 'Los cambios locales se conservaron.'}`, 'error');
                    }
                }

                refreshAppFromCurrentData();
            } catch (err) {
                console.warn('[Supabase] Falló la carga; se continuará con los datos locales:', err);
                restoreLocalAppData();
                refreshAppFromCurrentData();
                cloudSetBadge('syncing', 'Se están usando los datos guardados en este dispositivo; la nube se reintentará.');
                try { showToast('No se pudo completar la carga remota. La aplicación continúa con los datos locales y volverá a intentar.', 'error'); } catch (_) {}
            }
        };

        // Evita cargas simultáneas, respalda módulos locales en la nube y reintenta al reconectar.
        (function wrapCloudLoad() {
            const original = window.loadAllCloudData;
            const run = async (force) => {
                await hvacStorageReady;
                await hvacFlushStorageWrites();
                restoreLocalAppData();
                refreshAppFromCurrentData();
                const queueStatus = await cloudFlushOutbox();
                if (force && queueStatus.pending) {
                    cloudSetBadge('syncing', queueStatus.pending + ' cambio(s) local(es) pendientes; se reintentará automáticamente.');
                }
                if (force || egressGet('state', EGRESS.STATE_TTL_MS) === undefined) {
                    try { await cloudHydrateState(); egressSet('state', '1'); } catch (e) { console.warn('hydrateState', e); }
                }
                cloudStateCtl.muted = true;
                try { return await original(force); } finally { cloudStateCtl.muted = false; }
            };
            window.loadAllCloudData = function (forceSync = false) {
                if (cloudCtl.loading) {
                    if (forceSync && !cloudCtl.loading.force) {
                        const chained = cloudCtl.loading.promise.then(() => window.loadAllCloudData(true));
                        return chained;
                    }
                    return cloudCtl.loading.promise;
                }
                const entry = { force: !!forceSync };
                entry.promise = run(forceSync).finally(() => { if (cloudCtl.loading === entry) cloudCtl.loading = null; });
                cloudCtl.loading = entry;
                return entry.promise;
            };
            window.addEventListener('online', () => {
                cloudFlushOutbox();
                window.loadAllCloudData(false);
            });
            window.addEventListener('DOMContentLoaded', () => {
                const problem = cloudKeyProblem();
                if (problem) {
                    console.error('[Supabase] ' + problem);
                    cloudSetBadge('error', problem);
                    cloudCtl.lastToast = Date.now();
                    try { showToast(problem, 'error'); } catch (_) {}
                }
            });
        })();


        function clearStoredAuthSession() {
            activeUser = null;
            activeSessionRole = null;
            activeSessionExpiresAt = null;
            sessionAuthenticated = false;
            try { sessionStorage.removeItem(AUTH_SESSION_KEY); } catch (_) {}
            try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (_) {}
            try { localStorage.removeItem('HVAC_ACTIVE_USER_TECH'); } catch (_) {}
        }

        function restoreActiveSession() {
            if (sessionAuthenticated) {
                const currentUser = systemUsers.find(u => String(u.id) === String(activeUser));
                if (currentUser && currentUser.role !== 'ADMIN' && (!activeSessionRole || currentUser.role === activeSessionRole) &&
                    activeSessionExpiresAt > Date.now()) return true;
                clearStoredAuthSession();
                return false;
            }

            let rawSession = null;
            let legacyUserId = null;
            try { rawSession = localStorage.getItem(AUTH_SESSION_KEY); } catch (_) {}
            if (!rawSession) { try { rawSession = sessionStorage.getItem(AUTH_SESSION_KEY); } catch (_) {} }
            try { legacyUserId = localStorage.getItem('HVAC_ACTIVE_USER_TECH'); } catch (_) {}
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
                if (!user || user.role === 'ADMIN' || !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
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
            try { localStorage.setItem('HVAC_ACTIVE_USER_TECH', user.id); } catch (_) {}
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
            if (!systemUsers.length) {
                loadAllCloudData(true);
                return mostrarError('Primer ingreso: conéctate a internet para descargar los usuarios e inténtalo de nuevo.');
            }

            const matchedUser = systemUsers.find(u => u.username && u.username.toLowerCase() === usernameInput);
            const check = await authRevisarClave(matchedUser, passwordInput);
            if (check.changed) authGuardarUsuario(matchedUser, 'HVAC_TECH_USERS_BACKUP');
            if (!check.ok) { authFallo(); return mostrarError('Usuario o contraseña incorrectos.'); }
            authAcierto();

            if (matchedUser.role === 'ADMIN') {
                return mostrarError('Esta app es solo para técnicos. Los administradores deben usar el panel administrativo.');
            }

            errorBox.classList.add('hidden');
            beginActiveSession(matchedUser);
            document.getElementById('app-login-screen').classList.add('hidden');
            syncTechUser();
            renderTechAgenda();
            window.scrollTo(0, 0);
            loadAllCloudData(false);
        }

        function logoutSession() {
            clearStoredAuthSession();
            syncTechUser();
            document.getElementById('app-login-screen').classList.remove('hidden');
            document.getElementById('login-password').value = '';
            document.getElementById('login-error-msg').classList.add('hidden');
        }

        function toggleLoginPassword() {
            const input = document.getElementById('login-password');
            const icon = document.getElementById('pw-eye-icon');
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            icon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        }

        function toggleTechTheme() {
            const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('TECH_THEME', next); } catch (_) {}
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', next === 'dark' ? '#0a1122' : '#eef2fa');
        }

        function syncTechUser() {
            const user = activeUser && systemUsers.find(x => String(x.id) === String(activeUser));
            const name = user ? (user.name || user.username || '') : '';
            const parts = name.trim().split(/\s+/).filter(w => !/^(ing|dr|dra|lic|director)\.?$/i.test(w));
            const ini = ((parts[0] || '?')[0] + ((parts[1] || '')[0] || '')).toUpperCase();
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            set('topbar-avatar', name ? ini : '--');
            set('header-user-welcome', name);
            set('header-role-badge', user ? user.role : '');
            const h = new Date().getHours();
            set('topbar-greet', h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches');
            const d = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
            set('hero-date', d.charAt(0).toUpperCase() + d.slice(1));
        }

        // ---------- Agenda del técnico ----------
        let techFilter = 'all';
        function setTechFilter(f) { techFilter = f; renderTechAgenda(); }

        function techExecFor(order, eqId) {
            const eq = techFindEq(eqId);
            return order.executions && (order.executions[eqId] || (eq && order.executions[eq.code]));
        }

        // Estado efectivo calculado desde TODOS los equipos asignados, no desde el estado antiguo de la orden.
        // Una orden marcada COMPLETED vuelve a estar disponible si se añadieron equipos sin informe completo.
        function techOrderProgress(order) {
            const ids = [...new Set((order && order.equipmentIds || []).map(String).filter(Boolean))];
            const total = ids.length;
            const server = order && order._serverProgress;
            if (server && Number(server.total) === total && (!server.orderUpdatedAt || !order.updatedAt || String(server.orderUpdatedAt) === String(order.updatedAt))) {
                const done = Math.min(total, Math.max(0, Number(server.done) || 0));
                return { total, done, pending: Math.max(0, total - done), percent: total ? Math.round(done / total * 100) : 0, allDone: total > 0 && done === total, known: true, source: 'rpc' };
            }
            // El respaldo scalar no contiene ejecuciones. No interpretar esa ausencia como 0%.
            if (order && order._lite === 'scalar' && (!order.executions || Object.keys(order.executions).length === 0)) {
                return { total, done: null, pending: null, percent: null, allDone: false, known: false, source: 'metadata' };
            }
            let done = 0;
            ids.forEach(id => {
                const eq = techFindEq(id) || { id, code: id, type: 'EXTRACTOR' };
                const exec = techExecFor(order, id);
                if (getEquipmentExecutionStatus(eq, id, exec) === 'done') done++;
            });
            const allDone = total > 0 && done === total;
            return { total, done, pending: Math.max(0, total - done), percent: total ? Math.round(done / total * 100) : 0, allDone, known: true, source: 'local' };
        }
        // La orden solo queda cerrada cuando todos los equipos están completos Y existe
        // una decisión explícita sobre la firma. También reconoce órdenes antiguas:
        // una firma normal o el rótulo "Completado sin firma" representan una decisión guardada.
        function techSignatureDecision(order) {
            if (!order) return 'PENDING';
            const declared = String(order.signatureDecision || '').trim().toUpperCase();
            if (declared === 'SIGNED' || declared === 'DECLINED') return declared;
            const sig = order.clientSignature;
            if (!sig) return 'PENDING';
            const name = String(sig.name || '').trim();
            if (/completad[oa]\s+sin\s+firma|sin\s+firma/i.test(name)) return 'DECLINED';
            // En listados livianos la imagen se omite (_lite), pero nombre + timestamp
            // permiten reconocer que la firma sí existe sin descargar el archivo base64.
            if (sig.signatureImg || sig.image || (sig.timestamp && name)) return 'SIGNED';
            return 'PENDING';
        }
        function techOrderNeedsWork(order) {
            const p = techOrderProgress(order);
            return p.total === 0 || !p.allDone || techSignatureDecision(order) === 'PENDING';
        }
        function techEffectiveStatus(order) {
            if (String(order && order.status || '').toUpperCase() === 'BILLED') return 'BILLED';
            return techOrderNeedsWork(order) ? 'PENDING' : 'COMPLETED';
        }
        function keepOrderPendingForSignature(order) {
            if (!order || !techOrderProgress(order).allDone || techSignatureDecision(order) !== 'PENDING') return false;
            const changed = String(order.status || '').toUpperCase() !== 'PENDING' || !!order.technicianFinished || !!order.technicianFinishedAt;
            order.status = 'PENDING';
            order.technicianFinished = false;
            delete order.technicianFinishedAt;
            if (changed) persistOrderLocallyAndSync(order);
            return true;
        }

        // Zona / piso de una orden (con respaldo en la zona de sus equipos para órdenes antiguas)
        function techOrderZone(o) {
            const own = String((o && o.zoneName) || '').trim(); if (own) return own;
            return [...new Set(((o && o.equipmentIds) || []).map(id => String((techFindEq(id) || {}).zoneName || '').trim()).filter(Boolean))].join(' · ');
        }

        function renderTechAgenda() {
            const container = document.getElementById('tech-orders-container');
            if (!container) return;
            const u = systemUsers.find(x => x.id === activeUser);
            const myOrders = workOrders.filter(o => {
                if (!isPreventiveOrder(o) || !techMatches(o, u)) return false;
                const effective = techEffectiveStatus(o);
                // Si hay equipos pendientes, la rutina siempre debe poder abrirse aunque status diga COMPLETED.
                return effective === 'PENDING' || (effective === 'COMPLETED' && !o.technicianFinished);
            }).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id), 'es', { numeric: true }));

            const nPend = myOrders.filter(o => techEffectiveStatus(o) === 'PENDING').length;
            const nDone = myOrders.filter(o => techEffectiveStatus(o) === 'COMPLETED').length;
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            set('stat-pending', nPend); set('stat-done', nDone);
            set('seg-count-all', myOrders.length); set('seg-count-pending', nPend); set('seg-count-done', nDone);
            ['all', 'pending', 'done'].forEach(k => {
                const b = document.getElementById('seg-' + k);
                if (b) b.classList.toggle('is-active', techFilter === k);
            });

            const visible = myOrders.filter(o => techFilter === 'all' || (techFilter === 'pending' ? techEffectiveStatus(o) === 'PENDING' : techEffectiveStatus(o) === 'COMPLETED'));
            if (visible.length === 0) {
                container.innerHTML = '<div class="empty"><i class="fa-solid fa-clipboard-check"></i>No tienes rutinas pendientes por ejecutar o terminar.</div>';
                return;
            }

            container.innerHTML = visible.map(o => {
                const progress = techOrderProgress(o);
                const awaitingSignature = progress.known && progress.allDone && techSignatureDecision(o) === 'PENDING';
                const isCompleted = techEffectiveStatus(o) === 'COMPLETED';
                const eqIds = o.equipmentIds || [];
                const routineRaw = String(o.maintenanceType || o.tipoRutina || o.routineType || o.type || 'PREVENTIVO').toUpperCase();
                const routineLabel = (routineRaw.includes('COR') ? 'Correctivo' : (routineRaw.includes('REV') ? 'Revisión' : 'Preventivo'));
                return `<article class="r-card ${isCompleted ? 'is-done' : ''}">
                    <div class="r-top">
                        <span class="r-id">${esc(o.id)}</span>
                        <span class="pill ${routineLabel === 'Correctivo' ? 'pill-warn' : (routineLabel === 'Revisión' ? 'pill-idle' : 'pill-pend')}">${routineLabel}</span>
                        <span class="pill ${isCompleted ? 'pill-ok' : 'pill-pend'}">${isCompleted ? 'Rutina cerrada' : (awaitingSignature ? 'Equipos listos · firma pendiente' : 'Pendiente · continuar rutina')}</span>
                    </div>
                    <h3 class="r-client">${esc(o.client)}</h3>
                    ${techOrderZone(o) ? `<span class="zone-chip"><i class="fa-solid fa-layer-group"></i>${esc(techOrderZone(o))}</span>` : ''}
                    <div class="r-meta">
                        <span><i class="fa-regular fa-calendar"></i>${esc(o.date)}</span>
                        <span><i class="fa-solid fa-snowflake"></i>${progress.known ? progress.done + ' de ' + progress.total + ' equipos finalizados' : 'Avance pendiente de consulta detallada'}</span>
                    </div>
                    <div class="r-progress"><div class="bar"><i style="width:${progress.known ? progress.percent : 0}%"></i></div><span>${progress.known ? progress.percent + '%' : '—'}</span></div>
                    ${awaitingSignature
                        ? `<button onclick="openOrderHub('${escJs(o.id)}')" class="btn btn-ok btn-lg btn-block"><i class="fa-solid fa-file-signature"></i> Recabar firma o elegir finalizar sin firma</button>`
                        : (isCompleted
                            ? `<button onclick="finishTechnicianRoutine('${escJs(o.id)}')" class="btn btn-ok btn-lg btn-block"><i class="fa-solid fa-check"></i> Terminar</button>`
                            : `<button onclick="openOrderHub('${escJs(o.id)}')" class="btn btn-primary btn-lg btn-block"><i class="fa-solid fa-play"></i> Continuar ejecutando rutina</button>`)}
                </article>`;
            }).join('');
        }

        // ---------- Hub de rutina ----------
        // El técnico solo trabaja rutinas preventivas: ya no existe la pestaña de correctivos.
        function updateHubTabButtons() { currentHubTab = 'equipos'; }

        // Regla común con index.html: un equipo cuenta como finalizado solo con timestamp
        // y todos los parámetros/checklist obligatorios, salvo estado FINALIZADO explícito.
        function getEquipmentExecutionStatus(eq, eqId, exec) {
            if (!exec || typeof exec !== 'object' || !exec.timestamp) return 'pending';
            if (String(exec.status || '').toUpperCase() === 'FINALIZADO') return 'done';
            const cfg = exec.formConfigSnapshot || equipmentFormsConfig[String(exec.typeKey || (eq && eq.type) || 'EXTRACTOR').trim().toUpperCase()] || equipmentFormsConfig['EXTRACTOR'] || {};
            const params = String(cfg.params || '').split(',').map(v => v.trim()).filter(Boolean);
            const checklist = String(cfg.checklist || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
            const values = exec.paramsValues || {};
            const checks = exec.checklist || {};
            const hasAny = params.some((_, i) => String(values['param_' + i] ?? exec['param_' + i] ?? '').trim())
                || checklist.some((_, i) => checks['chk_' + (i + 1)] === true || checks['check_' + (i + 1)] === true || checks[i] === true)
                || !!String(exec.obs || '').trim() || !!(exec.photos && exec.photos.length) || Number(exec.photosCount) > 0 || !!exec.corrective;
            if (!hasAny) return 'pending';
            const paramsComplete = params.every((_, i) => String(values['param_' + i] ?? exec['param_' + i] ?? '').trim() !== '');
            const checklistComplete = checklist.every((_, i) => checks['chk_' + (i + 1)] === true || checks['check_' + (i + 1)] === true || checks[i] === true);
            return (params.length + checklist.length) > 0 && paramsComplete && checklistComplete ? 'done' : 'progress';
        }

        function getTechChecklistMetrics(eq, exec) {
            const cfg = (exec && exec.formConfigSnapshot) || equipmentFormsConfig[(eq && eq.type || 'EXTRACTOR').trim().toUpperCase()] || equipmentFormsConfig['EXTRACTOR'] || {};
            const paramItems = String(cfg.params || '').split(',').map(v => v.trim()).filter(Boolean);
            const checklistItems = String(cfg.checklist || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
            const values = (exec && exec.paramsValues) || {};
            const checks = (exec && exec.checklist) || {};
            const missing = [];
            let done = 0;

            // Cada parámetro técnico configurado (incluidos Voltaje y Amperaje) es obligatorio.
            paramItems.forEach((label, i) => {
                const value = values['param_' + i] ?? (exec && exec['param_' + i]) ?? '';
                if (String(value).trim()) done++;
                else missing.push(label);
            });

            checklistItems.forEach((label, i) => {
                const checked = checks['chk_' + (i + 1)] === true || checks['check_' + (i + 1)] === true || checks[i] === true;
                if (checked) done++;
                else missing.push(label);
            });

            const total = paramItems.length + checklistItems.length;
            return { done, total, missing, percent: total ? Math.round(done / total * 100) : 0 };
        }

        function renderCurrentHubEquipments() {
            const order = workOrders.find(o => String(o.id) === String(currentExecOrderId));
            if (order) renderOrderHubEquipments(order);
        }

        function renderOrderHubEquipments(order) {
            const container = document.getElementById('hub-equipments-list');
            if (!container) return;
            const eqIds = order.equipmentIds || [];
            const search = (document.getElementById('hub-equipment-search')?.value || '').trim().toLocaleLowerCase('es');
            const statusFilter = document.getElementById('hub-equipment-status-filter')?.value || 'all';
            const allItems = [];

            eqIds.forEach(eqId => {
                const eq = techFindEq(eqId) || { id: eqId, code: eqId, name: 'Desconocido', type: 'HVAC' };
                const exec = order.executions && (order.executions[eqId] || order.executions[eq.id] || order.executions[eq.code]);
                const status = getEquipmentExecutionStatus(eq, eqId, exec);
                allItems.push({ eqId, eq, exec, status });
            });

            let displayList = allItems.filter(item => {
                const { eqId, eq, exec, status } = item;
                if (statusFilter !== 'all' && status !== statusFilter) return false;
                const searchable = [eqId, eq.id, eq.code, eq.name, eq.model, eq.serial].map(v => String(v || '')).join(' ').toLocaleLowerCase('es');
                return !search || searchable.includes(search);
            });

            let html = '';
            if (!displayList.length) {
                let msg = 'No hay equipos asignados que coincidan con los filtros.';
                html = `<div class="empty"><i class="fa-solid fa-box-open"></i>${esc(msg)}</div>`;
            }

            displayList.forEach(({ eqId, eq, exec, status }) => {
                const corr = !!(exec && exec.corrective);
                const statusLabel = status === 'done' ? 'Completado' : status === 'progress' ? 'En progreso' : 'Pendiente';
                const statusClass = status === 'done' ? 'pill-ok' : status === 'progress' ? 'pill-warn' : 'pill-idle';
                html += `<article class="e-card ${status === 'done' ? 'is-done' : ''} ${corr ? 'is-corr' : ''}" style="position:relative;overflow:hidden;">
                    <div style="position:absolute;left:0;top:0;bottom:0;width:5px;background:linear-gradient(180deg,#3b82f6,#10b981);"></div>
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;padding-left:4px;">
                        <span style="min-width:0;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;overflow-wrap:anywhere;">${esc(order.client || '—')}</span>
                        <span class="e-code">${esc(eq.code || eqId || '—')}</span>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:8px;">
                        <span class="pill ${statusClass}">${statusLabel}</span>
                        ${corr ? '<span class="pill pill-warn">Correctivo</span>' : ''}
                    </div>
                    <h3 class="e-name" style="font-size:16px;font-weight:900;margin-bottom:6px;line-height:1.3;">${esc(eq.name || '—')}</h3>
                    <p style="font-size:11px;color:var(--muted);margin-bottom:8px;">${esc(eq.type || '—')} · ${esc(eq.brand || '—')} · ${esc(eq.model || '—')}</p>
                    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Avance del equipo: <strong style="color:var(--text);">${getTechChecklistMetrics(eq, exec).done}/${getTechChecklistMetrics(eq, exec).total}</strong> (${getTechChecklistMetrics(eq, exec).percent}%)</div>
                    ${getTechChecklistMetrics(eq, exec).missing.length ? `<p class="e-note"><strong>Ítems pendientes:</strong> ${esc(getTechChecklistMetrics(eq, exec).missing.join(' · '))}</p>` : ''}
                    ${corr ? `<p class="e-note"><strong>Novedad:</strong> ${esc(exec.correctiveDesc || 'Sin descripción')}</p>` : ''}
                    <button onclick="openEquipmentExecutionModal('${String(order.id).replace(/'/g, '&#39;')}', '${String(eqId).replace(/'/g, '&#39;')}')" class="btn ${status === 'done' ? 'btn-ghost' : 'btn-primary'} btn-lg btn-block">
                        ${status === 'done' ? '<i class="fa-solid fa-pen"></i> Editar intervención' : '<i class="fa-solid fa-play"></i> Intervenir'}
                    </button>
                </article>`;
            });
            container.innerHTML = html;

            const routineProgress = techOrderProgress(order);
            const progressBar = document.getElementById('hub-progress-bar');
            const progressText = document.getElementById('hub-progress-text');
            if (progressBar) progressBar.style.width = `${routineProgress.known ? routineProgress.percent : 0}%`;
            if (progressText) progressText.innerText = routineProgress.known ? `${routineProgress.done} / ${routineProgress.total} Equipos (${routineProgress.percent}%)` : `Avance no disponible / ${routineProgress.total} Equipos (—)`;
            const finalizeBox = document.getElementById('hub-finalize-container');
            const signaturePending = techSignatureDecision(order) === 'PENDING';
            const canResolveSignature = routineProgress.total > 0 && routineProgress.allDone && signaturePending && String(order.status).toUpperCase() !== 'BILLED';
            if (finalizeBox) finalizeBox.classList.toggle('hidden', !canResolveSignature);
            const finalizeTitle = document.getElementById('hub-finalize-title');
            const finalizeText = document.getElementById('hub-finalize-text');
            if (finalizeTitle) finalizeTitle.textContent = '¡Todos los equipos intervenidos!';
            if (finalizeText) finalizeText.textContent = 'La orden permanece pendiente hasta que recabes la firma o elijas expresamente finalizar sin firma. Puedes salir y volver a esta orden para resolverlo.';
        }

        // =========================================================================
        // FORMULARIO DINÁMICO SEGÚN TIPO DE EQUIPO (misma lógica; diseño móvil)
        // =========================================================================
        function openEquipmentExecutionModal(orderId, eqId) {
            currentExecOrderId = orderId;
            currentExecEqId = eqId;
            const order = workOrders.find(o => o.id === orderId);
            const eq = techFindEq(eqId) || { code: eqId, type: 'EXTRACTOR' };
            const exec = (order.executions && (order.executions[eqId] || order.executions[eq.code])) || {};

            const typeKey = (eq.type || 'EXTRACTOR').trim().toUpperCase();
            const formCfg = equipmentFormsConfig[typeKey] || equipmentFormsConfig['EXTRACTOR'] || {
                params: "Voltaje (V), Amperaje (A)",
                checklist: "Limpieza general"
            };

            document.getElementById('exec-equipment-modal-backdrop').classList.remove('hidden');
            document.getElementById('exec-modal-eq-title').innerText = order.client || 'Intervención técnica';
            document.getElementById('exec-modal-eq-subtitle').innerText = '';
            const identityCard = document.getElementById('exec-equipment-identity-card');
            if (identityCard) identityCard.innerHTML = `
                <article class="e-card" style="position:relative; overflow:hidden; background:var(--surface); border:1px solid var(--line);">
                    <div style="position:absolute; left:0; top:0; bottom:0; width:5px; background:linear-gradient(180deg,#3b82f6,#10b981);"></div>
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; padding-left:4px;">
                        <span style="min-width:0;font-size:10px; font-weight:800; color:var(--muted); text-transform:uppercase; overflow-wrap:anywhere;">${esc(order.client || '—')}</span>
                        <span class="e-code">${esc(eq.code || eqId || '—')}</span>
                    </div>
                    <h3 class="e-name" style="font-size:16px; font-weight:900; margin-bottom:12px; line-height:1.3;">${esc(eq.name || '—')}</h3>
                    <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; font-size:11px; border-top:1px solid var(--line); padding-top:12px;">
                        <div><span style="color:var(--muted);display:block;font-weight:800;text-transform:uppercase;font-size:9px;">Tipo</span><strong style="color:var(--text);">${esc(eq.type || '—')}</strong></div>
                        <div><span style="color:var(--muted);display:block;font-weight:800;text-transform:uppercase;font-size:9px;">Capacidad</span><strong style="color:var(--text);">${esc(eq.capacity || '—')}</strong></div>
                        <div><span style="color:var(--muted);display:block;font-weight:800;text-transform:uppercase;font-size:9px;">Marca</span><strong style="color:var(--text);">${esc(eq.brand || '—')}</strong></div>
                        <div><span style="color:var(--muted);display:block;font-weight:800;text-transform:uppercase;font-size:9px;">Modelo</span><strong style="color:var(--text);">${esc(eq.model || '—')}</strong></div>
                        <div><span style="color:var(--muted);display:block;font-weight:800;text-transform:uppercase;font-size:9px;">Nro. Serie</span><strong style="color:var(--text);">${esc(eq.serial || '—')}</strong></div>
                    </div>
                </article>`;

            // Parámetros técnicos dinámicos
            const paramsContainer = document.getElementById('exec-params-container');
            paramsContainer.innerHTML = '';
            const paramList = formCfg.params.split(',').map(p => p.trim()).filter(Boolean);
            let paramsHtml = '';
            paramList.forEach((paramName, idx) => {
                const paramKey = `param_${idx}`;
                const rawVal = exec.paramsValues ? exec.paramsValues[paramKey] : (exec[paramKey] || '');
                const val = rawVal == null ? '' : rawVal;
                paramsHtml += `
                    <label class="field">
                        <span>${esc(paramName)}</span>
                        <input type="text" data-param-key="${paramKey}" class="input exec-param-input" value="${esc(val)}" placeholder="Valor…" autocomplete="off" enterkeyhint="next">
                    </label>`;
            });
            paramsContainer.innerHTML = paramsHtml;

            // Checklist dinámico
            const checkContainer = document.getElementById('exec-checklist-container');
            checkContainer.innerHTML = '';
            const checkListItems = formCfg.checklist.split('\n').map(c => c.trim()).filter(Boolean);
            let checksHtml = '';
            checkListItems.forEach((checkText, idx) => {
                const chkKey = `chk_${idx + 1}`;
                const chks = exec.checklist || {};
                const isChecked = !!chks[chkKey];
                checksHtml += `
                    <label class="chk-row">
                        <input type="checkbox" data-chk-key="${chkKey}" ${isChecked ? 'checked' : ''} class="exec-chk-input">
                        <span class="chk-box"><i class="fa-solid fa-check"></i></span>
                        <span class="chk-text">${esc(checkText)}</span>
                    </label>`;
            });
            checkContainer.innerHTML = checksHtml;

            document.getElementById('exec-f-obs').value = exec.obs || '';

            // Precarga las observaciones técnicas independientes; migra registros antiguos desde obs.
            const technicalObsInput = document.getElementById('exec-f-observaciones-tecnicas');
            if (technicalObsInput) {
                technicalObsInput.value = String(
                    exec.observaciones_tecnicas || exec.observaciones ||
                    exec.notas_tecnicas || exec.obs || ''
                );
            }

            const chkCorr = document.getElementById('exec-chk-correctivo');
            chkCorr.checked = !!exec.corrective;
            document.getElementById('exec-corrective-desc').value = exec.correctiveDesc || '';
            toggleCorrectiveSection();

            tempPhotosList = exec.photos || [];
            renderExecPhotosPreview();
            markExecMissing([]);
            updateExecProgress();
            const body = document.querySelector('#exec-equipment-modal-backdrop .sheet-body');
            if (body) body.scrollTop = 0;
        }

        function updateExecProgress() {
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            const params = Array.from(document.querySelectorAll('.exec-param-input'));
            const checks = Array.from(document.querySelectorAll('.exec-chk-input'));
            set('exec-params-count', `${params.filter(i => String(i.value || '').trim()).length}/${params.length}`);
            set('exec-chk-count', `${checks.filter(i => i.checked).length}/${checks.length}`);
        }

        function markExecMissing(list) {
            document.querySelectorAll('#exec-equipment-modal-backdrop .is-missing').forEach(n => n.classList.remove('is-missing'));
            (list || []).forEach(el => {
                const box = el.closest('.field, .chk-row');
                if (box) box.classList.add('is-missing');
            });
        }

        let execPhotosInFlight = 0;
        async function handleExecPhotosChange(e) {
            const input = e && (e.currentTarget || e.target);
            if (!input) return;

            const files = Array.from(input.files || []);
            input.value = '';
            if (!files.length) return;

            // Compatibilidad con inputs antiguos: utiliza el mismo límite,
            // reserva de cupos, compresión paralela y subida R2 que el flujo actual.
            const category = input.dataset && input.dataset.phCat === 'despues'
                ? 'despues'
                : 'antes';
            return ordenAgregarFotos(category, files);
        }

        function renderExecPhotosPreview() {
            const cont = document.getElementById('exec-photos-preview');
            const isCorrective = document.getElementById('exec-chk-correctivo').checked;
            const counter = document.getElementById('exec-photos-count');
            if (counter) counter.textContent = `${tempPhotosList.length}/${isCorrective ? 6 : 5}`;
            if (!tempPhotosList.length) {
                cont.innerHTML = '<div class="ph-empty"><i class="fa-solid fa-camera"></i> Aún no hay fotos de evidencia</div>';
                return;
            }
            cont.innerHTML = tempPhotosList.map((p, idx) => `<div class="ph">
                <button type="button" class="ph-img" onclick="viewExecutionPhoto(${idx})" aria-label="Ampliar foto ${idx + 1}">
                    <img src="${p}" alt="Foto de evidencia ${idx + 1}">
                </button>
                <button type="button" class="ph-del" aria-label="Eliminar foto ${idx + 1}" onclick="tempPhotosList.splice(${idx},1); renderExecPhotosPreview();"><i class="fa-solid fa-trash"></i></button>
                <span class="ph-n">${idx + 1}</span>
            </div>`).join('');
        }

        function closeReceiptViewerModal() {
            document.getElementById('receipt-viewer-modal-backdrop').classList.add('hidden');
        }

        async function openOrderHub(orderId) {
            currentExecOrderId = orderId;
            let order = workOrders.find(o => String(o.id) === String(orderId));
            if (!order) return;
            keepOrderPendingForSignature(order);

            document.getElementById('order-hub-modal-backdrop').classList.remove('hidden');
            document.getElementById('hub-order-title').innerText = `Orden ${order.id} - ${order.client}`;
            document.getElementById('hub-order-subtitle').innerText = `${techOrderZone(order) ? 'Zona / Piso: ' + techOrderZone(order) + ' | ' : ''}Técnico: ${order.technician} | Fecha: ${order.date}`;

            currentHubTab = 'equipos';
            const searchInput = document.getElementById('hub-equipment-search');
            const statusSelect = document.getElementById('hub-equipment-status-filter');
            if (searchInput) searchInput.value = '';
            if (statusSelect) statusSelect.value = 'all';
            updateHubTabButtons();
            renderOrderHubEquipments(order); // respuesta inmediata con datos que ya existen localmente

            // El payload pesado (fotos/firmas) se solicita solo para esta orden abierta.
            const fullOk = await hvacEnsureFullOrder(orderId);
            if (String(currentExecOrderId) !== String(orderId)) return;
            order = workOrders.find(o => String(o.id) === String(orderId)) || order;
            const eqOk = await ensureOrderEquipments(order);
            if (String(currentExecOrderId) !== String(orderId)) return;
            keepOrderPendingForSignature(order); // también cubre órdenes antiguas cargadas completas desde Supabase
            renderOrderHubEquipments(order);
            if (!fullOk && navigator.onLine !== false && hvacHasLite(order)) showToast('No se pudo cargar el detalle completo; se conserva la versión ligera disponible.', 'error');
            if (!eqOk && (order.equipmentIds || []).some(id => !techFindEq(id))) showToast('No se pudieron cargar todos los equipos. Revisa tu conexión y vuelve a abrir la rutina.', 'error');
        }

        function closeOrderHubModal() {
            document.getElementById('order-hub-modal-backdrop').classList.add('hidden');
            currentExecOrderId = null;
        }

        function switchHubTab() {
            currentHubTab = 'equipos';
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (order) renderOrderHubEquipments(order);
        }

        function closeEquipmentExecutionModal() {
            try { if (typeof DICT !== 'undefined' && DICT.active) dictStop(); } catch (e) { /* sin dictado activo */ }
            document.getElementById('exec-equipment-modal-backdrop').classList.add('hidden');
            currentExecEqId = null;
        }

        function toggleCorrectiveSection() {
            const chk = document.getElementById('exec-chk-correctivo').checked;
            const box = document.getElementById('corrective-details-box');
            box.classList.toggle('hidden', !chk);
            renderExecPhotosPreview();
        }

        function viewExecutionPhoto(index) {
            const photo = tempPhotosList[index];
            if (!photo) return;
            document.getElementById('receipt-viewer-img').src = photo;
            document.getElementById('receipt-viewer-modal-backdrop').classList.remove('hidden');
        }

        function openGlobalSignatureModal() {
            const order = workOrders.find(o => String(o.id) === String(currentExecOrderId));
            if (!order || !techOrderProgress(order).allDone) {
                showToast('Primero debes completar todos los equipos de la orden.', 'error');
                return;
            }
            if (techSignatureDecision(order) !== 'PENDING') {
                showToast('Esta orden ya tiene una decisión de firma registrada.', 'error');
                return;
            }
            const nameInput = document.getElementById('sig-client-name');
            if (nameInput) nameInput.value = '';
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


        async function saveEquipmentExecution() {
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (!order) return;
            if (!order.executions) order.executions = {};

            const missingParams = Array.from(document.querySelectorAll('.exec-param-input')).filter(input => !String(input.value || '').trim());
            const uncheckedItems = Array.from(document.querySelectorAll('.exec-chk-input')).filter(input => !input.checked);
            // Un solo botón: si falta algo se guarda como avance (En progreso); si todo está completo, como equipo completado.
            const pendingCount = missingParams.length + uncheckedItems.length;
            const partial = pendingCount > 0;
            markExecMissing([]);

            const paramsValues = {};
            document.querySelectorAll('.exec-param-input').forEach(input => {
                paramsValues[input.getAttribute('data-param-key')] = input.value;
            });

            const checklist = {};
            document.querySelectorAll('.exec-chk-input').forEach(chk => {
                checklist[chk.getAttribute('data-chk-key')] = chk.checked;
            });

            const routineType = typeof ordenTipoActual === 'function' ? ordenTipoActual() : 'PREVENTIVO';
            const isCorrectiveRoutine = routineType === 'CORRECTIVO';
            const corrective = !isCorrectiveRoutine && document.getElementById('exec-chk-correctivo').checked;
            let correctiveDesc = isCorrectiveRoutine ? '' : document.getElementById('exec-corrective-desc').value.trim();
            if (corrective && !correctiveDesc) {
                const formal = (document.getElementById('exec-f-notas-analiticas').value || '').replace(/^Durante[^.]*se registró lo siguiente\.\s*/i, '').replace(/\s+/g, ' ').trim();
                const base = formal || String(document.getElementById('exec-f-obs').value || '').replace(/\s+/g, ' ').trim();
                const cut = base.length > 260 ? base.slice(0, 260).replace(/[^.]*$/, '').trim() || base.slice(0, 260) + '…' : base;
                correctiveDesc = cut;
            }

            const eq = techFindEq(currentExecEqId);
            const typeKey = (eq && eq.type ? eq.type : 'EXTRACTOR').trim().toUpperCase();
            const formCfg = equipmentFormsConfig[typeKey] || equipmentFormsConfig['EXTRACTOR'];

            const previousExecData = order.executions[currentExecEqId] || (eq && order.executions[eq.code]) || {};
            const execData = {
                typeKey,
                correctiveAgendaId: previousExecData.correctiveAgendaId || null,
                formConfigSnapshot: formCfg, // Guardamos la foto exacta del formulario activo para que el PDF refleje exactamente los campos editados
                paramsValues,
                checklist,
                obs: document.getElementById('exec-f-obs').value,
                tipoRutina: routineType,
                // En correctivos, las labores ejecutadas se documentan en Notas del técnico.
                observaciones_tecnicas: (isCorrectiveRoutine || routineType === 'REVISION') ? '' : String(
                    document.getElementById('exec-f-observaciones-tecnicas')?.value || ''
                ).trim(),
                corrective,
                correctiveDesc,
                photos: tempPhotosList,
                partial: !!partial,
                timestamp: new Date().toISOString()
            };

            order.executions[currentExecEqId] = execData;
            if (eq && eq.code) order.executions[eq.code] = execData;

            if (corrective) {
                // Evita crear una tarea correctiva duplicada cada vez que se guarda un avance.
                let agendaItem = execData.correctiveAgendaId
                    ? agendaItems.find(item => item.id === execData.correctiveAgendaId)
                    : null;
                if (!agendaItem) {
                    agendaItem = {
                        id: `AG-CORR-${Date.now()}`,
                        origin: `Orden ${order.id} (Equipo ${eq ? eq.code : ''})`,
                        client: order.client,
                        status: 'Pendiente por gestionar',
                        description: `[Correctivo Equipo ${eq ? eq.code : ''}] ${correctiveDesc || 'Sin descripción'}`,
                        date: new Date().toISOString().split('T')[0]
                    };
                    agendaItems.push(agendaItem);
                    execData.correctiveAgendaId = agendaItem.id;
                } else {
                    agendaItem.description = `[Correctivo Equipo ${eq ? eq.code : ''}] ${correctiveDesc || 'Sin descripción'}`;
                }
                localStorage.setItem('HVAC_AGENDA_BACKUP', JSON.stringify(agendaItems));
            }

            persistOrderLocallyAndSync(order);
            closeEquipmentExecutionModal();
            renderOrderHubEquipments(order);
            showToast(partial
                ? `Avance guardado localmente. El equipo queda En progreso (faltan ${pendingCount} punto(s)); sincronizando…`
                : 'Intervención guardada localmente; sincronizando en segundo plano…');
        }

        async function submitGlobalSignature() {
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (!order) return;
            if (!techOrderProgress(order).allDone) { showToast('No puedes cerrar la orden: todavía hay equipos pendientes o informes incompletos.', 'error'); order.status = 'PENDING'; return; }
            if (techSignatureDecision(order) !== 'PENDING') { showToast('Esta orden ya tiene una decisión de firma registrada.', 'error'); return; }
            const clientName = document.getElementById('sig-client-name').value.trim();
            const sigData = await r2keep(sigCanvas.toDataURL('image/png'), 'firmas');
            const decisionAt = new Date().toISOString();

            order.clientSignature = { name: clientName || order.client, signatureImg: sigData, timestamp: decisionAt };
            order.signatureDecision = 'SIGNED';
            order.signatureDecisionAt = decisionAt;
            order.signatureDecisionBy = String(activeUser || '');
            order.signatureDecisionReason = 'Firma recabada';
            order.status = 'COMPLETED';
            order.technicianFinished = true;
            order.technicianFinishedAt = decisionAt;

            persistOrderLocallyAndSync(order);
            closeGlobalSignatureModal();
            closeOrderHubModal();
            renderTechAgenda();
            showToast("Firma y cierre guardados localmente; sincronizando en segundo plano…");
        }

        async function finalizeRoutineWithoutSignature() {
            const order = workOrders.find(o => o.id === currentExecOrderId);
            if (!order) return;
            if (!techOrderProgress(order).allDone) { showToast('No puedes cerrar la orden: todavía hay equipos pendientes o informes incompletos.', 'error'); order.status = 'PENDING'; return; }
            if (techSignatureDecision(order) !== 'PENDING') { showToast('Esta orden ya tiene una decisión de firma registrada.', 'error'); return; }
            const confirmed = window.confirm('¿Confirmas que NO se recabará la firma y que deseas finalizar la orden? Esta decisión quedará registrada en el informe.');
            if (!confirmed) return;
            const decisionAt = new Date().toISOString();
            order.clientSignature = { name: 'Completado sin firma', signatureImg: null, timestamp: decisionAt };
            order.signatureDecision = 'DECLINED';
            order.signatureDecisionAt = decisionAt;
            order.signatureDecisionBy = String(activeUser || '');
            order.signatureDecisionReason = 'El técnico eligió expresamente finalizar sin recabar firma';
            order.status = 'COMPLETED';
            order.technicianFinished = true;
            order.technicianFinishedAt = decisionAt;

            persistOrderLocallyAndSync(order);
            closeGlobalSignatureModal();
            closeOrderHubModal();
            renderTechAgenda();
            showToast("Cierre guardado localmente; sincronizando en segundo plano…");
        }

        async function finishTechnicianRoutine(orderId) {
            const order = workOrders.find(o => o.id === orderId);
            if (!order || !techOrderProgress(order).allDone) {
                showToast("Aún hay equipos pendientes o con informes incompletos. Continúa la rutina antes de terminarla.", "error");
                if (order) { order.status = 'PENDING'; order.technicianFinished = false; renderTechAgenda(); }
                return;
            }
            if (techSignatureDecision(order) === 'PENDING') {
                order.status = 'PENDING';
                order.technicianFinished = false;
                persistOrderLocallyAndSync(order);
                openOrderHub(orderId);
                showToast('Falta resolver la firma. Recábala o selecciona expresamente finalizar sin firma.', 'error');
                return;
            }
            order.status = 'COMPLETED';
            if (order.technicianFinished) return;

            order.technicianFinished = true;
            order.technicianFinishedAt = new Date().toISOString();
            persistOrderLocallyAndSync(order);
            renderTechAgenda();
            showToast("Rutina terminada. Ya no aparece en tu agenda.");
        }

        let appBusyCount = 0;
        let appBusyTimer = null;
        function appBusyStart(label) {
            appBusyCount++;
            if (appBusyTimer) clearTimeout(appBusyTimer);
            appBusyTimer = setTimeout(() => {
                const overlay = document.getElementById('app-processing-overlay');
                const text = document.getElementById('app-processing-label');
                if (overlay && appBusyCount > 0) {
                    if (text) text.textContent = label || 'Procesando información…';
                    overlay.classList.add('is-visible');
                    overlay.setAttribute('aria-hidden', 'false');
                }
            }, 120);
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
        function wrapWithGlobalProcessing(name, label) {
            const original = window[name];
            if (typeof original !== 'function' || original.__hvacBusyWrapped) return;
            const wrapped = async function (...args) {
                appBusyStart(label);
                try { return await original.apply(this, args); }
                finally { appBusyEnd(); }
            };
            wrapped.__hvacBusyWrapped = true;
            window[name] = wrapped;
        }


        // Fotos: la cámara y la galería usan exactamente el mismo flujo de compresión y límites.
        ['exec-f-photos', 'exec-f-photos-cam'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', handleExecPhotosChange);
        });

        (function techUiLayer() {
            const execModal = document.getElementById('exec-equipment-modal-backdrop');
            if (execModal) {
                const onEdit = e => {
                    const box = e.target.closest && e.target.closest('.field, .chk-row');
                    if (box) box.classList.remove('is-missing');
                    updateExecProgress();
                };
                execModal.addEventListener('input', onEdit);
                execModal.addEventListener('change', onEdit);
            }
            const banner = document.getElementById('offline-banner');
            // navigator.onLine no es una prueba fiable de acceso a Internet en algunos móviles.
            // El estado real se refleja en la insignia de nube y en la cola persistente.
            const setNet = () => { if (banner) banner.classList.add('hidden'); };
            window.addEventListener('online', setNet); window.addEventListener('offline', setNet); setNet();

            const chip = document.getElementById('tech-pending-chip');
            const updatePending = () => {
                try {
                    const n = cloudOutboxRead().length;
                    if (chip) { chip.textContent = n + (n === 1 ? ' cambio pendiente' : ' cambios pendientes'); chip.classList.toggle('hidden', !n); }
                } catch (_) {}
            };
            setInterval(updatePending, 3000); updatePending();
            setInterval(() => {
                if (cloudOutboxRead().length) cloudFlushOutbox().catch(err => console.warn('[Offline] Reintento automático pendiente:', err));
            }, 30000);
            // Fuerza el drenaje de escrituras persistentes cuando la app pasa a segundo plano o vuelve al frente.
            window.addEventListener('pagehide', () => { try { localStorage.setItem('HVAC_LAST_LOCAL_SAVE', String(Date.now())); } catch (_) {} });
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    hvacFlushStorageWrites().catch(() => {});
                } else if (navigator.onLine) {
                    (async () => {
                        const refreshPromise = refreshMyOrdersFromServer(); // inicia GET no-store de inmediato
                        const flushPromise = cloudOutboxRead().length ? cloudFlushOutbox() : Promise.resolve();
                        await Promise.all([refreshPromise, flushPromise]);
                    })().catch(err => console.warn('[Supabase] Revalidación automática al volver a la app:', err));
                }
            });
            window.addEventListener('online', () => {
                if (cloudOutboxRead().length) cloudFlushOutbox().catch(err => console.warn('[Offline] Reintento al recuperar red:', err));
            });

            const lock = () => {
                const open = Array.from(document.querySelectorAll('.modal-backdrop')).some(el => !el.classList.contains('hidden'));
                document.body.classList.toggle('modal-open', open);
            };
            document.querySelectorAll('.modal-backdrop').forEach(el => new MutationObserver(lock).observe(el, { attributes: true, attributeFilter: ['class'] }));
            lock();

        // ===== Extras de orden de servicio integrados con el estado existente =====
        const ordenFotos = { antes: [], despues: [] };
        let ordenMaxFotos = 8;
        let ordenFotosEnProceso = 0;
        const ordenLecturas = [['voltaje', 'Voltaje'], ['amperaje', 'Amperaje'], ['presionOtros', 'Presión / Otros']];
        let ordenFirmaVacia = true;
        let ordenFirmaRedimensionar = null;

        function ordenTipoActual() {
            const radio = document.querySelector('input[name="exec-tipo-rutina"]:checked');
            return radio ? radio.value : 'PREVENTIVO';
        }
        function ordenAplicarTipo() {
            const preventivo = ordenTipoActual() === 'PREVENTIVO';
            const p = document.getElementById('exec-params-section');
            const c = document.getElementById('exec-checklist-section');
            if (p) p.classList.toggle('hidden', !preventivo);
            if (c) c.classList.toggle('hidden', !preventivo);
            if (typeof updateExecProgress === 'function') updateExecProgress();
        }
        document.querySelectorAll('input[name="exec-tipo-rutina"]').forEach(r => r.addEventListener('change', ordenAplicarTipo));

        /* =====================================================================
           DICTADO POR VOZ + PROCESAMIENTO DE NOTAS (100 % gratis)
           - Voz a texto: API nativa de Chrome (SpeechRecognition), sin costo ni claves.
           - Redacción: el botón "Procesar notas" llama a iaFetch(). Si falla o no hay
             internet, se usa dictLocalProcess(), un procesador local que NO necesita IA ni claves.
           ===================================================================== */
        const DICT = { rec: null, active: false, base: '', finals: [], interim: '', timer: null, finishing: false };
        const DICT_SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const dEl = id => document.getElementById(id);
        const dNorm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

        function dictUI(on) {
            const btn = dEl('exec-btn-mic'), box = dEl('dictado-estado');
            btn.classList.toggle('on', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.setAttribute('aria-label', on ? 'Detener dictado' : 'Dictar por voz');
            btn.innerHTML = on ? '<i class="fa-solid fa-stop"></i>' : '<i class="fa-solid fa-microphone"></i>';
            box.classList.toggle('hidden', !on);
        }
        function dictWrite() {
            const obs = dEl('exec-f-obs');
            const parts = DICT.finals.slice();
            if (DICT.interim) {
                const last = parts[parts.length - 1];
                if (last && DICT.interim.toLowerCase().startsWith(last.toLowerCase())) parts[parts.length - 1] = DICT.interim;
                else parts.push(DICT.interim);
            }
            const spoken = parts.join(' ').replace(/\s+/g, ' ').trim();
            obs.value = [DICT.base, spoken].filter(Boolean).join(' ');
            obs.scrollTop = obs.scrollHeight;
        }
        function dictPushFinal(t) {                       // Chrome en Android a veces repite frases acumuladas
            const last = DICT.finals[DICT.finals.length - 1];
            if (last && t.toLowerCase().startsWith(last.toLowerCase())) DICT.finals[DICT.finals.length - 1] = t;
            else if (!last || last.toLowerCase() !== t.toLowerCase()) DICT.finals.push(t);
        }
        function dictLaunch() {
            const rec = new DICT_SR();
            rec.lang = 'es-CO'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
            rec.onresult = e => {
                let interim = '';
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    const r = e.results[i], t = (r[0] && r[0].transcript || '').trim();
                    if (!t) continue;
                    if (r.isFinal) dictPushFinal(t); else interim = t;
                }
                DICT.interim = interim;
                dictWrite();
            };
            rec.onerror = e => {
                const err = e && e.error;
                if (err === 'no-speech' || err === 'aborted') return;           // onend reinicia si sigue activo
                DICT.active = false;
                if (err === 'not-allowed' || err === 'service-not-allowed') showToast('Permite el micrófono: toca el candado de la barra de Chrome, Permisos, Micrófono.', 'error');
                else if (err === 'network') showToast('Sin internet: el dictado de Chrome necesita conexión.', 'error');
                else if (err === 'audio-capture') showToast('No se detecta ningún micrófono.', 'error');
                else showToast('No se pudo dictar (' + err + ').', 'error');
            };
            rec.onend = () => {
                if (DICT.interim) { dictPushFinal(DICT.interim); DICT.interim = ''; }
                if (DICT.active) setTimeout(() => { if (DICT.active) dictLaunch(); }, 200);   // Chrome corta tras unos segundos de silencio
                else dictFinish();
            };
            DICT.rec = rec;
            try { rec.start(); } catch (err) { console.warn('[Dictado] start()', err); }
        }
        function dictStart() {
            if (!DICT_SR) return showToast('Este navegador no permite dictado por voz. Usa Google Chrome.', 'error');
            if (!navigator.onLine) return showToast('Sin internet: el dictado de Chrome necesita conexión.', 'error');
            DICT.base = dEl('exec-f-obs').value.trim(); DICT.finals = []; DICT.interim = ''; DICT.active = true; DICT.finishing = false;
            dictUI(true);
            clearTimeout(DICT.timer); DICT.timer = setTimeout(dictStop, 180000);           // tope de 3 minutos
            dictLaunch();
        }
        function dictStop() {
            if (!DICT.active && !DICT.rec) return;
            DICT.active = false; clearTimeout(DICT.timer);
            try { DICT.rec && DICT.rec.stop(); } catch (e) { /* ya detenido */ }
            setTimeout(dictFinish, 1200);                                                  // por si onend no se dispara
        }
        function dictFinish() {
            if (DICT.finishing) return;
            DICT.finishing = true; DICT.rec = null;
            dictWrite(); dictUI(false);
            if (dEl('exec-f-obs').value.trim().length >= 15) ordenOptimizarNotas({ auto: true });
        }
        dEl('exec-btn-mic').addEventListener('click', () => (DICT.active ? dictStop() : dictStart()));
        dEl('dictado-parar').addEventListener('click', dictStop);
        if (!DICT_SR) dEl('exec-btn-mic').style.display = 'none';
        document.addEventListener('visibilitychange', () => { if (document.hidden && DICT.active) dictStop(); });
        ['exec-f-notas-analiticas', 'exec-f-conclusion'].forEach(id => dEl(id).addEventListener('input', e => { e.target.dataset.edited = '1'; }));

        /* ---- Procesador local (sin IA, sin claves): estructura el texto y detecta lecturas ---- */
        function dictLocalProcess(raw, tipo) {
            const original = String(raw || '').replace(/\s+/g, ' ').trim();
            const n = dNorm(original).replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\s*punto\s*(\d)/g, '$1.$2');
            let voltaje = '', amperaje = '', m;
            m = n.match(/(\d{2,3}(?:\.\d+)?)\s*(?:v\b|volt)/) || n.match(/volt\w*\s*(?:de|es|en|a|:)?\s*(\d{2,3}(?:\.\d+)?)/);
            if (m) voltaje = m[1];
            m = n.match(/(\d{1,3}(?:\.\d+)?)\s*amp/) || n.match(/amper\w*\s*(?:de|es|en|a|:)?\s*(\d{1,3}(?:\.\d+)?)/);
            if (m) amperaje = m[1];
            const pres = []; const re = /(succion|descarga|presion(?:\s+de)?(?:\s+(?:alta|baja))?)\D{0,15}?(\d{1,4}(?:\.\d+)?)\s*(psi|bar|kpa|libras)?/g; let pm;
            while ((pm = re.exec(n)) && pres.length < 3) {
                const label = pm[1].startsWith('succion') ? 'Succión' : pm[1].startsWith('descarga') ? 'Descarga' : 'Presión';
                const unit = pm[3] ? pm[3].toUpperCase().replace('LIBRAS', 'PSI') : 'PSI';
                pres.push(label + ' ' + pm[2] + ' ' + unit);
            }
            const presion = pres.join(', ');

            let t = original
                .replace(/\b(e+h+m*|m+m+)\b[,.]?/gi, ' ')
                .replace(/\b(o sea|digamos|como que|la verdad|pues)\b,?/gi, ' ')
                .replace(/\b(yo )?creo que\b/gi, 'se considera que')
                .replace(/\b(vimos|vi|observé|observamos) que\b/gi, 'se evidenció que')
                .replace(/\b(encontré|encontramos|encontró)\b/gi, 'se encontró')
                .replace(/\bluego de\b/gi, 'después de')
                .replace(/\b([\p{L}]+(?:\s+[\p{L}]+)?)\s+\1\b/giu, '$1')               // repeticiones al dictar ("la polea la polea")
                .replace(/\s+/g, ' ').trim();
            let sentences = t.split(/(?<=[.!?])\s+|\s*;\s*|\s+(?:luego|despu[eé]s|entonces|posteriormente|finalmente|adem[aá]s)(?!\s+de\b)\s+/i)
                .flatMap(x => { const k = x.length > 170 ? x.slice(50).search(/\s+(?:porque|ya que|medimos|se midi[oó]|la succi[oó]n|la descarga)\s+/i) : -1; return k >= 0 ? [x.slice(0, 50 + k), x.slice(50 + k)] : [x]; })
                .map(x => x.replace(/^(y|que|pues|bueno)\s+/i, '').replace(/^porque\s+/i, 'Lo anterior se debe a que ').replace(/[,\s]+$/, '').trim())
                .filter(x => x.length > 3)
                .map(x => x.charAt(0).toUpperCase() + x.slice(1) + (/[.!?]$/.test(x) ? '' : '.'));
            if (!sentences.length) sentences = [original.charAt(0).toUpperCase() + original.slice(1) + '.'];
            const intros = { REVISION: 'Durante la revisión técnica del equipo se registró lo siguiente.', PREVENTIVO: 'Durante el mantenimiento preventivo del equipo se registró lo siguiente.', CORRECTIVO: 'Durante la intervención correctiva del equipo se registró lo siguiente.' };
            const paras = [];
            for (let i = 0; i < sentences.length; i += 3) paras.push(sentences.slice(i, i + 3).join(' '));
            paras[0] = (intros[tipo] || intros.REVISION) + ' ' + paras[0];
            const lect = [voltaje && 'voltaje de ' + voltaje + ' V', amperaje && 'amperaje de ' + amperaje + ' A', presion && 'presión: ' + presion].filter(Boolean);
            if (lect.length) paras.push('Lecturas registradas: ' + lect.join('; ') + '.');

            const falla = /(cambiar|cambio|reemplaz|dano|falla|averi|fuga|ruido|vibra|roto|rota|quemad|no enciende|apagado|no funciona|no arranca|golpe|desgast|afectad|requiere|necesita|debe)/;
            const bien = /(funciona|funcionando|operativo|normal|buen estado|sin novedad|sin problema|correcto|ok\b)/;
            const bad = sentences.find(x => /(cambiar|cambio|reemplaz|dano|falla|averi|fuga|ruido|quemad|no enciende|no arranca)/.test(dNorm(x))) || sentences.find(x => falla.test(dNorm(x)));
            let conclusion, requiere = false, descCorr = '';
            if (bad) {
                requiere = true; descCorr = bad;
                conclusion = 'Estado general: el equipo presenta una novedad que requiere intervención correctiva, según lo descrito en las observaciones técnicas.';
            } else if (bien.test(n)) {
                conclusion = 'Estado general: el equipo se reporta operativo y no se describen novedades que requieran correctivo.';
            } else {
                conclusion = 'Estado general: con la información registrada no es posible determinar si el equipo presenta una condición que requiera correctivo.';
            }
            return { notas_analiticas: paras.join('\n\n'), conclusion, voltaje, amperaje, presion, requiere_correctivo: requiere, descripcion_correctivo: descCorr, advertencia_numeros: [], fuente: 'local' };
        }

        function dictApply(data) {
            const out = dEl('exec-f-notas-analiticas'), con = dEl('exec-f-conclusion');
            out.value = data.notas_analiticas || ''; out.dataset.edited = '';
            con.value = data.conclusion || ''; con.dataset.edited = '';
            const fillNum = (id, v) => { const el = dEl(id); const val = String(v || '').replace(',', '.').trim(); if (el && !el.value.trim() && /^\d{1,4}(\.\d+)?$/.test(val)) el.value = val; };
            fillNum('exec-f-voltaje', data.voltaje); fillNum('exec-f-amperaje', data.amperaje);
            const pr = dEl('exec-f-presion'), pv = String(data.presion || '').trim();
            if (pr && !pr.value.trim() && pv && pv.length <= 80) pr.value = pv;
            let extra = '';
            if (data.requiere_correctivo === true && ordenTipoActual() !== 'CORRECTIVO') {
                const chk = dEl('exec-chk-correctivo');
                if (chk && !chk.checked) { chk.checked = true; toggleCorrectiveSection(); }
                const d = dEl('exec-corrective-desc');                   // oculto: solo guarda la frase formal de la IA
                if (d) d.value = (data.fuente === 'ia' && data.descripcion_correctivo) ? String(data.descripcion_correctivo).slice(0, 600) : '';
                extra = ' Marqué “¿Requiere correctivo?”: verifícalo.';
            }
            if (typeof updateExecProgress === 'function') updateExecProgress();
            return extra;
        }

        // Intenta la IA del servidor; si no responde (sin clave, sin cupo, sin internet) usa el procesador local.
        // Tras un fallo se pausa 10 minutos para no hacer esperar al técnico.
        // Redacción con IA gratuita (Cloudflare Workers AI) a través del servidor. Si falla, se usa el procesador local.
        // Para apagarla: IA_ACTIVA = false.
        const IA_ACTIVA = true;
        let iaPausaHasta = 0;
        async function iaFetch(body) {
            const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 40000);
            try { return await fetch('/api/ia/asistente-notas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctl.signal }); }
            finally { clearTimeout(timer); }
        }

        async function ordenOptimizarNotas(opts) {
            const auto = !!(opts && opts.auto);
            const btn = dEl('exec-btn-ia'), obs = dEl('exec-f-obs');
            const out = dEl('exec-f-notas-analiticas'), con = dEl('exec-f-conclusion');
            const notas = obs.value.trim();
            if (!notas) { if (!auto) showToast('Escribe o dicta primero las notas del técnico.', 'error'); return; }
            const editado = (out.dataset.edited === '1' && out.value.trim()) || (con.dataset.edited === '1' && con.value.trim());
            if (editado) {
                if (auto) return showToast('Dictado listo. Toca “Procesar notas” para actualizar tus textos editados.');
                if (!confirm('Ya editaste las observaciones o las conclusiones. ¿Reemplazarlas con el nuevo resultado?')) return;
            }
            const original = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando…';
            let data = null, motivoIA = '';
            try {
                if (!IA_ACTIVA || !navigator.onLine || Date.now() < iaPausaHasta) throw new Error('local');   // sin IA: procesamiento local, instantáneo y sin internet
                const equipoActual = techFindEq(currentExecEqId) || {};
                const r = await iaFetch(JSON.stringify({
                    notas_brutas: notas,
                    tipo_servicio: ordenTipoActual(),
                    equipo_codigo: String(equipoActual.code || currentExecEqId || ''),
                    equipo_nombre: String(equipoActual.name || equipoActual.type || 'Equipo HVAC')
                }));
                const j = await r.json().catch(() => ({}));
                if (!r.ok || !j.notas_analiticas) throw new Error(r.status + ': ' + (j.error || 'respuesta vacía del servidor'));
                data = j;
            } catch (e) {
                console.warn('[IA] Se usa el procesador básico:', e && e.message);
                if (!(e && e.message === 'local')) {
                    const raw = String(e && e.message || '');
                    // El cupo diario agotado y los errores de configuración se recuerdan 10 minutos; las demoras puntuales solo 1 minuto.
                    iaPausaHasta = Date.now() + (/abort|tard/i.test(raw) ? 60 * 1000 : 10 * 60 * 1000);
                    motivoIA = /abort|tard/i.test(raw) ? 'la IA tardó demasiado' : raw.replace(/^\d+:\s*/, '').slice(0, 90);
                }
                data = dictLocalProcess(notas, ordenTipoActual());
            }
            try {
                const extra = dictApply(data);
                if (data.fuente === 'local') showToast((motivoIA ? 'IA no disponible (' + motivoIA + '): se usó el modo básico. ' : 'Observaciones y conclusiones generadas. ') + 'Revísalas antes de guardar.' + extra);
                else if (data.advertencia_numeros && data.advertencia_numeros.length) showToast('Verifica estas cifras en el texto: ' + data.advertencia_numeros.join(', '), 'error');
                else showToast('Observaciones y conclusiones generadas. Revísalas antes de guardar.' + extra);
            } finally { btn.disabled = false; btn.innerHTML = original; }
        }
        dEl('exec-btn-ia').addEventListener('click', () => ordenOptimizarNotas());

        function ordenRenderFotos() {
            ['antes', 'despues'].forEach(cat => {
                const cont = document.getElementById('ph-' + cat + '-grid');
                if (!cont) return;
                cont.innerHTML = ordenFotos[cat].length ? ordenFotos[cat].map((src, i) => `
                    <div class="ph">
                        <button type="button" class="ph-img" onclick="verFotoOrden('${cat}',${i})" aria-label="Ampliar foto ${i + 1}"><img src="${esc(src)}" alt="Foto ${cat} ${i + 1}"></button>
                        <button type="button" class="ph-del" onclick="quitarFotoOrden('${cat}',${i})" aria-label="Eliminar foto ${i + 1}"><i class="fa-solid fa-trash"></i></button>
                        <span class="ph-n">${i + 1}</span>
                    </div>`).join('') : '<div class="ph-empty"><i class="fa-solid fa-camera"></i> Sin fotos</div>';
            });
            const total = ordenFotos.antes.length + ordenFotos.despues.length;
            const label = document.getElementById('ph-total');
            if (label) label.textContent = total + '/' + ordenMaxFotos;
            tempPhotosList = [...ordenFotos.antes, ...ordenFotos.despues];
            const oldCount = document.getElementById('exec-photos-count');
            if (oldCount) oldCount.textContent = total + '/5';
            const legacyPreview = document.getElementById('exec-photos-preview');
            if (legacyPreview) legacyPreview.innerHTML = ordenFotos.antes.length ? ordenFotos.antes.map((src, i) => `
                <div class="ph">
                    <button type="button" class="ph-img" onclick="verFotoOrden('antes',${i})" aria-label="Ampliar foto ${i + 1}"><img src="${esc(src)}" alt="Foto de evidencia ${i + 1}"></button>
                    <button type="button" class="ph-del" onclick="quitarFotoOrden('antes',${i})" aria-label="Eliminar foto ${i + 1}"><i class="fa-solid fa-trash"></i></button>
                    <span class="ph-n">${i + 1}</span>
                </div>`).join('') : '<div class="ph-empty"><i class="fa-solid fa-camera"></i> Aún no hay fotos de evidencia</div>';
        }
        async function ordenAgregarFotos(cat, files) {
            if (cat !== 'antes' && cat !== 'despues') {
                showToast('Categoría de foto no válida.', 'error');
                return;
            }

            const selectedFiles = Array.from(files || []);
            if (!selectedFiles.length) return;

            const currentTotal = ordenFotos.antes.length + ordenFotos.despues.length;
            const available = Math.max(0, ordenMaxFotos - currentTotal - ordenFotosEnProceso);

            if (!available) {
                showToast(ordenMaxFotos === 5 ? 'Máximo 5 fotos de evidencia.' : 'Máximo 8 fotos entre Antes y Después.', 'error');
                return;
            }

            // Se recortan los archivos ANTES de iniciar cualquier compresión/subida.
            const selected = selectedFiles.slice(0, available);
            if (selected.length < selectedFiles.length) {
                showToast(`Se procesarán ${selected.length} fotos; el límite de esta rutina es ${ordenMaxFotos}.`, 'error');
            }

            // Reserva los cupos antes del primer await para evitar exceder el límite
            // si el usuario dispara dos inputs mientras la primera tanda sigue trabajando.
            ordenFotosEnProceso += selected.length;
            appBusyStart('Comprimiendo y subiendo fotos…');

            try {
                // Todas las fotos se comprimen y envían a R2 concurrentemente.
                // Promise.all conserva el orden original de selección en el resultado.
                const results = await Promise.all(selected.map(async (file, index) => {
                    try {
                        const base64 = await compressImage(file, 800, 0.65, undefined, true);
                        const stored = await r2keep(base64, 'reportes');
                        if (!stored) throw new Error('R2 no devolvió una referencia para la imagen.');
                        return { index, value: stored };
                    } catch (error) {
                        console.warn('[Fotos] No se agregó la imagen:', error);
                        return { index, value: null };
                    }
                }));

                results
                    .filter(item => item.value)
                    .sort((a, b) => a.index - b.index)
                    .forEach(item => ordenFotos[cat].push(item.value));

                // Un solo repintado después de completar la tanda.
                ordenRenderFotos();

                const failed = results.filter(item => !item.value).length;
                if (failed) showToast(`${failed} foto(s) no pudieron procesarse o subirse.`, 'error');

            } finally {
                ordenFotosEnProceso = Math.max(0, ordenFotosEnProceso - selected.length);
                appBusyEnd();
            }
        }
        window.ordenAgregarFotos = ordenAgregarFotos;

        // Cámara y galería utilizan el mismo flujo paralelo y respetan el cupo disponible.
        document.querySelectorAll('#ph-antes-cam, #ph-antes-gal, #ph-despues-cam, #ph-despues-gal, #exec-preventivo-photos-cam, #exec-preventivo-photos').forEach(inp => {
            if (inp.dataset.hvacFotosBound === '1') return;
            inp.dataset.hvacFotosBound = '1';
            inp.addEventListener('change', async e => {
                const input = e.currentTarget;
                const files = Array.from(input.files || []);
                // Se limpia antes del await para permitir seleccionar de nuevo el mismo archivo.
                input.value = '';
                if (files.length) await ordenAgregarFotos(input.dataset.phCat, files);
            });
        });
        window.quitarFotoOrden = (cat, i) => { if (ordenFotos[cat]) ordenFotos[cat].splice(i, 1); ordenRenderFotos(); };
        window.verFotoOrden = (cat, i) => {
            const img = document.getElementById('receipt-viewer-img');
            const box = document.getElementById('receipt-viewer-modal-backdrop');
            if (!img || !box || !ordenFotos[cat] || !ordenFotos[cat][i]) return;
            img.src = ordenFotos[cat][i]; box.classList.remove('hidden');
        };
        // El flujo original invoca este nombre al abrir y al cambiar el correctivo.
        renderExecPhotosPreview = ordenRenderFotos;

        const ordenOpenOriginal = openEquipmentExecutionModal;
        openEquipmentExecutionModal = function(orderId, eqId) {
            ordenOpenOriginal.apply(this, arguments);
            const order = workOrders.find(o => o.id === orderId);
            const eq = techFindEq(eqId) || { code: eqId };
            const exec = (order && order.executions && (order.executions[eqId] || order.executions[eq.code])) || {};
            const routineRaw = String(
                order?.tipoRutina || order?.maintenanceType || order?.routineType || order?.type || exec?.tipoRutina || 'PREVENTIVO'
            ).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
            const plannedType = ['COR', 'CORRECTIVO', 'CORRECTIVA'].includes(routineRaw) ? 'CORRECTIVO'
                : ['REV', 'REVISION'].includes(routineRaw) ? 'REVISION'
                : 'PREVENTIVO';
            const isCorrectiveRoutine = plannedType === 'CORRECTIVO';
            const radio = document.querySelector(`input[name="exec-tipo-rutina"][value="${plannedType}"]`);
            if (radio) radio.checked = true;
            const typeNames = { PREVENTIVO: 'Preventivo', CORRECTIVO: 'Correctivo', REVISION: 'Revisión' };
            const typeLabel = document.getElementById('exec-tipo-fijo-nombre');
            if (typeLabel) typeLabel.textContent = typeNames[plannedType] || 'Preventivo';
            document.getElementById('exec-f-voltaje').value = exec.voltaje || '';
            document.getElementById('exec-f-amperaje').value = exec.amperaje || '';
            document.getElementById('exec-f-presion').value = exec.presionOtros || '';
            document.getElementById('exec-f-notas-analiticas').value = exec.notasAnaliticas || '';
            document.getElementById('exec-f-conclusion').value = exec.conclusion || '';
            ['exec-f-notas-analiticas', 'exec-f-conclusion'].forEach(id => { const el = document.getElementById(id); el.dataset.edited = el.value.trim() ? '1' : ''; });
            if (typeof dictStop === 'function' && DICT.active) dictStop();
            ordenFotos.antes = [...(exec.fotosAntes || exec.photos || [])];
            ordenFotos.despues = [...(exec.fotosDespues || [])];
            // En preventivo se conserva la experiencia clásica: un solo bloque de evidencia (máx. 5 fotos).
            const isPreventivo = plannedType === 'PREVENTIVO';
            const show = (id, visible) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !visible); };
            // En una rutina CORRECTIVA, la necesidad del correctivo ya está definida por la orden.
            // También se oculta el campo independiente: el técnico describe lo ejecutado en "Notas del técnico".
            show('exec-correctivo-flag-section', !isCorrectiveRoutine);
            // En REVISIÓN tampoco aplica: la redacción sale de "Notas del técnico" -> Procesar notas.
            const isRevisionRoutine = plannedType === 'REVISION';
            show('exec-observaciones-tecnicas-field', !isCorrectiveRoutine && !isRevisionRoutine);
            if (isRevisionRoutine) {
                const revTechObs = document.getElementById('exec-f-observaciones-tecnicas');
                if (revTechObs) revTechObs.value = '';
            }
            if (isCorrectiveRoutine) {
                const correctiveFlag = document.getElementById('exec-chk-correctivo');
                const correctiveDescription = document.getElementById('exec-corrective-desc');
                const correctiveDetails = document.getElementById('corrective-details-box');
                if (correctiveFlag) correctiveFlag.checked = false;
                if (correctiveDescription) correctiveDescription.value = '';
                if (correctiveDetails) correctiveDetails.classList.add('hidden');
                const technicalObs = document.getElementById('exec-f-observaciones-tecnicas');
                if (technicalObs) technicalObs.value = '';
            }
            show('exec-tipo-rutina-extra', !isPreventivo);
            show('exec-lecturas-extra', !isPreventivo);
            show('exec-notas-extra', !isPreventivo);
            show('exec-fotos-extra', !isPreventivo);
            show('exec-fotos-preventivo', isPreventivo);
            const obs = document.getElementById('exec-f-obs');
            if (obs && isPreventivo) { obs.rows = 3; obs.placeholder = 'Estado del equipo, recomendaciones o partes a reemplazar…'; }
            else if (obs) { obs.rows = 4; obs.placeholder = 'Escribe rápido o toca el micrófono y cuenta qué encontraste y qué hiciste…'; }
            ordenMaxFotos = isPreventivo ? 5 : 8;
            if (isPreventivo) ordenFotos.despues = [];
            ordenRenderFotos();
            ordenAplicarTipo();
            const corrBox = document.getElementById('corrective-details-box');
            if (corrBox) corrBox.classList.toggle('hidden', !document.getElementById('exec-chk-correctivo').checked);
        };

        const ordenPersistOriginal = persistOrderLocallyAndSync;
        persistOrderLocallyAndSync = function(order) {
            const eq = techFindEq(currentExecEqId);
            const key = currentExecEqId;
            const e = order && order.executions && (order.executions[key] || (eq && order.executions[eq.code]));
            if (e) {
                e.tipoRutina = ordenTipoActual();
                e.voltaje = document.getElementById('exec-f-voltaje').value.trim();
                e.amperaje = document.getElementById('exec-f-amperaje').value.trim();
                e.presionOtros = document.getElementById('exec-f-presion').value.trim();
                e.notasAnaliticas = document.getElementById('exec-f-notas-analiticas').value.trim();
                e.conclusion = document.getElementById('exec-f-conclusion').value.trim();
                const technicalObsInput = document.getElementById('exec-f-observaciones-tecnicas');
                if (e.tipoRutina === 'REVISION') {
                    if (technicalObsInput) technicalObsInput.value = '';
                    e.observaciones_tecnicas = '';
                } else if (e.tipoRutina === 'CORRECTIVO') {
                    if (technicalObsInput) technicalObsInput.value = '';
                    e.observaciones_tecnicas = '';
                    e.corrective = false;
                    e.correctiveDesc = '';
                } else if (technicalObsInput) {
                    e.observaciones_tecnicas = String(technicalObsInput.value || '').trim();
                }
                e.fotosAntes = [...ordenFotos.antes];
                e.fotosDespues = [...ordenFotos.despues];
                e.photos = [...ordenFotos.antes, ...ordenFotos.despues];
                const missing = ordenLecturas.filter(([k]) => !String(e[k] || '').trim()).map(([, label]) => label);
                if (e.tipoRutina !== 'PREVENTIVO') {
                    e.formConfigSnapshot = { ...(e.formConfigSnapshot || {}), params: '', checklist: '' };
                    e.paramsValues = {};
                    e.checklist = {};
                    e.partial = missing.length > 0;
                } else {
                    // En preventivo las lecturas adicionales están ocultas y NO son obligatorias.
                    // Se conserva únicamente el resultado calculado por los campos clásicos.
                    e.partial = !!e.partial;
                }
                order.tipoRutina = e.tipoRutina;
            }
            return ordenPersistOriginal.apply(this, arguments);
        };


        // En Correctivo/Revisión los campos dinámicos no son obligatorios; se neutralizan
        // solo durante el guardado original y luego se restauran en el formulario.
        const ordenSaveOriginal = saveEquipmentExecution;
        saveEquipmentExecution = async function() {
            if (ordenTipoActual() === 'PREVENTIVO') return ordenSaveOriginal.apply(this, arguments);
            const inputs = Array.from(document.querySelectorAll('.exec-param-input'));
            const checks = Array.from(document.querySelectorAll('.exec-chk-input'));
            const oldValues = inputs.map(el => el.value);
            const oldChecks = checks.map(el => el.checked);
            inputs.forEach(el => { if (!String(el.value || '').trim()) el.value = 'N/A'; });
            checks.forEach(el => { el.checked = true; });
            try { return await ordenSaveOriginal.apply(this, arguments); }
            finally {
                inputs.forEach((el, i) => { el.value = oldValues[i]; });
                checks.forEach((el, i) => { el.checked = oldChecks[i]; });
            }
        };

        const ordenMetricsOriginal = getTechChecklistMetrics;
        getTechChecklistMetrics = function(eq, exec) {
            if (!exec || !exec.tipoRutina) return ordenMetricsOriginal.apply(this, arguments);
            // El preventivo utiliza exclusivamente los parámetros y el checklist clásicos.
            // No sumar Voltaje/Amperaje/Presión porque esos campos no aparecen en su formulario.
            if (exec.tipoRutina === 'PREVENTIVO') return ordenMetricsOriginal(eq, exec);
            const normalized = { ...exec, formConfigSnapshot: { ...(exec.formConfigSnapshot || {}), params: '', checklist: '' } };
            const m = ordenMetricsOriginal(eq, normalized);
            const missing = ordenLecturas.filter(([k]) => !String(exec[k] || '').trim()).map(([, label]) => label);
            const total = m.total + ordenLecturas.length;
            const done = m.done + ordenLecturas.length - missing.length;
            return { done, total, missing: [...m.missing, ...missing], percent: total ? Math.round(done / total * 100) : 0 };
        };
        const ordenStatusOriginal = getEquipmentExecutionStatus;
        getEquipmentExecutionStatus = function(eq, eqId, exec) {
            if (!exec || !exec.timestamp) return 'pending';
            if (!exec.tipoRutina) return ordenStatusOriginal.apply(this, arguments);
            // Para preventivo, el estado depende solo de sus parámetros y checklist originales.
            if (exec.tipoRutina === 'PREVENTIVO') return ordenStatusOriginal(eq, eqId, exec);
            const normalized = { ...exec, formConfigSnapshot: { ...(exec.formConfigSnapshot || {}), params: '', checklist: '' } };
            const base = ordenStatusOriginal(eq, eqId, normalized);
            const missing = ordenLecturas.some(([k]) => !String(exec[k] || '').trim());
            if (base === 'pending' && ordenLecturas.every(([k]) => !String(exec[k] || '').trim())) return 'pending';
            return !missing ? 'done' : 'progress';
        };

        // Firma de cliente: conserva el modal existente y adapta el canvas a pantallas HiDPI y Pointer Events.
        const ordenInitFirmaOriginal = initSignatureCanvas;
        initSignatureCanvas = function() {
            sigCanvas = document.getElementById('global-sig-canvas');
            if (!sigCanvas) return;
            sigCtx = sigCanvas.getContext('2d');
            const ajustar = () => {
                const rect = sigCanvas.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                const dpr = window.devicePixelRatio || 1;
                sigCanvas.width = Math.round(rect.width * dpr);
                sigCanvas.height = Math.round(rect.height * dpr);
                sigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                sigCtx.strokeStyle = '#0f172a'; sigCtx.lineWidth = 2.5; sigCtx.lineCap = 'round'; sigCtx.lineJoin = 'round';
                ordenFirmaVacia = true;
            };
            ajustar();
            ordenFirmaRedimensionar = ajustar;
            let drawing = false;
            const pos = e => { const r = sigCanvas.getBoundingClientRect(); return { x: e.clientX-r.left, y: e.clientY-r.top }; };
            sigCanvas.onpointerdown = e => { e.preventDefault(); sigCanvas.setPointerCapture(e.pointerId); drawing = true; ordenFirmaVacia = false; const p=pos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x,p.y); sigCtx.lineTo(p.x+.1,p.y+.1); sigCtx.stroke(); };
            sigCanvas.onpointermove = e => { if (!drawing) return; const p=pos(e); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); };
            sigCanvas.onpointerup = sigCanvas.onpointercancel = () => { drawing = false; };
        };
        clearSignatureCanvas = function() {
            if (sigCtx && sigCanvas) {
                sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
                ordenFirmaVacia = true;
            }
        };
        const ordenSubmitFirmaOriginal = submitGlobalSignature;
        submitGlobalSignature = async function() {
            if (ordenFirmaVacia) { showToast('El cliente debe firmar antes de confirmar.', 'error'); return; }
            return ordenSubmitFirmaOriginal.apply(this, arguments);
        };
        ordenRenderFotos();
        })();

        window.addEventListener('DOMContentLoaded', async () => {
            await hvacStorageReady;
            await hvacFlushStorageWrites();
            restoreLocalAppData();
            const hasSession = restoreActiveSession();
            if (hasSession) {
                document.getElementById('app-login-screen').classList.add('hidden');
                syncTechUser();
                renderTechAgenda();
            } else {
                syncTechUser();
                document.getElementById('app-login-screen').classList.remove('hidden');
            }
            loadAllCloudData(false);
        });

    