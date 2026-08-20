'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { weekStart } from '@shared/lib/payroll'
import type { SizeLabel, VehicleClass } from '@shared/lib/domain'
import type { Tables } from '@shared/types/database'

export type Employee = Tables<'employees'>

export const employeesKey = ['employees'] as const

export function useEmployees() {
  return useQuery({
    queryKey: employeesKey,
    queryFn: async (): Promise<Employee[]> => {
      const supabase = createClient()
      const { data, error } = await supabase.from('employees').select('*').order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const supabase = createClient()
      const { error } = await supabase.from('employees').insert({ name: name.trim() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: employeesKey }),
  })
}

export function useUpdateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; is_active?: boolean }) => {
      const { id, ...patch } = input
      const supabase = createClient()
      const { error } = await supabase.from('employees').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: employeesKey }),
  })
}

/**
 * Permanently remove an employee.
 *
 * Only ever succeeds for someone with no history at all. Every table that
 * references `employees` does so with RESTRICT / NO ACTION, because deleting a
 * name out from under a sale would orphan revenue history and any finalized
 * payslip that already paid them. Archiving is the tool for someone who left;
 * this is for a row created by mistake.
 */
export function useDeleteEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient()
      const { error } = await supabase.from('employees').delete().eq('id', id)
      if (error) {
        // 23503 is foreign_key_violation: a sale, payslip, or adjustment still
        // points at them. The pre-check catches this first in the normal case;
        // this covers a row that landed between the check and the delete.
        if (error.code === '23503') {
          throw new Error(
            'This employee has recorded sales or payroll history, which cannot be deleted. Archive them instead.'
          )
        }
        throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: employeesKey }),
  })
}

/**
 * Every table that points at `employees`, each with the phrase the UI uses to
 * say what is holding the row down.
 *
 * All five constraints are RESTRICT / NO ACTION in Postgres, so any one of them
 * refuses the delete. Checking only `sale_item_commissions` used to let someone
 * with a payslip or an adjustment — but no commission row, which is what a
 * finalized week of pure adjustments looks like — reach a Delete button that
 * then failed with a raw foreign-key error.
 */
const EMPLOYEE_REFERENCES = [
  { table: 'sale_item_commissions', noun: 'commission on a sale' },
  { table: 'sales', noun: 'sale' },
  { table: 'sale_items', noun: 'service line' },
  { table: 'payroll_slips', noun: 'payslip' },
  { table: 'payroll_adjustments', noun: 'payroll adjustment' },
] as const

export interface EmployeeDeletable {
  deletable: boolean
  /** What is holding them down, phrased for the confirm dialog. */
  blockedBy: string[]
}

/**
 * Whether an employee can be deleted at all — i.e. nothing references them.
 * Lets the UI say so up front, and say *why*, instead of offering a button that
 * always fails.
 */
export function useEmployeeDeletable(employeeId: string | null) {
  return useQuery({
    queryKey: [...employeesKey, 'deletable', employeeId],
    enabled: employeeId !== null,
    queryFn: async (): Promise<EmployeeDeletable> => {
      const supabase = createClient()

      const results = await Promise.all(
        EMPLOYEE_REFERENCES.map(async ({ table, noun }) => {
          const { count, error } = await supabase
            .from(table)
            .select('employee_id', { count: 'exact', head: true })
            .eq('employee_id', employeeId!)
          if (error) throw error
          return { noun, count: count ?? 0 }
        })
      )

      const blockedBy = results
        .filter((r) => r.count > 0)
        .map((r) => (r.count === 1 ? `1 ${r.noun}` : `${r.count} ${r.noun}s`))

      return { deletable: blockedBy.length === 0, blockedBy }
    },
  })
}

// ---------------------------------------------------------------------------
// Per-employee detail
// ---------------------------------------------------------------------------

/** How far back the detail panel looks. Wide enough for month-over-month feel. */
const DETAIL_WINDOW_DAYS = 90

export interface EmployeeSale {
  saleId: string
  receiptNo: number
  soldAt: string
  plateNumber: string | null
  vehicleClass: VehicleClass
  size: SizeLabel
  /** Only the lines this employee is credited on. */
  services: string[]
  /** Gross of those lines, not necessarily the whole ticket. */
  grossCentavos: number
  commissionCentavos: number
}

export interface EmployeeStatsBucket {
  salesCount: number
  grossCentavos: number
  commissionCentavos: number
}

