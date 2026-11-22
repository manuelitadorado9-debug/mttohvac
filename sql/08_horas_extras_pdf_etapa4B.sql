-- =====================================================================
-- CONTROL OPERATIVO · ETAPA 4B · PDF de liquidación de horas extras
-- Requiere 05_horas_extras_etapa3A.sql y 06_horas_extras_etapa3B.sql.
-- Idempotente (CREATE OR REPLACE).
--
-- NUEVO:
--   ops_ot_cut_detail(p_admin_id, p_hash, p_cut_id) → jsonb
--   Devuelve: { cut, letterhead, rows, by_tech, grand_total }
--   - cut        : metadatos del corte (id, period_start, period_end, status, note)
--   - letterhead : ops_settings key='letterhead' (company_name, nit, logo_url)
--   - rows       : detalle por registro (técnico, fecha, tipo, entrada, salida,
--                  horas, valor HE, alimentación, total_fila)
--   - by_tech    : resumen por técnico (horas, total HE, alimentación, gran total)
--   - grand_total: gran total general (HE + alimentación)
-- =====================================================================

create or replace function ops_ot_cut_detail(
  p_admin_id text,
  p_hash     text,
  p_cut_id   uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cut  record;
  v_lh   jsonb;
  v_rows jsonb;
  v_by   jsonb;
  v_grand numeric;
begin
  perform ops_assert_admin(p_admin_id, p_hash);

  -- Metadatos del corte
  select * into v_cut from operational_cuts where id = p_cut_id and kind = 'overtime';
  if not found then raise exception 'Corte no encontrado o no es de tipo overtime'; end if;

  -- Membrete
  select coalesce(value, '{}'::jsonb) into v_lh from ops_settings where key = 'letterhead';

  -- Filas de detalle
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',            o.id,
      'employee_name', o.employee_name,
      'employee_role', o.employee_role,
      'work_date',     o.work_date,
      'overtime_type', o.overtime_type,
      'start_at',      o.start_at,
      'end_at',        o.end_at,
      'hours',         o.hours,
      'rate_value',    o.rate_value,
      'amount',        o.amount,
      'meal_amount',   o.meal_amount,
      'row_total',     o.amount + o.meal_amount
    ) order by o.work_date, o.employee_name, o.overtime_type
  ), '[]'::jsonb)
  into v_rows
  from hvac_overtime o where o.cut_id = p_cut_id;

  -- Resumen por técnico
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'employee_name', o.employee_name,
      'n',             count(*),
      'hours',         sum(o.hours),
      'ot_total',      sum(o.amount),
      'meal_total',    sum(o.meal_amount),
      'grand_total',   sum(o.amount + o.meal_amount)
    ) order by o.employee_name
  ), '[]'::jsonb)
  into v_by
  from (
    select employee_name, hours, amount, meal_amount
    from hvac_overtime where cut_id = p_cut_id
  ) o;

  -- Gran total
  select coalesce(sum(amount + meal_amount), 0) into v_grand
  from hvac_overtime where cut_id = p_cut_id;

  return jsonb_build_object(
    'cut', jsonb_build_object(
      'id',           v_cut.id,
      'period_start', v_cut.period_start,
      'period_end',   v_cut.period_end,
      'status',       v_cut.status,
      'note',         v_cut.note,
      'closed_by',    v_cut.closed_by,
      'closed_at',    v_cut.closed_at
    ),
    'letterhead', v_lh,
    'rows',       v_rows,
    'by_tech',    v_by,
    'grand_total', v_grand
  );
end $$;

-- Prueba: select ops_ot_cut_detail('ID_ADMIN','HASH_ADMIN','UUID_CORTE');
