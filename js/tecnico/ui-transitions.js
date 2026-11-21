
/* Transiciones suaves: reveal de secciones, pestañas internas y paneles desplegables */
(function(){
  'use strict';
  if (window.__uiTransitions) return; window.__uiTransitions = true;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var DUR = 260, SHIFT = 8;

  /* Anima un elemento (o lista de elementos) con fade + slide. Usa Web Animations API:
     no deja clases ni estilos residuales y se puede relanzar en cada cambio. */
  function uiAnimate(target){
    if (reduce && reduce.matches) return;
    var els = typeof target === 'string' ? document.querySelectorAll(target)
            : (target && target.length !== undefined && !target.nodeType) ? target : [target];
    Array.prototype.forEach.call(els, function(el){
      if (!el || !el.animate) return;
      try {
        el.animate(
          [{opacity:0, transform:'translateY('+SHIFT+'px)'},{opacity:1, transform:'none'}],
          {duration:DUR, easing:'ease-out'}
        );
      } catch(e){}
    });
  }
  window.uiAnimate = uiAnimate;

  /* Envuelve una función global para animar tras ejecutarla (pestañas internas, filtros) */
  function wrap(name, selector){
    var fn = window[name];
    if (typeof fn !== 'function' || fn.__uiWrapped) return;
    var w = function(){
      var r = fn.apply(this, arguments);
      var go = function(){ uiAnimate(selector); };
      if (r && typeof r.then === 'function') r.then(go, function(){}); else go();
      return r;
    };
    w.__uiWrapped = true;
    window[name] = w;
  }

  /* Paneles desplegables: cualquier panel que pase de .hidden a visible entra con fade + slide */
  var REVEAL = '[id$="-box"],[id$="-panel"],[id$="-container"],[id$="-section"],[id$="-card"],.ui-reveal,#view-admin-planning > *';
  var SKIP   = '.modal-backdrop,.mx-modal,main > section,#plan-tabs,#toast-container,#app-processing-overlay';
  var HID = /(^|\s)hidden(\s|$)/;
  new MutationObserver(function(muts){
    for (var i = 0; i < muts.length; i++){
      var m = muts[i], el = m.target;
      if (m.oldValue == null || !HID.test(m.oldValue) || el.classList.contains('hidden')) continue;
      if (el.matches && el.matches(REVEAL) && !el.matches(SKIP)) uiAnimate(el);
    }
  }).observe(document.documentElement, {subtree:true, attributes:true, attributeFilter:['class'], attributeOldValue:true});

  function init(){
    /* Filtros / pestañas internas (si existen en esta versión de la app) */
    wrap('setTechFilter', '#tech-orders-container');   /* técnico: Todas / Pendientes / Por terminar */
    wrap('switchHubTab',  '#hub-equipments-list');     /* hub de rutina: Equipos / Correctivos */
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
