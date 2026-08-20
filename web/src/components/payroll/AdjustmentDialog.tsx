'use client'

import { useState, type FormEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { formatPeso, pesosToCentavos } from '@shared/lib/currency'
import type { Tables } from '@shared/types/database'

export interface AdjustmentDraft {
  employeeId: string
  amountCentavos: number
  reason: string
}

interface AdjustmentDialogProps {
  /** Editing an existing row, or null when adding a new one. */
  existing?: Tables<'payroll_adjustments'> | null
  /** Preselected employee when opened from a row's own menu. */
  employeeId?: string
  employees: readonly { id: string; name: string }[]
  /** Spelled-out week, so the owner cannot mis-file a bonus into a neighbouring week. */
  periodLabel: string
  /** The computed cut, used to warn when a deduction exceeds what is owed. */
  commissionCentavos?: number
  busy?: boolean
  onSubmit: (draft: AdjustmentDraft) => void
  onClose: () => void
}

type Direction = 'bonus' | 'deduction'

/**
 * Add or edit one manual adjustment.
 *
 * Direction is a pair of buttons rather than a minus sign typed into the
 * amount: "-200" is easy to fat-finger into "200", and the difference between
 * a bonus and a deduction is 400 pesos of someone's pay. The field itself
 * therefore only ever holds a positive number, and the sign comes from an
 * explicit, visible choice.
 */
export function AdjustmentDialog({
  existing,
  employeeId,
  employees,
  periodLabel,
  commissionCentavos,
  busy,
  onSubmit,
  onClose,
}: AdjustmentDialogProps) {
  const [selected, setSelected] = useState<string[]>(() => {
    const initial = existing?.employee_id ?? employeeId
    return initial ? [initial] : []
  })
  const [direction, setDirection] = useState<Direction>(() =>
    existing && existing.amount_centavos < 0 ? 'deduction' : 'bonus'
  )
  const [amount, setAmount] = useState(() =>
    existing ? String(Math.abs(existing.amount_centavos) / 100) : ''
  )
  const [reason, setReason] = useState(() => existing?.reason ?? '')
  const [error, setError] = useState<string | null>(null)

  const pesos = Number(amount)
  const validAmount = amount.trim() !== '' && Number.isFinite(pesos) && pesos > 0
  const magnitude = validAmount ? pesosToCentavos(pesos) : 0
  const signed = direction === 'deduction' ? -magnitude : magnitude

  // A deduction bigger than the week's earnings is allowed — the shop may
  // genuinely be owed more than the week paid — but it must not be silent.
  const overDeducts =
    commissionCentavos !== undefined &&
    direction === 'deduction' &&
    magnitude > commissionCentavos

  function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return

    if (selected.length === 0) return setError('Choose the employee this applies to.')
    if (!validAmount) return setError('Enter an amount greater than zero.')
    if (!reason.trim()) return setError('A reason is required — this is a change to someone’s pay.')

    onSubmit({ employeeId: selected[0], amountCentavos: signed, reason: reason.trim() })
  }

  return (
    <Modal
      title={existing ? 'Edit adjustment' : 'Add adjustment'}
      hint={`Applies to ${periodLabel}. The sale history is not touched.`}
      onClose={onClose}
      className="max-w-md"
    >
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Employee" htmlFor="adj-employee" required>
          <Combobox
            id="adj-employee"
            value={selected}
            onChange={(next) => {
              setSelected(next)
              setError(null)
            }}
            options={employees.map((e) => ({ value: e.id, label: e.name }))}
            placeholder="Search employees…"
            emptyMessage="No employee by that name."
            aria-label="Employee this adjustment applies to"
          />
        </Field>

        <div>
          <span className="board-label block text-[10px] text-faint">
            Direction<span className="ml-1 not-italic text-red">*</span>
          </span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <DirectionButton
              active={direction === 'bonus'}
              onClick={() => setDirection('bonus')}
              icon={<Plus size={14} />}
              label="Bonus"
              hint="Adds to pay"
              tone="good"
            />
            <DirectionButton
              active={direction === 'deduction'}
              onClick={() => setDirection('deduction')}
              icon={<Minus size={14} />}
              label="Deduction"
              hint="Subtracts"
              tone="red"
            />
          </div>
        </div>

        <Field label="Amount" htmlFor="adj-amount" required>
          <Input
            id="adj-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            numeric
            prefix="₱"
            value={amount}
            invalid={amount.trim() !== '' && !validAmount}
            onChange={(e) => {
              setAmount(e.target.value)
              setError(null)
            }}
            placeholder="0.00"
          />
        </Field>

        <Field
          label="Reason"
          htmlFor="adj-reason"
          required
          hint="Printed on the payslip, so the employee can see why."
        >
          <Input
            id="adj-reason"
            value={reason}
            maxLength={120}
            onChange={(e) => {
              setReason(e.target.value)
              setError(null)
            }}
            placeholder="Sunday overtime"
          />
        </Field>

        {validAmount ? (
          <div
            className={cn(
              'rounded-lg border px-3 py-2 text-xs',
              direction === 'deduction'
                ? 'border-red/30 bg-red/10 text-red'
                : 'border-good/30 bg-good/10 text-good'
            )}
          >
            <span className="font-semibold">
              {direction === 'deduction' ? '−' : '+'}
              {formatPeso(magnitude)}
            </span>{' '}
            <span className="opacity-80">
              {direction === 'deduction' ? 'off this week’s pay' : 'on top of this week’s cut'}
            </span>
            {overDeducts ? (
              <p className="mt-1 text-[11px] text-warn">
                Larger than the {formatPeso(commissionCentavos!)} earned this week — the payslip
                will show ₱0.00 and the rest stays owed.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-[11px] font-semibold text-red">{error}</p> : null}

        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-1" disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Add adjustment'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function DirectionButton({
  active,
  onClick,
  icon,
  label,
  hint,
  tone,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  hint: string
  tone: 'good' | 'red'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left outline-none',
        'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
        'focus-visible:ring-2 focus-visible:ring-red/60',
        active
          ? tone === 'good'
            ? 'border-good/50 bg-good/10 text-good'
            : 'border-red/50 bg-red/10 text-red'
          : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:text-chalk'
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-bold">
        {icon}
        {label}
      </span>
      <span className="text-[10px] opacity-70">{hint}</span>
    </button>
  )
}
