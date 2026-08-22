/**
 * Pricing resolution and commission math.
 *
 * This lives in shared/ because the cashier app computes the same totals as
 * the dashboard. Money is integer centavos throughout; commission uses integer
 * math and rounds once per line, never unrounded float multiplication.
 */

import type { ServiceCategory } from './domain'

export interface PricedService {
  id: string
  name: string
  category: ServiceCategory
  commission_rate_bp: number
  is_open_price: boolean
  /**
   * vehicle_sizes.id -> price in centavos. Keyed by the size row's id rather
   * than its label, so renaming a size in Settings keeps its prices attached.
   * A missing size is not offered.
   */
  prices: Record<string, number | undefined>
}

export interface CartLine {
  /**
   * The catalogue service's id, or a synthetic `custom:` key for a one-off
   * line the cashier typed at the counter. Both clients key the cart by this,
   * so it has to be unique per line rather than merely per service.
   */
  serviceId: string
  serviceName: string
  category: ServiceCategory
  quantity: number
  unitPriceCentavos: number
  commissionRateBp: number
  /**
   * Free text the cashier typed for a custom line — what the job actually was.
   * Catalogue lines leave it undefined. `sale_items` has no description
   * column, so this is folded into the stored service name by
   * `customServiceName()` at sale time; it is kept apart here only so the cart
   * can show the name and the note on separate rows.
   */
  description?: string
}

/**
 * Synthetic ids for lines that are not in the catalogue. `create_sale` writes
 * `nullif(service_id, '')::uuid`, so a custom line posts a null service_id and
 * carries its own name, price, and rate — exactly what an open-price line
 * already does, minus the service row behind it.
 */
export const CUSTOM_LINE_PREFIX = 'custom:'

export function isCustomLine(line: CartLine): boolean {
  return line.serviceId.startsWith(CUSTOM_LINE_PREFIX)
}

/**
 * A fresh key for a custom line. Two "Buffing" lines on one ticket are two
 * different jobs at possibly different prices, so they must not collapse into
 * one another the way a repeated catalogue tile does.
 */
export function newCustomLineId(): string {
  return `${CUSTOM_LINE_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** What the RPC is sent as `service_id`: null for anything not in the catalogue. */
export function serviceIdForSale(line: CartLine): string | null {
  return isCustomLine(line) ? null : line.serviceId
}

/**
 * The price for a service at a size, or null when the board has no price
 * there (open-price services, and the sizes left blank on the board).
 */
export function resolvePrice(
  service: PricedService,
  sizeId: string
): number | null {
  if (service.is_open_price) return null
  return service.prices[sizeId] ?? null
}

export function isAvailableAtSize(service: PricedService, sizeId: string): boolean {
  return service.is_open_price || service.prices[sizeId] !== undefined
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

/**
 * A promo takes a percentage off what the customer pays and nothing off what
 * the crew earns.
 *
 * That asymmetry is the point, and it is why the discount is never folded into
 * `unitPriceCentavos`: every commission function above reads the line total, so
 * discounting the price in place would quietly cut the crew's pay too. The
 * customer's concession is the shop's to give, not theirs.
 *
 * The rate is basis points, like `commissionRateBp` — 2000 is 20%.
 */

/** A promo of this many basis points is no promo at all. */
export function hasPromo(discountRateBp: number): boolean {
  return discountRateBp > 0
}

/**
 * What comes off one line.
 *
 * Rounded DOWN, the mirror image of `shareOfCommission`'s round UP: a crew
 * share rounds up so an uneven split never shorts the crew, and a discount
 * rounds down so an uneven percentage never hands back more than the promo
 * promised. Each rounds in the direction that protects whoever did not choose
 * the arithmetic. Mirrors `create_sale` in Postgres exactly.
 */
export function lineDiscount(line: CartLine, discountRateBp: number): number {
  if (discountRateBp <= 0) return 0
  return Math.floor((lineTotal(line) * discountRateBp) / 10000)
}

/** What the customer owes for one line, after the promo. */
export function lineNetTotal(line: CartLine, discountRateBp: number): number {
  return lineTotal(line) - lineDiscount(line, discountRateBp)
}

/**
 * The whole cart's discount, summed per line rather than taken off the cart
 * total — the rounding has to happen where the stored amount does, or the
 * preview disagrees with what Postgres writes by a centavo.
 */
export function cartDiscount(lines: readonly CartLine[], discountRateBp: number): number {
  return lines.reduce((sum, line) => sum + lineDiscount(line, discountRateBp), 0)
}

/** What the customer actually pays for the cart. */
export function cartNetTotal(lines: readonly CartLine[], discountRateBp: number): number {
  return cartTotal(lines) - cartDiscount(lines, discountRateBp)
}

/** `20` (percent, as typed) -> `2000` (basis points, as stored). */
export function percentToBp(percent: number): number {
  return Math.round(percent * 100)
}

export function bpToPercent(bp: number): number {
  return bp / 100
}

/** A promo percentage the UI will accept: 0–100, no fractional centavo games. */
export function clampDiscountBp(bp: number): number {
  if (!Number.isFinite(bp)) return 0
  return Math.min(Math.max(Math.round(bp), 0), 10000)
}
