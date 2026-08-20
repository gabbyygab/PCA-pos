import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PanelProps {
  children: ReactNode
  className?: string
}

export function Panel({ children, className }: PanelProps) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface', className)}>{children}</div>
  )
}

interface PanelHeaderProps {
  title: string
  /** Sits under the title — the sentence a new cashier needs, not decoration. */
  hint?: string
  action?: ReactNode
  className?: string
}

export function PanelHeader({ title, hint, action, className }: PanelHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-line px-4 py-3',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="board-label text-[11px] text-muted">{title}</h2>
        {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** The board's slanted red rule, used to open a major section. */
export function SlashRule({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-1.5 items-stretch gap-1 overflow-hidden', className)} aria-hidden>
      <div className="slant w-8 bg-red" />
      <div className="slant w-4 bg-red/60" />
      <div className="slant w-2 bg-red/30" />
    </div>
  )
}
