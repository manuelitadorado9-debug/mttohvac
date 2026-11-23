/* ===== Horas Extras · Etapa 3B (alimentación + recálculo al editar) =====
   Solo ADMIN. Usa las funciones SQL ops_ot_* (SQL 05+06). */
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
            if (/could not find the function|PGRST202/i.test(m)) m = 'Falta ejecutar el SQL de la Etapa 3A/3B en Supabase.';
            return { ok: false, msg: m || ('Error ' + r.status) };
        } catch (e) { return { ok: false, msg: 'Sin conexión.' }; }
    }
    const auth = () => window.opsAuth();
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
        const aprAmt = sumA(apr, 'amount'), aprMeal = sumA(apr, 'meal_amount');
        q('ot-kpis').innerHTML =
            '<div class="tr-kpi"><span>Pendientes</span><b>' + pen.length + '</b></div>' +
            '<div class="tr-kpi"><span>Horas pendientes</span><b>' + hrs(sumA(pen, 'hours')) + '</b></div>' +
            '<div class="tr-kpi"><span>Valor pendiente</span><b>' + money(sumA(pen, 'amount')) + '</b></div>' +
            '<div class="tr-kpi"><span>HH Aprobadas</span><b>' + money(aprAmt) + '</b><span style="text-transform:none;font-weight:700">' + hrs(sumA(apr, 'hours')) + '</span></div>' +
            (aprMeal > 0 ? '<div class="tr-kpi ot-meal-kpi"><span>Alimentación aprobada</span><b>' + money(aprMeal) + '</b></div>' : '') +
            (aprMeal > 0 ? '<div class="tr-kpi ot-grand-kpi"><span>Total a pagar</span><b>' + money(aprAmt + aprMeal) + '</b></div>' : '');
        if (!rows.length) { q('ot-list').innerHTML = '<div class="oc-empty">No hay horas extras con estos filtros. Usa «Detectar horas extras» para calcularlas desde la asistencia.</div>'; return; }
        const cls = { Pendiente: 'p', Aprobado: 'a', Rechazado: 'r' };
        q('ot-list').innerHTML = '<table class="tr-table"><thead><tr><th>Fecha</th><th>Empleado</th><th>Tipo</th><th>Horario</th><th style="text-align:right">Horas</th><th style="text-align:right">HH Extra</th><th style="text-align:right">Aliment.</th><th>Estado</th><th></th></tr></thead><tbody>' +
            rows.map(x => '<tr' + (x.status === 'Aprobado' ? ' class="tr-row-manage" title="Doble clic para devolver a evaluación o eliminar" ondblclick="otRowDbl(\'' + esc(x.id) + '\')"' : '') + '><td>' + dmy(x.work_date) + '</td>' +
                '<td><b>' + esc(x.employee_name) + '</b>' + (x.employee_role ? '<span class="tr-sub">' + esc(x.employee_role) + '</span>' : '') + '</td>' +
                '<td><span class="ot-type ' + esc(x.overtime_type) + '">' + esc(TYPES[x.overtime_type] || x.overtime_type) + '</span></td>' +
                '<td>' + hm(x.start_at) + ' – ' + hm(x.end_at) + '</td>' +
                '<td class="num">' + hrs(x.hours) + '</td>' +
                '<td class="num">' + money(x.amount) + '<span class="tr-sub" style="font-weight:600">' + money(x.rate_value) + '/h</span></td>' +
                '<td class="num">' + (Number(x.meal_amount) > 0 ? '<span class="ot-meal-badge">' + money(x.meal_amount) + '</span>' : '—') + '</td>' +
                '<td><span class="tr-st ' + cls[x.status] + '">' + esc(x.status) + '</span>' +
                    (x.reject_reason ? '<span class="tr-sub">Rechazo: ' + esc(x.reject_reason) + '</span>' : '') +
                    (x.cut_id ? '<span class="tr-sub"><i class="fa-solid fa-lock"></i> En corte</span>' : '') + '</td>' +
                '<td>' + (x.status === 'Pendiente' ? '<div class="tr-act"><button type="button" class="ok" onclick="otDecide(\'' + esc(x.id) + '\',\'Aprobado\')">Aprobar</button><button type="button" class="no" onclick="otDecide(\'' + esc(x.id) + '\',\'Rechazado\')">Rechazar</button></div>' : '') + '</td></tr>').join('') +
            '</tbody></table>';
    }

    window.otRowDbl = function (id) {
        const x = rows.find(r => String(r.id) === String(id));
        if (!x || x.status !== 'Aprobado') return;
        if (typeof window.opsRecordManageOpen === 'function') {
            window.opsRecordManageOpen('overtime', x.id, x.employee_name + ' · ' + dmy(x.work_date) + ' · ' + (TYPES[x.overtime_type] || x.overtime_type), x.cut_id);
        }
    };

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

    /* Detección */
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

    /* Cortes */
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
        box.innerHTML = cuts.length ? cuts.map(c => {
            const hasMeal = Number(c.meal_total) > 0;
            return '<div class="oc-row"><div class="l">' +
                '<b>' + dmy(c.period_start) + ' → ' + dmy(c.period_end) + ' · HH: ' + money(c.total) +
                (hasMeal ? ' · Aliment: ' + money(c.meal_total) : '') +
                ' · <u>Total: ' + money(c.grand_total || (Number(c.total) + Number(c.meal_total || 0))) + '</u></b>' +
                '<span>' + c.n + ' registro(s) · ' + hrs(c.hours) + ' · cerrado ' + dmy(c.closed_at) + (c.note ? ' · ' + esc(c.note) : '') + '</span></div>' +
                '<div style="display:flex;gap:6px;align-items:center"><span class="oc-badge ' + (c.status === 'pagado' ? 'ok' : 'sch') + '">' + (c.status === 'pagado' ? 'Pagado' : 'Cerrado') + '</span>' +
                '<button type="button" class="oc-mini ot-pdf-btn" onclick="otCutPDF(\'' + esc(c.id) + '\')"><i class="fa-solid fa-file-pdf"></i> PDF</button>' +
                (c.status === 'cerrado' ? '<button type="button" class="oc-mini" onclick="otCutRevert(\'' + esc(c.id) + '\')">Revertir</button>' : '') + '</div></div>';
        }).join('') : '<div class="oc-empty">Aún no hay cortes de horas extras.</div>';
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
        const d = r.data || {}, meal = Number(d.meal_total || 0), grand = Number(d.grand_total || 0);
        let h = 'Entran al corte: <b>' + d.approved_n + '</b> aprobado(s), <b>' + hrs(d.approved_hours) + '</b>.<br>' +
            'HH extras: <b>' + money(d.approved_total) + '</b>' +
            (meal > 0 ? ' + Alimentación: <b>' + money(meal) + '</b> = <b class="ot-grand">' + money(grand) + '</b>' : '') + '.';
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
            const d = r.data || {}, meal = Number(d.meal_total || 0);
            if (typeof registrarAuditoria === 'function') registrarAuditoria('CREATE', 'operational_cuts', 'Corte horas extras ' + f + ' a ' + t + ': ' + d.count + ' registros');
            showToast('Corte cerrado: ' + d.count + ' registro(s) · HH: ' + money(d.total) +
                (meal > 0 ? ' · Aliment: ' + money(meal) + ' · Total: ' + money(d.grand_total) : '') + '.' +
                (d.pending_left ? ' Quedaron ' + d.pending_left + ' pendiente(s) fuera.' : ''));
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

    /* ================================================================
       4B · PDF de liquidación de horas extras
       Reutiliza loadJsPDF y fetchImgBase64 declaradas aquí mismo.
    ================================================================ */
    function loadJsPDF() {
        return new Promise((resolve, reject) => {
            if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
            if (document.getElementById('jspdf-cdn')) {
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

    window.otCutPDF = async function (cutId) {
        if (busy) return;
        busy = true;
        showToast('Generando PDF…');
        try {
            /* 1 · Cargar jsPDF */
            let JsPDF;
            try { JsPDF = await loadJsPDF(); }
            catch (e) { return showToast(e.message, 'error'); }

            /* 2 · Obtener detalle del corte */
            const r = await rpc('ops_ot_cut_detail', Object.assign(auth(), { p_cut_id: cutId }));
            if (!r.ok) return showToast(r.msg || 'Error al obtener detalle del corte.', 'error');
            const d      = r.data || {};
            const cut    = d.cut || {};
            const lh     = d.letterhead || {};
            const filas  = d.rows || [];
            const byTech = d.by_tech || [];
            const grand  = Number(d.grand_total || 0);
            const TYPES  = { diurna: 'Diurna', nocturna: 'Nocturna', dominical: 'Dominical', festiva: 'Festiva' };

            /* 3 · Construir PDF */
            const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const W = 210, ML = 14, MR = 14, TW = W - ML - MR;
            let y = 14;

            // Logo opcional
            if (lh.logo_url) {
                try {
                    const img = await fetchImgBase64(lh.logo_url);
                    if (img) doc.addImage(img.data, img.ext, ML, y, 28, 14);
                } catch (_) {}
            }

            // Membrete
            const hx = lh.logo_url ? ML + 32 : ML;
            doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(15, 23, 42);
            doc.text(lh.company_name || 'Empresa', hx, y + 5);
            doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(71, 85, 105);
            if (lh.nit) doc.text('NIT: ' + lh.nit, hx, y + 11);

            // Título
            doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(15, 23, 42);
            doc.text('LIQUIDACIÓN DE HORAS EXTRAS', W / 2, y + 5, { align: 'center' });
            doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(71, 85, 105);
            doc.text('Periodo: ' + dmy(cut.period_start) + ' al ' + dmy(cut.period_end), W / 2, y + 11, { align: 'center' });
            doc.text('Estado: ' + (cut.status || '—') + '   |   Corte ID: ' + String(cut.id || '').slice(0, 8) + '…', W / 2, y + 16, { align: 'center' });
            if (cut.note) doc.text('Nota: ' + cut.note, W / 2, y + 21, { align: 'center' });

            y += 28;
            doc.setDrawColor(203, 213, 225).setLineWidth(0.3).line(ML, y, W - MR, y);
            y += 5;

            /* 4 · Tabla de detalle */
            // columnas: Fecha(18) Técnico(34) Tipo(18) Entrada(16) Salida(16) Horas(12) Val.HE(24) Aliment.(24)
            const cols = [
                { h: 'Fecha',     w: 18, fn: row => dmy(row.work_date),                             al: 'left'  },
                { h: 'Técnico',   w: 34, fn: row => row.employee_name || '—',                       al: 'left'  },
                { h: 'Tipo',      w: 18, fn: row => TYPES[row.overtime_type] || row.overtime_type,  al: 'left'  },
                { h: 'Entrada',   w: 16, fn: row => hm(row.start_at),                               al: 'center'},
                { h: 'Salida',    w: 16, fn: row => hm(row.end_at),                                 al: 'center'},
                { h: 'Horas',     w: 12, fn: row => hrs(row.hours),                                 al: 'right' },
                { h: 'Val. HE',   w: 24, fn: row => money(row.amount),                              al: 'right' },
                { h: 'Aliment.',  w: 24, fn: row => Number(row.meal_amount) > 0 ? money(row.meal_amount) : '—', al: 'right' },
            ];
            const colX = (() => { let x = ML; return cols.map(c => { const cx = x; x += c.w; return cx; }); })();

            const drawTableHeader = () => {
                doc.setFillColor(241, 245, 249).rect(ML, y, TW, 7, 'F');
                doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(71, 85, 105);
                cols.forEach((c, i) => {
                    const tx = c.al === 'right' ? colX[i] + c.w - 1 : c.al === 'center' ? colX[i] + c.w / 2 : colX[i] + 1;
                    doc.text(c.h, tx, y + 4.5, { align: c.al });
                });
                y += 7;
            };
            drawTableHeader();

            doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(15, 23, 42);
            filas.forEach((row, idx) => {
                if (y > 262) { doc.addPage(); y = 14; drawTableHeader(); }
                if (idx % 2 === 0) doc.setFillColor(248, 250, 252).rect(ML, y, TW, 7, 'F');
                cols.forEach((c, i) => {
                    const val = c.fn(row);
                    const tx  = c.al === 'right' ? colX[i] + c.w - 1 : c.al === 'center' ? colX[i] + c.w / 2 : colX[i] + 1;
                    const maxW = c.w - 2;
                    const txt = doc.getStringUnitWidth(val) * 7 / doc.internal.scaleFactor > maxW
                        ? doc.splitTextToSize(val, maxW)[0] + '…' : val;
                    doc.text(txt, tx, y + 4.5, { align: c.al });
                });
                y += 7;
            });
            y += 4;

            /* 5 · Resumen por técnico */
            if (byTech.length) {
                if (y > 240) { doc.addPage(); y = 14; }
                doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(15, 23, 42);
                doc.text('Resumen por técnico', ML, y); y += 5;

                // Cabecera resumen
                doc.setFillColor(241, 245, 249).rect(ML, y, TW, 6, 'F');
                doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(71, 85, 105);
                doc.text('Técnico',    ML + 1,     y + 4);
                doc.text('Horas',      ML + 76,    y + 4, { align: 'right' });
                doc.text('Val. HE',    ML + 108,   y + 4, { align: 'right' });
                doc.text('Aliment.',   ML + 134,   y + 4, { align: 'right' });
                doc.text('Total',      W - MR - 1, y + 4, { align: 'right' });
                y += 6;

                doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(15, 23, 42);
                byTech.forEach((t2, idx) => {
                    if (y > 268) { doc.addPage(); y = 14; }
                    if (idx % 2 === 0) doc.setFillColor(248, 250, 252).rect(ML, y, TW, 6, 'F');
                    doc.text(t2.employee_name || '—', ML + 1,     y + 4);
                    doc.text(hrs(t2.hours),            ML + 76,    y + 4, { align: 'right' });
                    doc.text(money(t2.ot_total),       ML + 108,   y + 4, { align: 'right' });
                    doc.text(Number(t2.meal_total) > 0 ? money(t2.meal_total) : '—', ML + 134, y + 4, { align: 'right' });
                    doc.text(money(t2.grand_total),    W - MR - 1, y + 4, { align: 'right' });
                    y += 6;
                });
                y += 4;
            }

            /* 6 · Gran total */
            if (y > 265) { doc.addPage(); y = 14; }
            doc.setFillColor(15, 23, 42).rect(ML, y, TW, 9, 'F');
            doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(255, 255, 255);
            doc.text('GRAN TOTAL', ML + 2, y + 6);
            doc.text(money(grand), W - MR - 1, y + 6, { align: 'right' });
            y += 14;

            /* 7 · Pie */
            doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(148, 163, 184);
            doc.text('Generado el ' + new Date().toLocaleString('es-CO') + '   ·   ' + (lh.company_name || ''), ML, y);

            /* 8 · Descargar */
            const fname = 'liquidacion_horas_extras_' +
                String(cut.period_start || '').replace(/-/g, '') + '_' +
                String(cut.period_end   || '').replace(/-/g, '') + '.pdf';
            doc.save(fname);
            showToast('PDF descargado: ' + fname);
        } catch (e) {
            showToast('Error al generar PDF: ' + (e.message || e), 'error');
        } finally { busy = false; }
    };

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && q('otcut-modal') && !q('otcut-modal').classList.contains('hidden')) otCloseCuts(); });
})();
