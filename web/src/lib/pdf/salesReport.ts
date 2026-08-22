import type { jsPDF } from 'jspdf'
import type { RowInput } from 'jspdf-autotable'
import { BODY_TOP, CONTENT_WIDTH, FAINT, MARGIN, MUTED, RED, RULE, WHITE } from './theme'
import {
  blend,
  createDoc,
  FONT,
  masthead,
  paginate,
  savePdf,
  sectionTitle,
  setFill,
  setStroke,
  setText,
  statRow,
  trimTrailingBlankPage,
  write,
  type DocMeta,
} from './doc'
import { emptyNote, houseTable, tableEndY } from './table'
import { pdfPeso, pdfText } from './text'
import { CATEGORY_LABELS, PAYMENT_LABELS, type PaymentMethod } from '@shared/lib/domain'
import type { ReportData, ReportFilters, ReportRange } from '@/lib/queries/reports'

const RANGE_LABELS: Record<ReportRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  custom: 'Custom range',
}

/**
 * The owner's sales report.
 *
 * Mirrors the Reports tab, but the charts are redrawn as vector bars rather
 * than screenshotted from Recharts — a canvas capture of a dark chart prints as
 * a muddy grey block, while bars drawn straight into the PDF stay crisp at any
 * zoom and cost a fraction of the file size.
 */
