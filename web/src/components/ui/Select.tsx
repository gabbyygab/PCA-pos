'use client'

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  /** Secondary line — a rate, a size, whatever disambiguates two similar names. */
  detail?: string
  disabled?: boolean
}

type Size = 'sm' | 'md' | 'lg'

interface SelectProps<T extends string = string> {
  value: T | ''
  onChange: (value: T) => void
  options: readonly SelectOption<T>[]
  /** Shown when nothing is chosen. Not a selectable option — use a real option for "none". */
  placeholder?: string
  size?: Size
  invalid?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
  className?: string
  /** Rendered instead of the label when a value is chosen — for richer triggers. */
  renderValue?: (option: SelectOption<T>) => ReactNode
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-2 text-sm',
  md: 'h-10 px-3 text-sm',
  lg: 'h-12 px-3 text-base',
}

/**
 * Dropdown replacing the native `<select>`.
 *
 * Native selects render an OS-drawn popup — on Windows a white list with system
 * fonts — which is unstyleable and breaks the board's black-and-red surface
 * hard. This draws the list itself.
 *
 * Behaviour follows the WAI-ARIA listbox pattern: the trigger owns the ARIA and
 * the roving `aria-activedescendant`, so focus never leaves it and screen
 * readers announce each option as the user arrows through.
 */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  size = 'md',
  invalid,
  disabled,
  id,
  className,
  renderValue,
  ...aria
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [flip, setFlip] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeahead = useRef({ query: '', at: 0 })

  const generatedId = useId()
  const listId = `${id ?? generatedId}-listbox`
  const selected = options.find((o) => o.value === value)

  const firstEnabled = useCallback(
    (from: number, dir: 1 | -1) => {
      for (let i = from; i >= 0 && i < options.length; i += dir) {
        if (!options[i].disabled) return i
      }
      return -1
    },
    [options]
  )

  const openList = useCallback(() => {
    if (disabled) return
    const current = options.findIndex((o) => o.value === value)
    // Open onto the current value so the list starts where the user left it.
    setActiveIndex(current >= 0 && !options[current].disabled ? current : firstEnabled(0, 1))
    setOpen(true)
  }, [disabled, firstEnabled, options, value])

  const close = useCallback((refocus = true) => {
    setOpen(false)
    setActiveIndex(-1)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option || option.disabled) return
      onChange(option.value)
      close()
    },
    [close, onChange, options]
  )

  // Dismiss on outside pointer-down (not click) so the list closes on press,
  // matching how native menus feel.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [close, open])

  // A scroll or resize invalidates the anchored position; closing beats
  // tracking it, and the POS panels scroll under fixed chrome anyway.
  useEffect(() => {
    if (!open) return
    function onScroll(e: Event) {
      // Scrolling *within* the list (arrowing through a long employee list, or
      // a wheel over the options) must not dismiss it — only the page moving
      // underneath detaches the list from its trigger.
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return
      close(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [close, open])

  // Flip above the trigger when the list would run past the viewport bottom.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const needed = Math.min(options.length * 40 + 8, 288)
    setFlip(rect.bottom + needed > window.innerHeight && rect.top > needed)
  }, [open, options.length])

  // Keep the active option in view during keyboard traversal.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openList()
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close()
        return
      case 'Tab':
        // Tab commits nothing — it just dismisses and lets focus move on.
        close(false)
        return
      case 'ArrowDown': {
        e.preventDefault()
        const next = firstEnabled(activeIndex + 1, 1)
        if (next >= 0) setActiveIndex(next)
        return
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = firstEnabled(activeIndex - 1, -1)
        if (prev >= 0) setActiveIndex(prev)
        return
      }
      case 'Home':
        e.preventDefault()
        setActiveIndex(firstEnabled(0, 1))
        return
      case 'End':
        e.preventDefault()
        setActiveIndex(firstEnabled(options.length - 1, -1))
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(activeIndex)
        return
    }

    // Typeahead: printable keys jump to the next option starting with the
    // accumulated query. Employee lists get long; typing "ma" beats arrowing.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now()
      const t = typeahead.current
      t.query = now - t.at > 700 ? e.key : t.query + e.key
      t.at = now

      const q = t.query.toLowerCase()
      // Repeating one letter cycles through matches instead of filtering harder.
      const cycling = t.query.length > 1 && t.query.split('').every((c) => c === t.query[0])
      const needle = cycling ? t.query[0].toLowerCase() : q
      const start = cycling ? activeIndex + 1 : 0

      for (let i = 0; i < options.length; i++) {
        const idx = (start + i) % options.length
        const option = options[idx]
        if (!option.disabled && option.label.toLowerCase().startsWith(needle)) {
          setActiveIndex(idx)
          break
        }
      }
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border bg-surface-2 text-left',
          SIZES[size],
          'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
          invalid ? 'border-red/50' : 'border-line hover:border-line-strong',
          open && 'border-red',
          disabled && 'pointer-events-none opacity-40'
        )}
        {...aria}
      >
        <span className={cn('truncate', selected ? 'text-chalk' : 'text-faint')}>
          {selected ? (renderValue ? renderValue(selected) : selected.label) : placeholder}
        </span>
        <ChevronDown
          size={15}
          aria-hidden
          className={cn(
            'shrink-0 text-faint transition-transform duration-200 [transition-timing-function:var(--ease-out-strong)]',
            open && 'rotate-180 text-red'
          )}
        />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={aria['aria-label']}
          className={cn(
            'absolute z-50 max-h-72 w-full overflow-y-auto rounded-lg border border-line-strong bg-surface p-1 shadow-2xl',
            // The list belongs to the trigger, so it grows *from* the trigger edge.
            'origin-top scale-100 opacity-100 transition-[opacity,transform] duration-150',
            '[transition-timing-function:var(--ease-out-strong)] starting:scale-[0.98] starting:opacity-0',
            flip ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1'
          )}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-faint">Nothing to choose yet.</li>
          ) : (
            options.map((option, i) => {
              const isSelected = option.value === value
              return (
                <li
                  key={option.value}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  // Pointer-down would fire before the click that commits, so
                  // selection is on click; hover only moves the active row.
                  onClick={() => commit(i)}
                  onPointerMove={() => !option.disabled && setActiveIndex(i)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm',
                    option.disabled && 'cursor-not-allowed text-faint',
                    !option.disabled && activeIndex === i && 'bg-surface-2 text-chalk',
                    !option.disabled && activeIndex !== i && 'text-muted'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                    {option.detail ? (
                      <span className="ml-2 text-[11px] text-faint">{option.detail}</span>
                    ) : null}
                  </span>
                  {isSelected ? (
                    <Check size={14} className="shrink-0 text-red" aria-hidden />
                  ) : null}
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}
