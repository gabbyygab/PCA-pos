'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { payrollKey } from '@/lib/queries/payroll'
import { toDateKey, weekEndExclusive, weekStart } from '@shared/lib/payroll'
import type { ServiceStatus, SizeLabel } from '@shared/lib/domain'
import type { Tables } from '@shared/types/database'

/**
 * The line-level backing for a payroll slip.
 *
 * The week view only needs per-employee totals, but a slip an employee is
 * handed has to show *which cars* those totals came from — the date, the car,
 * the service, and how many people split the cut. Without that a slip is an
 * unauditable number and the crew has no way to check it.
 */
export interface PayrollLine {
  saleId: string
  receiptNo: number
  /** ISO instant of the sale, so the slip can be grouped and sorted by day. */
  soldAt: string
  /** `YYYY-MM-DD` local — the day bucket this line is paid under. */
  dateKey: string
  serviceName: string
  size: SizeLabel
  plateNumber: string | null
  /** What was charged for the line, whatever became of it afterwards. */
  lineTotalCentavos: number
  /** The charged price once the line is `done`, else 0 — what gross sums. */
  effectiveTotalCentavos: number
  /**
   * This employee's share only, not the crew's whole commission — and already
   * reversed to 0 unless the line is `done`, matching what the finalizer pays.
   */
  commissionCentavos: number
  /**
   * The line's own status, so a slip can show a refunded or still-pending car
   * rather than silently dropping it. A line that earned nothing still explains
   * why the week's total is what it is.
   */
  status: ServiceStatus
  crewSize: number
}

export interface EmployeePayrollDetail {
  employeeId: string
  name: string
  lines: PayrollLine[]
  salesCount: number
  grossCentavos: number
  commissionCentavos: number
  /** Commission per day, Monday first — the shape the slip prints. */
  byDay: { dateKey: string; commissionCentavos: number; salesCount: number }[]
  /**
   * Signed sum of manual bonuses and deductions for the week. Absent on the
   * raw query — the Payroll tab attaches it, reading the frozen slip figure
   * for a finalized week and the live ledger for an open one.
   */
  adjustmentCentavos?: number
  /**
   * The individual entries behind that sum, so a payslip can itemise them
   * with their reasons rather than printing one unexplained number.
   */
  adjustments?: Tables<'payroll_adjustments'>[]
}

function localDateKey(iso: string): string {
  return toDateKey(new Date(iso))
}

/**
 * Every commission share in the week, grouped per employee.
 *
 * Bounded by `sold_at` on the sale, exactly like `finalize_payroll_period` —
 * the two must agree or a printed slip would not match the finalized one.
 */
export function usePayrollDetail(anchor: Date, enabled = true) {
  const start = weekStart(anchor)
  const startKey = toDateKey(start)

  return useQuery({
    queryKey: [...payrollKey, 'detail', startKey],
    enabled,
    queryFn: async (): Promise<EmployeePayrollDetail[]> => {
      const supabase = createClient()

      const { data, error } = await supabase
        .from('sale_item_commissions')
        .select(
          'employee_id, sale_id, commission_centavos, crew_size, employees (name), sale_items!inner (service_name, size, line_total_centavos, effective_total_centavos, status), sales!inner (receipt_no, sold_at, plate_number, voided_at)'
        )
        .gte('sales.sold_at', start.toISOString())
        .lt('sales.sold_at', weekEndExclusive(anchor).toISOString())
        .is('sales.voided_at', null)
      if (error) throw error

      type Row = {
        employee_id: string
        sale_id: string
        commission_centavos: number
        crew_size: number
        employees: { name: string } | null
        sale_items: {
          service_name: string
          size: SizeLabel
          line_total_centavos: number
          effective_total_centavos: number
          status: ServiceStatus
        } | null
        sales: { receipt_no: number; sold_at: string; plate_number: string | null } | null
      }

      const byEmployee = new Map<string, EmployeePayrollDetail>()

      for (const row of (data ?? []) as unknown as Row[]) {
        if (!row.sales || !row.sale_items) continue

        const detail = byEmployee.get(row.employee_id) ?? {
          employeeId: row.employee_id,
          name: row.employees?.name ?? 'Unknown',
          lines: [],
          salesCount: 0,
          grossCentavos: 0,
          commissionCentavos: 0,
          byDay: [],
        }

        detail.lines.push({
          saleId: row.sale_id,
          receiptNo: row.sales.receipt_no,
          soldAt: row.sales.sold_at,
          dateKey: localDateKey(row.sales.sold_at),
          serviceName: row.sale_items.service_name,
          size: row.sale_items.size,
          plateNumber: row.sales.plate_number,
          lineTotalCentavos: row.sale_items.line_total_centavos,
          effectiveTotalCentavos: row.sale_items.effective_total_centavos,
          // Only finished work is paid. A generated column cannot reach across
          // to the line's status, so the reversal the `effective_` columns apply
          // to sale_items is applied to the crew share here -- the same rule
          // `finalize_payroll_period` applies through its join. Without it this
          // screen pays commission on refunded and not-yet-started work, and
          // disagrees with both the Payroll summary above it and the slip it
          // prints.
          commissionCentavos:
            row.sale_items.status === 'done' ? row.commission_centavos : 0,
          status: row.sale_items.status,
          crewSize: row.crew_size,
        })

        byEmployee.set(row.employee_id, detail)
      }

      const details = [...byEmployee.values()].map((detail) => {
        detail.lines.sort(
          (a, b) => a.soldAt.localeCompare(b.soldAt) || a.receiptNo - b.receiptNo
        )

        const days = new Map<string, { commissionCentavos: number; sales: Set<string> }>()
        const sales = new Set<string>()

        for (const line of detail.lines) {
          // Gross credits the full line to each crew member — it measures work
          // done on the car; only the commission is split. The `effective_`
          // column, matching what the finalizer sums: unfinished or refunded
          // work is not work delivered.
          detail.grossCentavos += line.effectiveTotalCentavos
          detail.commissionCentavos += line.commissionCentavos
          sales.add(line.saleId)

          const day = days.get(line.dateKey) ?? {
            commissionCentavos: 0,
            sales: new Set<string>(),
          }
          day.commissionCentavos += line.commissionCentavos
          day.sales.add(line.saleId)
          days.set(line.dateKey, day)
        }

        detail.salesCount = sales.size
        detail.byDay = [...days.entries()]
          .map(([dateKey, v]) => ({
            dateKey,
            commissionCentavos: v.commissionCentavos,
            salesCount: v.sales.size,
          }))
          .sort((a, b) => a.dateKey.localeCompare(b.dateKey))

        return detail
      })

      return details.sort((a, b) => b.commissionCentavos - a.commissionCentavos)
    },
  })
}
