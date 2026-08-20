'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { SessionProvider } from '@/lib/auth/session'
import { OwnerGateProvider } from '@/lib/auth/ownerGate'

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The shop runs on one machine; refetching on every focus just
            // makes the POS flicker between rings.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <OwnerGateProvider>
          <ToastProvider>{children}</ToastProvider>
        </OwnerGateProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}
