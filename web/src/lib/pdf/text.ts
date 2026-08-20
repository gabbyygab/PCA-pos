/**
 * Text sanitising for the PDF layer.
 *
 * jsPDF's built-in Helvetica is WinAnsi-encoded. Anything outside that set is
 * emitted as a wrong glyph and, worse, throws off the rest of the run — the
 * peso sign U+20B1 prints as "±" and the digits behind it come out spaced.
 * Embedding a Unicode font would fix it properly but costs ~200KB per document
 * for one symbol, so instead every string is folded to WinAnsi at the boundary.
 */

/** WinAnsi has no U+20B1, so peso amounts print with the "PHP" prefix. */
const PESO = '₱'

const REPLACEMENTS: [RegExp, string][] = [
  [/₱ ?/g, 'PHP '], // ₱ (plus the NBSP some locales insert after it)
  [/[–—]/g, '-'], // en/em dash
  [/[‘’‛]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, '...'],
  [/[   ]/g, ' '], // non-breaking spaces of various widths
  [/•/g, '-'],
]

/**
 * Fold a string to something Helvetica can actually draw.
 *
 * Anything still outside Latin-1 after the substitutions is dropped rather than
 * rendered as a wrong glyph — a missing character is less misleading on a
 * payroll document than a plausible-looking wrong one.
 */
export function pdfText(value: string): string {
  let out = value
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement)
  return out.replace(/[^\x20-\xFF]/g, '')
}

/**
 * Money for print: "PHP 20,950.00".
 *
 * Deliberately not `formatPeso` — that one is for the screen, where the ₱ glyph
 * renders correctly and is the right thing to show. Both read from the same
 * integer centavos, so the numbers never disagree.
 */
export function pdfPeso(centavos: number): string {
  const pesos = centavos / 100
  const formatted = pesos.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `PHP ${formatted}`
}

/**
 * A signed amount, for adjustment rows: "+PHP 500.00" / "-PHP 250.00".
 *
 * The sign is always explicit — on a payout document "PHP 250.00" next to a
 * deduction is ambiguous in exactly the way that starts an argument.
 */
export function signedPeso(centavos: number): string {
  const sign = centavos < 0 ? '-' : '+'
  return `${sign}${pdfPeso(Math.abs(centavos))}`
}

/** The compact form for tight cells: "20,950.00", no currency prefix. */
export function pdfAmount(centavos: number): string {
  return (centavos / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export { PESO }
