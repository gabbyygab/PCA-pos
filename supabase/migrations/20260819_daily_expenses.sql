-- Daily operating expenses.
--
-- Gross sales is what the board earned; it is not what the shop kept. Soap,
-- water, electricity, a replaced pressure hose, the crew's lunch -- these are
-- real money leaving the till on a given day, and until now nothing in the
-- schema could hold them. The owner was reading gross as if it were profit.
--
-- Expenses are their own ledger, deliberately unconnected to sales. An expense
-- is not a negative sale: folding one into `sales` would corrupt gross revenue,
-- the service performance report, and every crew member's commission, because
-- commission is computed off the line total. So this table stands alongside the
-- sales history and is subtracted only at the reporting boundary:
--
--   net sales = gross sales - expenses
--
-- Note that commission is NOT subtracted here. The employee cut is already
-- carried in the payroll ledger, and the owner reads it as its own tile; net
-- here means "gross minus what I spent to run the day", which is the number
-- the shop actually asks for.

create table if not exists expenses (
  id                  uuid primary key default gen_random_uuid(),
  -- The day the money was spent, as a plain date. Expenses are recorded and
  -- reported by day, not by instant -- an 11pm electricity bill belongs to that
  -- day's sheet, and a timestamptz would let the Manila offset move it.
  spent_on            date not null default (now() at time zone 'Asia/Manila')::date,
  -- Free text, not a foreign key to a categories table. The owner names an
  -- expense whatever the receipt says; forcing "Soap" to be created as a
  -- category before it can be spent is friction with no payoff at ~40 cars a
  -- day. Reports group on this label as typed.
  name                text not null check (length(trim(name)) > 0),
  -- Optional context -- which supplier, which repair, which shift.
  description         text,
  -- Integer centavos like every other money column. Positive only: the
  -- direction is already in the table's name, so a negative expense would just
  -- be an unlabelled revenue row sneaking past the sales ledger.
  amount_centavos     integer not null check (amount_centavos > 0),
  -- Who recorded it. Captured at write time rather than joined later, so
  -- deleting an auth user cannot erase authorship of money leaving the till.
  created_by          uuid references auth.users (id) default auth.uid(),
  created_by_email    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- The reports query always filters on a day span, and the expenses page lists
-- newest first within it.
create index if not exists expenses_spent_on_idx on expenses (spent_on desc);

drop trigger if exists expenses_updated_at on expenses;
create trigger expenses_updated_at
  before update on expenses
  for each row execute function set_updated_at();

alter table expenses enable row level security;

-- Owner only, in every direction, matching payroll_adjustments. A cashier rings
-- up sales; what the shop spends is not theirs to read, and certainly not
-- theirs to write. This is the real boundary -- both clients ship the same anon
-- key to the device, so a missing screen in the Expo bundle is not a lock.
drop policy if exists expenses_owner on expenses;
create policy expenses_owner on expenses
  for all to authenticated using (is_owner()) with check (is_owner());

comment on table expenses is
  'Daily operating costs. Subtracted from gross sales at the reporting boundary to give net sales; never joined to sales or commission.';
comment on column expenses.spent_on is
  'The day the money was spent, in Manila local time. Reports bucket on this, not on created_at.';
comment on column expenses.amount_centavos is
  'Integer centavos, always positive. Direction is implied by the table.';
