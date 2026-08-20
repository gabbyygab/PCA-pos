'use client'

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Size = 'sm' | 'md' | 'lg'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: Size
  /** Fixed adornment before the value — the ₱ on every money field. */
  prefix?: ReactNode
  /** Fixed adornment after the value — the % on commission rates. */
  suffix?: ReactNode
  invalid?: boolean
  /** Peso and rate fields want tabular figures so digits don't jitter while typing. */
  numeric?: boolean
}

const SIZES: Record<Size, { shell: string; text: string; pad: string }> = {
  sm: { shell: 'h-9', text: 'text-sm', pad: 'px-2' },
  md: { shell: 'h-10', text: 'text-sm', pad: 'px-3' },
  lg: { shell: 'h-12', text: 'text-lg font-bold', pad: 'px-3' },
}

/**
 * Text input.
 *
 * The border, not a ring, carries focus — a ring would collide with the POS
 * grid's tight gutters. Affixes sit inside the same shell as the field so the
 * ₱ reads as part of the value rather than as a floating label.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = 'md', prefix, suffix, invalid, numeric, disabled, ...props },
  ref
) {
  const s = SIZES[size]
  return (
    <div
      className={cn(
        // min-w-0 so the shell can shrink when it is itself a flex child
        // (e.g. sitting next to a fixed-width Button) instead of overflowing.
        'flex w-full min-w-0 items-center gap-1.5 rounded-lg border bg-surface-2',
        s.shell,
        s.pad,
        'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
        // Focus is drawn on the shell because the real input sits inside it.
        'focus-within:border-line-focus',
        invalid ? 'border-red/50' : 'border-line hover:border-line-strong',
        disabled && 'pointer-events-none opacity-40',
        className
      )}
    >
      {prefix ? (
        <span className="shrink-0 select-none text-xs text-faint">{prefix}</span>
      ) : null}
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full min-w-0 bg-transparent text-chalk outline-none placeholder:text-faint',
          s.text,
          numeric && 'tnum font-semibold'
        )}
        {...props}
      />
      {suffix ? (
        <span className="shrink-0 select-none text-xs text-faint">{suffix}</span>
      ) : null}
    </div>
  )
})
