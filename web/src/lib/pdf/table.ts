import type { jsPDF } from 'jspdf'
import { autoTable, type CellHookData, type RowInput, type UserOptions } from 'jspdf-autotable'
import { FONT, runningHeader, type DocMeta } from './doc'
import { pdfText } from './text'
import { FAINT, INK, MARGIN, MUTED, RED, RULE, ZEBRA } from './theme'

/**
 * One table style for the whole app so a payroll slip and a sales report read
 * as the same document family: hairline rules, no heavy grid, a red-underlined
 * header, and zebra striping that survives a photocopy.
 */
export interface TableOptions {
  head: RowInput[]
  body: RowInput[]
  foot?: RowInput[]
  startY: number
  /** Per-column overrides, keyed by column index. */
  columnStyles?: UserOptions['columnStyles']
  /** Redrawn at the top of every page this table spills onto. */
  meta: DocMeta
  /** Columns whose text should print in the accent red (money that is owed). */
  accentColumns?: number[]
  didParseCell?: (data: CellHookData) => void
  /** Draw on top of a cell — used for the inline share bars in reports. */
  didDrawCell?: (data: CellHookData) => void
}

export function houseTable(doc: jsPDF, options: TableOptions) {
  const accent = new Set(options.accentColumns ?? [])
  // The page the table starts on already carries a masthead (or an earlier
  // section); only the pages the table *spills onto* need the running strip.
  const startPage = doc.getCurrentPageInfo().pageNumber

  autoTable(doc, {
    head: options.head,
    body: options.body,
    foot: options.foot,
    startY: options.startY,
    theme: 'plain',
    margin: { left: MARGIN.left, right: MARGIN.right, top: MARGIN.top + 10, bottom: MARGIN.bottom },
    // Repeat the header on every page; a payroll table that spills is unreadable
    // without it.
    showHead: 'everyPage',
    showFoot: 'lastPage',
    styles: {
      font: FONT,
      fontSize: 8.5,
      cellPadding: { top: 2.4, right: 2.5, bottom: 2.4, left: 2.5 },
      textColor: INK,
      lineColor: RULE,
      lineWidth: 0,
      overflow: 'linebreak',
    },
    headStyles: {
      font: FONT,
      fontStyle: 'bolditalic',
      fontSize: 7,
      textColor: FAINT,
      fillColor: false,
      cellPadding: { top: 1, right: 2.5, bottom: 2.6, left: 2.5 },
      lineColor: RED,
      lineWidth: { bottom: 0.5, top: 0, left: 0, right: 0 },
    },
    bodyStyles: {
      lineColor: RULE,
      lineWidth: { bottom: 0.2, top: 0, left: 0, right: 0 },
    },
    alternateRowStyles: { fillColor: ZEBRA },
    footStyles: {
      font: FONT,
      fontStyle: 'bold',
      fontSize: 9,
      textColor: INK,
      fillColor: false,
      lineColor: INK,
      lineWidth: { top: 0.5, bottom: 0, left: 0, right: 0 },
      cellPadding: { top: 2.8, right: 2.5, bottom: 2.4, left: 2.5 },
    },
    columnStyles: options.columnStyles,
    didParseCell: (data) => {
      // autoTable draws cell text itself, so the WinAnsi fold has to happen
      // here rather than in `write` — otherwise every table leaks raw Unicode.
      if (Array.isArray(data.cell.text)) {
        data.cell.text = data.cell.text.map((line) =>
          typeof line === 'string' ? pdfText(line) : line
        )
      }
      if (data.section === 'body' && accent.has(data.column.index)) {
        data.cell.styles.textColor = RED
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.section === 'foot' && accent.has(data.column.index)) {
        data.cell.styles.textColor = RED
      }
      options.didParseCell?.(data)
    },
    didDrawCell: (data) => {
      options.didDrawCell?.(data)
    },
    didDrawPage: () => {
      // `data.pageNumber` counts pages within this table, not the document, so
      // it restarts at 1 for every table and cannot answer this. Compare
      // against the page the table began on instead — which also keeps the
      // all-payslips batch from stamping a running header over a fresh slip's
      // masthead.
      if (doc.getCurrentPageInfo().pageNumber > startPage) runningHeader(doc, options.meta)
    },
  })
}

/** The y just below the last table drawn, for stacking sections. */
export function tableEndY(doc: jsPDF): number {
  const withTable = doc as jsPDF & { lastAutoTable?: { finalY: number } }
  return withTable.lastAutoTable?.finalY ?? MARGIN.top
}

/** A dimmer secondary line used for "no rows" states inside a section. */
export function emptyNote(doc: jsPDF, y: number, message: string): number {
  doc.setFont(FONT, 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2])
  doc.text(message, MARGIN.left, y + 4)
  return y + 8
}
