
/* ===== Nueva rutina: zonas, facturación por consecutivo y vista previa ===== */
(function(){
  var S={assign:{},values:{},targets:{},touched:false,noSplit:false};
  function $(id){return document.getElementById(id);}
  // Con "un solo informe" cada facturación se crea como UNA orden con todas sus zonas
  function groupsOf(zs){return (S.noSplit&&zs.length>1)?hvacMergeZoneGroups(zs):zs;}
  function checkedIds(){return Array.from(document.querySelectorAll('.nr-eq-checkbox:checked')).map(function(c){return c.value;});}
  function zoneList(){return hvacGroupEquipmentByZone(checkedIds());}
  function zkey(g){return g.zoneId||'__NO_ZONE__';}
  function isEditing(){return (typeof nrEditingId!=='undefined')&&nrEditingId!==null;}
  function money(n){return '$'+Math.round(Number(n)||0).toLocaleString('es-CO');}
  function eqCount(zs){return zs.reduce(function(a,z){return a+z.ids.length;},0);}
  function periodMatrices(){
    var c=($('nr-client')||{}).value, d=($('nr-date')||{}).value; if(!c||!d) return [];
    var dt=new Date(d+'T00:00:00'), m=dt.getMonth()+1, y=dt.getFullYear();
    var rt=String(($('nr-type')||{}).value||'PREVENTIVO').toUpperCase(), wk=typeof hvacIsoWeekKey==='function'?hvacIsoWeekKey(d):'';
    // Cada correctivo representa una intervención independiente: no reutiliza
    // proyecciones de otro correctivo del mismo mes para no bloquear equipos ni
    // reciclar el consecutivo. Los preventivos sí conservan su agrupación mensual.
    if(rt==='CORRECTIVO') return [];
    return (monthlyProjections||[]).filter(function(p){
      if(!p||p.client!==c||!p.zoneBaseId||(p.maintenanceType||'PREVENTIVO').toUpperCase()!==rt) return false;
      if(rt==='REVISION') return !!wk && typeof hvacProjectionDate==='function' && hvacIsoWeekKey(hvacProjectionDate(p))===wk;
      return Number(p.month)===m&&Number(p.year)===y;
    });
  }
  function normalize(zones){
    var keys={}; zones.forEach(function(z){keys[zkey(z)]=1;});
    Object.keys(S.assign).forEach(function(k){if(!keys[k])delete S.assign[k];});
    zones.forEach(function(z){var k=zkey(z),v=parseInt(S.assign[k],10); if(!v||v<1)v=1; if(v>zones.length)v=zones.length; S.assign[k]=v;});
  }
  function usedNums(zones){var set={};zones.forEach(function(z){set[S.assign[zkey(z)]]=1;});return Object.keys(set).map(Number).sort(function(a,b){return a-b;});}
  function zonesOf(zones,gn){return zones.filter(function(z){return S.assign[zkey(z)]===gn;});}
  function autoSplit(zones,used){
    var budget=parseFloat(($('nr-budget')||{}).value)||0, total=eqCount(zones)||1, left=budget;
    used.forEach(function(gn,i){
      var v=i===used.length-1?left:Math.round(budget*eqCount(zonesOf(zones,gn))/total);
      S.values[gn]=v; left-=v;
    });
  }
  function targetFor(gn,usedLen,mats){
    var t=S.targets[gn];
    if(t&&(t==='NEW'||mats.some(function(p){return p.id===t;}))) return t;
    return (usedLen===1&&mats.length)?mats[0].id:'NEW';
  }
  window.hvacNrGetPlan=function(){
    if(isEditing()) return null;
    var zones=zoneList(); if(!zones.length) return null;
    normalize(zones);
    var used=usedNums(zones), mats=periodMatrices(), budget=parseFloat(($('nr-budget')||{}).value)||0;
    if(used.length>1&&!S.touched) autoSplit(zones,used);
    return used.map(function(gn){
      var zs=zonesOf(zones,gn), eq=[];
      zs.forEach(function(z){eq=eq.concat(z.ids);});
      return {n:gn,groups:groupsOf(zs),equipmentIds:eq,value:used.length===1?budget:(Number(S.values[gn])||0),target:targetFor(gn,used.length,mats)};
    });
  };
  function syncTotal(){
    var zones=zoneList(), used=usedNums(zones); if(used.length<2) return;
    var sum=0; used.forEach(function(gn){sum+=Number(S.values[gn])||0;});
    var b=$('nr-budget'); if(b) b.value=sum||'';
    var l=$('nr-sum-label'); if(l) l.textContent='Total del valor: '+money(sum);
  }
  function render(){
    var box=$('nr-zone-preview'); if(!box) return;
    var zones=isEditing()?[]:zoneList();
    if(!zones.length){box.classList.add('hidden');box.innerHTML='';return;}
    normalize(zones);
    var used=usedNums(zones), mats=periodMatrices(), multi=used.length>1;
    var rType=String(($('nr-type')||{}).value||'PREVENTIVO').toUpperCase(), isRev=rType==='REVISION', pref=(typeof CONSEC_PREF!=='undefined'&&CONSEC_PREF[rType])||'PRE-';
    if(multi&&!isRev&&!S.touched) autoSplit(zones,used);
    var newCount=0, h='';
    h+='<div class="flex items-center justify-between gap-2 flex-wrap mb-2"><p class="font-black text-teal-800 text-xs"><i class="fa-solid fa-layer-group mr-1"></i>Zonas y facturación <span class="font-semibold text-slate-500">· '+zones.length+' zona(s), '+eqCount(zones)+' equipo(s)</span></p>';
    if(zones.length>1) h+='<div class="flex gap-1.5"><button type="button" data-chip="one" class="text-[10px] font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 rounded-lg" style="height:28px">Una sola facturación</button><button type="button" data-chip="each" class="text-[10px] font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 rounded-lg" style="height:28px">Una por zona</button></div>';
    h+='</div>';
    if(zones.length>1) h+='<label class="flex items-start gap-2 text-[11px] font-bold text-slate-700 mb-2"><input type="checkbox" data-nosplit class="mt-0.5"'+(S.noSplit?' checked':'')+'><span>Un solo informe con todas las zonas <span class="font-semibold text-slate-500">(sin dividir cada facturación en una orden por zona)</span></span></label>';
    if(zones.length>1){
      h+='<p class="text-[10px] text-slate-500 mb-1.5">Elige a qué facturación va cada zona. Cada facturación tiene su propio consecutivo.</p><div class="mb-3">';
      zones.forEach(function(z){
        var k=zkey(z), opts='';
        for(var i=1;i<=zones.length;i++) opts+='<option value="'+i+'"'+(S.assign[k]===i?' selected':'')+'>Facturación '+i+'</option>';
        h+='<div class="flex items-center justify-between gap-2 py-1.5 border-b border-slate-200/60"><div class="min-w-0"><div class="font-bold text-xs truncate">'+esc(z.zoneName)+'</div><div class="text-[10px] text-slate-500">'+z.ids.length+' equipo(s)</div></div><select data-zone="'+esc(k)+'" class="input-box text-xs" style="width:auto;min-width:128px;flex:none">'+opts+'</select></div>';
      });
      h+='</div>';
    }
    used.forEach(function(gn){
      var zs=zonesOf(zones,gn), tgt=targetFor(gn,used.length,mats), base, label;
      if(tgt==='NEW'){newCount++;base=prevFormat(consecFreeLocal(pref,newCount),pref);label='<b class="font-mono text-teal-800">'+esc(base)+'</b> <span class="text-slate-500">nuevo · estimado</span>';}
      else{var p=mats.filter(function(x){return x.id===tgt;})[0];base=p.zoneBaseId;label='<span class="text-slate-500">Se agrega a</span> <b class="font-mono text-teal-800">'+esc(base)+'</b>';}
      var zsE=groupsOf(zs), codes=hvacZoneOrderIds(base,zsE);
      h+='<div class="rounded-2xl border border-slate-200 p-3 mb-2"><div class="flex items-center justify-between gap-2 flex-wrap mb-1.5"><span class="font-black text-xs">'+(multi?'Facturación '+gn:'Consecutivo')+'</span><span class="text-[11px]">'+label+'</span></div><ul class="space-y-0.5 mb-1">';
      zsE.forEach(function(z,i){h+='<li class="flex justify-between gap-2 text-[11px]"><span><b class="font-mono">'+esc(codes[i].id)+'</b> · '+esc(z.zoneName)+'</span><span class="text-slate-500">'+z.ids.length+' eq.</span></li>';});
      h+='</ul>';
      if(mats.length) h+='<select data-target="'+gn+'" class="input-box text-xs mt-1.5"><option value="NEW"'+(tgt==='NEW'?' selected':'')+'>Consecutivo nuevo</option>'+mats.map(function(p){return '<option value="'+esc(p.id)+'"'+(tgt===p.id?' selected':'')+'>Agregar a '+esc(p.zoneBaseId)+' (mismo mes)</option>';}).join('')+'</select>';
      if(multi&&!isRev) h+='<label class="block text-[10px] font-bold text-slate-500 uppercase mt-2 mb-1">Valor de esta facturación ($)</label><input type="number" data-gv="'+gn+'" value="'+(Number(S.values[gn])||'')+'" class="input-box text-xs font-bold" placeholder="0">';
      h+='</div>';
    });
    if(multi&&!isRev) h+='<p id="nr-sum-label" class="text-[11px] font-bold text-slate-700 text-right"></p>';
    h+='<p class="text-[10px] text-slate-500 mt-1">El número definitivo se asigna al guardar. Cada facturación se cobra cuando todas sus partes estén completadas.</p>';
    box.innerHTML=h; box.classList.remove('hidden');
    if(multi&&!isRev) syncTotal();
  }
  window.hvacNrUpdateZonePreview=render;
  window.hvacNrSelectAllZones=function(){
    var cbs=Array.from(document.querySelectorAll('.nr-eq-checkbox'));
    if(!cbs.length) return showToast('Primero selecciona un cliente para ver sus equipos por zona.','error');
    var sel=$('nr-zone-filter'); if(sel) sel.value='ALL';
    hvacApplyRoutineZoneFilter('nr');
    var n=0; document.querySelectorAll('.nr-eq-checkbox').forEach(function(cb){if(!cb.disabled){cb.checked=true;n++;}});
    S.touched=false; render();
    showToast(n+' equipo(s) de '+zoneList().length+' zona(s) seleccionados. Define abajo cómo se facturan.','success');
  };
  var box=$('nr-zone-preview');
  if(box){
    box.addEventListener('change',function(e){
      var t=e.target; if(!t||!t.dataset) return;
      if(t.dataset.nosplit!==undefined){S.noSplit=!!t.checked;render();}
      else if(t.dataset.zone!==undefined){S.assign[t.dataset.zone]=parseInt(t.value,10)||1;S.touched=false;render();}
      else if(t.dataset.target!==undefined){S.targets[t.dataset.target]=t.value;render();}
    });
    box.addEventListener('input',function(e){
      var t=e.target; if(t&&t.dataset&&t.dataset.gv!==undefined){S.values[t.dataset.gv]=parseFloat(t.value)||0;S.touched=true;syncTotal();}
    });
    box.addEventListener('click',function(e){
      var b=e.target.closest&&e.target.closest('[data-chip]'); if(!b) return;
      zoneList().forEach(function(z,i){S.assign[zkey(z)]=b.dataset.chip==='one'?1:i+1;});
      S.touched=false; render();
    });
  }
  document.addEventListener('change',function(e){
    var t=e.target; if(!t) return;
    if((t.classList&&t.classList.contains('nr-eq-checkbox'))||t.id==='nr-zone-filter'||t.id==='nr-client'||t.id==='nr-date') render();
  });
  document.addEventListener('input',function(e){
    if(e.target&&e.target.id==='nr-budget'){S.touched=false;render();}
  });
  document.addEventListener('click',function(e){
    if(e.target.closest&&e.target.closest('#new-routine-modal-backdrop button[onclick*="toggleSelectAllCheckboxes"]')) setTimeout(render,0);
  });
  var picker=$('nr-equipments-picker');
  if(picker) new MutationObserver(function(){render();}).observe(picker,{childList:true});
  var modal=$('new-routine-modal-backdrop');
  if(modal) new MutationObserver(function(){
    if(modal.classList.contains('hidden')){S={assign:{},values:{},targets:{},touched:false,noSplit:false};var b=$('nr-zone-preview');if(b){b.classList.add('hidden');b.innerHTML='';}}
  }).observe(modal,{attributes:true,attributeFilter:['class']});
})();
