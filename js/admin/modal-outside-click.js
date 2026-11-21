
// Cerrar la ventana abierta al hacer clic en la zona borrosa (fuera de la tarjeta).
// Usa la misma función de cierre de cada ventana; si hay datos escritos sin guardar, pregunta antes.
(function () {
    var CLOSERS = {
        'order-hub-modal-backdrop': 'closeOrderHubModal',
        'add-eq-job-modal-backdrop': 'closeAddEquipmentToJobModal',
        'formularios-modal-backdrop': 'closeFormulariosModal',
        'form-type-editor-modal-backdrop': 'closeFormTypeEditorModal',
        'batch-projection-modal-backdrop': 'closeBatchProjectionModal',
        'batch-equipment-modal-backdrop': 'closeBatchEquipmentModal',
        'schedule-modal-backdrop': 'closeScheduleModal',
        'schedule-agenda-modal-backdrop': 'closeScheduleAgendaModal',
        'new-routine-modal-backdrop': 'closeNewRoutineModal',
        'corrective-client-modal-backdrop': 'closeCorrectiveClientModal',
        'agenda-item-modal-backdrop': 'closeAgendaItemModal',
        'caja-modal-backdrop': 'closeCajaModal',
        'print-legalization-modal-backdrop': 'closePrintLegalizationModal',
        'legalization-modal-backdrop': 'closeLegalizationModal',
        'receipt-viewer-modal-backdrop': 'closeReceiptViewerModal',
        'global-signature-modal-backdrop': 'closeGlobalSignatureModal',
        'exec-equipment-modal-backdrop': 'closeEquipmentExecutionModal',
        'equipment-history-modal-backdrop': 'closeEquipmentHistoryModal',
        'invoice-modal-backdrop': 'closeInvoiceModal',
        'user-edit-modal-backdrop': 'closeUserEditorModal',
        'equipment-modal-backdrop': 'closeEquipmentModal',
        'hvac-zones-modal': 'hvacCloseZonesManager'
    };
    var downTarget = null;
    function isHidden(m) { return m.classList.contains('hidden') || m.style.display === 'none'; }
    // Para no cerrar si se empezó a arrastrar/seleccionar dentro de la tarjeta y se soltó afuera
    document.addEventListener('pointerdown', function (e) { downTarget = e.target; }, true);
    document.addEventListener('mousedown', function (e) { downTarget = e.target; }, true);
    // Marca "con cambios" cuando se escribe en un campo de la ventana (los buscadores y filtros no cuentan)
    document.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.type === 'search' || /search|buscar|filter|filtro/i.test(t.id || '')) return;
        var m = t.closest('.modal-backdrop, #hvac-zones-modal');
        if (m) m.setAttribute('data-hvac-dirty', '1');
    }, true);
    document.addEventListener('click', function (e) {
        var m = e.target;
        if (!m || !m.id || !CLOSERS[m.id]) return;      // solo si el clic fue en el fondo mismo, no dentro de la tarjeta
        if (downTarget !== m || isHidden(m)) return;
        var fn = window[CLOSERS[m.id]];
        if (typeof fn !== 'function') return;
        if (m.getAttribute('data-hvac-dirty') === '1' && !window.confirm('Hay datos escritos sin guardar. ¿Cerrar la ventana de todos modos?')) return;
        m.removeAttribute('data-hvac-dirty');
        try { fn(); } catch (err) { console.warn('[Ventana] No se pudo cerrar:', err); }
    }, false);
    // Al cerrarse (por cualquier vía) se limpia la marca de cambios
    if (window.MutationObserver) {
        var mo = new MutationObserver(function (recs) {
            recs.forEach(function (r) { if (isHidden(r.target)) r.target.removeAttribute('data-hvac-dirty'); });
        });
        Object.keys(CLOSERS).forEach(function (id) {
            var el = document.getElementById(id);
            if (el) mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
        });
    }
})();
