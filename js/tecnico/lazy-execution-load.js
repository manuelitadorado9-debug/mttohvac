
/* Carga bajo demanda: al abrir un equipo cuya ejecución previa tenía fotos, recién ahí se descarga el payload completo de la orden. */
(function () {
  var base = window.openEquipmentExecutionModal;
  if (typeof base !== 'function' || base.__lazyFull) return;
  var wrapped = function (orderId, eqId) {
    var self = this, args = arguments;
    var order = workOrders.find(function (o) { return o && String(o.id) === String(orderId); });
    if (!order || !hvacExecNeedsHeavy(order, eqId)) return base.apply(self, args);
    var cached = egressGet('full:' + cloudCleanId(orderId), EGRESS.FULL_TTL_MS) !== undefined;
    if (!cached) showToast('Cargando fotos del equipo…');
    return hvacEnsureFullOrder(orderId).then(function (ok) {
      if (!ok && hvacExecNeedsHeavy(order, eqId)) {
        showToast('Sin conexión: no se pueden cargar las fotos ya registradas de este equipo. Conéctate para abrirlo y no perderlas.', 'error');
        return;
      }
      return base.apply(self, args);
    }).catch(function (e) {
      console.warn('[Egress] No se pudo completar la orden:', e);
      showToast('No se pudo cargar el detalle del equipo. Intenta de nuevo.', 'error');
    });
  };
  wrapped.__lazyFull = true;
  window.openEquipmentExecutionModal = wrapped;
})();
