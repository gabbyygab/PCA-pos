'use client'

import { Minus, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { CrewPicker } from './CrewPicker'
import { formatPeso } from '@shared/lib/currency'
import { PAYMENT_LABELS, type PaymentMethod } from '@shared/lib/domain'
import {
  bpToPercent,
  cartCommissionPaid,
  cartDiscount,
  cartNetTotal,
  cartShare,
  cartTotal,
  clampDiscountBp,
  hasPromo,
  lineTotal,
  percentToBp,
  type CartLine,
} from '@shared/lib/pricing'
import type { Employee } from '@/lib/queries/employees'

interface CartProps {
  lines: CartLine[]
  /** The size label as it will be printed on the sale. */
  sizeLabel: string | null
  employees: Employee[]
  /** The crew who worked the car; commission splits evenly among them. */
  employeeIds: string[]
  onEmployeeChange: (ids: string[]) => void
  payment: PaymentMethod
  onPaymentChange: (method: PaymentMethod) => void
  plate: string
  onPlateChange: (plate: string) => void
  /** What the vehicle is — "Toyota Vios". Free text, optional. */
  vehicleNote: string
  onVehicleNoteChange: (note: string) => void
  /** A promo off the whole ticket, in basis points (2000 = 20%). */
  discountRateBp: number
  onDiscountChange: (bp: number) => void
  onQuantityChange: (serviceId: string, quantity: number) => void
  onRemove: (serviceId: string) => void
  onClear: () => void
  onSubmit: () => void
  isSaving: boolean
}

export function Cart({
  lines,
  sizeLabel,
  employees,
  employeeIds,
  onEmployeeChange,
  payment,
  onPaymentChange,
  plate,
  onPlateChange,
  vehicleNote,
  onVehicleNoteChange,
  discountRateBp,
  onDiscountChange,
  onQuantityChange,
  onRemove,
  onClear,
  onSubmit,
  isSaving,
}: CartProps) {
  const total = cartTotal(lines)
  const crewSize = employeeIds.length
  // Deliberately computed off the undiscounted cart: the promo is the shop's
  // concession to the customer, never the crew's. Postgres applies the same
  // rule, so this preview matches what the sale will store.
  const commission = cartCommissionPaid(lines, crewSize)
  const perPerson = cartShare(lines, crewSize)
  const discount = cartDiscount(lines, discountRateBp)
  const netTotal = cartNetTotal(lines, discountRateBp)
  const promoOn = hasPromo(discountRateBp)
  const canSubmit = lines.length > 0 && crewSize > 0 && !isSaving

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="board-label text-[11px] text-muted">
          Current Sale{sizeLabel ? ` · ${sizeLabel}` : ''}
        </h2>
        {lines.length > 0 ? (
          <button
            onClick={onClear}
            className="text-[11px] font-semibold text-faint transition-colors duration-150 hover:text-red"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm leading-relaxed text-faint">
              Pick a service to start.
              <br />
              Totals appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((line) => (
              <li key={line.serviceId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug text-chalk">
                      {line.serviceName}
                    </p>
                    {/* Custom lines carry a typed note; it prints with the name. */}
                    {line.description ? (
                      <p className="mt-0.5 text-[11px] leading-snug text-faint">
                        {line.description}
                      </p>
                    ) : null}
                  </div>
                  <button
                    onClick={() => onRemove(line.serviceId)}
                    aria-label={`Remove ${line.serviceName}`}
                    className="mt-0.5 shrink-0 text-faint transition-colors duration-150 hover:text-red"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <QtyButton
                      label={`Decrease ${line.serviceName}`}
                      onClick={() => onQuantityChange(line.serviceId, line.quantity - 1)}
                    >
                      <Minus size={12} />
                    </QtyButton>
                    <span className="tnum w-7 text-center text-sm font-semibold text-chalk">
                      {line.quantity}
                    </span>
                    <QtyButton
                      label={`Increase ${line.serviceName}`}
                      onClick={() => onQuantityChange(line.serviceId, line.quantity + 1)}
                    >
                      <Plus size={12} />
                    </QtyButton>
                  </div>
                  <span className="tnum text-sm font-bold text-chalk">
                    {formatPeso(lineTotal(line))}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line p-4">
        <Field
          label={crewSize > 1 ? `Crew · ${crewSize}` : 'Crew'}
          htmlFor="cart-crew"
          required
          error={
            lines.length > 0 && crewSize === 0 ? 'Assign at least one employee.' : undefined
          }
          hint={crewSize > 1 ? 'The cut splits evenly among them.' : undefined}
        >
          <CrewPicker
            id="cart-crew"
            employees={employees}
            selected={employeeIds}
            onChange={onEmployeeChange}
          />
        </Field>

        {/* The vehicle gets the full width and sits first: it is the longest
            of the three values and the one a name is actually read from. */}
        <div className="mt-3">
          <Field label="Vehicle" htmlFor="cart-vehicle">
            <Input
              id="cart-vehicle"
              value={vehicleNote}
              onChange={(e) => onVehicleNoteChange(e.target.value)}
              placeholder="e.g. Toyota Vios"
            />
          </Field>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Plate" htmlFor="cart-plate">
            <Input
              id="cart-plate"
              value={plate}
              onChange={(e) => onPlateChange(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Payment" htmlFor="cart-payment">
            <Select
              id="cart-payment"
              value={payment}
              onChange={onPaymentChange}
              options={(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => ({
                value: m,
                label: PAYMENT_LABELS[m],
              }))}
              aria-label="Payment method"
            />
          </Field>
        </div>

        {/* The promo sits with the money, not with the vehicle fields: it
            changes the total, and the cashier types it while reading the
            total back to the customer. */}
        <div className="mt-3">
          <Field
            label="Promo"
            htmlFor="cart-promo"
            hint={promoOn ? 'Off the customer’s total. The crew still earns the full rate.' : undefined}
          >
            <div className="relative">
              <Input
                id="cart-promo"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={1}
                className="pr-7"
                value={discountRateBp === 0 ? '' : String(bpToPercent(discountRateBp))}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  if (raw === '') return onDiscountChange(0)
                  const pct = Number(raw)
                  if (!Number.isFinite(pct)) return
                  // Clamped here as well as in Postgres so the preview can
                  // never show a total the RPC would refuse to write.
                  onDiscountChange(clampDiscountBp(percentToBp(Math.min(Math.max(pct, 0), 100))))
                }}
                placeholder="0"
                aria-label="Promo discount percent"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-faint">
                %
              </span>
            </div>
          </Field>
        </div>

        <dl className="mt-4 space-y-1.5">
          {promoOn ? (
            <>
              <div className="flex items-baseline justify-between">
                <dt className="text-xs text-faint">Subtotal</dt>
                <dd className="tnum text-xs font-semibold text-muted line-through">
                  {formatPeso(total)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-xs text-faint">Promo ({bpToPercent(discountRateBp)}%)</dt>
                <dd className="tnum text-xs font-semibold text-red">−{formatPeso(discount)}</dd>
              </div>
            </>
          ) : null}
          <div className="flex items-baseline justify-between">
            <dt className="text-xs text-faint">Employee cut</dt>
            <dd className="tnum text-xs font-semibold text-muted">{formatPeso(commission)}</dd>
          </div>
          {crewSize > 1 ? (
            <div className="flex items-baseline justify-between">
              <dt className="text-xs text-faint">Each ({crewSize})</dt>
              <dd className="tnum text-xs font-semibold text-muted">
                {formatPeso(perPerson)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between border-t border-line pt-2">
            <dt className="board-label text-[11px] text-muted">Total</dt>
            {/* What the customer owes — the promo already taken off. */}
            <dd className="tnum text-2xl font-extrabold text-red">{formatPeso(netTotal)}</dd>
          </div>
        </dl>

        <Button
          variant="primary"
          size="lg"
          className="mt-3 w-full"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {isSaving ? 'Saving…' : 'Confirm Sale'}
        </Button>
      </div>
    </aside>
  )
}

function QtyButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex size-7 items-center justify-center rounded-md border border-line bg-surface-2 text-muted',
        'transition-[transform,color,border-color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
        'hover:border-line-strong hover:text-chalk active:scale-[0.94]'
      )}
    >
      {children}
    </button>
  )
}
