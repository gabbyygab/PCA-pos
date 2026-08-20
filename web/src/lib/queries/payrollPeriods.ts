'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { payrollKey } from '@/lib/queries/payroll'
import { toDateKey, weekStart } from '@shared/lib/payroll'
import type { Tables } from '@shared/types/database'

/**
 * Every payroll period on record, newest first.
 *
 * The week view alone cannot tell the owner whether an *earlier* week is still
 * unpaid — it only ever loads the week being looked at. Paying a later week
 * first is how a crew ends up with a skipped week nobody notices, so the tab
 * needs the whole ledger to warn against it.
 */
export function usePayrollPeriods() {
  return useQuery({
    queryKey: [...payrollKey, 'periods'],
    queryFn: async (): Promise<Tables<'payroll_periods'>[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('payroll_periods')
        .select('*')
        .order('week_start', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** The Monday of the first week that has sales but no finalized period. */
export interface OldestOpenWeek {
  weekStartKey: string
  /** True when that week is strictly before the one being viewed. */
  isBefore: boolean
}

/**
 * The earliest week that still has unpaid sales, if it sits before `anchor`.
 *
 * A week counts as unpaid when sales exist inside it and no finalized period
 * covers it. Reads the earliest non-voided sale rather than assuming payroll
 * started with the app, so a shop that backfills sales still gets warned.
 */
export function useOldestUnpaidWeek(anchor: Date) {
  const anchorKey = toDateKey(weekStart(anchor))

  return useQuery({
    queryKey: [...payrollKey, 'oldest-unpaid', anchorKey],
    queryFn: async (): Promise<OldestOpenWeek | null> => {
      const supabase = createClient()

      const { data: firstSale, error: saleError } = await supabase
        .from('sales')
        .select('sold_at')
        .is('voided_at', null)
        .order('sold_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (saleError) throw saleError
      if (!firstSale?.sold_at) return null

      const { data: periods, error: periodError } = await supabase
        .from('payroll_periods')
        .select('week_start, status')
        .eq('status', 'finalized')
      if (periodError) throw periodError

      const finalized = new Set((periods ?? []).map((p) => p.week_start))

      // Walk Monday by Monday from the first sale up to (not including) the
      // week being viewed. The first gap is the one worth warning about.
      const cursor = weekStart(new Date(firstSale.sold_at))
      const limit = weekStart(anchor)

      while (cursor < limit) {
        const key = toDateKey(cursor)
        if (!finalized.has(key)) {
          // Only warn when that week actually had sales — a shop closed for a
          // holiday week owes nobody anything.
          const weekEndExclusiveDate = new Date(cursor)
          weekEndExclusiveDate.setDate(weekEndExclusiveDate.getDate() + 7)

          const { count, error } = await supabase
            .from('sales')
            .select('id', { count: 'exact', head: true })
            .is('voided_at', null)
            .gte('sold_at', cursor.toISOString())
            .lt('sold_at', weekEndExclusiveDate.toISOString())
          if (error) throw error

          if ((count ?? 0) > 0) {
            return { weekStartKey: key, isBefore: true }
          }
        }
        cursor.setDate(cursor.getDate() + 7)
      }

      return null
    },
  })
}
