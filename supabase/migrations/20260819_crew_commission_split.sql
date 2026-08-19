-- Multiple employees per car.
--
-- Until now a sale was worked by exactly one employee and sale_items.employee_id
-- carried the whole commission. The shop actually washes a car with a crew, and
-- the cut is split evenly among them: a 200 line at 40% is 80, split three ways.
--
-- Commission moves to its own table, one row per (line, employee). sale_items
-- stays one row per service so gross sales still sum correctly -- fanning the
-- line out per employee would multiply revenue by the crew size.

create table if not exists sale_item_commissions (
  id                  uuid primary key default gen_random_uuid(),
  sale_item_id        uuid not null references sale_items (id) on delete cascade,
  sale_id             uuid not null references sales (id) on delete cascade,
  employee_id         uuid not null references employees (id),
  -- Snapshotted like every other money column: a crew size or rate change
  -- must never rewrite what a past sale paid.
  crew_size           integer not null check (crew_size > 0),
  commission_centavos integer not null check (commission_centavos >= 0),
  created_at          timestamptz not null default now(),
  unique (sale_item_id, employee_id)
);

create index if not exists sale_item_commissions_employee_idx
  on sale_item_commissions (employee_id);
create index if not exists sale_item_commissions_sale_idx
  on sale_item_commissions (sale_id);

-- Backfill: every existing line was worked solo, so its whole commission
-- belongs to the employee already on it.
insert into sale_item_commissions
  (sale_item_id, sale_id, employee_id, crew_size, commission_centavos)
select si.id, si.sale_id, si.employee_id, 1, si.commission_centavos
from sale_items si
on conflict (sale_item_id, employee_id) do nothing;

alter table sale_item_commissions enable row level security;

-- Mirrors the sale_items policies: the owner sees everything, a cashier may
-- write a sale and read only today's, and payroll history stays out of reach.
drop policy if exists "owner reads commissions" on sale_item_commissions;
create policy "owner reads commissions" on sale_item_commissions
  for select using (is_owner());

drop policy if exists "cashier reads today commissions" on sale_item_commissions;
create policy "cashier reads today commissions" on sale_item_commissions
  for select using (
    exists (
      select 1 from sales s
      where s.id = sale_item_commissions.sale_id
        and s.sold_at >= date_trunc('day', now())
    )
  );

-- create_sale now takes a crew. p_employee_ids replaces p_employee_id; the
-- first employee stays on sales.employee_id and sale_items.employee_id so the
-- old single-employee columns keep meaning "who led this car" and nothing that
-- reads them breaks.
--
-- Each share rounds UP (ceil), so an uneven split never shorts the crew. The
-- shares can therefore total a centavo or two more than the raw line
-- commission -- so the sale stores the summed shares as its commission, and
-- payroll always reconciles against the sale.
drop function if exists create_sale(uuid, vehicle_class, vehicle_size, jsonb, payment_method, text, text);

create or replace function create_sale(
  p_employee_ids  uuid[],
  p_vehicle_class vehicle_class,
  p_size          vehicle_size,
  p_items         jsonb,
  p_payment_method payment_method default 'cash'::payment_method,
  p_plate_number  text default null,
  p_vehicle_note  text default null
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_qty integer;
  v_unit integer;
  v_line_total integer;
  v_rate integer;
  v_commission integer;
  v_share integer;
  v_crew uuid[];
  v_crew_size integer;
  v_employee uuid;
  v_total integer := 0;
  v_total_commission integer := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one line item';
  end if;

  -- Drop duplicates and nulls; one employee cannot take two shares of a car.
  select array_agg(distinct e) into v_crew
  from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as e
  where e is not null;

  v_crew_size := coalesce(array_length(v_crew, 1), 0);
  if v_crew_size = 0 then
    raise exception 'A sale needs at least one employee';
  end if;

  insert into sales (employee_id, vehicle_class, size, plate_number,
                     vehicle_note, payment_method)
  values (v_crew[1], p_vehicle_class, p_size, nullif(trim(p_plate_number), ''),
          nullif(trim(p_vehicle_note), ''), p_payment_method)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty  := coalesce((v_item ->> 'quantity')::integer, 1);
    v_unit := (v_item ->> 'unit_price_centavos')::integer;
    v_rate := (v_item ->> 'commission_rate_bp')::integer;

    if v_qty <= 0 then
      raise exception 'Quantity must be positive';
    end if;
    if v_unit < 0 then
      raise exception 'Price cannot be negative';
    end if;
    if v_rate < 0 or v_rate > 10000 then
      raise exception 'Commission rate out of range';
    end if;

    v_line_total := v_unit * v_qty;
    -- Integer math, rounded once per line. Never float multiplication.
    v_commission := round(v_line_total::numeric * v_rate / 10000)::integer;
    -- Round the share up so the division never shorts the crew.
    v_share := ceil(v_commission::numeric / v_crew_size)::integer;

    insert into sale_items (
      sale_id, service_id, employee_id, service_name, category, size,
      quantity, unit_price_centavos, line_total_centavos,
      commission_rate_bp, commission_centavos
    )
    values (
      v_sale_id,
      nullif(v_item ->> 'service_id', '')::uuid,
      v_crew[1],
      v_item ->> 'service_name',
      (v_item ->> 'category')::service_category,
      p_size,
      v_qty, v_unit, v_line_total, v_rate,
      -- What the line actually pays out, shares included.
      v_share * v_crew_size
    )
    returning id into v_item_id;

    foreach v_employee in array v_crew
    loop
      insert into sale_item_commissions
        (sale_item_id, sale_id, employee_id, crew_size, commission_centavos)
      values (v_item_id, v_sale_id, v_employee, v_crew_size, v_share);
    end loop;

    v_total := v_total + v_line_total;
    v_total_commission := v_total_commission + (v_share * v_crew_size);
  end loop;

  update sales
     set total_centavos = v_total,
         commission_centavos = v_total_commission
   where id = v_sale_id;

  return v_sale_id;
end;
$function$;

-- Payroll reads per-employee shares now, not the line's whole commission.
create or replace function finalize_payroll_period(p_week_start date)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_period_id uuid;
  v_status payroll_status;
begin
  if extract(isodow from p_week_start) <> 1 then
    raise exception 'Payroll weeks start on Monday';
  end if;

  insert into payroll_periods (week_start, week_end)
  values (p_week_start, p_week_start + 6)
  on conflict (week_start) do update set week_start = excluded.week_start
  returning id, status into v_period_id, v_status;

  if v_status = 'finalized' then
    raise exception 'That week is already finalized; reopen it first';
  end if;

  delete from payroll_slips where period_id = v_period_id;

  insert into payroll_slips (
    period_id, employee_id, employee_name, sales_count,
    gross_sales_centavos, commission_centavos
  )
  select
    v_period_id,
    e.id,
    e.name,
    count(distinct s.id),
    -- Gross is the value of the cars this employee worked. A crew shares the
    -- car, so each member is credited the full line -- gross measures work
    -- done, commission measures pay, and only commission is split.
    coalesce(sum(si.line_total_centavos), 0),
    coalesce(sum(sic.commission_centavos), 0)
  from employees e
  join sale_item_commissions sic on sic.employee_id = e.id
  join sale_items si on si.id = sic.sale_item_id
  join sales s on s.id = sic.sale_id
  where s.voided_at is null
    and s.sold_at >= p_week_start::timestamptz
    and s.sold_at < (p_week_start + 7)::timestamptz
  group by e.id, e.name;

  update payroll_periods
     set status = 'finalized', finalized_at = now()
   where id = v_period_id;

  return v_period_id;
end;
$function$;
