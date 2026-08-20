'use client'

import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { formatPeso } from '@shared/lib/currency'
import type { Tables } from '@shared/types/database'

interface AdjustmentsPanelProps {
  adjustments: readonly Tables<'payroll_adjustments'>[]
  /** id -> name, so a deleted employee still renders something readable. */
  nameFor: (employeeId: string) => string
  /** Finalized weeks are read-only until explicitly reopened. */
  locked: boolean
  loading?: boolean
  onAdd: () => void
  onEdit: (adjustment: Tables<'payroll_adjustments'>) => void
  onDelete: (adjustment: Tables<'payroll_adjustments'>) => void
}

const STAMP_FMT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

/**
 * The manual-adjustment ledger for one week.
 *
 * Deliberately a list of individual entries rather than one editable number
 * per employee. Two bonuses and a deduction that net to +50 tell a story that
 * a single "+50" cannot, and when an employee disputes their pay the owner
 * needs the entries, the reasons, and who entered them — not the sum.
 */
export function AdjustmentsPanel({
  adjustments,
  nameFor,
  locked,
  loading,
  onAdd,
  onEdit,
  onDelete,
}: AdjustmentsPanelProps) {
  const net = adjustments.reduce((sum, a) => sum + a.amount_centavos, 0)

  return (
    <Panel className="mt-5">
      <PanelHeader
        title="Manual adjustments"
        hint={
          locked
            ? 'This week is finalized — its adjustments are locked into the slips.'
            : 'Bonuses and deductions on top of the computed cut. Sales are never edited.'
        }
        action={
          <div className="flex shrink-0 items-center gap-2">
            {adjustments.length > 0 ? (
              <span className="tnum text-xs font-bold text-chalk">
                Net {net < 0 ? '−' : '+'}
                {formatPeso(Math.abs(net))}
              </span>
            ) : null}
            <Button size="sm" variant="primary" onClick={onAdd} disabled={locked}>
              <Plus size={14} />
              Add
            </Button>
          </div>
        }
      />

      {loading ? (
        <TableSkeleton label="Loading adjustments" rows={3} columns={['50%', '18%']} />
      ) : adjustments.length === 0 ? (
        <p className="px-4 py-6 text-sm text-faint">
          No adjustments this week — everyone is paid exactly what the board earned.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {adjustments.map((adjustment) => {
            const deduction = adjustment.amount_centavos < 0
            return (
              <li
                key={adjustment.id}
                className="flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-2"
              >
                <span
                  className={`tnum mt-0.5 shrink-0 text-sm font-extrabold ${
                    deduction ? 'text-red' : 'text-good'
                  }`}
                >
                  {deduction ? '−' : '+'}
                  {formatPeso(Math.abs(adjustment.amount_centavos))}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-chalk">
                    {nameFor(adjustment.employee_id)}
                  </p>
                  <p className="truncate text-xs text-muted">{adjustment.reason}</p>
                  {/*
                   * Authorship is on every row, not hidden behind a hover: the
                   * point of the ledger is that a change to pay is always
                   * attributable after the fact.
                   */}
                  <p className="mt-0.5 text-[10px] text-faint">
                    {adjustment.created_by_email ?? 'Unknown'} ·{' '}
                    {new Date(adjustment.created_at).toLocaleDateString('en-PH', STAMP_FMT)}
                    {adjustment.updated_at !== adjustment.created_at ? ' · edited' : ''}
                  </p>
                </div>

                {locked ? (
                  <Lock size={13} className="mt-1 shrink-0 text-faint" aria-label="Locked" />
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit adjustment for ${nameFor(adjustment.employee_id)}`}
                      onClick={() => onEdit(adjustment)}
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete adjustment for ${nameFor(adjustment.employee_id)}`}
                      onClick={() => onDelete(adjustment)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
