-- =====================================================================
-- CONTROL OPERATIVO · ETAPA 1A · Esquema, seguridad y funciones base
-- Idempotente (se puede ejecutar más de una vez). NO toca tablas existentes.
-- Ejecutar primero en un proyecto de PRUEBA de Supabase (SQL Editor).
-- SUPUESTO A CONFIRMAR: hvac_users(id, payload jsonb) con payload->>'role' y
-- payload->>'passwordHash' (igual que valida admin_asistencia_update).
-- Si tu función existente valida distinto, solo cambia ops_assert_admin().
-- =====================================================================

-- ---------- 1) Tablas ----------
create table if not exists ops_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists transport_rates (            -- tarifa GENERAL con histórico
  id uuid primary key default gen_random_uuid(),
  amount numeric(12,0) not null check (amount > 0),
  effective_date date not null unique,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists client_transport_rates (     -- tarifas ESPECIALES por cliente/destino
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  client_name text not null,
  amount numeric(12,0) not null check (amount > 0),
  effective_date date not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,
  unique (client_id, effective_date)
);

create table if not exists overtime_matrix (            -- valor por hora según cargo y tipo
  id uuid primary key default gen_random_uuid(),
  role_name text not null check (length(trim(role_name)) > 0),
  overtime_type text not null check (overtime_type in ('diurna','nocturna','dominical','festiva')),
  rate_value numeric(12,2) not null check (rate_value >= 0),
  effective_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (role_name, overtime_type, effective_date)
);

create table if not exists holidays (                   -- festivos de Colombia (se cargan por año)
  holiday_date date primary key,
  name text not null
);

create table if not exists operational_cuts (           -- cortes de periodo (transportes / horas extras)
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('transport','overtime')),
  period_start date not null,
  period_end date not null,
  status text not null default 'cerrado' check (status in ('cerrado','pagado')),
  note text,
  closed_by text,
  closed_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table if not exists hvac_transfers (             -- traslados automáticos (GPS) y manuales
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('gps','manual')),
  employee_id text not null,
  employee_name text not null,
  employee_role text,
  work_date date not null,
  transfer_time timestamptz,
  reason text,
  from_client_id text, from_client_name text,
  to_client_id text,   to_client_name text,
  amount numeric(12,0) not null default 0 check (amount >= 0),
  rate_source text check (rate_source in ('general','especial','manual')),
  rate_ref uuid,
  status text not null default 'Pendiente' check (status in ('Pendiente','Aprobado','Rechazado')),
  reject_reason text,
  approved_by text, approved_at timestamptz,
  cut_id uuid references operational_cuts(id) on delete set null,
  dedupe_key text,                                       -- evita duplicar un traslado GPS al recalcular
  mark_from text, mark_to text,                          -- ids de asistencia que lo originaron
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hvac_transfers_dedupe on hvac_transfers(dedupe_key) where dedupe_key is not null;
create index if not exists hvac_transfers_date on hvac_transfers(work_date);
create index if not exists hvac_transfers_cut  on hvac_transfers(cut_id);

create table if not exists ops_audit (                  -- bitácora de cambios administrativos
  id bigserial primary key,
  at timestamptz not null default now(),
  admin_id text,
  action text not null,
  detail jsonb
);

-- ---------- 2) Seguridad: nadie accede directo a las tablas; solo por funciones ----------
do $$ declare t text; begin
  foreach t in array array['ops_settings','transport_rates','client_transport_rates','overtime_matrix',
                           'holidays','operational_cuts','hvac_transfers','ops_audit'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

-- Un traslado ya incluido en un corte cerrado no se puede editar ni borrar (solo revirtiendo el corte)
create or replace function ops_transfers_lock() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.cut_id is not null
     and coalesce(current_setting('ops.unlock', true),'') <> 'on'
     and exists (select 1 from operational_cuts c where c.id = old.cut_id and c.status in ('cerrado','pagado')) then
    raise exception 'Registro liquidado: revierte el corte antes de modificarlo';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_ops_transfers_lock on hvac_transfers;
create trigger trg_ops_transfers_lock before update or delete on hvac_transfers
  for each row execute function ops_transfers_lock();

-- ---------- 3) Funciones internas ----------
create or replace function ops_assert_admin(p_admin_id text, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_hash,'') = '' or not exists (
       select 1 from hvac_users u
       where u.id::text = p_admin_id and u.payload->>'role' = 'ADMIN'
         and u.payload->>'passwordHash' = p_hash) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
