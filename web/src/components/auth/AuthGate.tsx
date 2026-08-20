'use client'

import type { ReactNode } from 'react'
import { useSession } from '@/lib/auth/session'
import { BootScreen } from '@/components/auth/BootScreen'
import { LoginScreen } from '@/components/auth/LoginScreen'

/**
 * Holds the dashboard back until a session exists.
 *
 * This is not only a permission boundary: mounting the tabs without a session
 * fires every catalog and roster query as `anon`, which RLS answers with empty
 * rows — the UI would render "no employees" instead of "not signed in".
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useSession()

  if (loading) return <BootScreen />

  if (!session) return <LoginScreen />

  return <>{children}</>
}
