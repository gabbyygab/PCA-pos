'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type {
  PaymentMethod,
  ServiceCategory,
  ServiceStatus,
  SizeLabel,
  VehicleClass,
} from '@shared/lib/domain'

export const reportsKey = ['reports'] as const

/**
 * How a report is narrowed beyond its date range.
 *
 * `payment` is `'all'` or one method. Kept as a discrete value rather than a
 * set because the question the owner asks is "how much of this was GCash",
 * one method at a time; a multi-select would make the tiles answer a question
 * nobody asked and the breakdown below already shows every method at once.
 */
export interface ReportFilters {
  payment: PaymentMethod | 'all'
}

export const NO_FILTERS: ReportFilters = { payment: 'all' }

/** The presets, plus `custom` for an owner-chosen span. */
export type ReportRange = '7d' | '30d' | '90d' | 'custom'

const RANGE_DAYS: Record<Exclude<ReportRange, 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

/**
 * An explicit, inclusive span of days.
 *
 * Kept as `YYYY-MM-DD` keys rather than Date objects so the value is stable in
 * a React Query key — two Dates for the same day are never `===`, which would
 * refetch on every render.
 */
export interface ReportDateRange {
  /** Inclusive first day, `YYYY-MM-DD` local. */
  from: string
  /** Inclusive last day, `YYYY-MM-DD` local. */
  to: string
}

function parseKey(key: string): Date {
  // Parsed as local midnight: a bare `YYYY-MM-DD` would be read as UTC and
  // shift the boundary by the Manila offset.
  return new Date(`${key}T00:00:00`)
}

export function dayKeyOf(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

/** The inclusive [start, endExclusive) instants a range covers. */
export function resolveRange(
  range: ReportRange,
  custom?: ReportDateRange
): { start: Date; endExclusive: Date; days: number; label: string } {
  if (range === 'custom' && custom) {
    const start = parseKey(custom.from)
    const last = parseKey(custom.to)
    const endExclusive = new Date(last)
    endExclusive.setDate(endExclusive.getDate() + 1)
    const days = Math.max(
      1,
      Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000)
    )
    return { start, endExclusive, days, label: `${custom.from} to ${custom.to}` }
  }

  const days = RANGE_DAYS[(range === 'custom' ? '30d' : range) as Exclude<ReportRange, 'custom'>]
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const endExclusive = new Date()
  endExclusive.setHours(0, 0, 0, 0)
  endExclusive.setDate(endExclusive.getDate() + 1)
  return { start, endExclusive, days, label: `Last ${days} days` }
}

export interface ReportData {
  grossCentavos: number
  /** Cars rung up in the range — `vehicle_class = 'car'`. */
  carCount: number
  /** Motorcycles rung up in the range. */
  motorcycleCount: number
  /**
   * Service lines still marked `pending` — work the crew has not closed out.
   * Counted across the range, so a stale line from Tuesday still shows.
   */
  pendingCount: number
  /** Service lines refunded, and what was handed back. */
  refundedCount: number
  refundedCentavos: number
  /**
   * What the pending lines would be worth once the crew closes them out.
   *
   * Not revenue — only a `done` line counts — but the owner still needs to see
   * the money standing on the lot, or a busy afternoon of unfinished work reads
   * as a dead day.
   */
  pendingCentavos: number
  /** Daily operating costs recorded in the range. Always positive. */
  expenseCentavos: number
  /**
   * Gross minus expenses — what the day actually left behind.
   *
   * Commission is deliberately NOT subtracted: the employee cut is carried by
   * the payroll ledger and read as its own tile, so taking it out here would
   * count it twice for an owner reading both screens.
   */
  netCentavos: number
  commissionCentavos: number
  salesCount: number
  averageTicketCentavos: number
  /** Days the range spans, so the cards can show a per-day rate. */
  days: number
  /** One point per day across the range, zero-filled so the line has no gaps. */
  daily: {
    date: string
    label: string
    grossCentavos: number
    expenseCentavos: number
    netCentavos: number
    salesCount: number
  }[]
  topServices: { name: string; category: ServiceCategory; grossCentavos: number; count: number }[]
  bySize: { size: SizeLabel; grossCentavos: number; count: number }[]
  byEmployee: { name: string; grossCentavos: number; commissionCentavos: number; salesCount: number }[]
  /** Expenses grouped by the name as typed, biggest first. */
  byExpense: { name: string; amountCentavos: number; count: number }[]
  /**
   * Gross split by how the customer paid, biggest first.
   *
   * Always computed across every method the range contains, even when the page
   * is filtered to one -- filtering to GCash and then reading a breakdown that
   * only lists GCash would be a tautology. The filter narrows the tiles; this
   * panel is what the filter is chosen from.
   */
  byPayment: { method: PaymentMethod; grossCentavos: number; salesCount: number }[]
}

