'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/lib/auth/session'

/**
 * Re-authentication for actions that move money.
 *
 * RLS is the real boundary — `payroll_adjustments` is owner-only in Postgres,
 * and nothing here can grant a cashier access they don't already have. What
 * this adds is protection against the app being *left open*: the desktop
 * machine sits at the counter all day under one owner login, so "is the owner
 * signed in" and "is the owner standing here right now" are different
 * questions. Editing someone's pay needs the second one answered.
 *
 * The password is verified by Supabase, not compared locally: there is no
 * second secret to store, and a wrong guess is rejected by the same auth
 * server that issued the session.
 */

/**
 * How long one unlock lasts. Long enough to enter a batch of adjustments in
 * one sitting, short enough that walking away re-locks it before the next
 * person reaches the keyboard.
 */
const UNLOCK_MS = 5 * 60 * 1000

interface OwnerGateState {
  unlocked: boolean
  /** Epoch ms the unlock expires, or null when locked. */
  expiresAt: number | null
  /** Verifies the password and unlocks. Throws with a readable message. */
  unlock: (password: string) => Promise<void>
  lock: () => void
}

const OwnerGateContext = createContext<OwnerGateState | null>(null)

export function useOwnerGate() {
  const ctx = useContext(OwnerGateContext)
  if (!ctx) throw new Error('useOwnerGate must be used inside <OwnerGateProvider>')
  return ctx
}

export function OwnerGateProvider({ children }: { children: ReactNode }) {
  const { email, isOwner } = useSession()
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lock = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setExpiresAt(null)
  }, [])

  // Re-lock on a timer rather than only checking on use, so the unlocked
  // affordances visibly disappear instead of failing when clicked.
  useEffect(() => {
    if (expiresAt === null) return
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) {
      lock()
      return
    }
    timer.current = setTimeout(lock, remaining)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [expiresAt, lock])

  // Signing out, or losing the owner role, drops the unlock immediately.
  useEffect(() => {
    if (!isOwner) lock()
  }, [isOwner, lock])

  const unlock = useCallback(
    async (password: string) => {
      if (!email) throw new Error('No one is signed in.')
      if (!password) throw new Error('Enter the owner password.')

      /*
       * `signInWithPassword` on the already-signed-in account is the check.
       * It returns a fresh session for the same user on success, so the app
       * carries on uninterrupted; on failure the current session is untouched
       * and the error comes from Supabase rather than from a local comparison.
       */
      const { error } = await createClient().auth.signInWithPassword({ email, password })

      if (error) {
        throw new Error(
          error.message.toLowerCase().includes('invalid')
            ? 'That password is not correct.'
            : error.message
        )
      }

      setExpiresAt(Date.now() + UNLOCK_MS)
    },
    [email]
  )

  const value = useMemo<OwnerGateState>(
    () => ({
      unlocked: expiresAt !== null,
      expiresAt,
      unlock,
      lock,
    }),
    [expiresAt, unlock, lock]
  )

  return <OwnerGateContext.Provider value={value}>{children}</OwnerGateContext.Provider>
}

/** Minutes:seconds left on the unlock, for the badge in the payroll header. */
export function useUnlockCountdown(expiresAt: number | null): string | null {
  const [, tick] = useState(0)

  useEffect(() => {
    if (expiresAt === null) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  if (expiresAt === null) return null
  const remaining = Math.max(0, expiresAt - Date.now())
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
