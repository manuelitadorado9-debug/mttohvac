-- =====================================================================
-- MIGRACIÓN 12 · TRANSPORTES GPS: SIN RESTRICCIÓN PRÁCTICA DE 1 A 4 HORAS
-- Ejecutar en Supabase SQL Editor antes de probar la detección.
-- La secuencia ya agrupa las marcaciones por técnico y fecha; por ello 1439
-- minutos (23 h 59 min) cubren cualquier par válido del mismo día.
-- Se reinstalan las funciones preview/detect para sustituir cuerpos SQL viejos
-- que todavía rechazaban diferencias mayores de 720 minutos.
-- Conserva filtros de fechas, mismo técnico/día, cambio de cliente, GPS,
-- tarifas, deduplicación, auditoría y controles administrativos.
-- =====================================================================

-- =====================================================================
-- CONTROL OPERATIVO · ETAPA 5 · Secuencia GPS, previsualización sin duplicados
-- y administración de registros aprobados.
-- Requiere haber ejecutado las etapas 01 a 08.
-- No modifica las marcaciones originales de la tabla asistencia.
-- Compatibilidad: asistencia.fecha se normaliza desde TEXT YYYY-MM-DD a DATE y
-- asistencia.hora (TEXT ISO-8601) se convierte a TIMESTAMPTZ en zona local Bogotá.
-- =====================================================================

-- 1) Fuente común de pares GPS.
--    - Recalcula el rango contra la ubicación ACTUAL del cliente en hvac_clients,
--      usando la misma prioridad de campos y radio por defecto que attendance.js.
--    - Si no hay coordenadas actuales, replica el comportamiento de la pantalla:
--      usa el indicador persistido; si el cliente existe pero no tiene sede GPS,
--      el resultado queda indeterminado (NULL), no se marca falsamente fuera.
--    - Consolida eventos consecutivos repetidos del mismo tipo en la misma sede.
--      Prefiere una marcación dentro de rango; luego, para CHECK-OUT conserva la
--      última hora repetida y para CHECK-IN la primera.
--    - Solo considera una transición cronológica CHECK-OUT de una sede seguida
--      por CHECK-IN en otra sede, del mismo técnico y día, dentro del intervalo.

