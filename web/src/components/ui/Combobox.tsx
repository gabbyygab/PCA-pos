'use client'

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComboboxOption<T extends string = string> {
  value: T
  label: string
  /** Secondary line — a rate, a size, whatever disambiguates two similar names. */
  detail?: string
  disabled?: boolean
}

type Size = 'sm' | 'md' | 'lg'

interface ComboboxProps<T extends string = string> {
  /** Chosen values, in the order they were picked. */
  value: readonly T[]
  onChange: (value: T[]) => void
  options: readonly ComboboxOption<T>[]
  /** Single-select closes and fills the input on commit; multi keeps the list open. */
  multiple?: boolean
  placeholder?: string
  /** Shown when the query matches nothing. */
  emptyMessage?: string
  size?: Size
  invalid?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
  className?: string
}

const SIZES: Record<Size, string> = {
  sm: 'min-h-9 px-2 text-sm',
  md: 'min-h-10 px-3 text-sm',
  lg: 'min-h-12 px-3 text-base',
}

/** Case- and accent-insensitive, so "jose" finds "José". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Searchable dropdown. Type to filter, pick one or many.
 *
 * `Select` is the right control for a short, fixed list — payment method, a
 * vehicle size. This is for lists that grow with the business: employees,
 * services, anything the owner keeps adding to in Settings. Past roughly a
 * dozen options, arrowing and typeahead stop being enough and the user needs
 * to actually search.
 *
 * Follows the WAI-ARIA combobox pattern, which differs from `Select`'s
 * listbox: focus lives in a real `<input>` (so typing is native and IME and
 * mobile keyboards work), while `aria-activedescendant` points at the
 * highlighted option. The input owns the combobox role; the list is its popup.
 */
