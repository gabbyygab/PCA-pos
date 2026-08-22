-- A promo takes a percentage off what the customer pays, and nothing off what
-- the crew earns.
--
-- That asymmetry is the entire feature, and it is the reason the discount
-- cannot simply be subtracted from the price. `commission_centavos` is derived
-- from `line_total_centavos`, so discounting the price in place would drag the
-- employee cut down with it: a 20% promo on a 1000 package would quietly turn
-- an 80 cut into a 64 one. The crew washed the same car either way. The promo
-- is the shop's concession to the customer, not the crew's.
--
-- So the line keeps TWO numbers that used to be one:
--
--   line_total_centavos  the price before the promo -- what commission is
--                        computed from, and what the receipt shows struck out
--   net_total_centavos   what the customer actually owes -- what revenue sums
--
-- Everything downstream then follows from which of the two a reader was
-- already using, with no reader having to learn the word "promo":
--
--   * `effective_total_centavos` re-points at the NET column, so gross, net
--     sales, best-performing services, sales-by-size and the payment
--     breakdown all fall to the discounted figure automatically.
--   * `effective_commission_centavos` stays on `commission_centavos`, which
--     still derives from the undiscounted `line_total_centavos`, so payroll
--     and the employee-cut tile are untouched by any promo.
--
-- The discount is stored per LINE rather than on the sale header even though
-- the cashier types one percentage for the whole ticket. Reports sum
-- `effective_total_centavos` off `sale_items` and never read
-- `sales.total_centavos`, so a header-only discount would be invisible to
-- every figure on the Reports tab. Storing it per line also means a promo
-- survives `edit_sale_item` and per-line refunds without special handling: a
-- refunded line reverses its own discount along with its own revenue.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

-- The pesos taken off this line. Stored as an amount, not as the percentage,
-- because the percentage is an instruction and the amount is the fact: it is
-- rounded once at sale time and must never be re-derived, exactly as
-- commission is not re-derived from its rate.
alter table sale_items
  add column if not exists discount_centavos integer not null default 0;

-- The percentage that produced it, in basis points (2000 = 20%), snapshotted
-- for the same reason `commission_rate_bp` is: so the receipt and the service
-- record can say "20% off" without the number being re-read from a promo
-- setting that may since have changed.
alter table sale_items
  add column if not exists discount_rate_bp integer not null default 0;

alter table sale_items
  drop constraint if exists sale_items_discount_sane;
alter table sale_items
  add constraint sale_items_discount_sane check (
    discount_centavos >= 0
    and discount_rate_bp between 0 and 10000
    -- A promo may take a line to zero but never below it: a discount larger
    -- than the line is a negative sale, which would show up as the shop paying
    -- the customer.
    and discount_centavos <= line_total_centavos
  );

comment on column sale_items.discount_centavos is
  'Pesos taken off this line by a promo. Revenue is line_total_centavos - this; commission is deliberately NOT, so the crew is paid on the undiscounted price.';
comment on column sale_items.discount_rate_bp is
  'The promo percentage in basis points (2000 = 20%) as applied at sale time. Snapshotted like commission_rate_bp so changing a promo later cannot rewrite a past sale.';

-- What the customer owes for this line.
alter table sale_items
  drop column if exists net_total_centavos;
alter table sale_items
  add column net_total_centavos integer
  generated always as (line_total_centavos - discount_centavos) stored;

comment on column sale_items.net_total_centavos is
  'line_total_centavos less the promo discount -- what the customer actually pays. `line_total_centavos` remains the pre-promo price and the commission base.';

-- ---------------------------------------------------------------------------
-- 2. Revenue follows the net; commission does not
-- ---------------------------------------------------------------------------
--
-- `effective_total_centavos` keeps its name and its `done`-only rule and only
-- changes WHICH total it carries. Every report already sums it, so the promo
-- reaches gross, net sales, the service and size breakdowns, and the payment
-- panel through this one edit.

