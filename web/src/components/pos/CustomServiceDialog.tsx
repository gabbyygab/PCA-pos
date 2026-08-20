'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { pesosToCentavos } from '@shared/lib/currency'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEFAULT_COMMISSION_BP,
  type ServiceCategory,
} from '@shared/lib/domain'

export interface CustomServiceDraft {
  name: string
  description: string
  centavos: number
  category: ServiceCategory
}

interface CustomServiceDialogProps {
  onCancel: () => void
  onConfirm: (draft: CustomServiceDraft) => void
}

/**
 * A one-off service typed at the counter.
 *
 * The shop occasionally does work that is not on the board and is not worth
 * adding to it — a favour, an odd job, a negotiated bundle. This rings that up
 * without touching the catalogue: the line carries its own name, note, and
 * price, and posts a null `service_id`, so Settings stays the record of what
 * the shop actually offers rather than filling with one-time entries.
 *
 * Commission still applies, at the chosen category's rate, because the crew
 * worked the car either way. The rate is not editable here — a cashier setting
 * their own cut is the owner's decision, and it lives in Settings.
 */
export function CustomServiceDialog({ onCancel, onConfirm }: CustomServiceDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState<ServiceCategory>('addon')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const pesos = Number.parseFloat(price)
  const namedOk = name.trim().length > 0
  const priceOk = Number.isFinite(pesos) && pesos > 0
  const valid = namedOk && priceOk

  function submit() {
    if (!valid) return
    onConfirm({
      name: name.trim(),
      description: description.trim(),
      centavos: pesosToCentavos(pesos),
      category,
    })
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <div
        // A modal is not anchored to a trigger, so it scales from its centre.
        className="w-full max-w-md scale-100 rounded-xl border border-line-strong bg-surface p-5 opacity-100 shadow-2xl transition-[opacity,transform] duration-200 [transition-timing-function:var(--ease-out-strong)] starting:scale-[0.96] starting:opacity-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Add a custom service"
      >
        <h2 className="board-head text-lg text-chalk">Custom Service</h2>
        <p className="mt-1 text-xs text-muted">
          One-off work that is not on the board. This sale only — nothing is added to
          the price board.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Service" htmlFor="custom-name" required>
            <Input
              ref={nameRef}
              id="custom-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="e.g. Undercarriage wash"
              maxLength={80}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="custom-description"
            hint="Optional. Prints with the service name on the ticket."
          >
            <Input
              id="custom-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="What was done"
              maxLength={120}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Price" htmlFor="custom-price" required>
              <Input
                id="custom-price"
                size="lg"
                numeric
                prefix={<span className="text-base font-bold">₱</span>}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                inputMode="decimal"
                placeholder="0.00"
              />
            </Field>

            <Field
              label="Rate"
              htmlFor="custom-category"
              hint={`Employee cut ${DEFAULT_COMMISSION_BP[category] / 100}%`}
            >
              <Select
                id="custom-category"
                size="lg"
                value={category}
                onChange={setCategory}
                options={CATEGORY_ORDER.map((c) => ({
                  value: c,
                  label: CATEGORY_LABELS[c],
                  detail: `${DEFAULT_COMMISSION_BP[c] / 100}%`,
                }))}
                aria-label="Commission category"
              />
            </Field>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" disabled={!valid} onClick={submit}>
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}