export function Combobox<T extends string = string>({
  value,
  onChange,
  options,
  multiple = false,
  placeholder = 'Search…',
  emptyMessage = 'No matches.',
  size = 'md',
  invalid,
  disabled,
  id,
  className,
  ...aria
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [flip, setFlip] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const generatedId = useId()
  const fieldId = id ?? generatedId
  const listId = `${fieldId}-listbox`

  const chosen = useMemo(() => new Set(value), [value])

  // Matches anywhere in the label, not just the start: an employee is as
  // likely to be found by surname as by first name.
  const filtered = useMemo(() => {
    if (!query.trim()) return options
    const needle = normalize(query.trim())
    return options.filter(
      (o) => normalize(o.label).includes(needle) || normalize(o.detail ?? '').includes(needle)
    )
  }, [options, query])

  const firstEnabled = useCallback(
    (from: number, dir: 1 | -1) => {
      for (let i = from; i >= 0 && i < filtered.length; i += dir) {
        if (!filtered[i].disabled) return i
      }
      return -1
    },
    [filtered]
  )

  const openList = useCallback(() => {
    if (disabled) return
    setOpen(true)
  }, [disabled])

  const close = useCallback((refocus = true) => {
    setOpen(false)
    setActiveIndex(-1)
    setQuery('')
    if (refocus) inputRef.current?.focus()
  }, [])

  const commit = useCallback(
    (index: number) => {
      const option = filtered[index]
      if (!option || option.disabled) return

      if (multiple) {
        // Toggle, so tapping a chosen name removes it without leaving the list.
        onChange(
          chosen.has(option.value)
            ? value.filter((v) => v !== option.value)
            : [...value, option.value]
        )
        // Clear the query so the next name can be typed straight away, but
        // keep the list open — crews are picked two or three at a time.
        setQuery('')
        setActiveIndex(-1)
        inputRef.current?.focus()
        return
      }

      onChange([option.value])
      close()
    },
    [chosen, close, filtered, multiple, onChange, value]
  )

  const remove = useCallback(
    (target: T) => onChange(value.filter((v) => v !== target)),
    [onChange, value]
  )

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [close, open])

  // Same rationale as Select: the list is anchored to the control, so page
  // movement detaches it. Scrolling inside the list itself is fine.
  useEffect(() => {
    if (!open) return
    function onScroll(e: Event) {
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

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const needed = Math.min(filtered.length * 40 + 8, 288)
    setFlip(rect.bottom + needed > window.innerHeight && rect.top > needed)
  }, [filtered.length, open])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
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
        setActiveIndex(firstEnabled(filtered.length - 1, -1))
        return
      case 'Enter':
        e.preventDefault()
        // With one match left, Enter takes it even without arrowing down —
        // type three letters, press Enter, next name.
        if (activeIndex >= 0) commit(activeIndex)
        else if (filtered.length === 1) commit(0)
        return
      case 'Backspace':
        // Empty query: backspace peels the last chip off, like a mail client.
        if (query === '' && multiple && value.length > 0) {
          e.preventDefault()
          remove(value[value.length - 1])
        }
        return
    }
  }

  const selectedOptions = value
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is ComboboxOption<T> => o !== undefined)

  // Single-select shows its chosen label in the input; multi shows chips and
  // keeps the input as a pure search box.
  const inputValue = open || multiple ? query : (selectedOptions[0]?.label ?? '')

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div
        onPointerDown={(e) => {
          // Let the chip's own remove button win the press.
          if ((e.target as HTMLElement).closest('button')) return
          if (!open) openList()
          inputRef.current?.focus()
        }}
        className={cn(
          'flex w-full flex-wrap items-center gap-1.5 rounded-lg border bg-surface-2 py-1.5',
          SIZES[size],
          'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
          invalid ? 'border-red/50' : 'border-line hover:border-line-strong',
          open && 'border-red',
          disabled && 'pointer-events-none opacity-40'
        )}
      >
        {multiple
          ? selectedOptions.map((option) => (
              <span
                key={option.value}
                className="flex items-center gap-1 rounded-md border border-red/40 bg-red/12 py-0.5 pl-2 pr-1 text-xs font-semibold text-chalk"
              >
                {option.label}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Remove ${option.label}`}
                  onClick={() => remove(option.value)}
                  className="rounded text-faint transition-colors duration-150 hover:text-red"
                >
                  <X size={12} />
                </button>
              </span>
            ))
          : null}

        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={inputValue}
          placeholder={multiple && value.length > 0 ? '' : placeholder}
          onChange={(e) => {
            const next = e.target.value
            setQuery(next)
            if (!open) setOpen(true)
            // Highlight the first match as the query narrows, so Enter takes
            // the obvious row and never commits a leftover from the last
            // query. Computed here rather than in an effect -- deriving it
            // after render would cost a second pass on every keystroke.
            const needle = normalize(next.trim())
            const pool = needle
              ? options.filter(
                  (o) =>
                    normalize(o.label).includes(needle) ||
                    normalize(o.detail ?? '').includes(needle)
                )
              : options
            setActiveIndex(next.trim() ? pool.findIndex((o) => !o.disabled) : -1)
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-chalk outline-none',
            'placeholder:text-faint'
          )}
          {...aria}
        />

        <ChevronDown
          size={15}
          aria-hidden
          className={cn(
            'shrink-0 text-faint transition-transform duration-200 [transition-timing-function:var(--ease-out-strong)]',
            open && 'rotate-180 text-red'
          )}
        />
      </div>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={aria['aria-label']}
          aria-multiselectable={multiple || undefined}
          className={cn(
            'absolute z-50 max-h-72 w-full overflow-y-auto rounded-lg border border-line-strong bg-surface p-1 shadow-2xl',
            'origin-top scale-100 opacity-100 transition-[opacity,transform] duration-150',
            '[transition-timing-function:var(--ease-out-strong)] starting:scale-[0.98] starting:opacity-0',
            flip ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1'
          )}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-faint">{emptyMessage}</li>
          ) : (
            filtered.map((option, i) => {
              const isChosen = chosen.has(option.value)
              return (
                <li
                  key={option.value}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isChosen}
                  aria-disabled={option.disabled || undefined}
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
                  {isChosen ? (
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
