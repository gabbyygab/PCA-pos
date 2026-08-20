'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileText,
  Lock,
  LockOpen,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import { Panel, PanelHeader, SlashRule } from '@/components/ui/Panel'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { OwnerPasswordModal } from '@/components/auth/OwnerPasswordModal'
import { AdjustmentDialog, type AdjustmentDraft } from '@/components/payroll/AdjustmentDialog'
import { AdjustmentsPanel } from '@/components/payroll/AdjustmentsPanel'
import { FinalizeReviewModal } from '@/components/payroll/FinalizeReviewModal'
import { useOwnerGate, useUnlockCountdown } from '@/lib/auth/ownerGate'
import {
  useFinalizeWeek,
  usePayrollWeek,
  useReopenWeek,
  type EmployeeWeek,
} from '@/lib/queries/payroll'
import {
  useCreateAdjustment,
  useDeleteAdjustment,
  usePayrollAdjustments,
  useUpdateAdjustment,
} from '@/lib/queries/payrollAdjustments'
import { usePayrollDetail, type EmployeePayrollDetail } from '@/lib/queries/payrollDetail'
import { useOldestUnpaidWeek } from '@/lib/queries/payrollPeriods'
import { useEmployees } from '@/lib/queries/employees'
import { downloadPayslip, type PayslipPeriod } from '@/lib/pdf/payslip'
import { downloadAllPayslips, downloadPayrollRegister } from '@/lib/pdf/payrollRegister'
import { formatPeso } from '@shared/lib/currency'
import {
  addWeeks,
  isFinalizeDay,
  netPay,
  toDateKey,
  weekEnd,
  weekStart,
} from '@shared/lib/payroll'
import type { Tables } from '@shared/types/database'

const DATE_FMT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
const FULL_FMT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

