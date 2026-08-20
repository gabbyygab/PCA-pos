'use client'

import { useState } from 'react'
import Image from 'next/image'
import {
  BarChart3,
  CalendarClock,
  LogOut,
  ClipboardList,
  Receipt,
  Settings2,
  ShoppingCart,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/auth/session'
import { PosTab } from '@/components/pos/PosTab'
import { PayrollTab } from '@/components/payroll/PayrollTab'
import { ServicesTab } from '@/components/services/ServicesTab'
import { ReportsTab } from '@/components/reports/ReportsTab'
import { EmployeesTab } from '@/components/employees/EmployeesTab'
import { ExpensesTab } from '@/components/expenses/ExpensesTab'
import { SettingsTab } from '@/components/settings/SettingsTab'
import { ConfirmModal } from '@/components/ui/Modal'
import { Badge, formatBadgeCount } from '@/components/ui/Badge'
import { useDayAttention, useSeenMarker } from '@/lib/queries/attention'

type TabId =
  | 'pos'
  | 'services'
  | 'payroll'
  | 'expenses'
  | 'reports'
  | 'employees'
  | 'settings'

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'pos', label: 'POS', icon: ShoppingCart },
  // Directly after POS: a sale is rung up, then worked. This is the screen the
  // crew returns to all day to close lines out.
  { id: 'services', label: 'Services', icon: ClipboardList },
  { id: 'payroll', label: 'Payroll', icon: CalendarClock },
  // Next to Payroll: both are money leaving the till, and the owner reviews
  // them in the same sitting before reading Reports.
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'employees', label: 'Employees', icon: Users },
  // Labelled for what it edits — the price board — since "Services" is now the
  // record of work done.
  { id: 'settings', label: 'Price Board', icon: Settings2 },
]

export function Shell() {
  const [tab, setTab] = useState<TabId>('pos')
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const { email, isOwner, signOut } = useSession()

  // One badge, two signals: the number is today's open work (still pending,
  // plus anything given back), and the dot means some of it landed since this
  // device last opened the tab. The count outlives a glance — it only falls
  // when the crew actually closes a line — while the dot clears on visit.
  const { data: attention } = useDayAttention()
  const { hasUnseen, markSeen } = useSeenMarker(attention?.latestAt ?? null)

  function openTab(id: TabId) {
    setTab(id)
    if (id === 'services') markSeen()
  }

  async function confirmSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      // The session listener swaps this whole tree out on success, so this
      // only matters when sign-out failed and the modal is still standing.
      setSigningOut(false)
      setConfirmingSignOut(false)
    }
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-[13.5rem] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-3 px-4 py-5">
          {/*
           * The mark is a badge on a white square, so it gets a light plate to
           * sit on rather than floating on the near-black ground.
           */}
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
            <Image
              src="/logo.png.png"
              alt="PCA Premium Auto Care"
              width={44}
              height={44}
              priority
              className="size-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <p className="board-head truncate text-base text-chalk">PCA</p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-faint">General Trias</p>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1 px-2">
          {TABS.map((t) => {
            const active = t.id === tab
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => openTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                  // Tab switching happens dozens of times a day: keep the colour
                  // change, skip any movement that would make it feel slow.
                  'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
                  active ? 'bg-surface-2 text-chalk' : 'text-muted hover:bg-surface-2 hover:text-chalk'
                )}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-red',
                    'transition-opacity duration-150',
                    active ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <Icon size={17} className={active ? 'text-red' : ''} />
                <span className="board-label flex-1 text-[11px]">{t.label}</span>
                {t.id === 'services' && attention && attention.total > 0 ? (
                  <Badge
                    dot={hasUnseen}
                    label={`${attention.pending} pending, ${attention.refunded} refunded today`}
                  >
                    {formatBadgeCount(attention.total)}
                  </Badge>
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="border-t border-line px-3 py-3">
          <p className="truncate text-[11px] text-muted" title={email ?? undefined}>
            {email ?? 'Signed in'}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-faint">
            {isOwner ? 'Owner' : 'Cashier'}
          </p>
          <button
            onClick={() => setConfirmingSignOut(true)}
            className={cn(
              'mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-muted',
              'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
              'hover:bg-surface-2 hover:text-chalk'
            )}
          >
            <LogOut size={14} />
            <span className="board-label text-[10px]">Sign out</span>
          </button>
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-hidden">
        {tab === 'pos' && <PosTab />}
        {tab === 'services' && <ServicesTab />}
        {tab === 'payroll' && <PayrollTab />}
        {tab === 'expenses' && <ExpensesTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'employees' && <EmployeesTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>

      {confirmingSignOut ? (
        <ConfirmModal
          title="Sign out?"
          hint="An unsaved sale in the POS is lost. You will need to sign in again to ring up."
          confirmLabel={signingOut ? 'Signing out…' : 'Sign out'}
          destructive
          busy={signingOut}
          onConfirm={confirmSignOut}
          onClose={() => setConfirmingSignOut(false)}
        />
      ) : null}
    </div>
  )
}