export function buildSalesReport(
  data: ReportData,
  range: ReportRange,
  filters: ReportFilters = { payment: 'all' },
  generatedAt = new Date()
) {
  const doc = createDoc()

  // Derive the span from the data itself: `daily` is zero-filled across the
  // whole range by the query, so its first and last keys are the true bounds
  // even when the shop had no sales on either end.
  const first = data.daily[0]?.date
  const last = data.daily[data.daily.length - 1]?.date
  const from = first ? new Date(`${first}T00:00:00`) : generatedAt
  const to = last ? new Date(`${last}T00:00:00`) : generatedAt
  const span = `${from.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  })} — ${to.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`

  const meta: DocMeta = {
    title: 'Sales Report',
    subtitle: span,
    // A filtered report has to say so on its face: printed out, there is
    // nothing else to tell the reader these are only the GCash sales.
    tag:
      filters.payment === 'all'
        ? RANGE_LABELS[range]
        : `${RANGE_LABELS[range]} · ${PAYMENT_LABELS[filters.payment]} only`,
  }

  masthead(doc, meta)

  // Net carries the accent, not gross: it is the number the report is read for.
  let y = statRow(doc, BODY_TOP, [
    { label: 'Gross sales', value: pdfPeso(data.grossCentavos) },
    { label: 'Expenses', value: `- ${pdfPeso(data.expenseCentavos)}` },
    { label: 'Net sales', value: pdfPeso(data.netCentavos), accent: true },
    { label: 'Cars washed', value: String(data.salesCount) },
    { label: 'Average ticket', value: pdfPeso(data.averageTicketCentavos) },
    { label: 'Employee cut', value: pdfPeso(data.commissionCentavos) },
  ])

  y = sectionTitle(doc, y + 12, 'Gross sales per day', RANGE_LABELS[range])
  y = dailyChart(doc, y + 2, data)

  y = sectionTitle(doc, y + 10, 'Best performing services', 'By gross sales')
  if (data.topServices.length === 0) {
    y = emptyNote(doc, y, 'No services sold in this range.')
  } else {
    const maxGross = Math.max(...data.topServices.map((s) => s.grossCentavos))
    houseTable(doc, {
      meta,
      startY: y,
      head: [['Service', 'Category', 'Sold', 'Share', 'Gross']],
      body: data.topServices.map((s) => [
        s.name,
        CATEGORY_LABELS[s.category],
        String(s.count),
        // Rendered as an inline bar by the didDrawCell hook below.
        { content: '', styles: {} },
        pdfPeso(s.grossCentavos),
      ]) as RowInput[],
      accentColumns: [4],
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 26, textColor: MUTED, fontSize: 7.5 },
        2: { cellWidth: 14, halign: 'center', textColor: MUTED },
        3: { cellWidth: 34 },
        4: { cellWidth: 28, halign: 'right' },
      },
      didDrawCell: (cell) => {
        if (cell.section !== 'body' || cell.column.index !== 3) return
        const row = data.topServices[cell.row.index]
        if (!row || maxGross === 0) return
        inlineBar(doc, cell, row.grossCentavos / maxGross)
      },
    })
    y = tableEndY(doc)
  }

  y = sectionTitle(doc, y + 12, 'Sales by vehicle size', 'Cars and motorcycles')
  if (data.bySize.length === 0) {
    y = emptyNote(doc, y, 'No sales in this range.')
  } else {
    const maxSize = Math.max(...data.bySize.map((s) => s.grossCentavos))
    houseTable(doc, {
      meta,
      startY: y,
      head: [['Size', 'Cars', 'Share', 'Gross']],
      body: data.bySize.map((s) => [
        s.size,
        String(s.count),
        { content: '', styles: {} },
        pdfPeso(s.grossCentavos),
      ]) as RowInput[],
      accentColumns: [3],
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 20, halign: 'center', textColor: MUTED },
        2: { cellWidth: 60 },
        3: { cellWidth: 30, halign: 'right' },
      },
      didDrawCell: (cell) => {
        if (cell.section !== 'body' || cell.column.index !== 2) return
        const row = data.bySize[cell.row.index]
        if (!row || maxSize === 0) return
        inlineBar(doc, cell, row.grossCentavos / maxSize)
      },
    })
    y = tableEndY(doc)
  }

  y = sectionTitle(doc, y + 12, 'Employee productivity', 'Gross credits the full car to each crew member')
  if (data.byEmployee.length === 0) {
    y = emptyNote(doc, y, 'No sales in this range.')
  } else {
    houseTable(doc, {
      meta,
      startY: y,
      head: [['Employee', 'Cars', 'Gross worked', 'Commission earned']],
      body: data.byEmployee.map((e) => [
        e.name,
        String(e.salesCount),
        pdfPeso(e.grossCentavos),
        pdfPeso(e.commissionCentavos),
      ]),
      foot: [
        [
          'Total',
          '',
          '',
          pdfPeso(data.byEmployee.reduce((sum, e) => sum + e.commissionCentavos, 0)),
        ],
      ],
      accentColumns: [3],
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 20, halign: 'center', textColor: MUTED },
        2: { cellWidth: 34, halign: 'right', textColor: MUTED },
        3: { cellWidth: 38, halign: 'right' },
      },
    })
    y = tableEndY(doc)
  }

  y = sectionTitle(
    doc,
    y + 12,
    'Sales by payment method',
    'The whole range, regardless of the filter above'
  )
  if (data.byPayment.length === 0) {
    y = emptyNote(doc, y, 'No sales in this range.')
  } else {
    const paymentTotal = data.byPayment.reduce((sum, r) => sum + r.grossCentavos, 0)
    houseTable(doc, {
      meta,
      startY: y,
      head: [['Method', 'Vehicles', 'Share', 'Gross']],
      body: data.byPayment.map((r) => [
        PAYMENT_LABELS[r.method],
        String(r.salesCount),
        paymentTotal ? `${((r.grossCentavos / paymentTotal) * 100).toFixed(1)}%` : '-',
        pdfPeso(r.grossCentavos),
      ]),
      foot: [['Total', '', '', pdfPeso(paymentTotal)]],
      accentColumns: [3],
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 22, halign: 'center', textColor: MUTED },
        2: { cellWidth: 26, halign: 'right', textColor: MUTED },
        3: { cellWidth: 34, halign: 'right' },
      },
    })
    y = tableEndY(doc)
  }

  y = sectionTitle(doc, y + 12, 'Expenses', 'Deducted from gross to give net sales')
  if (data.byExpense.length === 0) {
    y = emptyNote(doc, y, 'No expenses recorded in this range.')
  } else {
    houseTable(doc, {
      meta,
      startY: y,
      head: [['Expense', 'Entries', 'Share of gross', 'Amount']],
      body: data.byExpense.map((e) => [
        e.name,
        String(e.count),
        data.grossCentavos
          ? `${((e.amountCentavos / data.grossCentavos) * 100).toFixed(1)}%`
          : '-',
        pdfPeso(e.amountCentavos),
      ]),
      foot: [['Total', '', '', pdfPeso(data.expenseCentavos)]],
      accentColumns: [3],
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 20, halign: 'center', textColor: MUTED },
        2: { cellWidth: 30, halign: 'right', textColor: MUTED },
        3: { cellWidth: 34, halign: 'right' },
      },
    })
    y = tableEndY(doc)
  }

  trimTrailingBlankPage(doc)
  paginate(doc, generatedAt)
  return doc
}

