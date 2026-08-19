/**
 * Domain vocabulary shared by the dashboard and the future cashier app.
 * Platform-agnostic: no React, no DOM, no Node built-ins.
 */

import type { Enums } from '../types/database'

export type VehicleClass = Enums<'vehicle_class'>
export type ServiceCategory = Enums<'service_category'>
export type VehicleSize = Enums<'vehicle_size'>
export type PaymentMethod = Enums<'payment_method'>
export type PayrollStatus = Enums<'payroll_status'>

/** Car sizes and motorcycle tiers are separate scales; they never mix. */
export const CAR_SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const satisfies readonly VehicleSize[]
export const MOTORCYCLE_SIZES = ['small', 'medium', 'big'] as const satisfies readonly VehicleSize[]

export const SIZE_LABELS: Record<VehicleSize, string> = {
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
  XXL: 'XXL',
  small: 'Small',
  medium: 'Medium',
  big: 'Big Bike',
}

/** The long form, shown under the size chip so a new cashier knows what fits. */
export const SIZE_DESCRIPTIONS: Record<VehicleSize, string> = {
  S: 'Sedan, hatchback',
  M: 'Crossover',
  L: 'SUV, pick up',
  XL: 'Modified pick up, van',
  XXL: 'Large van, truck',
  small: 'Small',
  medium: 'Medium',
  big: 'Big bike',
}

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

export function sizesForClass(vehicleClass: VehicleClass): readonly VehicleSize[] {
  return vehicleClass === 'car' ? CAR_SIZES : MOTORCYCLE_SIZES
}

/** Default rates by category, used when creating a service in Settings. */
export const DEFAULT_COMMISSION_BP: Record<ServiceCategory, number> = {
  basic: 4000,
  package: 3000,
  addon: 4000,
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

/**
 * True when `size` belongs to `vehicleClass`'s scale. Car sizes and motorcycle
 * tiers share one Postgres enum, so nothing at the database level stops an XL
 * price landing on a motorcycle — the check has to happen here.
 */
export function isSizeOfClass(vehicleClass: VehicleClass, size: VehicleSize): boolean {
  return (sizesForClass(vehicleClass) as readonly VehicleSize[]).includes(size)
}

/** Sizes in scale order, so a re-added size slots back where it belongs. */
export function sortSizes(
  vehicleClass: VehicleClass,
  sizes: readonly VehicleSize[]
): VehicleSize[] {
  const order = sizesForClass(vehicleClass)
  return [...sizes].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}