end $$;

create or replace function ops_audit_log(p_admin text, p_action text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into ops_audit(admin_id, action, detail) values (p_admin, p_action, p_detail) $$;

-- Tarifa aplicable a un traslado: especial del cliente (si está vigente y activa) o general vigente a esa fecha
create or replace function ops_resolve_transport_rate(p_client_id text, p_date date)
returns table(amount numeric, source text, rate_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare r client_transport_rates%rowtype;
begin
  select * into r from client_transport_rates c
   where c.client_id = p_client_id and c.effective_date <= p_date order by c.effective_date desc limit 1;
  if found and r.active then return query select r.amount, 'especial'::text, r.id; return; end if;
  return query select t.amount, 'general'::text, t.id from transport_rates t
   where t.effective_date <= p_date order by t.effective_date desc limit 1;
end $$;

revoke all on function ops_assert_admin(text,text), ops_audit_log(text,text,jsonb),
                       ops_resolve_transport_rate(text,date) from public, anon, authenticated;

-- ---------- 4) Funciones que usa la app (validan que quien llama sea ADMIN) ----------
create or replace function ops_config_get(p_admin_id text, p_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  return jsonb_build_object(
    'settings',        coalesce((select jsonb_object_agg(key, value) from ops_settings), '{}'::jsonb),
    'transport_rates', coalesce((select jsonb_agg(to_jsonb(r) order by r.effective_date desc) from transport_rates r), '[]'::jsonb),
    'client_rates',    coalesce((select jsonb_agg(to_jsonb(c) order by c.client_name, c.effective_date desc) from client_transport_rates c), '[]'::jsonb),
    'overtime_matrix', coalesce((select jsonb_agg(to_jsonb(o) order by o.role_name, o.overtime_type, o.effective_date desc) from overtime_matrix o), '[]'::jsonb),
    'holidays',        coalesce((select jsonb_agg(to_jsonb(h) order by h.holiday_date) from holidays h), '[]'::jsonb));
end $$;

create or replace function ops_transport_rate_add(p_admin_id text, p_hash text, p_amount numeric, p_effective_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_amount is null or p_amount <= 0 then raise exception 'El valor debe ser mayor que cero'; end if;
  if p_effective_date is null then raise exception 'Indica la fecha de vigencia'; end if;
  insert into transport_rates(amount, effective_date, created_by) values (p_amount, p_effective_date, p_admin_id) returning id into v;
  perform ops_audit_log(p_admin_id, 'transport_rate_add', jsonb_build_object('amount', p_amount, 'effective_date', p_effective_date));
  return v;
exception when unique_violation then raise exception 'Ya existe una tarifa con esa fecha de vigencia';
end $$;

create or replace function ops_client_rate_set(p_admin_id text, p_hash text, p_client_id text, p_client_name text,
                                               p_amount numeric, p_effective_date date, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if coalesce(trim(p_client_id),'') = '' then raise exception 'Selecciona un cliente'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'El valor debe ser mayor que cero'; end if;
  if p_effective_date is null then raise exception 'Indica la fecha de vigencia'; end if;
  insert into client_transport_rates(client_id, client_name, amount, effective_date, notes, created_by)
  values (p_client_id, p_client_name, p_amount, p_effective_date, p_notes, p_admin_id)
  on conflict (client_id, effective_date) do update
    set amount = excluded.amount, client_name = excluded.client_name, notes = excluded.notes, active = true
  returning id into v;
  perform ops_audit_log(p_admin_id, 'client_rate_set', jsonb_build_object('client_id', p_client_id, 'amount', p_amount, 'effective_date', p_effective_date));
  return v;
end $$;

create or replace function ops_client_rate_active(p_admin_id text, p_hash text, p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  update client_transport_rates set active = p_active where id = p_id;
  perform ops_audit_log(p_admin_id, 'client_rate_active', jsonb_build_object('id', p_id, 'active', p_active));
end $$;

create or replace function ops_matrix_set(p_admin_id text, p_hash text, p_role text, p_type text, p_value numeric,
                                          p_effective_date date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if coalesce(trim(p_role),'') = '' then raise exception 'Indica el cargo'; end if;
  if p_type not in ('diurna','nocturna','dominical','festiva') then raise exception 'Tipo de hora extra no válido'; end if;
  if p_value is null or p_value < 0 then raise exception 'Valor no válido'; end if;
  insert into overtime_matrix(role_name, overtime_type, rate_value, effective_date)
  values (trim(p_role), p_type, p_value, coalesce(p_effective_date, current_date))
  on conflict (role_name, overtime_type, effective_date) do update set rate_value = excluded.rate_value
  returning id into v;
  perform ops_audit_log(p_admin_id, 'matrix_set', jsonb_build_object('role', p_role, 'type', p_type, 'value', p_value));
  return v;
end $$;

create or replace function ops_setting_set(p_admin_id text, p_hash text, p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare ok_time text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_key not in ('meal_night_amount','schedule','company','cut_days') then raise exception 'Parámetro no permitido'; end if;
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Formato de valor no válido'; end if;
  if p_key = 'meal_night_amount' and coalesce((p_value->>'amount')::numeric, -1) < 0 then
    raise exception 'El valor de alimentación no es válido'; end if;
  if p_key = 'schedule' then
    if coalesce(p_value->>'workday_end','') !~ ok_time or coalesce(p_value->>'tolerance_end','') !~ ok_time then
      raise exception 'Las horas deben tener formato HH:MM'; end if;
    if (p_value->>'tolerance_end') < (p_value->>'workday_end') then
      raise exception 'La tolerancia no puede ser anterior al fin de jornada'; end if;
  end if;
  if p_key = 'cut_days' and (coalesce((p_value->>'start_day')::int,0) not between 1 and 31
                          or coalesce((p_value->>'end_day')::int,0)   not between 1 and 31) then
    raise exception 'Los días del corte deben estar entre 1 y 31'; end if;
  insert into ops_settings(key, value, updated_by) values (p_key, p_value, p_admin_id)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  perform ops_audit_log(p_admin_id, 'setting_set', jsonb_build_object('key', p_key));
end $$;

create or replace function ops_holiday_set(p_admin_id text, p_hash text, p_date date, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform ops_assert_admin(p_admin_id, p_hash);
  if p_date is null then raise exception 'Indica la fecha'; end if;
  if coalesce(trim(p_name),'') = '' then delete from holidays where holiday_date = p_date;   -- nombre vacío = eliminar
  else insert into holidays(holiday_date, name) values (p_date, trim(p_name))
       on conflict (holiday_date) do update set name = excluded.name; end if;
end $$;

-- ---------- 5) Datos iniciales (no pisa lo que ya exista) ----------
insert into ops_settings(key, value) values
  ('meal_night_amount', '{"amount": 0}'),
  ('schedule',          '{"workday_end": "16:30", "tolerance_end": "17:00"}'),
  ('company',           '{"header_text": "", "footer_text": "", "logo_url": "", "legalization_text": ""}'),
  ('cut_days',          '{"start_day": 11, "end_day": 25}')
on conflict (key) do nothing;

-- Festivos Colombia 2026 (VERIFICA contra el calendario oficial y carga 2027 antes de fin de año)
insert into holidays(holiday_date, name) values
  ('2026-01-01','Año Nuevo'), ('2026-01-12','Reyes Magos'), ('2026-03-23','San José'),
  ('2026-04-02','Jueves Santo'), ('2026-04-03','Viernes Santo'), ('2026-05-01','Día del Trabajo'),
  ('2026-05-18','Ascensión del Señor'), ('2026-06-08','Corpus Christi'), ('2026-06-15','Sagrado Corazón'),
  ('2026-06-29','San Pedro y San Pablo'), ('2026-07-20','Independencia de Colombia'), ('2026-08-07','Batalla de Boyacá'),
  ('2026-08-17','Asunción de la Virgen'), ('2026-10-12','Día de la Raza'), ('2026-11-02','Todos los Santos'),
  ('2026-11-16','Independencia de Cartagena'), ('2026-12-08','Inmaculada Concepción'), ('2026-12-25','Navidad')
on conflict (holiday_date) do nothing;

-- ---------- 6) Prueba rápida (reemplaza ID y HASH por los de un ADMIN real) ----------
-- select ops_config_get('ID_ADMIN', 'HASH_ADMIN');
