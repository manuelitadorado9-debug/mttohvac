/* ===== Validar marcaciones · Etapa 5 =====
   Solo ADMIN. Simula (sin guardar) lo que traería la detección de Horas Extras y Transportes
   para un rango de fechas, y permite traerlo con un clic. Usa ops_marks_validate (SQL 09). */
(function () {
    const q = id => document.getElementById(id);
    const me = () => systemUsers.find(u => String(u.id) === String(activeUser));
    const isAdmin = () => { const u = me(); return !!(u && u.role === 'ADMIN'); };
    const auth = () => { const u = me(); return { p_admin_id: String(u.id), p_hash: u.passwordHash || '' }; };
    const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO');
    const nf = n => Number(n || 0).toLocaleString('es-CO');
    const hrs = n => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('es-CO') + ' h';
    const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; };
    const TYPES = { diurna: 'Diurna', nocturna: 'Nocturna', dominical: 'Dominical', festiva: 'Festiva' };
    const ST = { nuevo: ['Nuevo', 'ok'], actualiza: ['Actualiza', 'sch'], existente: ['Ya existe', ''], sin_valor: ['Sin valor', 'off'], sin_tarifa: ['Sin tarifa', 'off'], fuera_rango: ['Fuera de rango', 'off'] };
    let last = null, busy = false, view = 'ot';

    async function rpc(fn, body) {
        try {
            if (window.HVACSec) {
                body = HVACSec.cleanDeep(body);
                if (!(await HVACSec.throttle('POST'))) return { ok: false, msg: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.' };
            }
            const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (r.ok) { let d = null; try { d = await r.json(); } catch (_) {} return { ok: true, data: d }; }
            let m = ''; try { m = (await r.json()).message || ''; } catch (_) {}
            if (/could not find the function|PGRST202/i.test(m)) m = 'Falta ejecutar el SQL 09 (validar marcaciones) en Supabase.';
            return { ok: false, msg: m || ('Error ' + r.status) };
        } catch (e) { return { ok: false, msg: 'Sin conexión.' }; }
    }
    const badge = s => { const b = ST[s] || [s, '']; return '<span class="oc-badge ' + b[1] + '">' + b[0] + '</span>'; };
    const kpi = (l, v, sub) => '<div class="vm-kpi"><small>' + l + '</small><b>' + v + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>';

    window.vmOpen = function (from) {
        if (!isAdmin()) return showToast('Solo el administrador puede validar marcaciones.', 'error');
        const src = from === 'tr' ? 'tr' : 'ot';
        view = src;
        const f = (q(src + '-from') || {}).value, t = (q(src + '-to') || {}).value;
        if (f && !q('vm-from').value) q('vm-from').value = f;
        if (t && !q('vm-to').value) q('vm-to').value = t;
        const g = q('tr-gap'); if (g) q('vm-gap').value = g.value;
        q('vm-modal').classList.remove('hidden');
        if (!last) q('vm-body').innerHTML = '<div class="oc-empty">Elige el rango de fechas y pulsa «Validar». No se guarda nada hasta que decidas traerlo.</div>';
        else render();
    };
    window.vmClose = function () { q('vm-modal').classList.add('hidden'); };
    window.vmTab = function (v) { view = v; render(); };

    window.vmRun = async function () {
        if (busy) return;
        const f = q('vm-from').value, t = q('vm-to').value, gap = parseInt(q('vm-gap').value, 10) || 180;
        if (!f || !t) return showToast('Indica el rango de fechas.', 'error');
        if (t < f) return showToast('La fecha final no puede ser anterior a la inicial.', 'error');
        if ((new Date(t) - new Date(f)) / 864e5 > 92) return showToast('Máximo 92 días por validación.', 'error');
        busy = true; const btn = q('vm-run'); btn.disabled = true;
        q('vm-body').innerHTML = '<div class="oc-empty">Validando marcaciones…</div>';
        try {
            const r = await rpc('ops_marks_validate', Object.assign(auth(), { p_from: f, p_to: t, p_max_gap_min: gap }));
            if (!r.ok) { last = null; q('vm-body').innerHTML = '<div class="oc-err">' + esc(r.msg) + '</div>'; return; }
            last = r.data || {}; render();
        } finally { busy = false; btn.disabled = false; }
    };

    function render() {
        if (!last) return;
        const m = last.marks || {}, o = last.overtime || {}, tr = last.transfers || {}, s = last.schedule || {};
        document.querySelectorAll('#vm-modal .oc-tab').forEach(b => b.classList.toggle('on', b.dataset.v === view));
        let h = '<div class="vm-grid">' + kpi('Marcaciones', nf(m.total), nf(m.technicians) + ' técnico(s) · ' + nf(m.days) + ' día(s)') +
            kpi('Entradas / salidas', nf(m.check_in) + ' / ' + nf(m.check_out)) +
            kpi('Fuera de rango', nf(m.out_of_range), 'no se tienen en cuenta') +
            kpi('Entradas sin salida', nf(m.unpaired), 'no generan horas') + '</div>';
        if (m.unpaired > 0 || m.out_of_range > 0) h += '<div class="oc-hint">Revisa las marcaciones sin pareja o fuera de rango: pueden dejar horas o traslados sin contar.</div>';
        if (view === 'ot') {
            h += '<div class="vm-grid">' + kpi('A crear', nf(o.new)) + kpi('A recalcular', nf(o.update)) + kpi('Ya existentes', nf(o.existing)) + kpi('Estimado', money(o.amount), hrs(o.hours)) + '</div>';
            const by = Object.keys(o.by_type || {}).map(k => (TYPES[k] || k) + ': <b>' + hrs(o.by_type[k]) + '</b>').join(' · ');
            if (by) h += '<div class="oc-hint">' + by + ' · Jornada hasta ' + esc(String(s.workday_end || '').slice(0, 5)) + ' (tolerancia ' + esc(String(s.tolerance_end || '').slice(0, 5)) + ')</div>';
            if (o.no_rate) h += '<div class="oc-err">' + nf(o.no_rate) + ' registro(s) sin valor en la matriz' + ((o.no_rate_roles || []).length ? ' (cargo: ' + esc(o.no_rate_roles.join(', ')) + ')' : '') + '. Defínelos en Configuración › Horas extra.</div>';
            const d = o.detail || [];
            h += d.length ? '<div class="vm-list">' + d.map(x => '<div class="oc-row"><div class="l"><b>' + esc(x.name) + ' · ' + (TYPES[x.type] || esc(x.type)) + '</b><span>' + dmy(x.date) + ' · ' + hrs(x.hours) + (x.role ? ' · ' + esc(x.role) : '') + '</span></div><div style="display:flex;gap:8px;align-items:center"><b>' + (x.amount ? money(x.amount) : '') + '</b>' + badge(x.status) + '</div></div>').join('') + '</div>' + (o.truncated ? '<div class="oc-hint">Se muestran los primeros 150 registros.</div>' : '') : '<div class="oc-empty">No hay horas extras en este rango.</div>';
            h += '<div class="vm-actions"><button type="button" class="mx-btn mx-btn-pri" onclick="vmImport(\'ot\')"' + ((o.new || o.update) ? '' : ' disabled') + '><i class="fa-solid fa-download"></i> Traer horas extras (' + nf((o.new || 0) + (o.update || 0)) + ')</button></div>';
        } else {
            h += '<div class="vm-grid">' + kpi('Pares detectados', nf(tr.pairs)) + kpi('A crear', nf(tr.new)) + kpi('Ya existentes', nf(tr.existing)) + kpi('Estimado', money(tr.amount)) + '</div>';
            if (tr.no_rate) h += '<div class="oc-err">' + nf(tr.no_rate) + ' traslado(s) sin tarifa vigente. Defínela en Configuración › Transportes.</div>';
            if (tr.out_of_range) h += '<div class="oc-hint">' + nf(tr.out_of_range) + ' traslado(s) con marcación fuera de rango (se omiten).</div>';
            const d = tr.detail || [];
            h += d.length ? '<div class="vm-list">' + d.map(x => '<div class="oc-row"><div class="l"><b>' + esc(x.name) + '</b><span>' + dmy(x.date) + ' · ' + esc(x.from || '—') + ' → ' + esc(x.to || '—') + '</span></div><div style="display:flex;gap:8px;align-items:center"><b>' + (x.amount ? money(x.amount) : '') + '</b>' + badge(x.status) + '</div></div>').join('') + '</div>' + (tr.truncated ? '<div class="oc-hint">Se muestran los primeros 150 traslados.</div>' : '') : '<div class="oc-empty">No hay traslados en este rango.</div>';
            h += '<div class="vm-actions"><button type="button" class="mx-btn mx-btn-pri" onclick="vmImport(\'tr\')"' + (tr.new ? '' : ' disabled') + '><i class="fa-solid fa-download"></i> Traer traslados (' + nf(tr.new) + ')</button></div>';
        }
        q('vm-body').innerHTML = h;
    }

    window.vmImport = async function (which) {
        if (busy || !last) return;
        const rg = last.range || {}, f = rg.from, t = rg.to;
        const label = which === 'ot' ? 'horas extras' : 'traslados';
        if (!confirm('Se guardarán como Pendientes de aprobación las ' + label + ' del ' + dmy(f) + ' al ' + dmy(t) + '. ¿Continuar?')) return;
        busy = true;
        try {
            const r = which === 'ot'
                ? await rpc('ops_ot_detect', Object.assign(auth(), { p_from: f, p_to: t }))
                : await rpc('ops_transfers_detect', Object.assign(auth(), { p_from: f, p_to: t, p_max_gap_min: rg.gap_min || 180 }));
            if (!r.ok) return showToast(r.msg || 'No se pudo traer.', 'error');
            const d = r.data || {};
            if (typeof registrarAuditoria === 'function') registrarAuditoria('CREATE', which === 'ot' ? 'hvac_overtime' : 'hvac_transfers', 'Importación validada ' + f + ' a ' + t + ': ' + (d.created || 0) + ' nuevos');
            showToast((d.created || 0) + ' ' + label + ' nuevo(s) pendientes de aprobación.');
        } finally { busy = false; }
        if (which === 'ot') { const a = q('ot-from'), b = q('ot-to'); if (a && b) { a.value = f; b.value = t; } if (q('ot-status')) q('ot-status').value = 'Pendiente'; if (typeof otLoad === 'function') otLoad(); }
        else { const a = q('tr-from'), b = q('tr-to'); if (a && b) { a.value = f; b.value = t; } if (q('tr-status')) q('tr-status').value = 'Pendiente'; if (typeof trLoad === 'function') trLoad(); }
        last = null; window.vmRun();
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && q('vm-modal') && !q('vm-modal').classList.contains('hidden')) window.vmClose(); });
})();
