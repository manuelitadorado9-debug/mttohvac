
// Mantiene el texto "Seleccionar todos / Deseleccionar todos" igual al estado real de las casillas.
(function () {
    var pend = false;
    function sync() { if (pend) return; pend = true; setTimeout(function () { pend = false; try { hvacSyncSelectAllButtons(); } catch (e) {} }, 0); }
    document.addEventListener('change', function (e) { if (e.target && e.target.type === 'checkbox') sync(); }, true);
    document.addEventListener('click', sync, true);
    if (window.MutationObserver) {
        var mo = new MutationObserver(sync);
        ['new-routine-modal-backdrop', 'schedule-modal-backdrop', 'schedule-agenda-modal-backdrop', 'corrective-client-modal-backdrop'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        });
    }
    sync();
})();