export interface EmployeeStats {
  today: EmployeeStatsBucket
  week: EmployeeStatsBucket
  month: EmployeeStatsBucket
  window: EmployeeStatsBucket
  /** Average cut per car worked, over the whole window. */
  averageCutCentavos: number
  averageTicketCentavos: number
  topServices: { name: string; count: number; commissionCentavos: number }[]
  bySize: { size: SizeLabel; count: number }[]
  /** Weekday name -> cars worked, for spotting who covers the weekend. */
  byWeekday: { label: string; salesCount: number }[]
  lastSoldAt: string | null
  recentSales: EmployeeSale[]
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function emptyBucket(): EmployeeStatsBucket {
  return { salesCount: 0, grossCentavos: 0, commissionCentavos: 0 }
}

/**
 * Everything the Employees tab shows when a row is opened. Commission is read
 * off the sale line, never recomputed — a rate edited in Settings must not
 * rewrite what someone already earned.
 */
export function useEmployeeStats(employeeId: string | null) {
  return useQuery({
    queryKey: [...employeesKey, 'stats', employeeId],
    enabled: employeeId !== null,
    queryFn: async (): Promise<EmployeeStats> => {
      const supabase = createClient()

      const since = new Date()
      since.setHours(0, 0, 0, 0)
      since.setDate(since.getDate() - (DETAIL_WINDOW_DAYS - 1))

      // Read this employee's crew share, not sale_items.commission_centavos --
      // that column is what the whole crew was paid for the line.
      const { data, error } = await supabase
        .from('sale_item_commissions')
        .select(
          'sale_id, commission_centavos, sale_items!inner (service_name, size, line_total_centavos), sales!inner (receipt_no, sold_at, plate_number, vehicle_class, voided_at)'
        )
        .eq('employee_id', employeeId!)
        .gte('sales.sold_at', since.toISOString())
        .is('sales.voided_at', null)
      if (error) throw error

      type Row = {
        sale_id: string
        commission_centavos: number
        sale_items: {
          service_name: string
          size: SizeLabel
          line_total_centavos: number
        } | null
        sales: {
          receipt_no: number
          sold_at: string
          plate_number: string | null
          vehicle_class: VehicleClass
        } | null
      }
      const rows = (data ?? []) as unknown as Row[]

      // Roll lines up into the sale they belong to — the shop counts cars, not
      // line items, and one car can carry a package plus two add-ons.
      const sales = new Map<string, EmployeeSale>()
      const services = new Map<string, { count: number; commissionCentavos: number }>()

      for (const row of rows) {
        if (!row.sales || !row.sale_items) continue
        const line = row.sale_items

        const sale = sales.get(row.sale_id) ?? {
          saleId: row.sale_id,
          receiptNo: row.sales.receipt_no,
          soldAt: row.sales.sold_at,
          plateNumber: row.sales.plate_number,
          vehicleClass: row.sales.vehicle_class,
          size: line.size,
          services: [],
          grossCentavos: 0,
          commissionCentavos: 0,
        }
        sale.services.push(line.service_name)
        // Gross credits the full line: it measures the work done on the car,
        // while only the commission is split across the crew.
        sale.grossCentavos += line.line_total_centavos
        sale.commissionCentavos += row.commission_centavos
        sales.set(row.sale_id, sale)

        const service = services.get(line.service_name) ?? { count: 0, commissionCentavos: 0 }
        service.count += 1
        service.commissionCentavos += row.commission_centavos
        services.set(line.service_name, service)
      }

      const ordered = [...sales.values()].sort(
        (a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime()
      )

      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const startOfWeek = weekStart(new Date())
      const startOfMonth = new Date()
      startOfMonth.setHours(0, 0, 0, 0)
      startOfMonth.setDate(startOfMonth.getDate() - 29)

      const today = emptyBucket()
      const week = emptyBucket()
      const month = emptyBucket()
      const window = emptyBucket()
      const sizes = new Map<SizeLabel, number>()
      const weekdays = new Array<number>(7).fill(0)

      for (const sale of ordered) {
        const at = new Date(sale.soldAt)
        const add = (bucket: EmployeeStatsBucket) => {
          bucket.salesCount += 1
          bucket.grossCentavos += sale.grossCentavos
          bucket.commissionCentavos += sale.commissionCentavos
        }
        add(window)
        if (at >= startOfMonth) add(month)
        if (at >= startOfWeek) add(week)
        if (at >= startOfToday) add(today)

        sizes.set(sale.size, (sizes.get(sale.size) ?? 0) + 1)
        // getDay(): 0 = Sunday. Shift so the row reads Monday-first like payroll.
        weekdays[(at.getDay() + 6) % 7] += 1
      }

      return {
        today,
        week,
        month,
        window,
        averageCutCentavos: window.salesCount
          ? Math.round(window.commissionCentavos / window.salesCount)
          : 0,
        averageTicketCentavos: window.salesCount
          ? Math.round(window.grossCentavos / window.salesCount)
          : 0,
        topServices: [...services.entries()]
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.count - a.count || b.commissionCentavos - a.commissionCentavos)
          .slice(0, 5),
        bySize: [...sizes.entries()]
          .map(([size, count]) => ({ size, count }))
          .sort((a, b) => b.count - a.count),
        byWeekday: weekdays.map((salesCount, i) => ({ label: WEEKDAY_LABELS[i], salesCount })),
        lastSoldAt: ordered[0]?.soldAt ?? null,
        recentSales: ordered.slice(0, 15),
      }
    },
    staleTime: 60 * 1000,
  })
}
