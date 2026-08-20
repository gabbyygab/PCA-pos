/**
 * Shared look for every PDF the app produces.
 *
 * The screen is near-black; paper is not. A dark document would burn a
 * cartridge and read badly under the fluorescent light in the shop office, so
 * print inverts to white ground and keeps the board's red as the single accent.
 * That red, the italic uppercase headers, and the slanted rule are what carry
 * the PCA identity onto paper.
 */

export type RGB = [number, number, number]

export const INK: RGB = [17, 17, 19]
export const MUTED: RGB = [110, 110, 118]
export const FAINT: RGB = [150, 150, 158]
export const RULE: RGB = [222, 222, 228]
export const ZEBRA: RGB = [248, 248, 250]
export const RED: RGB = [225, 20, 20]
export const RED_WASH: RGB = [253, 236, 236]
export const WHITE: RGB = [255, 255, 255]

/** A4 portrait in millimetres, the paper the shop actually has. */
export const PAGE = { width: 210, height: 297 } as const

export const MARGIN = { left: 14, right: 14, top: 14, bottom: 18 } as const

export const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right

/** Where the body starts on a page that carries the full masthead. */
export const BODY_TOP = 46
