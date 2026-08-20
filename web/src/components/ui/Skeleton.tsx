import { cn } from '@/lib/utils'

/**
 * A placeholder block.
 *
 * Skeletons here are shaped like the thing that is coming — a grid of tiles
 * for the board, table rows for payroll — rather than a generic bar. The point
 * is that nothing moves when the data lands: the owner's eye is already where
 * the number will be.
 *
 * The pulse is `animate-pulse`, which is opacity only, so `prefers-reduced-
 * motion` in globals.css neutralises it without leaving an invisible block.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={cn('animate-pulse rounded bg-surface-2', className)} style={style} aria-hidden />
  )
}

/**
 * Wraps a screenful of skeletons. Screen readers get one polite announcement
 * instead of reading out every placeholder block in the tree.
 */
export function SkeletonScreen({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** The POS board mid-load: tiles at the real card size, four to a row. */
export function ServiceGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <SkeletonScreen
      label="Loading the price board"
      className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-[6.5rem] flex-col justify-between rounded-xl border border-line bg-surface p-3">
          <div>
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="mt-2 h-2.5 w-3/5" />
          </div>
          <Skeleton className="h-4 w-2/5" />
        </div>
      ))}
    </SkeletonScreen>
  )
}

/**
 * Rows inside a panel that already has its own header and table head drawn.
 * `columns` widths are fractions so the skeleton lines up with the real
 * columns rather than sitting as one long bar.
 */
export function TableSkeleton({
  rows = 5,
  columns = ['40%', '12%', '18%', '18%', '12%'],
  label = 'Loading',
}: {
  rows?: number
  columns?: string[]
  label?: string
}) {
  return (
    <SkeletonScreen label={label} className="divide-y divide-line">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {columns.map((width, c) => (
            <Skeleton
              key={c}
              className="h-3.5"
              // First column is the name and hugs the left; the rest are
              // numbers, which are right-aligned in the real table.
              style={{ width, marginLeft: c === 0 ? undefined : 'auto' }}
            />
          ))}
        </div>
      ))}
    </SkeletonScreen>
  )
}

/** The Reports tab: four stat tiles over two chart panels. */
export function ReportsSkeleton() {
  return (
    <SkeletonScreen label="Loading the report" className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface px-4 py-3">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-3 h-7 w-28" />
          </div>
        ))}
      </div>

      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <Skeleton className="h-2.5 w-32" />
          </div>
          <div className="flex h-64 items-end gap-2 px-4 py-4">
            {/*
             * Bars of varying height rather than one grey slab: it reads as a
             * chart arriving, and it does not imply a flat result.
             */}
            {BAR_HEIGHTS.map((h, b) => (
              <Skeleton key={b} className="flex-1 rounded-sm" style={{ height: h }} />
            ))}
          </div>
        </div>
      ))}
    </SkeletonScreen>
  )
}

/**
 * The Settings catalog: category sections, each a heading over a price table.
 */
export function CatalogSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <SkeletonScreen label="Loading the service catalog" className="flex flex-col gap-7">
      {Array.from({ length: sections }, (_, s) => (
        <div key={s}>
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-24 rounded-lg" />
          </div>
          <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
            {Array.from({ length: 3 }, (_, r) => (
              <div key={r} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-3.5 w-48" />
                <div className="ml-auto flex gap-2">
                  {Array.from({ length: 5 }, (_, c) => (
                    <Skeleton key={c} className="h-6 w-14 rounded-md" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonScreen>
  )
}

/** A short stack of rows inside a dialog — inclusions, the size scale. */
export function ListSkeleton({
  rows = 6,
  label = 'Loading',
  className,
}: {
  rows?: number
  label?: string
  className?: string
}) {
  return (
    <SkeletonScreen label={label} className={cn('mt-4 flex flex-col gap-1.5', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 rounded-lg" />
      ))}
    </SkeletonScreen>
  )
}

/**
 * The panel that expands behind a roster row: two rows of stat tiles over a
 * pair of cards. It opens inline under the clicked name, so holding its real
 * height stops the rest of the roster jumping down and then back.
 */
export function EmployeeDetailSkeleton() {
  return (
    <SkeletonScreen label="Loading this employee's numbers" className="space-y-4 px-4 pb-5 pt-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-2.5 h-5 w-24" />
            <Skeleton className="mt-2 h-2 w-20" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-2 h-4 w-16" />
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="rounded-xl border border-line">
            <div className="border-b border-line px-3 py-2.5">
              <Skeleton className="h-2.5 w-28" />
            </div>
            <div className="divide-y divide-line">
              {Array.from({ length: 4 }, (_, r) => (
                <div key={r} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonScreen>
  )
}

// Fixed, not random: a re-render must not reshuffle the bars mid-load.
const BAR_HEIGHTS = ['42%', '68%', '55%', '81%', '48%', '73%', '60%', '88%', '52%', '66%']
