/* ===== Configuración Operativa · Etapas 1B y 1C (Transportes, Horas extras y roles, Alimentación y horarios, Membretes) =====
   Solo ADMIN. Todo pasa por las funciones SQL ops_* de la Etapa 1A (validan rol + hash). */
(function () {
    const q = id => document.getElementById(id);
    const ob = () => q('set-ops-body');
    const me = () => systemUsers.find(u => String(u.id) === String(activeUser));
    const isAdmin = () => { const u = me(); return !!(u && u.role === 'ADMIN'); };
    const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO');
    const parseMoney = s => parseInt(String(s || '').replace(/\D/g, ''), 10) || 0;
    const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; };
    const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    let cfg = null, busy = false, tab = 'transport';

    async function rpc(fn, body) {
        try {
            if (window.HVACSec) {
                if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(String(fn))) return { ok: false, msg: 'Función no permitida.' };
                body = HVACSec.cleanDeep(body);
                if (!(await HVACSec.throttle('POST'))) return { ok: false, msg: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.' };
            }
            const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (r.ok) { let d = null; try { d = await r.json(); } catch (_) {} return { ok: true, data: d }; }
            let m = ''; try { m = (await r.json()).message || ''; } catch (_) {}
            if (/could not find the function|PGRST202/i.test(m)) m = 'Falta el SQL de la Etapa 1A en Supabase. Ejecútalo primero.';
            return { ok: false, msg: m || ('Error ' + r.status) };
        } catch (e) { return { ok: false, msg: 'Sin conexión.' }; }
    }
    const auth = () => { const u = me(); return { p_admin_id: String(u.id), p_hash: u.passwordHash || '' }; };

    async function load() {
        const body = ob(); body.innerHTML = '<div class="oc-empty">Cargando…</div>';
        const r = await rpc('ops_config_get', auth());
        if (!r.ok) { cfg = null; body.innerHTML = '<div class="oc-err">' + esc(r.msg) + '</div>'; return; }
        cfg = r.data || {}; render();
    }

    function render() {
                if (!cfg) return;
        if (tab === 'transport') renderTransport();
        else if (tab === 'overtime') renderOvertime();
        else if (tab === 'meal') renderMeal();
        else if (tab === 'brand') renderBrand();
    }

    function renderTransport() {
        const t = today(), gen = cfg.transport_rates || [], cli = cfg.client_rates || [];
        const cur = gen.find(r => r.effective_date <= t);
        const genRows = gen.map(r => {
            const b = cur && r.id === cur.id ? '<span class="oc-badge ok">Vigente</span>' : r.effective_date > t ? '<span class="oc-badge sch">Programada</span>' : '<span class="oc-badge">Anterior</span>';
            return '<div class="oc-row"><div class="l"><b>' + money(r.amount) + '</b><span>Desde ' + dmy(r.effective_date) + '</span></div>' + b + '</div>';
        }).join('') || '<div class="oc-empty">Aún no hay tarifa general. Agrega la primera.</div>';

        // Por cliente: la vigente es la más reciente con fecha <= hoy (misma regla que ops_resolve_transport_rate)
        const curByClient = {};
        cli.forEach(r => { if (r.effective_date <= t && (!curByClient[r.client_id] || r.effective_date > curByClient[r.client_id].effective_date)) curByClient[r.client_id] = r; });
        const cliRows = cli.map(r => {
            const isCur = curByClient[r.client_id] && curByClient[r.client_id].id === r.id;
            let b = r.effective_date > t ? '<span class="oc-badge sch">Programada</span>' : isCur ? (r.active ? '<span class="oc-badge ok">Vigente</span>' : '<span class="oc-badge off">Inactiva</span>') : '<span class="oc-badge">Anterior</span>';
            const btn = isCur ? '<button type="button" class="oc-mini" data-act="cli-toggle" data-id="' + esc(r.id) + '" data-active="' + (r.active ? '0' : '1') + '">' + (r.active ? 'Desactivar' : 'Activar') + '</button>' : '';
            return '<div class="oc-row"><div class="l"><b>' + esc(r.client_name) + ' · ' + money(r.amount) + '</b><span>Desde ' + dmy(r.effective_date) + (r.notes ? ' · ' + esc(r.notes) : '') + '</span></div><div style="display:flex;gap:6px;align-items:center">' + b + btn + '</div></div>';
        }).join('') || '<div class="oc-empty">Sin tarifas especiales. Los traslados usan la tarifa general.</div>';

        const names = [...new Map(clientsCatalog.filter(c => c && c.name).map(c => [String(c.id), c.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
        ob().innerHTML =
            '<div class="oc-card"><h4><i class="fa-solid fa-route"></i> Tarifa general de transporte</h4>' +
            '<div class="oc-now"><b>' + (cur ? money(cur.amount) : 'Sin definir') + '</b><span class="oc-hint">' + (cur ? 'vigente desde ' + dmy(cur.effective_date) : 'por traslado') + '</span></div>' +
            '<div class="oc-form"><div><label>Nuevo valor (COP)</label><input id="oc-g-amt" class="input-box text-xs" inputmode="numeric" placeholder="Ej: 15.000" autocomplete="off"></div>' +
            '<div><label>Vigente desde</label><input id="oc-g-date" type="date" class="input-box text-xs" value="' + t + '"></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="gen-add"><i class="fa-solid fa-plus"></i> Agregar tarifa</button></div></div>' +
            '<div class="oc-hint">El histórico se conserva: cada traslado usa la tarifa vigente en su fecha.</div>' + genRows + '</div>' +
            '<div class="oc-card"><h4><i class="fa-solid fa-location-dot"></i> Tarifas especiales por cliente / destino</h4>' +
            '<div class="oc-form"><div class="full"><label>Cliente</label><select id="oc-c-cli" class="input-box text-xs"><option value="">Selecciona…</option>' + names.map(n => '<option value="' + esc(n[0]) + '">' + esc(n[1]) + '</option>').join('') + '</select></div>' +
            '<div><label>Valor (COP)</label><input id="oc-c-amt" class="input-box text-xs" inputmode="numeric" placeholder="Ej: 25.000" autocomplete="off"></div>' +
            '<div><label>Vigente desde</label><input id="oc-c-date" type="date" class="input-box text-xs" value="' + t + '"></div>' +
            '<div class="full"><label>Nota (opcional)</label><input id="oc-c-notes" class="input-box text-xs" maxlength="160" placeholder="Ej: Sede lejana"></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="cli-set"><i class="fa-solid fa-floppy-disk"></i> Guardar tarifa especial</button></div></div>' +
            '<div class="oc-hint">Si el cliente ya tiene tarifa con esa fecha, se actualiza. Una tarifa especial desactivada vuelve a la general.</div>' + cliRows + '</div>';
        ['oc-g-amt', 'oc-c-amt'].forEach(id => { const el = q(id); if (el) el.addEventListener('input', () => { const n = parseMoney(el.value); el.value = n ? n.toLocaleString('es-CO') : ''; }); });
    }

    /* ---------- 1C · Horas extras y roles ---------- */
    const OT_TYPES = [['diurna', 'Diurna'], ['nocturna', 'Nocturna'], ['dominical', 'Dominical'], ['festiva', 'Festiva']];
    let hYear = null;
    const num = n => Number(n || 0);
    const dow = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('es-CO', { weekday: 'short' }) : ''; };
    const bindMoney = ids => ids.forEach(id => { const el = q(id); if (el) el.addEventListener('input', () => { const n = parseMoney(el.value); el.value = n ? n.toLocaleString('es-CO') : ''; }); });

    // Valor vigente por cargo y tipo: el más reciente con fecha <= hoy (programados se cuentan aparte)
    function matrixByRole() {
        const t = today(), out = {};
        (cfg.overtime_matrix || []).forEach(r => {
            const o = out[r.role_name] = out[r.role_name] || { cur: {}, sched: 0 };
            if (r.effective_date > t) { o.sched++; return; }
            const c = o.cur[r.overtime_type];
            if (!c || r.effective_date > c.effective_date) o.cur[r.overtime_type] = r;
        });
        return out;
    }

    function renderOvertime() {
        const t = today(), mx = matrixByRole(), roles = Object.keys(mx).sort((a, b) => a.localeCompare(b, 'es'));
        const hol = cfg.holidays || [];
        if (!hYear) hYear = +t.slice(0, 4);
        const years = [...new Set(hol.map(h => +String(h.holiday_date).slice(0, 4)).concat([hYear, +t.slice(0, 4), +t.slice(0, 4) + 1]))].sort();
        const yh = hol.filter(h => String(h.holiday_date).startsWith(String(hYear)));

        const roleRows = roles.map(r => {
            const o = mx[r];
            const vals = OT_TYPES.map(([k, l]) => '<span>' + l + ': <b>' + (o.cur[k] ? money(o.cur[k].rate_value) : '—') + '</b></span>').join(' · ');
            return '<div class="oc-row"><div class="l"><b>' + esc(r) + '</b><span>' + vals + (o.sched ? ' · ' + o.sched + ' cambio(s) programado(s)' : '') + '</span></div>' +
                '<button type="button" class="oc-mini" data-act="mat-edit" data-role="' + esc(r) + '">Editar</button></div>';
        }).join('') || '<div class="oc-empty">Aún no hay cargos con valores. Agrega el primero.</div>';

        const holRows = yh.map(h => '<div class="oc-row"><div class="l"><b>' + esc(h.name) + '</b><span>' + dmy(h.holiday_date) + ' · ' + esc(dow(h.holiday_date)) + '</span></div>' +
            '<button type="button" class="oc-mini" data-act="hol-del" data-date="' + esc(h.holiday_date) + '" data-name="' + esc(h.name) + '">Quitar</button></div>').join('') ||
            '<div class="oc-err">No hay festivos cargados para ' + hYear + '. Sin ellos, las horas festivas no se detectarán.</div>';

        ob().innerHTML =
            '<div class="oc-card"><h4><i class="fa-solid fa-user-clock"></i> Valor de la hora extra por cargo</h4>' +
            '<div class="oc-form"><div class="full"><label>Cargo</label><input id="oc-o-role" class="input-box text-xs" list="oc-o-roles" maxlength="60" placeholder="Ej: Técnico, Auxiliar, Supervisor" autocomplete="off"><datalist id="oc-o-roles">' + roles.map(r => '<option value="' + esc(r) + '">').join('') + '</datalist></div>' +
            OT_TYPES.map(([k, l]) => '<div><label>' + l + ' (COP/hora)</label><input id="oc-o-' + k + '" class="input-box text-xs" inputmode="numeric" placeholder="Sin cambio" autocomplete="off"></div>').join('') +
            '<div class="full"><label>Vigente desde</label><input id="oc-o-date" type="date" class="input-box text-xs" value="' + t + '"></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="mat-save"><i class="fa-solid fa-floppy-disk"></i> Guardar valores</button></div></div>' +
            '<div class="oc-hint">Llena solo los tipos que quieras definir o cambiar; los vacíos no se modifican. Si el cargo y la fecha ya existen, se actualizan.</div>' + roleRows + '</div>' +

            '<div class="oc-card"><h4><i class="fa-solid fa-calendar-day"></i> Festivos de Colombia</h4>' +
            '<div class="oc-form"><div class="full"><label>Año</label><select id="oc-h-year" class="input-box text-xs">' + years.map(y => '<option value="' + y + '"' + (y === hYear ? ' selected' : '') + '>' + y + '</option>').join('') + '</select></div>' +
            '<div><label>Fecha</label><input id="oc-h-date" type="date" class="input-box text-xs" min="' + hYear + '-01-01" max="' + hYear + '-12-31"></div>' +
            '<div><label>Nombre</label><input id="oc-h-name" class="input-box text-xs" maxlength="80" placeholder="Ej: Año Nuevo" autocomplete="off"></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="hol-add"><i class="fa-solid fa-plus"></i> Agregar o actualizar festivo</button></div></div>' +
            '<div class="oc-hint">Verifica los festivos contra el calendario oficial y carga el año siguiente antes de que termine el actual.</div>' + holRows + '</div>';
        bindMoney(OT_TYPES.map(([k]) => 'oc-o-' + k));
        const ys = q('oc-h-year'); if (ys) ys.addEventListener('change', () => { hYear = +ys.value; renderOvertime(); });
    }

    /* ---------- 1C · Alimentación y horarios ---------- */
    const setting = (k, d) => Object.assign({}, d, (cfg.settings || {})[k] || {});

    function renderMeal() {
        const meal = setting('meal_night_amount', { amount: 0 }), sch = setting('schedule', { workday_end: '16:30', tolerance_end: '17:00' }), cut = setting('cut_days', { start_day: 11, end_day: 25 });
        ob().innerHTML =
            '<div class="oc-card"><h4><i class="fa-solid fa-utensils"></i> Alimentación nocturna</h4>' +
            '<div class="oc-form"><div class="full"><label>Valor (COP)</label><input id="oc-m-amt" class="input-box text-xs" inputmode="numeric" placeholder="Ej: 20.000" autocomplete="off" value="' + (num(meal.amount) ? num(meal.amount).toLocaleString('es-CO') : '') + '"></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="set-meal"><i class="fa-solid fa-floppy-disk"></i> Guardar alimentación</button></div></div>' +
            '<div class="oc-hint">Valor actual: <b>' + money(meal.amount) + '</b>. Con 0 no se reconoce alimentación.</div></div>' +

            '<div class="oc-card"><h4><i class="fa-solid fa-clock"></i> Horarios de jornada</h4>' +
            '<div class="oc-form"><div><label>Fin de jornada</label><input id="oc-s-end" type="time" class="input-box text-xs" value="' + esc(sch.workday_end) + '"></div>' +
            '<div><label>Tolerancia hasta</label><input id="oc-s-tol" type="time" class="input-box text-xs" value="' + esc(sch.tolerance_end) + '"></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="set-schedule"><i class="fa-solid fa-floppy-disk"></i> Guardar horarios</button></div></div>' +
            '<div class="oc-hint">La tolerancia no puede ser anterior al fin de jornada.</div></div>' +

            '<div class="oc-card"><h4><i class="fa-solid fa-scissors"></i> Días de corte del periodo</h4>' +
            '<div class="oc-form"><div><label>Día de inicio</label><input id="oc-k-start" type="number" min="1" max="31" class="input-box text-xs" value="' + esc(cut.start_day) + '"></div>' +
            '<div><label>Día de fin</label><input id="oc-k-end" type="number" min="1" max="31" class="input-box text-xs" value="' + esc(cut.end_day) + '"></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="set-cut"><i class="fa-solid fa-floppy-disk"></i> Guardar días de corte</button></div></div>' +
            '<div class="oc-hint">Días del mes entre 1 y 31. Valores actuales: del ' + esc(cut.start_day) + ' al ' + esc(cut.end_day) + '.</div></div>';
        bindMoney(['oc-m-amt']);
    }

    /* ---------- 1C · Membretes ---------- */
    function renderBrand() {
        const c = setting('company', { header_text: '', footer_text: '', logo_url: '', legalization_text: '' });
        ob().innerHTML =
            '<div class="oc-card"><h4><i class="fa-solid fa-file-signature"></i> Membretes de los reportes</h4>' +
            '<div class="oc-form"><div class="full"><label>Encabezado</label><input id="oc-b-head" class="input-box text-xs" maxlength="200" placeholder="Nombre de la empresa" value="' + esc(c.header_text) + '"></div>' +
            '<div class="full"><label>Pie de página</label><input id="oc-b-foot" class="input-box text-xs" maxlength="200" placeholder="Dirección, teléfono, correo" value="' + esc(c.footer_text) + '"></div>' +
            '<div class="full"><label>Logo (URL https://)</label><input id="oc-b-logo" class="input-box text-xs" maxlength="500" placeholder="https://…/logo.png" autocomplete="off" value="' + esc(c.logo_url) + '"></div>' +
            '<div class="full"><img id="oc-b-prev" alt="Vista previa del logo" style="max-height:64px;max-width:100%;display:' + (c.logo_url ? 'block' : 'none') + '"></div>' +
            '<div class="full"><label>Texto de legalización</label><textarea id="oc-b-leg" rows="3" class="input-box text-xs" maxlength="600" placeholder="Texto que aparece junto a las firmas">' + esc(c.legalization_text) + '</textarea></div>' +
            '<div class="full"><button type="button" class="mx-btn mx-btn-pri" data-act="set-brand"><i class="fa-solid fa-floppy-disk"></i> Guardar membretes</button></div></div>' +
            '<div class="oc-hint">Estos textos son los que usarán los reportes de transportes y horas extras en las siguientes etapas.</div></div>';
        const logo = q('oc-b-logo'), prev = q('oc-b-prev');
        const show = () => { const v = logo.value.trim(); if (/^https:\/\//i.test(v)) { prev.src = v; prev.style.display = 'block'; } else { prev.removeAttribute('src'); prev.style.display = 'none'; } };
        prev.addEventListener('error', () => { prev.style.display = 'none'; });
        logo.addEventListener('change', show); show();
    }

    async function run(fn, body, okMsg, audit) {
        if (busy) return; busy = true;
        try {
            const r = await rpc(fn, Object.assign(auth(), body));
            if (!r.ok) return showToast(r.msg, 'error');
            if (audit) registrarAuditoria(audit[0], audit[1], audit[2] || '');
            showToast(okMsg); await load();
        } finally { busy = false; }
    }

    async function runMany(calls, okMsg, audit) {
        if (busy) return; busy = true;
        try {
            for (const [fn, body] of calls) {
                const r = await rpc(fn, Object.assign(auth(), body));
                if (!r.ok) { showToast(r.msg, 'error'); await load(); return; }
            }
            if (audit) registrarAuditoria(audit[0], audit[1], audit[2] || '');
            showToast(okMsg); await load();
        } finally { busy = false; }
    }

    function onClick(e) {
        const b = e.target.closest('[data-act]'); if (!b || !isAdmin()) return;
        const act = b.dataset.act, t = today();
        if (act === 'gen-add') {
            const amt = parseMoney(q('oc-g-amt').value), date = q('oc-g-date').value;
            if (amt <= 0) return showToast('El valor debe ser mayor que cero.', 'error');
            if (!date) return showToast('Indica la fecha de vigencia.', 'error');
            if (date < t && !confirm('La fecha es anterior a hoy. Los traslados pendientes de ese periodo se calcularán con esta tarifa. ¿Continuar?')) return;
            run('ops_transport_rate_add', { p_amount: amt, p_effective_date: date }, 'Tarifa general agregada.', ['INSERT', 'transport_rates']);
        } else if (act === 'cli-set') {
            const id = q('oc-c-cli').value, amt = parseMoney(q('oc-c-amt').value), date = q('oc-c-date').value;
            const c = clientsCatalog.find(x => String(x.id) === id);
            if (!id || !c) return showToast('Selecciona un cliente.', 'error');
            if (amt <= 0) return showToast('El valor debe ser mayor que cero.', 'error');
            if (!date) return showToast('Indica la fecha de vigencia.', 'error');
            if (date < t && !confirm('La fecha es anterior a hoy. ¿Continuar?')) return;
            run('ops_client_rate_set', { p_client_id: id, p_client_name: c.name, p_amount: amt, p_effective_date: date, p_notes: q('oc-c-notes').value.trim() || null }, 'Tarifa especial guardada.', ['UPSERT', 'client_transport_rates', id]);
        } else if (act === 'cli-toggle') {
            const on = b.dataset.active === '1';
            run('ops_client_rate_active', { p_id: b.dataset.id, p_active: on }, on ? 'Tarifa activada.' : 'Tarifa desactivada.', ['UPDATE', 'client_transport_rates', b.dataset.id]);

        } else if (act === 'mat-edit') {
            const o = matrixByRole()[b.dataset.role]; if (!o) return;
            q('oc-o-role').value = b.dataset.role;
            OT_TYPES.forEach(([k]) => { const v = o.cur[k]; q('oc-o-' + k).value = v ? num(v.rate_value).toLocaleString('es-CO') : ''; });
            q('oc-o-role').scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else if (act === 'mat-save') {
            const role = q('oc-o-role').value.trim(), date = q('oc-o-date').value;
            if (!role) return showToast('Indica el cargo.', 'error');
            if (!date) return showToast('Indica la fecha de vigencia.', 'error');
            const calls = OT_TYPES.filter(([k]) => q('oc-o-' + k).value.trim() !== '')
                .map(([k]) => ['ops_matrix_set', { p_role: role, p_type: k, p_value: parseMoney(q('oc-o-' + k).value), p_effective_date: date }]);
            if (!calls.length) return showToast('Escribe al menos un valor.', 'error');
            if (date < t && !confirm('La fecha es anterior a hoy. Las horas extras pendientes de ese periodo se calcularán con estos valores. ¿Continuar?')) return;
            runMany(calls, 'Valores de horas extras guardados.', ['UPSERT', 'overtime_matrix', role]);
        } else if (act === 'hol-add') {
            const date = q('oc-h-date').value, name = q('oc-h-name').value.trim();
            if (!date) return showToast('Indica la fecha del festivo.', 'error');
            if (!name) return showToast('Indica el nombre del festivo.', 'error');
            run('ops_holiday_set', { p_date: date, p_name: name }, 'Festivo guardado.', ['UPSERT', 'holidays', date]);
        } else if (act === 'hol-del') {
            if (!confirm('¿Quitar el festivo "' + b.dataset.name + '" (' + dmy(b.dataset.date) + ')?')) return;
            run('ops_holiday_set', { p_date: b.dataset.date, p_name: '' }, 'Festivo eliminado.', ['DELETE', 'holidays', b.dataset.date]);
        } else if (act === 'set-meal') {
            const raw = q('oc-m-amt').value.trim();
            if (raw === '') return showToast('Indica el valor (0 si no aplica).', 'error');
            run('ops_setting_set', { p_key: 'meal_night_amount', p_value: { amount: parseMoney(raw) } }, 'Alimentación guardada.', ['UPDATE', 'ops_settings', 'meal_night_amount']);
        } else if (act === 'set-schedule') {
            const end = q('oc-s-end').value, tol = q('oc-s-tol').value;
            if (!end || !tol) return showToast('Indica ambas horas.', 'error');
            if (tol < end) return showToast('La tolerancia no puede ser anterior al fin de jornada.', 'error');
            run('ops_setting_set', { p_key: 'schedule', p_value: { workday_end: end, tolerance_end: tol } }, 'Horarios guardados.', ['UPDATE', 'ops_settings', 'schedule']);
        } else if (act === 'set-cut') {
            const a = parseInt(q('oc-k-start').value, 10), z = parseInt(q('oc-k-end').value, 10);
            if (!(a >= 1 && a <= 31 && z >= 1 && z <= 31)) return showToast('Los días del corte deben estar entre 1 y 31.', 'error');
            run('ops_setting_set', { p_key: 'cut_days', p_value: { start_day: a, end_day: z } }, 'Días de corte guardados.', ['UPDATE', 'ops_settings', 'cut_days']);
        } else if (act === 'set-brand') {
            const logo = q('oc-b-logo').value.trim();
            if (logo && !/^https:\/\/\S+$/i.test(logo)) return showToast('El logo debe ser una URL que empiece por https://', 'error');
            run('ops_setting_set', { p_key: 'company', p_value: { header_text: q('oc-b-head').value.trim(), footer_text: q('oc-b-foot').value.trim(), logo_url: logo, legalization_text: q('oc-b-leg').value.trim() } }, 'Membretes guardados.', ['UPDATE', 'ops_settings', 'company']);
        }
    }

    const OPS_SECS = ['transport', 'overtime', 'meal', 'brand'];
    window.setSection = function (sec) {
        document.querySelectorAll('.set-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.sec === sec));
        const ops = OPS_SECS.includes(sec);
        ['general', 'access'].forEach(k => { const el = q('set-pane-' + k); if (el) el.classList.toggle('hidden', ops || k !== sec); });
        const po = q('set-pane-ops'); if (po) po.classList.toggle('hidden', !ops);
        if (!ops) return;
        tab = sec;
        if (!isAdmin()) { ob().innerHTML = '<div class="oc-err">Solo el administrador puede ver esta configuración.</div>'; return; }
        if (cfg) render(); else load();
    };
    window.opsCfgTab = window.setSection;
    function bind() { const m = q('set-ops-body'); if (m && !m._b) { m._b = 1; m.addEventListener('click', onClick); } }
    document.addEventListener('DOMContentLoaded', bind); bind();
})();
