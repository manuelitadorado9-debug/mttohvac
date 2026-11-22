/* ===== Horas Extras · Etapa 3A (detección y clasificación, aprobar/rechazar, cortes) =====
   Solo ADMIN. Usa las funciones SQL ops_ot_* (SQL 05) que validan rol + hash. */
(function () {
    const q = id => document.getElementById(id);
    const me = () => systemUsers.find(u => String(u.id) === String(activeUser));
    const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO');
    const hrs = n => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('es-CO') + ' h';
    const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; };
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const hm = s => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? '—' : d.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }); };
    const TYPES = { diurna: 'Diurna', nocturna: 'Nocturna', dominical: 'Dominical', festiva: 'Festiva' };
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
            if (/could not find the function|PGRST202/i.test(m)) m = 'Falta ejecutar el SQL de la Etapa 3A (05_horas_extras_etapa3A.sql) en Supabase.';
            return { ok: false, msg: m || ('Error ' + r.status) };
        } catch (e) { return { ok: false, msg: 'Sin conexión.' }; }
    }
    const auth = () => { const u = me(); return { p_admin_id: String(u.id), p_hash: u.passwordHash || '' }; };
    const isAdmin = () => { const u = me(); return !!(u && u.role === 'ADMIN'); };

    window.otInit = function () {
        if (!started) { started = true; const t = new Date(), f = new Date(); f.setDate(f.getDate() - 30); q('ot-from').value = iso(f); q('ot-to').value = iso(t); }
        otLoad();
    };

    window.otLoad = async function () {
        const box = q('ot-list'); if (!box) return;
        if (!isAdmin()) { box.innerHTML = '<div class="oc-empty">Solo el administrador puede ver las horas extras.</div>'; return; }
        box.innerHTML = '<div class="oc-empty">Cargando…</div>';
        const r = await rpc('ops_ot_list', Object.assign(auth(), { p_from: q('ot-from').value || null, p_to: q('ot-to').value || null, p_status: q('ot-status').value || null }));
        if (!r.ok) { rows = []; box.innerHTML = '<div class="oc-err">' + esc(r.msg) + '</div>'; q('ot-kpis').innerHTML = ''; return; }
        rows = Array.isArray(r.data) ? r.data : []; render();
    };

    function render() {
        const f = st => rows.filter(x => x.status === st);
        const sumA = (a, k) => a.reduce((s, x) => s + Number(x[k] || 0), 0);
        const pen = f('Pendiente'), apr = f('Aprobado');
        q('ot-kpis').innerHTML =
            '<div class="tr-kpi"><span>Pendientes</span><b>' + pen.length + '</b></div>' +
            '<div class="tr-kpi"><span>Horas pendientes</span><b>' + hrs(sumA(pen, 'hours')) + '</b></div>' +
            '<div class="tr-kpi"><span>Valor pendiente</span><b>' + money(sumA(pen, 'amount')) + '</b></div>' +
            '<div class="tr-kpi"><span>Aprobado</span><b>' + money(sumA(apr, 'amount')) + '</b><span style="text-transform:none;font-weight:700">' + hrs(sumA(apr, 'hours')) + '</span></div>';
        if (!rows.length) { q('ot-list').innerHTML = '<div class="oc-empty">No hay horas extras con estos filtros. Usa «Detectar» para calcularlas desde la asistencia.</div>'; return; }
        const cls = { Pendiente: 'p', Aprobado: 'a', Rechazado: 'r' };
        q('ot-list').innerHTML = '<table class="tr-table"><thead><tr><th>Fecha</th><th>Empleado</th><th>Tipo</th><th>Horario</th><th style="text-align:right">Horas</th><th style="text-align:right">Total</th><th>Estado</th><th></th></tr></thead><tbody>' +
            rows.map(x => '<tr><td>' + dmy(x.work_date) + '</td>' +
                '<td><b>' + esc(x.employee_name) + '</b>' + (x.employee_role ? '<span class="tr-sub">' + esc(x.employee_role) + '</span>' : '') + '</td>' +
                '<td><span class="ot-type ' + esc(x.overtime_type) + '">' + esc(TYPES[x.overtime_type] || x.overtime_type) + '</span></td>' +
                '<td>' + hm(x.start_at) + ' – ' + hm(x.end_at) + '</td>' +
                '<td class="num">' + hrs(x.hours) + '</td>' +
                '<td class="num">' + money(x.amount) + '<span class="tr-sub" style="font-weight:600">' + money(x.rate_value) + '/h</span></td>' +
                '<td><span class="tr-st ' + cls[x.status] + '">' + esc(x.status) + '</span>' + (x.reject_reason ? '<span class="tr-sub">Rechazo: ' + esc(x.reject_reason) + '</span>' : '') + (x.cut_id ? '<span class="tr-sub"><i class="fa-solid fa-lock"></i> En corte</span>' : '') + '</td>' +
                '<td>' + (x.status === 'Pendiente' ? '<div class="tr-act"><button type="button" class="ok" onclick="otDecide(\'' + esc(x.id) + '\',\'Aprobado\')">Aprobar</button><button type="button" class="no" onclick="otDecide(\'' + esc(x.id) + '\',\'Rechazado\')">Rechazar</button></div>' : '') + '</td></tr>').join('') +
            '</tbody></table>';
    }

    window.otDecide = async function (id, decision) {
        if (busy) return;
        let reason = null;
        if (decision === 'Rechazado') {
            reason = prompt('Motivo del rechazo:');
            if (reason === null) return;
            if (!reason.trim()) return showToast('Indica el motivo del rechazo.', 'error');
        }
        busy = true;
        try {
            const r = await rpc('ops_ot_decide', Object.assign(auth(), { p_id: id, p_decision: decision, p_reason: reason }));
            if (!r.ok) return showToast(r.msg, 'error');
            if (typeof registrarAuditoria === 'function') registrarAuditoria('UPDATE', 'hvac_overtime', decision + ' hora extra ' + id);
            showToast(decision === 'Aprobado' ? 'Hora extra aprobada.' : 'Hora extra rechazada.');
        } finally { busy = false; }
        otLoad();
    };

    /* Detección: lee la asistencia del rango, clasifica y crea/actualiza registros Pendientes */
    window.otDetect = async function () {
        if (busy) return;
        if (!isAdmin()) return showToast('Solo el administrador puede detectar horas extras.', 'error');
        const f = q('ot-from').value, t = q('ot-to').value;
        if (!f || !t) return showToast('Indica el rango de fechas.', 'error');
        if (t < f) return showToast('La fecha final no puede ser anterior a la inicial.', 'error');
        if ((new Date(t) - new Date(f)) / 864e5 > 92) return showToast('Máximo 92 días por detección.', 'error');
        const btn = q('ot-detect-btn'); busy = true; if (btn) btn.disabled = true;
        try {
            const r = await rpc('ops_ot_detect', Object.assign(auth(), { p_from: f, p_to: t }));
            if (!r.ok) return showToast(r.msg || 'No se pudo detectar.', 'error');
            const d = r.data || {}, extra = [];
            if (d.updated) extra.push(d.updated + ' pendiente(s) recalculada(s)');
            if (d.duplicates) extra.push(d.duplicates + ' sin cambios');
            if (d.no_rate) extra.push(d.no_rate + ' sin valor en la matriz' + ((d.no_rate_roles || []).length ? ' (cargo: ' + d.no_rate_roles.join(', ') + ')' : ''));
            if (typeof registrarAuditoria === 'function') registrarAuditoria('CREATE', 'hvac_overtime', 'Detección horas extras ' + f + ' a ' + t + ': ' + (d.created || 0) + ' nuevas');
            showToast((d.created ? d.created + ' registro(s) nuevo(s) pendientes de aprobación' : 'No se encontraron horas extras nuevas') + (extra.length ? ' · ' + extra.join(', ') : '') + '.', (d.no_rate ? 'error' : undefined));
        } finally { busy = false; if (btn) btn.disabled = false; }
        q('ot-status').value = 'Pendiente'; otLoad();
    };

    /* Cortes de periodo (kind 'overtime'): cerrar marca los Aprobados con cut_id; revertir los libera */
    let cutDays = { start_day: 26, end_day: 25 };
    const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
    function suggestPeriod() {
        const sd = parseInt(cutDays.start_day, 10) || 26, ed = parseInt(cutDays.end_day, 10) || 25, t = new Date();
        for (let k = 0; k < 4; k++) {
            const e0 = new Date(t.getFullYear(), t.getMonth() - k, 1), y = e0.getFullYear(), m = e0.getMonth();
            const end = new Date(y, m, Math.min(ed, lastDay(y, m)));
            const s0 = sd > ed ? new Date(y, m - 1, 1) : new Date(y, m, 1);
            const start = new Date(s0.getFullYear(), s0.getMonth(), Math.min(sd, lastDay(s0.getFullYear(), s0.getMonth())));
            if (end <= t) return [iso(start), iso(end)];
        }
        return [q('ot-from').value, q('ot-to').value];
    }

    window.otOpenCuts = async function () {
        if (!isAdmin()) return showToast('Solo el administrador puede gestionar cortes.', 'error');
        q('otcut-modal').classList.remove('hidden');
        q('otcut-note').value = '';
        await cutsLoad(true);
    };
    window.otCloseCuts = function () { q('otcut-modal').classList.add('hidden'); };

    async function cutsLoad(setDates) {
        const box = q('otcut-list'); box.innerHTML = '<div class="oc-empty">Cargando…</div>';
        const r = await rpc('ops_ot_cut_list', auth());
        if (!r.ok) { box.innerHTML = '<div class="oc-err">' + esc(r.msg) + '</div>'; return; }
        const d = r.data || {}; cutDays = d.cut_days || cutDays;
        if (setDates) { const p = suggestPeriod(); q('otcut-from').value = p[0]; q('otcut-to').value = p[1]; }
        const cuts = d.cuts || [];
        box.innerHTML = cuts.length ? cuts.map(c => '<div class="oc-row"><div class="l"><b>' + dmy(c.period_start) + ' → ' + dmy(c.period_end) + ' · ' + money(c.total) + '</b>' +
            '<span>' + c.n + ' registro(s) · ' + hrs(c.hours) + ' · cerrado ' + dmy(c.closed_at) + (c.note ? ' · ' + esc(c.note) : '') + '</span></div>' +
            '<div style="display:flex;gap:6px;align-items:center"><span class="oc-badge ' + (c.status === 'pagado' ? 'ok' : 'sch') + '">' + (c.status === 'pagado' ? 'Pagado' : 'Cerrado') + '</span>' +
            (c.status === 'cerrado' ? '<button type="button" class="oc-mini" onclick="otCutRevert(\'' + esc(c.id) + '\')">Revertir</button>' : '') + '</div></div>').join('')
            : '<div class="oc-empty">Aún no hay cortes de horas extras.</div>';
        otCutPreview();
    }

    window.otCutPreview = async function () {
        const f = q('otcut-from').value, t = q('otcut-to').value, box = q('otcut-prev'), btn = q('otcut-btn');
        btn.disabled = true;
        if (!f || !t || t < f) { box.innerHTML = '<span class="tr-warn">Revisa las fechas del periodo.</span>'; return; }
        box.textContent = 'Calculando…';
        const r = await rpc('ops_ot_cut_preview', Object.assign(auth(), { p_from: f, p_to: t }));
        if (f !== q('otcut-from').value || t !== q('otcut-to').value) return;
        if (!r.ok) { box.innerHTML = '<span class="tr-warn">' + esc(r.msg) + '</span>'; return; }
        const d = r.data || {};
        let h = 'Entran al corte: <b>' + d.approved_n + '</b> aprobado(s), <b>' + hrs(d.approved_hours) + '</b> por <b>' + money(d.approved_total) + '</b>.';
        if (d.pending_n > 0) h += '<br><span class="tr-warn">Hay ' + d.pending_n + ' pendiente(s) (' + money(d.pending_total) + ') que NO entrarán. Apruébalos o recházalos antes de cortar.</span>';
        if (d.overlap) h += '<br><span class="tr-warn">Se cruza con el corte del ' + dmy(d.overlap.from) + ' al ' + dmy(d.overlap.to) + '.</span>';
        else if (d.approved_n > 0) btn.disabled = false;
        if (!d.approved_n && !d.overlap) h += '<br><span class="tr-warn">No hay aprobados para cortar en este periodo.</span>';
        box.innerHTML = h;
    };

    window.otCutCreate = async function () {
        if (busy) return;
        const f = q('otcut-from').value, t = q('otcut-to').value;
        if (!f || !t || t < f) return showToast('Revisa las fechas del periodo.', 'error');
        if (!confirm('¿Cerrar el corte del ' + dmy(f) + ' al ' + dmy(t) + '?\nLas horas extras aprobadas quedarán bloqueadas. Podrás revertirlo mientras no esté pagado.')) return;
        busy = true; const btn = q('otcut-btn'); btn.disabled = true;
        try {
            const r = await rpc('ops_ot_cut_create', Object.assign(auth(), { p_from: f, p_to: t, p_note: q('otcut-note').value.trim() || null }));
            if (!r.ok) return showToast(r.msg, 'error');
            const d = r.data || {};
            if (typeof registrarAuditoria === 'function') registrarAuditoria('CREATE', 'operational_cuts', 'Corte horas extras ' + f + ' a ' + t + ': ' + d.count + ' registros');
            showToast('Corte cerrado: ' + d.count + ' registro(s) por ' + money(d.total) + '.' + (d.pending_left ? ' Quedaron ' + d.pending_left + ' pendiente(s) fuera.' : ''));
            q('otcut-note').value = '';
        } finally { busy = false; }
        await cutsLoad(false); otLoad();
    };

    window.otCutRevert = async function (id) {
        if (busy) return;
        if (!confirm('¿Revertir este corte?\nLas horas extras quedarán libres (aprobadas, sin corte) y podrás volver a cortar.')) return;
        busy = true;
        try {
            const r = await rpc('ops_ot_cut_revert', Object.assign(auth(), { p_id: id }));
            if (!r.ok) return showToast(r.msg, 'error');
            if (typeof registrarAuditoria === 'function') registrarAuditoria('UPDATE', 'operational_cuts', 'Corte horas extras revertido ' + id + ': ' + ((r.data || {}).released || 0) + ' liberados');
            showToast('Corte revertido: ' + ((r.data || {}).released || 0) + ' registro(s) liberados.');
        } finally { busy = false; }
        await cutsLoad(false); otLoad();
    };

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && q('otcut-modal') && !q('otcut-modal').classList.contains('hidden')) otCloseCuts(); });
})();
