-- =====================================================================
-- CONTROL OPERATIVO · ETAPA 4A · PDF de liquidación de transportes
-- Requiere 1A, 2A, 2B y 2C. Idempotente.
-- Devuelve el detalle completo de un corte de transportes para generar
-- el PDF en el navegador (membrete, tabla, totales por técnico, gran total).
-- =====================================================================

-- Detalle de un corte de transportes para PDF
create or replace function ops_tr_cut_detail(p_admin_id text, p_hash text, p_cut_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cut  operational_cuts%rowtype;
  v_hd   jsonb;
  v_rows jsonb;
  v_tech jsonb;
  v_tot  numeric;
begin
  perform ops_assert_admin(p_admin_id, p_hash);

  -- Verificar que el corte existe y es de tipo 'transport'
  select * into v_cut from operational_cuts where id = p_cut_id and kind = 'transport';
  if not found then
    raise exception 'Corte no encontrado o no es de tipo transporte';
  end if;

  -- Membrete desde ops_settings key='letterhead'
  select coalesce(value, '{}'::jsonb) into v_hd
    from ops_settings where key = 'letterhead';
  if v_hd is null then v_hd := '{}'::jsonb; end if;

  -- Filas individuales del corte
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',               t.id,
      'work_date',        t.work_date,
      'employee_name',    t.employee_name,
      'employee_role',    t.employee_role,
      'from_client_name', t.from_client_name,
      'to_client_name',   t.to_client_name,
      'distance_km',      t.distance_km,
      'amount',           t.amount,
      'status',           t.status,
      'source',           t.source,
      'reason',           t.reason
    ) order by t.employee_name, t.work_date
  ), '[]'::jsonb) into v_rows
  from hvac_transfers t where t.cut_id = p_cut_id;

  -- Totales por técnico
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'employee_name', employee_name,
      'n',             count(*),
      'total',         coalesce(sum(amount), 0)
    ) order by employee_name
  ), '[]'::jsonb) into v_tech
  from hvac_transfers
  where cut_id = p_cut_id
  group by employee_name;

  -- Gran total
  select coalesce(sum(amount), 0) into v_tot
    from hvac_transfers where cut_id = p_cut_id;

  return jsonb_build_object(
    'cut',        jsonb_build_object(
                    'id',           v_cut.id,
                    'period_start', v_cut.period_start,
                    'period_end',   v_cut.period_end,
                    'status',       v_cut.status,
                    'note',         v_cut.note,
                    'closed_at',    v_cut.closed_at,
                    'closed_by',    v_cut.closed_by
                  ),
    'letterhead', v_hd,
    'rows',       v_rows,
    'by_tech',    v_tech,
    'grand_total',v_tot
  );
end $$;

-- Prueba: select ops_tr_cut_detail('ID_ADMIN','HASH','UUID_CORTE');
