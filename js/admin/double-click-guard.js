
        // Bloqueo anti doble clic: la reserva del consecutivo PREV es asíncrona.
        ['saveScheduleRoutine', 'saveNewRoutineManual'].forEach(function (name) {
            var orig = window[name], busy = false;
            if (typeof orig !== 'function') return;
            window[name] = async function () {
                if (busy) return;
                busy = true;
                try { return await orig.apply(this, arguments); } finally { busy = false; }
            };
        });
    