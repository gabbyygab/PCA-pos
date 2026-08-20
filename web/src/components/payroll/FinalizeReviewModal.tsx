'use client'

import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { formatPeso } from '@shared/lib/currency'
import { isOverDeducted } from '@shared/lib/payroll'

export interface FinalizeReviewRow {
  employeeId: string
  name: string
  salesCount: number
  commissionCentavos: number
  adjustmentCentavos: number
  netCentavos: number
}

interface FinalizeReviewModalProps {
  rows: readonly FinalizeReviewRow[]
  /** Spelled-out week, so the owner cannot lock the wrong one. */
  periodLabel: string
  busy?: boolean
  /** Opens the adjustment dialog for one employee. */
  onAdjust: (employeeId: string) => void
  onConfirm: () => void
  onClose: () => void
}

/**
 * The last look before a week is locked.
 *
 * Finalizing snapshots what every employee is handed and stops the week from
 * recomputing, so this is the owner's one chance to see the payout as a whole
 * and correct it. Corrections go through adjustments rather than an editable
 * total: a slip that disagrees with the sales behind it is unexplainable a
 * month later, while a bonus with a reason still reads.
 */
export function FinalizeReviewModal({
  rows,
  periodLabel,
  busy,
  onAdjust,
  onConfirm,
  onClose,
}: FinalizeReviewModalProps) {
  const totalCommission = rows.reduce((sum, r) => sum + r.commissionCentavos, 0)
  const totalAdjustment = rows.reduce((sum, r) => sum + r.adjustmentCentavos, 0)
  const totalNet = rows.reduce((sum, r) => sum + r.netCentavos, 0)

  return (
    <Modal
      title="Review before locking"
      hint={`${periodLabel} — these totals are frozen onto each payslip. Later price or rate changes will not move them.`}
      className="max-w-3xl"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" onClick={onConfirm} disabled={busy}>
            {busy ? 'Locking…' : 'Finalize & lock'}
          </Button>
        </>
      }
    >
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <Th className="text-left">Employee</Th>
              <Th className="text-right">Cars</Th>
              <Th className="text-right">Commission</Th>
              <Th className="text-right">Adjustment</Th>
              <Th className="text-right">Net pay</Th>
              <Th className="text-right"> </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // A deduction bigger than the week's pay is clipped to zero by
              // netPay. Saying so beats printing a net that ignores the number
              // the owner typed.
              const clipped = isOverDeducted(row.commissionCentavos, row.adjustmentCentavos)
              return (
                <tr key={row.employeeId} className="border-b border-line/60">
                  <td className="px-3 py-2.5 font-semibold text-chalk">{row.name}</td>
                  <td className="tnum px-3 py-2.5 text-right text-faint">{row.salesCount}</td>
                  <td className="tnum px-3 py-2.5 text-right text-chalk">
                    {formatPeso(row.commissionCentavos)}
                  </td>
                  <td
                    className={`tnum px-3 py-2.5 text-right ${
                      row.adjustmentCentavos === 0
                        ? 'text-faint'
                        : row.adjustmentCentavos > 0
                          ? 'text-chalk'
                          : 'text-red'
                    }`}
                  >
                    {row.adjustmentCentavos === 0
                      ? '—'
                      : `${row.adjustmentCentavos > 0 ? '+' : '−'}${formatPeso(
                          Math.abs(row.adjustmentCentavos)
                        )}`}
                    {clipped ? (
                      <span className="ml-1 text-[10px] font-semibold uppercase text-red">
                        over
                      </span>
                    ) : null}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right font-extrabold text-chalk">
                    {formatPeso(row.netCentavos)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => onAdjust(row.employeeId)}>
                      {row.adjustmentCentavos < 0 ? <Minus size={13} /> : <Plus size={13} />}
                      Adjust
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="board-label px-3 pt-3 text-[10px] text-faint" colSpan={2}>
                Total
              </td>
              <td className="tnum px-3 pt-3 text-right text-chalk">
                {formatPeso(totalCommission)}
              </td>
              <td className="tnum px-3 pt-3 text-right text-chalk">
                {totalAdjustment === 0
                  ? '—'
                  : `${totalAdjustment > 0 ? '+' : '−'}${formatPeso(Math.abs(totalAdjustment))}`}
              </td>
              <td className="tnum px-3 pt-3 text-right text-lg font-extrabold text-red">
                {formatPeso(totalNet)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-faint">
          Nobody worked this week and no adjustments were entered. There is nothing to pay.
        </p>
      ) : null}
    </Modal>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`board-label px-3 py-2 text-[10px] text-faint ${className}`}>{children}</th>
  )
}
