'use client'

import { useState, type FormEvent } from 'react'
import Image from 'next/image'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Panel, SlashRule } from '@/components/ui/Panel'
import { createClient } from '@/lib/supabase/client'

/**
 * Sign-in gate.
 *
 * Every table is behind row-level security that reads the role off the JWT, so
 * without a session the app can read nothing and write nothing — this screen is
 * what makes the rest of the dashboard functional, not just protected.
 */
export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const { error } = await createClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      // Supabase returns the same message for a bad email and a bad password,
      // which is what we want to show — it does not leak which one was wrong.
      setError(error.message)
      setBusy(false)
      return
    }
    // On success the provider's auth listener swaps this screen for the shell;
    // leaving `busy` set avoids a flash of the enabled button in between.
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
            <Image
              src="/logo.png.png"
              alt="PCA Premium Auto Care"
              width={48}
              height={48}
              priority
              className="size-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <p className="board-head truncate text-xl text-chalk">PCA</p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-faint">General Trias</p>
          </div>
        </div>

        <Panel className="p-5">
          <SlashRule className="mb-4" />
          <h1 className="board-head text-lg text-chalk">Sign in</h1>
          <p className="mt-1 text-xs text-muted">
            The POS reads and writes through your account. Payroll is owner-only.
          </p>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <Field label="Email" htmlFor="login-email">
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@example.com"
                autoComplete="username"
                autoFocus
                required
              />
            </Field>

            <Field label="Password" htmlFor="login-password" error={error ?? undefined}>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                invalid={Boolean(error)}
                required
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="mt-1"
              disabled={busy || !email.trim() || !password}
            >
              <LogIn size={16} />
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  )
}