create or replace function ops_transfer_gps_candidates(
  p_from date, p_to date, p_max_gap_min int
)
returns table (
  employee_id text,
  employee_name text,
  employee_role text,
  work_date date,
  departure_time timestamptz,
  transfer_time timestamptz,
  from_client_id text,
  from_client_name text,
  to_client_id text,
  to_client_name text,
  mark_from text,
  mark_to text,
  from_in_range boolean,
  to_in_range boolean,
  from_distance_m numeric,
  from_radius_m numeric,
  to_distance_m numeric,
  to_radius_m numeric,
  gap_minutes numeric
)
language sql stable security definer set search_path = public as $$
  with raw as (
    select
      a.id::text as mark_id,
      a.tecnico_id::text as employee_id,
      a.tecnico_nombre as employee_name,
      case
        when btrim(coalesce(a.fecha::text, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then btrim(a.fecha::text)::date
        else null::date
      end as work_date,
      case
        -- La app técnica y el editor administrativo guardan hora como ISO-8601
        -- (new Date(...).toISOString()), normalmente terminado en Z.
        when btrim(coalesce(a.hora::text, '')) ~
             '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)$'
          then btrim(a.hora::text)::timestamptz
        -- Compatibilidad con timestamps antiguos sin zona explícita:
        -- se interpretan como hora local de Colombia, no como UTC del servidor.
        when btrim(coalesce(a.hora::text, '')) ~
             '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?$'
          then (btrim(a.hora::text)::timestamp without time zone)
                 at time zone 'America/Bogota'
        else null::timestamptz
      end as mark_time,
      a.tipo as mark_type,
      a.cliente_id::text as client_id,
      a.cliente_nombre as client_name,
      coalesce(c.id::text, nullif(a.cliente_id::text, ''), lower(trim(a.cliente_nombre))) as client_key,
      a.lat::double precision as gps_lat,
      a.lng::double precision as gps_lng,
      a.dentro_rango as stored_in_range,
      c.id::text as current_client_id,
      case
        when coalesce(c.payload->>'lat', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (c.payload->>'lat')::double precision
        when coalesce(c.payload->>'latitud', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (c.payload->>'latitud')::double precision
        else null
      end as client_lat,
      case
        when coalesce(c.payload->>'lng', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (c.payload->>'lng')::double precision
        when coalesce(c.payload->>'longitud', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (c.payload->>'longitud')::double precision
        else null
      end as client_lng,
      case
        when coalesce(c.payload->>'geoRadius', '') ~ '^[0-9]+'
        then case when substring(c.payload->>'geoRadius' from '^[0-9]+')::int > 0
                  then substring(c.payload->>'geoRadius' from '^[0-9]+')::int else 150 end
        else 150
      end::numeric as client_radius_m
    from asistencia a
    left join lateral (
      select c0.id, c0.payload
      from hvac_clients c0
      where c0.id::text = a.cliente_id::text
         or regexp_replace(
              translate(replace(replace(lower(trim(coalesce(c0.payload->>'name', ''))), chr(160), ' '), chr(8203), ' '),
                        'áéíóúüñ', 'aeiouun'),
              '[[:space:]]+', ' ', 'g')
            = regexp_replace(
              translate(replace(replace(lower(trim(coalesce(a.cliente_nombre, ''))), chr(160), ' '), chr(8203), ' '),
                        'áéíóúüñ', 'aeiouun'),
              '[[:space:]]+', ' ', 'g')
      order by case when c0.id::text = a.cliente_id::text then 0 else 1 end
      limit 1
    ) c on true
    where (case
             when btrim(coalesce(a.fecha::text, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             then btrim(a.fecha::text)::date
             else null::date
           end) between p_from and p_to
      and coalesce(a.tecnico_id::text, '') <> ''
      and a.tipo in ('CHECK-IN', 'CHECK-OUT')
  ), distances as (
    select r.*,
      case when r.gps_lat is not null and r.gps_lng is not null
                 and r.client_lat is not null and r.client_lng is not null
           then round((6371000.0 * 2.0 * asin(sqrt(least(1.0, greatest(0.0,
             power(sin(radians((r.client_lat - r.gps_lat) / 2.0)), 2)
             + cos(radians(r.gps_lat)) * cos(radians(r.client_lat))
             * power(sin(radians((r.client_lng - r.gps_lng) / 2.0)), 2)
           )))))::numeric, 0)
           else null
      end as distance_m
    from raw r
    where r.mark_time is not null
  ), evaluated as (
    select d.*,
      case
        when d.gps_lat is null or d.gps_lng is null then d.stored_in_range
        when d.current_client_id is null then d.stored_in_range
        when d.client_lat is null or d.client_lng is null then null::boolean
        else d.distance_m <= d.client_radius_m
      end as in_range,
      case when d.client_lat is not null and d.client_lng is not null
           then d.client_radius_m else null end as radius_m
    from distances d
  ), previous_raw as (
    select e.*,
      lag(e.mark_type) over w as previous_type,
      lag(e.client_key) over w as previous_client_key
    from evaluated e
    window w as (partition by e.employee_id, e.work_date order by e.mark_time, e.mark_id)
  ), grouped as (
    select p.*,
      sum(case when p.previous_type is distinct from p.mark_type
                    or p.previous_client_key is distinct from p.client_key
               then 1 else 0 end)
        over (partition by p.employee_id, p.work_date order by p.mark_time, p.mark_id) as event_group
    from previous_raw p
  ), events as (
    select distinct on (g.employee_id, g.work_date, g.event_group)
      g.*
    from grouped g
    order by g.employee_id, g.work_date, g.event_group,
      case when g.in_range is true then 0 when g.in_range is null then 1 else 2 end,
      case when g.mark_type = 'CHECK-OUT' then g.mark_time end desc nulls last,
      case when g.mark_type = 'CHECK-IN' then g.mark_time end asc nulls first,
      g.mark_id
  ), sequenced as (
    select e.*,
      lag(e.mark_id) over w as previous_id,
      lag(e.employee_name) over w as previous_employee_name,
      lag(e.mark_time) over w as previous_time,
      lag(e.client_id) over w as previous_client_id,
      lag(e.client_name) over w as previous_client_name,
      lag(e.client_key) over w as previous_client_key2,
      lag(e.in_range) over w as previous_in_range,
      lag(e.distance_m) over w as previous_distance_m,
      lag(e.radius_m) over w as previous_radius_m,
      lag(e.mark_type) over w as previous_event_type
    from events e
    window w as (partition by e.employee_id, e.work_date order by e.mark_time, e.mark_id)
  )
  select
    s.employee_id,
    coalesce(s.employee_name, s.previous_employee_name),
    coalesce(u.payload->>'cargo', u.payload->>'position', u.payload->>'role'),
    s.work_date,
    s.previous_time,
    s.mark_time,
    s.previous_client_id,
    s.previous_client_name,
    s.client_id,
    s.client_name,
    s.previous_id,
    s.mark_id,
    s.previous_in_range,
    s.in_range,
    s.previous_distance_m,
    s.previous_radius_m,
    s.distance_m,
    s.radius_m,
    -- mark_time y previous_time ya son TIMESTAMPTZ, no TEXT.
    round((extract(epoch from (s.mark_time - s.previous_time)) / 60.0)::numeric, 1)
  from sequenced s
  left join hvac_users u on u.id::text = s.employee_id
  where s.mark_type = 'CHECK-IN'
    and s.previous_event_type = 'CHECK-OUT'
    and s.previous_client_key2 is distinct from s.client_key
    and s.mark_time > s.previous_time
    and s.mark_time - s.previous_time >= interval '0 seconds'
     and (p_max_gap_min is null or s.mark_time - s.previous_time <= make_interval(mins => p_max_gap_min))
  order by s.work_date, s.mark_time, s.employee_id;
$$;

revoke all on function ops_transfer_gps_candidates(date, date, int) from public, anon, authenticated;

-- 2) Previsualización. No escribe datos. Devuelve exclusivamente pares nuevos
--    (y los que carecen de tarifa); los ya registrados y fuera de rango solo
--    aparecen en sus contadores y nunca se ofrecen para importar.
create or replace function ops_transfers_preview(
  p_admin_id text, p_hash text, p_from date, p_to date, p_max_gap_min int default 180
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; rt record;
  n_pairs int := 0; n_new int := 0; n_dup int := 0; n_norate int := 0; n_range int := 0;
  v_items jsonb := '[]'::jsonb;
  v_status text;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  if p_max_gap_min is not null and (p_max_gap_min < 5 or p_max_gap_min > 1439) then raise exception 'El intervalo entre marcaciones debe estar entre 5 y 1439 minutos'; end if;

  for r in select * from ops_transfer_gps_candidates(p_from, p_to, p_max_gap_min) loop
    n_pairs := n_pairs + 1;
    if r.from_in_range is false or r.to_in_range is false then
      n_range := n_range + 1;
      continue;
    end if;

    if exists (
      select 1 from hvac_transfers t
      where t.source = 'gps'
        and (t.dedupe_key = 'gps:' || r.mark_from || ':' || r.mark_to
             or (t.mark_from = r.mark_from and t.mark_to = r.mark_to))
    ) then
      n_dup := n_dup + 1;
      continue;
    end if;

    select * into rt from ops_resolve_transport_rate(coalesce(r.to_client_id, ''), r.work_date);
    if rt.amount is null then
      n_norate := n_norate + 1;
      v_status := 'sin_tarifa';
    else
      n_new := n_new + 1;
      v_status := 'nuevo';
    end if;

    if jsonb_array_length(v_items) < 300 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'employee_id', r.employee_id,
        'employee_name', r.employee_name,
        'employee_role', r.employee_role,
        'date', r.work_date,
        'from', r.from_client_name,
        'to', r.to_client_name,
        'from_time', to_char(r.departure_time at time zone 'America/Bogota', 'HH24:MI'),
        'to_time', to_char(r.transfer_time at time zone 'America/Bogota', 'HH24:MI'),
        'gap_minutes', r.gap_minutes,
        'amount', rt.amount,
        'rate_source', rt.source,
        'status', v_status,
        'from_distance_m', r.from_distance_m,
        'from_radius_m', r.from_radius_m,
        'to_distance_m', r.to_distance_m,
        'to_radius_m', r.to_radius_m
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'gap_min', p_max_gap_min),
    'pairs', n_pairs, 'new', n_new, 'existing', n_dup,
    'out_of_range', n_range, 'no_rate', n_norate,
    'truncated', (n_new + n_norate) > 300,
    'items', v_items
  );
end $$;

-- 3) Importación definitiva. Repite la comprobación dentro de la transacción:
--    si dos administradores abren la misma previsualización, solo uno inserta.
create or replace function ops_transfers_detect(
  p_admin_id text, p_hash text, p_from date, p_to date, p_max_gap_min int default 180
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; rt record; v_key text; v_ins int;
  n_pairs int := 0; n_new int := 0; n_dup int := 0; n_norate int := 0; n_range int := 0;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  if p_max_gap_min is not null and (p_max_gap_min < 5 or p_max_gap_min > 1439) then raise exception 'El intervalo entre marcaciones debe estar entre 5 y 1439 minutos'; end if;

  perform pg_advisory_xact_lock(hashtext('ops_transfers_detect_gps'));
  for r in select * from ops_transfer_gps_candidates(p_from, p_to, p_max_gap_min) loop
    n_pairs := n_pairs + 1;
    if r.from_in_range is false or r.to_in_range is false then
      n_range := n_range + 1;
      continue;
    end if;

    v_key := 'gps:' || r.mark_from || ':' || r.mark_to;
    if exists (
      select 1 from hvac_transfers t
      where t.source = 'gps'
        and (t.dedupe_key = v_key or (t.mark_from = r.mark_from and t.mark_to = r.mark_to))
    ) then
      n_dup := n_dup + 1;
      continue;
    end if;

    select * into rt from ops_resolve_transport_rate(coalesce(r.to_client_id, ''), r.work_date);
    if rt.amount is null then
      n_norate := n_norate + 1;
      continue;
    end if;

    insert into hvac_transfers(
      source, employee_id, employee_name, employee_role, work_date, transfer_time, reason,
      from_client_id, from_client_name, to_client_id, to_client_name,
      amount, rate_source, rate_ref, status, dedupe_key, mark_from, mark_to, created_by
    ) values (
      'gps', r.employee_id, coalesce(r.employee_name, '(sin nombre)'), r.employee_role,
      r.work_date, r.transfer_time,
      'Traslado automático por GPS (salida ' || to_char(r.departure_time at time zone 'America/Bogota', 'HH24:MI') ||
      ' → entrada ' || to_char(r.transfer_time at time zone 'America/Bogota', 'HH24:MI') || ')',
      r.from_client_id, r.from_client_name, r.to_client_id, r.to_client_name,
      rt.amount, rt.source, rt.rate_id, 'Pendiente', v_key, r.mark_from, r.mark_to, p_admin_id
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;

    get diagnostics v_ins = row_count;
    if v_ins > 0 then n_new := n_new + 1; else n_dup := n_dup + 1; end if;
  end loop;

  perform ops_audit_log(p_admin_id, 'transfers_detect', jsonb_build_object(
    'from', p_from, 'to', p_to, 'gap_min', p_max_gap_min,
    'pairs', n_pairs, 'created', n_new, 'duplicates', n_dup,
    'no_rate', n_norate, 'out_of_range', n_range
  ));
  return jsonb_build_object('pairs', n_pairs, 'created', n_new, 'duplicates', n_dup,
                            'no_rate', n_norate, 'out_of_range', n_range);
end $$;

-- 4) Doble clic en un registro aprobado: devolver a Pendiente o eliminar.
--    Los registros incluidos en un corte deben liberarse revirtiendo primero el corte.
create or replace function ops_transfer_review_action(
  p_admin_id text, p_hash text, p_id uuid, p_action text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row hvac_transfers%rowtype;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_action is null or p_action not in ('reopen', 'delete') then raise exception 'Acción no válida'; end if;
  select * into v_row from hvac_transfers where id = p_id for update;
  if not found then raise exception 'El transporte ya no existe'; end if;
  if v_row.status <> 'Aprobado' then raise exception 'Solo se pueden modificar registros aprobados'; end if;
  if v_row.cut_id is not null then raise exception 'Este transporte está incluido en un corte. Revierte primero el corte del periodo.'; end if;

  if p_action = 'reopen' then
    update hvac_transfers
       set status = 'Pendiente', reject_reason = null, approved_by = null, approved_at = null
     where id = p_id;
  else
    delete from hvac_transfers where id = p_id;
  end if;

  perform ops_audit_log(p_admin_id, 'transfer_' || p_action, jsonb_build_object('id', p_id));
  return jsonb_build_object('id', p_id, 'action', p_action);
end $$;

create or replace function ops_ot_review_action(
  p_admin_id text, p_hash text, p_id uuid, p_action text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row hvac_overtime%rowtype;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_action is null or p_action not in ('reopen', 'delete') then raise exception 'Acción no válida'; end if;
  select * into v_row from hvac_overtime where id = p_id for update;
  if not found then raise exception 'La hora extra ya no existe'; end if;
  if v_row.status <> 'Aprobado' then raise exception 'Solo se pueden modificar registros aprobados'; end if;
  if v_row.cut_id is not null then raise exception 'Esta hora extra está incluida en un corte. Revierte primero el corte del periodo.'; end if;

  if p_action = 'reopen' then
    update hvac_overtime
       set status = 'Pendiente', reject_reason = null, approved_by = null,
           approved_at = null, meal_amount = 0
     where id = p_id;
  else
    delete from hvac_overtime where id = p_id;
  end if;

  perform ops_audit_log(p_admin_id, 'overtime_' || p_action, jsonb_build_object('id', p_id));
  return jsonb_build_object('id', p_id, 'action', p_action);
end $$;

-- Las funciones expuestas se invocan mediante PostgREST y validan ADMIN internamente.
-- ops_transfer_gps_candidates permanece privada; solo la consumen las funciones anteriores.
grant execute on function ops_transfers_preview(text, text, date, date, int),
  ops_transfers_detect(text, text, date, date, int),
  ops_transfer_review_action(text, text, uuid, text),
  ops_ot_review_action(text, text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
