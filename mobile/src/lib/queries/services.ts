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

/** One service line as the record screen shows it. */
export interface ServiceLine {
  id: string
  service_name: string
  category: ServiceCategory
  status: ServiceStatus
  quantity: number
  unit_price_centavos: number
  line_total_centavos: number
  /**
   * The charged total once the line is `done`, else 0 — what the sale header
   * and every report actually count. A pending line is work, not yet revenue.
   */
  effective_total_centavos: number
  /**
   * The promo taken off this line, and the percentage that produced it
   * (2000 = 20%). `line_total_centavos` stays the PRE-promo price, because it
   * is the commission base — the crew is paid the full rate regardless.
   */
  discount_centavos: number
  discount_rate_bp: number
  /** What the customer actually owes: line_total less the promo. */
  net_total_centavos: number
  /** Snapshotted at sale time; shown in the edit sheet, never editable there. */
  commission_rate_bp: number
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
  /** What the vehicle is, as the cashier typed it — "Toyota Vios". */
  vehicle_note: string | null
  payment_method: PaymentMethod
  voided_at: string | null
  total_centavos: number
  employees: { name: string } | null
  items: ServiceLine[]
}

/**
 * Today's services, grouped by the car they were worked on.
 *
 * Today only, with no date picker: a cashier's RLS reaches today and nothing
 * else, so offering to page backwards would show them an empty yesterday and
 * read as "the shop had no sales" rather than "this is not yours to see".
 */
export function useTodayServices() {
  return useQuery({
    queryKey: [...serviceRecordsKey, 'today'],
    queryFn: async (): Promise<ServiceTicket[]> => {
      const supabase = createClient()
      const start = new Date()
      start.setHours(0, 0, 0, 0)

      const { data, error } = await supabase
        .from('sales')
        .select(
          'id, receipt_no, sold_at, vehicle_class, size, plate_number, vehicle_note, payment_method, voided_at, total_centavos, employees (name), sale_items (id, service_name, category, status, quantity, unit_price_centavos, line_total_centavos, discount_centavos, discount_rate_bp, net_total_centavos, effective_total_centavos, commission_rate_bp, status_changed_at, created_at)'
        )
        .gte('sold_at', start.toISOString())
        .order('sold_at', { ascending: false })
      if (error) throw error

      type Raw = Omit<ServiceTicket, 'items'> & {
        sale_items: (ServiceLine & { created_at: string })[]
      }

      return ((data ?? []) as unknown as Raw[]).map((sale) => ({
        ...sale,
        // Postgres does not promise an order inside an embedded select, so the
        // lines are sorted here — otherwise a ticket's services reshuffle under
        // the cashier's thumb between refetches.
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
      // A refund moves the sale header and the day's takings with it.
      qc.invalidateQueries({ queryKey: ['sales'] })
    },
  })
}

/** One crew member's share of a line, as the edit sheet reads it. */
export interface LineCrewShare {
  employee_id: string
  commission_centavos: number
  crew_size: number
  employees: { name: string } | null
}

/**
 * Who is on one line, and what each is owed for it.
 *
 * Read straight through PostgREST rather than via an RPC: a cashier's RLS on
 * `sale_item_commissions` already reaches today, which is the only day they can
 * edit anyway. Only fetched while a line is actually open.
 */
export function useLineCrew(saleItemId: string | null) {
  return useQuery({
    queryKey: [...serviceRecordsKey, 'crew', saleItemId],
    enabled: saleItemId !== null,
    queryFn: async (): Promise<LineCrewShare[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('sale_item_commissions')
        .select('employee_id, commission_centavos, crew_size, employees (name)')
        .eq('sale_item_id', saleItemId!)
        // Stable order so the crew does not reshuffle between opens; matches
        // the order `edit_sale_item` treats as "the lead first".
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as LineCrewShare[]
    },
  })
}

export interface EditLineInput {
  saleItemId: string
  quantity?: number
  unitPriceCentavos?: number
  /** Replaces the line's crew wholesale. Omit to leave it alone. */
  employeeIds?: string[]
}

/**
 * Correct one line in place — quantity, price, and who worked it.
 *
 * The service NAME is deliberately not among them, though the RPC still
 * accepts one. What was sold is the identity of the line: it is what the
 * receipt promised and what every per-service report counts. Renaming it in
 * place would let a ₱1,000 package quietly become a "Carwash" at the same
 * price, with nothing on the ticket showing the swap. Rung up wrong is a
 * refund plus a re-ring, which leaves both facts visible.
 *
 * Goes through `edit_sale_item` for the same reason the status change does:
 * `sale_items` has an owner-only UPDATE policy, so a cashier's direct write
 * would match zero rows, and a zero-row UPDATE is not an error — the save would
 * appear to work and change nothing. The RPC recomputes the line total, the
 * commission, and every crew share, then resums the sale header. It limits a
 * cashier to today's sales, exactly as `set_service_status` does.
 *
 * There is deliberately no delete here: that RPC is owner-only, so the cashier
 * app has nothing to call. A mis-rung line is refunded, which leaves the
 * correction visible on the ticket.
 */
export function useEditServiceLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: EditLineInput) => {
      const supabase = createClient()
      const { error } = await supabase.rpc('edit_sale_item', {
        p_sale_item_id: input.saleItemId,
        p_quantity: input.quantity,
        p_unit_price_centavos: input.unitPriceCentavos,
        p_employee_ids: input.employeeIds,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serviceRecordsKey })
      qc.invalidateQueries({ queryKey: ['sales'] })
    },
  })
}

