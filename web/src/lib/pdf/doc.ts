import { jsPDF } from 'jspdf'
import {
  BODY_TOP,
  CONTENT_WIDTH,
  FAINT,
  INK,
  MARGIN,
  MUTED,
  PAGE,
  RED,
  RULE,
  WHITE,
  type RGB,
} from './theme'
import { pdfText } from './text'

/**
 * jsPDF ships Helvetica, which is close enough to the app's Inter for body
 * text. There is no condensed italic in the standard 14, so the board's header
 * voice is approximated with bold italic + letter spacing rather than by
 * embedding a font — a webfont would add ~200KB to every export for a header.
 */
export const FONT = 'helvetica'

export interface DocMeta {
  /** Big line under the masthead: "Payroll Slip", "Sales Report". */
  title: string
  /** The period or scope this document covers. */
  subtitle?: string
  /** Shown at the left under the masthead, e.g. an employee name. */
  tag?: string
}

export function createDoc(): jsPDF {
  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
    // Flate-compress the content streams. These documents are mostly repeated
    // table operators, which compress to roughly a third — worth it when a
    // week of payslips is emailed or kept on the shop's aging office PC.
    compress: true,
  })
  doc.setProperties({ creator: 'PCA POS', author: 'PCA Premium Auto Care' })
  return doc
}

/**
 * Every string drawn into a PDF goes through here.
 *
 * jsPDF's built-in Helvetica is WinAnsi-only, so an unsanitised em-dash or peso
 * sign renders as a wrong glyph and desynchronises the rest of the text run.
 * Centralising the fold means no call site can forget it.
 */
export function write(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  options?: Parameters<jsPDF['text']>[3]
) {
  doc.text(pdfText(value), x, y, options)
}

export function setFill(doc: jsPDF, c: RGB) {
  doc.setFillColor(c[0], c[1], c[2])
}
export function setText(doc: jsPDF, c: RGB) {
  doc.setTextColor(c[0], c[1], c[2])
}
export function setStroke(doc: jsPDF, c: RGB) {
  doc.setDrawColor(c[0], c[1], c[2])
}