export function PayrollTab() {
  const [anchor, setAnchor] = useState(() => new Date())
  const { data, isLoading } = usePayrollWeek(anchor)
  const { data: detail, isLoading: detailLoading } = usePayrollDetail(anchor)
  const { data: unpaid } = useOldestUnpaidWeek(anchor)
  const { data: adjustments, isLoading: adjustmentsLoading } = usePayrollAdjustments(anchor)
  const { data: employees } = useEmployees()
  const finalize = useFinalizeWeek()
  const reopen = useReopenWeek()
  const createAdjustment = useCreateAdjustment()
  const updateAdjustment = useUpdateAdjustment()
  const deleteAdjustment = useDeleteAdjustment()
  const { unlocked, expiresAt, lock } = useOwnerGate()
  const countdown = useUnlockCountdown(expiresAt)
  const { toast } = useToast()

  /*
   * Editing pay is gated twice. RLS already restricts these rows to the owner
   * role; the password prompt covers the other risk, which is the app being
   * left signed in on a counter machine all day. `pending` holds the action the
   * owner asked for while the password is checked, so an unlock resumes exactly
   * what they clicked instead of dropping it.
   */
  const [pending, setPending] = useState<{ label: string; run: () => void } | null>(null)
  const [editing, setEditing] = useState<Tables<'payroll_adjustments'> | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Tables<'payroll_adjustments'> | null>(null)
  /* The finalize review sits between the password and the write. */
  const [reviewing, setReviewing] = useState(false)
  /* Preselects the employee when adjusting from a review row. */
  const [adjustingFor, setAdjustingFor] = useState<string | null>(null)

  const start = weekStart(anchor)
  const end = weekEnd(anchor)
  const finalized = data?.period?.status === 'finalized'

  /**
   * Runs `action` if the owner is already unlocked, otherwise parks it behind
   * the password prompt.
   */
  const requireOwner = useCallback(
    (action: () => void, label: string) => {
      if (unlocked) action()
      else setPending({ label, run: action })
    },
    [unlocked]
  )

  /**
   * Employee names for the adjustment ledger.
   *
   * Falls back to the slip's snapshotted name, because an adjustment can
   * outlive the employee row it points at — a finalized week must still print
   * the name it was paid under.
   */
  const nameFor = useCallback(
    (employeeId: string) => {
      const active = employees?.find((e) => e.id === employeeId)?.name
      if (active) return active
      const slip = data?.slips.find((s) => s.employee_id === employeeId)?.employee_name
      return slip ?? 'Unknown'
    },
    [employees, data?.slips]
  )

  // A finalized week reads its snapshot; an open week is computed live.
  const baseRows: EmployeeWeek[] = useMemo(
    () =>
      finalized
        ? (data?.slips ?? []).map((s) => ({
            employeeId: s.employee_id,
            name: s.employee_name,
            salesCount: s.sales_count,
            grossCentavos: s.gross_sales_centavos,
            commissionCentavos: s.commission_centavos,
          }))
        : (data?.live ?? []),
    [finalized, data?.slips, data?.live]
  )

  /**
   * The week's adjustment per employee.
   *
   * A finalized week reads the figure frozen onto its slip, not today's
   * adjustment rows — editing an adjustment after payout must not restate a
   * week that has already been settled. An open week sums the live ledger.
   */
  const adjustmentFor = useMemo(() => {
    const map = new Map<string, number>()
    if (finalized) {
      for (const slip of data?.slips ?? []) {
        map.set(slip.employee_id, slip.adjustment_centavos)
      }
    } else {
      for (const adjustment of adjustments ?? []) {
        map.set(
          adjustment.employee_id,
          (map.get(adjustment.employee_id) ?? 0) + adjustment.amount_centavos
        )
      }
    }
    return map
  }, [finalized, data?.slips, adjustments])

  /**
   * Rows carry the computed cut, the adjustment, and the net.
   *
   * An open week can have an adjustment for someone with no sales yet — a
   * bonus entered on Monday — so those employees are appended rather than
   * dropped; otherwise the money would be invisible until finalize created
   * their slip.
   */
  const rows = useMemo(() => {
    const withAdjustments = baseRows.map((row) => {
      const adjustmentCentavos = adjustmentFor.get(row.employeeId) ?? 0
      return {
        ...row,
        adjustmentCentavos,
        netCentavos: netPay(row.commissionCentavos, adjustmentCentavos),
      }
    })

    const seen = new Set(withAdjustments.map((r) => r.employeeId))
    for (const [employeeId, adjustmentCentavos] of adjustmentFor) {
      if (seen.has(employeeId)) continue
      withAdjustments.push({
        employeeId,
        name: nameFor(employeeId),
        salesCount: 0,
        grossCentavos: 0,
        commissionCentavos: 0,
        adjustmentCentavos,
        netCentavos: netPay(0, adjustmentCentavos),
      })
    }

    return withAdjustments
  }, [baseRows, adjustmentFor, nameFor])

  const totalGross = rows.reduce((sum, r) => sum + r.grossCentavos, 0)
  const totalCommission = rows.reduce((sum, r) => sum + r.commissionCentavos, 0)
  const totalAdjustment = rows.reduce((sum, r) => sum + r.adjustmentCentavos, 0)
  const totalNet = rows.reduce((sum, r) => sum + r.netCentavos, 0)
  const hasAdjustments = rows.some((r) => r.adjustmentCentavos !== 0)

  const period: PayslipPeriod = useMemo(
    () => ({
      start,
      end,
      finalized,
      finalizedAt: data?.period?.finalized_at ?? null,
    }),
    [start, end, finalized, data?.period?.finalized_at]
  )

  /**
   * A finalized week must export its snapshot, not today's live numbers. The
   * detail query is always live, so its per-line breakdown is reconciled
   * against the slip totals before printing — if they have drifted (a sale was
   * voided after finalizing, say), the slip is the number that gets paid.
   */
  const details: EmployeePayrollDetail[] = useMemo(() => {
    const live = detail ?? []
    if (!finalized) return live

    const byId = new Map(live.map((d) => [d.employeeId, d]))
    return (data?.slips ?? []).map((slip) => {
      const found = byId.get(slip.employee_id)
      return {
        employeeId: slip.employee_id,
        name: slip.employee_name,
        lines: found?.lines ?? [],
        byDay: found?.byDay ?? [],
        salesCount: slip.sales_count,
        grossCentavos: slip.gross_sales_centavos,
        commissionCentavos: slip.commission_centavos,
      }
    })
  }, [detail, finalized, data?.slips])

  /**
   * The same details, plus each employee's adjustments — this is what the PDFs
   * print, so a payslip shows the number actually handed over.
   *
   * An adjustment-only employee gets a detail entry too: they are owed money
   * and must receive a slip, even with no cars on it.
   */
  const detailsWithAdjustments: EmployeePayrollDetail[] = useMemo(() => {
    const ledger = adjustments ?? []

    const enriched = details.map((d) => ({
      ...d,
      adjustmentCentavos: adjustmentFor.get(d.employeeId) ?? 0,
      adjustments: finalized ? [] : ledger.filter((a) => a.employee_id === d.employeeId),
    }))

    const seen = new Set(enriched.map((d) => d.employeeId))
    for (const [employeeId, adjustmentCentavos] of adjustmentFor) {
      if (seen.has(employeeId)) continue
      enriched.push({
        employeeId,
        name: nameFor(employeeId),
        lines: [],
        byDay: [],
        salesCount: 0,
        grossCentavos: 0,
        commissionCentavos: 0,
        adjustmentCentavos,
        adjustments: finalized ? [] : ledger.filter((a) => a.employee_id === employeeId),
      })
    }

    return enriched
  }, [details, adjustments, adjustmentFor, finalized, nameFor])

  const exportsReady = !detailLoading && detailsWithAdjustments.length > 0

  /**
   * Save an adjustment, then close the dialog.
   *
   * The owner check happened before the dialog opened; this is the write. A
   * failure here is almost always RLS refusing a non-owner, so the message
   * says that rather than showing a raw Postgres error.
   */
  async function onSubmitAdjustment(draft: AdjustmentDraft) {
    try {
      if (editing) {
        await updateAdjustment.mutateAsync({
          id: editing.id,
          amountCentavos: draft.amountCentavos,
          reason: draft.reason,
        })
        toast({ message: 'Adjustment updated', detail: nameFor(draft.employeeId), tone: 'success' })
      } else {
        await createAdjustment.mutateAsync({
          weekStart: start,
          employeeId: draft.employeeId,
          amountCentavos: draft.amountCentavos,
          reason: draft.reason,
        })
        toast({
          message: draft.amountCentavos < 0 ? 'Deduction added' : 'Bonus added',
          detail: `${nameFor(draft.employeeId)} · ${formatPeso(Math.abs(draft.amountCentavos))}`,
          tone: 'success',
        })
      }
      setEditing(null)
      setAdding(false)
    } catch (error) {
      toast({
        message: 'Could not save adjustment',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  async function onConfirmDelete() {
    if (!deleting) return
    try {
      await deleteAdjustment.mutateAsync(deleting.id)
      toast({ message: 'Adjustment removed', detail: nameFor(deleting.employee_id), tone: 'success' })
      setDeleting(null)
    } catch (error) {
      toast({
        message: 'Could not remove adjustment',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  function guarded(action: () => void, message: string) {
    try {
      action()
      toast({ message, detail: 'Saved as PDF.', tone: 'success' })
    } catch (error) {
      toast({
        message: 'Could not export',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  async function onFinalize() {
    try {
      await finalize.mutateAsync(anchor)
      setReviewing(false)
      toast({ message: 'Week finalized', detail: 'Slips are locked to these totals.', tone: 'success' })
    } catch (error) {
      toast({
        message: 'Could not finalize',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  async function onReopen() {
    const periodId = data?.period?.id
    if (!periodId) return
    try {
      await reopen.mutateAsync(periodId)
      toast({ message: 'Week reopened', detail: 'Slips were discarded.', tone: 'success' })
    } catch (error) {
      toast({
        message: 'Could not reopen',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  const isCurrentWeek = toDateKey(start) === toDateKey(weekStart(new Date()))

  return (
    <>
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <SlashRule className="mb-3" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="board-head text-2xl text-chalk">Payroll</h1>
            <p className="mt-1 text-xs text-muted">
              {start.toLocaleDateString('en-PH', DATE_FMT)} —{' '}
              {end.toLocaleDateString('en-PH', DATE_FMT)} · Monday to Sunday
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setAnchor(addWeeks(anchor, -1))} aria-label="Previous week">
              <ChevronLeft size={15} />
            </Button>
            <Button size="sm" onClick={() => setAnchor(new Date())} disabled={isCurrentWeek}>
              This week
            </Button>
            <Button size="sm" onClick={() => setAnchor(addWeeks(anchor, 1))} aria-label="Next week">
              <ChevronRight size={15} />
            </Button>

            {/*
              * Finalizing and reopening both move money — reopening discards
              * slips people may already have been paid against — so they sit
              * behind the same owner check as editing an adjustment.
              */}
            {finalized ? (
              <Button
                size="sm"
                variant="danger"
                onClick={() => requireOwner(onReopen, 'Reopening the week')}
                disabled={reopen.isPending}
              >
                <LockOpen size={14} />
                Reopen
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => requireOwner(() => setReviewing(true), 'Finalizing the week')}
                disabled={finalize.isPending || rows.length === 0}
              >
                <Lock size={14} />
                Finalize week
              </Button>
            )}
          </div>
        </div>

        {/*
         * The exact range is spelled out in full here, not just as "Mar 3 — 9":
         * the owner is about to hand out cash against it, and a payroll week is
         * the one date range in the app that must never be guessed at.
         */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-muted">
            <span className="board-label text-[9px] text-faint">Period</span>
            <span className="tnum font-semibold text-chalk">
              {start.toLocaleDateString('en-PH', FULL_FMT)} → {end.toLocaleDateString('en-PH', FULL_FMT)}
            </span>
          </span>

          {/*
            * Visible countdown, not a silent timer: the owner should be able to
            * see that pay editing is currently open and shut it themselves
            * before walking away from the counter.
            */}
          {unlocked ? (
            <button
              onClick={lock}
              className="inline-flex items-center gap-2 rounded-md border border-red/30 bg-red/10 px-2.5 py-1 text-[11px] font-semibold text-red transition-colors duration-150 hover:bg-red/15"
            >
              <ShieldCheck size={11} />
              Owner unlocked{countdown ? ` · ${countdown}` : ''} — click to lock
            </button>
          ) : null}

          {finalized ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-good/30 bg-good/10 px-2.5 py-1 text-[11px] font-semibold text-good">
              <Lock size={11} /> Finalized
              {data?.period?.finalized_at
                ? ` · locked ${new Date(data.period.finalized_at).toLocaleDateString('en-PH', DATE_FMT)}`
                : ''}
            </span>
          ) : isFinalizeDay(new Date()) && isCurrentWeek ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1 text-[11px] font-semibold text-warn">
              It is Sunday — the week is ready to finalize.
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-muted">
              Open — totals still moving
            </span>
          )}
        </div>

        {/*
         * Paying a later week while an earlier one is still open is how a crew
         * ends up with a silently skipped week. Sales carry their own date, so
         * the gap is detectable — surface it before the cash goes out.
         */}
        {unpaid ? (
          <button
            onClick={() => setAnchor(new Date(`${unpaid.weekStartKey}T00:00:00`))}
            className="mt-2 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-left text-[11px] font-semibold text-warn transition-colors duration-150 hover:bg-warn/15"
          >
            <AlertTriangle size={12} className="shrink-0" />
            An earlier week ({new Date(`${unpaid.weekStartKey}T00:00:00`).toLocaleDateString('en-PH', FULL_FMT)}) has
            sales but was never finalized. Pay it first — click to open.
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
          <Stat label="Gross sales" value={formatPeso(totalGross)} />
          <Stat label="Total employee cut" value={formatPeso(totalCommission)} accent />
          <Stat label="Employees paid" value={String(rows.length)} />
        </div>

        <Panel>
          <PanelHeader
            title="Per employee"
            hint={
              finalized
                ? 'Snapshotted at finalize time.'
                : 'Live from this week’s sales; not yet locked.'
            }
            action={
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    guarded(() => downloadPayrollRegister(detailsWithAdjustments, period), 'Register exported')
                  }
                  disabled={!exportsReady}
                >
                  <FileText size={14} />
                  Register
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    guarded(() => downloadAllPayslips(detailsWithAdjustments, period), 'Payslips exported')
                  }
                  disabled={!exportsReady}
                >
                  <Users size={14} />
                  All payslips
                </Button>
              </div>
            }
          />
          {isLoading ? (
            <TableSkeleton
              label="Loading this week's payroll"
              columns={['38%', '10%', '18%', '18%', '14%']}
            />
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-faint">No sales recorded this week.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>Employee</Th>
                  <Th className="text-right">Cars</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">Cut</Th>
                  <Th className="text-right">Payslip</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const employeeDetail = detailsWithAdjustments.find((d) => d.employeeId === row.employeeId)
                  return (
                    <tr key={row.employeeId} className="transition-colors duration-150 hover:bg-surface-2">
                      <td className="px-4 py-3 font-semibold text-chalk">{row.name}</td>
                      <td className="tnum px-4 py-3 text-right text-muted">{row.salesCount}</td>
                      <td className="tnum px-4 py-3 text-right text-muted">
                        {formatPeso(row.grossCentavos)}
                      </td>
                      <td className="tnum px-4 py-3 text-right font-bold text-red">
                        {formatPeso(row.commissionCentavos)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Download payslip for ${row.name}`}
                          disabled={!employeeDetail}
                          onClick={() =>
                            employeeDetail &&
                            guarded(
                              () => downloadPayslip(employeeDetail, period),
                              `Payslip for ${row.name}`
                            )
                          }
                        >
                          <FileDown size={14} />
                          PDF
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <AdjustmentsPanel
          adjustments={adjustments ?? []}
          nameFor={nameFor}
          locked={finalized}
          loading={adjustmentsLoading}
          onAdd={() => requireOwner(() => setAdding(true), 'Adding an adjustment')}
          onEdit={(a) => requireOwner(() => setEditing(a), 'Editing an adjustment')}
          onDelete={(a) => requireOwner(() => setDeleting(a), 'Removing an adjustment')}
        />
      </div>
    </div>

    {/*
     * The password prompt for a parked action. `requireOwner` stashes what was
     * clicked in `pending`; unlocking runs it and clears it, so the owner lands
     * on the result of the button they pressed rather than having to press it
     * again. Dismissing drops the action -- a cancelled finalize must not fire
     * later off a stale unlock.
     */}
    {reviewing ? (
      <FinalizeReviewModal
        rows={rows}
        periodLabel={`${start.toLocaleDateString('en-PH', DATE_FMT)} — ${end.toLocaleDateString(
          'en-PH',
          DATE_FMT
        )}`}
        busy={finalize.isPending}
        onAdjust={(employeeId) => {
          setAdjustingFor(employeeId)
          setAdding(true)
        }}
        onConfirm={onFinalize}
        onClose={() => setReviewing(false)}
      />
    ) : null}

    {/*
     * Add or edit one adjustment. Reachable from the ledger and from a row in
     * the finalize review, which is why the employee can be preselected.
     */}
    {adding || editing ? (
      <AdjustmentDialog
        existing={editing}
        employeeId={editing?.employee_id ?? adjustingFor ?? undefined}
        employees={employees ?? []}
        periodLabel={`${start.toLocaleDateString('en-PH', DATE_FMT)} — ${end.toLocaleDateString(
          'en-PH',
          DATE_FMT
        )}`}
        commissionCentavos={
          rows.find((r) => r.employeeId === (editing?.employee_id ?? adjustingFor))
            ?.commissionCentavos
        }
        busy={createAdjustment.isPending || updateAdjustment.isPending}
        onSubmit={onSubmitAdjustment}
        onClose={() => {
          setAdding(false)
          setEditing(null)
          setAdjustingFor(null)
        }}
      />
    ) : null}

    {deleting ? (
      <ConfirmModal
        title="Remove this adjustment?"
        hint={`${nameFor(deleting.employee_id)} · ${formatPeso(
          Math.abs(deleting.amount_centavos)
        )}. The week's net pay recalculates without it.`}
        confirmLabel="Remove"
        destructive
        busy={deleteAdjustment.isPending}
        onConfirm={onConfirmDelete}
        onClose={() => setDeleting(null)}
      />
    ) : null}

    {pending ? (
      <OwnerPasswordModal
        action={pending.label}
        onClose={() => setPending(null)}
        onUnlocked={() => {
          const { run } = pending
          setPending(null)
          run()
        }}
      />
    ) : null}
    </>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Panel className="px-4 py-3">
      <p className="board-label text-[10px] text-faint">{label}</p>
      <p className={`tnum mt-1 text-xl font-extrabold ${accent ? 'text-red' : 'text-chalk'}`}>
        {value}
      </p>
    </Panel>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`board-label px-4 py-2.5 text-[10px] text-faint ${className}`}>{children}</th>
  )
}
