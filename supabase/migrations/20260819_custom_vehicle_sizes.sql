-- Owner-editable vehicle sizes.
--
-- Sizes used to be a Postgres enum (S/M/L/XL/XXL, small/medium/big), which made
-- the scale a deployment concern: adding a sixth car size or a fourth bike tier
-- meant an ALTER TYPE and a client release. The shop sets its own board, so the
-- scale belongs in a table the owner edits, exactly like inclusion_options.
--
-- The seeded rows reproduce the previous enum one-for-one, so nothing about the
-- current board changes -- the five car sizes and three motorcycle tiers are
-- now simply the defaults rather than the only possibilities.
--
-- History: sale_items and sales keep the size *label as printed at sale time*,
-- the same way they already snapshot service_name, unit price and commission
-- rate. Renaming "Big Bike" to "Big" next month leaves last month's receipts
-- and finalized slips reading "Big Bike". That is why the sale columns become
-- plain text and NOT a foreign key -- a size row is a board setting, and
-- editing a board setting must never rewrite what a past sale charged.

create table if not exists vehicle_sizes (
  id            uuid primary key default gen_random_uuid(),
  vehicle_class vehicle_class not null,
  -- The short chip on the POS grid and the price row: "S", "Big Bike".
  label         text not null check (length(trim(label)) > 0),
  -- The long form under the chip, so a new cashier knows what fits.
  -- Optional: "XXL" needs a gloss, "Small" does not.
  description   text,
  -- Scale order. Cars run S -> XXL, bikes small -> big; a re-added size slots
  -- back where it belongs rather than at the end.
  sort_order    integer not null default 0,
  -- Retiring a size hides it from the POS and Settings without touching the
  -- price rows or the sales that used it. Deleting is only for a size that was
  -- never sold; see the guard trigger below.
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Two sizes on the same scale cannot share a name -- the label is what lands on
-- the receipt, so a duplicate makes history ambiguous. Different classes may
-- reuse a label ("Small" on both scales) because they never mix.
create unique index if not exists vehicle_sizes_class_label_key
  on vehicle_sizes (vehicle_class, lower(trim(label)));

create index if not exists vehicle_sizes_class_order_idx
  on vehicle_sizes (vehicle_class, sort_order);

drop trigger if exists set_vehicle_sizes_updated_at on vehicle_sizes;
create trigger set_vehicle_sizes_updated_at
  before update on vehicle_sizes
  for each row execute function set_updated_at();

-- Seed the existing board. These are defaults, not constants.
insert into vehicle_sizes (vehicle_class, label, description, sort_order)
values
  ('car',        'S',        'Sedan, hatchback',      1),
  ('car',        'M',        'Crossover',             2),
  ('car',        'L',        'SUV, pick up',          3),
  ('car',        'XL',       'Modified pick up, van', 4),
  ('car',        'XXL',      'Large van, truck',      5),
  ('motorcycle', 'Small',    null,                    1),
  ('motorcycle', 'Medium',   null,                    2),
  ('motorcycle', 'Big Bike', null,                    3)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Cut the enum columns over to size rows.
-- ---------------------------------------------------------------------------

-- Test data only (3 sales rung up while building the POS). Clearing it lets the
-- sale columns convert without backfilling labels for records nobody will read.
delete from sale_item_commissions;
delete from sale_items;
delete from sales;
delete from payroll_slips;
delete from payroll_periods;

-- service_prices points at a size row: a price IS per size, and when a size is
-- renamed its current prices must follow. Cascade, because deleting a size the
-- shop never sold should take its unused price rows with it.
alter table service_prices
  add column if not exists size_id uuid references vehicle_sizes (id) on delete cascade;

update service_prices sp
   set size_id = vs.id
  from vehicle_sizes vs, services s
 where sp.service_id = s.id
   and vs.vehicle_class = s.vehicle_class
   and vs.label = case sp.size::text
                    when 'small'  then 'Small'
                    when 'medium' then 'Medium'
                    when 'big'    then 'Big Bike'
                    else sp.size::text
                  end
   and sp.size_id is null;

-- Any price row that failed to map would silently vanish from the board, so
-- refuse to finish the migration rather than leave the catalog short.
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans from service_prices where size_id is null;
  if v_orphans > 0 then
    raise exception 'MIGRATION_ABORT: % service_prices rows did not map to a vehicle_sizes row', v_orphans;
  end if;
end $$;

alter table service_prices drop constraint if exists service_prices_service_id_size_key;
alter table service_prices drop column if exists size;
alter table service_prices alter column size_id set not null;
alter table service_prices
  add constraint service_prices_service_id_size_id_key unique (service_id, size_id);

-- Sales snapshot the label as text. Not a foreign key: see the header.
alter table sales      alter column size type text using size::text;
alter table sale_items alter column size type text using size::text;
alter table sales      add constraint sales_size_not_blank      check (length(trim(size)) > 0);
alter table sale_items add constraint sale_items_size_not_blank check (length(trim(size)) > 0);

-- ---------------------------------------------------------------------------
-- create_sale now takes the size label it printed.
-- ---------------------------------------------------------------------------

-- The old signature is enum-typed; drop it so no stale overload survives.
drop function if exists create_sale(uuid[], vehicle_class, vehicle_size, jsonb, payment_method, text, text);

create or replace function create_sale(
  p_employee_ids   uuid[],
  p_vehicle_class  vehicle_class,
  p_size           text,
  p_items          jsonb,
  p_payment_method payment_method default 'cash',
  p_plate_number   text default null,
  p_vehicle_note   text default null
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
  v_paid integer;
  v_total integer := 0;
  v_total_commission integer := 0;
  v_crew uuid[];
  v_crew_size integer;
  v_idx integer;
  v_size text;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one line item';
  end if;

  v_size := trim(coalesce(p_size, ''));
  if v_size = '' then
    raise exception 'A sale needs a size';
  end if;

  -- The label must name a real size on this class's scale. The client sends a
  -- string now, so this is what stops a typo becoming a new size in reports.
  if not exists (
    select 1 from vehicle_sizes
     where vehicle_class = p_vehicle_class
       and lower(trim(label)) = lower(v_size)
  ) then
    raise exception 'Unknown size % for %', v_size, p_vehicle_class;
  end if;

  -- Store the label with the row's own casing, not the caller's.
  select label into v_size from vehicle_sizes
   where vehicle_class = p_vehicle_class
     and lower(trim(label)) = lower(v_size);

  -- Deduplicate: the same person listed twice must not earn twice.
  select array_agg(distinct e) into v_crew
  from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as e;

  v_crew_size := coalesce(array_length(v_crew, 1), 0);
  if v_crew_size = 0 then
    raise exception 'A sale needs at least one employee';
  end if;

  -- employee_id stays the first of the crew: "who led this car", not "who is owed".
  insert into sales (employee_id, vehicle_class, size, plate_number,
                     vehicle_note, payment_method)
  values (v_crew[1], p_vehicle_class, v_size, nullif(trim(p_plate_number), ''),
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

    -- Mirrors shareOfCommission() in shared/lib/pricing.ts exactly: every share
    -- rounds UP, so an uneven split never shorts the crew. The shares can total
    -- a centavo or two over the raw rate; that overage is what is actually paid.
    v_share := ceil(v_commission::numeric / v_crew_size)::integer;
    v_paid := v_share * v_crew_size;

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
      v_size,
      v_qty, v_unit, v_line_total, v_rate, v_paid
    )
    returning id into v_item_id;

    for v_idx in 1 .. v_crew_size loop
      insert into sale_item_commissions (
        sale_item_id, sale_id, employee_id, commission_centavos, crew_size
      )
      values (v_item_id, v_sale_id, v_crew[v_idx], v_share, v_crew_size);
    end loop;

    v_total := v_total + v_line_total;
    -- Store what was actually paid out, so a sale and its payroll reconcile.
    v_total_commission := v_total_commission + v_paid;
  end loop;

  update sales
     set total_centavos = v_total,
         commission_centavos = v_total_commission
   where id = v_sale_id;

  return v_sale_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Deleting a size that history depends on.
-- ---------------------------------------------------------------------------

-- Sales store the label, not the id, so nothing at the FK level stops a size
-- being deleted out from under its own history. Reports group by that label, so
-- removing "XL" while XL sales exist would leave rows nothing in Settings
-- explains. Mirrors guard_service_delete: sold sizes are hidden, never deleted.
create or replace function guard_vehicle_size_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from sale_items si
     where lower(trim(si.size)) = lower(trim(old.label))
  ) then
    raise exception 'SIZE_IN_USE: % is on past sales; hide it instead of deleting', old.label;
  end if;
  return old;
end;
$$;

drop trigger if exists guard_vehicle_size_delete on vehicle_sizes;
create trigger guard_vehicle_size_delete
  before delete on vehicle_sizes
  for each row execute function guard_vehicle_size_delete();

-- ---------------------------------------------------------------------------
-- RLS: the board is owner-editable, readable by every signed-in client.
-- ---------------------------------------------------------------------------

alter table vehicle_sizes enable row level security;

drop policy if exists vehicle_sizes_read on vehicle_sizes;
create policy vehicle_sizes_read on vehicle_sizes
  for select to authenticated using (true);

drop policy if exists vehicle_sizes_write on vehicle_sizes;
create policy vehicle_sizes_write on vehicle_sizes
  for all to authenticated using (is_owner()) with check (is_owner());

-- The enum is now unreferenced. Dropping it is what makes the scale editable;
-- leaving it would invite a future column to bind to the old fixed scale.
drop type if exists vehicle_size;
