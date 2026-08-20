'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { dayKeyOf } from '@/lib/queries/reports'

export const attentionKey = ['attention'] as const

export interface DayAttention {
  /** Lines still to be worked — the count the crew burns down. */
  pending: number
  /** Lines given back today. Money already left the till. */
  refunded: number
  /** pending + refunded: everything on the Services tab wanting a look. */
  total: number
  /** Newest line's timestamp, used to decide whether anything is unseen. */
  latestAt: string | null
}

/**
 * What the Services tab would show as needing attention today.
 *
 * Counted server-side with `head: true` rather than by loading the day's
 * tickets: the sidebar renders on every tab, and it only needs three numbers.
 * A cashier's RLS reaches only today, which is exactly this window, so the
 * badge shows them the same figure the tab will.
 */
export function useDayAttention() {
  const dayKey = dayKeyOf(new Date())

  return useQuery({
    queryKey: [...attentionKey, dayKey],
    // The lot changes while the owner is on another tab, so this is the one
    // query that polls; everything else refetches on its own mutations.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<DayAttention> => {
      const supabase = createClient()
      const start = new Date(`${dayKey}T00:00:00`)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)

      // `sale_items` carries no timestamp of its own that is filterable here,
      // so the window is applied through the parent sale.
      const range = (q: ReturnType<typeof baseQuery>) =>
        q
          .gte('sales.sold_at', start.toISOString())
          .lt('sales.sold_at', end.toISOString())

      function baseQuery() {
        return supabase
          .from('sale_items')
          .select('id, sales!inner(sold_at, voided_at)', { count: 'exact', head: true })
      }

      const [pendingRes, refundedRes, latestRes] = await Promise.all([
        range(baseQuery()).eq('status', 'pending').is('sales.voided_at', null),
        range(baseQuery()).eq('status', 'refunded').is('sales.voided_at', null),
        supabase
          .from('sale_items')
          .select('created_at, sales!inner(sold_at, voided_at)')
          .gte('sales.sold_at', start.toISOString())
          .lt('sales.sold_at', end.toISOString())
          .is('sales.voided_at', null)
          .order('created_at', { ascending: false })
          .limit(1),
      ])

      if (pendingRes.error) throw pendingRes.error
      if (refundedRes.error) throw refundedRes.error
      if (latestRes.error) throw latestRes.error

      const pending = pendingRes.count ?? 0
      const refunded = refundedRes.count ?? 0
      const latest = (latestRes.data ?? [])[0] as { created_at: string } | undefined

      return {
        pending,
        refunded,
        total: pending + refunded,
        latestAt: latest?.created_at ?? null,
      }
    },
  })
}

const SEEN_STORAGE_KEY = 'pca.services.seenAt'

/**
 * Local storage as an external store.
 *
 * `useSyncExternalStore` rather than an effect that calls `setState`: the value
 * is owned outside React, and reading it in an effect would cascade a second
 * render on every mount. The server snapshot is `null` because a static export
 * prerenders this component where `window` does not exist.
 */
const seenStore = {
  subscribe(onChange: () => void) {
    // Another tab or window marking the record seen should settle this one too.
    window.addEventListener('storage', onChange)
    window.addEventListener('pca:seen', onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener('pca:seen', onChange)
    }
  },
  getSnapshot(): string | null {
    try {
      return window.localStorage.getItem(SEEN_STORAGE_KEY)
    } catch {
      // A locked-down webview can refuse storage; the dot just never shows.
      return null
    }
  },
  getServerSnapshot(): string | null {
    return null
  },
}

/**
 * Tracks whether anything landed since the tab was last opened.
 *
 * Deliberately local to the device: "have *I* looked at this yet" is a property
 * of the person at the screen, not of the sale, so it must not be written back
 * to a table the other client would read. The count in the badge is the shared
 * truth; this only decides whether it also pulses.
 */
export function useSeenMarker(latestAt: string | null) {
  const seenAt = useSyncExternalStore(
    seenStore.subscribe,
    seenStore.getSnapshot,
    seenStore.getServerSnapshot
  )

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(SEEN_STORAGE_KEY, new Date().toISOString())
      // `storage` only fires in *other* documents, so this one is told directly.
      window.dispatchEvent(new Event('pca:seen'))
    } catch {
      /* see getSnapshot */
    }
  }, [])

  // Never seen before means everything is unseen only if there is something
  // there at all — a first run on an empty day should stay quiet.
  const hasUnseen = latestAt !== null && (seenAt === null || latestAt > seenAt)

  return { hasUnseen, markSeen }
}
