-- Two changes that both turn on the same question: what counts as a sale.
--
--   1. Only a `done` line is revenue. A `pending` line is work in progress,
--      not money -- it contributes 0 to gross, net, commission and payroll
--      until the crew marks it done.
--   2. A line can be deleted outright, by the owner.

-- ---------------------------------------------------------------------------
-- 1. Only `done` counts
-- ---------------------------------------------------------------------------
--
-- The generated columns previously read "0 when refunded", which meant a line
-- was revenue from the instant it was rung up and stayed revenue whether or not
-- the work happened. That let the day's gross run ahead of the work actually
-- completed: a car on the lot with four services queued read as four sold
-- services, and the crew was owed commission on a wax nobody had started.
--
-- The rule is now positive rather than negative -- `done` earns, everything
-- else is zero -- so the two non-earning states differ in meaning, not in
-- money: `pending` is "not yet", `refunded` is "not any more".
--
-- The columns keep their names. Every report, the payroll query, and
-- `recalc_sale_totals` already sum these rather than `line_total_centavos`, so
-- the rule changes in one place and every reader follows.

alter table sale_items
  drop column if exists effective_total_centavos;
alter table sale_items
  add column effective_total_centavos integer
  generated always as (
    case when status = 'done' then line_total_centavos else 0 end
  ) stored;

alter table sale_items
  drop column if exists effective_commission_centavos;
alter table sale_items
  add column effective_commission_centavos integer
  generated always as (
    case when status = 'done' then commission_centavos else 0 end
  ) stored;

comment on column sale_items.effective_total_centavos is
  'line_total_centavos once the line is `done`, otherwise 0. Reports sum this; `line_total_centavos` remains the price actually charged at sale time. A pending line is work in progress, not revenue; a refunded one is money given back.';

comment on column sale_items.effective_commission_centavos is
  'commission_centavos once the line is `done`, otherwise 0. The crew is owed its cut for work finished, not work queued.';

-- The crew shares in `sale_item_commissions` get no such column -- a generated
-- column cannot reach another table to see its line's status -- so the same
-- rule is applied by the queries that read them, which already join
-- `sale_items`. Those joins previously tested `status <> 'refunded'` and now
-- test `status = 'done'`.

-- `recalc_sale_totals` sums the effective column for the header total, so that
-- half already follows. Its commission half joins `sale_items` explicitly and
-- has to move with it.
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