export function salesReportFilename(
  range: ReportRange,
  payment: PaymentMethod | 'all' = 'all',
  generatedAt = new Date()
): string {
  const suffix = payment === 'all' ? '' : `-${payment}`
  return `pca-sales-report-${range}${suffix}-${generatedAt.toISOString().slice(0, 10)}.pdf`
}

export function downloadSalesReport(
  data: ReportData,
  range: ReportRange,
  filters: ReportFilters = { payment: 'all' }
) {
  const now = new Date()
  savePdf(
    buildSalesReport(data, range, filters, now),
    salesReportFilename(range, filters.payment, now)
  )
}

/** A proportional bar drawn inside a table cell, replacing a chart column. */
function inlineBar(
  doc: jsPDF,
  cell: { cell: { x: number; y: number; width: number; height: number } },
  fraction: number
) {
  const { x, y, width, height } = cell.cell
  const trackWidth = width - 5
  const barHeight = 2.6
  const barY = y + (height - barHeight) / 2

  setFill(doc, [238, 238, 242])
  doc.roundedRect(x + 2.5, barY, trackWidth, barHeight, 1.3, 1.3, 'F')

  const filled = Math.max(trackWidth * Math.min(Math.max(fraction, 0), 1), 1)
  setFill(doc, RED)
  doc.roundedRect(x + 2.5, barY, filled, barHeight, 1.3, 1.3, 'F')
}

/**
 * The daily gross line, drawn as a column chart.
 *
 * Columns rather than a line: at 90 days the columns compress into a readable
 * density strip, whereas a 1-pixel polyline printed on a laser printer breaks
 * up. Only a few labels are drawn so the axis never collides with itself.
 */
function dailyChart(doc: jsPDF, y: number, data: ReportData): number {
  const height = 38
  const days = data.daily
  if (days.length === 0) return emptyNote(doc, y, 'No sales in this range.')

  const max = Math.max(...days.map((d) => d.grossCentavos), 1)
  const gap = days.length > 45 ? 0.4 : 1
  const barWidth = (CONTENT_WIDTH - gap * (days.length - 1)) / days.length

  // Baseline and a midline, so a bar's height can actually be read.
  setStroke(doc, RULE)
  doc.setLineWidth(0.25)
  doc.line(MARGIN.left, y + height, MARGIN.left + CONTENT_WIDTH, y + height)
  doc.line(MARGIN.left, y + height / 2, MARGIN.left + CONTENT_WIDTH, y + height / 2)

  doc.setFont(FONT, 'normal')
  doc.setFontSize(6)
  setText(doc, FAINT)
  write(doc, pdfPeso(max), MARGIN.left, y - 1.5)

  days.forEach((day, i) => {
    const x = MARGIN.left + i * (barWidth + gap)
    const barHeight = (day.grossCentavos / max) * height

    if (barHeight <= 0) return
    // Quiet days still get a hairline so the day is visibly present, not missing.
    const drawn = Math.max(barHeight, 0.35)
    // Busier days read darker: the ramp encodes magnitude twice, which survives
    // a black-and-white photocopy where colour alone would not.
    setFill(doc, blend(RED, WHITE, 0.45 - (day.grossCentavos / max) * 0.45))
    doc.rect(x, y + height - drawn, barWidth, drawn, 'F')
  })

  // Label roughly six evenly spaced days, always including the last.
  const step = Math.max(1, Math.round(days.length / 6))
  doc.setFontSize(5.8)
  setText(doc, FAINT)
  days.forEach((day, i) => {
    if (i % step !== 0 && i !== days.length - 1) return
    const x = MARGIN.left + i * (barWidth + gap) + barWidth / 2
    write(doc, day.label, x, y + height + 4, { align: 'center' })
  })

  return y + height + 6
}
