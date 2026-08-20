'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { serviceIdForSale, type CartLine } from '@shared/lib/pricing'
import { customServiceName } from '@shared/lib/domain'
import type { PaymentMethod, SizeLabel, VehicleClass } from '@shared/lib/domain'

export const salesKey = ['sales'] as const

export interface SaleRow {
  id: string
  receipt_no: number
  sold_at: string
  total_centavos: number
  commission_centavos: number
  vehicle_class: VehicleClass
  /** The label printed at sale time, not a live size reference. */
  size: SizeLabel
  plate_number: string | null
  payment_method: PaymentMethod
  voided_at: string | null
  employees: { name: string } | null
  sale_items: { service_name: string; quantity: number; line_total_centavos: number }[]
}

/** Recent sales, newest first — the POS shows these as a running feed. */
export function useRecentSales(limit = 40) {
  return useQuery({
    queryKey: [...salesKey, 'recent', limit],
    queryFn: async (): Promise<SaleRow[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('sales')
        .select(
          'id, receipt_no, sold_at, total_centavos, commission_centavos, vehicle_class, size, plate_number, payment_method, voided_at, employees (name), sale_items (service_name, quantity, line_total_centavos)'
        )
        .order('sold_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as SaleRow[]
    },
  })
}

export interface CreateSaleInput {
  /** The crew who worked the car. Commission splits evenly among them. */
  employeeIds: string[]
  vehicleClass: VehicleClass
  /** The size label to print on the sale. */
  size: SizeLabel
  lines: CartLine[]
  paymentMethod: PaymentMethod
  plateNumber?: string
}

/**
 * Totals are recomputed by the database, not trusted from here — the RPC is
 * the single writer, so a sale and its lines always land together.
 */
export function useCreateSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateSaleInput): Promise<string> => {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('create_sale', {
        p_employee_ids: input.employeeIds,
        p_vehicle_class: input.vehicleClass,
        p_size: input.size,
        p_payment_method: input.paymentMethod,
        p_plate_number: input.plateNumber || undefined,
        p_items: input.lines.map((line) => ({
          // A custom line has no catalogue row behind it, so it posts a null
          // service_id and its typed note folded into the stored name.
          service_id: serviceIdForSale(line),
          service_name: customServiceName(line.serviceName, line.description),
          category: line.category,
          quantity: line.quantity,
          unit_price_centavos: line.unitPriceCentavos,
          commission_rate_bp: line.commissionRateBp,
        })),
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: salesKey })
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['payroll'] })
      // New lines land pending, and a void takes them back out of the count.
      qc.invalidateQueries({ queryKey: ['attention'] })
    },
  })
}

export function useVoidSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (saleId: string) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('sales')
        .update({ voided_at: new Date().toISOString() })
        .eq('id', saleId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: salesKey })
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['payroll'] })
      // New lines land pending, and a void takes them back out of the count.
      qc.invalidateQueries({ queryKey: ['attention'] })
    },
  })
}
