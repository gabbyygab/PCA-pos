import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { PricedService } from '@shared/lib/pricing'
import type { VehicleClass, VehicleSizeRow } from '@shared/lib/domain'

/**
 * Read-only mirror of the dashboard's catalog queries. The cashier app never
 * writes to the catalog — RLS would refuse anyway (`is_owner()`), so the
 * mutations simply do not exist here.
 */

export interface CatalogService extends PricedService {
  vehicle_class: VehicleClass
  is_active: boolean
  sort_order: number
  inclusions: string[]
}

export const catalogKey = ['catalog'] as const

/** The whole board in one round trip; ~16 services, filtered in memory. */
export function useCatalog() {
  return useQuery({
    queryKey: catalogKey,
    queryFn: async (): Promise<CatalogService[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('services')
        .select(
          'id, name, category, vehicle_class, commission_rate_bp, is_open_price, is_active, sort_order, service_prices (size_id, price_centavos), package_inclusions (label, sort_order)'
        )
        .order('sort_order')
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        vehicle_class: row.vehicle_class,
        commission_rate_bp: row.commission_rate_bp,
        is_open_price: row.is_open_price,
        is_active: row.is_active,
        sort_order: row.sort_order,
        prices: Object.fromEntries(
          (row.service_prices ?? []).map((p) => [p.size_id, p.price_centavos])
        ),
        inclusions: (row.package_inclusions ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((i) => i.label),
      }))
    },
    staleTime: 5 * 60 * 1000,
  })
}

export const vehicleSizesKey = ['vehicle-sizes'] as const

/**
 * The size scales. A rename in Settings reaches the cashier here; past sales
 * are unaffected because they store the label they printed.
 */
export function useVehicleSizes() {
  return useQuery({
    queryKey: vehicleSizesKey,
    queryFn: async (): Promise<VehicleSizeRow[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('vehicle_sizes')
        .select('id, vehicle_class, label, description, sort_order, is_active')
        .order('sort_order')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}