export interface EditTicketInput {
  saleId: string
  paymentMethod?: PaymentMethod
  /** `null` clears the field; omit to leave it alone. */
  vehicleNote?: string | null
  plateNumber?: string | null
}

/**
 * Correct the ticket a line sits on — payment method, vehicle name, plate.
 *
 * A separate RPC from the line edit because they write different tables, and
 * because a header fix must not have to invent line values to go through.
 * `sales` has an owner-only UPDATE policy, so this takes the same
 * `security definer` route every other cashier write does.
 *
 * It matters most here, on the phone: the cashier who tapped GCash instead of
 * Cash is the one holding the money, and until now nothing in either client
 * could fix it — the mis-tap silently misfiled the whole ticket in the owner's
 * payment breakdown. Cashiers reach today's sales only, same as every other
 * correction the app offers.
 *
 * Null is overloaded on the two text columns: they are nullable, so "leave it
 * alone" and "clear it" cannot both be null over the wire. The RPC's
 * `p_clear_*` flags carry the second meaning.
 */
export function useEditSaleTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: EditTicketInput) => {
      const supabase = createClient()
      const { error } = await supabase.rpc('edit_sale_ticket', {
        p_sale_id: input.saleId,
        p_payment_method: input.paymentMethod,
        p_vehicle_note: input.vehicleNote ?? undefined,
        p_plate_number: input.plateNumber ?? undefined,
        p_clear_vehicle_note: input.vehicleNote === null,
        p_clear_plate_number: input.plateNumber === null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serviceRecordsKey })
      qc.invalidateQueries({ queryKey: ['sales'] })
    },
  })
}


/**
 * Apply one promo percentage across a whole ticket, or 0 to remove it.
 *
 * Separate from `useEditSaleTicket` because the RPCs write different tables:
 * `edit_sale_ticket` touches only `sales` and is documented as never moving a
 * money column, which is a promise worth keeping. The promo lives on the
 * lines, so it gets its own call.
 *
 * It never touches commission — the crew is paid on the undiscounted price.
 */
export function useSetSaleDiscount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { saleId: string; discountRateBp: number }) => {
      const supabase = createClient()
      const { error } = await supabase.rpc('set_sale_discount', {
        p_sale_id: input.saleId,
        p_discount_rate_bp: input.discountRateBp,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serviceRecordsKey })
      qc.invalidateQueries({ queryKey: ['sales'] })
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
  if (raw.includes('SALE_NOT_FOUND')) return 'That sale no longer exists.'
  if (raw.includes('OWNER_ONLY')) return 'Only the owner can do that.'
  if (raw.includes('CREW_REQUIRED')) return 'A service needs at least one crew member.'
  if (raw.includes('UNKNOWN_EMPLOYEE')) return 'One of those employees is no longer active.'
  if (raw.includes('NAME_REQUIRED')) return 'The service needs a name.'
  if (raw.includes('QUANTITY_POSITIVE')) return 'Quantity must be at least 1.'
  if (raw.includes('PRICE_NEGATIVE')) return 'The price cannot be negative.'
  return raw
}
