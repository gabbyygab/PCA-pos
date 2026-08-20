-- Per-service fulfilment status, and the RPC that lets a cashier set it.
--
-- Until now a sale was a single atomic fact: it happened, at a total, and the
-- only reversal was voiding the whole ticket. But the shop works a car one
-- service at a time -- the carwash finishes while the hand wax is still going,
-- and a customer refuses the tire black after seeing it. The crew needs to
-- record that per line, from the phone at the bay, without calling the owner.
--
-- Three states, on `sale_items`:
--
--   pending   the line is rung up and being worked         (the default)
--   done      the crew finished it
--   refunded  the customer was given the money back
--
-- A refund is NOT a delete. The line stays on the ticket, struck through, so
-- the receipt still shows what was ordered and the owner can see what was
-- handed back. What changes is that the money stops counting.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

do $$ begin
  create type service_status as enum ('pending', 'done', 'refunded');
exception when duplicate_object then null;
end $$;

alter table sale_items
  add column if not exists status service_status not null default 'pending';

-- Who last moved the line, and when. Captured on the row rather than in a
-- separate audit table: at ~40 cars a day the history that matters is "who
-- refunded this", and one denormalised pair answers it without a join.
alter table sale_items
  add column if not exists status_changed_at timestamptz;
alter table sale_items
  add column if not exists status_changed_by uuid references auth.users (id);

-- Every existing line predates the feature and was, by definition, completed
-- work -- the sale was rung up and paid. Leaving them `pending` would open the
-- new page onto a backlog of phantom work.
update sale_items set status = 'done' where status = 'pending';

comment on column sale_items.status is
  'Fulfilment state of this one service. `refunded` zeroes its contribution to gross and commission at the reporting boundary; the row itself is never deleted.';

-- ---------------------------------------------------------------------------
-- Refund-aware money
-- ---------------------------------------------------------------------------
--
-- The chosen rule: a refunded line stops counting toward gross revenue AND its
-- crew commission is reversed. Rather than mutate `line_total_centavos` -- which
-- would destroy the record of what was actually charged -- the effective amounts
-- are derived. History stays intact; reports read the derived column.

alter table sale_items
  drop column if exists effective_total_centavos;
alter table sale_items
  add column effective_total_centavos integer
  generated always as (
    case when status = 'refunded' then 0 else line_total_centavos end
  ) stored;

alter table sale_items
  drop column if exists effective_commission_centavos;
alter table sale_items
  add column effective_commission_centavos integer
  generated always as (
    case when status = 'refunded' then 0 else commission_centavos end
  ) stored;

comment on column sale_items.effective_total_centavos is
  'line_total_centavos, or 0 once refunded. Reports sum this; `line_total_centavos` remains the price actually charged at sale time.';

-- The status column is the new page's primary filter, and the work queue asks
-- for the pending lines specifically.
create index if not exists sale_items_status_idx on sale_items (status);

-- The per-employee shares in `sale_item_commissions` get no such column: a
-- generated column cannot reach another table to see its line's status, so the
-- reversal for shares is applied by the queries that read them, which already
-- join `sale_items`.

-- ---------------------------------------------------------------------------
-- Keeping the sale header honest
-- ---------------------------------------------------------------------------
--
-- `sales.total_centavos` is the summed header the POS feed and every report
-- reads. When a line is refunded it has to fall, or the ticket claims money the
-- shop gave back.

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
            where sic.sale_id = s.id and si.status <> 'refunded'
         ), 0)
   where s.id = p_sale_id;
$function$;

-- ---------------------------------------------------------------------------
-- The RPC
-- ---------------------------------------------------------------------------
--
-- `sale_items` has an owner-only UPDATE policy (sale_items_update_owner), so a
-- cashier writing this column directly would match zero rows -- and a zero-row
-- UPDATE is not an error, so the tap would silently do nothing. That is exactly
-- the bug 20260819_cashier_sale_totals.sql was written to fix, so this follows
-- the same shape: `security definer`, guarding itself.
--
-- The cashier's reach is deliberately the same as their existing read rule --
-- today only. They can move a line in any direction while the car is still on
-- the lot (a mis-tap must be fixable without an owner interruption), and
-- anything older is the owner's to correct.

create or replace function set_service_status(
  p_sale_item_id uuid,
  p_status       service_status
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sale_id  uuid;
  v_sold_at  timestamptz;
  v_voided   timestamptz;
begin
  -- Running as the definer means RLS is no longer vetting the caller, so the
  -- function has to establish identity itself.
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select si.sale_id, s.sold_at, s.voided_at
    into v_sale_id, v_sold_at, v_voided
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
   where si.id = p_sale_item_id;

  if v_sale_id is null then
    raise exception 'SALE_ITEM_NOT_FOUND';
  end if;

  -- A voided ticket is already fully reversed; letting a line inside it move
  -- would resurrect money on a sale that no longer exists.
  if v_voided is not null then
    raise exception 'SALE_VOIDED';
  end if;

  if not public.is_owner()
     and v_sold_at < date_trunc('day', now()) then
    raise exception 'PAST_DAY_OWNER_ONLY';
  end if;

  update public.sale_items
     set status            = p_status,
         status_changed_at = now(),
         status_changed_by = auth.uid()
   where id = p_sale_item_id;

  perform public.recalc_sale_totals(v_sale_id);
end;
$function$;

revoke all on function set_service_status(uuid, service_status) from public;
grant execute on function set_service_status(uuid, service_status) to authenticated;

comment on function set_service_status(uuid, service_status) is
  'Move one service line between pending/done/refunded and resum the sale header. security definer: sale_items is owner-only for UPDATE, so a cashier cannot write this column directly. Cashiers may change today''s sales only.';

-- ---------------------------------------------------------------------------
-- Locking down the RPC surface
-- ---------------------------------------------------------------------------
--
-- PostgREST exposes every function in `public` as an RPC endpoint, and Postgres
-- grants EXECUTE to PUBLIC on each new function by default. That combination
-- had `create_sale` -- security definer, writes money -- reachable by `anon`.
--
-- Note that revoking from the `anon` role alone does nothing: the privilege is
-- resolved through the implicit grant to PUBLIC, so PUBLIC is what has to be
-- revoked, and the intended role granted back explicitly.

-- Internal helper of set_service_status, not an API. A security definer
-- function runs as its owner, so set_service_status still reaches it.
revoke execute on function recalc_sale_totals(uuid) from public, anon, authenticated;

revoke execute on function set_service_status(uuid, service_status) from public;
grant execute on function set_service_status(uuid, service_status) to authenticated;

revoke execute on function create_sale(uuid[], vehicle_class, text, jsonb, payment_method, text, text) from public;
grant execute on function create_sale(uuid[], vehicle_class, text, jsonb, payment_method, text, text) to authenticated;

revoke execute on function service_sale_counts() from public;
grant execute on function service_sale_counts() to authenticated;
