-- =====================================================================
-- CONTROL OPERATIVO · ETAPA 3B · Auxilio de alimentación + recálculo al editar marcación
-- Requiere 05_horas_extras_etapa3A.sql ejecutado. Idempotente.
-- Compatibilidad: asistencia.fecha puede ser TEXT YYYY-MM-DD; se normaliza a DATE en la lectura.
-- Corrección: el corte horario de alimentación se calcula en variable PL/pgSQL (sin CASE en IF).
--
-- SUPUESTO (confirma o ajusta):
--   Se reconoce auxilio de alimentación cuando la hora de SALIDA nocturna
--   del técnico (último CHECK-OUT del día) es POSTERIOR a las 19:00
--   (hora inicio de jornada nocturna vigente desde 25-dic-2025) O el día es
--   festivo/dominical. Se guarda una sola vez por fila; si ya fue aprobada
--   no se recalcula. El valor viene de ops_settings key='meal_night_amount'.
--   Si meal_night_amount.amount = 0 → no se reconoce alimentación.
--
-- CAMBIOS:
--   1. ALTER TABLE hvac_overtime: columna meal_amount numeric(14,0) default 0.
--   2. ops_ot_decide: al Aprobar, lee meal_night_amount y lo guarda en meal_amount.
--   3. ops_ot_cut_preview / ops_ot_cut_create / ops_ot_cut_list:
--      exponen meal_total en la respuesta.
--   4. ops_ot_list: incluye meal_amount en cada fila.
--   5. ops_ot_recalc_day: función nueva. Recalcula las Pendientes (sin corte) de
--      un técnico y día; elimina las que ya no califiquen. La llama att-edit.js
--      tras admin_asistencia_update.
-- =====================================================================

-- ── 1. Nueva columna (idempotente) ──────────────────────────────────
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_name='hvac_overtime' and column_name='meal_amount') then
    alter table hvac_overtime add column meal_amount numeric(14,0) not null default 0
      check (meal_amount >= 0);
  end if;
end $$;

-- ── 2. ops_ot_decide (con alimentación al aprobar) ──────────────────
create or replace function ops_ot_decide(
  p_admin_id text, p_hash text, p_id uuid, p_decision text, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_night_cutoff time := time '19:00'; v_meal_cutoff time;
  v_reform date := date '2025-12-25';
  v_meal_amount numeric := 0; v_meal jsonb; v_ot hvac_overtime%rowtype;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_decision not in ('Aprobado','Rechazado') then raise exception 'Decisión no válida'; end if;
  if p_decision = 'Rechazado' and coalesce(trim(p_reason),'') = '' then raise exception 'Indica el motivo del rechazo'; end if;

  select * into v_ot from hvac_overtime where id = p_id for update;
  if not found then raise exception 'El registro no existe'; end if;
  if v_ot.status <> 'Pendiente' then raise exception 'Este registro ya fue %', lower(v_ot.status); end if;

  -- Determinar auxilio de alimentación (solo al aprobar)
  if p_decision = 'Aprobado' then
    select value into v_meal from ops_settings where key = 'meal_night_amount';
    v_meal_amount := coalesce((v_meal->>'amount')::numeric, 0);
    if v_meal_amount > 0 then
      -- Aplica si: tipo nocturna/festiva/dominical  O  si la salida (end_at en Bogotá) > 19:00
      -- Para festiva/dominical se asume jornada que amerita alimentación por extensión de horario.
      -- Para diurna: solo si end_at supera el corte nocturno.
      if v_ot.overtime_type in ('festiva','dominical') then
        null; -- aplica siempre cuando el tipo ya es festiva/dominical
      elsif v_ot.overtime_type = 'nocturna' then
        null; -- aplica siempre (el tipo nocturno ya implica salida nocturna)
      else
        -- tipo 'diurna': la salida debe ser estrictamente posterior al corte vigente.
        -- Se calcula el corte en una variable para evitar ambigüedad del parser PL/pgSQL.
        if v_ot.work_date < v_reform then
          v_meal_cutoff := time '21:00';
        else
          v_meal_cutoff := v_night_cutoff;
        end if;

        if v_ot.end_at is null
           or (v_ot.end_at at time zone 'America/Bogota')::time <= v_meal_cutoff then
          v_meal_amount := 0;
        end if;
      end if;
    end if;
  end if;

  update hvac_overtime
     set status       = p_decision,
         meal_amount  = case when p_decision = 'Aprobado' then v_meal_amount else 0 end,
         reject_reason= case when p_decision = 'Rechazado' then trim(p_reason) else null end,
         approved_by  = p_admin_id,
         approved_at  = now()
   where id = p_id;

  perform ops_audit_log(p_admin_id, 'ot_' || lower(p_decision),
    jsonb_build_object('id', p_id, 'reason', p_reason, 'meal', v_meal_amount));
end $$;

-- ── 3. ops_ot_list (incluye meal_amount) ────────────────────────────
-- La función ya devuelve to_jsonb(t) completo; al tener la columna nueva
-- en la tabla, automáticamente aparece. Reemplazamos igual para garantizar
-- la firma y el orden de campos (sin cambios en la lógica).
create or replace function ops_ot_list(
  p_admin_id text, p_hash text, p_from date, p_to date, p_status text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.work_date desc, t.employee_name, t.overtime_type)
    from (select * from hvac_overtime
           where work_date between coalesce(p_from, date '2000-01-01')
                               and coalesce(p_to,   date '2999-12-31')
             and (p_status is null or p_status = '' or status = p_status)
           order by work_date desc, employee_name, overtime_type limit 1000) t
  ), '[]'::jsonb);
