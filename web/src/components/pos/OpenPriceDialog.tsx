'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { pesosToCentavos } from '@shared/lib/currency'

interface OpenPriceDialogProps {
  serviceName: string
  onCancel: () => void
  onConfirm: (centavos: number) => void
}

/**
 * Some board services carry no fixed price ("3500 AND UP", blank, "STARTING
 * 13K"), so the cashier types the agreed amount. We never invent a default.
 */
export function OpenPriceDialog({ serviceName, onCancel, onConfirm }: OpenPriceDialogProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const pesos = Number.parseFloat(value)
  const valid = Number.isFinite(pesos) && pesos > 0

  function submit() {
    if (!valid) return
    onConfirm(pesosToCentavos(pesos))
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <div
        // A modal is not anchored to a trigger, so it scales from its centre.
        className="w-full max-w-sm scale-100 rounded-xl border border-line-strong bg-surface p-5 opacity-100 shadow-2xl transition-[opacity,transform] duration-200 [transition-timing-function:var(--ease-out-strong)] starting:scale-[0.96] starting:opacity-0"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Price for ${serviceName}`}
      >
        <h2 className="board-head text-lg text-chalk">{serviceName}</h2>
        <p className="mt-1 text-xs text-muted">
          No fixed price on the board — enter the agreed amount.
        </p>

        <Input
          ref={inputRef}
          size="lg"
          numeric
          prefix={<span className="text-base font-bold">₱</span>}
          className="mt-4"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Price for ${serviceName}`}
        />

        <div className="mt-4 flex gap-2">
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
