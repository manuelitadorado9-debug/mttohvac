
/* ===== Historial completo de mantenimientos del equipo (solo lectura) ===== */
(function () {
  const dt = v => { const d = new Date(v); return isNaN(d) ? '-' : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }); };
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

  // Botón discreto en la cabecera del formulario de la rutina
  const head = document.querySelector('#exec-equipment-modal-backdrop .sheet-head');
  if (head && !document.getElementById('exec-last-btn')) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'exec-last-btn'; b.className = 'icon-btn lm-btn';
    b.title = 'Ver historial completo del equipo'; b.setAttribute('aria-label', 'Ver historial completo del equipo');
    b.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i>';
    b.onclick = () => window.lmOpen();
    head.appendChild(b);
  }

  const execOf = (o, keys) => { if (!o || !o.executions) return null; for (const k of keys) if (k && o.executions[k]) return o.executions[k]; return null; };

  async function findAll(eq, eqId, curOrderId) {
    const keys = [...new Set([eqId, eq && eq.id, eq && eq.code, cloudCleanId(eqId)].filter(Boolean).map(String))];
    const found = new Map();
    const add = o => {
      if (!o || !o.id || String(o.id) === String(curOrderId)) return;
      const ids = (o.equipmentIds || []).map(String);
      const ex = execOf(o, keys);
      if (ex || ids.some(id => keys.includes(id))) found.set(String(o.id), o);
    };
    (workOrders || []).forEach(add);
    if (navigator.onLine) {
      for (const k of keys) {
        const hkey = 'hist:all:' + k;
        let cached = egressGet(hkey, EGRESS.HIST_TTL_MS);
        let rows = cached ? JSON.parse(cached) : null;
        if (!Array.isArray(rows)) {
          rows = [];
          const cs = encodeURIComponent(JSON.stringify([k]));
          // Paginación real: no limitar el historial a las últimas 10 órdenes.
          for (let offset = 0; offset < 20000; offset += 500) {
            let page = null;
            if (!EGRESS.liteViewMissing) {
              page = await supabaseFetch(EGRESS.LITE_VIEW + '?select=payload&equipment_ids=cs.' + cs + '&order=date.desc&limit=500&offset=' + offset, 'GET', null, null, { quiet: true, noStore: true });
              if (!Array.isArray(page) && Number(cloudCtl.lastStatus) === 404) EGRESS.liteViewMissing = true;
            }
            if (!Array.isArray(page)) {
              const sel = 'select=id,date:payload->>date,client:payload->>client,technician:payload->>technician,technicians:payload->technicians,equipmentIds:payload->equipmentIds,maintenanceType:payload->>maintenanceType,type:payload->>type,executions:payload->executions';
              page = await supabaseFetch('hvac_orders?' + sel + '&payload->equipmentIds=cs.' + cs + '&order=payload->>date.desc&limit=500&offset=' + offset, 'GET', null, null, { quiet: true, noStore: true });
              if (Array.isArray(page)) page = page.map(r => ({payload:{id:r.id,date:r.date,client:r.client,technician:r.technician,technicians:r.technicians,equipmentIds:r.equipmentIds||[],maintenanceType:r.maintenanceType,type:r.type,executions:r.executions||{}}}));
            }
            if (!Array.isArray(page) || !page.length) break;
            rows.push(...page.map(r => r && r.payload).filter(Boolean));
            if (page.length < 500) break;
          }
          if (rows.length) egressSet(hkey, JSON.stringify(rows));
        }
        rows.forEach(add);
      }
    }
    return [...found.values()].map(o => ({o, ex:execOf(o,keys)})).sort((a,b)=>new Date((b.ex&&b.ex.timestamp)||b.o.date||0)-new Date((a.ex&&a.ex.timestamp)||a.o.date||0));
  }

  function render(eq, c) {
    const {o,ex} = c;
    if (!ex) return '<div class="lm-meta"><span>Fecha: <b>'+esc(dt(o.date))+'</b></span><span>Orden: <b>'+esc(o.id)+'</b></span></div><div class="lm-note">La orden incluye este equipo, pero no tiene una ejecución técnica individual guardada.</div>';
    const typeRaw = String(ex.tipoRutina || o.maintenanceType || o.type || '').toUpperCase();
    const typeName = typeRaw.includes('COR') ? 'Correctivo' : (typeRaw.includes('REV') ? 'Revisión' : 'Preventivo');
    const typeKey = String((eq && eq.type) || 'EXTRACTOR').trim().toUpperCase();
    const cfg = ex.formConfigSnapshot || equipmentFormsConfig[typeKey] || equipmentFormsConfig.EXTRACTOR || {params:'',checklist:''};
    const pNames=list(cfg.params), cNames=String(cfg.checklist||'').split('\n').map(x=>x.trim()).filter(Boolean), pv=ex.paramsValues||{};
    const techs=(o.technicians&&o.technicians.length?o.technicians.join(', '):o.technician)||'-';
    let h='<div class="lm-meta"><span class="lm-ro"><i class="fa-solid fa-lock"></i> Solo lectura</span><span>Tipo: <b>'+esc(typeName)+'</b></span><span>Fecha: <b>'+esc(dt(ex.timestamp||o.date))+'</b></span><span>Técnico: <b>'+esc(techs)+'</b></span><span>Orden: <b>'+esc(o.id)+'</b></span></div>';
    if(ex.partial) h+='<div class="mx-alert warn" style="margin:0 0 8px">Registro en progreso (incompleto).</div>';
    h+='<div class="lm-sec">Parámetros registrados</div>';
    if(pNames.length){h+='<table class="lm-tbl"><thead><tr><th>Parámetro</th><th>Valor anterior</th></tr></thead><tbody>';pNames.forEach((n,i)=>h+='<tr><td>'+esc(n)+'</td><td class="v">'+esc(pv['param_'+i]??'-')+'</td></tr>');h+='</tbody></table>';}else h+='<div class="lm-empty">Sin parámetros registrados.</div>';
    if(cNames.length){h+='<div class="lm-sec">Check-list</div>';const ck=ex.checklist||{};cNames.forEach((n,i)=>{const ok=!!(ck['chk_'+(i+1)]||ck['check_'+(i+1)]||ck[i]);h+='<div class="lm-chk"><i class="fa-solid '+(ok?'fa-circle-check ok':'fa-circle-minus no')+'"></i><span>'+esc(n)+'</span></div>';});}
    const obs=ex.observaciones_tecnicas||ex.observaciones||ex.notas_tecnicas||ex.obs||ex.notes||'';
    h+='<div class="lm-sec">Observaciones y hallazgos</div><div class="lm-note">'+esc(String(obs).trim()||'Sin observaciones registradas.')+'</div>';
    if(ex.corrective||ex.correctiveDesc)h+='<div class="lm-sec">Novedad / correctivo reportado</div><div class="lm-note warn">'+esc(ex.correctiveDesc||'Se reportó un correctivo.')+'</div>';
    const nPh=Array.isArray(ex.photos)?ex.photos.length:(Number(ex.photosCount)||0);if(nPh)h+='<div class="lm-meta"><span><i class="fa-solid fa-camera"></i> '+nPh+' foto(s) registradas</span></div>';
    return h;
  }

  window.lmOpen = async function () {
    const body=document.getElementById('lm-body');
    body.innerHTML='<div class="lm-empty"><i class="fa-solid fa-spinner fa-spin"></i> Cargando historial completo del equipo…</div>';
    mxOpen('mx-last');
    const eqId=currentExecEqId, eq=techFindEq(eqId)||{code:eqId};
    try {
      const records=await findAll(eq,eqId,currentExecOrderId);
      if(!document.getElementById('mx-last').classList.contains('open'))return;
      if(!records.length){body.innerHTML='<div class="lm-empty"><i class="fa-regular fa-folder-open"></i> No hay intervenciones anteriores registradas para este equipo.'+(!navigator.onLine?'<br><small>Sin conexión: se muestran únicamente los datos guardados en este dispositivo.</small>':'')+'</div>';return;}
      body.innerHTML='<div class="lm-meta"><b>'+records.length+' intervención(es) encontradas</b><span>Preventivos · Correctivos · Revisiones</span></div>'+records.map((r,i)=>'<section class="lm-history-item" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0"><div class="lm-sec">Intervención '+(i+1)+' de '+records.length+'</div>'+render(eq,r)+'</section>').join('');
    } catch(e){console.warn('[Historial completo equipo]',e);body.innerHTML='<div class="lm-empty">No se pudo cargar todo el historial. Verifica la conexión e inténtalo nuevamente.</div>';}
  };
})();