end $$;

-- ── 4. ops_ot_cut_preview (incluye meal_total) ──────────────────────
create or replace function ops_ot_cut_preview(
  p_admin_id text, p_hash text, p_from date, p_to date
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a_n int; a_h numeric; a_t numeric; a_m numeric;
  p_n int; p_t numeric; ov record;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  select count(*), coalesce(sum(hours),0), coalesce(sum(amount),0), coalesce(sum(meal_amount),0)
    into a_n, a_h, a_t, a_m
    from hvac_overtime
   where status = 'Aprobado' and cut_id is null and work_date between p_from and p_to;
  select count(*), coalesce(sum(amount),0) into p_n, p_t from hvac_overtime
   where status = 'Pendiente' and work_date between p_from and p_to;
  select period_start, period_end into ov from operational_cuts
   where kind = 'overtime' and period_start <= p_to and period_end >= p_from
   order by period_start limit 1;
  return jsonb_build_object(
    'approved_n',     a_n,
    'approved_hours', a_h,
    'approved_total', a_t,
    'meal_total',     a_m,
    'grand_total',    a_t + a_m,
    'pending_n',      p_n,
    'pending_total',  p_t,
    'overlap', case when ov.period_start is null then null
               else jsonb_build_object('from', ov.period_start, 'to', ov.period_end) end
  );
end $$;

-- ── 5. ops_ot_cut_create (incluye meal_total en resultado) ──────────
create or replace function ops_ot_cut_create(
  p_admin_id text, p_hash text, p_from date, p_to date, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid; n int; tot numeric; hrs numeric; meal numeric; pend int;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  if p_to - p_from > 92 then raise exception 'Un corte no puede pasar de 92 días'; end if;
  perform pg_advisory_xact_lock(hashtext('ops_cut_overtime'));
  if exists (select 1 from operational_cuts
              where kind = 'overtime' and period_start <= p_to and period_end >= p_from) then
    raise exception 'El periodo se cruza con otro corte de horas extras. Revierte ese corte o cambia las fechas.';
  end if;
  select count(*), coalesce(sum(amount),0), coalesce(sum(hours),0), coalesce(sum(meal_amount),0)
    into n, tot, hrs, meal
    from hvac_overtime
   where status = 'Aprobado' and cut_id is null and work_date between p_from and p_to;
  if n = 0 then raise exception 'No hay horas extras aprobadas en ese periodo para cortar'; end if;
  insert into operational_cuts(kind, period_start, period_end, status, note, closed_by)
  values ('overtime', p_from, p_to, 'cerrado', nullif(trim(coalesce(p_note,'')),''), p_admin_id)
  returning id into v;
  update hvac_overtime set cut_id = v
   where status = 'Aprobado' and cut_id is null and work_date between p_from and p_to;
  select count(*) into pend from hvac_overtime where status = 'Pendiente' and work_date between p_from and p_to;
  perform ops_audit_log(p_admin_id, 'ot_cut_create',
    jsonb_build_object('id', v, 'from', p_from, 'to', p_to, 'count', n, 'total', tot, 'meal', meal));
  return jsonb_build_object('id', v, 'count', n, 'hours', hrs,
    'total', tot, 'meal_total', meal, 'grand_total', tot + meal, 'pending_left', pend);
end $$;

-- ── 6. ops_ot_cut_list (incluye meal en cada corte) ─────────────────
create or replace function ops_ot_cut_list(p_admin_id text, p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  return jsonb_build_object(
    'cut_days', coalesce((select value from ops_settings where key = 'cut_days'),
                '{"start_day":26,"end_day":25}'::jsonb),
    'cuts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',           c.id,
          'period_start', c.period_start,
          'period_end',   c.period_end,
          'status',       c.status,
          'note',         c.note,
          'closed_by',    c.closed_by,
          'closed_at',    c.closed_at,
          'n',            coalesce(x.n,0),
          'hours',        coalesce(x.h,0),
          'total',        coalesce(x.t,0),
          'meal_total',   coalesce(x.m,0),
          'grand_total',  coalesce(x.t,0) + coalesce(x.m,0)
        ) order by c.period_start desc, c.closed_at desc)
      from (select * from operational_cuts where kind = 'overtime'
            order by period_start desc limit 60) c
      left join lateral (
        select count(*) n, sum(hours) h, sum(amount) t, sum(meal_amount) m
          from hvac_overtime o where o.cut_id = c.id
      ) x on true
    ), '[]'::jsonb));
