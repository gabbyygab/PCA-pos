-- Manual adjustments to an employee's weekly cut.
--
-- The computed commission is what the crew earned off the board; it is not
-- always what the owner hands over. A Sunday overtime bonus, a deduction for a
-- damaged panel, an agreed correction after a dispute -- these are real payroll
-- events with no representation in sale_item_commissions, and forcing them
-- through the sales history would corrupt it: editing a past sale to add 200
-- pesos of bonus silently changes gross revenue and the service's reported
-- performance.
--
-- So adjustments are their own ledger, added on top of the computed cut and
-- never folded back into it. The payroll slip prints computed + adjustments =
-- final pay, and the sale that produced the computed number is left alone.
--
-- Signed centavos: a positive amount is a bonus, negative is a deduction. This
-- is the one money column in the schema allowed to go below zero, because a
-- deduction is not a negative price -- it is a direction on a ledger.

create table if not exists payroll_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  -- Keyed on the Monday, not on payroll_periods.id: an adjustment is routinely
  -- entered mid-week, before the period row exists at all. Finalizing then
  -- picks up whatever is already on record for that week.
  week_start          date not null check (extract(isodow from week_start) = 1),
  employee_id         uuid not null references employees (id),
  amount_centavos     integer not null check (amount_centavos <> 0),
  -- Required, and required to be non-empty. An unexplained change to someone's
  -- pay is the thing this table exists to prevent; a nullable reason column
  -- would make the audit trail optional in practice.
  reason              text not null check (length(trim(reason)) > 0),
  -- Who approved it. auth.uid() is captured at write time rather than joined
  -- later, so deleting an auth user cannot erase authorship of a payout.
  created_by          uuid references auth.users (id) default auth.uid(),
  created_by_email    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists payroll_adjustments_week_idx
  on payroll_adjustments (week_start);
create index if not exists payroll_adjustments_employee_idx
  on payroll_adjustments (employee_id);

drop trigger if exists payroll_adjustments_updated_at on payroll_adjustments;
create trigger payroll_adjustments_updated_at
  before update on payroll_adjustments
  for each row execute function set_updated_at();

alter table payroll_adjustments enable row level security;

-- Owner only, in every direction. A cashier cannot read payroll at all, and
-- must certainly not be able to write themselves a bonus. This is the real
-- boundary -- the password prompt in the UI is a second lock on the same door,
-- not a substitute for this one.
drop policy if exists payroll_adjustments_owner on payroll_adjustments;
create policy payroll_adjustments_owner on payroll_adjustments
  for all using (is_owner()) with check (is_owner());

-- Adjustments belong on the slip, so a finalized week snapshots the number
-- actually paid. Without this the slip would show the computed cut while the
-- owner handed over a different amount, and the two would never reconcile.
alter table payroll_slips
  add column if not exists adjustment_centavos integer not null default 0;

comment on column payroll_slips.adjustment_centavos is
  'Signed sum of manual adjustments at finalize time. Net pay = commission_centavos + adjustment_centavos.';

comment on column payroll_slips.commission_centavos is
  'Computed commission from sale_item_commissions only. Add adjustment_centavos for net pay.';

-- Finalize now snapshots the adjustments alongside the computed cut.
--
-- Two changes beyond the extra column. Employees with no sales but with an
-- adjustment must still get a slip -- otherwise a pure-bonus week pays nobody --
-- so the sales join becomes a full outer union over both sources. And the
-- adjustment total is frozen into the slip like every other money column, so
-- editing an adjustment after finalizing does not silently restate a week that
-- has already been paid out.
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
      -- on the car, while only commission is split.
      coalesce(sum(si.line_total_centavos), 0)    as gross_sales_centavos,
      coalesce(sum(sic.commission_centavos), 0)   as commission_centavos
    from employees e
    join sale_item_commissions sic on sic.employee_id = e.id
    join sale_items si on si.id = sic.sale_item_id
    join sales s on s.id = sic.sale_id
    where s.voided_at is null
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