/**
 * Today's numbers, independent of whatever range the page is filtered to.
 *
 * A separate query rather than a slice of the range result, because the range
 * can legitimately exclude today — a custom span ending last Friday, say — and
 * the owner still opens this page to ask "how are we doing right now". Deriving
 * it from `data.daily` would make today vanish exactly when the filter moved
 * off it. It reuses `useReports` with a one-day custom range, so the two read
 * the same maths and a refund reverses in both.
 */
export function useTodayReport(filters: ReportFilters = NO_FILTERS) {
  const key = dayKeyOf(new Date())
  return useReports('custom', { from: key, to: key }, filters)
}

export function useReports(
  range: ReportRange,
  custom?: ReportDateRange,
  filters: ReportFilters = NO_FILTERS
) {
  return useQuery({
    queryKey: [
      ...reportsKey,
      range,
      custom?.from ?? null,
      custom?.to ?? null,
      filters.payment,
    ],
    // A half-entered custom range would query a nonsense window.
    enabled: range !== 'custom' || Boolean(custom?.from && custom?.to),
    queryFn: async (): Promise<ReportData> => {
      const supabase = createClient()
      const { start: since, endExclusive, days } = resolveRange(range, custom)

      // The payment filter is applied to the embedded `sales` row rather than
      // in TypeScript, so a narrowed report is a smaller response rather than a
      // full one thrown away client-side.
      let itemQuery = supabase
        .from('sale_items')
        .select(
          'service_name, category, size, status, line_total_centavos, net_total_centavos, effective_total_centavos, commission_centavos, effective_commission_centavos, sale_id, sales!inner (sold_at, voided_at, vehicle_class, payment_method)'
        )
        .gte('sales.sold_at', since.toISOString())
        .lt('sales.sold_at', endExclusive.toISOString())
        .is('sales.voided_at', null)
      if (filters.payment !== 'all') {
        itemQuery = itemQuery.eq('sales.payment_method', filters.payment)
      }
      const { data, error } = await itemQuery
      if (error) throw error

      // Per-employee numbers come from the crew shares. A car worked by three
      // people owes each of them a share, so grouping sale_items by its lead
      // employee would credit one person for the whole crew's work.
      let crewQuery = supabase
        .from('sale_item_commissions')
        .select(
          'commission_centavos, sale_id, employees (name), sale_items!inner (line_total_centavos, effective_total_centavos, status), sales!inner (sold_at, voided_at, payment_method)'
        )
        .gte('sales.sold_at', since.toISOString())
        .lt('sales.sold_at', endExclusive.toISOString())
        .is('sales.voided_at', null)
      if (filters.payment !== 'all') {
        crewQuery = crewQuery.eq('sales.payment_method', filters.payment)
      }
      const { data: crewData, error: crewError } = await crewQuery
      if (crewError) throw crewError

      // The payment breakdown is deliberately NOT narrowed by `filters.payment`:
      // it is the panel the filter is chosen from, so it always describes the
      // whole range. Read off `sales` rather than the line rows above because a
      // ticket has one payment method however many services are on it.
      const { data: paymentData, error: paymentError } = await supabase
        .from('sales')
        .select('id, payment_method, sale_items (effective_total_centavos)')
        .gte('sold_at', since.toISOString())
        .lt('sold_at', endExclusive.toISOString())
        .is('voided_at', null)
      if (paymentError) throw paymentError

      // Expenses are keyed on a plain `spent_on` date, not a timestamp, so the
      // span is filtered with day keys rather than the instants used above.
      const { data: expenseData, error: expenseError } = await supabase
        .from('expenses')
        .select('spent_on, name, amount_centavos')
        .gte('spent_on', dayKeyOf(since))
        // `endExclusive` is the day after the last one in range, so step back
        // one day to get an inclusive upper bound.
        .lte('spent_on', dayKeyOf(new Date(endExclusive.getTime() - 86_400_000)))
      if (expenseError) throw expenseError

      type CrewRow = {
        commission_centavos: number
        sale_id: string
        employees: { name: string } | null
        sale_items: {
          line_total_centavos: number
          effective_total_centavos: number
          status: ServiceStatus
        } | null
      }
      const crewRows = (crewData ?? []) as unknown as CrewRow[]

      type Row = {
        service_name: string
        category: ServiceCategory
        size: SizeLabel
        status: ServiceStatus
        line_total_centavos: number
        /** What the customer owes: line_total less any promo. */
        net_total_centavos: number
        /** The charged price once the line is `done`, else 0 — what every total below sums. */
        effective_total_centavos: number
        commission_centavos: number
        effective_commission_centavos: number
        sale_id: string
        sales: {
          sold_at: string
          vehicle_class: VehicleClass
          payment_method: PaymentMethod
        } | null
      }
      const rows = (data ?? []) as unknown as Row[]

      let grossCentavos = 0
      let commissionCentavos = 0
      let pendingCount = 0
      let pendingCentavos = 0
      let refundedCount = 0
      let refundedCentavos = 0
      const saleIds = new Set<string>()
      // Counted as sets of sale ids, not of lines: a car with four services is
      // one car served, not four.
      const carSales = new Set<string>()
      const motorcycleSales = new Set<string>()
      const daily = new Map<
        string,
        { grossCentavos: number; expenseCentavos: number; sales: Set<string> }
      >()
      const services = new Map<string, { category: ServiceCategory; grossCentavos: number; count: number }>()
      const sizes = new Map<SizeLabel, { grossCentavos: number; sales: Set<string> }>()
      const employees = new Map<string, { grossCentavos: number; commissionCentavos: number; sales: Set<string> }>()

      // Zero-fill every day so a quiet Tuesday reads as zero, not as a gap.
      for (let i = 0; i < days; i += 1) {
        const d = new Date(since)
        d.setDate(d.getDate() + i)
        daily.set(dayKeyOf(d), { grossCentavos: 0, expenseCentavos: 0, sales: new Set() })
      }

      for (const row of rows) {
        // Every total reads the effective column, so a line counts as revenue
        // only once the crew marks it done, and stops counting if refunded.
        grossCentavos += row.effective_total_centavos
        commissionCentavos += row.effective_commission_centavos
        saleIds.add(row.sale_id)

        if (row.status === 'pending') {
          pendingCount += 1
          // The effective column is 0 for a pending line by definition, so the
          // charged price is what says how much work is still open. The NET
          // price: this tile is what the shop stands to collect, and a promo
          // has already been conceded on it.
          pendingCentavos += row.net_total_centavos
        }
        if (row.status === 'refunded') {
          refundedCount += 1
          // What was handed back is what the customer actually paid, so the
          // net price -- refunding a discounted line does not return the
          // pre-promo amount. The effective column is already zero here.
          refundedCentavos += row.net_total_centavos
        }

        if (row.sales?.vehicle_class === 'motorcycle') {
          motorcycleSales.add(row.sale_id)
        } else if (row.sales?.vehicle_class === 'car') {
          carSales.add(row.sale_id)
        }

        if (row.sales?.sold_at) {
          const key = dayKeyOf(new Date(row.sales.sold_at))
          const bucket = daily.get(key)
          if (bucket) {
            bucket.grossCentavos += row.effective_total_centavos
            bucket.sales.add(row.sale_id)
          }
        }

        const service = services.get(row.service_name) ?? {
          category: row.category,
          grossCentavos: 0,
          count: 0,
        }
        service.grossCentavos += row.effective_total_centavos
        service.count += 1
        services.set(row.service_name, service)

        const size = sizes.get(row.size) ?? { grossCentavos: 0, sales: new Set<string>() }
        size.grossCentavos += row.effective_total_centavos
        size.sales.add(row.sale_id)
        sizes.set(row.size, size)
      }

      for (const row of crewRows) {
        const name = row.employees?.name ?? 'Unknown'
        const emp = employees.get(name) ?? {
          grossCentavos: 0,
          commissionCentavos: 0,
          sales: new Set<string>(),
        }
        // Gross credits the full line to each crew member -- it measures the
        // work done on the car; only commission is split.
        emp.grossCentavos += row.sale_items?.effective_total_centavos ?? 0
        // A generated column cannot see across to the line's status, so the
        // refund reversal for crew shares is applied here.
        // Only finished work is paid. A generated column cannot see across to
        // the line's status, so the same rule the effective_ columns apply is
        // applied here by hand.
        emp.commissionCentavos +=
          row.sale_items?.status === 'done' ? row.commission_centavos : 0
        emp.sales.add(row.sale_id)
        employees.set(name, emp)
      }

      // Expenses roll up by day and by name. They never touch the service,
      // size, or employee buckets -- an expense is not a sale, and crediting
      // one to a crew member would pay commission on a cost.
      let expenseCentavos = 0
      const expenseNames = new Map<string, { amountCentavos: number; count: number }>()

      for (const row of expenseData ?? []) {
        expenseCentavos += row.amount_centavos

        const bucket = daily.get(row.spent_on)
        if (bucket) bucket.expenseCentavos += row.amount_centavos

        const name = row.name.trim() || 'Unnamed'
        const entry = expenseNames.get(name) ?? { amountCentavos: 0, count: 0 }
        entry.amountCentavos += row.amount_centavos
        entry.count += 1
        expenseNames.set(name, entry)
      }

      type PaymentRow = {
        id: string
        payment_method: PaymentMethod
        sale_items: { effective_total_centavos: number }[] | null
      }
      const payments = new Map<PaymentMethod, { grossCentavos: number; sales: Set<string> }>()
      for (const row of (paymentData ?? []) as unknown as PaymentRow[]) {
        const entry = payments.get(row.payment_method) ?? {
          grossCentavos: 0,
          sales: new Set<string>(),
        }
        // Summed from the lines, not `sales.total_centavos`: the header is
        // resummed by a trigger and the lines are the same source every other
        // figure on this page reads.
        entry.grossCentavos += (row.sale_items ?? []).reduce(
          (sum, item) => sum + (item.effective_total_centavos ?? 0),
          0
        )
        entry.sales.add(row.id)
        payments.set(row.payment_method, entry)
      }

      const salesCount = saleIds.size

      return {
        grossCentavos,
        carCount: carSales.size,
        motorcycleCount: motorcycleSales.size,
        pendingCount,
        refundedCount,
        refundedCentavos,
        pendingCentavos,
        expenseCentavos,
        netCentavos: grossCentavos - expenseCentavos,
        commissionCentavos,
        salesCount,
        averageTicketCentavos: salesCount ? Math.round(grossCentavos / salesCount) : 0,
        days,
        daily: [...daily.entries()].map(([date, value]) => ({
          date,
          label: new Date(`${date}T00:00:00`).toLocaleDateString('en-PH', {
            month: 'short',
            day: 'numeric',
          }),
          grossCentavos: value.grossCentavos,
          expenseCentavos: value.expenseCentavos,
          netCentavos: value.grossCentavos - value.expenseCentavos,
          salesCount: value.sales.size,
        })),
        topServices: [...services.entries()]
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.grossCentavos - a.grossCentavos)
          .slice(0, 8),
        bySize: [...sizes.entries()]
          .map(([size, v]) => ({ size, grossCentavos: v.grossCentavos, count: v.sales.size }))
          .sort((a, b) => b.grossCentavos - a.grossCentavos),
        byEmployee: [...employees.entries()]
          .map(([name, v]) => ({
            name,
            grossCentavos: v.grossCentavos,
            commissionCentavos: v.commissionCentavos,
            salesCount: v.sales.size,
          }))
          .sort((a, b) => b.grossCentavos - a.grossCentavos),
        byExpense: [...expenseNames.entries()]
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.amountCentavos - a.amountCentavos),
        byPayment: [...payments.entries()]
          .map(([method, v]) => ({
            method,
            grossCentavos: v.grossCentavos,
            salesCount: v.sales.size,
          }))
          .sort((a, b) => b.grossCentavos - a.grossCentavos),
      }
    },
  })
}
