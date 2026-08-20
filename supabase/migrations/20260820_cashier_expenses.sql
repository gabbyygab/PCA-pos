-- Letting the cashier record what the shop spends.
--
-- Expenses started owner-only in both directions, matching payroll_adjustments:
-- a cashier rings up sales, and what the shop spends is neither theirs to read
-- nor to write. That was right for payroll and wrong for expenses, because of
-- who is actually standing there when the money leaves. The cashier is the one
-- at the counter buying soap and paying the water delivery; the owner is not
-- always in the shop. Making them the only person who can record it means the
-- receipt goes in a drawer and gets typed in later, or does not get typed in at
-- all -- and an expense nobody recorded is the one that makes net sales wrong.
--
-- So insert opens up. Reading does not, beyond the day in progress.
--
-- The asymmetry is deliberate and it mirrors `sales_read` exactly, which
-- already lets a cashier see today and nothing before it. Today's expenses are
-- the cashier's own working memory: it is what lets them see the row they just
-- typed, notice that soap is already on the sheet, and not enter it twice. The
-- history behind it is a different thing -- what the shop spends per month is
-- the owner's business, and a phone at the counter is not where it should be
-- readable.
--
-- Update and delete stay owner-only. A cashier who mistypes an amount says so
-- and the owner fixes it, which leaves the correction visible. The alternative
-- -- letting the device that typed the row also silently rewrite or remove it
-- -- is how a mistake becomes indistinguishable from a cover-up, and there is
-- no way to tell the two apart after the fact.

-- ---------------------------------------------------------------------------
-- Replacing the single owner-only policy with one policy per verb
-- ---------------------------------------------------------------------------
-- `expenses_owner` was `for all`, so it cannot be narrowed in place: a single
-- FOR ALL policy applies its `using` clause to select/update/delete and its
-- `with check` to insert, and there is no way to let insert through without
-- letting the rest through with it. Four policies, one per verb, is what makes
-- the four answers independent.

drop policy if exists expenses_owner on expenses;

-- Read: the owner sees the whole ledger; anyone else sees the day in progress.
--
-- `spent_on` is a plain date defaulted to the Manila day, so this compares
-- date to date and needs no timezone arithmetic -- unlike `sales_read`, which
-- has to truncate a timestamptz. An expense backdated by the owner to an
-- earlier day drops out of the cashier's view immediately, which is correct:
-- it is history the moment it is not today's.
drop policy if exists expenses_read on expenses;
create policy expenses_read on expenses
  for select to authenticated
  using (is_owner() or spent_on = (now() at time zone 'Asia/Manila')::date);

-- Insert: any signed-in user.
--
-- There is no `with check` on the day here, so a cashier can record yesterday's
-- receipt when it surfaces late -- but they will not see it afterwards, because
-- the read policy above no longer matches it. That is the intended shape: a
-- late receipt is worth capturing, and it becomes the owner's to review.
--
-- `created_by` defaults to auth.uid() on the column, so authorship is recorded
-- whether or not the client sends it.
drop policy if exists expenses_insert on expenses;
create policy expenses_insert on expenses
  for insert to authenticated
  with check (true);

-- Edit and remove: owner only, as before.
drop policy if exists expenses_update_owner on expenses;
create policy expenses_update_owner on expenses
  for update to authenticated
  using (is_owner()) with check (is_owner());

drop policy if exists expenses_delete_owner on expenses;
create policy expenses_delete_owner on expenses
  for delete to authenticated
  using (is_owner());

comment on policy expenses_read on expenses is
  'Owner reads the whole ledger; a cashier reads only the Manila day in progress, mirroring sales_read. Enough to avoid double-entering soap, not enough to read the shop''s spending history off a phone.';
comment on policy expenses_insert on expenses is
  'Any signed-in user may record an expense: the cashier is who is standing there when the money is spent, and an expense nobody recorded is what makes net sales wrong.';
