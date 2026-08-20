'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { PricedService } from '@shared/lib/pricing'
import type { ServiceCategory, VehicleClass, VehicleSizeRow } from '@shared/lib/domain'

export interface CatalogService extends PricedService {
  vehicle_class: VehicleClass
  is_active: boolean
  sort_order: number
  inclusions: string[]
}

export const catalogKey = ['catalog'] as const

/**
 * The whole catalog in one round trip. It is ~16 services, so the POS keeps it
 * resident and filters in memory rather than refetching per size or tab.
 */
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

export function useUpdatePrice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      serviceId: string
      sizeId: string
      priceCentavos: number | null
    }) => {
      const supabase = createClient()
      if (input.priceCentavos === null) {
        // Removing the price means the service is not offered at that size.
        const { error } = await supabase
          .from('service_prices')
          .delete()
          .eq('service_id', input.serviceId)
          .eq('size_id', input.sizeId)
        if (error) throw error
        return
      }
      const { error } = await supabase.from('service_prices').upsert(
        {
          service_id: input.serviceId,
          size_id: input.sizeId,
          price_centavos: input.priceCentavos,
        },
        { onConflict: 'service_id,size_id' }
      )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKey }),
  })
}

export function useUpdateService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      category?: ServiceCategory
      commission_rate_bp?: number
      is_active?: boolean
      is_open_price?: boolean
      sort_order?: number
    }) => {
      const { id, ...patch } = input
      const supabase = createClient()
      const { error } = await supabase.from('services').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKey }),
  })
}

export function useCreateService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      category: ServiceCategory
      vehicle_class: VehicleClass
      commission_rate_bp: number
      is_open_price: boolean
      /** Explicit: the column defaults to 0, which would sort a new service
       *  above every seeded one. Settings passes the end of its group. */
      sort_order: number
    }) => {
      const supabase = createClient()
      const { error } = await supabase.from('services').insert(input)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKey }),
  })
}

/**
 * Permanently removes a service. A `before delete` trigger refuses this once
 * the service is on any past sale line, so the guard holds even if the UI's
 * own check is stale; `useServiceUsage` is what keeps the button honest.
 */
export function useDeleteService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient()
      const { error } = await supabase.from('services').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKey }),
  })
}

export const vehicleSizesKey = ['vehicle-sizes'] as const

/**
 * The size scales themselves. Every screen that shows a size resolves its label
 * through this, so a rename in Settings reaches the POS and Reports at once.
 * Past sales are unaffected: they store the label they printed.
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

export function useCreateVehicleSize() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      vehicle_class: VehicleClass
      label: string
      description?: string | null
      /** Explicit: sort_order defaults to 0, which would sort a new size to
       *  the front of the scale. Settings passes the end of the class. */
      sort_order: number
    }) => {
      const supabase = createClient()
      const { error } = await supabase.from('vehicle_sizes').insert({
        ...input,
        label: input.label.trim(),
        description: input.description?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vehicleSizesKey })
      qc.invalidateQueries({ queryKey: catalogKey })
    },
  })
}

export function useUpdateVehicleSize() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      label?: string
      description?: string | null
      sort_order?: number
      is_active?: boolean
    }) => {
      const { id, ...patch } = input
      const supabase = createClient()
      const { error } = await supabase
        .from('vehicle_sizes')
        .update({
          ...patch,
          ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
          ...(patch.description !== undefined
            ? { description: patch.description?.trim() || null }
            : {}),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vehicleSizesKey })
      qc.invalidateQueries({ queryKey: catalogKey })
    },
  })
}

/**
 * Deleting a size takes its price rows with it (ON DELETE CASCADE). A `before
 * delete` trigger refuses once any past sale printed that label, so the guard
 * holds even when the UI's own check is stale.
 */
export function useDeleteVehicleSize() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient()
      const { error } = await supabase.from('vehicle_sizes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vehicleSizesKey })
      qc.invalidateQueries({ queryKey: catalogKey })
    },
  })
}

export const sizeUsageKey = ['size-usage'] as const

/**
 * lowercased size label -> how many past sale lines printed it. Settings offers
 * Delete only at zero, mirroring how services are guarded.
 */
export function useSizeUsage() {
  return useQuery({
    queryKey: sizeUsageKey,
    queryFn: async (): Promise<Record<string, number>> => {
      const supabase = createClient()
      const { data, error } = await supabase.from('sale_items').select('size')
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of data ?? []) {
        const key = row.size.trim().toLowerCase()
        counts[key] = (counts[key] ?? 0) + 1
      }
      return counts
    },
    staleTime: 60 * 1000,
  })
}

export const serviceUsageKey = ['service-usage'] as const

/**
 * service id -> how many past sale lines reference it. Settings offers Delete
 * only at zero; anything else is told to hide instead.
 */
export function useServiceUsage() {
  return useQuery({
    queryKey: serviceUsageKey,
    queryFn: async (): Promise<Record<string, number>> => {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('service_sale_counts')
      if (error) throw error
      return Object.fromEntries((data ?? []).map((r) => [r.service_id, Number(r.sale_count)]))
    },
    staleTime: 60 * 1000,
  })
}

export const inclusionOptionsKey = ['inclusion-options'] as const

export interface InclusionOption {
  id: string
  label: string
  sort_order: number
}

/**
 * The shared vocabulary a package is assembled from. These are descriptive
 * labels that print on the receipt — they carry no price and are never sold on
 * their own, which is why they are their own table and not `services` rows.
 */
export function useInclusionOptions() {
  return useQuery({
    queryKey: inclusionOptionsKey,
    queryFn: async (): Promise<InclusionOption[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('inclusion_options')
        .select('id, label, sort_order')
        .order('sort_order')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateInclusionOption() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (label: string) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('inclusion_options')
        .insert({ label, sort_order: 900 })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: inclusionOptionsKey }),
  })
}

/**
 * Renaming an inclusion has to carry every package that uses it, otherwise the
 * package keeps the old spelling and the option list gains a near-duplicate.
 */
export function useRenameInclusionOption() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; from: string; to: string }) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('inclusion_options')
        .update({ label: input.to })
        .eq('id', input.id)
      if (error) throw error

      const { error: fanout } = await supabase
        .from('package_inclusions')
        .update({ label: input.to })
        .eq('label', input.from)
      if (fanout) throw fanout
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inclusionOptionsKey })
      qc.invalidateQueries({ queryKey: catalogKey })
    },
  })
}

/** Retiring an option leaves packages that already list it untouched. */
export function useDeleteInclusionOption() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient()
      const { error } = await supabase.from('inclusion_options').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: inclusionOptionsKey }),
  })
}

export function useSetInclusions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { serviceId: string; labels: string[] }) => {
      const supabase = createClient()
      const { error: delError } = await supabase
        .from('package_inclusions')
        .delete()
        .eq('service_id', input.serviceId)
      if (delError) throw delError

      if (input.labels.length === 0) return
      const { error } = await supabase.from('package_inclusions').insert(
        input.labels.map((label, i) => ({
          service_id: input.serviceId,
          label,
          sort_order: i + 1,
        }))
      )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKey }),
  })
}
