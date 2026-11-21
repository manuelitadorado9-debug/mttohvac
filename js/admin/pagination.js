
(function () {
    'use strict';
    var PAGE_SIZE = 15;
    var TABLE_IDS = [
        'caja-unified-table-body',
        'billing-table-body',
        'clients-table-body',
        'planning-table-body',
        'agenda-table-body',
        'financial-table-body'
    ];
    var states = Object.create(null);
    var timers = Object.create(null);

    function getState(id) {
        if (!states[id]) states[id] = { page: 1, body: null, controls: null, signature: '' };
        return states[id];
    }

    function getRows(body) {
        return Array.prototype.slice.call(body.querySelectorAll(':scope > tr')).filter(function (row) {
            return !row.dataset.paginationPlaceholder;
        });
    }

    function getControls(body, id, state) {
        if (state.controls && state.controls.isConnected) return state.controls;
        var host = body.closest('.overflow-x-auto') || body.parentElement;
        if (!host) return null;
        var controls = document.createElement('div');
        controls.className = 'client-pagination';
        controls.id = id + '-pagination';
        controls.setAttribute('aria-label', 'Paginación de resultados');
        controls.innerHTML =
            '<span class="pagination-meta" data-pagination-meta>Mostrando 0-0 de 0 registros</span>' +
            '<div class="pagination-controls">' +
            '<button type="button" data-pagination-prev>Anterior</button>' +
            '<span class="pagination-page" data-pagination-page>Página 1 / 1</span>' +
            '<button type="button" data-pagination-next>Siguiente</button>' +
            '</div>';
        host.insertAdjacentElement('afterend', controls);
        controls.querySelector('[data-pagination-prev]').addEventListener('click', function () {
            state.page = Math.max(1, state.page - 1);
            paginate(id);
        });
        controls.querySelector('[data-pagination-next]').addEventListener('click', function () {
            var rows = getRows(body);
            state.page = Math.min(Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), state.page + 1);
            paginate(id);
        });
        state.controls = controls;
        return controls;
    }

    function paginate(id) {
        var body = document.getElementById(id);
        if (!body) return;
        var state = getState(id);
        state.body = body;
        var rows = getRows(body);
        var controls = getControls(body, id, state);
        if (!controls) return;

        // Los mensajes de "sin resultados" se muestran sin contarlos como registros.
        var dataRows = rows.filter(function (row) {
            return !(rows.length === 1 && row.querySelector('td[colspan]'));
        });
        var total = dataRows.length;
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        state.page = Math.min(Math.max(1, state.page), pages);

        rows.forEach(function (row) { row.hidden = true; });
        if (total > 0) {
            var startIndex = (state.page - 1) * PAGE_SIZE;
            dataRows.slice(startIndex, startIndex + PAGE_SIZE).forEach(function (row) { row.hidden = false; });
        } else if (rows.length) {
            rows.forEach(function (row) { row.hidden = false; });
        }

        var from = total ? (state.page - 1) * PAGE_SIZE + 1 : 0;
        var to = total ? Math.min(state.page * PAGE_SIZE, total) : 0;
        controls.querySelector('[data-pagination-meta]').textContent =
            'Mostrando ' + from + '-' + to + ' de ' + total + ' registros';
        controls.querySelector('[data-pagination-page]').textContent = 'Página ' + state.page + ' / ' + pages;
        controls.querySelector('[data-pagination-prev]').disabled = state.page <= 1;
        controls.querySelector('[data-pagination-next]').disabled = state.page >= pages;
        state.signature = rows.map(function (r) { return r.textContent; }).join('\u241f');
    }

    function schedule(id) {
        if (timers[id]) clearTimeout(timers[id]);
        timers[id] = setTimeout(function () {
            timers[id] = null;
            paginate(id);
        }, 35);
    }

    function resetAllPages() {
        TABLE_IDS.forEach(function (id) {
            getState(id).page = 1;
            schedule(id);
        });
    }

    function init() {
        TABLE_IDS.forEach(function (id) {
            var body = document.getElementById(id);
            if (!body) return;
            var state = getState(id);
            state.body = body;
            paginate(id);
            var observer = new MutationObserver(function () { schedule(id); });
            observer.observe(body, { childList: true, subtree: true, characterData: true });
        });

        // Cualquier búsqueda, filtro o selector vuelve a la primera página.
        document.addEventListener('input', function (event) {
            var el = event.target;
            if (el && (el.matches('input, textarea') || el.matches('select'))) resetAllPages();
        }, true);
        document.addEventListener('change', function (event) {
            var el = event.target;
            if (el && el.matches('select, input[type="checkbox"], input[type="radio"], input[type="date"], input[type="month"]')) resetAllPages();
        }, true);

        // Si la aplicación cambia de vista o vuelve a pintar una tabla, revalidar el estado.
        window.addEventListener('resize', function () {
            TABLE_IDS.forEach(schedule);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
