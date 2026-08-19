/**
 * Money is stored as integer centavos everywhere to avoid float rounding errors.
 * 15000 centavos === PHP 150.00
 */

export function formatPeso(centavos: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(centavos / 100)
}

export function pesosToCentavos(pesos: number): number {
  return Math.round(pesos * 100)
}

export function centavosToPesos(centavos: number): number {
  return centavos / 100
}
