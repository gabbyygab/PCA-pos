import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FieldProps {
  /** Board-style caps label. Omit only when an adjacent heading already names the control. */
  label?: string
  /** The sentence a new cashier needs. Sits under the control, not above it. */
  hint?: string
  /** When set, the control renders in its invalid state and this replaces the hint. */
  error?: string
  /** Marks the field visually and for assistive tech. */
  required?: boolean
  /** Wired to the control via aria-describedby / htmlFor by the caller. */
  htmlFor?: string
  children: ReactNode
  className?: string
}

/**
 * The label + control + message wrapper every form field shares.
 *
 * Messages live *below* the control so the label never shifts as validation
 * appears — the field grows downward into empty space instead of pushing the
 * rest of the form around mid-typing.
 */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: FieldProps) {
  const message = error ?? hint
  return (
    <div className={cn('min-w-0', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="board-label block text-[10px] text-faint">
          {label}
          {required ? <span className="ml-1 not-italic text-red">*</span> : null}
        </label>
      ) : null}
      <div className={label ? 'mt-1.5' : undefined}>{children}</div>
      {message ? (
        <p
          id={htmlFor ? `${htmlFor}-msg` : undefined}
          className={cn('mt-1.5 text-[11px]', error ? 'text-red' : 'text-faint')}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
