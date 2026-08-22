'use client'

import { cn } from '@/lib/utils'
import { dayKeyOf, type ReportDateRange } from '@/lib/queries/reports'

/**
 * The date-span controls shared by Reports and Services.
 *
 * Extracted rather than duplicated: the two tabs ask the same question of the
 * same data, and a "This month" that means one thing on one screen and another
 * on the next is the kind of drift nobody notices until the numbers disagree.
 */

/**
 * Quick spans for the custom picker — the periods the owner actually asks for
 * (a calendar month, the month so far) which no fixed "last N days" preset
 * expresses.
 */
export const QUICK_SPANS: { label: string; build: () => ReportDateRange }[] = [
  {
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
  {
    label: 'This year',
    build: () => {
      const now = new Date()
      return { from: dayKeyOf(new Date(now.getFullYear(), 0, 1)), to: dayKeyOf(now) }
    },
  },
]

/** Inclusive day count, so a single-day range reads as 1 rather than 0. */
export function spanDays(range: ReportDateRange): number {
  if (!range.from || !range.to) return 0
  const from = new Date(`${range.from}T00:00:00`)
  const to = new Date(`${range.to}T00:00:00`)
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1)
}

/**
 * A native date input, deliberately.
 *
 * `ui/README.md` bans native `<select>` because the OS draws its popup and
 * ignores the app's tokens. A date input is not the same case: the field itself
 * is ours to style, and the calendar popup it opens is the one piece of OS
 * chrome worth keeping — it handles month lengths, locales, and keyboard entry
 * far better than a hand-rolled calendar would.
 */
export function DateField({
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
          // The picker glyph is drawn black-on-black by the webview otherwise.
          '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:invert'
        )}
      />
    </div>
  )
}

/**
 * The quick-span buttons. Shown beside the two date fields wherever a custom
 * range is being entered.
 */
export function QuickSpans({ onPick }: { onPick: (range: ReportDateRange) => void }) {
  return (
    <div className="flex gap-1.5 pb-0.5">
      {QUICK_SPANS.map((span) => (
        <button
          key={span.label}
          onClick={() => onPick(span.build())}
          className={cn(
            'rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-muted',
            'transition-colors duration-150 hover:border-line-strong hover:text-chalk'
          )}
        >
          {span.label}
        </button>
      ))}
    </div>
  )
}
