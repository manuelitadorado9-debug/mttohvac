
/* ===== Recordatorios por periodicidad (panel principal) ===== */
const PERIOD_MONTHS = { Mensual: 1, Bimensual: 2, Trimestral: 3, Cuatrimestral: 4, Semestral: 6, Anual: 12 };
const PERIOD_ALERT_DAYS = 30;                              // avisa cuando faltan 30 días o menos
const PERIOD_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const periodIsNone = v => /^\s*(sin\s+periodicidad|manual)\s*$/i.test(String(v || ''));   // rutinas aisladas: sin ciclo recurrente
let periodAlertSelected = null;
function periodAddMonths(iso, n) { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'), day = d.getDate(); d.setMonth(d.getMonth() + n); if (d.getDate() < day) d.setDate(0); return d; }
function periodAlertsHiddenRead() {
    try { const v = JSON.parse(localStorage.getItem(HVAC_PERIOD_ALERTS_HIDDEN_KEY) || '[]'); return Array.isArray(v) ? v.map(String) : []; }
    catch (_) { return []; }
}
function periodAlertKey(a) {
    if (a && a.projectionId) return 'projection:' + String(a.projectionId);
    return [a && a.client || '', a && a.per || '', a && a.due || '', a && a.text || ''].join('|');
}
function periodAlerts() {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const iso = d => d.toLocaleDateString('en-CA'), todayIso = iso(today), by = {};
    const isolated = new Set((monthlyProjections || []).filter(p => p && p.orderId && periodIsNone(p.periodicity)).flatMap(p => [p.orderId, ...(p.orderIds || [])]).map(String));
    (monthlyProjections || []).forEach(p => { if (p && p.client && !periodIsNone(p.periodicity)) (by[p.client] = by[p.client] || { projs: [], orders: [] }).projs.push(p); });
    (workOrders || []).forEach(o => { if (o && o.client && o.date && by[o.client] && !isolated.has(String(o.id))) by[o.client].orders.push(o); });
    const out = [];
    Object.entries(by).forEach(([client, c]) => {
        const latest = [...c.projs].sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month))[0], per = latest.periodicity;
        // 1) Proyecciones del mes (o de meses anteriores) todavía sin programar
        let flagged = false;
        c.projs.filter(p => p.status === 'PENDING').forEach(p => {
            const start = new Date(p.year, p.month - 1, 1, 12), end = new Date(p.year, p.month, 0, 12), days = Math.round((end - today) / 864e5);
            if (Math.round((start - today) / 864e5) <= PERIOD_ALERT_DAYS) {
                flagged = true;
                out.push({ client, per: p.periodicity || per, days, due: iso(end), text: 'Proyección de ' + PERIOD_MES[p.month - 1] + ' ' + p.year + ' sin programar', projectionId: p.id, equipmentIds: p.equipmentIds || [], budget: p.budget || 0 });
            }
        });
        if (flagged) return;
        // 2) Próximo vencimiento según periodicidad = última ejecución + periodicidad
        const months = PERIOD_MONTHS[per]; if (!months) return;
        const done = c.orders.filter(o => String(o.status || 'PENDING').toUpperCase() !== 'PENDING' && String(o.date).slice(0, 10) <= todayIso).map(o => String(o.date).slice(0, 10)).sort();
        if (!done.length) return;
        const last = done[done.length - 1];
        if (c.orders.some(o => String(o.status || 'PENDING').toUpperCase() === 'PENDING' && String(o.date).slice(0, 10) >= last)) return;
        const due = periodAddMonths(last, months), days = Math.round((due - today) / 864e5);
        if (days <= PERIOD_ALERT_DAYS) out.push({ client, per, days, due: iso(due), text: 'Próximo mantenimiento estimado (último: ' + last.split('-').reverse().join('/') + ')', projectionId: latest.id, equipmentIds: latest.equipmentIds || [], budget: latest.budget || 0 });
    });
    return out.sort((a, b) => a.days - b.days);
}
function periodAlertEnsureModal() {
    let modal = document.getElementById('period-alert-actions-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'period-alert-actions-modal';
    modal.className = 'period-alert-actions-modal fixed inset-0 z-[10004] flex items-center justify-center bg-slate-950/60 p-4 hidden';
    modal.innerHTML = `<div class="period-alert-actions-dialog w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="period-alert-modal-title">
      <div class="period-alert-actions-header flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h3 id="period-alert-modal-title" class="text-base font-black text-slate-900">Recordatorio de mantenimiento</h3><p id="period-alert-modal-sub" class="mt-1 text-xs text-slate-500"></p></div><button type="button" id="period-alert-modal-close" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="space-y-3 p-5"><button type="button" id="period-alert-schedule" class="period-alert-action period-alert-action--schedule"><i class="fa-solid fa-calendar-plus text-lg"></i><span><b class="block text-sm">Programar rutina</b><small class="block text-xs">Abrir la creación con el cliente y los datos del recordatorio.</small></span></button>
      <button type="button" id="period-alert-hide" class="period-alert-action period-alert-action--hide"><i class="fa-solid fa-eye-slash text-lg"></i><span><b class="block text-sm">Quitar de la agenda</b><small class="block text-xs">Ocultar solo este aviso, sin borrar rutinas ni proyecciones.</small></span></button></div>
      <div class="period-alert-actions-footer flex justify-end border-t border-slate-100 px-5 py-3"><button type="button" id="period-alert-modal-cancel" class="rounded-lg px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100">Cerrar</button></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closePeriodAlertActions(); });
    modal.querySelector('#period-alert-modal-close').addEventListener('click', closePeriodAlertActions);
    modal.querySelector('#period-alert-modal-cancel').addEventListener('click', closePeriodAlertActions);
    modal.querySelector('#period-alert-hide').addEventListener('click', hideSelectedPeriodAlert);
    modal.querySelector('#period-alert-schedule').addEventListener('click', scheduleSelectedPeriodAlert);
    return modal;
}
function openPeriodAlertActions(key) {
    const alert = periodAlerts().find(a => periodAlertKey(a) === String(key));
    if (!alert) return showToast('Este recordatorio ya no está disponible.', 'error');
    periodAlertSelected = alert;
    const modal = periodAlertEnsureModal();
    modal.querySelector('#period-alert-modal-title').textContent = alert.client;
    modal.querySelector('#period-alert-modal-sub').textContent = alert.text + ' · ' + (alert.per || 'Sin periodicidad') + ' · ' + String(alert.due || '').split('-').reverse().join('/');
    modal.classList.remove('hidden');
}
function closePeriodAlertActions() {
    const modal = document.getElementById('period-alert-actions-modal');
    if (modal) modal.classList.add('hidden');
    periodAlertSelected = null;
}
function hideSelectedPeriodAlert() {
    if (!periodAlertSelected) return;
    const key = periodAlertKey(periodAlertSelected), hidden = new Set(periodAlertsHiddenRead());
    hidden.add(key);
    localStorage.setItem(HVAC_PERIOD_ALERTS_HIDDEN_KEY, JSON.stringify([...hidden]));
    closePeriodAlertActions();
    renderPeriodAlerts();
    showToast('Recordatorio quitado de la agenda. La rutina y su historial siguen intactos.');
}
function restoreHiddenPeriodAlerts() {
    const n = periodAlertsHiddenRead().length;
    if (!n) return;
    if (!confirm('¿Volver a mostrar los ' + n + ' recordatorio(s) que ocultaste?')) return;
    localStorage.setItem(HVAC_PERIOD_ALERTS_HIDDEN_KEY, '[]');
    renderPeriodAlerts();
    showToast('Recordatorios restaurados en la agenda.');
}
async function scheduleSelectedPeriodAlert() {
    const alert = periodAlertSelected;
    if (!alert) return;
    closePeriodAlertActions();
    if (typeof openNewRoutineModal !== 'function') return showToast('No se pudo abrir el formulario de programación.', 'error');
    await openNewRoutineModal();
    const clientSelect = document.getElementById('nr-client');
    if (!clientSelect || !Array.from(clientSelect.options).some(o => o.value === alert.client)) {
        closeNewRoutineModal();
        return showToast('El cliente no está disponible como cliente activo para programar nuevas rutinas.', 'error');
    }
    clientSelect.value = alert.client;
    const zoneFilter = document.getElementById('nr-zone-filter'); if (zoneFilter) zoneFilter.value = 'ALL';
    await renderAvailableEquipmentForNewRoutine();
    const type = document.getElementById('nr-type'); if (type) type.value = 'PREVENTIVO';
    nrTypeChanged();
    const per = document.getElementById('nr-periodicity');
    if (per && Array.from(per.options).some(o => o.value === alert.per)) per.value = alert.per;
    const today = new Date(); today.setHours(12,0,0,0);
    const todayIso = today.toLocaleDateString('en-CA');
    const suggestedDate = alert.due && alert.due >= todayIso ? alert.due : todayIso;
    const dateInput = document.getElementById('nr-date'); if (dateInput) dateInput.value = suggestedDate;
    const budgetInput = document.getElementById('nr-budget');
    if (budgetInput && Number(alert.budget) > 0) budgetInput.value = String(alert.budget);
    const selected = new Set((alert.equipmentIds || []).map(String));
    if (selected.size) document.querySelectorAll('#nr-equipments-picker .nr-eq-checkbox').forEach(cb => { cb.checked = selected.has(String(cb.value)); });
    showToast('Rutina preparada para ' + alert.client + '. Revisa equipos y técnicos antes de guardar.');
}
function renderPeriodAlerts() {
    const box = document.getElementById('dash-period-alerts'); if (!box) return;
    const all = periodAlerts(), hidden = new Set(periodAlertsHiddenRead()), list = all.filter(a => !hidden.has(periodAlertKey(a)));
    const hiddenCount = hidden.size;
    const over = list.filter(a => a.days < 0).length, soon = list.filter(a => a.days >= 0 && a.days <= 7).length, next = list.length - over - soon;
    const tone = a => a.days < 0 ? ['#e11d48', 'Vencido hace ' + (-a.days) + ' d'] : a.days <= 7 ? ['#d97706', a.days === 0 ? 'Vence hoy' : 'Vence en ' + a.days + ' d'] : ['#2563eb', 'En ' + a.days + ' días'];
    const chip = (n, c, t) => n ? `<span class="pa-chip" style="background:${c}1a;color:${c};border-color:${c}55">${n} ${t}</span>` : '';
    const rows = list.slice(0, 8).map(a => {
        const [c, label] = tone(a), key = escJs(periodAlertKey(a));
        return `<div class="pa-row" style="border-left-color:${c};cursor:pointer" ondblclick="openPeriodAlertActions('${key}')" title="Doble clic para ver opciones">
          <div class="pa-main"><b>${esc(a.client)}</b><span>${esc(a.text)} · ${esc(a.per || '')}</span></div>
          <div class="flex items-center gap-2"><div class="pa-when" style="color:${c}">${esc(label)}<small>${esc(a.due.split('-').reverse().join('/'))}</small></div>
          <button type="button" onclick="event.stopPropagation();openPeriodAlertActions('${key}')" class="period-alert-trigger-btn" title="Opciones del recordatorio" aria-label="Opciones del recordatorio"><i class="fa-solid fa-ellipsis text-xs"></i></button></div></div>`;
    }).join('');
    const restore = hiddenCount ? `<button type="button" onclick="restoreHiddenPeriodAlerts()">Mostrar de nuevo ${hiddenCount} oculto(s)</button>` : '';
    const foot = [];
    if (list.length > 8) foot.push('+' + (list.length - 8) + ' más');
    if (list.length) foot.push('<button type="button" onclick="switchTab(\'admin-planning\')">Ir a Planificación <i class="fa-solid fa-arrow-right"></i></button>');
    if (restore) foot.push(restore);
    box.innerHTML = `<div class="pa-card"><div class="pa-head"><div class="pa-title"><i class="fa-solid fa-bell"></i> Recordatorios de mantenimiento <span class="pa-sub">próximos ${PERIOD_ALERT_DAYS} días</span></div>
      <div class="pa-chips">${chip(over, '#e11d48', 'vencidos')}${chip(soon, '#d97706', 'esta semana')}${chip(next, '#2563eb', 'próximos')}</div></div>
      ${list.length ? '<div class="pa-list">' + rows + '</div>' : `<div class="pa-ok">${hiddenCount ? 'No hay recordatorios visibles. Puedes restaurar los que ocultaste.' : '✅ No hay mantenimientos próximos a vencer según la periodicidad.'}</div>`}
      ${foot.length ? `<div class="pa-foot">${foot.join(' · ')}</div>` : ''}</div>`;
}
(function () { const _r = window.renderAdminDashboard; if (typeof _r === 'function') window.renderAdminDashboard = function () { const x = _r.apply(this, arguments); try { renderPeriodAlerts(); } catch (e) { console.warn(e); } return x; }; })();
