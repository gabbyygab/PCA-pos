import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

export const expensesKey = ['expenses'] as const

/** One recorded cost, as the cashier's sheet shows it. */
export interface ExpenseRow {
  id: string
  spent_on: string
  name: string
  description: string | null
  amount_centavos: number
  created_by_email: string | null
  created_at: string
}

/**
 * Today's expenses.
 *
 * Today only, and deliberately without a date picker — the same shape as
 * `useTodayServices`. A cashier's RLS reaches the Manila day in progress and
 * nothing before it, so offering to page backwards would render an empty
 * yesterday that reads as "the shop spent nothing" rather than "this is not
 * yours to see".
 *
 * What it is for is the double-entry problem: the cashier can see that soap is
 * already on the sheet before adding it again.
 */
export function useTodayExpenses() {
  return useQuery({
    queryKey: [...expensesKey, 'today'],
    queryFn: async (): Promise<ExpenseRow[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('expenses')
        .select('id, spent_on, name, description, amount_centavos, created_by_email, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ExpenseRow[]
    },
  })
}

/**
 * Previously used names, offered as one-tap fills.
 *
 * The same reasoning as the dashboard's add dialog: the name is free text so
 * the owner can type whatever the receipt says, and the cost of that freedom is
 * "Electricity" becoming three spellings that report as three lines. Suggesting
 * what has been typed before is what keeps the labels converging without
 * forcing a categories table nobody wants to maintain.
 *
 * A cashier only reads today, so their suggestions come from today's rows —
 * thinner than the owner's list, but it still catches the repeat within a
 * shift, which is the case that actually recurs.
 */
export function useExpenseNameSuggestions() {
  const { data } = useTodayExpenses()
  const seen = new Map<string, string>()
  for (const row of data ?? []) {
    const key = row.name.trim().toLowerCase()
    if (key && !seen.has(key)) seen.set(key, row.name.trim())
  }
  return [...seen.values()]
}

export interface NewExpense {
  name: string
  description: string | null
  amountCentavos: number
}

/**
 * Record an expense.
 *
 * A plain insert rather than an RPC, which is the opposite of how sales are
 * written — and the difference is that there is no money to compute here. An
 * expense is a name and an amount the cashier types; there are no line totals,
 * no commission split, and nothing for a tampered client to inflate in its own
 * favour, so there is no arithmetic that has to happen in Postgres to be
 * trusted. The `amount_centavos > 0` check and the RLS policy are the whole
 * guard, and both are already in the database.
 *
 * `spent_on` is left to its column default — the Manila day — rather than being
 * sent from the device. A phone with a wrong clock or a traveller's timezone
 * would otherwise file the cost on the wrong day's sheet.
 *
 * `created_by` likewise defaults to auth.uid() in Postgres. Only the email is
 * passed, since it is not derivable from a JWT claim inside a policy.
 */
export function useAddExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewExpense) => {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()

      const { error } = await supabase.from('expenses').insert({
        name: input.name.trim(),
        description: input.description?.trim() || null,
        amount_centavos: input.amountCentavos,
        created_by_email: userData.user?.email ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: expensesKey })
    },
  })
}

/** Turns a Postgres error from the insert into something the cashier can act on. */
export function expenseErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // The row-level check on the table, hit when the parsed amount is 0.
  if (raw.includes('amount_centavos')) return 'Enter an amount greater than zero.'
  if (raw.includes('expenses_name_check') || raw.includes('length(trim(name))')) {
    return 'Enter a name for the expense.'
  }
  // A cashier's insert is allowed, so this means the session lapsed rather than
  // the policy refusing them.
  if (raw.includes('row-level security')) {
    return 'Your session expired. Sign in again.'
  }
  if (raw.includes('JWT') || raw.includes('not authenticated')) {
    return 'Your session expired. Sign in again.'
  }
  return raw
}
