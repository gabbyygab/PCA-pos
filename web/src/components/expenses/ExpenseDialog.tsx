'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { centavosToPesos, pesosToCentavos } from '@shared/lib/currency'
import type { Expense, ExpenseInput } from '@/lib/queries/expenses'

interface ExpenseDialogProps {
  /** The row being edited, or null to add a new one. */
  expense: Expense | null
  /** Day the "add" form opens on — whatever day the sheet is showing. */
  defaultDate: string
  /** Names already used, offered as one-tap fills so spellings stay consistent. */
  knownNames: string[]
  busy?: boolean
  onSubmit: (input: ExpenseInput) => void
  onClose: () => void
}

/**
 * Add or edit one expense.
 *
 * One dialog for both, because the fields are identical and a separate "edit"
 * form is a second place for the peso conversion to drift. The amount stays a
 * string in state and converts at the boundary with `pesosToCentavos` — binding
 * a peso input to a float is how a total starts ending in .0000001.
 */
export function ExpenseDialog({
  expense,
  defaultDate,
  knownNames,
  busy,
  onSubmit,
  onClose,
}: ExpenseDialogProps) {
  const editing = expense !== null

  const [name, setName] = useState(expense?.name ?? '')
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amount, setAmount] = useState(
    expense ? String(centavosToPesos(expense.amount_centavos)) : ''
  )
  const [spentOn, setSpentOn] = useState(expense?.spent_on ?? defaultDate)
  /* Only complain once they have tried to save — not while still typing. */
  const [tried, setTried] = useState(false)

  const parsedAmount = Number(amount)
  const amountValid = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0
  const nameValid = name.trim() !== ''
  const valid = amountValid && nameValid && spentOn !== ''

  // Suggestions the current query does not already match exactly, so the row
  // stops offering "Soap" once "Soap" is what is typed.
  const suggestions = useMemo(() => {
    const typed = name.trim().toLowerCase()
    return knownNames
      .filter((n) => n.toLowerCase() !== typed)
      .filter((n) => !typed || n.toLowerCase().includes(typed))
      .slice(0, 6)
  }, [knownNames, name])

  function submit() {
    setTried(true)
    if (!valid) return
    onSubmit({
      spentOn,
      name,
      description,
      amountCentavos: pesosToCentavos(parsedAmount),
    })
  }

  return (
    <Modal
      title={editing ? 'Edit expense' : 'Add expense'}
      hint={
        editing
          ? 'Changes apply to the day’s total and to net sales in Reports.'
          : 'Recorded against the day it was spent and deducted from that day’s gross.'
      }
      onClose={onClose}
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={busy || (tried && !valid)}
            onClick={submit}
          >
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}
          </Button>
        </>
      }
    >
      <div className="mt-4 flex flex-col gap-3.5">
        <Field
          label="Expense name"
          htmlFor="expense-name"
          required
          error={tried && !nameValid ? 'Give the expense a name.' : undefined}
          hint="Whatever the receipt says — Soap, Electricity, Hose repair."
        >
          <Input
            id="expense-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Soap"
            invalid={tried && !nameValid}
            aria-describedby="expense-name-msg"
          />
        </Field>

        {/* Past names as one-tap fills. Free text is the point — this only
            keeps "Electricity" from becoming three spellings that report as
            three separate lines. */}
        {suggestions.length > 0 ? (
          <div className="-mt-1.5 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setName(s)}
                className={cn(
                  'rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-muted',
                  'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
                  'hover:border-line-strong hover:text-chalk'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex gap-3">
          <Field
            label="Amount"
            htmlFor="expense-amount"
            required
            className="flex-1"
            error={tried && !amountValid ? 'Enter an amount above zero.' : undefined}
          >
            <Input
              id="expense-amount"
              size="lg"
              numeric
              prefix="₱"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="0.00"
              invalid={tried && !amountValid}
              aria-describedby="expense-amount-msg"
            />
          </Field>

          <Field label="Date spent" htmlFor="expense-date" required className="w-[9.5rem]">
            {/*
             * A native date input, as in Reports: the field is ours to style
             * and the OS calendar handles month lengths and locales better
             * than a hand-rolled one would. The `<select>` ban does not apply —
             * that is about an OS-drawn popup replacing the field itself.
             */}
            <input
              id="expense-date"
              type="date"
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
              className={cn(
                'tnum h-12 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-chalk',
                'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
                'hover:border-line-strong focus:border-red focus:outline-none',
                // The picker glyph is drawn black-on-black by the webview otherwise.
                '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:invert'
              )}
            />
          </Field>
        </div>

        <Field
          label="Description"
          htmlFor="expense-description"
          hint="Optional — which supplier, which repair, which shift."
        >
          <textarea
            id="expense-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="2 gallons from the Rosario supplier"
            className={cn(
              'w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-chalk',
              'placeholder:text-faint',
              'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
              'hover:border-line-strong focus:border-line-focus focus:outline-none'
            )}
          />
        </Field>
      </div>
    </Modal>
  )
}
