-- Correcting a service line after it was rung up.
--
-- Until now the only thing a line could do after `create_sale` wrote it was
-- move between pending/done/refunded. Everything else -- a mistyped price, the
-- wrong quantity, an open-price amount agreed after the fact, the wrong crew --
-- meant voiding the whole ticket and ringing the car up again, which throws
-- away the receipt number and the timestamps the shop actually worked to.
--
-- This RPC edits one line in place. It is the same shape as
-- `set_service_status`: `security definer`, guarding itself, and limiting a
-- cashier to today's sales. It has to be security definer for the same reason
-- that one does -- `sale_items` has an owner-only UPDATE policy, so a cashier's
-- direct write matches zero rows, and a zero-row UPDATE is not an error, so the
-- edit would appear to save and change nothing.
--
-- What it deliberately does NOT touch:
--
--   * `commission_rate_bp` -- the rate is snapshotted at sale time so that
--     editing a rate in Settings never rewrites history. Letting a line's rate
--     be retyped here would reopen exactly that hole. The rate rides along
--     unchanged and the commission is recomputed from it.
--   * `service_id`, `category`, `size` -- what was sold and at what scale is
--     the identity of the line. Changing those is a different sale.

-- ---------------------------------------------------------------------------
-- The RPC
-- ---------------------------------------------------------------------------
--
-- Every argument is optional and null means "leave it alone", so the two
-- clients can send only the fields their modal exposes without having to
-- re-send the whole row and risk clobbering a concurrent edit.
--
-- The crew is the exception: `p_employee_ids` null leaves the existing crew,
-- but an explicit array REPLACES it, because a crew edit is always a complete
-- statement of who worked the line -- there is no "add one member" gesture in
-- either UI.

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
  v_name        text;
  v_qty         integer;
  v_unit        integer;
  v_line_total  integer;
  v_commission  integer;
  v_share       integer;
  v_paid        integer;
  v_crew        uuid[];
  v_crew_size   integer;
  v_idx         integer;
begin
  -- Running as the definer means RLS is no longer vetting the caller, so the
  -- function establishes identity itself.
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select si.sale_id, si.commission_rate_bp, si.service_name, si.quantity,
         si.unit_price_centavos, s.sold_at, s.voided_at
    into v_sale_id, v_rate, v_name, v_qty, v_unit, v_sold_at, v_voided
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
   where si.id = p_sale_item_id;

  if v_sale_id is null then
    raise exception 'SALE_ITEM_NOT_FOUND';
  end if;

  -- A voided ticket is already fully reversed; editing a line inside it would
  -- resurrect money on a sale that no longer exists.
  if v_voided is not null then
    raise exception 'SALE_VOIDED';
  end if;

  -- The same reach `set_service_status` grants: a cashier fixes a mis-tap while
  -- the car is still on the lot, and anything older is the owner's to correct.
  if not public.is_owner()
     and v_sold_at < date_trunc('day', now()) then
    raise exception 'PAST_DAY_OWNER_ONLY';
  end if;

  -- Null means "leave it alone" -- see the note above.
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

  -- The crew: an explicit array replaces the line's roster wholesale.
  if p_employee_ids is not null then
    -- Deduplicate -- the same person listed twice must not earn twice.
    select array_agg(distinct e) into v_crew
      from unnest(p_employee_ids) as e;

    v_crew_size := coalesce(array_length(v_crew, 1), 0);
    if v_crew_size = 0 then
      raise exception 'CREW_REQUIRED';
    end if;

    -- RLS is not vetting these ids for us, so the function does it: an
    -- inactive or invented employee must not end up owed commission.
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
    -- No crew change: keep the roster already on the line, in a stable order
    -- so the lead stays the lead.
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

  -- Integer math, rounded once per line, then each share rounded UP -- the
  -- identical sequence `create_sale` and `shareOfCommission()` in
  -- shared/lib/pricing.ts use. Recomputed here rather than scaled from the old
  -- commission, because scaling would compound the round-up overage on a line
  -- edited twice.
  v_commission := round(v_line_total::numeric * v_rate / 10000)::integer;
  v_share := ceil(v_commission::numeric / v_crew_size)::integer;
  v_paid := v_share * v_crew_size;

  update public.sale_items
     set service_name        = v_name,
         quantity            = v_qty,
         unit_price_centavos = v_unit,
         line_total_centavos = v_line_total,
         commission_centavos = v_paid,
         -- The lead: "who led this car", not "who is owed". Kept in step with
         -- the crew so a reassignment does not strand the old lead on the row.
         employee_id         = v_crew[1]
   where id = p_sale_item_id;

  -- Replace the shares wholesale. Cheaper to reason about than diffing the two
  -- rosters, and the unique (sale_item_id, employee_id) constraint makes an
  -- upsert of a shrinking crew fiddly in exactly the case that matters.
  delete from public.sale_item_commissions where sale_item_id = p_sale_item_id;

  for v_idx in 1 .. v_crew_size loop
    insert into public.sale_item_commissions (
      sale_item_id, sale_id, employee_id, commission_centavos, crew_size
    )
    values (p_sale_item_id, v_sale_id, v_crew[v_idx], v_share, v_crew_size);
  end loop;

  -- The header has to follow, or the ticket claims a total its lines no longer
  -- add up to. This also reverses the shares for a refunded line, since
  -- recalc_sale_totals filters on status.
  perform public.recalc_sale_totals(v_sale_id);
end;
$function$;

-- PostgREST exposes every `public` function as an RPC and Postgres grants
-- EXECUTE to PUBLIC by default. Revoking from `anon` alone does nothing --
-- the privilege resolves through PUBLIC, so PUBLIC is what must be revoked.
-- `anon` is named alongside PUBLIC here, unlike the earlier migrations. Supabase
-- re-applies its own default grants to the API roles after a function is
-- created, which handed `anon` an explicit EXECUTE back even though PUBLIC had
-- been revoked in the same statement batch. Revoking from PUBLIC alone is
-- necessary but no longer sufficient; verify with:
--   select proacl from pg_proc where proname = 'edit_sale_item';
revoke all on function edit_sale_item(uuid, text, integer, integer, uuid[]) from public, anon;
grant execute on function edit_sale_item(uuid, text, integer, integer, uuid[]) to authenticated;

comment on function edit_sale_item(uuid, text, integer, integer, uuid[]) is
  'Correct one service line in place -- name, quantity, unit price, and the crew owed its commission -- resumming the line, its shares, and the sale header. security definer: sale_items is owner-only for UPDATE, so a cashier cannot write these columns directly. Null arguments leave a field unchanged; an explicit p_employee_ids replaces the crew wholesale. Cashiers may edit today''s sales only. The commission RATE is never editable here: it is snapshotted at sale time so Settings can never rewrite history.';

-- ---------------------------------------------------------------------------
-- Reading a line's crew
-- ---------------------------------------------------------------------------
--
-- The edit modal has to show who is currently on the line before it can offer
-- to change them. `sale_item_commissions` is already readable under RLS by the
-- owner (everything) and by a cashier (today), and it embeds `employees`, so
-- both clients read it directly through PostgREST -- no function needed.
--
-- The index that read wants already exists (sale_item_commissions_sale_idx),
-- but the modal fetches by line, not by sale.
create index if not exists sale_item_commissions_item_idx
  on sale_item_commissions (sale_item_id);
