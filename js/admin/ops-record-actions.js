/* Acciones comunes para registros aprobados de Transportes y Horas Extras. */
(function () {
    const q = id => document.getElementById(id);
    let current = null, busy = false;

    async function rpc(fn, body) {
        try {
            if (window.HVACSec) {
                body = HVACSec.cleanDeep(body);
                if (!(await HVACSec.throttle('POST'))) return { ok: false, msg: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.' };
            }
            const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
                method: 'POST',
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: 'Bearer ' + SUPABASE_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (r.ok) return { ok: true, data: await r.json().catch(() => null) };
            let msg = '';
            try { const d = await r.json(); msg = d.message || d.details || ''; } catch (_) {}
            return { ok: false, msg: msg || ('Error ' + r.status) };
        } catch (_) {
            return { ok: false, msg: 'Sin conexión.' };
        }
    }

    window.opsRecordManageOpen = function (kind, id, detail, cutId) {
        const users = typeof systemUsers !== 'undefined' ? systemUsers : (window.systemUsers || []);
        const active = typeof activeUser !== 'undefined' ? activeUser : window.activeUser;
        const user = users.find(u => String(u.id) === String(active));
        if (!user || user.role !== 'ADMIN') return showToast('Solo el administrador puede modificar registros aprobados.', 'error');
        if (!['transport', 'overtime'].includes(kind) || !id) return;
        current = { kind, id: String(id), cutId: cutId || null };
        q('ops-record-actions-title').innerHTML = kind === 'transport'
            ? '<i class="fa-solid fa-route text-teal-600"></i> Transporte aprobado'
            : '<i class="fa-solid fa-user-clock text-teal-600"></i> Hora extra aprobada';
        q('ops-record-actions-detail').textContent = detail || 'Registro seleccionado';
        q('ops-record-actions-note').textContent = cutId
            ? 'Este registro pertenece a un corte. Primero revierte el corte del periodo; después podrás devolverlo a evaluación o eliminarlo.'
            : 'Puedes devolverlo a evaluación para aprobarlo nuevamente o eliminarlo definitivamente. Esta acción queda registrada en auditoría.';
        q('ops-record-reopen').disabled = !!cutId;
        q('ops-record-delete').disabled = !!cutId;
        q('ops-record-actions-modal').classList.remove('hidden');
    };

    window.opsRecordManageClose = function () {
        if (busy) return;
        current = null;
        q('ops-record-actions-modal').classList.add('hidden');
    };

    window.opsRecordManageRun = async function (action) {
        if (busy || !current || !['reopen', 'delete'].includes(action)) return;
        if (current.cutId) return showToast('Primero debes revertir el corte del periodo.', 'error');
        const actionText = action === 'reopen' ? 'devolver a evaluación' : 'eliminar definitivamente';
        if (!confirm('¿Deseas ' + actionText + ' este registro aprobado?')) return;
        busy = true;
        const buttons = q('ops-record-actions-modal').querySelectorAll('button');
        buttons.forEach(b => b.disabled = true);
        try {
            const fn = current.kind === 'transport' ? 'ops_transfer_review_action' : 'ops_ot_review_action';
            const table = current.kind === 'transport' ? 'hvac_transfers' : 'hvac_overtime';
            const r = await rpc(fn, Object.assign(window.opsAuth(), { p_id: current.id, p_action: action }));
            if (!r.ok) return showToast(r.msg || 'No se pudo modificar el registro.', 'error');
            if (typeof registrarAuditoria === 'function') {
                registrarAuditoria(action === 'delete' ? 'DELETE' : 'UPDATE', table,
                    (action === 'delete' ? 'Eliminado' : 'Devuelto a Pendiente') + ' registro ' + current.id);
            }
            const kind = current.kind;
            current = null;
            q('ops-record-actions-modal').classList.add('hidden');
            showToast(action === 'reopen' ? 'El registro volvió a evaluación.' : 'Registro eliminado.');
            if (kind === 'transport' && typeof window.trLoad === 'function') {
                if (action === 'reopen' && q('tr-status')) q('tr-status').value = 'Pendiente';
                window.trLoad();
            }
            if (kind === 'overtime' && typeof window.otLoad === 'function') {
                if (action === 'reopen' && q('ot-status')) q('ot-status').value = 'Pendiente';
                window.otLoad();
            }
        } finally {
            busy = false;
            buttons.forEach(b => b.disabled = false);
        }
    };
})();
