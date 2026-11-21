
/* ===== Programación de Personal (dentro de Planificación) ===== */
let progItems = [];
const PROG_T = { PREVENTIVO: ['#0d9488', '#ccfbf1', 'Preventivo'], CORRECTIVO: ['#e11d48', '#ffe4e6', 'Correctivo'], VISITA_LIBRE: ['#7c3aed', '#ede9fe', 'Visita libre'] };
const progEl = id => document.getElementById(id);
const progISO = d => d.toLocaleDateString('en-CA');
const progParse = s => new Date(s + 'T12:00:00');
const progTechs = () => systemUsers.filter(u => u.role !== 'ADMIN');
const progTechName = id => (systemUsers.find(u => String(u.id) === String(id)) || {}).name || id;
const progClientName = id => (clientsCatalog.find(c => String(c.id) === String(id)) || {}).name || '';
const progLong = s => { const t = progParse(s).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
function planTab(t) {
    const sec = progEl('view-admin-planning');
    [...sec.children].forEach(c => { if (c.id === 'plan-tabs' || c.id === 'prog-modal') return; if (c.id === 'prog-panel') return c.classList.toggle('hidden', t !== 'prog');
        if (t === 'prog') { if (!c.classList.contains('hidden')) { c.classList.add('hidden'); c.dataset.ph = '1'; } } else if (c.dataset.ph) { c.classList.remove('hidden'); delete c.dataset.ph; } });
    progEl('plan-tab-main').className = t === 'main' ? 'plan-tab btn-teal text-xs' : 'plan-tab text-xs font-bold bg-slate-100 hover:bg-slate-200 rounded-xl';
    progEl('plan-tab-prog').className = t === 'prog' ? 'plan-tab btn-teal text-xs' : 'plan-tab text-xs font-bold bg-slate-100 hover:bg-slate-200 rounded-xl';
    if (t === 'prog') { if (!progEl('prog-date').value) progEl('prog-date').value = progISO(new Date()); progLoad(); }
}
function progRange() {
    const d = progParse(progEl('prog-date').value), wk = progEl('prog-view').value === 'week';
    if (!wk) return [d, new Date(d.getTime() + 864e5)];
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return [mon, new Date(mon.getTime() + 7 * 864e5)];
}
function progDays() { const [a, b] = progRange(), out = []; for (let d = new Date(a); d < b; d.setDate(d.getDate() + 1)) out.push(progISO(d)); return out; }
function progShift(n) { const d = progParse(progEl('prog-date').value); d.setDate(d.getDate() + n * (progEl('prog-view').value === 'week' ? 7 : 1)); progEl('prog-date').value = progISO(d); progLoad(); }
function progQuick(k) {
    const d = new Date(); if (k === 'tomorrow') d.setDate(d.getDate() + 1);
    if (k === 'sat') d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
    if (k === 'mon') d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    progEl('prog-date').value = progISO(d); progLoad();
}
async function progLoad() {
    if (!progEl('prog-date').value) progEl('prog-date').value = progISO(new Date());
    const [a, b] = progRange();
    const wk = await supabaseFetch(`programacion_personal?select=*&fecha_programada=gte.${progISO(a)}&fecha_programada=lt.${progISO(b)}&order=created_at.asc&limit=1000`, 'GET', null, null, { quiet: true });
    if (Array.isArray(wk)) progItems = wk; else showToast('No se pudo leer programacion_personal. ¿Ejecutaste el SQL V3?', 'error');
    progRender(); progRenderCard();
}
function progChip(it) {
    const t = PROG_T[it.tipo] || PROG_T.VISITA_LIBRE, where = progClientName(it.cliente_id) || it.lugar || '';
    return `<div draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${esc(it.id)}')" onclick="progOpen('${esc(it.id)}')" class="rounded-lg p-2 mb-1.5 cursor-grab text-[11px] leading-tight" style="background:${t[1]};border-left:4px solid ${t[0]}">
      <div class="font-black" style="color:${t[0]}">${esc(t[2])}</div>${where ? `<div class="font-bold text-slate-800">${esc(where)}</div>` : ''}${it.descripcion_labor ? `<div class="text-slate-600">${esc(it.descripcion_labor)}</div>` : ''}</div>`;
}
function progRender() {
    const days = progDays(), techs = progTechs();
    if (!techs.length) return progEl('prog-board').innerHTML = '<div class="p-6 text-xs text-slate-400">No hay técnicos registrados.</div>';
    let h = `<div style="display:grid;grid-template-columns:130px repeat(${days.length},minmax(${days.length > 1 ? 150 : 260}px,1fr));gap:6px;min-width:${130 + days.length * (days.length > 1 ? 156 : 266)}px">`;
    h += '<div></div>' + days.map(d => `<div class="text-[11px] font-black text-slate-700 text-center py-1.5 rounded-lg bg-slate-100">${esc(progParse(d).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }))}</div>`).join('');
    techs.forEach(t => {
        h += `<div class="text-xs font-black text-slate-800 flex items-center">${esc(t.name)}</div>`;
        days.forEach(d => {
            const list = progItems.filter(i => String(i.tecnico_id) === String(t.id) && i.fecha_programada === d);
            h += `<div ondragover="event.preventDefault();this.style.background='#f0fdfa'" ondragleave="this.style.background=''" ondrop="progDrop(event,'${esc(t.id)}','${d}');this.style.background=''" class="rounded-lg border border-dashed border-slate-300 p-1.5" style="min-height:74px">${list.map(progChip).join('')}
              <button type="button" onclick="progOpen('','${esc(t.id)}','${d}')" class="w-full text-slate-400 hover:text-teal-600 text-sm font-black">+</button></div>`;
        });
    });
    progEl('prog-board').innerHTML = h + '</div>';
}
async function progDrop(ev, techId, date) {
    ev.preventDefault();
    const it = progItems.find(i => String(i.id) === ev.dataTransfer.getData('text/plain')); if (!it) return;
    if (String(it.tecnico_id) === String(techId) && it.fecha_programada === date) return;
    const old = { t: it.tecnico_id, d: it.fecha_programada };
    it.tecnico_id = techId; it.fecha_programada = date; progRender(); progRenderCard();
    const r = await supabaseFetch('programacion_personal?id=eq.' + encodeURIComponent(it.id), 'PATCH', { tecnico_id: techId, fecha_programada: date }, { Prefer: 'return=minimal' });
    if (!r) { it.tecnico_id = old.t; it.fecha_programada = old.d; progRender(); progRenderCard(); showToast('No se pudo mover la labor.', 'error'); }
}
function progOpen(id, techId, date) {
    const it = id ? progItems.find(i => String(i.id) === String(id)) : null;
    progEl('prog-m-tech').innerHTML = progTechs().map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    progEl('prog-m-client').innerHTML = '<option value="">— Sin cliente —</option>' + getSortedClientRecords().filter(isClientActiveRecord).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    progEl('prog-m-id').value = it ? it.id : '';
    progEl('prog-m-title').textContent = it ? 'Editar labor' : 'Nueva labor';
    progEl('prog-m-tech').value = it ? it.tecnico_id : (techId || '');
    progEl('prog-m-date').value = it ? it.fecha_programada : (date || progEl('prog-date').value);
    progEl('prog-m-type').value = it ? it.tipo : 'VISITA_LIBRE';
    progEl('prog-m-client').value = it && it.cliente_id ? it.cliente_id : '';
    progEl('prog-m-place').value = it ? (it.lugar || '') : '';
    progEl('prog-m-desc').value = it ? (it.descripcion_labor || '') : '';
    progFillOrders(it && it.orden_id);
    progEl('prog-m-del').classList.toggle('hidden', !it);
    progEl('prog-modal').classList.remove('hidden');
}
function progFillOrders(sel) {
    const cid = progEl('prog-m-client').value, name = progClientName(cid);
    const list = workOrders.filter(o => o && !String(o.id).startsWith('HIST-') && (!name || o.client === name) && String(o.status).toUpperCase() === 'PENDING').slice(0, 80);
    progEl('prog-m-order').innerHTML = '<option value="">— Sin orden —</option>' + list.map(o => `<option value="${esc(o.id)}">${esc(o.id)} · ${esc(o.client)} · ${esc(o.date)}</option>`).join('');
    if (typeof sel === 'string' && sel) { if (![...progEl('prog-m-order').options].some(o => o.value === sel)) progEl('prog-m-order').insertAdjacentHTML('beforeend', `<option value="${esc(sel)}">${esc(sel)}</option>`); progEl('prog-m-order').value = sel; }
}
function progCloseModal() { progEl('prog-modal').classList.add('hidden'); }
async function progSave() {
    const g = id => progEl(id).value.trim(), id = g('prog-m-id') || crypto.randomUUID();
    if (!g('prog-m-tech') || !g('prog-m-date')) return showToast('Selecciona el técnico y la fecha.', 'error');
    const rec = { id, tecnico_id: g('prog-m-tech'), cliente_id: g('prog-m-client') || null, orden_id: g('prog-m-order') || null, fecha_programada: g('prog-m-date'),
        descripcion_labor: g('prog-m-desc') || null, tipo: g('prog-m-type'), lugar: g('prog-m-place') || null };   // cliente, orden y descripción son opcionales
    const r = await supabaseFetch('programacion_personal?on_conflict=id', 'POST', rec, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    if (!r) return showToast('No se pudo guardar la labor.', 'error');
    registrarAuditoria('SAVE', 'programacion_personal', id);
    progCloseModal(); progEl('prog-date').value = rec.fecha_programada; progLoad(); showToast('Labor guardada.');
}
async function progDelete() {
    const id = progEl('prog-m-id').value; if (!id || !confirm('¿Eliminar esta labor?')) return;
    const r = await supabaseFetch('programacion_personal?id=eq.' + encodeURIComponent(id), 'DELETE');
    if (!r) return showToast('No se pudo eliminar.', 'error');
    registrarAuditoria('DELETE', 'programacion_personal', id); progCloseModal(); progLoad();
}
/* ---- Tarjeta visual (se convierte a imagen) ---- */
const progHeaderText = () => 'Buen día, envío programación de ' + progLong(progEl('prog-date').value);
function progRenderCard() {
    const day = progEl('prog-date').value; if (!day) return;
    const rows = progTechs().map(t => ({ t, list: progItems.filter(i => String(i.tecnico_id) === String(t.id) && i.fecha_programada === day) })).filter(r => r.list.length);
    const logo = typeof AFC_HEADER_IMG === 'string' && AFC_HEADER_IMG ? `<img src="${AFC_HEADER_IMG}" style="width:100%;display:block">` : '';
    progEl('prog-card').innerHTML = `<div id="prog-card-inner" style="width:760px;background:#fff;font-family:Inter,Arial,sans-serif;color:#0f172a;border:1px solid #cbd5e1">
      ${logo}<div style="background:#1b365d;color:#fff;padding:16px 20px;font-size:17px;font-weight:800">${esc(progHeaderText())}</div>
      <div style="padding:14px 16px">${rows.length ? rows.map(r => `<div style="display:flex;gap:12px;margin-bottom:12px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="width:150px;background:#f1f5f9;padding:12px;font-weight:800;font-size:14px;display:flex;align-items:center">${esc(r.t.name)}</div>
        <div style="flex:1;padding:8px 10px">${r.list.map(i => { const [c, bg, tl] = PROG_T[i.tipo] || PROG_T.VISITA_LIBRE, where = progClientName(i.cliente_id) || i.lugar || '';
          return `<div style="border-left:5px solid ${c};background:${bg};border-radius:6px;padding:7px 10px;margin:5px 0">
          <div style="font-size:13px;font-weight:800">${esc(where || tl)} <span style="font-size:10px;font-weight:800;color:#fff;background:${c};border-radius:99px;padding:2px 8px;margin-left:6px">${tl}</span></div>
          ${i.descripcion_labor ? `<div style="font-size:12px;color:#334155;margin-top:2px">${esc(i.descripcion_labor)}</div>` : ''}</div>`; }).join('')}</div></div>`).join('')
        : '<div style="padding:30px;text-align:center;color:#94a3b8;font-size:13px">Sin labores programadas para este día.</div>'}
      <div style="font-size:10px;color:#94a3b8;text-align:right">Alejandro Faccini &amp; Cia S.A.S.</div></div></div>`;
}
/* Exportar TODA la programación a Excel: una fila por sede/asignación */
async function progExportExcel() {
    const rows = []; let off = 0;
    for (;;) {
        const r = await supabaseFetch(`programacion_personal?select=*&order=fecha_programada.asc,created_at.asc&limit=1000&offset=${off}`, 'GET', null, null, { quiet: true });
        if (!Array.isArray(r)) { if (!off) return showToast('No se pudo leer la planificación.', 'error'); break; }
        rows.push(...r); if (r.length < 1000) break; off += 1000;
    }
    if (!rows.length) return showToast('No hay planificación registrada.', 'error');
    rows.sort((x, y) => x.fecha_programada.localeCompare(y.fecha_programada) || String(progTechName(x.tecnico_id)).localeCompare(String(progTechName(y.tecnico_id))) || String(x.created_at).localeCompare(String(y.created_at)));
    const head = ['Fecha', 'Nombre del Técnico', 'Cliente / Sede Asignada', 'Labor / Descripción'];
    const data = rows.map(r => [progParse(r.fecha_programada), progTechName(r.tecnico_id), progClientName(r.cliente_id) || r.lugar || '', r.descripcion_labor || '']);
    const stamp = progISO(new Date());
    if (window.XLSX) {
        const ws = XLSX.utils.aoa_to_sheet([head].concat(data), { cellDates: true });
        ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 38 }, { wch: 52 }];
        for (let i = 2; i <= data.length + 1; i++) { const c = ws['A' + i]; if (c) { c.t = 'd'; c.z = 'dd/mm/yyyy'; } }
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Planificación');
        XLSX.writeFile(wb, 'planificacion_' + stamp + '.xlsx', { cellDates: true });
    } else {
        const q = v => '"' + String(v).replace(/"/g, '""') + '"';
        const csv = [head].concat(data.map(r => [progISO(r[0]).split('-').reverse().join('/'), r[1], r[2], r[3]])).map(r => r.map(q).join(',')).join('\n');
        const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); el.download = 'planificacion_' + stamp + '.csv'; el.click();
    }
    showToast('Planificación exportada (' + data.length + ' filas).');
}
function progLoadH2C() {
    if (window.html2canvas) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function progSendWhatsApp() {
    progRenderCard();
    const text = progHeaderText(), link = progEl('prog-wa-link');
    try { await progLoadH2C(); } catch (e) { return showToast('No se pudo cargar html2canvas (sin conexión).', 'error'); }
    const canvas = await html2canvas(progEl('prog-card-inner'), { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const file = new File([blob], 'programacion_' + progEl('prog-date').value + '.png', { type: 'image/png' });
    const wa = 'https://wa.me/?text=' + encodeURIComponent(text);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {          // móvil: hoja de compartir (incluye WhatsApp con la imagen)
        try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    let copied = false;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true; } catch (e) {}
    if (!copied) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); }
    link.href = wa; link.classList.remove('hidden');
    window.open(wa, '_blank');
    showToast(copied ? 'Imagen copiada: pégala en el chat de WhatsApp (Ctrl+V).' : 'Imagen descargada: adjúntala en el chat de WhatsApp.');
}
