
/* ===== Edición / eliminación de marcaciones (solo ADMIN, vía funciones SQL que validan el rol) ===== */
const attMe = () => systemUsers.find(u => String(u.id) === String(activeUser));
const attIsAdmin = () => { const u = attMe(); return !!(u && u.role === 'ADMIN'); };
async function attRpc(fn, body) {
    try {
        if (window.HVACSec) {
            if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(String(fn))) return { ok: false, msg: 'Función no permitida.' };
            body = HVACSec.cleanDeep(body);
            if (!(await HVACSec.throttle('POST'))) return { ok: false, msg: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.' };
        }
        const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.ok) { let d = null; try { d = await r.json(); } catch (_) {} return { ok: true, data: d }; }
        let m = ''; try { m = (await r.json()).message || ''; } catch (_) {}
        return { ok: false, msg: m || ('Error ' + r.status) };
    } catch (e) { return { ok: false, msg: 'Sin conexión.' }; }
}
function attEdit(id) {
    if (!attIsAdmin()) return showToast('Solo el administrador puede editar marcaciones.', 'error');
    const r = attRows.find(x => x.id === id); if (!r) return;
    const q = i => document.getElementById(i), d = new Date(r.hora);
    q('att-e-id').value = id; q('att-e-tipo').value = r.tipo; q('att-e-fecha').value = r.fecha;
    q('att-e-hora').value = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    q('att-e-tech').innerHTML = systemUsers.filter(u => u.role !== 'ADMIN').map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const tOpt = [...q('att-e-tech').options].find(o => o.textContent === r.tecnico_nombre); if (tOpt) q('att-e-tech').value = tOpt.value;
    const names = getSortedUniqueClientNames(clientsCatalog.map(c => c.name).concat(r.cliente_nombre));
    q('att-e-client').innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join(''); q('att-e-client').value = r.cliente_nombre;
    q('att-e-img').classList.toggle('hidden', !r.foto_url); if (r.foto_url) q('att-e-img').src = r.foto_url;
    q('att-e-file').value = ''; q('att-e-rmfoto').checked = false; q('att-e-motivo').value = '';
    q('att-edit-modal').classList.remove('hidden');
}
function attEditClose() { document.getElementById('att-edit-modal').classList.add('hidden'); }
async function attEditSave() {
    const q = i => document.getElementById(i), id = q('att-e-id').value, row = attRows.find(x => x.id === id), me = attMe();
    if (!attIsAdmin() || !row) return;
    const motivo = q('att-e-motivo').value.trim();   // opcional
    const fecha = q('att-e-fecha').value, hora = q('att-e-hora').value; if (!fecha || !hora) return showToast('Fecha y hora son obligatorias.', 'error');
    const tech = systemUsers.find(u => String(u.id) === q('att-e-tech').value), cli = clientsCatalog.find(c => c.name === q('att-e-client').value);
    // Guardamos técnico y fecha ANTES del update para recalcular HH extras
    const prevTechId = row.tecnico_id ? String(row.tecnico_id) : null;
    const prevFecha  = row.fecha || null;
    const newTechId  = tech ? String(tech.id) : prevTechId;
    const newFecha   = fecha;

    const patch = { tipo: q('att-e-tipo').value, fecha, hora: new Date(fecha + 'T' + hora).toISOString(), tecnico_id: tech ? String(tech.id) : row.tecnico_id, tecnico_nombre: tech ? tech.name : row.tecnico_nombre,
        cliente_id: cli ? String(cli.id) : row.cliente_id, cliente_nombre: q('att-e-client').value };
    try {
        const f = q('att-e-file').files[0];
        if (f) {
            const blob = await HVAC.img.compress(f, { maxW: 720, quality: 0.7, maxBytes: 120 * 1024 }), path = 'asistencia/' + fecha.replace(/-/g, '/') + '/' + id + '-adm-' + Date.now() + '.jpg';
            if (!(await HVAC.storage.upload(path, blob, 'image/jpeg'))) return showToast('No se pudo subir la foto.', 'error');
            patch.foto_url = HVAC.storage.publicUrl(path);
        } else if (q('att-e-rmfoto').checked) patch.foto_url = '';
    } catch (e) { return showToast('Error procesando la foto.', 'error'); }

    const r = await attRpc('admin_asistencia_update', { p_admin_id: String(me.id), p_hash: me.passwordHash || '', p_id: id, p_patch: patch, p_motivo: motivo || '' });
    if (!r.ok) return showToast(r.msg, 'error');
    registrarAuditoria('UPDATE', 'asistencia', id);
    attEditClose();
    showToast('Marcación actualizada.');
    attLoad();

    // ── Recálculo de horas extras Pendientes (3B) ────────────────────
    // Se recalcula el técnico+día original y, si cambió, también el nuevo.
    const toRecalc = new Set();
    if (prevTechId && prevFecha) toRecalc.add(prevTechId + '|' + prevFecha);
    if (newTechId  && newFecha)  toRecalc.add(newTechId  + '|' + newFecha);
    for (const key of toRecalc) {
        const [tid, fec] = key.split('|');
        attRpc('ops_ot_recalc_day', { p_admin_id: String(me.id), p_hash: me.passwordHash || '', p_tech_id: tid, p_date: fec })
            .then(res => {
                if (!res.ok) return; // silencioso; no interrumpe el flujo
                const d = res.data || {};
                if (d.created || d.updated || d.deleted) {
                    if (typeof window.otLoad === 'function') window.otLoad();
                }
            })
            .catch(() => {}); // no bloquear si la función aún no existe (pre-3B)
    }
}
async function attDelete(id) {
    if (!attIsAdmin()) return showToast('Solo el administrador puede eliminar marcaciones.', 'error');
    const me = attMe(), ans = prompt('¿Eliminar esta marcación? Motivo (opcional). Pulsa Cancelar para no eliminar.'); if (ans === null) return; const motivo = ans.trim();
    const row = attRows.find(x => x.id === id);
    const techId = row ? String(row.tecnico_id) : null;
    const fecha  = row ? row.fecha : null;

    const r = await attRpc('admin_asistencia_delete', { p_admin_id: String(me.id), p_hash: me.passwordHash || '', p_id: id, p_motivo: motivo || '' });
    if (!r.ok) return showToast(r.msg, 'error');
    registrarAuditoria('DELETE', 'asistencia', id);
    showToast('Marcación eliminada.');
    attLoad();

    // Recalcular HH extras del técnico y día eliminado
    if (techId && fecha) {
        attRpc('ops_ot_recalc_day', { p_admin_id: String(me.id), p_hash: me.passwordHash || '', p_tech_id: techId, p_date: fecha })
            .then(res => { if ((res.data || {}).deleted && typeof window.otLoad === 'function') window.otLoad(); })
            .catch(() => {});
    }
}