alter table sale_items
  drop column if exists effective_total_centavos;
alter table sale_items
  add column effective_total_centavos integer
  generated always as (
    case when status = 'done' then line_total_centavos - discount_centavos else 0 end
  ) stored;

comment on column sale_items.effective_total_centavos is
  'What the shop earned on this line: the NET (post-promo) price once the line is `done`, otherwise 0. Reports sum this. A pending line is work in progress, not revenue; a refunded one is money given back; a discounted one is money never charged.';

-- `effective_commission_centavos` is deliberately re-created UNCHANGED. It is
-- restated here rather than left alone so that the rule it encodes is visible
-- next to the one above: the two columns now disagree about the discount on
-- purpose, and a future reader comparing them should find that stated, not
-- infer it from an absence.
alter table sale_items
  drop column if exists effective_commission_centavos;
alter table sale_items
  add column effective_commission_centavos integer
  generated always as (
    case when status = 'done' then commission_centavos else 0 end
  ) stored;

comment on column sale_items.effective_commission_centavos is
  'The crew''s cut once the line is `done`, otherwise 0. Derived from commission_centavos, which is computed off the UNDISCOUNTED line total -- a promo is the shop''s concession to the customer and never comes out of the crew''s pay.';

-- ---------------------------------------------------------------------------
-- 3. The header total is what the customer paid
-- ---------------------------------------------------------------------------
--
-- `recalc_sale_totals` already sums `effective_total_centavos`, which now
-- carries the net, so the header follows the promo without being touched. Its
-- body is restated unchanged for the same reason as the column above: this is
-- where a reader looks to confirm the ticket total is post-promo.

create or replace function recalc_sale_totals(p_sale_id uuid)
returns void
language sql
security definer
set search_path to ''
as $function$
  update public.sales s
     set total_centavos = coalesce((
           select sum(si.effective_total_centavos)
             from public.sale_items si where si.sale_id = s.id
         ), 0),
         commission_centavos = coalesce((
           select sum(sic.commission_centavos)
             from public.sale_item_commissions sic
             join public.sale_items si on si.id = sic.sale_item_id
            where sic.sale_id = s.id and si.status = 'done'
         ), 0)
   where s.id = p_sale_id;
$function$;

revoke execute on function recalc_sale_totals(uuid) from public, anon, authenticated;

