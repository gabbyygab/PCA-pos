'use client'

import { useState, type FormEvent } from 'react'
import { KeyRound, ShieldCheck, UserCog } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Panel, PanelHeader, SlashRule } from '@/components/ui/Panel'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useSession } from '@/lib/auth/session'
import {
  useAccounts,
  useChangeOwnPassword,
  useSetAccountPassword,
  type AccountRow,
} from '@/lib/queries/accounts'

/** The shortest password Postgres will accept; the dialog says so up front. */
const MIN_LENGTH = 8

export function AccountsTab() {
  const { email, isOwner } = useSession()
  const { data: accounts, isLoading } = useAccounts(isOwner)
  const [changingOwn, setChangingOwn] = useState(false)
  const [changingOther, setChangingOther] = useState<AccountRow | null>(null)

  // A cashier can reach this tab only by editing the bundle, but the boundary
  // is stated here anyway: RLS refuses them either way, and an honest message
  // beats an empty list that looks like a bug.
  if (!isOwner) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <ShieldCheck size={22} className="mx-auto text-faint" aria-hidden />
          <p className="mt-3 text-sm text-muted">Only the owner can manage accounts.</p>
        </div>
      </div>
    )
  }

  const self = (accounts ?? []).find((a) => a.is_self) ?? null
  const others = (accounts ?? []).filter((a) => !a.is_self)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line px-6 pb-5 pt-5">
        <SlashRule className="mb-3" />
        <h1 className="board-head text-2xl text-chalk">Accounts</h1>
        <p className="mt-1 text-xs text-muted">
          The two sign-ins for this shop. Changing a password signs that account out everywhere.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <Panel>
            <PanelHeader
              title="Your account"
              hint="You will be asked for your current password first."
            />
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <p className="truncate text-sm text-chalk">{self?.email ?? email ?? '—'}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-faint">Owner</p>
              </div>
              <Button size="sm" variant="primary" onClick={() => setChangingOwn(true)}>
                <KeyRound size={15} />
                Change password
              </Button>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Cashier account"
              hint="Set a new password without knowing the old one — for when a cashier forgets it, or leaves."
            />
            {isLoading ? (
              <div className="px-4 py-4">
                <ListSkeleton />
              </div>
            ) : others.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-faint">
                No other accounts. New sign-ins are created in Supabase.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {others.map((account) => (
                  <li
                    key={account.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-chalk">{account.email}</p>
                      <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-faint">
                        {account.role}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => setChangingOther(account)}>
                      <UserCog size={15} />
                      Set password
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <p className="px-1 text-[11px] leading-relaxed text-faint">
            Passwords are stored by Supabase as one-way hashes — nobody, including this screen,
            can read an existing one. That is why a forgotten cashier password is replaced rather
            than looked up.
          </p>
        </div>
      </div>

      {changingOwn ? (
        <OwnPasswordModal
          email={self?.email ?? email ?? ''}
          onClose={() => setChangingOwn(false)}
        />
      ) : null}

      {changingOther ? (
        <OtherPasswordModal account={changingOther} onClose={() => setChangingOther(null)} />
      ) : null}
    </div>
  )
}

/** Shared strength/typo checks, so both dialogs refuse the same things. */
function validate(next: string, confirm: string): string | null {
  if (next.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`
  if (next !== confirm) return 'The two passwords do not match.'
  return null
}

function OwnPasswordModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const change = useChangeOwnPassword()
  const { toast } = useToast()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (change.isPending) return

    const invalid = validate(next, confirm)
    if (invalid) {
      setError(invalid)
      return
    }
    if (next === current) {
      setError('That is already your password. Choose a different one.')
      return
    }

    try {
      await change.mutateAsync({ email, currentPassword: current, newPassword: next })
      // Never leave typed credentials sitting in state behind a closed dialog.
      setCurrent('')
      setNext('')
      setConfirm('')
      toast({ message: 'Your password was changed', tone: 'success' })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.')
    }
  }

  return (
    <Modal
      title="Change your password"
      hint="This is the account you are signed in as right now."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="mt-4">
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <ShieldCheck size={14} className="shrink-0 text-red" aria-hidden />
          <span className="truncate text-xs text-muted">{email}</span>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Current password" htmlFor="own-current">
            <Input
              id="own-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value)
                if (error) setError(null)
              }}
              placeholder="••••••••"
            />
          </Field>

          <Field label="New password" htmlFor="own-next" hint={`At least ${MIN_LENGTH} characters.`}>
            <Input
              id="own-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => {
                setNext(e.target.value)
                if (error) setError(null)
              }}
              placeholder="••••••••"
            />
          </Field>

          <Field label="Confirm new password" htmlFor="own-confirm" error={error ?? undefined}>
            <Input
              id="own-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              invalid={Boolean(error)}
              onChange={(e) => {
                setConfirm(e.target.value)
                if (error) setError(null)
              }}
              placeholder="••••••••"
            />
          </Field>
        </div>

        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="flex-1"
            disabled={change.isPending || !current || !next || !confirm}
          >
            {change.isPending ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function OtherPasswordModal({
  account,
  onClose,
}: {
  account: AccountRow
  onClose: () => void
}) {
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const set = useSetAccountPassword()
  const { toast } = useToast()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (set.isPending) return

    const invalid = validate(next, confirm)
    if (invalid) {
      setError(invalid)
      return
    }

    try {
      await set.mutateAsync({ userId: account.id, newPassword: next })
      setNext('')
      setConfirm('')
      toast({
        message: `Password set for ${account.email}`,
        detail: 'That account was signed out on every device.',
        tone: 'success',
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password.')
    }
  }

  return (
    <Modal
      title="Set cashier password"
      hint="Tell the cashier the new password — this screen cannot show it again."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="mt-4">
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <UserCog size={14} className="shrink-0 text-red" aria-hidden />
          <span className="truncate text-xs text-muted">{account.email}</span>
        </div>

        <div className="flex flex-col gap-3">
          <Field
            label="New password"
            htmlFor="other-next"
            hint={`At least ${MIN_LENGTH} characters.`}
          >
            <Input
              id="other-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => {
                setNext(e.target.value)
                if (error) setError(null)
              }}
              placeholder="••••••••"
            />
          </Field>

          <Field label="Confirm new password" htmlFor="other-confirm" error={error ?? undefined}>
            <Input
              id="other-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              invalid={Boolean(error)}
              onChange={(e) => {
                setConfirm(e.target.value)
                if (error) setError(null)
              }}
              placeholder="••••••••"
            />
          </Field>
        </div>

        <p
          className={cn(
            'mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2',
            'text-[11px] leading-relaxed text-faint'
          )}
        >
          The cashier phone is signed out immediately and needs the new password to ring up again.
          Do this when someone is there to receive it.
        </p>

        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="flex-1"
            disabled={set.isPending || !next || !confirm}
          >
            {set.isPending ? 'Setting…' : 'Set password'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
