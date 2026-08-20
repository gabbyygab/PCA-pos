'use client'

import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useOwnerGate } from '@/lib/auth/ownerGate'
import { useSession } from '@/lib/auth/session'

interface OwnerPasswordModalProps {
  /** What the owner is about to do — shown so the prompt is never a mystery. */
  action?: string
  onClose: () => void
  /** Runs once the password checks out. */
  onUnlocked: () => void
}

/**
 * Confirms the owner is physically present before pay is edited.
 *
 * A real `<form>` with a password input, so the browser and any password
 * manager treat it as the credential prompt it is, and Enter submits.
 */
export function OwnerPasswordModal({ action, onClose, onUnlocked }: OwnerPasswordModalProps) {
  const { email } = useSession()
  const { unlock } = useOwnerGate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await unlock(password)
      // Never leave the typed password sitting in state behind a closed modal.
      setPassword('')
      onUnlocked()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify that password.')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Owner approval"
      hint={
        action
          ? `${action} changes what an employee is paid. Confirm it is you.`
          : 'Editing pay changes what an employee is handed. Confirm it is you.'
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="mt-4">
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <ShieldCheck size={14} className="shrink-0 text-red" />
          <span className="truncate text-xs text-muted">{email ?? 'Not signed in'}</span>
        </div>

        <Field label="Owner password" htmlFor="owner-gate-password" error={error ?? undefined}>
          <Input
            id="owner-gate-password"
            type="password"
            autoComplete="current-password"
            value={password}
            invalid={Boolean(error)}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error) setError(null)
            }}
            placeholder="••••••••"
          />
        </Field>

        <p className="mt-2 text-[11px] text-faint">
          Stays unlocked for 5 minutes, then locks itself.
        </p>

        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-1" disabled={busy || !password}>
            {busy ? 'Checking…' : 'Unlock'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
