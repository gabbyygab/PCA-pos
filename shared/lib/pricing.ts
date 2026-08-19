/**
 * Pricing resolution and commission math.
 *
 * This lives in shared/ because the cashier app computes the same totals as
 * the dashboard. Money is integer centavos throughout; commission uses integer
 * math and rounds once per line, never unrounded float multiplication.
 */

import type { ServiceCategory, VehicleSize } from './domain'

export interface PricedService {
  id: string
  name: string
  category: ServiceCategory
  commission_rate_bp: number
  is_open_price: boolean
  /** size -> price in centavos. A missing size is not offered. */
  prices: Partial<Record<VehicleSize, number>>
}

export interface CartLine {
  serviceId: string
  serviceName: string
  category: ServiceCategory
  quantity: number
  unitPriceCentavos: number
  commissionRateBp: number
}

/**
 * The price for a service at a size, or null when the board has no price
 * there (open-price services, and the sizes left blank on the board).
 */
export function resolvePrice(
  service: PricedService,
  size: VehicleSize
): number | null {
  if (service.is_open_price) return null
  return service.prices[size] ?? null
}

export function isAvailableAtSize(service: PricedService, size: VehicleSize): boolean {
  return service.is_open_price || service.prices[size] !== undefined
}

export function lineTotal(line: CartLine): number {
  return line.unitPriceCentavos * line.quantity
}

/**
 * Commission for one line. Basis points keep the rate an integer (4000 = 40%),
 * and Math.round collapses the single division at the end.
 */
export function lineCommission(line: CartLine): number {
  return Math.round((lineTotal(line) * line.commissionRateBp) / 10000)
}

export function cartTotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0)
}

/** Summed per line, so it always matches what the receipt itemises. */
export function cartCommission(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineCommission(line), 0)
}

export function formatRate(bp: number): string {
  return `${bp / 100}%`
}

/**
 * One employee's share of a line's commission, when `crewSize` employees
 * worked the car together.
 *
 * The shop splits the cut evenly: a 200 line at 40% is 80, and three
 * employees take 26.67 each. Each share rounds up, so the crew is never
 * shorted by the division — which means the shares can sum to slightly more
 * than `lineCommission(line)` (80.01 in that example). That overage is
 * deliberate and the sale records the summed shares as its commission, so
 * payroll and the sale always agree.
 */
export function shareOfCommission(line: CartLine, crewSize: number): number {
  if (crewSize <= 0) return 0
  return Math.ceil(lineCommission(line) / crewSize)
}

/** What the whole crew is paid for one line — the per-share rounding included. */
export function lineCommissionPaid(line: CartLine, crewSize: number): number {
  return shareOfCommission(line, crewSize) * Math.max(crewSize, 0)
}

/** Total actually paid out across the cart, matching what the sale stores. */
export function cartCommissionPaid(lines: readonly CartLine[], crewSize: number): number {
  return lines.reduce((sum, line) => sum + lineCommissionPaid(line, crewSize), 0)
}

/** One employee's take-home across the whole cart. */
export function cartShare(lines: readonly CartLine[], crewSize: number): number {
  return lines.reduce((sum, line) => sum + shareOfCommission(line, crewSize), 0)
}
