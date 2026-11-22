-- =====================================================================
-- CONTROL OPERATIVO · ETAPA 2B · Detección automática de traslados por GPS
-- Requiere 1A y 2A. Idempotente. NO modifica la tabla "asistencia" (solo la lee).
-- Regla: SALIDA en un cliente seguido de ENTRADA en OTRO cliente, el mismo día y
-- por el mismo técnico, dentro de p_max_gap_min minutos. Se ignoran marcaciones
-- "fuera de rango" (dentro_rango = false). Cada par se registra una sola vez
-- (dedupe_key), así que repetir la detección no duplica ni revive rechazados.
-- SUPUESTO: asistencia(id, tecnico_id, tecnico_nombre, cliente_id, cliente_nombre,
--           tipo 'CHECK-IN'/'CHECK-OUT', fecha date, hora timestamptz, dentro_rango boolean).
-- =====================================================================

create or replace function ops_transfers_detect(
  p_admin_id text, p_hash text, p_from date, p_to date, p_max_gap_min int default 180)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; rt record; v_key text;
  n_pairs int := 0; n_new int := 0; n_dup int := 0; n_norate int := 0; n_range int := 0;
  v_ins int;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  if p_to - p_from > 92 then raise exception 'Máximo 92 días por detección'; end if;
  if coalesce(p_max_gap_min,0) < 5 or p_max_gap_min > 720 then raise exception 'Tiempo máximo entre salida y entrada no válido (5 a 720 min)'; end if;

  for r in
    with m as (
      select a.id::text as id, a.tecnico_id::text as tid, a.tecnico_nombre as tname, a.fecha,
             a.hora, a.tipo, a.dentro_rango,
             a.cliente_id::text as cid, a.cliente_nombre as cname,
             coalesce(nullif(a.cliente_id::text,''), lower(trim(a.cliente_nombre))) as ckey
        from asistencia a
       where a.fecha between p_from and p_to
         and coalesce(a.tecnico_id::text,'') <> '' and a.tipo in ('CHECK-IN','CHECK-OUT')
    ), s as (
      select m.*,
             lag(id) over w as p_id, lag(tipo) over w as p_tipo, lag(hora) over w as p_hora,
             lag(cid) over w as p_cid, lag(cname) over w as p_cname, lag(ckey) over w as p_ckey,
             lag(dentro_rango) over w as p_rango
        from m window w as (partition by tid, fecha order by hora, id)
    )
    select s.*, coalesce(u.payload->>'cargo', u.payload->>'position', u.payload->>'role') as role_txt
      from s left join hvac_users u on u.id::text = s.tid
     where s.tipo = 'CHECK-IN' and s.p_tipo = 'CHECK-OUT'
       and s.p_ckey is distinct from s.ckey
       and s.hora - s.p_hora between interval '0' and make_interval(mins => p_max_gap_min)
     order by s.fecha, s.hora
  loop
    n_pairs := n_pairs + 1;
    if r.dentro_rango is false or r.p_rango is false then n_range := n_range + 1; continue; end if;
    v_key := 'gps:' || r.p_id || ':' || r.id;
    if exists (select 1 from hvac_transfers where dedupe_key = v_key) then n_dup := n_dup + 1; continue; end if;
    select * into rt from ops_resolve_transport_rate(coalesce(r.cid,''), r.fecha);
    if rt.amount is null then n_norate := n_norate + 1; continue; end if;
    insert into hvac_transfers(source, employee_id, employee_name, employee_role, work_date, transfer_time, reason,
                               from_client_id, from_client_name, to_client_id, to_client_name,
                               amount, rate_source, rate_ref, status, dedupe_key, mark_from, mark_to, created_by)
    values ('gps', r.tid, coalesce(r.tname,'(sin nombre)'), r.role_txt, r.fecha, r.hora,
            'Traslado automático por GPS (salida ' || to_char(r.p_hora at time zone 'America/Bogota','HH24:MI') ||
            ' → entrada ' || to_char(r.hora at time zone 'America/Bogota','HH24:MI') || ')',
            r.p_cid, r.p_cname, r.cid, r.cname,
            rt.amount, rt.source, rt.rate_id, 'Pendiente', v_key, r.p_id, r.id, p_admin_id)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then n_new := n_new + 1; else n_dup := n_dup + 1; end if;
  end loop;

  perform ops_audit_log(p_admin_id, 'transfers_detect', jsonb_build_object('from', p_from, 'to', p_to,
          'gap_min', p_max_gap_min, 'pairs', n_pairs, 'created', n_new, 'no_rate', n_norate));
  return jsonb_build_object('pairs', n_pairs, 'created', n_new, 'duplicates', n_dup,
                            'no_rate', n_norate, 'out_of_range', n_range);
end $$;

-- Prueba: select ops_transfers_detect('ID_ADMIN','HASH_ADMIN', date '2026-11-01', date '2026-11-21', 180);