/** Mix two colours; `t` of 0 keeps `a`, 1 gives `b`. */
export function blend(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/**
 * The board's slanted rule, drawn as three sheared bars of falling intensity.
 * jsPDF has no skew primitive, so each bar is a parallelogram traced by hand.
 */
export function slashRule(doc: jsPDF, x: number, y: number, height = 3) {
  // A 12-degree lean, matching the `.slant` transform in globals.css.
  const lean = height * Math.tan((12 * Math.PI) / 180)
  const bars: { width: number; alpha: number }[] = [
    { width: 13, alpha: 1 },
    { width: 6, alpha: 0.55 },
    { width: 3, alpha: 0.25 },
  ]

  let cursor = x
  for (const bar of bars) {
    // Opacity is faked by blending toward white: an ExtGState would make the
    // bar translucent over whatever it overlaps, which is not what we want on
    // a white ground and costs a graphics state per bar.
    setFill(doc, blend(RED, WHITE, 1 - bar.alpha))
    doc.lines(
      [
        [bar.width, 0],
        [lean, -height],
        [-bar.width, 0],
      ],
      cursor,
      y + height,
      [1, 1],
      'F',
      true
    )
    cursor += bar.width + 1.6
  }
}

/**
 * The masthead every document opens with: slash rule, shop name, document
 * title, and the scope line. Drawn once on page 1 — continuation pages get the
 * lighter running header from `runningHeader`.
 */
export function masthead(doc: jsPDF, meta: DocMeta) {
  slashRule(doc, MARGIN.left, MARGIN.top)

  doc.setFont(FONT, 'bolditalic')
  doc.setFontSize(19)
  setText(doc, INK)
  write(doc, 'PCA', MARGIN.left, MARGIN.top + 12)

  const pcaWidth = doc.getTextWidth('PCA')
  doc.setFont(FONT, 'normal')
  doc.setFontSize(7.5)
  setText(doc, FAINT)
  write(doc, 'PREMIUM AUTO CARE  -  GENERAL TRIAS', MARGIN.left + pcaWidth + 3, MARGIN.top + 12, {
    charSpace: 0.3,
  })

  // Document title, right-aligned against the shop identity.
  doc.setFont(FONT, 'bolditalic')
  doc.setFontSize(15)
  setText(doc, RED)
  write(doc, meta.title.toUpperCase(), PAGE.width - MARGIN.right, MARGIN.top + 11.5, {
    align: 'right',
    charSpace: 0.2,
  })

  let y = MARGIN.top + 17
  if (meta.subtitle) {
    doc.setFont(FONT, 'normal')
    doc.setFontSize(9)
    setText(doc, MUTED)
    write(doc, meta.subtitle, PAGE.width - MARGIN.right, y, { align: 'right' })
    y += 5
  }

  if (meta.tag) {
    doc.setFont(FONT, 'bold')
    doc.setFontSize(10)
    setText(doc, INK)
    write(doc, meta.tag, MARGIN.left, MARGIN.top + 19)
  }

  setStroke(doc, RULE)
  doc.setLineWidth(0.3)
  doc.line(MARGIN.left, BODY_TOP - 8, PAGE.width - MARGIN.right, BODY_TOP - 8)
}

/** The thin identity strip on pages 2+, so a loose sheet is still traceable. */
export function runningHeader(doc: jsPDF, meta: DocMeta) {
  doc.setFont(FONT, 'bolditalic')
  doc.setFontSize(9)
  setText(doc, RED)
  write(doc, 'PCA', MARGIN.left, MARGIN.top + 2)

  doc.setFont(FONT, 'normal')
  doc.setFontSize(8)
  setText(doc, FAINT)
  const trail = [meta.title, meta.tag].filter(Boolean).join(' · ')
  write(doc, trail, PAGE.width - MARGIN.right, MARGIN.top + 2, { align: 'right' })

  setStroke(doc, RULE)
  doc.setLineWidth(0.3)
  doc.line(MARGIN.left, MARGIN.top + 4.5, PAGE.width - MARGIN.right, MARGIN.top + 4.5)
}

/**
 * Page numbers and the generation stamp. Runs after all content exists, so the
 * "of N" is the real total rather than a guess.
 */
export function paginate(doc: jsPDF, generatedAt: Date) {
  const pages = doc.getNumberOfPages()
  const stamp = `Generated ${generatedAt.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    setStroke(doc, RULE)
    doc.setLineWidth(0.3)
    doc.line(
      MARGIN.left,
      PAGE.height - MARGIN.bottom + 2,
      PAGE.width - MARGIN.right,
      PAGE.height - MARGIN.bottom + 2
    )

    doc.setFont(FONT, 'normal')
    doc.setFontSize(7.5)
    setText(doc, FAINT)
    write(doc, stamp, MARGIN.left, PAGE.height - MARGIN.bottom + 7)
    write(
      doc,
      `Page ${page} of ${pages}`,
      PAGE.width - MARGIN.right,
      PAGE.height - MARGIN.bottom + 7,
      { align: 'right' }
    )
  }
}

/**
 * Append a page at the end and make it current.
 *
 * `doc.addPage()` inserts *after the currently selected page*, which is not
 * always the last one — autoTable moves the selection while it paginates. Going
 * through here keeps "add a page" meaning "add it at the end".
 */
export function appendPage(doc: jsPDF) {
  doc.setPage(doc.getNumberOfPages())
  doc.addPage()
}

/**
 * True when the last page carries nothing but jsPDF's per-page preamble.
 *
 * autoTable adds a page as soon as a table ends near the bottom margin, whether
 * or not anything follows. Stacking documents (the all-payslips batch) has to
 * detect that trailing blank, or every employee after the first is preceded by
 * an empty sheet.
 *
 * A fresh page is exactly `["<n> w", "0 G"]` — the default line width and
 * stroke colour. Anything beyond those two entries is real drawing.
 */
export function lastPageIsBlank(doc: jsPDF): boolean {
  const pages = (doc as unknown as { internal: { pages: string[][] } }).internal.pages
  const last = pages[doc.getNumberOfPages()]
  if (!Array.isArray(last)) return false
  return last.every((entry) => /^[\d.]+ w$/.test(entry) || /^[\d.]+ G$/.test(entry))
}

/** Drop a trailing blank page, if autoTable left one behind. */
export function trimTrailingBlankPage(doc: jsPDF) {
  if (doc.getNumberOfPages() > 1 && lastPageIsBlank(doc)) {
    doc.deletePage(doc.getNumberOfPages())
  }
  doc.setPage(doc.getNumberOfPages())
}

export interface StatTile {
  label: string
  value: string
  accent?: boolean
}

/**
 * The headline numbers, as a row of bordered tiles mirroring the dashboard's
 * `Stat` panels. Returns the y to continue at.
 */
export function statRow(doc: jsPDF, y: number, tiles: StatTile[], gap = 3): number {
  if (tiles.length === 0) return y

  const height = 17
  const width = (CONTENT_WIDTH - gap * (tiles.length - 1)) / tiles.length

  tiles.forEach((tile, i) => {
    const x = MARGIN.left + i * (width + gap)

    setFill(doc, tile.accent ? [253, 240, 240] : [250, 250, 252])
    setStroke(doc, tile.accent ? [246, 205, 205] : RULE)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, y, width, height, 1.6, 1.6, 'FD')

    doc.setFont(FONT, 'bolditalic')
    doc.setFontSize(6.8)
    setText(doc, FAINT)
    write(doc, tile.label.toUpperCase(), x + 4, y + 6, { charSpace: 0.28 })

    doc.setFont(FONT, 'bold')
    doc.setFontSize(12.5)
    setText(doc, tile.accent ? RED : INK)
    write(doc, tile.value, x + 4, y + 13.2)
  })

  return y + height
}

/** An italic uppercase section heading with the board's short red underline. */
export function sectionTitle(doc: jsPDF, y: number, title: string, hint?: string): number {
  doc.setFont(FONT, 'bolditalic')
  doc.setFontSize(9.5)
  setText(doc, INK)
  write(doc, title.toUpperCase(), MARGIN.left, y, { charSpace: 0.25 })

  if (hint) {
    doc.setFont(FONT, 'normal')
    doc.setFontSize(7.5)
    setText(doc, FAINT)
    write(doc, hint, PAGE.width - MARGIN.right, y, { align: 'right' })
  }

  setStroke(doc, RED)
  doc.setLineWidth(0.6)
  doc.line(MARGIN.left, y + 1.8, MARGIN.left + 11, y + 1.8)

  return y + 6
}

/**
 * Saving from a Tauri webview: `doc.save()` drives an `<a download>`, which the
 * webview honours with its own save dialog. Keeping it in one place means a
 * future switch to the Tauri fs plugin touches a single function.
 */
export function savePdf(doc: jsPDF, filename: string) {
  doc.save(filename)
}

/** Filesystem-safe slug for the employee/period part of a filename. */
export function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      // Strip the combining marks NFKD just split off, so "José" -> "jose".
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'pca'
  )
}
