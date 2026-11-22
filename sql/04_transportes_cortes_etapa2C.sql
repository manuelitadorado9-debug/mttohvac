-- =====================================================================
-- CONTROL OPERATIVO · ETAPA 2C · Transportes: cortes de periodo (cerrar y revertir)
-- Requiere 1A, 2A y 2B. Idempotente. Usa operational_cuts y el trigger ops_transfers_lock.
-- Cerrar un corte marca con cut_id los traslados APROBADOS del periodo (quedan bloqueados).
-- Revertirlo libera esos traslados (cut_id = null) y elimina el corte.
-- Un corte 'pagado' no se puede revertir desde aquí.
-- =====================================================================

-- Vista previa de un periodo: qué entraría al corte y si se cruza con otro corte
create or replace function ops_cut_preview(p_admin_id text, p_hash text, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a_n int; a_t numeric; p_n int; p_t numeric; ov record;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  select count(*), coalesce(sum(amount),0) into a_n, a_t from hvac_transfers
   where status = 'Aprobado' and cut_id is null and work_date between p_from and p_to;
  select count(*), coalesce(sum(amount),0) into p_n, p_t from hvac_transfers
   where status = 'Pendiente' and work_date between p_from and p_to;
  select period_start, period_end into ov from operational_cuts
   where kind = 'transport' and period_start <= p_to and period_end >= p_from
   order by period_start limit 1;
  return jsonb_build_object('approved_n', a_n, 'approved_total', a_t, 'pending_n', p_n, 'pending_total', p_t,
    'overlap', case when ov.period_start is null then null
               else jsonb_build_object('from', ov.period_start, 'to', ov.period_end) end);
end $$;

-- Cerrar corte de transportes
create or replace function ops_cut_create(p_admin_id text, p_hash text, p_from date, p_to date, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid; n int; tot numeric; pend int;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango de fechas no válido'; end if;
  if p_to - p_from > 92 then raise exception 'Un corte no puede pasar de 92 días'; end if;
  perform pg_advisory_xact_lock(hashtext('ops_cut_transport'));
  if exists (select 1 from operational_cuts where kind = 'transport' and period_start <= p_to and period_end >= p_from) then
    raise exception 'El periodo se cruza con otro corte de transportes. Revierte ese corte o cambia las fechas.';
  end if;
  select count(*), coalesce(sum(amount),0) into n, tot from hvac_transfers
   where status = 'Aprobado' and cut_id is null and work_date between p_from and p_to;
  if n = 0 then raise exception 'No hay traslados aprobados en ese periodo para cortar'; end if;
  insert into operational_cuts(kind, period_start, period_end, status, note, closed_by)
  values ('transport', p_from, p_to, 'cerrado', nullif(trim(coalesce(p_note,'')),''), p_admin_id)
  returning id into v;
  update hvac_transfers set cut_id = v
   where status = 'Aprobado' and cut_id is null and work_date between p_from and p_to;
  select count(*) into pend from hvac_transfers where status = 'Pendiente' and work_date between p_from and p_to;
  perform ops_audit_log(p_admin_id, 'cut_create', jsonb_build_object('id', v, 'from', p_from, 'to', p_to, 'count', n, 'total', tot));
  return jsonb_build_object('id', v, 'count', n, 'total', tot, 'pending_left', pend);
end $$;

-- Revertir corte (libera los traslados y elimina el corte)
create or replace function ops_cut_revert(p_admin_id text, p_hash text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c operational_cuts%rowtype; n int;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  perform pg_advisory_xact_lock(hashtext('ops_cut_transport'));
  select * into c from operational_cuts where id = p_id and kind = 'transport' for update;
  if not found then raise exception 'El corte no existe o ya fue revertido'; end if;
  if c.status <> 'cerrado' then raise exception 'Este corte ya está marcado como pagado y no se puede revertir'; end if;
  perform set_config('ops.unlock', 'on', true);
  update hvac_transfers set cut_id = null where cut_id = p_id;
  get diagnostics n = row_count;
  delete from operational_cuts where id = p_id;
  perform set_config('ops.unlock', 'off', true);
  perform ops_audit_log(p_admin_id, 'cut_revert', jsonb_build_object('id', p_id, 'from', c.period_start, 'to', c.period_end, 'released', n));
  return jsonb_build_object('released', n);
end $$;

-- Listado de cortes de transportes + días de corte configurados (para sugerir el periodo)
create or replace function ops_cut_list(p_admin_id text, p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  return jsonb_build_object(
    'cut_days', coalesce((select value from ops_settings where key = 'cut_days'), '{"start_day":26,"end_day":25}'::jsonb),
    'cuts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'period_start', c.period_start, 'period_end', c.period_end,
               'status', c.status, 'note', c.note, 'closed_by', c.closed_by, 'closed_at', c.closed_at,
               'n', coalesce(x.n,0), 'total', coalesce(x.t,0)) order by c.period_start desc, c.closed_at desc)
      from (select * from operational_cuts where kind = 'transport' order by period_start desc limit 60) c
      left join lateral (select count(*) n, sum(amount) t from hvac_transfers h where h.cut_id = c.id) x on true
    ), '[]'::jsonb));
end $$;

-- Corte por defecto: del 26 de un mes al 25 del siguiente.
-- Solo cambia el valor si sigue siendo el de fábrica (11 al 25); si ya lo editaste, no lo toca.
insert into ops_settings(key, value) values ('cut_days', '{"start_day":26,"end_day":25}')
on conflict (key) do update set value = excluded.value, updated_at = now()
  where ops_settings.value = '{"start_day":11,"end_day":25}'::jsonb;

-- Prueba: select ops_cut_list('ID_ADMIN','HASH_ADMIN');
