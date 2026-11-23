-- =====================================================================
-- CONTROL OPERATIVO · ETAPA 3A · Horas extras y festivos
-- Requiere 1A (y 2C no es necesario). Idempotente. NO modifica "asistencia" (solo la lee).
-- Compatibilidad: asistencia.fecha puede ser TEXT YYYY-MM-DD; se normaliza a DATE en la lectura.
--
-- REGLAS DE CLASIFICACIÓN (zona America/Bogota):
--  * Se parean marcaciones CHECK-IN -> siguiente CHECK-OUT del mismo técnico y día.
--    Se ignoran marcaciones con dentro_rango = false.
--  * Día FESTIVO (tabla holidays)  -> todo el tiempo trabajado es 'festiva'.
--  * Día DOMINGO (no festivo)      -> todo el tiempo trabajado es 'dominical'.
--  * Día ordinario: solo cuenta lo trabajado DESPUÉS del fin de jornada (ops_settings.schedule.workday_end),
--    y solo si la última salida del día es POSTERIOR a la tolerancia (schedule.tolerance_end).
--    Hasta las 19:00 es 'diurna' y desde las 19:00 'nocturna' (Ley 2466/2025, vigente desde 25-dic-2025;
--    antes de esa fecha el corte es 21:00). Para cambiarlo edita v_night / v_night_old en ops_ot_detect.
--  * Valor/hora: overtime_matrix por cargo (cargo/position/role del usuario) y tipo, vigente a la fecha.
--  * Una fila por empleado + día + tipo (dedupe_key). Repetir la detección actualiza las Pendientes
--    cuyo cálculo cambió y no toca las Aprobadas/Rechazadas ni las que están en un corte.
-- =====================================================================

create table if not exists hvac_overtime (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  employee_name text not null,
  employee_role text,
  work_date date not null,
  overtime_type text not null check (overtime_type in ('diurna','nocturna','dominical','festiva')),
  start_at timestamptz,
  end_at timestamptz,
  hours numeric(6,2) not null check (hours > 0),
  rate_value numeric(12,2) not null default 0 check (rate_value >= 0),
  amount numeric(14,0) not null default 0 check (amount >= 0),
  rate_ref uuid,
  status text not null default 'Pendiente' check (status in ('Pendiente','Aprobado','Rechazado')),
  reject_reason text,
  approved_by text, approved_at timestamptz,
  cut_id uuid references operational_cuts(id) on delete set null,
  dedupe_key text,
  mark_in text, mark_out text,                           -- ids de asistencia que lo originaron
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hvac_overtime_dedupe on hvac_overtime(dedupe_key) where dedupe_key is not null;
create index if not exists hvac_overtime_date on hvac_overtime(work_date);
create index if not exists hvac_overtime_cut  on hvac_overtime(cut_id);

alter table hvac_overtime enable row level security;
revoke all on table hvac_overtime from anon, authenticated;

-- Una hora extra incluida en un corte cerrado no se edita ni se borra (solo revirtiendo el corte)
create or replace function ops_ot_lock() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.cut_id is not null
     and coalesce(current_setting('ops.unlock', true),'') <> 'on'
     and exists (select 1 from operational_cuts c where c.id = old.cut_id and c.status in ('cerrado','pagado')) then
    raise exception 'Registro liquidado: revierte el corte antes de modificarlo';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_ops_ot_lock on hvac_overtime;
create trigger trg_ops_ot_lock before update or delete on hvac_overtime
  for each row execute function ops_ot_lock();

-- ---------- Listado ----------
create or replace function ops_ot_list(p_admin_id text, p_hash text, p_from date, p_to date, p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.work_date desc, t.employee_name, t.overtime_type)
    from (select * from hvac_overtime
           where work_date between coalesce(p_from, date '2000-01-01') and coalesce(p_to, date '2999-12-31')
             and (p_status is null or p_status = '' or status = p_status)
           order by work_date desc, employee_name, overtime_type limit 1000) t), '[]'::jsonb);
end $$;

