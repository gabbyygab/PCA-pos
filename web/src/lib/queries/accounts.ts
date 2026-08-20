'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

/**
 * The two sign-in accounts, and their passwords.
 *
 * Two different mechanisms sit behind one screen, because changing your own
 * password and changing someone else's are genuinely different operations:
 *
 *   own      `auth.updateUser` — the caller's own token, re-checked against
 *            their current password first.
 *   other    the `set_account_password` RPC — owner-only in Postgres, since
 *            the admin API needs a service-role key that cannot ship in a
 *            client bundle.
 *
 * See `supabase/migrations/20260820_account_passwords.sql`.
 */

export interface AccountRow {
  id: string
  email: string
  role: string
  is_self: boolean
}

export const accountsKey = ['accounts'] as const

export function useAccounts(enabled = true) {
  return useQuery({
    queryKey: accountsKey,
    queryFn: async (): Promise<AccountRow[]> => {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('list_accounts')
      if (error) throw error
      return (data ?? []) as AccountRow[]
    },
    // Only the owner can read this; a cashier would get an empty list, so
    // there is no reason to ask on their behalf.
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

/** Postgres raises bare codes; turn them into something the owner can act on. */
function readableRpcError(message: string): string {
  if (message.includes('OWNER_ONLY')) return 'Only the owner can change another account’s password.'
  if (message.includes('PASSWORD_TOO_SHORT')) return 'Use at least 8 characters.'
  if (message.includes('OWNER_PASSWORD_SELF_SERVICE'))
    return 'The owner password is changed from the owner’s own account, above.'
  if (message.includes('USER_NOT_FOUND')) return 'That account no longer exists.'
  if (message.includes('NOT_AUTHENTICATED')) return 'You are signed out. Sign in again.'
  return message
}

/**
 * Changes the signed-in user's own password.
 *
 * The current password is verified first, by signing in with it. Supabase does
 * not require that — an open session is enough to call `updateUser` — but the
 * desktop machine sits unattended at the counter all day, and without the
 * check anyone walking past could take the owner account. This is the same
 * argument, and the same technique, as `lib/auth/ownerGate.tsx`.
 */
export function useChangeOwnPassword() {
  return useMutation({
    mutationFn: async ({
      email,
      currentPassword,
      newPassword,
    }: {
      email: string
      currentPassword: string
      newPassword: string
    }) => {
      const supabase = createClient()

      const { error: reauth } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      })
      if (reauth) {
        throw new Error(
          reauth.message.toLowerCase().includes('invalid')
            ? 'Your current password is not correct.'
            : reauth.message
        )
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        throw new Error(
          error.message.toLowerCase().includes('should be different')
            ? 'That is already your password. Choose a different one.'
            : error.message
        )
      }
    },
  })
}

/** Owner-only: sets the cashier account's password. */
export function useSetAccountPassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      const supabase = createClient()
      const { error } = await supabase.rpc('set_account_password', {
        p_user_id: userId,
        p_new_password: newPassword,
      })
      if (error) throw new Error(readableRpcError(error.message))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  })
}
