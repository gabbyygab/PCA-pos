import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AppState } from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

interface SessionState {
  session: Session | null
  /** True until the stored session has been read back from AsyncStorage. */
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

    // Reading AsyncStorage is async, so the gate waits for it — otherwise the
    // login screen flashes on every cold start.
    //
    // The catch is not optional. `getSession` rejects on a corrupt or
    // unreadable stored session, and without a rejection path `loading` would
    // stay true forever — the app would hang on the boot screen with no way
    // out, on the one device the shop rings up every sale on. Failing to "no
    // session" instead lands the cashier on the login screen, which is
    // recoverable by signing in.
    let alive = true
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive) setSession(data.session)
      })
      .catch(() => {
        // Nothing to report: a failed read is indistinguishable from never
        // having signed in, and the login screen says that already.
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })

    /**
     * Unlike a browser tab, a backgrounded native app is frozen: the refresh
     * timer stops and the access token can expire while the phone is in a
     * pocket. supabase-js expects the host to drive this, so refreshing is
     * bound to foreground state — without it the first sale after a break
     * fails on an expired token.
     */
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh()
      else supabase.auth.stopAutoRefresh()
    })

    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh()

    return () => {
      alive = false
      sub.subscription.unsubscribe()
      appState.remove()
    }
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
