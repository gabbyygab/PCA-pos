-- Correcting the ticket a service line sits on.
--
-- `edit_sale_item` fixes the line: its quantity, its price, the crew owed for
-- it. But three of the things most often typed wrong are not on the line at
-- all -- they are on the sale header, one per car:
--
--   * `payment_method` -- the customer said cash and paid by GCash, or the
--     cashier tapped the wrong chip on the way to Confirm. Until now this was
--     unfixable from either client, which mattered more than it sounds: the
--     Reports payment breakdown and its filter read this column, so one
--     mis-tap silently misfiles a whole ticket's revenue.
--   * `vehicle_note` -- what the car is ("Toyota Vios"), typed while the
--     customer is still talking.
--   * `plate_number` -- the same, and the one thing the crew searches by when
--     they are standing at a bay looking for a specific car.
--
-- Both clients open the header fields inside the service-line modal rather than
-- giving the ticket its own editor, because that modal is already the gesture
-- for "this car's details are wrong". The RPC stays separate from
-- `edit_sale_item` regardless: they write different tables, and a header fix
-- must not have to invent line values to go through.
--
-- What it deliberately does NOT touch: `vehicle_class`, `size`,
-- `total_centavos`, `receipt_no`, `sold_at`. The class and size are the scale
-- every line was priced against, so changing them here would leave the prices
-- describing a different car; that is a re-ring, not an edit. The total is
-- derived by `recalc_sale_totals` and is never a typed value.

create or replace function edit_sale_ticket(
  p_sale_id        uuid,
  p_payment_method payment_method default null,
  p_vehicle_note   text default null,
  p_plate_number   text default null,
  -- The two text fields are nullable columns, so "null means leave it alone"
  -- cannot also express "clear it". These flags carry that second meaning:
  -- without them a cashier who typed a plate on the wrong car could never take
  -- it back off.
  p_clear_vehicle_note boolean default false,
  p_clear_plate_number boolean default false
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sold_at timestamptz;
  v_voided  timestamptz;
  v_note    text;
  v_plate   text;
begin
  -- Running as the definer means RLS is no longer vetting the caller, so the
  -- function establishes identity itself.
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select s.sold_at, s.voided_at, s.vehicle_note, s.plate_number
    into v_sold_at, v_voided, v_note, v_plate
    from public.sales s
   where s.id = p_sale_id;

  if v_sold_at is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- A voided ticket is already fully reversed; re-describing the car it was
  -- rung up against edits a sale that no longer exists.
  if v_voided is not null then
    raise exception 'SALE_VOIDED';
  end if;

  -- The same reach `set_service_status` and `edit_sale_item` grant: a cashier
  -- fixes a mis-tap while the car is still on the lot, and anything older is
  -- the owner's to correct.
  if not public.is_owner()
     and v_sold_at < date_trunc('day', now()) then
    raise exception 'PAST_DAY_OWNER_ONLY';
  end if;

  if p_clear_vehicle_note then
    v_note := null;
  elsif p_vehicle_note is not null then
    -- Trimmed to empty is the same statement as cleared: a field the cashier
    -- blanked out must not persist as a zero-length string that reads as a
    -- present-but-unnamed vehicle everywhere it is rendered.
    v_note := nullif(trim(p_vehicle_note), '');
  end if;

  if p_clear_plate_number then
    v_plate := null;
  elsif p_plate_number is not null then
    v_plate := nullif(upper(trim(p_plate_number)), '');
  end if;

  update public.sales
     set payment_method = coalesce(p_payment_method, payment_method),
         vehicle_note   = v_note,
         plate_number   = v_plate
   where id = p_sale_id;
end;
$function$;

-- PostgREST exposes every `public` function as an RPC and Postgres grants
-- EXECUTE to PUBLIC by default. Revoking from `anon` alone does nothing --
-- the privilege resolves through PUBLIC, so PUBLIC is what must be revoked.
-- Supabase re-applies its own default grants to the API roles after a function
-- is created, which can hand `anon` an explicit EXECUTE back even though PUBLIC
-- was revoked in the same batch, so `anon` is named alongside it. Verify with:
--   select proacl from pg_proc where proname = 'edit_sale_ticket';
revoke all on function edit_sale_ticket(uuid, payment_method, text, text, boolean, boolean)
  from public, anon;
grant execute on function edit_sale_ticket(uuid, payment_method, text, text, boolean, boolean)
  to authenticated;

comment on function edit_sale_ticket(uuid, payment_method, text, text, boolean, boolean) is
  'Correct a sale header in place -- payment method, vehicle name, plate number. security definer: sales is owner-only for UPDATE, so a cashier cannot write these columns directly. Null arguments leave a field unchanged; the p_clear_* flags blank a nullable text field, which null alone cannot express. Cashiers may edit today''s sales only. Never touches vehicle_class, size, or any money column.';
