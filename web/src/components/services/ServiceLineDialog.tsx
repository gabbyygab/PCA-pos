'use client'

import { useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { CrewPicker } from '@/components/pos/CrewPicker'
import { useEmployees } from '@/lib/queries/employees'
import { useLineCrew, type ServiceLine, type ServiceTicket } from '@/lib/queries/services'
import { centavosToPesos, formatPeso, pesosToCentavos } from '@shared/lib/currency'
import {
  PAYMENT_LABELS,
  SERVICE_STATUS_LABELS,
  SERVICE_STATUSES,
  type PaymentMethod,
  type ServiceStatus,
} from '@shared/lib/domain'
import {
  bpToPercent,
  clampDiscountBp,
  formatRate,
  percentToBp,
} from '@shared/lib/pricing'

export interface ServiceLineEdit {
  quantity: number
  unitPriceCentavos: number
  employeeIds: string[]
  status: ServiceStatus
  /** The ticket's own fields, saved alongside the line. */
  paymentMethod: PaymentMethod
  /** Empty means "clear it" — both columns are nullable. */
  vehicleNote: string
  plateNumber: string
  /**
   * The promo on the whole ticket, in basis points. Like the three fields
   * above it belongs to the car rather than this line, but it is written by
   * its own RPC because it moves money on `sale_items`.
   */
  discountRateBp: number
}

interface ServiceLineDialogProps {
  line: ServiceLine
  ticket: ServiceTicket
  busy: boolean
  onClose: () => void
  onSave: (edit: ServiceLineEdit) => void
  /** Owner-only; absent for a cashier, who corrects with a refund instead. */
  onDelete?: () => void
}

/**
 * One service line, opened for correction.
 *
 * The Services tab's inline buttons cover the common case — a line finishes,
 * the crew taps Done. This is the uncommon one: the price was mistyped, the
 * quantity is wrong, or the car was worked by different people than the ticket
 * says. Doing it here rather than by voiding and re-ringing keeps the receipt
 * number and the timestamps the shop actually worked to.
 *
 * It also edits the three things that belong to the car rather than the line —
 * payment method, vehicle name, plate number — because there is nowhere else to
 * fix them, and a mis-tapped payment method misfiles a whole ticket's revenue in
 * the Reports breakdown. They save through a second RPC, `edit_sale_ticket`.
 *
 * Two fields are shown but never editable, for the same reason in both cases:
 * they are the record of what happened. The commission RATE is snapshotted at
 * sale time so that editing a rate in Settings cannot rewrite history, and
 * letting it be retyped here would reopen that hole from the other side. The
 * service NAME is what the receipt promised and what every per-service report
 * counts; renaming it in place would let one service quietly become another at
 * the same price. Both are corrected by refunding and re-ringing, which leaves
 * the mistake visible. The cut shown does update as the price and crew change,
 * because those it recomputes from.
 */
export function ServiceLineDialog({
  line,
  ticket,
  busy,
  onClose,
  onSave,
  onDelete,
}: ServiceLineDialogProps) {
  const { data: employees } = useEmployees()
  const { data: crew, isLoading: crewLoading } = useLineCrew(line.id)

  const [quantity, setQuantity] = useState(line.quantity)
  // Held as the typed string, not a number: parsing on every keystroke turns
  // "150." into 150 and fights the cursor mid-entry.
  const [price, setPrice] = useState(() => String(centavosToPesos(line.unit_price_centavos)))
  const [status, setStatus] = useState<ServiceStatus>(line.status)
  // Null until the line's crew has loaded, so an unopened picker cannot save an
  // empty roster over a real one.
  const [employeeIds, setEmployeeIds] = useState<string[] | null>(null)

  // The ticket's own fields. They belong to the car, not to this line, but
  // this modal is already the gesture for "these details are wrong", and a
  // cashier who notices the payment method mid-shift is looking at a line.
  const [payment, setPayment] = useState<PaymentMethod>(ticket.payment_method)
  const [vehicleNote, setVehicleNote] = useState(ticket.vehicle_note ?? '')
  const [plate, setPlate] = useState(ticket.plate_number ?? '')
  // The promo the line was sold under. One percentage covers the whole ticket,
  // so it is read off this line and written back across all of them.
  const [promo, setPromo] = useState(String(bpToPercent(line.discount_rate_bp) || ''))

  const loadedCrew = useMemo(
    () => (crew ?? []).map((c) => c.employee_id),
    [crew]
  )
  const selectedCrew = employeeIds ?? loadedCrew

  const parsedPrice = Number(price)
  const priceValid = price.trim() !== '' && Number.isFinite(parsedPrice) && parsedPrice >= 0
  const unitPriceCentavos = priceValid ? pesosToCentavos(parsedPrice) : line.unit_price_centavos

  const parsedPromo = promo.trim() === '' ? 0 : Number(promo)
  const promoValid =
    Number.isFinite(parsedPromo) && parsedPromo >= 0 && parsedPromo <= 100
  const discountRateBp = promoValid ? clampDiscountBp(percentToBp(parsedPromo)) : 0

  const lineTotal = unitPriceCentavos * quantity
  // Rounded down, mirroring create_sale — the shop never hands back more than
  // the promo promised.
  const discount = Math.floor((lineTotal * discountRateBp) / 10000)
  const netTotal = lineTotal - discount
  // Mirrors shareOfCommission(): rounded once, then each share rounded up, so
  // the figure here is the one payroll will pay.
  const commission = Math.round((lineTotal * line.commission_rate_bp) / 10000)
  const share = selectedCrew.length ? Math.ceil(commission / selectedCrew.length) : 0
  const paid = share * selectedCrew.length

  const crewValid = selectedCrew.length > 0
  const canSave = priceValid && promoValid && crewValid && !busy && !crewLoading

  function save() {
    if (!canSave) return
    onSave({
      quantity,
      unitPriceCentavos,
      employeeIds: selectedCrew,
      status,
      paymentMethod: payment,
      // Both are optional on the sale, so blank is a real answer — "clear it"
      // — rather than a validation failure.
      vehicleNote: vehicleNote.trim(),
      plateNumber: plate.trim(),
      discountRateBp,
    })
  }

  return (
    <Modal
      title={`#${ticket.receipt_no} · ${line.service_name}`}
      hint={`Rung up at ${new Date(ticket.sold_at).toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit',
      })}. Commission rate ${formatRate(line.commission_rate_bp)}, fixed when the sale was made.`}
      onClose={onClose}
      className="max-w-md"
      footer={
        <>
          {/* `mr-auto` pushes Delete away from Save: the destructive action
              must not sit under the thumb that is aiming for the safe one. */}
          {onDelete ? (
            <Button variant="danger" onClick={onDelete} disabled={busy} className="mr-auto">
              Delete
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="mt-4 space-y-3">
        {/* No name field. What was sold is the identity of the line — what
            the receipt promised and what "best performing services" counts.
            Renaming it in place would let a ₱1,000 Package 4 quietly become a
            "Carwash" at the same price with nothing showing the swap. Rung up
            wrong is a refund plus a re-ring, which leaves both facts visible.
            The name is already the modal's title, so this is one line saying
            why it is not typed rather than a field-shaped box repeating it. */}
        <p className="text-[11px] text-faint">
            Rung up as <span className="font-semibold text-muted">{line.service_name}</span>.
            Refund and re-ring to change what was sold.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Quantity" htmlFor="line-qty" required>
            <div className="flex items-center gap-1">
              <StepButton
                label="Decrease quantity"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
              >
                <Minus size={13} />
              </StepButton>
              <span
                id="line-qty"
                className="tnum w-10 text-center text-sm font-bold text-chalk"
              >
                {quantity}
              </span>
              <StepButton
                label="Increase quantity"
                onClick={() => setQuantity((q) => q + 1)}
              >
                <Plus size={13} />
              </StepButton>
            </div>
          </Field>

          <Field
            label="Unit price"
            htmlFor="line-price"
            required
            error={priceValid ? undefined : 'Enter an amount.'}
          >
            <Input
              id="line-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </Field>
        </div>

        <Field
          label={selectedCrew.length > 1 ? `Crew · ${selectedCrew.length}` : 'Crew'}
          htmlFor="line-crew"
          required
          error={crewValid ? undefined : 'Assign at least one employee.'}
          hint={
            selectedCrew.length > 1 ? 'The cut splits evenly among them.' : undefined
          }
        >
          {crewLoading ? (
            <p className="text-xs text-faint">Loading the crew…</p>
          ) : (
            <CrewPicker
              id="line-crew"
              employees={employees ?? []}
              selected={selectedCrew}
              onChange={setEmployeeIds}
            />
          )}
        </Field>

        <Field label="Status" htmlFor="line-status">
          <div className="flex gap-1.5" id="line-status">
            {SERVICE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  'flex-1 rounded-lg border px-2 py-2 text-[11px] font-semibold',
                  'transition-[transform,background-color,border-color,color] duration-150',
                  '[transition-timing-function:var(--ease-out-strong)] active:scale-[0.97]',
                  status === s
                    ? s === 'refunded'
                      ? 'border-red bg-red text-white'
                      : s === 'done'
                        ? 'border-emerald-500/50 bg-emerald-500/12 text-emerald-300'
                        : 'border-line-strong bg-surface-2 text-chalk'
                    : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
                )}
              >
                {SERVICE_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </Field>

        {/* The ticket, not the line. Ruled off and labelled so it is obvious
            these apply to the whole car: editing them from a line and
            having them silently change the ticket's other lines too would be
            the surprising reading. */}
        <div className="space-y-3 rounded-lg border border-line bg-surface-2/40 p-3">
          <p className="text-[10px] font-bold uppercase italic tracking-wider text-faint">
            Receipt #{ticket.receipt_no} · applies to the whole car
          </p>

          {/* One percentage covers the ticket, so a promo typed here rewrites
              every line's discount — never its commission. */}
          <Field
            label="Promo"
            htmlFor="ticket-promo"
            error={promoValid ? undefined : 'Enter 0 to 100.'}
            hint="Off the customer's total. The crew still earns the full rate."
          >
            <div className="relative">
              <Input
                id="ticket-promo"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={1}
                className="pr-7"
                value={promo}
                onChange={(e) => setPromo(e.target.value)}
                placeholder="0"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-faint">
                %
              </span>
            </div>
          </Field>

          <Field label="Payment method" htmlFor="ticket-payment">
            <Select
              id="ticket-payment"
              value={payment}
              onChange={setPayment}
              options={(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => ({
                value: m,
                label: PAYMENT_LABELS[m],
              }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Vehicle" htmlFor="ticket-vehicle" hint="Optional">
              <Input
                id="ticket-vehicle"
                value={vehicleNote}
                onChange={(e) => setVehicleNote(e.target.value)}
                placeholder="Toyota Vios"
              />
            </Field>

            <Field label="Plate number" htmlFor="ticket-plate" hint="Optional">
              <Input
                id="ticket-plate"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                placeholder="ABC 1234"
                autoCapitalize="characters"
                className="uppercase"
              />
            </Field>
          </div>
        </div>

        {/* What the edit is worth, recomputed as the fields change. Only a
            `done` line is revenue, so the summary says which of the two
            numbers is actually counting right now. */}
        <dl className="rounded-lg border border-line bg-surface-2 p-3 text-xs">
          {discountRateBp > 0 ? (
            <>
              <div className="flex items-baseline justify-between">
                <dt className="text-faint">Before promo</dt>
                <dd className="tnum font-semibold text-faint line-through">
                  {formatPeso(lineTotal)}
                </dd>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <dt className="text-faint">Promo ({bpToPercent(discountRateBp)}%)</dt>
                <dd className="tnum font-semibold text-red">−{formatPeso(discount)}</dd>
              </div>
            </>
          ) : null}
          <div
            className={cn(
              'flex items-baseline justify-between',
              discountRateBp > 0 && 'mt-1.5'
            )}
          >
            <dt className="text-faint">Line total</dt>
            <dd className="tnum font-bold text-chalk">{formatPeso(netTotal)}</dd>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <dt className="text-faint">
              Employee cut{selectedCrew.length > 1 ? ` · ${formatPeso(share)} each` : ''}
            </dt>
            <dd className="tnum font-semibold text-muted">{formatPeso(paid)}</dd>
          </div>
          {/* Stated outright, because it is the one number a reader will
              expect to have moved with the promo and which deliberately has not. */}
          {discountRateBp > 0 ? (
            <p className="mt-1.5 text-[11px] leading-snug text-faint">
              The cut is {formatRate(line.commission_rate_bp)} of the{' '}
              {formatPeso(lineTotal)} pre-promo price — a discount never comes out
              of the crew&rsquo;s pay.
            </p>
          ) : null}
          <p className="mt-2 border-t border-line pt-2 text-[11px] text-faint">
            {status === 'done'
              ? 'Counts toward sales and the crew’s commission.'
              : status === 'pending'
                ? 'Work in progress — counts toward neither until it is marked done.'
                : 'Refunded — the line stays on the ticket but the money does not count.'}
          </p>
        </dl>
      </div>
    </Modal>
  )
}

function StepButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex size-9 items-center justify-center rounded-md border border-line bg-surface-2 text-muted',
        'transition-[transform,color,border-color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
        'hover:border-line-strong hover:text-chalk active:scale-[0.94]',
        'disabled:pointer-events-none disabled:opacity-40'
      )}
    >
      {children}
    </button>
  )
}
