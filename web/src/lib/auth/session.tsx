'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

interface SessionState {
  session: Session | null
  /** True until the stored session has been read back from local storage. */
  loading: boolean
  /** Reads `app_metadata.role` off the JWT — the same claim RLS checks. */
  isOwner: boolean
  email: string | null
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    // Restoring from local storage is async, so the gate has to wait for it —
    // otherwise the login screen flashes on every launch.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    // Fires on sign-in, sign-out, and every silent token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const value = useMemo<SessionState>(() => {
    const role = (session?.user.app_metadata as { role?: string } | undefined)?.role
    return {
      session,
      loading,
      isOwner: role === 'owner',
      email: session?.user.email ?? null,
      signOut: async () => {
        await createClient().auth.signOut()
      },
    }
  }, [session, loading])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
