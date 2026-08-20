'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toDateKey, weekEndExclusive, weekStart } from '@shared/lib/payroll'
import type { Tables } from '@shared/types/database'

export const payrollKey = ['payroll'] as const

export interface EmployeeWeek {
  employeeId: string
  name: string
  salesCount: number
  grossCentavos: number
  commissionCentavos: number
}

export interface PayrollWeek {
  period: Tables<'payroll_periods'> | null
  slips: Tables<'payroll_slips'>[]
  live: EmployeeWeek[]
}

/**
 * A finalized week reads from its slips; an open week is computed live from
 * sale_items. That is the whole point of the snapshot — finalized totals must
 * not drift when a past sale or a rate is edited.
 */
export function usePayrollWeek(anchor: Date) {
  const start = weekStart(anchor)
  const startKey = toDateKey(start)

  return useQuery({
    queryKey: [...payrollKey, 'week', startKey],
    queryFn: async (): Promise<PayrollWeek> => {
      const supabase = createClient()

      const { data: period, error: periodError } = await supabase
        .from('payroll_periods')
        .select('*')
        .eq('week_start', startKey)
        .maybeSingle()
      if (periodError) throw periodError

      let slips: Tables<'payroll_slips'>[] = []
      if (period?.status === 'finalized') {
        const { data, error } = await supabase
          .from('payroll_slips')
          .select('*')
          .eq('period_id', period.id)
          .order('employee_name')
        if (error) throw error
        slips = data ?? []
      }

      // Read the per-employee shares, not sale_items.commission_centavos --
      // that column is now what the whole crew was paid for the line.
      const { data: items, error: itemsError } = await supabase
        .from('sale_item_commissions')
        .select(
          'employee_id, sale_id, commission_centavos, employees (name), sale_items!inner (line_total_centavos), sales!inner (sold_at, voided_at)'
        )
        .gte('sales.sold_at', start.toISOString())
        .lt('sales.sold_at', weekEndExclusive(anchor).toISOString())
        .is('sales.voided_at', null)
      if (itemsError) throw itemsError

      const byEmployee = new Map<string, EmployeeWeek & { saleIds: Set<string> }>()
      for (const item of items ?? []) {
        const row = item as unknown as {
          employee_id: string
          sale_id: string
          commission_centavos: number
          sale_items: { line_total_centavos: number } | null
          employees: { name: string } | null
        }
        const existing = byEmployee.get(row.employee_id) ?? {
          employeeId: row.employee_id,
          name: row.employees?.name ?? 'Unknown',
          salesCount: 0,
          grossCentavos: 0,
          commissionCentavos: 0,
          saleIds: new Set<string>(),
        }
        // Gross credits each crew member the full line: it measures the work
        // done on the car, while only the commission is split.
        existing.grossCentavos += row.sale_items?.line_total_centavos ?? 0
        existing.commissionCentavos += row.commission_centavos
        existing.saleIds.add(row.sale_id)
        byEmployee.set(row.employee_id, existing)
      }

      const live = [...byEmployee.values()]
        .map(({ saleIds, ...rest }) => ({ ...rest, salesCount: saleIds.size }))
        .sort((a, b) => b.commissionCentavos - a.commissionCentavos)

      return { period: period ?? null, slips, live }
    },
  })
}

export function useFinalizeWeek() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (anchor: Date) => {
      const supabase = createClient()
      const { error } = await supabase.rpc('finalize_payroll_period', {
        p_week_start: toDateKey(weekStart(anchor)),
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: payrollKey }),
  })
}

export function useReopenWeek() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: string) => {
      const supabase = createClient()
      const { error } = await supabase.rpc('reopen_payroll_period', { p_period_id: periodId })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: payrollKey }),
  })
}