-- Resum every live header from its lines.
--
-- Rebuilding `effective_total_centavos` above changes what a header should say,
-- but a stored header only moves when something calls `recalc_sale_totals`.
-- A sale written before an earlier rule change and untouched since keeps
-- whatever its original `create_sale` wrote -- which is how a ticket holding a
-- single *pending* line was still claiming its full price as revenue, months
-- after "only a done line is revenue" became the rule.
--
-- Reports read per line and were always right; the POS feed and the service
-- record read `sales.total_centavos` and were not. This is idempotent -- it
-- rewrites only the rows that actually disagree -- so it is safe to re-run.
-- Voided sales are skipped: they are already fully reversed.
do $$
declare r record;
begin
  for r in select id from public.sales where voided_at is null loop
    perform public.recalc_sale_totals(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. create_sale applies the promo
-- ---------------------------------------------------------------------------
--
-- The percentage arrives once for the whole ticket (`p_discount_rate_bp`),
-- because that is how the cashier is told about it -- "20% off" is said about
-- the car, not about the hand wax. It is then applied and rounded PER LINE, so
-- that each line stores its own share of the concession and stays independently
-- refundable, editable, and reportable.
--
-- Rounding is the mirror image of the commission round-up. A share of
-- commission rounds UP so an uneven split never shorts the crew; a discount
-- rounds DOWN (`floor`) so an uneven percentage never shorts the shop by
-- handing back a centavo more than the promo promised. Both round in the
-- direction that protects the party who did not choose the arithmetic.

create or replace function create_sale(
  p_employee_ids uuid[],
  p_vehicle_class vehicle_class,
  p_size text,
  p_items jsonb,
  p_payment_method payment_method default 'cash',
  p_plate_number text default null,
  p_vehicle_note text default null,
  -- Defaulted to 0 so every existing caller -- and any client build not yet
  -- shipped -- keeps posting undiscounted sales unchanged.
  p_discount_rate_bp integer default 0
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
  v_discount integer;
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
  v_promo integer;
begin
  -- SECURITY DEFINER bypasses RLS, so the function has to establish for
  -- itself that there is a caller at all.
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one line item';
  end if;

  -- The promo is validated here rather than trusted from the client, for the
  -- same reason totals are computed here: both clients ship the same anon key.
  v_promo := coalesce(p_discount_rate_bp, 0);
  if v_promo < 0 or v_promo > 10000 then
    raise exception 'DISCOUNT_OUT_OF_RANGE';
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

    -- Rounded DOWN: the shop never hands back more than the promo promised.
    -- Mirrors lineDiscount() in shared/lib/pricing.ts.
    v_discount := floor(v_line_total::numeric * v_promo / 10000)::integer;

    -- Commission is computed from the PRE-discount total. This one line is the
    -- feature: the crew is paid for the car they washed, not for what the
    -- customer was charged for it.
    v_commission := round(v_line_total::numeric * v_rate / 10000)::integer;

    v_share := ceil(v_commission::numeric / v_crew_size)::integer;
    v_paid := v_share * v_crew_size;

    insert into sale_items (
      sale_id, service_id, employee_id, service_name, category, size,
      quantity, unit_price_centavos, line_total_centavos,
      discount_centavos, discount_rate_bp,
      commission_rate_bp, commission_centavos
    )
    values (
      v_sale_id,
      nullif(v_item ->> 'service_id', '')::uuid,
      v_crew[1],
      v_item ->> 'service_name',
      (v_item ->> 'category')::service_category,
      v_size,
      v_qty, v_unit, v_line_total,
      v_discount, v_promo,
      v_rate, v_paid
    )
    returning id into v_item_id;

    for v_idx in 1 .. v_crew_size loop
      insert into sale_item_commissions (
        sale_item_id, sale_id, employee_id, commission_centavos, crew_size
      )
      values (v_item_id, v_sale_id, v_crew[v_idx], v_share, v_crew_size);
    end loop;

    -- The header carries what the customer owes, so it sums the net.
    v_total := v_total + (v_line_total - v_discount);
    v_total_commission := v_total_commission + v_paid;
  end loop;

  update sales
     set total_centavos = v_total,
         commission_centavos = v_total_commission
   where id = v_sale_id;

  return v_sale_id;
end;
$function$;

-- The 7-argument signature is now shadowed by the 8-argument one above, and
-- PostgREST resolves an RPC by the argument NAMES a client posts -- so a client
-- that omits p_discount_rate_bp would still match the old function if it were
-- left in place, and would silently write no discount columns. Drop it.
drop function if exists create_sale(uuid[], vehicle_class, text, jsonb, payment_method, text, text);

revoke all on function create_sale(uuid[], vehicle_class, text, jsonb, payment_method, text, text, integer)
  from public, anon;
grant execute on function create_sale(uuid[], vehicle_class, text, jsonb, payment_method, text, text, integer)
  to authenticated;

comment on function create_sale(uuid[], vehicle_class, text, jsonb, payment_method, text, text, integer) is
  'Write a sale and its lines in one transaction, computing every total in Postgres so a tampered client cannot post its own. p_discount_rate_bp applies one promo percentage across the ticket, rounded down per line: it reduces what the customer owes and deliberately does NOT reduce commission, which is computed from the undiscounted line total.';

-- ---------------------------------------------------------------------------
-- 5. edit_sale_item keeps the promo attached
-- ---------------------------------------------------------------------------
--
-- Editing a discounted line's quantity or price has to re-apply the promo, or
-- correcting a 1000 line to 1200 would silently drop a 20% discount the
-- customer was promised. The line's own `discount_rate_bp` is the authority --
-- re-read from the row, never re-typed -- so the edit re-derives the amount at
-- the rate the sale was made under, exactly as it re-derives commission at the
-- rate snapshotted on the line.
--
-- The promo rate itself stays uneditable here, for the identical reason
-- `commission_rate_bp` is: a rate retyped per line after the fact is a hole in
-- historical integrity from the other side.

create or replace function edit_sale_item(
  p_sale_item_id  uuid,
  p_service_name  text default null,
  p_quantity      integer default null,
  p_unit_price_centavos integer default null,
  p_employee_ids  uuid[] default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sale_id     uuid;
  v_sold_at     timestamptz;
  v_voided      timestamptz;
  v_rate        integer;
  v_promo       integer;
  v_name        text;
  v_qty         integer;
  v_unit        integer;
  v_line_total  integer;
  v_discount    integer;
  v_commission  integer;
  v_share       integer;
  v_paid        integer;
  v_crew        uuid[];
  v_crew_size   integer;
  v_idx         integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select si.sale_id, si.commission_rate_bp, si.discount_rate_bp, si.service_name,
         si.quantity, si.unit_price_centavos, s.sold_at, s.voided_at
    into v_sale_id, v_rate, v_promo, v_name, v_qty, v_unit, v_sold_at, v_voided
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
   where si.id = p_sale_item_id;

  if v_sale_id is null then
    raise exception 'SALE_ITEM_NOT_FOUND';
  end if;

  if v_voided is not null then
    raise exception 'SALE_VOIDED';
  end if;

  if not public.is_owner()
     and v_sold_at < date_trunc('day', now()) then
    raise exception 'PAST_DAY_OWNER_ONLY';
  end if;

  if p_service_name is not null then
    v_name := trim(p_service_name);
    if v_name = '' then
      raise exception 'NAME_REQUIRED';
    end if;
  end if;

  if p_quantity is not null then
    v_qty := p_quantity;
    if v_qty <= 0 then
      raise exception 'QUANTITY_POSITIVE';
    end if;
  end if;

  if p_unit_price_centavos is not null then
    v_unit := p_unit_price_centavos;
    if v_unit < 0 then
      raise exception 'PRICE_NEGATIVE';
    end if;
  end if;

  if p_employee_ids is not null then
    select array_agg(distinct e) into v_crew
      from unnest(p_employee_ids) as e;

    v_crew_size := coalesce(array_length(v_crew, 1), 0);
    if v_crew_size = 0 then
      raise exception 'CREW_REQUIRED';
    end if;

    if exists (
      select 1 from unnest(v_crew) as e
       where not exists (
         select 1 from public.employees emp
          where emp.id = e and emp.is_active
       )
    ) then
      raise exception 'UNKNOWN_EMPLOYEE';
    end if;
  else
    select array_agg(sic.employee_id order by sic.created_at, sic.employee_id)
      into v_crew
      from public.sale_item_commissions sic
     where sic.sale_item_id = p_sale_item_id;

    v_crew_size := coalesce(array_length(v_crew, 1), 0);
    if v_crew_size = 0 then
      raise exception 'CREW_REQUIRED';
    end if;
  end if;

  v_line_total := v_unit * v_qty;

  -- Re-applied at the line's own snapshotted rate, and rounded down, exactly
  -- as create_sale did when the line was written.
  v_discount := floor(v_line_total::numeric * coalesce(v_promo, 0) / 10000)::integer;

  -- Still off the PRE-discount total: an edited line pays the crew on the
  -- corrected sticker price, not the corrected discounted price.
  v_commission := round(v_line_total::numeric * v_rate / 10000)::integer;
  v_share := ceil(v_commission::numeric / v_crew_size)::integer;
  v_paid := v_share * v_crew_size;

  update public.sale_items
     set service_name        = v_name,
         quantity            = v_qty,
         unit_price_centavos = v_unit,
         line_total_centavos = v_line_total,
         discount_centavos   = v_discount,
         commission_centavos = v_paid,
         employee_id         = v_crew[1]
   where id = p_sale_item_id;

  delete from public.sale_item_commissions where sale_item_id = p_sale_item_id;

  for v_idx in 1 .. v_crew_size loop
    insert into public.sale_item_commissions (
      sale_item_id, sale_id, employee_id, commission_centavos, crew_size
    )
    values (p_sale_item_id, v_sale_id, v_crew[v_idx], v_share, v_crew_size);
  end loop;

  perform public.recalc_sale_totals(v_sale_id);
end;
$function$;

revoke all on function edit_sale_item(uuid, text, integer, integer, uuid[]) from public, anon;
grant execute on function edit_sale_item(uuid, text, integer, integer, uuid[]) to authenticated;

comment on function edit_sale_item(uuid, text, integer, integer, uuid[]) is
  'Correct one service line in place -- name, quantity, unit price, and the crew owed its commission -- resumming the line, its promo discount, its shares, and the sale header. security definer: sale_items is owner-only for UPDATE. Null arguments leave a field unchanged; an explicit p_employee_ids replaces the crew wholesale. Cashiers may edit today''s sales only. Neither the commission RATE nor the promo RATE is editable here: both are snapshotted at sale time so nothing can rewrite history after the fact. Commission is always recomputed from the UNDISCOUNTED line total.';

-- ---------------------------------------------------------------------------
-- 6. Setting the promo on an existing ticket
-- ---------------------------------------------------------------------------
--
-- The promo is most often remembered at the counter after the lines are rung
-- up ("she has the loyalty card"), and re-ringing the whole car to apply it
-- would throw away the receipt number and the timestamps. This applies one
-- percentage across every line of a ticket, and 0 removes it.
--
-- It sits alongside `edit_sale_ticket` rather than inside it: that function
-- writes only `sales` and is explicitly documented as never touching a money
-- column, which is a promise worth keeping. This one writes `sale_items`.
--
-- Refunded lines are included deliberately. The discount is a property of what
-- was charged, and a refunded line still shows the customer what they were
-- charged before it was handed back; its revenue is already zeroed by status,
-- so discounting it moves no money.

create or replace function set_sale_discount(
  p_sale_id uuid,
  p_discount_rate_bp integer
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sold_at timestamptz;
  v_voided  timestamptz;
  v_promo   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_promo := coalesce(p_discount_rate_bp, 0);
  if v_promo < 0 or v_promo > 10000 then
    raise exception 'DISCOUNT_OUT_OF_RANGE';
  end if;

  select s.sold_at, s.voided_at into v_sold_at, v_voided
    from public.sales s where s.id = p_sale_id;

  if v_sold_at is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  if v_voided is not null then
    raise exception 'SALE_VOIDED';
  end if;

  -- The same reach every other correction grants the cashier.
  if not public.is_owner()
     and v_sold_at < date_trunc('day', now()) then
    raise exception 'PAST_DAY_OWNER_ONLY';
  end if;

  -- Rounded down per line, at the same rate, so the stored amounts are what
  -- create_sale would have written had the promo been known up front.
  -- `commission_centavos` is pointedly absent from this UPDATE.
  update public.sale_items
     set discount_rate_bp = v_promo,
         discount_centavos = floor(line_total_centavos::numeric * v_promo / 10000)::integer
   where sale_id = p_sale_id;

  perform public.recalc_sale_totals(p_sale_id);
end;
$function$;

revoke all on function set_sale_discount(uuid, integer) from public, anon;
grant execute on function set_sale_discount(uuid, integer) to authenticated;

comment on function set_sale_discount(uuid, integer) is
  'Apply one promo percentage across every line of a ticket, or 0 to remove it; recomputes each line''s discount and resums the header. Never touches commission -- the crew is paid on the undiscounted price. security definer: sale_items is owner-only for UPDATE. Cashiers may set this on today''s sales only.';
