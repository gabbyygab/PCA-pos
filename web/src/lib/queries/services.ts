'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type {
  PaymentMethod,
  ServiceCategory,
  ServiceStatus,
  SizeLabel,
  VehicleClass,
} from '@shared/lib/domain'

export const serviceRecordsKey = ['service-records'] as const

/** One service line as the record page shows it. */
export interface ServiceLine {
  id: string
  service_name: string
  category: ServiceCategory
  status: ServiceStatus
  quantity: number
  line_total_centavos: number
  /** 0 once refunded. What the sale header and the reports actually count. */
  effective_total_centavos: number
  status_changed_at: string | null
}

/** A car on the lot, with the services rung up against it. */
export interface ServiceTicket {
  id: string
  receipt_no: number
  sold_at: string
  vehicle_class: VehicleClass
  size: SizeLabel
  plate_number: string | null
  payment_method: PaymentMethod
  voided_at: string | null
  total_centavos: number
  /** The crew lead — `sales.employee_id`, i.e. who led this car. */
  employees: { name: string } | null
  items: ServiceLine[]
}

function dayBounds(dayKey: string): { start: string; endExclusive: string } {
  // Local midnight, matching the reports query: a bare `YYYY-MM-DD` parses as
  // UTC and would shift the boundary by the Manila offset.
  const start = new Date(`${dayKey}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), endExclusive: end.toISOString() }
}

/**
 * Every service rung up on one day, grouped by the car it was worked on.
 *
 * Grouped rather than flat because the cashier is standing at a bay looking for
 * a specific vehicle, not scanning a ledger. A cashier's RLS only reaches
 * today, so asking for an older day returns empty for them by design.
 */
export function useServiceRecords(dayKey: string) {
  return useQuery({
    queryKey: [...serviceRecordsKey, dayKey],
    queryFn: async (): Promise<ServiceTicket[]> => {
      const supabase = createClient()
      const { start, endExclusive } = dayBounds(dayKey)

      const { data, error } = await supabase
        .from('sales')
        .select(
          'id, receipt_no, sold_at, vehicle_class, size, plate_number, payment_method, voided_at, total_centavos, employees (name), sale_items (id, service_name, category, status, quantity, line_total_centavos, effective_total_centavos, status_changed_at, created_at)'
        )
        .gte('sold_at', start)
        .lt('sold_at', endExclusive)
        .order('sold_at', { ascending: false })
      if (error) throw error

      type Raw = Omit<ServiceTicket, 'items'> & {
        sale_items: (ServiceLine & { created_at: string })[]
      }

      return ((data ?? []) as unknown as Raw[]).map((sale) => ({
        ...sale,
        // Postgres does not promise an order inside an embedded select, so the
        // lines are sorted here — otherwise a ticket's services reshuffle
        // under the cashier's thumb between refetches.
        items: [...(sale.sale_items ?? [])].sort((a, b) =>
          a.created_at.localeCompare(b.created_at)
        ),
      }))
    },
  })
}

/**
 * Move one line between pending / done / refunded.
 *
 * Goes through the `set_service_status` RPC rather than updating the row:
 * `sale_items` has an owner-only UPDATE policy, so a cashier's direct write
 * would match zero rows — and a zero-row UPDATE is not an error, so the tap
 * would appear to work and change nothing. The RPC is `security definer` and
 * enforces the cashier's today-only reach itself.
 */
export function useSetServiceStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { saleItemId: string; status: ServiceStatus }) => {
      const supabase = createClient()
      const { error } = await supabase.rpc('set_service_status', {
        p_sale_item_id: input.saleItemId,
        p_status: input.status,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serviceRecordsKey })
      // A refund moves the sale header, the day's revenue, and the crew's
      // commission, so everything downstream is stale.
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['payroll'] })
      // The sidebar count is derived from these same rows, so it would sit
      // stale for up to a poll interval without this.
      qc.invalidateQueries({ queryKey: ['attention'] })
    },
  })
}

/** Turns a Postgres error from the RPC into something the cashier can act on. */
export function serviceStatusErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (raw.includes('PAST_DAY_OWNER_ONLY')) {
    return 'Only the owner can change a sale from a previous day.'
  }
  if (raw.includes('SALE_VOIDED')) return 'This sale was voided.'
  if (raw.includes('NOT_AUTHENTICATED')) return 'Your session expired. Sign in again.'
  if (raw.includes('SALE_ITEM_NOT_FOUND')) return 'That service is no longer on the sale.'
  return raw
}
