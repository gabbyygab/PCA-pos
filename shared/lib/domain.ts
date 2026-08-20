/**
 * Domain vocabulary shared by the dashboard and the future cashier app.
 * Platform-agnostic: no React, no DOM, no Node built-ins.
 */

import type { Enums } from '../types/database'

export type VehicleClass = Enums<'vehicle_class'>
export type ServiceCategory = Enums<'service_category'>
export type PaymentMethod = Enums<'payment_method'>
export type PayrollStatus = Enums<'payroll_status'>

/**
 * Where one service line stands. Tracked per line rather than per sale because
 * the shop works a car one service at a time: the carwash can be finished while
 * the hand wax is still going, and a single service can be refunded on its own.
 */
export type ServiceStatus = Enums<'service_status'>

/**
 * A size is a row the owner creates in Settings, not a fixed enum: the shop
 * adds a sixth car size or a fourth bike tier without a release. `id` keys the
 * current price rows; `label` is what a sale snapshots and a receipt prints.
 */
export interface VehicleSizeRow {
  id: string
  vehicle_class: VehicleClass
  label: string
  description: string | null
  sort_order: number
  is_active: boolean
}

/**
 * How a size is referred to once it is on a sale: the label as printed at the
 * time, not a foreign key. Renaming a size later must not rewrite history, so
 * anything reading past sales works in these strings.
 */
export type SizeLabel = string

export const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  basic: 'Basic',
  package: 'Packages',
  addon: 'Other Services',
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
}

/** Default rates by category, used when creating a service in Settings. */
export const DEFAULT_COMMISSION_BP: Record<ServiceCategory, number> = {
  basic: 4000,
  package: 3000,
  addon: 4000,
}

export const SERVICE_STATUSES = [
  'pending',
  'done',
  'refunded',
] as const satisfies readonly ServiceStatus[]

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  pending: 'In progress',
  done: 'Done',
  refunded: 'Refunded',
}

/**
 * A refunded line keeps its place on the ticket but stops counting toward
 * revenue and commission. Both clients ask this rather than testing the string,
 * so the rule has one home.
 */
export function countsAsRevenue(status: ServiceStatus): boolean {
  return status !== 'refunded'
}

export const VEHICLE_CLASSES = ['car', 'motorcycle'] as const satisfies readonly VehicleClass[]

export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = {
  car: 'Car',
  motorcycle: 'Motorcycle',
}

/** Plural, for tab labels and empty states. */
export const VEHICLE_CLASS_PLURALS: Record<VehicleClass, string> = {
  car: 'Cars',
  motorcycle: 'Motorcycles',
}

/**
 * The order categories are shown in Settings and the POS. Basic first because
 * it is the most-rung service, packages next, everything else last.
 */
export const CATEGORY_ORDER = ['basic', 'package', 'addon'] as const satisfies readonly ServiceCategory[]

/** The sizes on one class's scale, in board order. */
export function sizesForClass(
  sizes: readonly VehicleSizeRow[],
  vehicleClass: VehicleClass
): VehicleSizeRow[] {
  return sizes
    .filter((s) => s.vehicle_class === vehicleClass)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
}

/**
 * Labels are compared case-insensitively everywhere they cross the boundary
 * between a size row and a stored sale, because the sale carries a copy of the
 * text rather than a reference to the row.
 */
export function sameLabel(a: SizeLabel, b: SizeLabel): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The size row a past sale's label refers to, if that size still exists. */
export function findSizeByLabel(
  sizes: readonly VehicleSizeRow[],
  vehicleClass: VehicleClass,
  label: SizeLabel
): VehicleSizeRow | undefined {
  return sizes.find((s) => s.vehicle_class === vehicleClass && sameLabel(s.label, label))
}

/**
 * Sale labels in board order, with anything unrecognised last. Reports group by
 * the stored label, so a size the owner has since renamed or retired still has
 * to sort somewhere sensible rather than disappearing.
 */
export function sortSizeLabels(
  sizes: readonly VehicleSizeRow[],
  vehicleClass: VehicleClass,
  labels: readonly SizeLabel[]
): SizeLabel[] {
  const order = sizesForClass(sizes, vehicleClass)
  const rank = (label: SizeLabel) => {
    const i = order.findIndex((s) => sameLabel(s.label, label))
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...labels].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
