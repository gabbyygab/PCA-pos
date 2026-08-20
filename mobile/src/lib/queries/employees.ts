import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Tables } from '@shared/types/database'

export type Employee = Tables<'employees'>

export const employeesKey = ['employees'] as const

/**
 * The roster, for assigning a crew to a car. Read-only: hiring happens on the
 * dashboard, and RLS restricts writes to the owner.
 */
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
