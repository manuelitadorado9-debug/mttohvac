/* ===== Transportes · Tabla, registro manual, revisión GPS, cortes y PDF =====
   Solo ADMIN. Las operaciones SQL ops_transfer_* validan el rol administrador en servidor. */
(function () {
    const q = id => document.getElementById(id);
    const me = () => systemUsers.find(u => String(u.id) === String(activeUser));
    const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO');
    const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; };
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let rows = [], busy = false, started = false, gpsPreview = null;

    async function rpc(fn, body) {
        try {
            if (window.HVACSec) {
                body = HVACSec.cleanDeep(body);
                if (!(await HVACSec.throttle('POST'))) return { ok: false, msg: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.' };
            }
            const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (r.ok) { let d = null; try { d = await r.json(); } catch (_) {} return { ok: true, data: d }; }
            let m = ''; try { m = (await r.json()).message || ''; } catch (_) {}
            if (/could not find the function|PGRST202/i.test(m)) m = 'Falta ejecutar las etapas SQL de transportes: 01–04 y 09_transportes_horas_extras_logica_unificada.sql en Supabase.';
            return { ok: false, msg: m || ('Error ' + r.status) };
        } catch (e) { return { ok: false, msg: 'Sin conexión.' }; }
    }
    const auth = () => window.opsAuth();
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
            rows.map(x => '<tr' + (x.status === 'Aprobado' ? ' class="tr-row-manage" title="Doble clic para devolver a evaluación o eliminar" ondblclick="trRowDbl(\'' + esc(x.id) + '\')"' : '') + '><td>' + dmy(x.work_date) + '<span class="tr-sub">' + (x.source === 'gps' ? 'GPS' : 'Manual') + '</span></td>' +
                '<td><b>' + esc(x.employee_name) + '</b>' + (x.employee_role ? '<span class="tr-sub">' + esc(x.employee_role) + '</span>' : '') + '</td>' +
                '<td>' + esc(x.from_client_name || '—') + ' → ' + esc(x.to_client_name || '—') + '</td>' +
                '<td>' + esc(x.reason || '—') + (x.reject_reason ? '<span class="tr-sub">Rechazo: ' + esc(x.reject_reason) + '</span>' : '') + '</td>' +
                '<td class="num">' + money(x.amount) + '<span class="tr-sub" style="font-weight:600">' + esc(src[x.rate_source] || '') + '</span></td>' +
                '<td><span class="tr-st ' + cls[x.status] + '">' + esc(x.status) + '</span>' + (x.cut_id ? '<span class="tr-sub"><i class="fa-solid fa-lock"></i> En corte</span>' : '') + '</td>' +
                '<td>' + (x.status === 'Pendiente' ? '<div class="tr-act"><button type="button" class="ok" onclick="trDecide(\'' + esc(x.id) + '\',\'Aprobado\')">Aprobar</button><button type="button" class="no" onclick="trDecide(\'' + esc(x.id) + '\',\'Rechazado\')">Rechazar</button></div>' : '') + '</td></tr>').join('') +
            '</tbody></table>';
    }

    window.trRowDbl = function (id) {
        const x = rows.find(r => String(r.id) === String(id));
        if (!x || x.status !== 'Aprobado') return;
        if (typeof window.opsRecordManageOpen === 'function') {
            window.opsRecordManageOpen('transport', x.id, x.employee_name + ' · ' + dmy(x.work_date) + ' · ' + (x.from_client_name || '—') + ' → ' + (x.to_client_name || '—'), x.cut_id);
        }
    };

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

    /* 2B · Detección GPS en dos pasos: previsualizar solo pares nuevos y luego importar. */
    window.trDetect = async function () {
        if (busy) return;
        if (!isAdmin()) return showToast('Solo el administrador puede detectar traslados.', 'error');
        const f = q('tr-from').value, t = q('tr-to').value;
        if (!f || !t) return showToast('Indica el rango de fechas.', 'error');
        if (t < f) return showToast('La fecha final no puede ser anterior a la inicial.', 'error');
        const btn = q('tr-detect-btn'); busy = true; if (btn) btn.disabled = true;
        q('tr-preview-body').innerHTML = '<div class="oc-empty">Revisando secuencia GPS y comparando con los transportes ya registrados…</div>';
        q('tr-preview-modal').classList.remove('hidden');
        try {
            const r = await rpc('ops_transfers_preview', Object.assign(auth(), { p_from: f, p_to: t, p_max_gap_min: null }));
            if (!r.ok) {
                gpsPreview = null;
                q('tr-preview-body').innerHTML = '<div class="oc-err">' + esc(r.msg || 'No se pudo revisar la asistencia.') + '</div>';
                return;
            }
            gpsPreview = r.data || null;
            trPreviewRender(gpsPreview);
        } finally { busy = false; if (btn) btn.disabled = false; }
    };

    function trPreviewRender(d) {
        if (!d) return;
        const items = Array.isArray(d.items) ? d.items : [];
        const nf = n => Number(n || 0).toLocaleString('es-CO');
        const kpi = (label, value, note) => '<div class="tr-kpi"><span>' + label + '</span><b>' + nf(value) + '</b>' + (note ? '<span class="tr-preview-note">' + note + '</span>' : '') + '</div>';
        let h = '<div class="tr-preview-intro">Se compararon las parejas GPS con los transportes guardados. Solo se muestran aquí los pares que todavía no existen en el listado.</div>';
        h += '<div class="tr-kpis tr-preview-kpis">' +
            kpi('Pares detectados', d.pairs) +
            kpi('Nuevos para traer', d.new) +
            kpi('Ya registrados', d.existing) +
            kpi('Fuera de rango', d.out_of_range) +
            kpi('Sin tarifa', d.no_rate) + '</div>';
        if (items.length) {
            h += '<div class="tr-preview-list">' + items.map(x => {
                const missingRate = x.status === 'sin_tarifa';
                const timing = esc(x.from_time || '—') + ' salida → ' + esc(x.to_time || '—') + ' entrada';
                const dist = x.from_distance_m != null || x.to_distance_m != null
                    ? '<span class="tr-sub">GPS: ' + (x.from_distance_m == null ? '—' : nf(x.from_distance_m) + ' m') + ' / ' + (x.to_distance_m == null ? '—' : nf(x.to_distance_m) + ' m') + '</span>' : '';
                return '<div class="oc-row"><div class="l"><b>' + esc(x.employee_name || 'Técnico') + ' · ' + dmy(x.date) + '</b>' +
                    '<span>' + esc(x.from || '—') + ' → ' + esc(x.to || '—') + '</span><span>' + timing + ' · ' + nf(x.gap_minutes) + ' min' + '</span>' + dist +
                    '</div><div class="tr-preview-item-right">' + (missingRate ? '<span class="oc-badge off">Sin tarifa</span>' : '<b>' + money(x.amount) + '</b><span class="oc-badge ok">Nuevo</span>') + '</div></div>';
            }).join('') + '</div>';
        } else {
            h += '<div class="oc-empty">No hay pares nuevos para importar con estos filtros.</div>';
        }
        if (d.out_of_range) h += '<div class="oc-hint">Las parejas fuera del radio se omitieron. La distancia se volvió a calcular con las coordenadas y el radio actuales de cada cliente.</div>';
        if (d.no_rate) h += '<div class="oc-hint">Los pares sin tarifa aparecen para revisión, pero no se importarán hasta configurar una tarifa vigente.</div>';
        if (d.truncated) h += '<div class="oc-hint">La vista muestra los primeros 300 pares nuevos o sin tarifa. La importación volverá a comprobar todos los pares válidos del rango.</div>';
        h += '<div class="tr-preview-actions"><button type="button" class="mx-btn mx-btn-sec" onclick="trPreviewClose()">Cerrar</button>' +
            '<button type="button" id="tr-preview-import" class="mx-btn mx-btn-pri" onclick="trImportGps()"' + (Number(d.new || 0) > 0 ? '' : ' disabled') + '><i class="fa-solid fa-download"></i> Traer solo nuevos (' + nf(d.new) + ')</button></div>';
        q('tr-preview-body').innerHTML = h;
    }

    window.trPreviewClose = function () {
        q('tr-preview-modal').classList.add('hidden');
        gpsPreview = null;
    };

    window.trImportGps = async function () {
        if (busy || !gpsPreview) return;
        const rg = gpsPreview.range || {};
        if (!Number(gpsPreview.new || 0)) return showToast('No hay traslados nuevos con tarifa para importar.', 'error');
        if (!confirm('Se traerán únicamente los traslados GPS que aún no figuran en el listado, como Pendientes de aprobación. ¿Continuar?')) return;
        busy = true;
        const btn = q('tr-preview-import'); if (btn) btn.disabled = true;
        try {
            const r = await rpc('ops_transfers_detect', Object.assign(auth(), {
                p_from: rg.from, p_to: rg.to, p_max_gap_min: null
            }));
            if (!r.ok) return showToast(r.msg || 'No se pudieron importar los traslados.', 'error');
            const d = r.data || {};
            if (typeof registrarAuditoria === 'function') registrarAuditoria('CREATE', 'hvac_transfers', 'Importación GPS ' + rg.from + ' a ' + rg.to + ': ' + (d.created || 0) + ' nuevos');
            showToast((d.created || 0) + ' traslado(s) nuevo(s) importado(s); ' + (d.duplicates || 0) + ' ya existían.');
            q('tr-status').value = 'Pendiente';
            q('tr-from').value = rg.from || q('tr-from').value;
            q('tr-to').value = rg.to || q('tr-to').value;
            q('tr-preview-modal').classList.add('hidden');
            gpsPreview = null;
            await trLoad();
        } finally { busy = false; if (btn) btn.disabled = false; }
    };

    /* 2C · Cortes de periodo */
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
        return [q('tr-from').value, q('tr-to').value];
    }

    window.trOpenCuts = async function () {
        if (!isAdmin()) return showToast('Solo el administrador puede gestionar cortes.', 'error');
        q('trcut-modal').classList.remove('hidden');
        q('trcut-note').value = '';
        await trCutsLoad(true);
    };
    window.trCloseCuts = function () { q('trcut-modal').classList.add('hidden'); };

    async function trCutsLoad(setDates) {
        const box = q('trcut-list'); box.innerHTML = '<div class="oc-empty">Cargando…</div>';
        const r = await rpc('ops_cut_list', auth());
        if (!r.ok) { box.innerHTML = '<div class="oc-err">' + esc(r.msg) + '</div>'; return; }
        const d = r.data || {}; cutDays = d.cut_days || cutDays;
        if (setDates) { const p = suggestPeriod(); q('trcut-from').value = p[0]; q('trcut-to').value = p[1]; }
        const cuts = d.cuts || [];
        box.innerHTML = cuts.length ? cuts.map(c =>
            '<div class="oc-row"><div class="l"><b>' + dmy(c.period_start) + ' → ' + dmy(c.period_end) + ' · ' + money(c.total) + '</b>' +
            '<span>' + c.n + ' traslado(s) · cerrado ' + dmy(c.closed_at) + (c.note ? ' · ' + esc(c.note) : '') + '</span></div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
            '<span class="oc-badge ' + (c.status === 'pagado' ? 'ok' : 'sch') + '">' + (c.status === 'pagado' ? 'Pagado' : 'Cerrado') + '</span>' +
            /* 4A: botón PDF siempre visible en cortes cerrados y pagados */
            '<button type="button" class="oc-mini tr-pdf-btn" onclick="trCutPDF(\'' + esc(c.id) + '\',\'' + esc(dmy(c.period_start)) + ' – ' + esc(dmy(c.period_end)) + '\')"><i class="fa-solid fa-file-pdf"></i> PDF</button>' +
            (c.status === 'cerrado' ? '<button type="button" class="oc-mini" onclick="trCutRevert(\'' + esc(c.id) + '\')">Revertir</button>' : '') +
            '</div></div>'
        ).join('')
            : '<div class="oc-empty">Aún no hay cortes de transportes.</div>';
        trCutPreview();
    }

    window.trCutPreview = async function () {
        const f = q('trcut-from').value, t = q('trcut-to').value, box = q('trcut-prev'), btn = q('trcut-btn');
        btn.disabled = true;
        if (!f || !t || t < f) { box.innerHTML = '<span class="tr-warn">Revisa las fechas del periodo.</span>'; return; }
        box.textContent = 'Calculando…';
        const r = await rpc('ops_cut_preview', Object.assign(auth(), { p_from: f, p_to: t }));
        if (f !== q('trcut-from').value || t !== q('trcut-to').value) return;
        if (!r.ok) { box.innerHTML = '<span class="tr-warn">' + esc(r.msg) + '</span>'; return; }
        const d = r.data || {};
        let h = 'Entran al corte: <b>' + d.approved_n + '</b> aprobado(s) por <b>' + money(d.approved_total) + '</b>.';
        if (d.pending_n > 0) h += '<br><span class="tr-warn">Hay ' + d.pending_n + ' pendiente(s) (' + money(d.pending_total) + ') que NO entrarán. Apruébalos o recházalos antes de cortar.</span>';
        if (d.overlap) { h += '<br><span class="tr-warn">Se cruza con el corte del ' + dmy(d.overlap.from) + ' al ' + dmy(d.overlap.to) + '.</span>'; }
        else if (d.approved_n > 0) btn.disabled = false;
        if (!d.approved_n && !d.overlap) h += '<br><span class="tr-warn">No hay aprobados para cortar en este periodo.</span>';
        box.innerHTML = h;
    };

    window.trCutCreate = async function () {
        if (busy) return;
        const f = q('trcut-from').value, t = q('trcut-to').value;
        if (!f || !t || t < f) return showToast('Revisa las fechas del periodo.', 'error');
        if (!confirm('¿Cerrar el corte del ' + dmy(f) + ' al ' + dmy(t) + '?\nLos traslados aprobados quedarán bloqueados. Podrás revertirlo mientras no esté pagado.')) return;
        busy = true; const btn = q('trcut-btn'); btn.disabled = true;
        try {
            const r = await rpc('ops_cut_create', Object.assign(auth(), { p_from: f, p_to: t, p_note: q('trcut-note').value.trim() || null }));
            if (!r.ok) return showToast(r.msg, 'error');
            const d = r.data || {};
            if (typeof registrarAuditoria === 'function') registrarAuditoria('CREATE', 'operational_cuts', 'Corte transportes ' + f + ' a ' + t + ': ' + d.count + ' traslados');
            showToast('Corte cerrado: ' + d.count + ' traslado(s) por ' + money(d.total) + '.' + (d.pending_left ? ' Quedaron ' + d.pending_left + ' pendiente(s) fuera.' : ''));
            q('trcut-note').value = '';
        } finally { busy = false; }
        await trCutsLoad(false); trLoad();
    };

    window.trCutRevert = async function (id) {
        if (busy) return;
        if (!confirm('¿Revertir este corte?\nLos traslados quedarán libres (aprobados, sin corte) y podrás editarlos o volver a cortar.')) return;
        busy = true;
        try {
            const r = await rpc('ops_cut_revert', Object.assign(auth(), { p_id: id }));
            if (!r.ok) return showToast(r.msg, 'error');
            if (typeof registrarAuditoria === 'function') registrarAuditoria('UPDATE', 'operational_cuts', 'Corte revertido ' + id + ': ' + ((r.data || {}).released || 0) + ' traslados liberados');
            showToast('Corte revertido: ' + ((r.data || {}).released || 0) + ' traslado(s) liberados.');
        } finally { busy = false; }
        await trCutsLoad(false); trLoad();
    };

    /* ================================================================
       4A · PDF de liquidación de transportes
       Usa jsPDF desde CDN. Carga el script solo la primera vez.
    ================================================================ */
    function loadJsPDF() {
        return new Promise((resolve, reject) => {
            if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
            if (document.getElementById('jspdf-cdn')) {
                // ya se está cargando: espera
                const iv = setInterval(() => {
                    if (window.jspdf && window.jspdf.jsPDF) { clearInterval(iv); resolve(window.jspdf.jsPDF); }
                }, 80);
                return;
            }
            const s = document.createElement('script');
            s.id = 'jspdf-cdn';
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            s.onload = () => resolve(window.jspdf.jsPDF);
            s.onerror = () => reject(new Error('No se pudo cargar jsPDF. Verifica tu conexión.'));
            document.head.appendChild(s);
        });
    }

    window.trCutPDF = async function (cutId, label) {
        if (busy) return;
        busy = true;
        showToast('Generando PDF…');
        try {
            /* 1 · Cargar jsPDF */
            let JsPDF;
            try { JsPDF = await loadJsPDF(); }
            catch (e) { return showToast(e.message, 'error'); }

            /* 2 · Obtener datos del corte */
            const r = await rpc('ops_tr_cut_detail', Object.assign(auth(), { p_cut_id: cutId }));
            if (!r.ok) return showToast(r.msg || 'Error al obtener detalle del corte.', 'error');
            const d = r.data || {};
            const cut = d.cut || {};
            const lh  = d.letterhead || {};
            const filas = d.rows || [];
            const byTech = d.by_tech || [];
            const grand = Number(d.grand_total || 0);

            /* 3 · Construir PDF */
            const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const W = 210, ML = 14, MR = 14, TW = W - ML - MR;
            let y = 14;

            // --- Logo (si existe y es URL válida, intenta cargar como Data URL) ---
            if (lh.logo_url) {
                try {
                    const img = await fetchImgBase64(lh.logo_url);
                    if (img) { doc.addImage(img.data, img.ext, ML, y, 28, 14); }
                } catch (_) { /* logo opcional, continúa sin él */ }
            }

            // --- Membrete ---
            const hx = lh.logo_url ? ML + 32 : ML;
            doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(15, 23, 42);
            doc.text(lh.company_name || 'Empresa', hx, y + 5);
            doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(71, 85, 105);
            if (lh.nit) doc.text('NIT: ' + lh.nit, hx, y + 11);

            // --- Título del documento ---
            doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(15, 23, 42);
            doc.text('LIQUIDACIÓN DE TRANSPORTES', W / 2, y + 5, { align: 'center' });
            doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(71, 85, 105);
            doc.text('Periodo: ' + dmy(cut.period_start) + ' al ' + dmy(cut.period_end), W / 2, y + 11, { align: 'center' });
            doc.text('Estado: ' + (cut.status || '—') + '   |   Corte ID: ' + String(cut.id || '').slice(0, 8) + '…', W / 2, y + 16, { align: 'center' });
            if (cut.note) doc.text('Nota: ' + cut.note, W / 2, y + 21, { align: 'center' });

            y += 28;
            doc.setDrawColor(203, 213, 225).setLineWidth(0.3).line(ML, y, W - MR, y);
            y += 5;

            /* 4 · Tabla de traslados */
            const cols = [
                { h: 'Fecha',          w: 18, key: r => dmy(r.work_date),                                      align: 'left'  },
                { h: 'Técnico',        w: 36, key: r => (r.employee_name || '—'),                              align: 'left'  },
                { h: 'Origen → Destino', w: 54, key: r => (r.from_client_name || '—') + ' → ' + (r.to_client_name || '—'), align: 'left' },
                { h: 'Km',             w: 10, key: r => r.distance_km != null ? String(r.distance_km) : '—',  align: 'right' },
                { h: 'Valor',          w: 24, key: r => money(r.amount),                                       align: 'right' },
                { h: 'GPS',            w: 10, key: r => r.source === 'gps' ? 'Sí' : 'No',                     align: 'center'},
            ];
            const colX = (() => { let x = ML; return cols.map(c => { const cx = x; x += c.w; return cx; }); })();

            // Cabecera de tabla
            doc.setFillColor(241, 245, 249).rect(ML, y, TW, 7, 'F');
            doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(71, 85, 105);
            cols.forEach((c, i) => {
                const tx = c.align === 'right' ? colX[i] + c.w - 1 : c.align === 'center' ? colX[i] + c.w / 2 : colX[i] + 1;
                doc.text(c.h, tx, y + 4.5, { align: c.align === 'center' ? 'center' : c.align });
            });
            y += 7;

            // Filas
            doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(15, 23, 42);
            filas.forEach((row, idx) => {
                if (y > 262) { doc.addPage(); y = 14; } // nueva página si se llena
                if (idx % 2 === 0) { doc.setFillColor(248, 250, 252).rect(ML, y, TW, 7, 'F'); }
                cols.forEach((c, i) => {
                    const val = c.key(row);
                    const tx = c.align === 'right' ? colX[i] + c.w - 1 : c.align === 'center' ? colX[i] + c.w / 2 : colX[i] + 1;
                    // truncar texto largo
                    const maxW = c.w - 2;
                    const txt = doc.getStringUnitWidth(val) * 7 / doc.internal.scaleFactor > maxW
                        ? doc.splitTextToSize(val, maxW)[0] + '…'
                        : val;
                    doc.text(txt, tx, y + 4.5, { align: c.align === 'center' ? 'center' : c.align });
                });
                y += 7;
            });

            y += 4;
            doc.setDrawColor(203, 213, 225).line(ML, y, W - MR, y);
            y += 6;

            /* 5 · Totales por técnico */
            if (byTech.length) {
                doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(15, 23, 42);
                doc.text('Resumen por técnico', ML, y); y += 5;
                doc.setFillColor(241, 245, 249).rect(ML, y, TW, 6, 'F');
                doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(71, 85, 105);
                doc.text('Técnico', ML + 1, y + 4); doc.text('Traslados', ML + 100, y + 4, { align: 'right' }); doc.text('Total', W - MR - 1, y + 4, { align: 'right' });
                y += 6;
                doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(15, 23, 42);
                byTech.forEach((t2, idx) => {
                    if (y > 268) { doc.addPage(); y = 14; }
                    if (idx % 2 === 0) { doc.setFillColor(248, 250, 252).rect(ML, y, TW, 6, 'F'); }
                    doc.text(t2.employee_name || '—', ML + 1, y + 4);
                    doc.text(String(t2.n), ML + 100, y + 4, { align: 'right' });
                    doc.text(money(t2.total), W - MR - 1, y + 4, { align: 'right' });
                    y += 6;
                });
                y += 4;
            }

            /* 6 · Gran total */
            doc.setFillColor(15, 23, 42).rect(ML, y, TW, 9, 'F');
            doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(255, 255, 255);
            doc.text('GRAN TOTAL', ML + 2, y + 6);
            doc.text(money(grand), W - MR - 1, y + 6, { align: 'right' });
            y += 14;

            /* 7 · Pie */
            doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(148, 163, 184);
            doc.text('Generado el ' + new Date().toLocaleString('es-CO') + '   ·   ' + (lh.company_name || ''), ML, y);

            /* 8 · Descargar */
            const fname = 'liquidacion_transportes_' + String(cut.period_start || '').replace(/-/g, '') + '_' + String(cut.period_end || '').replace(/-/g, '') + '.pdf';
            doc.save(fname);
            showToast('PDF descargado: ' + fname);
        } catch (e) {
            showToast('Error al generar PDF: ' + (e.message || e), 'error');
        } finally { busy = false; }
    };

    /* Convierte una URL de imagen a base64 para incrustarla en jsPDF */
    async function fetchImgBase64(url) {
        try {
            const r = await fetch(url);
            if (!r.ok) return null;
            const blob = await r.blob();
            const ext = blob.type.includes('png') ? 'PNG' : blob.type.includes('gif') ? 'GIF' : 'JPEG';
            return new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onload = () => res({ data: fr.result, ext });
                fr.onerror = rej;
                fr.readAsDataURL(blob);
            });
        } catch (_) { return null; }
    }

    /* ============================================================ */
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
    document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (q('trcut-modal') && !q('trcut-modal').classList.contains('hidden')) trCloseCuts(); else if (q('tr-modal') && !q('tr-modal').classList.contains('hidden')) trCloseNew(); });
})();
