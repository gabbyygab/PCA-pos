-- create_sale must finish its own rollup, even for a cashier.
--
-- The function ends by writing the summed totals back onto the sales row:
--
--   update sales set total_centavos = ..., commission_centavos = ... where id = ...
--
-- `sales` has RLS with an owner-only UPDATE policy (sales_update_owner), and
-- the function was neither SECURITY DEFINER nor exempt from RLS, so it ran as
-- the caller. For the owner that UPDATE matched the policy and the totals
-- landed. For a cashier it matched no row, updated nothing, and — because a
-- zero-row UPDATE is not an error — the function returned success anyway.
--
-- The result was a sale whose line items were correct and whose header read
-- 0: every report summing sales.total_centavos under-counted a cashier's
-- takings, while sale_item_commissions still owed the crew real money. The
-- bug was invisible until a non-owner account existed, because the owner was
-- until now the only user.
--
-- SECURITY DEFINER runs the body as the function's owner (postgres), which is
-- what the "money is written by RPC, not by client inserts" rule assumed all
-- along: the RPC is trusted to compute totals precisely so the client cannot.
-- Every value it writes is still derived inside this function from the price
-- and rate it was passed, so a cashier gains no ability to post their own
-- totals; they gain only the header write that their own line items imply.
--
-- search_path is pinned (already set on the original) so a SECURITY DEFINER
-- body cannot be redirected through a caller-controlled schema.

create or replace function create_sale(
  p_employee_ids uuid[],
  p_vehicle_class vehicle_class,
  p_size text,
  p_items jsonb,
  p_payment_method payment_method default 'cash',
  p_plate_number text default null,
  p_vehicle_note text default null
)
returns uuid
language plpgsql
security definer
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
  -- SECURITY DEFINER bypasses RLS, so the function has to establish for
  -- itself that there is a caller at all. Without this an unauthenticated
  -- request could reach the body that the sales_insert policy would
  -- otherwise have stopped.
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one line item';
  end if;

  v_size := trim(coalesce(p_size, ''));
  if v_size = '' then
    raise exception 'A sale needs a size';
  end if;

  if not exists (
    select 1 from vehicle_sizes
     where vehicle_class = p_vehicle_class
       and lower(trim(label)) = lower(v_size)
  ) then
    raise exception 'Unknown size % for %', v_size, p_vehicle_class;
  end if;

  -- Snapshot the label exactly as the board spells it, not as it was typed.
  select label into v_size from vehicle_sizes
   where vehicle_class = p_vehicle_class
     and lower(trim(label)) = lower(v_size);

  select array_agg(distinct e) into v_crew
  from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as e;

  v_crew_size := coalesce(array_length(v_crew, 1), 0);
  if v_crew_size = 0 then
    raise exception 'A sale needs at least one employee';
  end if;

  -- Every id must be a real, active employee. RLS is no longer doing this
  -- check for us, and a sale assigned to a stranger's uuid would corrupt
  -- payroll rather than fail loudly.
  if exists (
    select 1 from unnest(v_crew) as c(id)
     where not exists (
       select 1 from employees e where e.id = c.id and e.is_active
     )
  ) then
    raise exception 'A sale must be assigned to active employees';
  end if;

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
    v_commission := round(v_line_total::numeric * v_rate / 10000)::integer;

    -- Each share rounds up so an uneven split never shorts the crew; the
    -- sale then records the summed shares actually paid, which is why a sale
    -- and its payroll always reconcile. Mirrors shareOfCommission() in
    -- shared/lib/pricing.ts.
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
    v_total_commission := v_total_commission + v_paid;
  end loop;

  -- The write that silently did nothing for a cashier before.
  update sales
     set total_centavos = v_total,
         commission_centavos = v_total_commission
   where id = v_sale_id;

  return v_sale_id;
end;
$function$;

-- Backfill any sale whose header was zeroed by the old behaviour. Reads the
-- line items, which were always written correctly, so this restores exactly
-- what the sale should have recorded.
update sales s
   set total_centavos = agg.total,
       commission_centavos = agg.commission
  from (
    select sale_id,
           sum(line_total_centavos)::integer as total,
           sum(commission_centavos)::integer as commission
      from sale_items
     group by sale_id
  ) as agg
 where agg.sale_id = s.id
   and s.total_centavos = 0
   and agg.total <> 0;
