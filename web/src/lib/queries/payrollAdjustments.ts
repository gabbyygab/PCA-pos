'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { payrollKey } from '@/lib/queries/payroll'
import { toDateKey, weekStart } from '@shared/lib/payroll'
import type { Tables } from '@shared/types/database'

/**
 * Manual bonuses and deductions on a week's pay.
 *
 * Keyed on the Monday rather than on a payroll period, because adjustments are
 * routinely entered mid-week — before any period row exists. Finalizing the
 * week then snapshots whatever is on record.
 */

export interface AdjustmentInput {
  weekStart: Date
  employeeId: string
  /** Signed centavos: positive is a bonus, negative a deduction. */
  amountCentavos: number
  reason: string
}

export function adjustmentsKey(startKey: string) {
  return [...payrollKey, 'adjustments', startKey] as const
}

export function usePayrollAdjustments(anchor: Date, enabled = true) {
  const startKey = toDateKey(weekStart(anchor))

  return useQuery({
    queryKey: adjustmentsKey(startKey),
    enabled,
    queryFn: async (): Promise<Tables<'payroll_adjustments'>[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('payroll_adjustments')
        .select('*')
        .eq('week_start', startKey)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * Every mutation here invalidates the whole payroll key, not just the
 * adjustments list: the week view, the slip detail, and the export all read
 * these numbers, and a stale total on a payout screen is worse than a refetch.
 */
function useInvalidatePayroll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: payrollKey })
}

export function useCreateAdjustment() {
  const invalidate = useInvalidatePayroll()
  return useMutation({
    mutationFn: async (input: AdjustmentInput) => {
      const supabase = createClient()

      // Stamped from the session so the ledger names a person, not just a uuid
      // that later has to be resolved against auth.users.
      const { data: auth } = await supabase.auth.getUser()

      const { error } = await supabase.from('payroll_adjustments').insert({
        week_start: toDateKey(weekStart(input.weekStart)),
        employee_id: input.employeeId,
        amount_centavos: input.amountCentavos,
        reason: input.reason.trim(),
        created_by_email: auth.user?.email ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useUpdateAdjustment() {
  const invalidate = useInvalidatePayroll()
  return useMutation({
    mutationFn: async (input: { id: string; amountCentavos: number; reason: string }) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('payroll_adjustments')
        .update({
          amount_centavos: input.amountCentavos,
          reason: input.reason.trim(),
        })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteAdjustment() {
  const invalidate = useInvalidatePayroll()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient()
      const { error } = await supabase.from('payroll_adjustments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