-- ---------- Detección y clasificación desde asistencia ----------
create or replace function ops_ot_detect(p_admin_id text, p_hash text, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sched jsonb; v_end time; v_tol time;
  v_night time := time '19:00';        -- inicio de jornada nocturna (desde 25-dic-2025)
  v_night_old time := time '21:00';    -- antes de la reforma
  v_reform date := date '2025-12-25';
  r record; mx record; ex record; v_key text; v_amt numeric; v_n int;
  n_new int := 0; n_upd int := 0; n_dup int := 0; n_norate int := 0; n_days int := 0;
  roles_missing text[] := '{}';
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  if p_to - p_from > 92 then raise exception 'Máximo 92 días por detección'; end if;
  select value into v_sched from ops_settings where key = 'schedule';
  v_end := coalesce(nullif(v_sched->>'workday_end','')::time, time '16:30');
  v_tol := coalesce(nullif(v_sched->>'tolerance_end','')::time, time '17:00');

  for r in
    with m as (
      select a.id::text as id, a.tecnico_id::text as tid, a.tecnico_nombre as tname,
             case
               when btrim(coalesce(a.fecha::text, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
               then btrim(a.fecha::text)::date
               else null::date
             end as fecha,
             a.hora, a.tipo
        from asistencia a
       where (case
                when btrim(coalesce(a.fecha::text, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                then btrim(a.fecha::text)::date
                else null::date
              end) between p_from and p_to
         and coalesce(a.tecnico_id::text,'') <> ''
         and a.tipo in ('CHECK-IN','CHECK-OUT')
         and a.dentro_rango is not false
    ), s as (
      select m.*, lead(id) over w as n_id, lead(tipo) over w as n_tipo, lead(hora) over w as n_hora
        from m window w as (partition by tid, fecha order by hora, id)
    ), iv as (
      select s.tid, s.tname, s.fecha, s.id, s.n_id,
             (s.hora at time zone 'America/Bogota')   as li,
             (s.n_hora at time zone 'America/Bogota') as lo
        from s where s.tipo = 'CHECK-IN' and s.n_tipo = 'CHECK-OUT' and s.n_hora > s.hora
    ), b as (
      select iv.*,
             max(iv.lo) over (partition by iv.tid, iv.fecha) as last_lo,
             iv.fecha::timestamp + v_end as ws,
             iv.fecha::timestamp + v_tol as wt,
             iv.fecha::timestamp + case when iv.fecha < v_reform then v_night_old else v_night end as nb,
             case when exists (select 1 from holidays h where h.holiday_date = iv.fecha) then 'festiva'
                  when extract(dow from iv.fecha) = 0 then 'dominical' end as sp
        from iv
    ), seg as (
      select tid, tname, fecha, id, n_id, sp as typ, li as s_l, lo as e_l
        from b where sp is not null
      union all
      select tid, tname, fecha, id, n_id, 'diurna', greatest(li, ws), least(lo, nb)
        from b where sp is null and last_lo > wt and least(lo, nb) > greatest(li, ws)
      union all
      select tid, tname, fecha, id, n_id, 'nocturna', greatest(li, ws, nb), lo
        from b where sp is null and last_lo > wt and lo > greatest(li, ws, nb)
    )
    select seg.tid, max(seg.tname) as tname, seg.fecha, seg.typ,
           round((sum(extract(epoch from (seg.e_l - seg.s_l))) / 3600.0)::numeric, 2) as hrs,
           min(seg.s_l) as s_l, max(seg.e_l) as e_l, min(seg.id) as m_in, max(seg.n_id) as m_out,
           max(coalesce(u.payload->>'cargo', u.payload->>'position', u.payload->>'role')) as role_txt
      from seg left join hvac_users u on u.id::text = seg.tid
     group by seg.tid, seg.fecha, seg.typ
    having round((sum(extract(epoch from (seg.e_l - seg.s_l))) / 3600.0)::numeric, 2) >= 0.01
     order by seg.fecha, seg.tid, seg.typ
  loop
    n_days := n_days + 1;
    v_key := 'ot:' || r.tid || ':' || r.fecha || ':' || r.typ;
    select o.rate_value, o.id into mx from overtime_matrix o
     where lower(trim(o.role_name)) = lower(trim(coalesce(r.role_txt,''))) and o.overtime_type = r.typ
       and o.effective_date <= r.fecha
     order by o.effective_date desc limit 1;
    if mx.rate_value is null then
      n_norate := n_norate + 1;
      if not (coalesce(r.role_txt,'(sin cargo)') = any(roles_missing)) then roles_missing := roles_missing || coalesce(r.role_txt,'(sin cargo)'); end if;
      continue;
    end if;
    v_amt := round(r.hrs * mx.rate_value);

    select id, status, cut_id into ex from hvac_overtime where dedupe_key = v_key;
    if found then
      if ex.status = 'Pendiente' and ex.cut_id is null then
        update hvac_overtime
           set hours = r.hrs, rate_value = mx.rate_value, amount = v_amt, rate_ref = mx.id,
               start_at = r.s_l at time zone 'America/Bogota', end_at = r.e_l at time zone 'America/Bogota',
               mark_in = r.m_in, mark_out = r.m_out, employee_role = r.role_txt
         where id = ex.id
           and (hours is distinct from r.hrs or rate_value is distinct from mx.rate_value
                or start_at is distinct from (r.s_l at time zone 'America/Bogota')
                or end_at   is distinct from (r.e_l at time zone 'America/Bogota'));
        get diagnostics v_n = row_count;
        if v_n > 0 then n_upd := n_upd + 1; else n_dup := n_dup + 1; end if;
      else n_dup := n_dup + 1; end if;
      continue;
    end if;

    insert into hvac_overtime(employee_id, employee_name, employee_role, work_date, overtime_type, start_at, end_at,
                              hours, rate_value, amount, rate_ref, status, dedupe_key, mark_in, mark_out, created_by)
    values (r.tid, coalesce(r.tname,'(sin nombre)'), r.role_txt, r.fecha, r.typ,
            r.s_l at time zone 'America/Bogota', r.e_l at time zone 'America/Bogota',
            r.hrs, mx.rate_value, v_amt, mx.id, 'Pendiente', v_key, r.m_in, r.m_out, p_admin_id)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then n_new := n_new + 1; else n_dup := n_dup + 1; end if;
  end loop;

  perform ops_audit_log(p_admin_id, 'ot_detect', jsonb_build_object('from', p_from, 'to', p_to,
          'created', n_new, 'updated', n_upd, 'no_rate', n_norate));
  return jsonb_build_object('found', n_days, 'created', n_new, 'updated', n_upd, 'duplicates', n_dup,
                            'no_rate', n_norate, 'no_rate_roles', to_jsonb(roles_missing));
end $$;

-- ---------- Aprobar / rechazar (solo Pendientes; el rechazo exige motivo) ----------
create or replace function ops_ot_decide(p_admin_id text, p_hash text, p_id uuid, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_decision not in ('Aprobado','Rechazado') then raise exception 'Decisión no válida'; end if;
  if p_decision = 'Rechazado' and coalesce(trim(p_reason),'') = '' then raise exception 'Indica el motivo del rechazo'; end if;
  select status into cur from hvac_overtime where id = p_id for update;
  if not found then raise exception 'El registro no existe'; end if;
  if cur <> 'Pendiente' then raise exception 'Este registro ya fue %', lower(cur); end if;
  update hvac_overtime
     set status = p_decision,
         reject_reason = case when p_decision = 'Rechazado' then trim(p_reason) else null end,
         approved_by = p_admin_id, approved_at = now()
   where id = p_id;
  perform ops_audit_log(p_admin_id, 'ot_' || lower(p_decision), jsonb_build_object('id', p_id, 'reason', p_reason));
end $$;

-- ---------- Cortes de horas extras (kind = 'overtime') ----------
create or replace function ops_ot_cut_preview(p_admin_id text, p_hash text, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a_n int; a_h numeric; a_t numeric; p_n int; p_t numeric; ov record;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  select count(*), coalesce(sum(hours),0), coalesce(sum(amount),0) into a_n, a_h, a_t from hvac_overtime
   where status = 'Aprobado' and cut_id is null and work_date between p_from and p_to;
  select count(*), coalesce(sum(amount),0) into p_n, p_t from hvac_overtime
   where status = 'Pendiente' and work_date between p_from and p_to;
  select period_start, period_end into ov from operational_cuts
   where kind = 'overtime' and period_start <= p_to and period_end >= p_from order by period_start limit 1;
  return jsonb_build_object('approved_n', a_n, 'approved_hours', a_h, 'approved_total', a_t,
    'pending_n', p_n, 'pending_total', p_t,
    'overlap', case when ov.period_start is null then null
               else jsonb_build_object('from', ov.period_start, 'to', ov.period_end) end);
end $$;

create or replace function ops_ot_cut_create(p_admin_id text, p_hash text, p_from date, p_to date, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid; n int; tot numeric; hrs numeric; pend int;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  if p_to - p_from > 92 then raise exception 'Un corte no puede pasar de 92 días'; end if;
  perform pg_advisory_xact_lock(hashtext('ops_cut_overtime'));
  if exists (select 1 from operational_cuts where kind = 'overtime' and period_start <= p_to and period_end >= p_from) then
    raise exception 'El periodo se cruza con otro corte de horas extras. Revierte ese corte o cambia las fechas.';
  end if;
  select count(*), coalesce(sum(amount),0), coalesce(sum(hours),0) into n, tot, hrs from hvac_overtime
   where status = 'Aprobado' and cut_id is null and work_date between p_from and p_to;
  if n = 0 then raise exception 'No hay horas extras aprobadas en ese periodo para cortar'; end if;
  insert into operational_cuts(kind, period_start, period_end, status, note, closed_by)
  values ('overtime', p_from, p_to, 'cerrado', nullif(trim(coalesce(p_note,'')),''), p_admin_id)
  returning id into v;
  update hvac_overtime set cut_id = v
   where status = 'Aprobado' and cut_id is null and work_date between p_from and p_to;
  select count(*) into pend from hvac_overtime where status = 'Pendiente' and work_date between p_from and p_to;
  perform ops_audit_log(p_admin_id, 'ot_cut_create', jsonb_build_object('id', v, 'from', p_from, 'to', p_to, 'count', n, 'total', tot));
  return jsonb_build_object('id', v, 'count', n, 'hours', hrs, 'total', tot, 'pending_left', pend);
end $$;

create or replace function ops_ot_cut_revert(p_admin_id text, p_hash text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c operational_cuts%rowtype; n int;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  perform pg_advisory_xact_lock(hashtext('ops_cut_overtime'));
  select * into c from operational_cuts where id = p_id and kind = 'overtime' for update;
  if not found then raise exception 'El corte no existe o ya fue revertido'; end if;
  if c.status <> 'cerrado' then raise exception 'Este corte ya está marcado como pagado y no se puede revertir'; end if;
  perform set_config('ops.unlock', 'on', true);
  update hvac_overtime set cut_id = null where cut_id = p_id;
  get diagnostics n = row_count;
  delete from operational_cuts where id = p_id;
  perform set_config('ops.unlock', 'off', true);
  perform ops_audit_log(p_admin_id, 'ot_cut_revert', jsonb_build_object('id', p_id, 'from', c.period_start, 'to', c.period_end, 'released', n));
  return jsonb_build_object('released', n);
end $$;

create or replace function ops_ot_cut_list(p_admin_id text, p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  return jsonb_build_object(
    'cut_days', coalesce((select value from ops_settings where key = 'cut_days'), '{"start_day":26,"end_day":25}'::jsonb),
    'cuts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'period_start', c.period_start, 'period_end', c.period_end,
               'status', c.status, 'note', c.note, 'closed_by', c.closed_by, 'closed_at', c.closed_at,
               'n', coalesce(x.n,0), 'hours', coalesce(x.h,0), 'total', coalesce(x.t,0)) order by c.period_start desc, c.closed_at desc)
      from (select * from operational_cuts where kind = 'overtime' order by period_start desc limit 60) c
      left join lateral (select count(*) n, sum(hours) h, sum(amount) t from hvac_overtime o where o.cut_id = c.id) x on true
    ), '[]'::jsonb));
end $$;

-- Prueba: select ops_ot_detect('ID_ADMIN','HASH_ADMIN', date '2026-10-26', date '2026-11-21');
