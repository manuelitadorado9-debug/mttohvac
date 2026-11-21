
// La casilla "Un solo informe con todas las zonas" de Programar vuelve a desmarcada cada vez que se cierra la ventana.
(function () {
    var m = document.getElementById('schedule-modal-backdrop');
    if (!m || !window.MutationObserver) return;
    new MutationObserver(function () {
        if (m.classList.contains('hidden')) { var c = document.getElementById('sch-no-split'); if (c) c.checked = false; }
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
})();
