/* ===== Transportes · Etapas 2A y 2B (tabla, registro manual, aprobar/rechazar y detección por GPS) =====
   Solo ADMIN. Usa las funciones SQL ops_transfer_* (SQL 02) que validan rol + hash. */
(function () {
    const q = id => document.getElementById(id);
    const me = () => systemUsers.find(u => String(u.id) === String(activeUser));
    const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO');
    const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; };
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let rows = [], busy = false, started = false;

    async function rpc(fn, body) {
        try {
            if (window.HVACSec) {
                body = HVACSec.cleanDeep(body);
                if (!(await HVACSec.throttle('POST'))) return { ok: false, msg: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.' };
            }
            const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (r.ok) { let d = null; try { d = await r.json(); } catch (_) {} return { ok: true, data: d }; }
            let m = ''; try { m = (await r.json()).message || ''; } catch (_) {}
            if (/could not find the function|PGRST202/i.test(m)) m = 'Falta ejecutar el SQL de la Etapa 2A/2B (02_transportes_etapa2A.sql y 03_transportes_gps_etapa2B.sql) en Supabase.';
            return { ok: false, msg: m || ('Error ' + r.status) };
        } catch (e) { return { ok: false, msg: 'Sin conexión.' }; }
    }
    const auth = () => { const u = me(); return { p_admin_id: String(u.id), p_hash: u.passwordHash || '' }; };
    const isAdmin = () => { const u = me(); return !!(u && u.role === 'ADMIN'); };

    window.trInit = function () {
        if (!started) { started = true; const t = new Date(), f = new Date(); f.setDate(f.getDate() - 30); q('tr-from').value = iso(f); q('tr-to').value = iso(t); }
        trLoad();
    };

    window.trLoad = async function () {
        const box = q('tr-list'); if (!box) return;
        if (!isAdmin()) { box.innerHTML = '<div class="oc-empty">Solo el administrador puede ver los transportes.</div>'; return; }
        box.innerHTML = '<div class="oc-empty">Cargando…</div>';
        const r = await rpc('ops_transfer_list', Object.assign(auth(), { p_from: q('tr-from').value || null, p_to: q('tr-to').value || null, p_status: q('tr-status').value || null }));
        if (!r.ok) { rows = []; box.innerHTML = '<div class="oc-err">' + esc(r.msg) + '</div>'; q('tr-kpis').innerHTML = ''; return; }
        rows = Array.isArray(r.data) ? r.data : []; render();
    };

    function render() {
        const sum = st => rows.filter(x => x.status === st).reduce((a, x) => a + Number(x.amount || 0), 0);
        const cnt = st => rows.filter(x => x.status === st).length;
        q('tr-kpis').innerHTML =
            '<div class="tr-kpi"><span>Pendientes</span><b>' + cnt('Pendiente') + '</b></div>' +
            '<div class="tr-kpi"><span>Valor pendiente</span><b>' + money(sum('Pendiente')) + '</b></div>' +
            '<div class="tr-kpi"><span>Aprobados</span><b>' + money(sum('Aprobado')) + '</b></div>' +
            '<div class="tr-kpi"><span>Rechazados</span><b>' + cnt('Rechazado') + '</b></div>';
        if (!rows.length) { q('tr-list').innerHTML = '<div class="oc-empty">No hay traslados con estos filtros.</div>'; return; }
        const cls = { Pendiente: 'p', Aprobado: 'a', Rechazado: 'r' };
        const src = { general: 'Tarifa general', especial: 'Tarifa especial', manual: 'Valor manual' };
        q('tr-list').innerHTML = '<table class="tr-table"><thead><tr><th>Fecha</th><th>Empleado</th><th>Origen → Destino</th><th>Motivo</th><th style="text-align:right">Valor</th><th>Estado</th><th></th></tr></thead><tbody>' +
            rows.map(x => '<tr><td>' + dmy(x.work_date) + '<span class="tr-sub">' + (x.source === 'gps' ? 'GPS' : 'Manual') + '</span></td>' +
                '<td><b>' + esc(x.employee_name) + '</b>' + (x.employee_role ? '<span class="tr-sub">' + esc(x.employee_role) + '</span>' : '') + '</td>' +
                '<td>' + esc(x.from_client_name || '—') + ' → ' + esc(x.to_client_name || '—') + '</td>' +
                '<td>' + esc(x.reason || '—') + (x.reject_reason ? '<span class="tr-sub">Rechazo: ' + esc(x.reject_reason) + '</span>' : '') + '</td>' +
                '<td class="num">' + money(x.amount) + '<span class="tr-sub" style="font-weight:600">' + esc(src[x.rate_source] || '') + '</span></td>' +
                '<td><span class="tr-st ' + cls[x.status] + '">' + esc(x.status) + '</span></td>' +
                '<td>' + (x.status === 'Pendiente' ? '<div class="tr-act"><button type="button" class="ok" onclick="trDecide(\'' + esc(x.id) + '\',\'Aprobado\')">Aprobar</button><button type="button" class="no" onclick="trDecide(\'' + esc(x.id) + '\',\'Rechazado\')">Rechazar</button></div>' : '') + '</td></tr>').join('') +
            '</tbody></table>';
    }

    window.trDecide = async function (id, decision) {
        if (busy) return;
        let reason = null;
        if (decision === 'Rechazado') {
            reason = prompt('Motivo del rechazo:');
            if (reason === null) return;
            if (!reason.trim()) return showToast('Indica el motivo del rechazo.', 'error');
        }
        busy = true;
        try {
            const r = await rpc('ops_transfer_decide', Object.assign(auth(), { p_id: id, p_decision: decision, p_reason: reason }));
            if (!r.ok) return showToast(r.msg, 'error');
            if (typeof registrarAuditoria === 'function') registrarAuditoria(decision === 'Aprobado' ? 'UPDATE' : 'UPDATE', 'hvac_transfers', decision + ' traslado ' + id);
            showToast(decision === 'Aprobado' ? 'Traslado aprobado.' : 'Traslado rechazado.');
        } finally { busy = false; }
        trLoad();
    };

    /* 2B · Detección automática: salida en un cliente + entrada en otro (mismo técnico y día). Repetirla no duplica. */
    window.trDetect = async function () {
        if (busy) return;
        if (!isAdmin()) return showToast('Solo el administrador puede detectar traslados.', 'error');
        const f = q('tr-from').value, t = q('tr-to').value, gap = parseInt(q('tr-gap').value, 10) || 180;
        if (!f || !t) return showToast('Indica el rango de fechas.', 'error');
        if (t < f) return showToast('La fecha final no puede ser anterior a la inicial.', 'error');
        if ((new Date(t) - new Date(f)) / 864e5 > 92) return showToast('Máximo 92 días por detección.', 'error');
        const btn = q('tr-detect-btn'); busy = true; if (btn) btn.disabled = true;
        try {
            const r = await rpc('ops_transfers_detect', Object.assign(auth(), { p_from: f, p_to: t, p_max_gap_min: gap }));
            if (!r.ok) return showToast(/could not find the function|PGRST202/i.test(r.msg) ? r.msg : (r.msg || 'No se pudo detectar.'), 'error');
            const d = r.data || {}, extra = [];
            if (d.duplicates) extra.push(d.duplicates + ' ya existían');
            if (d.out_of_range) extra.push(d.out_of_range + ' con marcación fuera de rango');
            if (d.no_rate) extra.push(d.no_rate + ' sin tarifa vigente');
            if (typeof registrarAuditoria === 'function') registrarAuditoria('CREATE', 'hvac_transfers', 'Detección GPS ' + f + ' a ' + t + ': ' + (d.created || 0) + ' nuevos');
            showToast((d.created ? d.created + ' traslado(s) nuevo(s) pendientes de aprobación' : 'No se encontraron traslados nuevos') + (extra.length ? ' · ' + extra.join(', ') : '') + '.', (d.no_rate ? 'error' : undefined));
        } finally { busy = false; if (btn) btn.disabled = false; }
        q('tr-status').value = 'Pendiente'; trLoad();
    };

    window.trOpenNew = function () {
        if (!isAdmin()) return showToast('Solo el administrador puede registrar traslados.', 'error');
        const users = (systemUsers || []).filter(u => u && u.name).sort((a, b) => a.name.localeCompare(b.name, 'es'));
        q('tr-emp').innerHTML = '<option value="">Selecciona…</option>' + users.map(u => '<option value="' + esc(u.id) + '">' + esc(u.name) + (u.role === 'TECH' ? '' : ' (' + esc(u.role) + ')') + '</option>').join('');
        const cli = [...new Map((clientsCatalog || []).filter(c => c && c.name).map(c => [String(c.id), c.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
        const opts = '<option value="">—</option>' + cli.map(c => '<option value="' + esc(c[0]) + '">' + esc(c[1]) + '</option>').join('');
        q('tr-from-cli').innerHTML = opts; q('tr-to-cli').innerHTML = opts;
        q('tr-date').value = iso(new Date()); q('tr-date').max = iso(new Date()); q('tr-amt').value = ''; q('tr-reason').value = '';
        q('tr-modal').classList.remove('hidden');
    };
    window.trCloseNew = function () { q('tr-modal').classList.add('hidden'); };

    window.trSaveNew = async function () {
        if (busy) return;
        const u = (systemUsers || []).find(x => String(x.id) === q('tr-emp').value);
        if (!u) return showToast('Selecciona el empleado.', 'error');
        if (!q('tr-date').value) return showToast('Indica la fecha.', 'error');
        if (!q('tr-reason').value.trim()) return showToast('Indica el motivo del traslado.', 'error');
        const nm = id => { const s = q(id); return s.value ? s.options[s.selectedIndex].text : ''; };
        const amt = parseInt(q('tr-amt').value.replace(/\D/g, ''), 10) || null;
        busy = true;
        try {
            const r = await rpc('ops_transfer_add_manual', Object.assign(auth(), {
                p_employee_id: String(u.id), p_employee_name: u.name, p_employee_role: u.cargo || u.position || u.jobTitle || u.role || '',
                p_work_date: q('tr-date').value, p_reason: q('tr-reason').value.trim(),
                p_from_client_id: q('tr-from-cli').value, p_from_client_name: nm('tr-from-cli'),
                p_to_client_id: q('tr-to-cli').value, p_to_client_name: nm('tr-to-cli'), p_amount: amt }));
            if (!r.ok) return showToast(r.msg, 'error');
            if (typeof registrarAuditoria === 'function') registrarAuditoria('CREATE', 'hvac_transfers', 'Traslado manual de ' + u.name);
            showToast('Traslado registrado. Queda pendiente de aprobación.');
            trCloseNew();
        } finally { busy = false; }
        q('tr-status').value = 'Pendiente'; trLoad();
    };

    document.addEventListener('DOMContentLoaded', () => { const a = q('tr-amt'); if (a) a.addEventListener('input', () => { const n = parseInt(a.value.replace(/\D/g, ''), 10) || 0; a.value = n ? n.toLocaleString('es-CO') : ''; }); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && q('tr-modal') && !q('tr-modal').classList.contains('hidden')) trCloseNew(); });
})();
