/**
 * The price board palette, carried over from the dashboard's globals.css.
 * The two clients are the same shop, so a cashier moving between the counter
 * tablet and the desktop should not feel a change of product.
 *
 * React Native has no CSS custom properties, so these are plain constants.
 */

export const colors = {
  ink: '#0A0A0A',
  surface: '#131315',
  surface2: '#1A1A1D',
  line: '#26262B',
  lineStrong: '#34343B',

  red: '#E11414',
  redHot: '#FF2A2A',
  redDeep: '#A50E0E',

  chalk: '#F5F5F4',
  muted: '#A1A1A6',
  faint: '#6B6B70',

  good: '#22C55E',
  warn: '#F59E0B',
} as const

/**
 * Board headers are italic, condensed, uppercase. React Native cannot fake a
 * condensed face, so weight and tracking carry the look instead; body text
 * stays plainly legible exactly as on the dashboard.
 */
export const boardHead = {
  fontStyle: 'italic',
  fontWeight: '800',
  textTransform: 'uppercase',
  letterSpacing: -0.3,
  color: colors.chalk,
} as const

export const boardLabel = {
  fontStyle: 'italic',
  fontWeight: '700',
  textTransform: 'uppercase',
  letterSpacing: 1,
} as const

export const radius = { sm: 8, md: 10, lg: 14, xl: 18 } as const

export const space = (n: number) => n * 4

/**
 * Minimum touch target. The cashier works one-handed, often with wet hands,
 * next to a running wash bay — every tappable thing is at least this tall.
 */
export const TAP = 48
