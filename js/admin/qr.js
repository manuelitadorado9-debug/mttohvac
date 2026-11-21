
(function () {
    'use strict';
    const BASE_KEY = 'HVAC_QR_BASE_URL';
    const $ = id => document.getElementById(id);
    const st = { sel: new Set(), shown: 60, busy: false, timer: null, lastLen: -1, lastLoading: null, map: new Map(), libP: null, warnedLocal: false, pv: null, persistT: null };

    /* ---------- utilidades ---------- */
    const kid = e => String(e && (e.id || e.code) || '');
    const hasQr = e => !!(e && e.qr && e.qr.bits && e.qr.n);
    const cname = e => (typeof eqClientName === 'function' ? eqClientName(e) : (e.client || '')) || '';
    const toast = (m, t) => { try { showToast(m, t); } catch (_) { console.log(m); } };
    const userName = () => { try { const u = systemUsers.find(x => String(x.id) === String(activeUser)); return u ? (u.name || u.username || '') : ''; } catch (_) { return ''; } };
    const cmp = (a, b) => cname(a).localeCompare(cname(b), 'es') || String(a.name || a.code || '').localeCompare(String(b.name || b.code || ''), 'es', { numeric: true });
    const isOpen = () => $('qrm-back').classList.contains('open');
    function persistLocal() {
        clearTimeout(st.persistT);
        st.persistT = setTimeout(() => { try { localStorage.setItem('HVAC_EQUIPMENTS_BACKUP', JSON.stringify(equipmentCatalog)); } catch (_) {} }, 400);
    }
    async function pool(items, fn, n) {
        let i = 0;
        await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
            while (i < items.length) { const it = items[i++]; await fn(it); }
        }));
    }

    /* ---------- dirección que llevará el QR ---------- */
    function baseUrl() {
        let v = ''; try { v = localStorage.getItem(BASE_KEY) || ''; } catch (_) {}
        if (!v.trim()) { try { v = new URL('tecnico.html', location.href).href; } catch (_) { v = 'tecnico.html'; } }
        return v.trim().replace(/#.*$/, '');
    }
    const buildUrl = e => { const b = baseUrl(); return b + (b.includes('?') ? '&' : '?') + 'eq=' + encodeURIComponent(kid(e)); };
    function isLocalUrl(u) {
        try { const x = new URL(u); return x.protocol === 'file:' || /^(localhost$|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.hostname); }
        catch (_) { return true; }
    }
    const isPreviewUrl = u => { try { return /^[a-z0-9-]+-[a-z0-9]{9}-[a-z0-9-]+\.vercel\.app$/i.test(new URL(u).hostname); } catch (_) { return false; } };
    const urlRisk = u => isLocalUrl(u) ? 'local' : isPreviewUrl(u) ? 'preview' : '';
    function refreshBaseUi() {
        const b = baseUrl();
        $('qrm-base').value = b;
        $('qrm-url-short').textContent = '· ' + (function () { try { return new URL(b).host; } catch (_) { return b; } })();
        const risk = urlRisk(b), w = $('qrm-base-warn');
        w.classList.remove('local', 'preview'); w.classList.toggle('on', !!risk); if (risk) w.classList.add(risk);
        $('qrm-url-box').style.display = risk ? '' : 'none'; $('qrm-url-box').open = !!risk;
    }
    function confirmBase() {
        const b = baseUrl();
        const risk = urlRisk(b);
        if (!risk || st.warnedLocal) return true;
        const ok = confirm((risk === 'local' ? 'La dirección de destino parece local:\n' : 'La dirección de destino parece un enlace de despliegue de Vercel (puede cambiar o pedir login):\n') + b + '\n\nUna vez generados, los QR no se vuelven a crear.\n\n¿Generar de todas formas?');
        if (ok) st.warnedLocal = true; else $('qrm-url-box').open = true;
        return ok;
    }

    /* ---------- librería QR (carga bajo demanda) ---------- */
    function loadLib() {
        if (typeof qrcode === 'function') return Promise.resolve();
        if (st.libP) return st.libP;
        const urls = ['https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'];
        st.libP = (async () => {
            for (const u of urls) {
                try { await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }); } catch (_) {}
                if (typeof qrcode === 'function') return;
            }
            st.libP = null;
            throw new Error('No se pudo cargar la librería de QR. Revisa tu conexión a internet.');
        })();
        return st.libP;
    }

    /* ---------- generación ÚNICA + guardado permanente ---------- */
    // El QR se guarda dentro del propio equipo (hvac_equipments.payload.qr): { v, url, n, bits, createdAt, createdBy }.
    // Si ya existe (en memoria o en la nube) se reutiliza; nunca se vuelve a generar.
    const inflight = new Map();
    function ensureQr(eq) {
        if (hasQr(eq)) return Promise.resolve({ created: false, saved: true });
        const key = kid(eq);
        if (inflight.has(key)) return inflight.get(key);
        const p = (async () => {
            await loadLib();
            try {   // otro administrador pudo haberlo generado ya
                const rows = await supabaseFetch('hvac_equipments?select=payload&id=eq.' + encodeURIComponent(cloudCleanId(key)) + '&limit=1', 'GET', null, null, { quiet: true });
                const remote = Array.isArray(rows) && rows[0] && rows[0].payload;
                if (remote && remote.qr && remote.qr.bits && remote.qr.n) { eq.qr = remote.qr; persistLocal(); return { created: false, saved: true }; }
            } catch (_) {}
            const url = buildUrl(eq);
            const q = qrcode(0, 'M'); q.addData(url); q.make();
            const n = q.getModuleCount(); let bits = '';
            for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) bits += q.isDark(r, c) ? '1' : '0';
            eq.qr = { v: 1, url, n, bits, createdAt: new Date().toISOString(), createdBy: userName() };
            persistLocal();
            const res = await cloudSaveEquipment(eq);
            try { registrarAuditoria('GENERAR_QR', 'hvac_equipments', key); } catch (_) {}
            return { created: true, saved: !!res };
        })().finally(() => inflight.delete(key));
        inflight.set(key, p);
        return p;
    }

    /* ---------- dibujo del QR a partir de la matriz guardada ---------- */
    const dark = (qr, r, c) => qr.bits.charCodeAt(r * qr.n + c) === 49;
    function drawQr(cv, qr, px) {
        const n = qr.n, m = Math.max(2, Math.round(px / n)), size = m * n;
        cv.width = cv.height = size;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(qr, r, c)) ctx.fillRect(c * m, r * m, m, m);
    }
    function wrapCanvas(ctx, text, maxW, maxLines) {
        const words = String(text || '-').split(/\s+/).filter(Boolean), lines = []; let cur = '';
        for (const w of words) {
            const t = cur ? cur + ' ' + w : w;
            if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
        }
        if (cur) lines.push(cur);
        if (lines.length > maxLines) { lines.length = maxLines; let l = lines[maxLines - 1]; while (l.length > 1 && ctx.measureText(l + '...').width > maxW) l = l.slice(0, -1); lines[maxLines - 1] = l + '...'; }
        return lines;
    }
    function downloadPng(eq) {
        const qr = eq.qr, W = 720, H = 930, cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]); ctx.strokeRect(12, 12, W - 24, H - 24); ctx.setLineDash([]);
        const m = Math.floor(560 / qr.n), size = m * qr.n, x0 = (W - size) / 2, y0 = 60;
        ctx.fillStyle = '#000';
        for (let r = 0; r < qr.n; r++) for (let c = 0; c < qr.n; c++) if (dark(qr, r, c)) ctx.fillRect(x0 + c * m, y0 + r * m, m, m);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        let y = y0 + size + 70;
        ctx.fillStyle = '#0f172a'; ctx.font = 'bold 40px Arial, sans-serif';
        wrapCanvas(ctx, eq.name || eq.code || '-', W - 100, 2).forEach(l => { ctx.fillText(l, W / 2, y); y += 48; });
        y += 6; ctx.fillStyle = '#334155'; ctx.font = '32px Arial, sans-serif';
        wrapCanvas(ctx, cname(eq) || '-', W - 100, 1).forEach(l => { ctx.fillText(l, W / 2, y); y += 42; });
        y += 6; ctx.fillStyle = '#64748b'; ctx.font = '26px "Courier New", monospace';
        wrapCanvas(ctx, 'ID: ' + kid(eq), W - 100, 2).forEach(l => { ctx.fillText(l, W / 2, y); y += 34; });
        cv.toBlob(b => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = 'QR_' + String(eq.code || kid(eq)).replace(/[^\w\-]+/g, '_') + '.png';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }, 'image/png');
    }

    /* ---------- PDF masivo (cuadrícula lista para recortar) ---------- */
    function fitLines(doc, text, maxW, maxLines) {
        const words = String(text == null || text === '' ? '-' : text).split(/\s+/).filter(Boolean), lines = []; let cur = '';
        const push = () => { if (cur) { lines.push(cur); cur = ''; } };
        for (const w0 of words) {
            let w = w0;
            while (doc.getTextWidth(w) > maxW && w.length > 1) {
                let k = w.length; while (k > 1 && doc.getTextWidth(w.slice(0, k)) > maxW) k--;
                push(); lines.push(w.slice(0, k)); w = w.slice(k);
            }
            const t = cur ? cur + ' ' + w : w;
            if (doc.getTextWidth(t) <= maxW) cur = t; else { push(); cur = w; }
        }
        push();
        if (lines.length > maxLines) { lines.length = maxLines; let l = lines[maxLines - 1]; while (l.length > 1 && doc.getTextWidth(l + '...') > maxW) l = l.slice(0, -1); lines[maxLines - 1] = l + '...'; }
        return lines.length ? lines : ['-'];
    }
    function pdfCard(doc, eq, x, y, cw, ch, rows) {
        const pad = 4, qr = eq.qr, textH = rows === 3 ? 25 : 21;
        doc.setDrawColor(148, 163, 184); doc.setLineWidth(0.2); doc.setLineDashPattern([1.2, 1.2], 0);
        doc.rect(x, y, cw, ch); doc.setLineDashPattern([], 0);
        const qs = Math.min(cw - 2 * pad, ch - 2 * pad - textH), mod = qs / qr.n, qx = x + (cw - qs) / 2, qy = y + pad;
        doc.setFillColor(0, 0, 0);
        for (let r = 0; r < qr.n; r++) {
            let c = 0;
            while (c < qr.n) {
                if (dark(qr, r, c)) { const s = c; while (c < qr.n && dark(qr, r, c)) c++; doc.rect(qx + s * mod, qy + r * mod, (c - s) * mod + 0.03, mod + 0.03, 'F'); }
                else c++;
            }
        }
        const maxW = cw - 2 * pad, cx = x + cw / 2; let ty = qy + qs + 4.2;
        const nameFs = rows === 3 ? 10 : 8.5;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(nameFs); doc.setTextColor(15, 23, 42);
        const nl = fitLines(doc, eq.name || eq.code || '-', maxW, 2);
        doc.text(nl, cx, ty, { align: 'center' }); ty += nl.length * nameFs * 0.3528 * 1.15 + 0.6;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(51, 65, 85);
        const cl = fitLines(doc, cname(eq) || '-', maxW, 1);
        doc.text(cl, cx, ty, { align: 'center' }); ty += 7.5 * 0.3528 * 1.15 + 0.8;
        doc.setFont('courier', 'normal'); doc.setFontSize(6.5); doc.setTextColor(100, 116, 139);
        doc.text(fitLines(doc, 'ID: ' + kid(eq), maxW, 2), cx, ty, { align: 'center' });
    }
    function buildPdf(list, perPage) {
        const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const cols = 3, rows = perPage === 9 ? 3 : 4, mx = 10, my = 10, cw = (210 - 2 * mx) / cols, ch = (297 - 2 * my) / rows;
        const per = cols * rows, pages = Math.ceil(list.length / per);
        list.forEach((eq, i) => {
            const k = i % per;
            if (i > 0 && k === 0) doc.addPage();
            if (k === 0) {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
                doc.text('Smart Maintenance HVAC - Codigos QR de equipos - Pagina ' + (Math.floor(i / per) + 1) + ' de ' + pages, 105, 292.5, { align: 'center' });
            }
            pdfCard(doc, eq, mx + (k % cols) * cw, my + Math.floor(k / cols) * ch, cw, ch, rows);
        });
        doc.save('QR_Equipos_' + new Date().toISOString().slice(0, 10) + '.pdf');
    }

    /* ---------- lista, filtros y selección ---------- */
    function fillClients() {
        const sel = $('qrm-client'), prev = sel.value || 'ALL';
        const list = getSortedClientRecords(clientsCatalog).filter(c => c.id != null);
        sel.innerHTML = '<option value="ALL">Todos los clientes</option>' + list.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
        sel.value = [...sel.options].some(o => o.value === prev) ? prev : 'ALL';
        st.lastClients = (clientsCatalog || []).length;
    }
    function filtered() {
        const q = normText($('qrm-search').value), cl = $('qrm-client').value || 'ALL', stt = $('qrm-status').value;
        return equipmentCatalog.filter(e => {
            if (!e || !kid(e)) return false;
            if (cl !== 'ALL') { const c = clientsCatalog.find(x => String(x.id) === cl); if (String(e.clientId) !== cl && !(c && normText(cname(e)) === normText(c.name))) return false; }
            const h = hasQr(e);
            if (stt === 'WITH' && !h) return false;
            if (stt === 'WITHOUT' && h) return false;
            return !q || [e.code, e.name, e.serial, e.id, cname(e), e.brand, e.model].some(v => normText(v).includes(q));
        }).sort(cmp);
    }
    const selected = () => [...st.sel].map(id => equipmentCatalog.find(e => kid(e) === id)).filter(Boolean);
    function rowHtml(e) {
        const id = kid(e), h = hasQr(e), on = st.sel.has(id), name = e.name || e.code || '-';
        return `<div class="qrm-row${on ? ' sel' : ''}" data-id="${esc(id)}">
            <input type="checkbox" class="qrm-cb" data-id="${esc(id)}" ${on ? 'checked' : ''} aria-label="Seleccionar ${esc(name)}">
            <div class="qrm-thumb">${h ? `<canvas data-act="view" data-id="${esc(id)}" title="Ver QR"></canvas>` : '<i class="fa-solid fa-qrcode"></i>'}</div>
            <div class="qrm-info"><b title="${esc(name)}">${esc(name)}</b><span>${esc(cname(e) || '-')}</span><code>ID: ${esc(id)}${e.code && String(e.code) !== id ? ' · Cód. ' + esc(e.code) : ''}</code></div>
            <span class="qrm-badge ${h ? 'ok' : 'no'}">${h ? '<i class="fa-solid fa-circle-check"></i> Generado' : '<i class="fa-regular fa-clock"></i> Pendiente'}</span>
            <div class="qrm-acts">${h
                ? `<button type="button" class="qrm-ibtn" data-act="png" data-id="${esc(id)}" title="Descargar PNG"><i class="fa-solid fa-download"></i></button><button type="button" class="qrm-ibtn" data-act="view" data-id="${esc(id)}" title="Ver QR"><i class="fa-solid fa-expand"></i></button>`
                : `<button type="button" class="qrm-ibtn gen" data-act="gen" data-id="${esc(id)}"><i class="fa-solid fa-wand-magic-sparkles"></i> Generar</button>`}</div>
        </div>`;
    }
    function updateBar(all) {
        const allSel = all.length > 0 && all.every(e => st.sel.has(kid(e)));
        $('qrm-all').querySelector('span').textContent = allSel ? 'Quitar selección' : `Seleccionar todos (${all.length})`;
        $('qrm-all').querySelector('i').className = allSel ? 'fa-regular fa-square' : 'fa-regular fa-square-check';
        $('qrm-all').disabled = !all.length || st.busy;
        const sel = selected(), missing = sel.filter(e => !hasQr(e)).length;
        $('qrm-pdf').querySelector('span').textContent = sel.length ? `Descargar PDF (${sel.length})` : 'Descargar PDF';
        $('qrm-gen').querySelector('span').textContent = missing ? `Generar QR faltantes (${missing})` : 'Generar QR faltantes';
        $('qrm-pdf').disabled = !sel.length || st.busy;
        $('qrm-gen').disabled = !missing || st.busy;
    }
    function render(keepScroll) {
        if (st.lastClients !== (clientsCatalog || []).length) fillClients();
        const box = $('qrm-list'), top = keepScroll ? box.scrollTop : 0;
        const all = filtered(); st.map = new Map(all.map(e => [kid(e), e]));
        const slice = all.slice(0, st.shown), withQ = all.filter(hasQr).length;
        const loading = typeof eqBackgroundLoading !== 'undefined' && eqBackgroundLoading;
        st.lastLen = equipmentCatalog.length; st.lastLoading = !!loading;
        $('qrm-stats').textContent = `${all.length} equipos · ${withQ} con QR · ${all.length - withQ} pendientes` + (loading ? ' · cargando más equipos…' : '');
        box.innerHTML = slice.length
            ? slice.map(rowHtml).join('') + (all.length > slice.length ? `<button type="button" class="qrm-more" data-act="more">Mostrar más (${all.length - slice.length} restantes)</button>` : '')
            : `<div class="qrm-empty">${loading ? 'Cargando equipos…' : 'No hay equipos que coincidan con los filtros.'}</div>`;
        box.querySelectorAll('canvas[data-id]').forEach(cv => { const e = st.map.get(cv.dataset.id); if (e && hasQr(e)) drawQr(cv, e.qr, 120); });
        box.scrollTop = top;
        updateBar(all);
    }
    function setBusy(b, msg) {
        st.busy = b; $('qrm-prog').textContent = msg || '';
        updateBar(filtered());
    }

    /* ---------- acciones ---------- */
    async function generate(list) {
        if (!list.length) return { ok: 0, pending: 0, fail: 0 };
        if (!confirmBase()) return null;
        let done = 0, created = 0, pending = 0, fail = 0;
        setBusy(true, `Generando 0 de ${list.length}…`);
        await pool(list, async eq => {
            try { const r = await ensureQr(eq); if (r.created) created++; if (!r.saved) pending++; }
            catch (err) { fail++; console.warn('QR', err); }
            setBusy(true, `Generando ${++done} de ${list.length}…`);
        }, 4);
        persistLocal();
        return { ok: created, pending, fail };
    }
    function reportGen(r) {
        if (!r) return;
        if (r.fail) toast(`No se pudieron generar ${r.fail} QR. Revisa tu conexión e inténtalo de nuevo.`, 'error');
        if (r.ok) toast(`${r.ok} QR generado(s) y guardado(s) en la base de datos.` + (r.pending ? ` ${r.pending} quedan pendientes de sincronizar (se reintenta automáticamente).` : ''));
    }
    async function onGenMissing() {
        const list = selected().filter(e => !hasQr(e));
        if (!list.length) return;
        const r = await generate(list);
        setBusy(false); render(true); reportGen(r);
    }
    async function onGenOne(id) {
        const eq = equipmentCatalog.find(e => kid(e) === id); if (!eq || hasQr(eq) || st.busy) return;
        const r = await generate([eq]);
        setBusy(false); render(true); reportGen(r);
    }
    async function onPdf() {
        const sel = selected(); if (!sel.length || st.busy) return;
        if (!(window.jspdf && window.jspdf.jsPDF)) return toast('La librería de PDF aún se está cargando. Inténtalo en unos segundos.', 'error');
        const missing = sel.filter(e => !hasQr(e));
        if (missing.length) { const r = await generate(missing); reportGen(r); if (!r) { setBusy(false); return; } }
        const ready = sel.filter(hasQr).sort(cmp);
        setBusy(true, 'Armando el PDF…');
        try {
            await new Promise(r => setTimeout(r, 30));
            buildPdf(ready, Number($('qrm-layout').value));
            toast(`PDF generado con ${ready.length} código(s) QR.` + (ready.length < sel.length ? ` ${sel.length - ready.length} equipo(s) quedaron fuera por no tener QR.` : ''));
        } catch (err) { console.error(err); toast('No se pudo generar el PDF: ' + (err.message || err), 'error'); }
        setBusy(false); render(true);
    }
    function onSelectAll() {
        const all = filtered(), allSel = all.length > 0 && all.every(e => st.sel.has(kid(e)));
        all.forEach(e => allSel ? st.sel.delete(kid(e)) : st.sel.add(kid(e)));
        render(true);
    }
    function showPreview(id) {
        const eq = equipmentCatalog.find(e => kid(e) === id); if (!eq || !hasQr(eq)) return;
        st.pv = eq; drawQr($('qrm-pv-canvas'), eq.qr, 300);
        $('qrm-pv-name').textContent = eq.name || eq.code || '-';
        $('qrm-pv-client').textContent = cname(eq) || '-';
        $('qrm-pv-id').textContent = 'ID: ' + kid(eq);
        const d = eq.qr.createdAt ? new Date(eq.qr.createdAt) : null;
        $('qrm-pv-meta').textContent = 'Generado' + (d && !isNaN(d) ? ' el ' + d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '') + (eq.qr.createdBy ? ' por ' + eq.qr.createdBy : '');
        $('qrm-prev').classList.add('open');
    }

    /* ---------- abrir / cerrar ---------- */
    function open() {
        try { if (!document.getElementById('eq-filter-client').options.length) populateClientDropdowns(); } catch (_) {}
        $('qrm-client').value = 'ALL'; fillClients();
        $('qrm-search').value = ''; $('qrm-status').value = 'ALL'; st.shown = 60;
        refreshBaseUi();
        $('qrm-back').classList.add('open'); $('qrm-back').setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        render(false);
        clearInterval(st.timer);
        st.timer = setInterval(() => {   // los equipos se cargan por tandas: refresca cuando llegan más
            const loading = typeof eqBackgroundLoading !== 'undefined' && eqBackgroundLoading;
            if (isOpen() && !st.busy && (equipmentCatalog.length !== st.lastLen || st.lastClients !== (clientsCatalog || []).length || !!loading !== st.lastLoading)) render(true);
        }, 1200);
        loadLib().catch(() => {});   // precarga silenciosa
    }
    function close() {
        $('qrm-prev').classList.remove('open');
        $('qrm-back').classList.remove('open'); $('qrm-back').setAttribute('aria-hidden', 'true');
        document.body.style.overflow = ''; clearInterval(st.timer); st.timer = null;
    }
    window.openQrModal = open;

    /* ---------- eventos ---------- */
    $('qrm-close').addEventListener('click', close);
    $('qrm-all').addEventListener('click', onSelectAll);
    $('qrm-gen').addEventListener('click', onGenMissing);
    $('qrm-pdf').addEventListener('click', onPdf);
    $('qrm-pv-close').addEventListener('click', () => $('qrm-prev').classList.remove('open'));
    $('qrm-pv-png').addEventListener('click', () => { if (st.pv && hasQr(st.pv)) downloadPng(st.pv); });
    let searchT; $('qrm-search').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => { st.shown = 60; render(false); }, 180); });
    ['qrm-client', 'qrm-status'].forEach(id => $(id).addEventListener('change', () => { st.shown = 60; render(false); }));
    $('qrm-base').addEventListener('change', () => {
        const v = $('qrm-base').value.trim();
        try { v ? localStorage.setItem(BASE_KEY, v) : localStorage.removeItem(BASE_KEY); } catch (_) {}
        refreshBaseUi(); st.warnedLocal = false;
    });
    const list = $('qrm-list');
    list.addEventListener('click', ev => {
        const act = ev.target.closest('[data-act]');
        if (act) {
            const a = act.dataset.act, id = act.dataset.id;
            if (a === 'more') { st.shown += 60; render(true); }
            else if (a === 'png') { const e = equipmentCatalog.find(x => kid(x) === id); if (e && hasQr(e)) downloadPng(e); }
            else if (a === 'view') showPreview(id);
            else if (a === 'gen') onGenOne(id);
            return;
        }
        if (ev.target.closest('.qrm-cb')) return;
        const row = ev.target.closest('.qrm-row');
        if (row) { const cb = row.querySelector('.qrm-cb'); if (cb) cb.click(); }
    });
    list.addEventListener('change', ev => {
        const cb = ev.target.closest('.qrm-cb'); if (!cb) return;
        cb.checked ? st.sel.add(cb.dataset.id) : st.sel.delete(cb.dataset.id);
        const row = cb.closest('.qrm-row'); if (row) row.classList.toggle('sel', cb.checked);
        updateBar(filtered());
    });
    document.addEventListener('keydown', ev => {
        if (ev.key !== 'Escape' || !isOpen()) return;
        if ($('qrm-prev').classList.contains('open')) $('qrm-prev').classList.remove('open'); else close();
    });
})();
