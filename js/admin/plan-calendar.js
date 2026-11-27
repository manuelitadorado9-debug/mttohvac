
/* ===== Calendario interactivo (FullCalendar, carga diferida) + carga de trabajo por técnico ===== */
let planCal = null, planCalLib = null;
const PLAN_COLORS = ['#0d9488', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#059669', '#dc2626', '#0891b2', '#65a30d', '#9333ea'];
const planColor = n => { let h = 0; String(n || '-').split('').forEach(c => h = (h * 31 + c.charCodeAt(0)) >>> 0); return PLAN_COLORS[h % PLAN_COLORS.length]; };
function planCalLoadLib() {
    if (window.FullCalendar) return Promise.resolve();
    if (planCalLib) return planCalLib;
    const add = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    return planCalLib = add('https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js')
        .then(() => add('https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.15/locales/es.global.min.js').catch(() => {}));
}
const planOrders = () => workOrders.filter(o => o && o.date && !String(o.id || '').startsWith('HIST-') && (!document.getElementById('plan-cal-tech').value || orderTechs(o).includes(document.getElementById('plan-cal-tech').value)));
function planCalEvents() {
    return planOrders().map(o => {
        const done = String(o.status).toUpperCase() === 'COMPLETED', n = (o.equipmentIds || []).length;
        return { id: o.id, start: String(o.date).slice(0, 10), allDay: true, title: `${done ? '✓ ' : ''}${o.technician || 'Sin técnico'} · ${o.client || ''} (${n})`,
            backgroundColor: planColor(orderTechs(o)[0]), borderColor: planColor(orderTechs(o)[0]), classNames: done ? ['opacity-60'] : [], extendedProps: { o } };
    });
}
async function planCalFetchRange(start, end) {
    const s = start.toLocaleDateString('en-CA'), e = end.toLocaleDateString('en-CA');
    const rows = await cloudFetchOrderSummaries(`&id=not.like.HIST-*&payload->>date=gte.${s}&payload->>date=lt.${e}&order=payload->>date.asc&limit=500`);
    if (Array.isArray(rows)) mergeOrderSummariesIntoList(rows);
}
function planCalLoad() {
    if (!planCal) return;
    const v = planCal.view, from = v.currentStart.toLocaleDateString('en-CA'), to = v.currentEnd.toLocaleDateString('en-CA');
    document.getElementById('plan-load-title').textContent = v.title;
    const t = {};
    planOrders().filter(o => String(o.date).slice(0, 10) >= from && String(o.date).slice(0, 10) < to).forEach(o => {
        const n = (o.equipmentIds || []).length, d = String(o.date).slice(0, 10);
        (orderTechs(o).length ? orderTechs(o) : ['Sin técnico']).forEach(k => {
            const r = t[k] = t[k] || { ord: 0, eq: 0, done: 0, days: {} };
            r.ord++; r.eq += n; if (String(o.status).toUpperCase() === 'COMPLETED') r.done++; r.days[d] = (r.days[d] || 0) + n;
        });
    });
    const list = Object.entries(t).sort((a, b) => b[1].eq - a[1].eq), max = Math.max(1, ...list.map(([, r]) => r.eq));
    document.getElementById('plan-load').innerHTML = list.length ? list.map(([k, r]) => {
        const peak = Math.max(...Object.values(r.days));
        return `<div><div class="flex justify-between text-[11px] font-bold text-slate-700"><span>${esc(k)}</span><span>${r.eq} equipos · ${r.ord} rutinas · ${Math.round(r.done / r.ord * 100)}% cerradas · pico ${peak}/día</span></div>
        <div class="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full" style="width:${Math.round(r.eq / max * 100)}%;background:${planColor(k)}"></div></div></div>`;
    }).join('') : '<div class="text-xs text-slate-400">Sin mantenimientos programados en este periodo.</div>';
}
function planCalRefresh() { if (planCal) { planCal.refetchEvents(); planCalLoad(); } }
async function planCalInit() {
    const sel = document.getElementById('plan-cal-tech'), prev = sel.value;
    sel.innerHTML = '<option value="">Todos los técnicos</option>' + systemUsers.filter(u => u.role !== 'ADMIN').map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('');
    sel.value = prev;
    if (planCal) { planCal.updateSize(); return planCalRefresh(); }
    try { await planCalLoadLib(); } catch (e) { document.getElementById('plan-calendar').innerHTML = '<div class="text-xs text-rose-600 p-4">No se pudo cargar el calendario (sin conexión). Reintenta al recuperar señal.</div>'; planCalLib = null; return; }
    const el = document.getElementById('plan-calendar'); el.innerHTML = '';
    planCal = new FullCalendar.Calendar(el, {
        locale: 'es', firstDay: 1, initialView: 'dayGridMonth', height: 'auto', dayMaxEvents: 3,
        dateClick: i => planDayOpen(i.dateStr),
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listWeek' },
        events: (info, ok) => ok(planCalEvents()),
        datesSet: async info => { await planCalFetchRange(info.start, info.end); planCal.refetchEvents(); planCalLoad(); },
        eventClick: i => planDayOpen(String(i.event.startStr).slice(0, 10)),
    });
    planCal.render();
}
/* Membretes PDF desde Supabase Storage (reemplazan los Base64 pesados) */
Promise.resolve(window.HVAC && HVAC.letterhead ? HVAC.letterhead.load() : { header: '', footer: '' }).then(r => { AFC_HEADER_IMG = r.header; AFC_FOOTER_IMG = r.footer; if (!r.header) console.warn('Membrete PDF no disponible: sube membrete/encabezado.jpg y pie.jpg al bucket.'); }).catch(e => console.warn('Membrete PDF:', e));
/* El panel admin usa el SW raíz únicamente para transportar informes PDF bajo demanda.
   El sw.js detecta clientes / e index.html y sirve sus demás recursos siempre desde red,
   sin caché offline del panel. No se precargan datos ni PDFs. */
try {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        // Retirar el worker experimental de alcance /pdf-download/ de la versión anterior.
        navigator.serviceWorker.getRegistrations().then(registrations => {
            const oldScope = new URL('./pdf-download/', document.baseURI).href;
            registrations.forEach(registration => {
                if (registration.scope === oldScope) registration.unregister().catch(() => {});
            });
        }).catch(() => {});
        window.HVAC_PDF_SW_READY = navigator.serviceWorker.register(new URL('./sw.js', document.baseURI).href, { updateViaCache: 'none' })
            .then(async registration => {
                try { await registration.update(); } catch (_) {}
                if (navigator.serviceWorker.controller) return true;
                await Promise.race([
                    new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })),
                    new Promise(resolve => setTimeout(resolve, 10000))
                ]);
                return !!navigator.serviceWorker.controller;
            })
            .catch(error => { console.warn('[PDF] No se pudo activar el transporte seguro:', error); return false; });
    } else {
        window.HVAC_PDF_SW_READY = Promise.resolve(false);
    }
} catch (e) {
    window.HVAC_PDF_SW_READY = Promise.resolve(false);
}
