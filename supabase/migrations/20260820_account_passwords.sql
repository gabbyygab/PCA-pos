-- Letting the owner change the cashier's password from the Price Board.
--
-- The owner's own password is not this function's business: supabase-js has
-- `auth.updateUser({ password })`, which acts on the caller's own account with
-- the caller's own token, and the web app uses exactly that. What has no
-- client-side equivalent is the *other* account. Changing a different user's
-- password is an admin operation, and the Admin API authenticates with the
-- service-role key -- a key that bypasses RLS entirely.
--
-- That key cannot ship in this app. The desktop bundle is a static export read
-- off disk and the cashier's phone carries the same code, so anything baked in
-- is readable by anyone holding the device: the service key would hand them
-- the whole database, not just a password reset. The anon key is public by
-- design; the service key is the opposite of that.
--
-- So the privilege stays in Postgres, where it can be fenced. This function is
-- `security definer` -- it runs as its owner, which can write `auth.users` --
-- and it guards itself on three axes:
--
--   who   only an owner JWT gets past the `is_owner()` check
--   what  only the cashier row is writable, never another owner, never itself
--   how   the new password is bcrypt-hashed here; no plaintext is ever stored
--
-- The narrowness is the security argument. This is not "update any user"; it
-- is "set the password of a non-owner account", which is the smallest
-- privilege that does the job.

-- ---------------------------------------------------------------------------
-- Listing the accounts
-- ---------------------------------------------------------------------------

-- `auth.users` is not readable through PostgREST, and should not be made so.
-- The settings screen needs three harmless facts per account -- id, email,
-- role -- so a definer function hands back exactly those columns and nothing
-- else. No password material, no tokens, no metadata blob.
create or replace function public.list_accounts()
returns table (
  id       uuid,
  email    text,
  role     text,
  is_self  boolean
)
language sql
stable
security definer
set search_path to ''
as $function$
  select u.id,
         u.email::text,
         coalesce(u.raw_app_meta_data ->> 'role', 'cashier') as role,
         u.id = auth.uid() as is_self
    from auth.users u
   where public.is_owner()
   order by (u.raw_app_meta_data ->> 'role') = 'owner' desc, u.email;
$function$;

revoke all on function public.list_accounts() from public;
grant execute on function public.list_accounts() to authenticated;

comment on function public.list_accounts() is
  'The sign-in accounts, for the owner''s account settings. Owner-only, and returns id/email/role only -- never password material. security definer because auth.users is not exposed through PostgREST.';

-- ---------------------------------------------------------------------------
-- Setting another account's password
-- ---------------------------------------------------------------------------

create or replace function public.set_account_password(
  p_user_id      uuid,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role text;
begin
  -- Running as the definer means RLS is not vetting the caller, so identity is
  -- established here, exactly as `set_service_status` does.
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.is_owner() then
    raise exception 'OWNER_ONLY';
  end if;

  -- Length is enforced in Postgres as well as in the dialog. The UI check is
  -- a courtesy to the person typing; this one is the rule, and it holds even
  -- if the RPC is called directly with a one-character password.
  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;

  select coalesce(u.raw_app_meta_data ->> 'role', 'cashier')
    into v_role
    from auth.users u
   where u.id = p_user_id;

  if v_role is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  -- The owner's own password is deliberately out of reach here, for two
  -- reasons. It removes the path where a borrowed unlocked session locks the
  -- real owner out of their own account, and it keeps this function unable to
  -- grant its caller anything -- it can only ever write a subordinate account.
  -- The owner changes their own password through `auth.updateUser`, which
  -- re-checks their current password first.
  if v_role = 'owner' then
    raise exception 'OWNER_PASSWORD_SELF_SERVICE';
  end if;

  -- bcrypt, the format GoTrue itself writes and verifies. `gen_salt('bf')`
  -- draws a fresh salt per call, so setting the same password twice does not
  -- produce the same hash.
  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at         = now()
   where id = p_user_id;

  -- Every existing refresh token for that account is revoked, so a phone still
  -- holding the old session is signed out rather than carrying on with a
  -- password that no longer exists. A password change that left old sessions
  -- alive would not actually take the account back.
  delete from auth.refresh_tokens where user_id = p_user_id::text;
end;
$function$;

revoke all on function public.set_account_password(uuid, text) from public;
grant execute on function public.set_account_password(uuid, text) to authenticated;

comment on function public.set_account_password(uuid, text) is
  'Owner-only: set a NON-owner account''s password (bcrypt) and revoke its sessions. security definer because auth.users is not writable by the anon key, and the service-role key cannot ship in a client bundle. Refuses to touch an owner account -- owners use auth.updateUser on themselves.';

-- ---------------------------------------------------------------------------
-- Locking down the RPC surface
-- ---------------------------------------------------------------------------

-- The same trap `20260820_service_status.sql` documents, in a later form:
-- Supabase's *default privileges* re-grant EXECUTE to `anon` and
-- `authenticated` on every new function in `public`, and that grant lands
-- after the `revoke ... from public` above. Revoking PUBLIC is therefore not
-- sufficient on its own -- `anon` has to be named.
--
-- Neither function is exploitable through `anon` (both refuse a caller with no
-- `auth.uid()`), but the anon key ships to every phone and desktop, so an
-- account-management RPC it can reach at all is one bug away from mattering.
revoke execute on function public.list_accounts() from anon;
revoke execute on function public.set_account_password(uuid, text) from anon;

grant execute on function public.list_accounts() to authenticated;
grant execute on function public.set_account_password(uuid, text) to authenticated;
