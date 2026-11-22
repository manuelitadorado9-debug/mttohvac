-- =====================================================================
-- CONTROL OPERATIVO · ETAPA 2A · Transportes: listar, registro manual, aprobar/rechazar
-- Requiere la Etapa 1A. Idempotente. NO toca tablas existentes.
-- =====================================================================

create or replace function ops_transfer_list(p_admin_id text, p_hash text, p_from date, p_to date, p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.work_date desc, t.created_at desc)
    from (select * from hvac_transfers
           where work_date between coalesce(p_from, date '2000-01-01') and coalesce(p_to, date '2999-12-31')
             and (p_status is null or p_status = '' or status = p_status)
           order by work_date desc, created_at desc limit 1000) t), '[]'::jsonb);
end $$;

-- Registro manual. Si p_amount viene vacío se usa la tarifa vigente (especial del destino o general) a la fecha del traslado.
create or replace function ops_transfer_add_manual(
  p_admin_id text, p_hash text, p_employee_id text, p_employee_name text, p_employee_role text,
  p_work_date date, p_reason text, p_from_client_id text, p_from_client_name text,
  p_to_client_id text, p_to_client_name text, p_amount numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; r record; v_amount numeric; v_src text; v_ref uuid;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if coalesce(trim(p_employee_id),'') = '' or coalesce(trim(p_employee_name),'') = '' then raise exception 'Selecciona el empleado'; end if;
  if p_work_date is null then raise exception 'Indica la fecha del traslado'; end if;
  if p_work_date > current_date + 1 then raise exception 'La fecha no puede ser futura'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Indica el motivo del traslado'; end if;
  if coalesce(p_amount,0) > 0 then
    v_amount := p_amount; v_src := 'manual'; v_ref := null;
  else
    select * into r from ops_resolve_transport_rate(coalesce(p_to_client_id,''), p_work_date);
    if r.amount is null then raise exception 'No hay tarifa de transporte vigente para esa fecha. Define la tarifa general o escribe el valor.'; end if;
    v_amount := r.amount; v_src := r.source; v_ref := r.rate_id;
  end if;
  insert into hvac_transfers(source, employee_id, employee_name, employee_role, work_date, transfer_time, reason,
                             from_client_id, from_client_name, to_client_id, to_client_name,
                             amount, rate_source, rate_ref, status, created_by)
  values ('manual', trim(p_employee_id), trim(p_employee_name), nullif(trim(coalesce(p_employee_role,'')),''), p_work_date, now(), trim(p_reason),
          nullif(p_from_client_id,''), nullif(p_from_client_name,''), nullif(p_to_client_id,''), nullif(p_to_client_name,''),
          v_amount, v_src, v_ref, 'Pendiente', p_admin_id)
  returning id into v;
  perform ops_audit_log(p_admin_id, 'transfer_add_manual', jsonb_build_object('id', v, 'employee', p_employee_name, 'amount', v_amount, 'date', p_work_date));
  return v;
end $$;

-- Aprobar o rechazar (solo traslados Pendientes; el rechazo exige motivo)
create or replace function ops_transfer_decide(p_admin_id text, p_hash text, p_id uuid, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_decision not in ('Aprobado','Rechazado') then raise exception 'Decisión no válida'; end if;
  if p_decision = 'Rechazado' and coalesce(trim(p_reason),'') = '' then raise exception 'Indica el motivo del rechazo'; end if;
  select status into cur from hvac_transfers where id = p_id for update;
  if not found then raise exception 'El traslado no existe'; end if;
  if cur <> 'Pendiente' then raise exception 'Este traslado ya fue %', lower(cur); end if;
  update hvac_transfers
     set status = p_decision,
         reject_reason = case when p_decision = 'Rechazado' then trim(p_reason) else null end,
         approved_by = p_admin_id, approved_at = now()
   where id = p_id;
  perform ops_audit_log(p_admin_id, 'transfer_' || lower(p_decision), jsonb_build_object('id', p_id, 'reason', p_reason));
end $$;

-- Prueba: select ops_transfer_list('ID_ADMIN','HASH_ADMIN', date '2026-11-01', date '2026-11-30');
