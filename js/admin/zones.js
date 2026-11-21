
(function(){
 'use strict';
 const escH=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 window.HVAC_ZONES_CACHE=[];
 const zClient=()=>document.getElementById('hvac-zone-client')?.value||'';
 // ===== Vínculo zona ↔ cliente por clientId (con compatibilidad para zonas antiguas que solo traen clientName) =====
 const zTrim=v=>String(v??'').trim();
 const zCatalog=()=>(typeof clientsCatalog!=='undefined'&&Array.isArray(clientsCatalog))?clientsCatalog:[];
 // Acepta nombre o id de cliente y devuelve { id, name }. Sin coincidencia en el catálogo: { id:'', name }.
 function zRef(v){
  const s=zTrim(v); if(!s) return {id:'',name:''};
  const cat=zCatalog(), byName=cat.filter(c=>zTrim(c.name)===s);
  const hit=byName.length===1?byName[0]:(cat.find(c=>String(c.id)===s)||byName[0]);
  return hit?{id:String(hit.id),name:zTrim(hit.name)}:{id:'',name:s};
 }
 // Zona con clientId: se compara por id (sobrevive a renombrar el cliente). Zona antigua: se compara por clientName.
 function zBelongs(z,ref){
  if(!z||!ref) return false;
  if(z.clientId&&ref.id) return String(z.clientId)===ref.id;
  return !!ref.name&&zTrim(z.clientName)===ref.name;
 }
 // Completa clientId en las zonas antiguas cuando el nombre coincide con UN solo cliente. En memoria siempre;
 // se guarda en Supabase una sola vez por zona y por sesión (mismo registro, solo se añade el campo clientId).
 const zSaved=new Set();
 function zLink(rows){
  const cat=zCatalog(); if(!cat.length) return;
  rows.forEach(z=>{
   if(z.clientId) return;
   const m=cat.filter(c=>zTrim(c.name)===zTrim(z.clientName));
   if(m.length!==1) return;
   z.clientId=String(m[0].id);
   if(zSaved.has(z.id)||!navigator.onLine||typeof cloudUpsert!=='function') return;
   zSaved.add(z.id);
   Promise.resolve(cloudUpsert('hvac_zones',z.id,{...z})).catch(e=>console.warn('[Zonas] No se pudo guardar clientId:',z.id,e));
  });
 }
 async function fetchZones(){
   if(!navigator.onLine) throw new Error('Se requiere conexión para administrar zonas.');
   const rows=await supabaseFetch('hvac_zones?select=id,payload&order=created_at.asc','GET',null,null,{quiet:true});
   if(!Array.isArray(rows)) throw new Error('No se pudo leer hvac_zones. Ejecuta primero el SQL de instalación.');
   window.HVAC_ZONES_CACHE=rows.filter(r=>r&&r.payload).map(r=>({...r.payload,id:r.payload.id||r.id}));
   zLink(window.HVAC_ZONES_CACHE);
   return window.HVAC_ZONES_CACHE;
 }
 window.hvacLoadZonesForClient=async function(client){
   const sel=document.getElementById('eq-f-zone'); if(!sel)return;
   const previous=sel.value;
   try{await fetchZones();}catch(e){console.warn('[Zonas]',e);}
   const rows=window.HVAC_ZONES_CACHE.filter(z=>zBelongs(z,zRef(client)));
   sel.innerHTML='<option value="">Sin zona asignada</option>'+rows.map(z=>`<option value="${escH(z.id)}">${escH(z.name)}</option>`).join('');
   if(rows.some(z=>String(z.id)===String(previous)))sel.value=previous;
 };
 window.hvacCreateZoneFromEquipment=async function(){
   const clientName=String(document.getElementById('eq-f-client')?.value||'').trim(),input=document.getElementById('eq-f-zone-new');
   try{
     const z=await window.hvacSaveZone(clientName,input?.value);
     await window.hvacLoadZonesForClient(clientName);
     const sel=document.getElementById('eq-f-zone');if(sel)sel.value=z.id;
     if(input)input.value='';
     showToast('Zona creada y asignada al equipo.','success');
   }catch(e){showToast(e.message||'No fue posible crear la zona.','error');}
 };
 window.hvacPopulateRoutineZoneFilter=async function(client,mode){
   const sel=document.getElementById(mode+'-zone-filter');if(!sel)return;
   const previous=sel.value||'ALL';
   try{await fetchZones();}catch(e){console.warn('[Zonas rutina]',e);}
   const rows=window.HVAC_ZONES_CACHE.filter(z=>zBelongs(z,zRef(client)));
   sel.innerHTML='<option value="ALL">Todas las zonas</option>'+rows.map(z=>`<option value="${escH(z.id)}">${escH(z.name)}</option>`).join('')+'<option value="__NO_ZONE__">Sin zona asignada</option>';
   if(Array.from(sel.options).some(o=>o.value===previous))sel.value=previous;else sel.value='ALL';
 };
 window.hvacApplyRoutineZoneFilter=function(mode){
   const sel=document.getElementById(mode+'-zone-filter');if(!sel)return;
   const value=sel.value||'ALL';
   const cls=mode==='sch'?'.sch-eq-checkbox':'.nr-eq-checkbox';
   document.querySelectorAll(cls).forEach(cb=>{
     const row=cb.closest('label');
     const eq=(equipmentCatalog||[]).find(e=>String(e.id)===String(cb.value)||String(e.code)===String(cb.value))||{};
     const zid=String(eq.zoneId||'');
     const match=value==='ALL'||(value==='__NO_ZONE__'&&!zid)||(value!=='__NO_ZONE__'&&value!=='ALL'&&zid===value);
     if(row)row.style.display=match?'flex':'none';
     if(!match)cb.checked=false;
   });
 };
 window.hvacOpenZonesManager=async function(){
   const modal=document.getElementById('hvac-zones-modal');modal.style.display='flex';modal.classList.remove('hidden');
   const sel=document.getElementById('hvac-zone-client');
   try{
    if(!Array.isArray(clientsCatalog)||!clientsCatalog.length){const rows=await supabaseFetch('hvac_clients?select=id,payload','GET',null,null,{quiet:true});if(Array.isArray(rows))clientsCatalog=rows.filter(r=>r.payload).map(r=>({...r.payload,id:r.payload.id||r.id}));}
    sel.innerHTML='<option value="">Selecciona un cliente</option>'+getSortedClientRecords().filter(isClientActiveRecord).map(c=>`<option value="${escH(c.name)}">${escH(c.name)}</option>`).join('');
    await fetchZones(); hvacRenderZones();
   }catch(e){showToast(e.message||'No fue posible cargar las zonas.','error');}
 };
 window.hvacCloseZonesManager=()=>{const m=document.getElementById('hvac-zones-modal');m.style.display='none';m.classList.add('hidden');};
 window.hvacRenderZones=function(){
  const host=document.getElementById('hvac-zone-list');if(!host)return;
  const rows=window.HVAC_ZONES_CACHE.filter(z=>zBelongs(z,zRef(zClient())));
  host.innerHTML=rows.length?rows.map(z=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:10px 12px"><div><div style="font-weight:800;font-size:13px">${escH(z.name)}</div><div style="font-size:10px;color:var(--text-2,#334155)">${equipmentCatalog.filter(e=>String(e.zoneId||'')===String(z.id)).length} equipo(s) asignado(s)</div></div><button onclick="hvacDeleteZone('${escH(z.id)}')" style="color:#dc2626;font-size:12px;font-weight:700">Eliminar</button></div>`).join(''):'<div style="font-size:12px;color:var(--text-2,#334155);padding:16px;text-align:center;border:1px dashed var(--line,#cbd5e1);border-radius:12px">No hay zonas creadas para este cliente.</div>';
  window.hvacBatchRefresh?.();
 };
 // API: listar y guardar zonas de un cliente (única vía de escritura; la usan el gestor y el formulario de equipos)
 window.hvacListZones=async function(clientName){
   await fetchZones();
   return window.HVAC_ZONES_CACHE.filter(z=>zBelongs(z,zRef(clientName))).sort((a,b)=>String(a.name).localeCompare(String(b.name),'es',{numeric:true}));
 };
 window.hvacSaveZone=async function(clientName,name){
   const ref=zRef(clientName);clientName=ref.name;name=String(name||'').trim().replace(/\s+/g,' ');
   if(!clientName)throw new Error('Selecciona primero un cliente.');
   if(!name)throw new Error('Escribe el nombre de la zona o piso.');
   if((await window.hvacListZones(clientName)).some(z=>String(z.name).toLocaleLowerCase('es')===name.toLocaleLowerCase('es')))throw new Error('Esa zona ya existe para este cliente.');
   const id='ZON-'+Date.now().toString(36).toUpperCase(),payload={id,clientId:ref.id||undefined,clientName,name,createdAt:new Date().toISOString()};
   if(!await cloudUpsert('hvac_zones',id,payload))throw new Error('No se pudo guardar la zona en Supabase.');
   window.HVAC_ZONES_CACHE.push(payload);
   return payload;
 };
 window.hvacAddZone=async function(){
  try{await window.hvacSaveZone(zClient(),document.getElementById('hvac-zone-name').value);document.getElementById('hvac-zone-name').value='';hvacRenderZones();showToast('Zona guardada.');}
  catch(e){showToast(e.message||'No se pudo guardar la zona.','error');}
 };
 window.hvacDeleteZone=async function(id){
  if(equipmentCatalog.some(e=>String(e.zoneId||'')===String(id)))return showToast('No se puede eliminar: hay equipos asignados. Reasígnalos primero.','error');
  if(!confirm('¿Eliminar esta zona?'))return;
  const ok=await cloudDeleteGeneric('hvac_zones',id);if(!ok)return showToast('No se pudo eliminar la zona de Supabase.','error');
  window.HVAC_ZONES_CACHE=window.HVAC_ZONES_CACHE.filter(z=>String(z.id)!==String(id));hvacRenderZones();showToast('Zona eliminada.');
 };
 // ===== Asignación de equipos a una zona en lote =====
 const batchSel=new Set();let batchClient=null;
 const bNorm=v=>typeof normText==='function'?normText(v):String(v??'').toLowerCase();
 const bEls=()=>({zone:document.getElementById('hvac-zone-batch-zone'),q:document.getElementById('hvac-zone-batch-search'),f:document.getElementById('hvac-zone-batch-filter'),o:document.getElementById('hvac-zone-batch-origin'),list:document.getElementById('hvac-zone-batch-list'),count:document.getElementById('hvac-zone-batch-count')});
 const bClientEquipments=()=>{const c=zClient();return c?(equipmentCatalog||[]).filter(e=>eqBelongsToClient(e,c)):[];};
 function bFiltered(){
   const {zone,q,f,o}=bEls(),zid=String(zone?.value||''),term=bNorm(q?.value||'').trim(),mode=f?.value||'ALL',origin=o?.value||'ALL';
   return bClientEquipments().filter(e=>{
     const ez=String(e.zoneId||'');
     if(mode==='NONE'&&ez)return false;
     if(mode==='OTHER'&&(!ez||ez===zid))return false;
     if(mode==='SAME'&&(!zid||ez!==zid))return false;
     if(origin!=='ALL'&&ez!==String(origin))return false;
     return !term||[e.code,e.name,e.serial,e.type,e.brand,e.model,e.zoneName].some(v=>bNorm(v).includes(term));
   }).sort((a,b)=>String(a.code||'').localeCompare(String(b.code||''),'es',{numeric:true}));
 }
 window.hvacBatchRefresh=function(){
   const {zone}=bEls();if(!zone)return;
   const client=zClient();
   if(batchClient!==client){batchSel.clear();batchClient=client;}
   const previous=zone.value,zones=window.HVAC_ZONES_CACHE.filter(z=>zBelongs(z,zRef(client))).sort((a,b)=>String(a.name).localeCompare(String(b.name),'es',{numeric:true}));
   zone.innerHTML='<option value="">Selecciona una zona</option>'+zones.map(z=>`<option value="${escH(z.id)}">${escH(z.name)}</option>`).join('');
   zone.value=zones.some(z=>String(z.id)===String(previous))?previous:(zones.length===1?zones[0].id:'');
   const og=document.getElementById('hvac-zone-batch-origin');
   if(og){const prevO=og.value;og.innerHTML='<option value="ALL">Zona de origen: todas</option>'+zones.map(z=>`<option value="${escH(z.id)}">Origen: ${escH(z.name)}</option>`).join('');og.value=[...og.options].some(x=>x.value===prevO)?prevO:'ALL';}
   window.hvacBatchRender();
 };
 window.hvacBatchRender=function(){
   const {zone,list,count}=bEls();if(!list)return;
   if(!zClient()){list.innerHTML='<div style="font-size:12px;color:var(--text-2,#334155);padding:14px;text-align:center">Selecciona un cliente para ver sus equipos.</div>';count.textContent='';return;}
   const zid=String(zone.value||''),rows=bFiltered(),LIMIT=200,shown=rows.slice(0,LIMIT);
   list.innerHTML=shown.length?shown.map(e=>{
     const ez=String(e.zoneId||''),same=!!zid&&ez===zid,id=String(e.id),checked=batchSel.has(id)&&!same;
     const chip=same?'<span style="font-size:10px;font-weight:800;color:#047857;background:#d1fae5;border-radius:999px;padding:2px 8px;white-space:nowrap">En esta zona</span>':(ez?`<span style="font-size:10px;font-weight:800;color:#92400e;background:#fef3c7;border-radius:999px;padding:2px 8px;white-space:nowrap">${escH(e.zoneName||'Otra zona')}</span>`:'<span style="font-size:10px;font-weight:700;color:#64748b;background:#f1f5f9;border-radius:999px;padding:2px 8px;white-space:nowrap">Sin zona</span>');
     return `<label style="display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 10px;border:1px solid var(--line,#e2e8f0);border-radius:10px;cursor:${same?'default':'pointer'};opacity:${same?.6:1}"><input type="checkbox" data-id="${escH(id)}" ${checked?'checked':''} ${same?'disabled':''} onchange="hvacBatchToggle(this)" style="width:18px;height:18px;flex:none"><span style="flex:1;min-width:0"><span style="display:block;font-weight:800;font-size:12.5px">${escH(e.code||'-')} <span style="font-weight:600;color:var(--text-2,#334155)">· ${escH(e.name||e.type||'Sin nombre')}</span></span><span style="display:block;font-size:10.5px;color:var(--text-2,#334155);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH([e.type,e.brand,e.serial].filter(Boolean).join(' · '))}</span></span>${chip}</label>`;
   }).join(''):'<div style="font-size:12px;color:var(--text-2,#334155);padding:14px;text-align:center">No hay equipos que coincidan.</div>';
   const visSel=rows.filter(e=>batchSel.has(String(e.id))).length;count.textContent=`${batchSel.size} seleccionado(s)${batchSel.size>visSel?` (${batchSel.size-visSel} fuera de esta vista)`:''} · ${rows.length} resultado(s)${rows.length>LIMIT?` (mostrando ${LIMIT}; usa el buscador)`:''}${typeof eqBackgroundLoading!=='undefined'&&eqBackgroundLoading?' · aún cargando equipos…':''}`;
 };
 window.hvacBatchToggle=function(cb){const id=cb.dataset.id;if(cb.checked)batchSel.add(id);else batchSel.delete(id);window.hvacBatchRender();};
 window.hvacBatchSelectAll=function(on){
   const zid=String(bEls().zone?.value||'');
   if(!on){batchSel.clear();}
   else{batchSel.clear();bFiltered().forEach(e=>{if(!zid||String(e.zoneId||'')!==zid)batchSel.add(String(e.id));});}
   window.hvacBatchRender();
 };
 window.hvacBatchAssign=async function(){
   const {zone}=bEls(),zid=String(zone.value||''),z=window.HVAC_ZONES_CACHE.find(x=>String(x.id)===zid);
   if(!z)return showToast('Selecciona la zona destino.','error');
   const eqs=[...batchSel].map(id=>(equipmentCatalog||[]).find(e=>String(e.id)===id)).filter(e=>e&&String(e.zoneId||'')!==zid);
   if(!eqs.length)return showToast('Marca al menos un equipo que no esté ya en esa zona.','error');
   const moved=eqs.filter(e=>e.zoneId).length;
   if(!confirm(`Se asignarán ${eqs.length} equipo(s) a "${z.name}"${moved?` (${moved} ya están en otra zona y se moverán)`:''}. ¿Continuar?`))return;
   const btn=document.getElementById('hvac-zone-batch-save'),lbl=document.getElementById('hvac-zone-batch-save-label'),old=lbl.textContent;
   btn.disabled=true;lbl.textContent='Guardando…';
   let synced=0,pending=0;
   try{
     for(let i=0;i<eqs.length;i+=10){
       await Promise.all(eqs.slice(i,i+10).map(async e=>{
         e.zoneId=z.id;e.zoneName=z.name;
         try{if(await cloudSaveEquipment(e))synced++;else pending++;}catch(_){pending++;}
       }));
     }
     try{if(typeof persistEquipmentBackup==='function')persistEquipmentBackup();else localStorage.setItem('HVAC_EQUIPMENTS_BACKUP',JSON.stringify(equipmentCatalog));}catch(_){}
     batchSel.clear();hvacRenderZones();try{renderEquipmentCatalog();}catch(_){}
     showToast(pending?`${eqs.length} equipo(s) asignados a "${z.name}"; ${pending} pendientes de sincronizar.`:`${eqs.length} equipo(s) asignados a "${z.name}".`,pending?'error':'success');
   }finally{btn.disabled=false;lbl.textContent=old;}
 };
 document.addEventListener('change',e=>{if(e.target?.id==='eq-f-client')window.hvacLoadZonesForClient(e.target.value);});
})();
