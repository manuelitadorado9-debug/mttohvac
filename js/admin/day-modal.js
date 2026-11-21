
/* ===== Calendario: detalle del día (rutinas, reportes, personal programado y asistencia) ===== */
const dmEq = id => (typeof equipmentCatalog !== 'undefined' && equipmentCatalog.find(e => e && (e.id === id || e.code === id))) || null;
const dmTime = iso => { try { return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
const dmLong = d => { const t = new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
function planDayClose() { document.getElementById('day-modal').classList.add('hidden'); }
function dmStatus(o, done, total) {
    const st = String(o.status || 'PENDING').toUpperCase();
    if (st === 'COMPLETED' || (total && done >= total)) return ['Completada', '#16a34a'];
    if (done > 0) return ['En ejecución', '#2563eb'];
    return ['Pendiente', '#d97706'];
}
async function planDayOpen(day) {
    const body = document.getElementById('dm-body');
    document.getElementById('dm-title').textContent = dmLong(day);
    document.getElementById('dm-sub').textContent = 'Cargando actividades…';
    body.innerHTML = '<div class="dm-empty">Cargando…</div>';
    document.getElementById('dm-add').onclick = () => { planDayClose(); planTab('prog'); progEl('prog-date').value = day; progLoad(); progOpen('', '', day); };
    document.getElementById('day-modal').classList.remove('hidden');
    // Datos remotos del día (programación y asistencia) en paralelo
    const [prog, asis] = await Promise.all([
        supabaseFetch('programacion_personal?select=*&fecha_programada=eq.' + day + '&order=created_at.asc', 'GET', null, null, { quiet: true }),
        supabaseFetch('asistencia?select=*&fecha=eq.' + day + '&order=hora.asc', 'GET', null, null, { quiet: true })
    ]);
    const orders = workOrders.filter(o => o && !String(o.id).startsWith('HIST-')).filter(o => String(o.date || '').slice(0, 10) === day
        || Object.values(o.executions || {}).some(e => e && String(e.timestamp || '').slice(0, 10) === day));
    let nExec = 0, nPhotos = 0;
    const orderHtml = orders.map(o => {
        const ids = o.equipmentIds || [], seen = new Set(), execs = [];
        Object.entries(o.executions || {}).forEach(([k, e]) => { if (e && !seen.has(e)) { seen.add(e); execs.push([k, e]); } });
        const doneAll = execs.filter(([, e]) => !e.partial).length, total = ids.length || execs.length, pct = total ? Math.min(100, Math.round(doneAll / total * 100)) : 0;
        const [stTxt, stCol] = dmStatus(o, doneAll, total);
        const todayExecs = execs.filter(([, e]) => String(e.timestamp || '').slice(0, 10) === day);
        nExec += todayExecs.length;
        const techs = (typeof orderTechs === 'function' ? orderTechs(o) : [o.technician]).filter(Boolean);
        const eqHtml = todayExecs.map(([k, e]) => {
            const eq = dmEq(k), ph = Array.isArray(e.photos) ? e.photos : []; nPhotos += ph.length;
            return `<div class="dm-eq"><div class="dm-eq-top"><span>${esc((eq && (eq.code || eq.name)) || k)}${eq && eq.name && eq.code ? ' · ' + esc(eq.name) : ''}</span>
              <span style="display:flex;gap:6px;align-items:center">${e.corrective ? '<span class="dm-badge" style="color:#e11d48;border-color:#e11d4855;background:#e11d4814">Correctivo</span>' : '<span class="dm-badge" style="color:#16a34a;border-color:#16a34a55;background:#16a34a14">Ejecutado</span>'}<span class="dm-sub">${esc(dmTime(e.timestamp))}</span></span></div>
              ${e.obs ? `<div class="dm-sub" style="opacity:.85">“${esc(String(e.obs).slice(0, 160))}”</div>` : ''}${e.correctiveDesc ? `<div class="dm-sub" style="color:#e11d48">Correctivo: ${esc(String(e.correctiveDesc).slice(0, 160))}</div>` : ''}
              ${ph.length ? `<div class="dm-photos">${ph.slice(0, 8).map(p => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(p)}" loading="lazy" alt="Evidencia"></a>`).join('')}</div>` : ''}
              <div class="dm-actions">${typeof generateSingleEquipmentPDF === 'function' ? `<button type="button" onclick="generateSingleEquipmentPDF('${esc(o.id)}','${esc(k)}')"><i class="fa-solid fa-file-pdf"></i> Informe PDF</button>` : ''}</div></div>`;
        }).join('');
        return `<div class="dm-card" style="border-left-color:${stCol}">
          <div class="dm-top"><div style="min-width:0"><div class="dm-title">${esc(o.client || 'Sin cliente')}</div><div class="dm-sub">Orden ${esc(o.id)} · ${total} equipo(s)</div></div>
            <span class="dm-badge" style="color:${stCol};border-color:${stCol}55;background:${stCol}14">${stTxt}</span></div>
          <div class="dm-bar" title="${pct}%"><i style="width:${pct}%"></i></div><div class="dm-sub">${doneAll} de ${total} equipos con reporte · ${pct}%</div>
          ${techs.length ? `<div class="dm-chips">${techs.map(t => `<span class="dm-chip"><i class="fa-solid fa-user"></i> ${esc(t)}</span>`).join('')}</div>` : ''}
          ${eqHtml || '<div class="dm-empty">Sin reportes enviados este día.</div>'}
          <div class="dm-actions">${typeof openOrderHub === 'function' ? `<button type="button" class="pri" onclick="planDayClose();openOrderHub('${esc(o.id)}')"><i class="fa-solid fa-folder-open"></i> Abrir rutina</button>` : ''}</div></div>`;
    }).join('');
    const progList = Array.isArray(prog) ? prog : [];
    const progHtml = progList.map(i => { const t = (PROG_T[i.tipo] || PROG_T.VISITA_LIBRE); return `<div class="dm-row"><div style="min-width:0"><b>${esc(progTechName(i.tecnico_id))}</b> · ${esc(progClientName(i.cliente_id) || i.lugar || 'Sin lugar')}${i.descripcion_labor ? `<div class="dm-sub">${esc(i.descripcion_labor)}</div>` : ''}</div><span class="dm-badge" style="color:${t[0]};border-color:${t[0]}55;background:${t[1]}">${esc(t[2])}</span></div>`; }).join('');
    const marks = (Array.isArray(asis) ? asis : []).map(attFix);
    const markHtml = marks.map(m => { const ok = m.dentro_rango === true, bad = m.dentro_rango === false, c = ok ? '#16a34a' : bad ? '#e11d48' : '#d97706';
        return `<div class="dm-row"><div style="min-width:0"><b>${esc(m.tecnico_nombre)}</b> · ${m.tipo === 'CHECK-IN' ? 'Entrada' : 'Salida'} ${esc(dmTime(m.hora))}<div class="dm-sub">${esc(m.cliente_nombre)}${m.distancia_m != null ? ' · ' + esc(m.distancia_m) + ' m' : ''}</div></div>
          <span style="display:flex;align-items:center;gap:8px">${m.foto_url ? `<a href="${esc(m.foto_url)}" target="_blank" rel="noopener"><img src="${esc(m.foto_url)}" loading="lazy" alt="Foto" style="width:38px;height:38px;border-radius:9px;object-fit:cover"></a>` : ''}<span class="dm-badge" style="color:${c};border-color:${c}55;background:${c}14">${ok ? 'En rango' : bad ? 'Fuera de rango' : 'Sin coordenadas'}</span></span></div>`; }).join('');
    document.getElementById('dm-sub').textContent = orders.length + ' rutina(s) · ' + nExec + ' reporte(s) · ' + progList.length + ' labor(es) programada(s) · ' + marks.length + ' marcación(es)';
    body.innerHTML = `<div class="dm-sum">
        <div class="dm-kpi"><b>${orders.length}</b><span>Rutinas</span></div><div class="dm-kpi"><b>${nExec}</b><span>Reportes</span></div>
        <div class="dm-kpi"><b>${nPhotos}</b><span>Fotos</span></div><div class="dm-kpi"><b>${progList.length}</b><span>Programadas</span></div><div class="dm-kpi"><b>${marks.length}</b><span>Marcaciones</span></div></div>
      <div class="dm-sec"><h4><i class="fa-solid fa-screwdriver-wrench" style="color:#14b8a6"></i> Rutinas y reportes<small>${orders.length}</small></h4><div class="dm-body">${orderHtml || '<div class="dm-empty">No hay rutinas ni reportes para este día.</div>'}</div></div>
      <div class="dm-sec"><h4><i class="fa-solid fa-people-group" style="color:#7c3aed"></i> Personal programado<small>${progList.length}</small></h4><div class="dm-body">${progHtml || '<div class="dm-empty">Nadie programado este día.</div>'}</div></div>
      <div class="dm-sec"><h4><i class="fa-solid fa-location-crosshairs" style="color:#2563eb"></i> Asistencia<small>${marks.length}</small></h4><div class="dm-body">${markHtml || '<div class="dm-empty">Sin marcaciones este día.</div>'}</div></div>`;
}
(function () { const _s = window.saveClientRecord; if (typeof _s === 'function') window.saveClientRecord = async function () {      // al guardar un cliente, refresca Asistencia (el servidor recalcula las marcaciones sin coordenadas)
    const r = await _s.apply(this, arguments);
    setTimeout(() => { try { const v = document.getElementById('view-admin-attendance'); if (v && !v.classList.contains('hidden')) attLoad(); } catch (e) {} }, 2500);
    return r; }; })();
