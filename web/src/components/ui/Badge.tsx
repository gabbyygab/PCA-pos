'use client'

import { cn } from '@/lib/utils'

interface BadgeProps {
  /** Rendered as-is; counts above the cap arrive here already as "9+". */
  children: React.ReactNode
  /**
   * Rides a red dot on the corner. Means "arrived since you last looked",
   * which is a different question from "how much is outstanding".
   */
  dot?: boolean
  /** Screen-reader wording; the digits alone say nothing about what they count. */
  label?: string
  className?: string
}

/**
 * A count on a nav item.
 *
 * Deliberately not a `Panel`-style surface: it sits inside a tab button that
 * already changes colour on hover and active, so it carries its own solid red
 * rather than a token that shifts underneath it.
 */
export function Badge({ children, dot = false, label, className }: BadgeProps) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5',
          'bg-red text-[10px] font-bold leading-[1.15rem] text-white',
          // Tabular figures stop the pill resizing as 9 ticks to 10.
          '[font-variant-numeric:tabular-nums]'
        )}
      >
        {children}
      </span>
      {dot ? (
        <span
          aria-hidden
          className={cn(
            'absolute -right-0.5 -top-0.5 size-2 rounded-full',
            'bg-red-hot ring-2 ring-surface'
          )}
        />
      ) : null}
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}

/** Above this the pill would widen enough to shove the tab label around. */
export const BADGE_CAP = 9

export function formatBadgeCount(n: number): string {
  return n > BADGE_CAP ? `${BADGE_CAP}+` : String(n)
}
