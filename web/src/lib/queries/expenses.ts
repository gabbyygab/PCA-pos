'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { reportsKey } from '@/lib/queries/reports'
import type { Tables } from '@shared/types/database'

/**
 * Daily operating costs — soap, water, a replaced hose, the crew's lunch.
 *
 * Kept entirely apart from the sales ledger: an expense is not a negative sale,
 * and folding one into `sales` would move gross revenue and every crew member's
 * commission with it. Reports subtract these at the display boundary to reach
 * net sales; see `supabase/migrations/20260819_daily_expenses.sql`.
 */

export type Expense = Tables<'expenses'>

export const expensesKey = ['expenses'] as const

export interface ExpenseInput {
  /** `YYYY-MM-DD` local. Plain date, so an 11pm bill stays on its own day. */
  spentOn: string
  name: string
  description: string
  amountCentavos: number
}

/** The inclusive day span a list covers, as `YYYY-MM-DD` keys. */
export interface ExpenseRange {
  from: string
  to: string
}

export function useExpenses(range: ExpenseRange) {
  return useQuery({
    queryKey: [...expensesKey, range.from, range.to],
    // A half-entered range would query a nonsense window.
    enabled: Boolean(range.from && range.to),
    queryFn: async (): Promise<Expense[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .gte('spent_on', range.from)
        .lte('spent_on', range.to)
        // Newest day first, then newest entry within the day — the sheet reads
        // the way it was filled in.
        .order('spent_on', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * Names already used, newest first, for the "add" modal's suggestions.
 *
 * Expense names are free text by design, but the same handful recur every week.
 * Offering what was typed before keeps "Electricity" from becoming three
 * spellings that report as three separate lines.
 */
export function useExpenseNames() {
  return useQuery({
    queryKey: [...expensesKey, 'names'],
    queryFn: async (): Promise<string[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('expenses')
        .select('name, spent_on')
        .order('spent_on', { ascending: false })
        .limit(400)
      if (error) throw error

      // Deduplicated in insertion order, so the most recently used name leads.
      const seen = new Set<string>()
      for (const row of data ?? []) {
        const name = row.name.trim()
        if (name) seen.add(name)
      }
      return [...seen]
    },
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Every mutation invalidates the reports key too: net sales is gross minus
 * these rows, so a recorded expense that leaves a stale net tile on the
 * owner's report is worse than a refetch.
 */
function useInvalidateExpenses() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: expensesKey })
    qc.invalidateQueries({ queryKey: reportsKey })
  }
}

export function useCreateExpense() {
  const invalidate = useInvalidateExpenses()
  return useMutation({
    mutationFn: async (input: ExpenseInput) => {
      const supabase = createClient()

      // Stamped from the session so the ledger names a person, not a uuid that
      // later has to be resolved against auth.users.
      const { data: auth } = await supabase.auth.getUser()

      const { error } = await supabase.from('expenses').insert({
        spent_on: input.spentOn,
        name: input.name.trim(),
        description: input.description.trim() || null,
        amount_centavos: input.amountCentavos,
        created_by_email: auth.user?.email ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useUpdateExpense() {
  const invalidate = useInvalidateExpenses()
  return useMutation({
    mutationFn: async (input: ExpenseInput & { id: string }) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('expenses')
        .update({
          spent_on: input.spentOn,
          name: input.name.trim(),
          description: input.description.trim() || null,
          amount_centavos: input.amountCentavos,
        })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteExpense() {
  const invalidate = useInvalidateExpenses()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient()
      const { error } = await supabase.from('expenses').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
