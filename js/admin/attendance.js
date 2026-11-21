
/* ===== Historial y Auditoría de Asistencia (admin) ===== */
let attRows = [];
function attInit() {
    const f = document.getElementById('att-f-from'), t = document.getElementById('att-f-to');
    const today = new Date().toLocaleDateString('en-CA');
    if (!f.value) f.value = today.slice(0, 8) + '01';
    if (!t.value) t.value = today;
    const ts = document.getElementById('att-f-tech'), cs = document.getElementById('att-f-client');
    const pt = ts.value, pc = cs.value;
    ts.innerHTML = '<option value="">Todos</option>' + systemUsers.filter(u => u.role !== 'ADMIN').map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('');
    cs.innerHTML = '<option value="">Todas</option>' + getSortedUniqueClientNames(clientsCatalog.map(c => c.name)).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    ts.value = pt; cs.value = pc;
    if (!attRows.length) attLoad();
}
async function attLoad() {
    const v = id => document.getElementById(id).value;
    let q = 'asistencia?select=*&order=hora.desc&limit=2000';
    if (v('att-f-from')) q += '&fecha=gte.' + v('att-f-from');
    if (v('att-f-to')) q += '&fecha=lte.' + v('att-f-to');
    if (v('att-f-tech')) q += '&tecnico_nombre=eq.' + encodeURIComponent(v('att-f-tech'));
    if (v('att-f-client')) q += '&cliente_nombre=eq.' + encodeURIComponent(v('att-f-client'));
    const body = document.getElementById('att-table-body'), empty = document.getElementById('att-empty');
    empty.style.display = 'block'; empty.textContent = 'Consultando…';
    const rows = await supabaseFetch(q, 'GET');
    if (!Array.isArray(rows)) { empty.textContent = 'No se pudo consultar. ¿Ejecutaste el SQL de la tabla "asistencia" en Supabase?'; body.innerHTML = ''; return false; }
    const st = v('att-f-state');
    attRows = rows.map(attFix).filter(r => !st || (st === 'in' && r.dentro_rango === true) || (st === 'out' && r.dentro_rango === false) || (st === 'none' && r.dentro_rango == null));
    attRender();
    return true;
}
function attRender() {
    const body = document.getElementById('att-table-body'), empty = document.getElementById('att-empty');
    const k = { in: 0, out: 0, none: 0 };
    attRows.forEach(r => { if (r.dentro_rango === true) k.in++; else if (r.dentro_rango === false) k.out++; else k.none++; });
    document.getElementById('att-k-total').textContent = attRows.length;
    document.getElementById('att-k-in').textContent = k.in; document.getElementById('att-k-out').textContent = k.out; document.getElementById('att-k-none').textContent = k.none;
    empty.style.display = attRows.length ? 'none' : 'block'; empty.textContent = 'Sin marcaciones para los filtros seleccionados.';
    body.innerHTML = attRows.map(r => {
        let badge = r.dentro_rango === true ? '<span class="bg-emerald-50 text-emerald-700 border border-emerald-200 font-black px-2 py-1 rounded-full">Dentro de rango</span>'
            : r.dentro_rango === false ? '<span class="bg-rose-50 text-rose-700 border border-rose-200 font-black px-2 py-1 rounded-full">Fuera de rango</span>'
            : '<span class="bg-amber-50 text-amber-700 border border-amber-200 font-black px-2 py-1 rounded-full">Sede sin coordenadas</span>';
        if (r._recalc) badge += ' <i class="fa-solid fa-rotate text-slate-400" title="Reevaluada con la ubicación actual del cliente"></i>';
        const tipo = r.tipo === 'CHECK-IN' ? '<span class="text-emerald-700 font-black">ENTRADA</span>' : '<span class="text-amber-700 font-black">SALIDA</span>';
        const dist = r.distancia_m == null ? '—' : `${esc(r.distancia_m)} m / ${esc(r.radio_permitido_m)} m`;
        const map = r.lat != null ? `<a class="text-blue-600 font-bold" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${encodeURIComponent(r.lat + ',' + r.lng)}"><i class="fa-solid fa-map-location-dot"></i> Ver</a>` : '—';
        return `<tr class="border-b border-slate-50"><td class="p-3 font-mono">${esc(r.fecha)}</td><td class="p-3 font-mono">${esc(new Date(r.hora).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }))}</td><td class="p-3 font-bold">${esc(r.tecnico_nombre)}</td><td class="p-3">${esc(r.cliente_nombre)}</td><td class="p-3">${tipo}</td><td class="p-3 font-mono">${dist}</td><td class="p-3">${badge}</td><td class="p-3">${map}</td><td class="p-3">${r.foto_url ? `<a href="${esc(r.foto_url)}" target="_blank" rel="noopener"><img src="${esc(r.foto_url)}" loading="lazy" class="w-9 h-9 rounded-lg object-cover" alt="Foto"></a>` : '—'}</td><td class="p-3 whitespace-nowrap">${attIsAdmin() ? `<button type="button" onclick="attEdit('${esc(r.id)}')" class="inline-flex items-center justify-center w-10 h-10 align-middle rounded-xl text-blue-600 hover:bg-blue-50" title="Editar"><i class="fa-solid fa-pen"></i></button><button type="button" onclick="attDelete('${esc(r.id)}')" class="inline-flex items-center justify-center w-10 h-10 align-middle rounded-xl text-rose-600 hover:bg-rose-50" title="Eliminar"><i class="fa-solid fa-trash"></i></button>` : ''}${r.motivo_edicion ? `<span class="text-[10px] text-amber-600 font-bold" title="${esc(r.motivo_edicion)}">editada</span>` : ''}</td></tr>`;
    }).join('');
}
function attExportCsv() {
    if (!attRows.length) return showToast('No hay datos para exportar.', 'error');
    const cols = ['fecha', 'hora', 'tecnico_nombre', 'cliente_nombre', 'tipo', 'distancia_m', 'radio_permitido_m', 'dentro_rango', 'lat', 'lng', 'precision_m'];
    const csv = [cols.join(',')].concat(attRows.map(r => cols.map(c => '"' + String(r[c] == null ? '' : r[c]).replace(/"/g, '""') + '"').join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'asistencia_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
}
/* ===== Reevaluación del rango GPS con la ubicación ACTUAL del cliente =====
   El estado "dentro/fuera de rango" se calcula siempre contra las coordenadas y el radio vigentes del cliente:
   al corregir la ubicación, todas las marcaciones (pasadas y futuras) se reevalúan solas. */
const ATT_RADIO_DEFAULT_M = 150;                                   // mismo radio por defecto que la app del técnico
function attNum(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
function attDistance(lat1, lng1, lat2, lng2) {                     // Haversine, idéntico al de la app del técnico
    const R = 6371000, k = Math.PI / 180, dLat = (lat2 - lat1) * k, dLng = (lng2 - lng1) * k;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * k) * Math.cos(lat2 * k) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}
function attClientOf(r) {
    const id = r.cliente_id != null ? String(r.cliente_id) : '';
    return (id && clientsCatalog.find(c => String(c.id) === id)) || clientsCatalog.find(c => normText(c.name) === normText(r.cliente_nombre)) || null;
}
function attGeoOf(c) {
    const lat = attNum(c.lat) ?? attNum(c.latitud), lng = attNum(c.lng) ?? attNum(c.longitud);
    return { lat, lng, radius: parseInt(c.geoRadius, 10) || ATT_RADIO_DEFAULT_M };
}
function attFix(r) {                                               // devuelve una copia con el estado recalculado (o la misma fila si no aplica)
    const c = attClientOf(r);
    if (!c || attNum(r.lat) == null || attNum(r.lng) == null) return r;
    const g = attGeoOf(c), o = Object.assign({}, r);
    o.radio_permitido_m = g.radius;
    if (g.lat == null || g.lng == null) { o.sede_lat = null; o.sede_lng = null; o.distancia_m = null; o.dentro_rango = null; }
    else { o.sede_lat = g.lat; o.sede_lng = g.lng; o.distancia_m = Math.round(attDistance(+r.lat, +r.lng, g.lat, g.lng)); o.dentro_rango = o.distancia_m <= g.radius; }
    o._recalc = o.dentro_rango !== r.dentro_rango;                  // true = el estado cambió respecto a lo guardado
    return o;
}
const attGeoSig = c => { if (!c) return ''; const g = attGeoOf(c); return [g.lat, g.lng, g.radius, String(c.address || '').trim().toLowerCase()].join('|'); };
const attSameGeo = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(+a - +b) < 1e-7);
// Guarda en la base de datos el estado corregido (si el servidor lo permite). Sin permisos, la vista sigue reevaluándose dinámicamente.
async function attPersistClientRecalc(client) {
    const enc = encodeURIComponent, qo = { quiet: true };
    const [a, b] = await Promise.all([
        supabaseFetch('asistencia?select=*&cliente_id=eq.' + enc(String(client.id)) + '&order=hora.asc&limit=5000', 'GET', null, null, qo),
        supabaseFetch('asistencia?select=*&cliente_id=is.null&cliente_nombre=eq.' + enc(client.name) + '&order=hora.asc&limit=5000', 'GET', null, null, qo)]);
    const rows = [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []);
    const todo = [];
    rows.forEach(r => { const f = attFix(r); if (f !== r && (f.dentro_rango !== r.dentro_rango || f.distancia_m !== r.distancia_m || f.radio_permitido_m !== r.radio_permitido_m || !attSameGeo(f.sede_lat, r.sede_lat) || !attSameGeo(f.sede_lng, r.sede_lng))) todo.push([r, f]); });
    const out = { total: rows.length, changed: todo.length, flipped: todo.filter(([r, f]) => f.dentro_rango !== r.dentro_rango).length, saved: 0 };
    if (!todo.length || !attIsAdmin()) return out;
    const me = attMe(), motivo = 'Recálculo automático por cambio de ubicación del cliente ' + client.name;
    const send = async ([r, f]) => {
        const patch = {};
        ['tipo', 'fecha', 'hora', 'tecnico_id', 'tecnico_nombre', 'cliente_id', 'cliente_nombre'].forEach(k => { if (r[k] != null) patch[k] = r[k]; });
        Object.assign(patch, { sede_lat: f.sede_lat, sede_lng: f.sede_lng, radio_permitido_m: f.radio_permitido_m, distancia_m: f.distancia_m, dentro_rango: f.dentro_rango });
        return attRpc('admin_asistencia_update', { p_admin_id: String(me.id), p_hash: me.passwordHash || '', p_id: r.id, p_patch: patch, p_motivo: motivo });
    };
    const first = await send(todo[0]);                              // prueba: ¿el servidor acepta y guarda estos campos?
    if (!first.ok) return out;
    const chk = await supabaseFetch('asistencia?select=id,dentro_rango,distancia_m&id=eq.' + enc(todo[0][0].id), 'GET', null, null, qo);
    if (!(Array.isArray(chk) && chk[0] && chk[0].dentro_rango === todo[0][1].dentro_rango && chk[0].distancia_m === todo[0][1].distancia_m)) return out;   // el servidor ignora estos campos
    out.saved = 1;
    let i = 1;
    await Promise.all(Array.from({ length: 4 }, async () => { while (i < todo.length) { const it = todo[i++]; if ((await send(it)).ok) out.saved++; } }));
    return out;
}
async function attAfterClientSaved(client, prev) {
    if (prev && attGeoSig(prev) === attGeoSig(client)) return;     // ubicación, dirección y radio sin cambios
    const v = document.getElementById('view-admin-attendance');
    if (v && !v.classList.contains('hidden')) attLoad();           // la vista ya se reevalúa con la ubicación nueva
    try {
        const r = await attPersistClientRecalc(client);
        if (r.changed) showToast(r.changed + ' marcación(es) reevaluada(s) con la nueva ubicación' + (r.flipped ? ' (' + r.flipped + ' cambiaron de estado)' : '') + (r.saved ? ' y actualizadas.' : '.'));
        if (r.saved && v && !v.classList.contains('hidden')) attLoad();
    } catch (e) { console.warn('recálculo de marcaciones', e); }
}

/* ===== Exportar a Excel (Asistencia y GPS): tabla limpia, cronológica y con formato ===== */
let attXlsxStyleP = null;
function attLoadStyledXlsx() {            // SheetJS gratuito no escribe estilos; xlsx-js-style es compatible y los añade. Si no carga, se exporta sin colores.
    if (window.__xlsxStyled) return Promise.resolve(true);
    if (!attXlsxStyleP) attXlsxStyleP = new Promise(res => {
        const t = setTimeout(() => res(false), 8000), sc = document.createElement('script');
        sc.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
        sc.onload = () => { clearTimeout(t); window.__xlsxStyled = true; res(true); };
        sc.onerror = () => { clearTimeout(t); res(false); };
        document.head.appendChild(sc);
    });
    return attXlsxStyleP;
}
async function attExportXlsx() {
    if (!attRows.length) return showToast('No hay datos para exportar.', 'error');
    if (!window.XLSX) return showToast('No se pudo cargar el generador de Excel. Verifica tu conexión.', 'error');
    const styled = await attLoadStyledXlsx(), X = window.XLSX;
    const rows = [...attRows].sort((a, b) => (new Date(a.hora) - new Date(b.hora)) || String(a.fecha).localeCompare(String(b.fecha)));   // cronológico ascendente
    const HEAD = ['Fecha', 'Hora', 'Técnico', 'Cliente', 'Tipo de Marcación', 'Coordenadas / Ubicación GPS', 'Distancia a la sede (m)', 'Radio permitido (m)', 'Estado de rango', 'Precisión GPS (m)'];
    const thin = c => ({ style: 'thin', color: { rgb: c } }), box = c => ({ top: thin(c), bottom: thin(c), left: thin(c), right: thin(c) });
    const sHead = { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, fill: { patternType: 'solid', fgColor: { rgb: '0F766E' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: box('0B5C56') };
    const body = (zebra, h, extra) => Object.assign({ font: { sz: 10, color: { rgb: '0F172A' } }, alignment: { horizontal: h, vertical: 'center' }, border: box('E2E8F0') }, zebra ? { fill: { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } } } : {}, extra || {});
    const ws = {}, put = (r, c, cell) => { ws[X.utils.encode_cell({ r, c })] = cell; };
    const text = (v, s) => ({ t: 's', v: String(v == null ? '' : v), s });
    HEAD.forEach((h, c) => put(0, c, text(h, sHead)));
    const widths = HEAD.map(h => Math.min(30, Math.max(10, h.length * 0.9)));
    const grow = (c, str) => { widths[c] = Math.min(46, Math.max(widths[c], String(str).length + 2)); };
    rows.forEach((r, i) => {
        const R = i + 1, z = i % 2 === 1, d = new Date(r.hora), m = String(r.fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        put(R, 0, m ? { t: 'n', v: Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 864e5), z: 'dd/mm/yyyy', s: body(z, 'center') } : text(r.fecha, body(z, 'center')));
        put(R, 1, isNaN(d) ? text('', body(z, 'center')) : { t: 'n', v: (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400, z: 'hh:mm', s: body(z, 'center') });
        put(R, 2, text(r.tecnico_nombre, body(z, 'left'))); grow(2, r.tecnico_nombre || '');
        put(R, 3, text(r.cliente_nombre, body(z, 'left'))); grow(3, r.cliente_nombre || '');
        put(R, 4, text(r.tipo === 'CHECK-IN' ? 'ENTRADA' : 'SALIDA', body(z, 'center', { font: { sz: 10, bold: true, color: { rgb: r.tipo === 'CHECK-IN' ? '047857' : 'B45309' } } })));
        const lat = attNum(r.lat), lng = attNum(r.lng);
        if (lat != null && lng != null) {
            const g = lat.toFixed(6) + ', ' + lng.toFixed(6);
            put(R, 5, { t: 's', v: g, l: { Target: 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng), Tooltip: 'Abrir en Google Maps' }, s: body(z, 'left', { font: { sz: 10, color: { rgb: '2563EB' }, underline: true } }) }); grow(5, g);
        } else put(R, 5, text('Sin GPS', body(z, 'left', { font: { sz: 10, italic: true, color: { rgb: '94A3B8' } } })));
        const num = (c, v) => put(R, c, attNum(v) == null ? text('', body(z, 'center')) : { t: 'n', v: attNum(v), z: '#,##0', s: body(z, 'center') });
        num(6, r.distancia_m); num(7, r.radio_permitido_m);
        const st = r.dentro_rango === true ? ['Dentro de rango', '047857'] : r.dentro_rango === false ? ['Fuera de rango', 'BE123C'] : ['Sede sin coordenadas', 'B45309'];
        put(R, 8, text(st[0], body(z, 'center', { font: { sz: 10, bold: true, color: { rgb: st[1] } } }))); grow(8, st[0]);
        num(9, r.precision_m);
    });
    ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: HEAD.length - 1 } });
    ws['!cols'] = widths.map(w => ({ wch: Math.round(w) }));
    ws['!rows'] = [{ hpt: 30 }];
    ws['!autofilter'] = { ref: ws['!ref'] };
    ws['!freeze'] = { xSplit: '0', ySplit: '1', topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Asistencia y GPS');
    const f = document.getElementById('att-f-from').value, t = document.getElementById('att-f-to').value;
    X.writeFile(wb, 'Asistencia_GPS_' + (f || 'inicio') + (t ? '_a_' + t : '') + '.xlsx', { cellStyles: true });
    showToast('Excel descargado: ' + rows.length + ' marcación(es)' + (styled ? '.' : ' (formato básico).'));
}
