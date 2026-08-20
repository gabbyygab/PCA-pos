'use client'

import { useMemo, useState } from 'react'
import { CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import { Panel, PanelHeader, SlashRule } from '@/components/ui/Panel'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { ExpenseDialog } from '@/components/expenses/ExpenseDialog'
import {
  useCreateExpense,
  useDeleteExpense,
  useExpenseNames,
  useExpenses,
  useUpdateExpense,
  type Expense,
  type ExpenseInput,
  type ExpenseRange,
} from '@/lib/queries/expenses'
import { dayKeyOf } from '@/lib/queries/reports'
import { formatPeso } from '@shared/lib/currency'

/** The spans the owner actually asks for when reviewing what was spent. */
const PRESETS: { id: string; label: string; build: () => ExpenseRange }[] = [
  {
    id: 'today',
    label: 'Today',
    build: () => {
      const key = dayKeyOf(new Date())
      return { from: key, to: key }
    },
  },
  {
    id: '7d',
    label: '7 days',
    build: () => {
      const from = new Date()
      from.setDate(from.getDate() - 6)
      return { from: dayKeyOf(from), to: dayKeyOf(new Date()) }
    },
  },
  {
    id: 'month',
    label: 'This month',
    build: () => {
      const now = new Date()
      return {
        from: dayKeyOf(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: dayKeyOf(now),
      }
    },
  },
  {
    id: 'lastMonth',
    label: 'Last month',
    build: () => {
      const now = new Date()
      return {
        from: dayKeyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        // Day 0 of this month is the last day of the previous one.
        to: dayKeyOf(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    },
  },
]

export function ExpensesTab() {
  const [presetId, setPresetId] = useState('month')
  const [range, setRange] = useState<ExpenseRange>(() => PRESETS[2].build())
  /* null = closed; an Expense = editing it; 'new' = the add form. */
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)

  const rangeError =
    range.from && range.to && range.from > range.to
      ? 'The start date is after the end date.'
      : undefined

  const { data: expenses, isLoading } = useExpenses(rangeError ? { from: '', to: '' } : range)
  const { data: knownNames } = useExpenseNames()
  const create = useCreateExpense()
  const update = useUpdateExpense()
  const remove = useDeleteExpense()
  const { toast } = useToast()

  const rows = useMemo(() => expenses ?? [], [expenses])
  const total = useMemo(() => rows.reduce((sum, e) => sum + e.amount_centavos, 0), [rows])

  // Grouped by day so the sheet reads like the paper one it replaces: a date
  // header carrying that day's subtotal, then the entries under it.
  const byDay = useMemo(() => {
    const days = new Map<string, Expense[]>()
    for (const expense of rows) {
      const list = days.get(expense.spent_on) ?? []
      list.push(expense)
      days.set(expense.spent_on, list)
    }
    return [...days.entries()].map(([date, items]) => ({
      date,
      items,
      totalCentavos: items.reduce((sum, e) => sum + e.amount_centavos, 0),
    }))
  }, [rows])

  const spanDays = useMemo(() => {
    if (!range.from || !range.to || rangeError) return 0
    const from = new Date(`${range.from}T00:00:00`)
    const to = new Date(`${range.to}T00:00:00`)
    return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1)
  }, [range, rangeError])

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setPresetId(preset.id)
    setRange(preset.build())
  }

  function setBound(key: 'from' | 'to', value: string) {
    setPresetId('custom')
    setRange((r) => ({ ...r, [key]: value }))
  }

  async function submit(input: ExpenseInput) {
    const target = editing
    if (!target) return
    try {
      if (target === 'new') {
        await create.mutateAsync(input)
        toast({
          message: `${input.name.trim()} recorded`,
          detail: `${formatPeso(input.amountCentavos)} deducted from that day’s gross.`,
          tone: 'success',
        })
      } else {
        await update.mutateAsync({ ...input, id: target.id })
        toast({ message: 'Expense updated', tone: 'success' })
      }
      setEditing(null)
    } catch (error) {
      toast({
        message: target === 'new' ? 'Could not record the expense' : 'Could not save changes',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    const name = deleting.name
    try {
      await remove.mutateAsync(deleting.id)
      setDeleting(null)
      toast({ message: `${name} deleted`, tone: 'success' })
    } catch (error) {
      toast({
        message: 'Could not delete',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <SlashRule className="mb-3" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="board-head text-2xl text-chalk">Expenses</h1>
            <p className="mt-1 text-xs text-muted">
              What the shop spent to run the day. Deducted from gross to give net sales in Reports.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-semibold',
                  'transition-[transform,background-color,border-color,color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
                  'active:scale-[0.97]',
                  presetId === preset.id
                    ? 'border-red bg-red text-white'
                    : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
                )}
              >
                {preset.label}
              </button>
            ))}
            <Button size="sm" variant="primary" className="ml-2" onClick={() => setEditing('new')}>
              <Plus size={14} />
              Add expense
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <DateField
            id="expense-from"
            label="From"
            value={range.from}
            max={range.to || undefined}
            onChange={(from) => setBound('from', from)}
          />
          <DateField
            id="expense-to"
            label="To"
            value={range.to}
            min={range.from || undefined}
            onChange={(to) => setBound('to', to)}
          />
          {rangeError ? (
            <p className="pb-2 text-xs font-semibold text-red">{rangeError}</p>
          ) : (
            <p className="pb-2 text-xs text-faint">
              <CalendarRange size={11} className="mr-1 inline align-[-1px]" />
              {spanDays} day{spanDays === 1 ? '' : 's'} selected
            </p>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-4xl">
          {rangeError ? (
            <p className="text-sm text-muted">Pick a valid date range to see the sheet.</p>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
                <Stat label="Total spent" value={formatPeso(total)} accent />
                <Stat label="Entries" value={String(rows.length)} />
                <Stat
                  label="Average per day"
                  value={formatPeso(spanDays ? Math.round(total / spanDays) : 0)}
                />
              </div>

              <Panel>
                <PanelHeader
                  title="Expense sheet"
                  hint="Grouped by the day the money was spent."
                />
                {isLoading ? (
                  <TableSkeleton
                    label="Loading expenses"
                    rows={6}
                    columns={['40%', '25%', '18%']}
                  />
                ) : byDay.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-faint">
                    Nothing recorded in this range. Use Add expense to log soap, water,
                    electricity, or a repair.
                  </p>
                ) : (
                  <div className="divide-y divide-line">
                    {byDay.map((day) => (
                      <section key={day.date}>
                        <div className="flex items-baseline justify-between gap-3 bg-surface-2/40 px-4 py-2">
                          <h3 className="board-label text-[10px] text-muted">
                            {formatDay(day.date)}
                          </h3>
                          <span className="tnum text-xs font-bold text-chalk">
                            {formatPeso(day.totalCentavos)}
                          </span>
                        </div>
                        <ul className="divide-y divide-line">
                          {day.items.map((expense) => (
                            <li
                              key={expense.id}
                              className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-chalk">
                                  {expense.name}
                                </p>
                                {expense.description ? (
                                  <p className="mt-0.5 truncate text-[11px] text-faint">
                                    {expense.description}
                                  </p>
                                ) : null}
                              </div>
                              <span className="tnum shrink-0 text-sm font-bold text-red">
                                {formatPeso(expense.amount_centavos)}
                              </span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditing(expense)}
                                  aria-label={`Edit ${expense.name}`}
                                >
                                  <Pencil size={13} />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => setDeleting(expense)}
                                  aria-label={`Delete ${expense.name}`}
                                >
                                  <Trash2 size={13} />
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <ExpenseDialog
          // Remounts between add and edit so the form never carries a stale value.
          key={editing === 'new' ? 'new' : editing.id}
          expense={editing === 'new' ? null : editing}
          defaultDate={range.to || dayKeyOf(new Date())}
          knownNames={knownNames ?? []}
          busy={create.isPending || update.isPending}
          onSubmit={submit}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmModal
          title={`Delete ${deleting.name}?`}
          hint="Permanent. The day’s total and net sales in Reports both go back up by this amount."
          confirmLabel="Delete"
          destructive
          busy={remove.isPending}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        >
          <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
            <span className="tnum font-bold text-chalk">
              {formatPeso(deleting.amount_centavos)}
            </span>{' '}
            on {formatDay(deleting.spent_on)}
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  )
}

/** `YYYY-MM-DD` read as local midnight — a bare key would shift by the offset. */
function formatDay(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * A native date input, matching the one in Reports — the field is ours to
 * style, and the OS calendar popup handles month lengths and locales better
 * than a hand-rolled one would.
 */
function DateField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string
  label: string
  value: string
  min?: string
  max?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="board-label block text-[10px] text-faint">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'tnum mt-1.5 h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-chalk',
          'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
          'hover:border-line-strong focus:border-red focus:outline-none',
          '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:invert'
        )}
      />
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Panel className="px-4 py-3">
      <p className="board-label text-[10px] text-faint">{label}</p>
      <p className={`tnum mt-1 text-xl font-extrabold ${accent ? 'text-red' : 'text-chalk'}`}>
        {value}
      </p>
    </Panel>
  )
}
