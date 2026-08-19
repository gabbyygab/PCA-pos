/**
 * Payroll periods run Monday -> Sunday. Kept platform-agnostic so the mobile
 * app can display the same week boundaries.
 */

/** Monday of the week containing `date`, at local midnight. */
export function weekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // getDay(): 0 = Sunday. Sunday belongs to the week that began six days ago.
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return d
}

export function weekEnd(date: Date): Date {
  const start = weekStart(date)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return end
}

/** Exclusive upper bound, for `sold_at < end` range queries. */
export function weekEndExclusive(date: Date): Date {
  const start = weekStart(date)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return end
}

export function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + weeks * 7)
  return d
}

/** `YYYY-MM-DD` in local time — Postgres `date` columns are not instants. */
export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Sunday is when the week is finalized. */
export function isFinalizeDay(date: Date): boolean {
  return date.getDay() === 0
}

/**
 * Manual adjustments to a week's pay.
 *
 * The computed commission is what the board earned; it is not always what the
 * owner hands over. A bonus for a hard Sunday, a deduction for a damaged
 * panel, a correction after a dispute -- these are real payroll events with no
 * sale behind them, so they ride alongside the computed cut rather than being
 * folded into it. Sales history stays exactly as it was rung up.
 *
 * Signed centavos: positive is a bonus, negative is a deduction. This is the
 * one money value in the system allowed below zero, because a deduction is a
 * direction on a ledger rather than a negative price.
 */
export interface PayrollAdjustment {
  amountCentavos: number
}

/** Signed sum of a week's adjustments for one employee. */
export function totalAdjustments(adjustments: readonly PayrollAdjustment[]): number {
  return adjustments.reduce((sum, a) => sum + a.amountCentavos, 0)
}

/**
 * What the employee is actually handed: computed cut plus adjustments.
 *
 * Floored at zero. A deduction larger than the week's earnings means the shop
 * is owed money, but a payslip must never print a negative payout -- the
 * remainder is a debt to settle out of band, not cash the employee hands back
 * at the counter.
 */
export function netPay(commissionCentavos: number, adjustmentCentavos: number): number {
  return Math.max(0, commissionCentavos + adjustmentCentavos)
}

/**
 * True when a deduction was clipped by the zero floor.
 *
 * Worth surfacing: the owner typed a number the payout could not absorb, and
 * silently paying 0 while showing a bigger deduction would look like a bug.
 */
export function isOverDeducted(commissionCentavos: number, adjustmentCentavos: number): boolean {
  return commissionCentavos + adjustmentCentavos < 0
}
