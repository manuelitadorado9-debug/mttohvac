/* ===== Configuración Operativa · Etapa 1B (modal + subsección Transportes) =====
   Solo ADMIN. Todo pasa por las funciones SQL ops_* de la Etapa 1A (validan rol + hash). */
(function () {
    const q = id => document.getElementById(id);
    const me = () => systemUsers.find(u => String(u.id) === String(activeUser));
    const isAdmin = () => { const u = me(); return !!(u && u.role === 'ADMIN'); };
    const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO');
    const parseMoney = s => parseInt(String(s || '').replace(/\D/g, ''), 10) || 0;
    const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; };
    const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    let cfg = null, busy = false, tab = 'transport';

    async function rpc(fn, body) {
        try {
            if (window.HVACSec) {
                if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(String(fn))) return { ok: false, msg: 'Función no permitida.' };
                body = HVACSec.cleanDeep(body);
                if (!(await HVACSec.throttle('POST'))) return { ok: false, msg: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.' };
            }
            const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (r.ok) { let d = null; try { d = await r.json(); } catch (_) {} return { ok: true, data: d }; }
            let m = ''; try { m = (await r.json()).message || ''; } catch (_) {}
            if (/could not find the function|PGRST202/i.test(m)) m = 'Falta el SQL de la Etapa 1A en Supabase. Ejecútalo primero.';
            return { ok: false, msg: m || ('Error ' + r.status) };
        } catch (e) { return { ok: false, msg: 'Sin conexión.' }; }
    }
    const auth = () => { const u = me(); return { p_admin_id: String(u.id), p_hash: u.passwordHash || '' }; };

    async function load() {
        const body = q('ops-cfg-body'); body.innerHTML = '<div class="oc-empty">Cargando…</div>';
        const r = await rpc('ops_config_get', auth());
        if (!r.ok) { cfg = null; body.innerHTML = '<div class="oc-err">' + esc(r.msg) + '</div>'; return; }
        cfg = r.data || {}; render();
    }

    function render() {
        document.querySelectorAll('#ops-cfg-modal .oc-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
        if (!cfg) return;
        if (tab === 'transport') renderTransport();
    }

    function renderTransport() {
        const t = today(), gen = cfg.transport_rates || [], cli = cfg.client_rates || [];
        const cur = gen.find(r => r.effective_date <= t);
        const genRows = gen.map(r => {
            const b = cur && r.id === cur.id ? '<span class="oc-badge ok">Vigente</span>' : r.effective_date > t ? '<span class="oc-badge sch">Programada</span>' : '<span class="oc-badge">Anterior</span>';
            return '<div class="oc-row"><div class="l"><b>' + money(r.amount) + '</b><span>Desde ' + dmy(r.effective_date) + '</span></div>' + b + '</div>';
        }).join('') || '<div class="oc-empty">Aún no hay tarifa general. Agrega la primera.</div>';

        // Por cliente: la vigente es la más reciente con fecha <= hoy (misma regla que ops_resolve_transport_rate)
        const curByClient = {};
        cli.forEach(r => { if (r.effective_date <= t && (!curByClient[r.client_id] || r.effective_date > curByClient[r.client_id].effective_date)) curByClient[r.client_id] = r; });
        const cliRows = cli.map(r => {
            const isCur = curByClient[r.client_id] && curByClient[r.client_id].id === r.id;
            let b = r.effective_date > t ? '<span class="oc-badge sch">Programada</span>' : isCur ? (r.active ? '<span class="oc-badge ok">Vigente</span>' : '<span class="oc-badge off">Inactiva</span>') : '<span class="oc-badge">Anterior</span>';
            const btn = isCur ? '<button type="button" class="oc-mini" data-act="cli-toggle" data-id="' + esc(r.id) + '" data-active="' + (r.active ? '0' : '1') + '">' + (r.active ? 'Desactivar' : 'Activar') + '</button>' : '';
            return '<div class="oc-row"><div class="l"><b>' + esc(r.client_name) + ' · ' + money(r.amount) + '</b><span>Desde ' + dmy(r.effective_date) + (r.notes ? ' · ' + esc(r.notes) : '') + '</span></div><div style="display:flex;gap:6px;align-items:center">' + b + btn + '</div></div>';
        }).join('') || '<div class="oc-empty">Sin tarifas especiales. Los traslados usan la tarifa general.</div>';

        const names = [...new Map(clientsCatalog.filter(c => c && c.name).map(c => [String(c.id), c.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
        q('ops-cfg-body').innerHTML =
            '<div class="oc-card"><h4><i class="fa-solid fa-route"></i> Tarifa general de transporte</h4>' +
            '<div class="oc-now"><b>' + (cur ? money(cur.amount) : 'Sin definir') + '</b><span class="oc-hint">' + (cur ? 'vigente desde ' + dmy(cur.effective_date) : 'por traslado') + '</span></div>' +
            '<div class="oc-form"><div><label>Nuevo valor (COP)</label><input id="oc-g-amt" class="input-box text-xs" inputmode="numeric" placeholder="Ej: 15.000" autocomplete="off"></div>' +
            '<div><label>Vigente desde</label><input id="oc-g-date" type="date" class="input-box text-xs" value="' + t + '"></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="gen-add"><i class="fa-solid fa-plus"></i> Agregar tarifa</button></div></div>' +
            '<div class="oc-hint">El histórico se conserva: cada traslado usa la tarifa vigente en su fecha.</div>' + genRows + '</div>' +
            '<div class="oc-card"><h4><i class="fa-solid fa-location-dot"></i> Tarifas especiales por cliente / destino</h4>' +
            '<div class="oc-form"><div class="full"><label>Cliente</label><select id="oc-c-cli" class="input-box text-xs"><option value="">Selecciona…</option>' + names.map(n => '<option value="' + esc(n[0]) + '">' + esc(n[1]) + '</option>').join('') + '</select></div>' +
            '<div><label>Valor (COP)</label><input id="oc-c-amt" class="input-box text-xs" inputmode="numeric" placeholder="Ej: 25.000" autocomplete="off"></div>' +
            '<div><label>Vigente desde</label><input id="oc-c-date" type="date" class="input-box text-xs" value="' + t + '"></div>' +
            '<div class="full"><label>Nota (opcional)</label><input id="oc-c-notes" class="input-box text-xs" maxlength="160" placeholder="Ej: Sede lejana"></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="cli-set"><i class="fa-solid fa-floppy-disk"></i> Guardar tarifa especial</button></div></div>' +
            '<div class="oc-hint">Si el cliente ya tiene tarifa con esa fecha, se actualiza. Una tarifa especial desactivada vuelve a la general.</div>' + cliRows + '</div>';
        ['oc-g-amt', 'oc-c-amt'].forEach(id => { const el = q(id); if (el) el.addEventListener('input', () => { const n = parseMoney(el.value); el.value = n ? n.toLocaleString('es-CO') : ''; }); });
    }

    async function run(fn, body, okMsg, audit) {
        if (busy) return; busy = true;
        try {
            const r = await rpc(fn, Object.assign(auth(), body));
            if (!r.ok) return showToast(r.msg, 'error');
            if (audit) registrarAuditoria(audit[0], audit[1], audit[2] || '');
            showToast(okMsg); await load();
        } finally { busy = false; }
    }

    function onClick(e) {
        const b = e.target.closest('[data-act]'); if (!b || !isAdmin()) return;
        const act = b.dataset.act, t = today();
        if (act === 'gen-add') {
            const amt = parseMoney(q('oc-g-amt').value), date = q('oc-g-date').value;
            if (amt <= 0) return showToast('El valor debe ser mayor que cero.', 'error');
            if (!date) return showToast('Indica la fecha de vigencia.', 'error');
            if (date < t && !confirm('La fecha es anterior a hoy. Los traslados pendientes de ese periodo se calcularán con esta tarifa. ¿Continuar?')) return;
            run('ops_transport_rate_add', { p_amount: amt, p_effective_date: date }, 'Tarifa general agregada.', ['INSERT', 'transport_rates']);
        } else if (act === 'cli-set') {
            const id = q('oc-c-cli').value, amt = parseMoney(q('oc-c-amt').value), date = q('oc-c-date').value;
            const c = clientsCatalog.find(x => String(x.id) === id);
            if (!id || !c) return showToast('Selecciona un cliente.', 'error');
            if (amt <= 0) return showToast('El valor debe ser mayor que cero.', 'error');
            if (!date) return showToast('Indica la fecha de vigencia.', 'error');
            if (date < t && !confirm('La fecha es anterior a hoy. ¿Continuar?')) return;
            run('ops_client_rate_set', { p_client_id: id, p_client_name: c.name, p_amount: amt, p_effective_date: date, p_notes: q('oc-c-notes').value.trim() || null }, 'Tarifa especial guardada.', ['UPSERT', 'client_transport_rates', id]);
        } else if (act === 'cli-toggle') {
            const on = b.dataset.active === '1';
            run('ops_client_rate_active', { p_id: b.dataset.id, p_active: on }, on ? 'Tarifa activada.' : 'Tarifa desactivada.', ['UPDATE', 'client_transport_rates', b.dataset.id]);
        }
    }

    window.opsCfgOpen = function () {
        if (!isAdmin()) return showToast('Solo el administrador puede abrir la configuración operativa.', 'error');
        q('ops-cfg-modal').classList.remove('hidden'); load();
    };
    window.opsCfgClose = function () { q('ops-cfg-modal').classList.add('hidden'); };
    window.opsCfgTab = function (t) { tab = t; render(); };
    document.addEventListener('DOMContentLoaded', () => { const m = q('ops-cfg-modal'); if (m) m.addEventListener('click', onClick); });
    if (document.readyState !== 'loading') { const m = q('ops-cfg-modal'); if (m) m.addEventListener('click', onClick); }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && q('ops-cfg-modal') && !q('ops-cfg-modal').classList.contains('hidden')) window.opsCfgClose(); });
})();