-- Every existing header was summed under the old rule, so the pending lines
-- already on the books are still counted in it. Resum every sale once so the
-- stored totals agree with the new columns.
do $$
declare r record;
begin
  for r in select id from public.sales loop
    perform public.recalc_sale_totals(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Deleting a line
-- ---------------------------------------------------------------------------
--
-- A refund deliberately does NOT delete: the line stays on the ticket, struck
-- through, because the receipt has to keep showing what was ordered and the
-- owner has to be able to see what was handed back. Deletion is the other case
-- -- the line should never have been on the ticket at all (rung up on the wrong
-- car, double-tapped, a test) and leaving it struck through would be a lie
-- about what the customer was offered.
--
-- Owner-only, on any day, deliberately narrower than `set_service_status` and
-- `edit_sale_item`. A cashier's correction path stays "refund", which leaves
-- the mistake visible; letting the device that typed a row also erase it is
-- exactly the asymmetry `expenses` already argues for.
--
-- `sale_item_commissions` has `on delete cascade` on `sale_item_id`, so the
-- crew shares go with the line without being named here.

create or replace function delete_sale_items(p_sale_item_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sale_ids uuid[];
  v_sale_id  uuid;
  v_deleted  integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Not "cashiers may delete today's": deletion is the one correction that
  -- leaves no trace, so it stays with the owner on every day.
  if not public.is_owner() then
    raise exception 'OWNER_ONLY';
  end if;

  if p_sale_item_ids is null or array_length(p_sale_item_ids, 1) is null then
    raise exception 'NOTHING_SELECTED';
  end if;

  -- The sales these lines belong to, captured before the delete -- afterwards
  -- there is nothing left to join back to.
  select array_agg(distinct si.sale_id)
    into v_sale_ids
    from public.sale_items si
   where si.id = any(p_sale_item_ids);

  if v_sale_ids is null then
    raise exception 'SALE_ITEM_NOT_FOUND';
  end if;

  -- A voided ticket is already fully reversed; deleting inside one would edit
  -- a sale that no longer exists.
  if exists (
    select 1 from public.sales s
     where s.id = any(v_sale_ids) and s.voided_at is not null
  ) then
    raise exception 'SALE_VOIDED';
  end if;

  delete from public.sale_items si where si.id = any(p_sale_item_ids);
  get diagnostics v_deleted = row_count;

  -- Each affected header has to be resummed, or the ticket claims a total its
  -- remaining lines do not add up to.
  foreach v_sale_id in array v_sale_ids loop
    perform public.recalc_sale_totals(v_sale_id);

    -- A ticket with no lines left is not a 0 sale, it is a sale that did not
    -- happen. Voiding it keeps the receipt number and the audit trail while
    -- taking it out of every count, which is what an empty ticket means.
    if not exists (
      select 1 from public.sale_items si where si.sale_id = v_sale_id
    ) then
      update public.sales
         set voided_at = now()
       where id = v_sale_id and voided_at is null;
    end if;
  end loop;

  return v_deleted;
end;
$function$;

-- PostgREST exposes every `public` function as an RPC and Postgres grants
-- EXECUTE to PUBLIC by default; Supabase then re-grants its API roles, so
-- `anon` is revoked by name as well as through PUBLIC. Granted to
-- `authenticated` rather than to a role: the owner check is inside the
-- function, where it can raise a message the UI can show.
revoke all on function delete_sale_items(uuid[]) from public, anon;
grant execute on function delete_sale_items(uuid[]) to authenticated;

comment on function delete_sale_items(uuid[]) is
  'Permanently remove one or more service lines and their crew shares, resumming each affected sale header; a sale left with no lines is voided. Owner-only on any day -- a cashier corrects with a refund, which stays visible. security definer: sale_items has an owner-only DELETE policy and a cashier''s direct delete would silently match zero rows.';

-- ---------------------------------------------------------------------------
-- 3. Payroll follows the same rule
-- ---------------------------------------------------------------------------
--
-- `finalize_payroll_period` reads the crew shares and never filtered on the
-- line's status at all. That was already wrong for refunds -- a finalized slip
-- paid commission on money the shop had handed back -- and it was invisible
-- because the Payroll tab's live view (`useWeekPayroll`) applies the reversal
-- in TypeScript, so the screen and the slip it generated disagreed. Under the
-- new rule it would also pay for work not yet done.
--
-- Both totals move: gross summed `line_total_centavos` and commission summed
-- the raw shares, so both now read through the line's status. Gross uses the
-- effective column; the shares are filtered by the join, since a generated
-- column cannot reach across tables.
--
-- Slips already finalized are deliberately NOT recomputed. A finalized slip
-- snapshots its totals and does not change when the rules or the data behind it
-- move -- reopening the week is the explicit, deliberate act that recomputes.

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

  -- Pay from the crew shares, not sale_items.commission_centavos -- that column
  -- is the whole crew's pay for the line, so grouping it by the lead employee
  -- would hand one person everyone else's cut.
  with worked as (
    select
      e.id   as employee_id,
      e.name as employee_name,
      count(distinct s.id)                        as sales_count,
      -- Gross credits each crew member the full line: it measures the work done
      -- on the car, while only commission is split. `effective_` so an unfinished
      -- or refunded line is not counted as work delivered.
      coalesce(sum(si.effective_total_centavos), 0) as gross_sales_centavos,
      coalesce(sum(sic.commission_centavos), 0)     as commission_centavos
    from employees e
    join sale_item_commissions sic on sic.employee_id = e.id
    join sale_items si on si.id = sic.sale_item_id
    join sales s on s.id = sic.sale_id
    where s.voided_at is null
      -- The crew is paid for work finished. A generated column cannot see
      -- across to another table, so the shares are filtered here.
      and si.status = 'done'
      and s.sold_at >= p_week_start::timestamptz
      and s.sold_at < (p_week_start + 7)::timestamptz
    group by e.id, e.name
  ),
  adjusted as (
    select
      pa.employee_id,
      sum(pa.amount_centavos) as adjustment_centavos
    from payroll_adjustments pa
    where pa.week_start = p_week_start
    group by pa.employee_id
  )
  insert into payroll_slips (
    period_id, employee_id, employee_name, sales_count,
    gross_sales_centavos, commission_centavos, adjustment_centavos
  )
  select
    v_period_id,
    coalesce(w.employee_id, a.employee_id),
    coalesce(w.employee_name, e.name),
    coalesce(w.sales_count, 0),
    coalesce(w.gross_sales_centavos, 0),
    coalesce(w.commission_centavos, 0),
    coalesce(a.adjustment_centavos, 0)
  from worked w
  full outer join adjusted a on a.employee_id = w.employee_id
  -- Only needed for the adjustment-only rows, where `worked` has no name.
  left join employees e on e.id = coalesce(w.employee_id, a.employee_id);

  update payroll_periods
     set status = 'finalized', finalized_at = now()
   where id = v_period_id;

  return v_period_id;
end;
$function$;

revoke all on function finalize_payroll_period(date) from public, anon;
grant execute on function finalize_payroll_period(date) to authenticated;
