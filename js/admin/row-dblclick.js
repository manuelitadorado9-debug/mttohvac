
/* Doble clic (o doble toque) en una fila = pulsar su botón "Editar" (en Facturación: "Facturar"/"Editar").
   Se ejecuta el MISMO onclick del botón, así que abre exactamente el mismo modal/formulario. */
(function () {
  'use strict';
  if (window.__rowDbl) return; window.__rowDbl = true;
  var SKIP = 'button, a, input, select, textarea, label, img, video, summary, [contenteditable="true"]';
  var MODAL = '.modal-backdrop, .mx-modal, [role="dialog"]';
  function isDanger(b) { return !!b.querySelector('.fa-trash, .fa-trash-can, .fa-xmark') || /elimin|borrar|revert|quitar/i.test(b.title || '') || b.matches('.text-rose-600, .text-red-600'); }
  function isEdit(b) { return !!b.querySelector('.fa-pen, .fa-pen-to-square, .fa-pencil, .fa-edit, .fa-receipt') || /^\s*editar/i.test(b.title || '') || /^\s*(editar|facturar)\b/i.test(b.textContent || ''); }
  function editButton(tr) { var bs = tr.querySelectorAll('button'); for (var i = 0; i < bs.length; i++) { if (!bs[i].disabled && !isDanger(bs[i]) && isEdit(bs[i])) return bs[i]; } return null; }
  function rowOf(t) {                                     // solo filas del panel principal (no modales) y que no tengan ya un clic propio
    var tr = t && t.closest ? t.closest('tbody > tr') : null;
    return (tr && tr.closest('#app-main') && !tr.closest(MODAL) && !tr.hasAttribute('onclick')) ? tr : null;
  }
  var lastFire = 0;
  function fire(tr) {
    var b = editButton(tr); if (!b) return false;
    if (Date.now() - lastFire < 700) return true;         // evita doble disparo (dblclick + doble toque)
    lastFire = Date.now();
    var sel = window.getSelection && window.getSelection(); if (sel && sel.removeAllRanges) sel.removeAllRanges();
    b.click();
    return true;
  }
  document.addEventListener('mousedown', function (e) {   // evita que el doble clic seleccione texto
    if (e.detail > 1 && !e.target.closest(SKIP)) { var tr = rowOf(e.target); if (tr && editButton(tr)) e.preventDefault(); }
  });
  document.addEventListener('dblclick', function (e) {
    if (e.target.closest(SKIP)) return;
    var tr = rowOf(e.target); if (tr) fire(tr);
  });
  var tap = { tr: null, t: 0, x: 0, y: 0 };               // doble toque en pantallas táctiles (iOS no emite dblclick)
  document.addEventListener('pointerup', function (e) {
    if (e.pointerType !== 'touch' || e.target.closest(SKIP)) return;
    var tr = rowOf(e.target); if (!tr) { tap.tr = null; return; }
    var now = Date.now();
    if (tap.tr === tr && now - tap.t < 350 && Math.abs(e.clientX - tap.x) < 24 && Math.abs(e.clientY - tap.y) < 24) { tap.tr = null; fire(tr); }
    else tap = { tr: tr, t: now, x: e.clientX, y: e.clientY };
  });
})();