end $$;

-- ── 7. ops_ot_recalc_day (recálculo tras editar marcación) ──────────
-- Recalcula SOLO las horas extras Pendientes (sin corte) del técnico y día.
-- Elimina las que ya no califiquen. No toca Aprobadas, Rechazadas ni en corte.
-- La lógica de clasificación replica ops_ot_detect para ese único día.
create or replace function ops_ot_recalc_day(
  p_admin_id text, p_hash text, p_tech_id text, p_date date
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sched jsonb; v_end time; v_tol time;
  v_night time := time '19:00'; v_night_old time := time '21:00';
  v_reform date := date '2025-12-25';
  r record; mx record; ex record;
  v_key text; v_amt numeric; v_n int;
  n_del int := 0; n_upd int := 0; n_new int := 0;
  v_role text; v_tname text;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_tech_id is null or p_date is null then raise exception 'Técnico y fecha son obligatorios'; end if;

  select value into v_sched from ops_settings where key = 'schedule';
  v_end := coalesce(nullif(v_sched->>'workday_end','')::time, time '16:30');
  v_tol := coalesce(nullif(v_sched->>'tolerance_end','')::time, time '17:00');

  -- Cargo actual del técnico
  select coalesce(u.payload->>'cargo', u.payload->>'position', u.payload->>'role') into v_role
    from hvac_users u where u.id::text = p_tech_id;

  -- Calcular los tipos que HOY califican para este técnico y día
  for r in
    with m as (
      select a.id::text as id, a.hora, a.tipo
        from asistencia a
       where (case
                when btrim(coalesce(a.fecha::text, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                then btrim(a.fecha::text)::date
                else null::date
              end) = p_date
         and a.tecnico_id::text = p_tech_id
         and a.tipo in ('CHECK-IN','CHECK-OUT')
         and a.dentro_rango is not false
    ), s as (
      select m.*, lead(id) over w as n_id, lead(tipo) over w as n_tipo, lead(hora) over w as n_hora
        from m window w as (order by hora, id)
    ), iv as (
      select s.id, s.n_id,
             (s.hora   at time zone 'America/Bogota') as li,
             (s.n_hora at time zone 'America/Bogota') as lo
        from s where s.tipo = 'CHECK-IN' and s.n_tipo = 'CHECK-OUT' and s.n_hora > s.hora
    ), b as (
      select iv.*,
             max(iv.lo) over () as last_lo,
             p_date::timestamp + v_end as ws,
             p_date::timestamp + v_tol as wt,
             p_date::timestamp + case when p_date < v_reform then v_night_old else v_night end as nb,
             case when exists (select 1 from holidays h where h.holiday_date = p_date) then 'festiva'
                  when extract(dow from p_date) = 0 then 'dominical' end as sp
        from iv
    ), seg as (
      select sp as typ, li as s_l, lo as e_l, id, n_id from b where sp is not null
      union all
      select 'diurna', greatest(li, ws), least(lo, nb), id, n_id
        from b where sp is null and last_lo > wt and least(lo, nb) > greatest(li, ws)
      union all
      select 'nocturna', greatest(li, ws, nb), lo, id, n_id
        from b where sp is null and last_lo > wt and lo > greatest(li, ws, nb)
    )
    select seg.typ,
           round((sum(extract(epoch from (seg.e_l - seg.s_l))) / 3600.0)::numeric, 2) as hrs,
           min(seg.s_l) as s_l, max(seg.e_l) as e_l,
           min(seg.id) as m_in, max(seg.n_id) as m_out
      from seg
     group by seg.typ
    having round((sum(extract(epoch from (seg.e_l - seg.s_l))) / 3600.0)::numeric, 2) >= 0.01
  loop
    v_key := 'ot:' || p_tech_id || ':' || p_date || ':' || r.typ;
    -- Buscar tasa
    select rate_value, id into mx from overtime_matrix
     where lower(trim(role_name)) = lower(trim(coalesce(v_role,'')))
       and overtime_type = r.typ and effective_date <= p_date
     order by effective_date desc limit 1;
    if mx.rate_value is null then continue; end if;
    v_amt := round(r.hrs * mx.rate_value);

    select id, status, cut_id into ex from hvac_overtime where dedupe_key = v_key;
    if found then
      if ex.status = 'Pendiente' and ex.cut_id is null then
        update hvac_overtime
           set hours = r.hrs, rate_value = mx.rate_value, amount = v_amt, rate_ref = mx.id,
               start_at = r.s_l at time zone 'America/Bogota',
               end_at   = r.e_l at time zone 'America/Bogota',
               mark_in  = r.m_in, mark_out = r.m_out, employee_role = v_role
         where id = ex.id
           and (hours is distinct from r.hrs
                or rate_value is distinct from mx.rate_value
                or amount is distinct from v_amt
                or rate_ref is distinct from mx.id
                or start_at is distinct from (r.s_l at time zone 'America/Bogota')
                or end_at is distinct from (r.e_l at time zone 'America/Bogota')
                or mark_in is distinct from r.m_in
                or mark_out is distinct from r.m_out
                or employee_role is distinct from v_role);
        get diagnostics v_n = row_count;
        if v_n > 0 then n_upd := n_upd + 1; end if;
      end if;
    else
      -- Insertar nueva Pendiente conservando r.m_in/r.m_out como IDs de asistencia.
      select coalesce(u.payload->>'name', u.email) into v_tname
        from hvac_users u where u.id::text = p_tech_id;
      insert into hvac_overtime(employee_id, employee_name, employee_role, work_date, overtime_type,
                                start_at, end_at, hours, rate_value, amount, rate_ref,
                                status, dedupe_key, mark_in, mark_out, created_by)
      values (p_tech_id, coalesce(v_tname,'(sin nombre)'), v_role, p_date, r.typ,
              r.s_l at time zone 'America/Bogota', r.e_l at time zone 'America/Bogota',
              r.hrs, mx.rate_value, v_amt, mx.id,
              'Pendiente', v_key, r.m_in, r.m_out, p_admin_id)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
      get diagnostics v_n = row_count;
      if v_n > 0 then n_new := n_new + 1; end if;
    end if;
  end loop;

  -- Eliminar Pendientes sin corte cuyo tipo ya no califica
  delete from hvac_overtime
   where employee_id = p_tech_id and work_date = p_date
     and status = 'Pendiente' and cut_id is null
     and dedupe_key not in (
       select 'ot:' || p_tech_id || ':' || p_date || ':' || typ
         from (
           with m as (
             select a.id::text as id, a.hora, a.tipo
               from asistencia a
              where (case
                when btrim(coalesce(a.fecha::text, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                then btrim(a.fecha::text)::date
                else null::date
              end) = p_date and a.tecnico_id::text = p_tech_id
                and a.tipo in ('CHECK-IN','CHECK-OUT') and a.dentro_rango is not false
           ), s as (
             select m.*, lead(hora) over (order by hora, id) as n_hora,
                    lead(tipo) over (order by hora, id) as n_tipo
               from m
           ), iv as (
             select s.hora at time zone 'America/Bogota' as li, s.n_hora at time zone 'America/Bogota' as lo
               from s where tipo = 'CHECK-IN' and n_tipo = 'CHECK-OUT' and n_hora > hora
           ), b as (
             select iv.*, max(lo) over() as last_lo,
                    p_date::timestamp + v_end as ws, p_date::timestamp + v_tol as wt,
                    p_date::timestamp + case when p_date < v_reform then v_night_old else v_night end as nb,
                    case when exists (select 1 from holidays h where h.holiday_date = p_date) then 'festiva'
                         when extract(dow from p_date) = 0 then 'dominical' end as sp from iv
           )
           select sp as typ from b where sp is not null
           union all select 'diurna' from b where sp is null and last_lo > wt and least(lo,nb) > greatest(li,ws)
           union all select 'nocturna' from b where sp is null and last_lo > wt and lo > greatest(li,ws,nb)
         ) valid_types
     );
  get diagnostics n_del = row_count;

  perform ops_audit_log(p_admin_id, 'ot_recalc_day',
    jsonb_build_object('tech', p_tech_id, 'date', p_date,
                       'updated', n_upd, 'created', n_new, 'deleted', n_del));
  return jsonb_build_object('updated', n_upd, 'created', n_new, 'deleted', n_del);
end $$;

-- Prueba: select ops_ot_recalc_day('ID_ADMIN','HASH_ADMIN','ID_TECNICO',date '2026-11-01');
