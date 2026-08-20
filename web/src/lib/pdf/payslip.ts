import type { jsPDF } from 'jspdf'
import type { RowInput } from 'jspdf-autotable'
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
} from './theme'
import {
  appendPage,
  createDoc,
  FONT,
  masthead,
  paginate,
  runningHeader,
  savePdf,
  sectionTitle,
  setFill,
  setStroke,
  setText,
  slug,
  statRow,
  trimTrailingBlankPage,
  write,
  type DocMeta,
} from './doc'
import { emptyNote, houseTable, tableEndY } from './table'
import { pdfAmount, pdfPeso, pdfText, signedPeso } from './text'
import { isOverDeducted, netPay } from '@shared/lib/payroll'
import type { EmployeePayrollDetail } from '@/lib/queries/payrollDetail'

export interface PayslipPeriod {
  start: Date
  end: Date
  /** A finalized week prints as final; an open one is stamped a preview. */
  finalized: boolean
  finalizedAt?: string | null
}

const RANGE_FMT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

export function periodLabel(period: PayslipPeriod): string {
  return `${period.start.toLocaleDateString('en-PH', RANGE_FMT)} — ${period.end.toLocaleDateString(
    'en-PH',
    RANGE_FMT
  )}`
}

/**
 * One employee's payslip for one Monday–Sunday week.
 *
 * The slip is deliberately auditable rather than minimal: every car the
 * employee worked is listed with its date, so a crew member can check the total
 * against their own memory of the week. The crew column matters because a
 * shared car pays a fraction — without it a 26.67 line looks like an error.
 */
export function buildPayslip(
  detail: EmployeePayrollDetail,
  period: PayslipPeriod,
  generatedAt = new Date()
) {
  const doc = createDoc()
  renderPayslip(doc, detail, period)
  trimTrailingBlankPage(doc)
  paginate(doc, generatedAt)
  return doc
}

/**
 * Draws one slip onto the *current* page of `doc`.
 *
 * Split out from `buildPayslip` so the batch export can stack every employee
 * into one document by calling this once per person — rather than copying pages
 * between documents, which would leave each page's fonts behind.
 */
export function renderPayslip(
  doc: jsPDF,
  detail: EmployeePayrollDetail,
  period: PayslipPeriod
): void {
  const meta: DocMeta = {
    title: 'Payroll Slip',
    subtitle: periodLabel(period),
    tag: detail.name,
  }

  masthead(doc, meta)

  let y = BODY_TOP

  // The status stamp sits directly under the name: whether this number is
  // final is the first thing the employee needs to know.
  y = statusStamp(doc, y, period)

  const adjustments = detail.adjustments ?? []
  // Prefer the attached total: for a finalized week it is the frozen figure off
  // the slip, which can differ from re-summing today's ledger.
  const adjustmentTotal =
    detail.adjustmentCentavos ?? adjustments.reduce((sum, a) => sum + a.amount_centavos, 0)
  const net = netPay(detail.commissionCentavos, adjustmentTotal)

  y = statRow(
    doc,
    y + 2,
    adjustmentTotal !== 0
      ? [
          { label: 'Cars worked', value: String(detail.salesCount) },
          { label: 'Commission', value: pdfPeso(detail.commissionCentavos) },
          { label: 'Adjustments', value: signedPeso(adjustmentTotal) },
          { label: 'Net pay', value: pdfPeso(net), accent: true },
        ]
      : [
          { label: 'Cars worked', value: String(detail.salesCount) },
          { label: 'Gross value', value: pdfPeso(detail.grossCentavos) },
          { label: 'Total cut', value: pdfPeso(detail.commissionCentavos), accent: true },
        ]
  )

  // Daily breakdown — the week at a glance, and the answer to "which days am I
  // being paid for".
  y = sectionTitle(doc, y + 12, 'Daily breakdown', 'Monday to Sunday')
  y = dailyStrip(doc, y, detail, period)

  y = sectionTitle(doc, y + 8, 'Cars worked', `${detail.lines.length} service lines`)

  if (detail.lines.length === 0) {
    y = emptyNote(doc, y, 'No cars recorded for this employee in this week.')
  } else {
    const body: RowInput[] = detail.lines.map((line) => [
      new Date(line.soldAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
      `#${line.receiptNo}`,
      line.serviceName,
      line.size,
      line.plateNumber ?? '—',
      line.crewSize > 1 ? `${line.crewSize} crew` : 'Solo',
      pdfPeso(line.lineTotalCentavos),
      pdfPeso(line.commissionCentavos),
    ])

    houseTable(doc, {
      meta,
      startY: y,
      head: [['Date', 'Receipt', 'Service', 'Size', 'Plate', 'Split', 'Line total', 'Your cut']],
      body,
      foot: [
        [
          { content: 'Total', colSpan: 6, styles: { halign: 'right' } },
          pdfPeso(detail.grossCentavos),
          pdfPeso(detail.commissionCentavos),
        ],
      ],
      accentColumns: [7],
      columnStyles: {
        0: { cellWidth: 17 },
        1: { cellWidth: 15, textColor: MUTED },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 12, halign: 'center' },
        4: { cellWidth: 20, textColor: MUTED },
        5: { cellWidth: 15, halign: 'center', textColor: MUTED, fontSize: 7.5 },
        6: { cellWidth: 24, halign: 'right', textColor: MUTED },
        7: { cellWidth: 24, halign: 'right' },
      },
    })
    y = tableEndY(doc)
  }

  if (adjustments.length > 0 || adjustmentTotal !== 0) {
    y = sectionTitle(doc, y + 12, 'Adjustments', 'Bonuses and deductions for this week')
    houseTable(doc, {
      meta,
      startY: y,
      head: [['Reason', 'Amount']],
      body: adjustments.map((a) => [a.reason, signedPeso(a.amount_centavos)]),
      foot: [
        ['Commission', pdfPeso(detail.commissionCentavos)],
        ['Adjustments', signedPeso(adjustmentTotal)],
        ['Net pay', pdfPeso(net)],
      ],
      accentColumns: [1],
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 38, halign: 'right' },
      },
      didParseCell: (data) => {
        // A deduction reads red-on-white like everything else here, so the sign
        // is what distinguishes it; the net-pay row gets the emphasis instead.
        if (data.section === 'foot' && data.row.index === 2) {
          data.cell.styles.fontSize = 10
        }
      },
    })
    y = tableEndY(doc)

    if (isOverDeducted(detail.commissionCentavos, adjustmentTotal)) {
      // The deduction exceeded the week's pay. `netPay` floors at zero, so say
      // so explicitly rather than letting the slip imply the balance vanished.
      doc.setFont(FONT, 'bold')
      doc.setFontSize(7.5)
      setText(doc, [180, 110, 10])
      write(
        doc,
        `Deductions exceeded this week's commission by ${pdfPeso(
          Math.abs(detail.commissionCentavos + adjustmentTotal)
        )}. Net pay is floored at zero; the balance is not carried forward automatically.`,
        MARGIN.left,
        y + 5,
        { maxWidth: CONTENT_WIDTH }
      )
      y += 9
    }
  }

  signatureBlock(doc, y + 12, detail, period, net)
}

export function payslipFilename(detail: EmployeePayrollDetail, period: PayslipPeriod): string {
  const week = period.start.toISOString().slice(0, 10)
  return `pca-payslip-${slug(detail.name)}-${week}.pdf`
}

export function downloadPayslip(detail: EmployeePayrollDetail, period: PayslipPeriod) {
  savePdf(buildPayslip(detail, period), payslipFilename(detail, period))
}

/** FINAL / PREVIEW badge plus the date the week was locked. */
function statusStamp(doc: jsPDF, y: number, period: PayslipPeriod): number {
  const label = period.finalized ? 'FINALIZED' : 'PREVIEW — NOT YET FINALIZED'
  const tone: [number, number, number] = period.finalized ? [22, 130, 62] : [180, 110, 10]
  const wash: [number, number, number] = period.finalized ? [236, 250, 241] : [254, 246, 230]

  doc.setFont(FONT, 'bolditalic')
  doc.setFontSize(7.5)
  const width = doc.getTextWidth(label) + 7

  setFill(doc, wash)
  setStroke(doc, tone)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN.left, y - 4, width, 6.4, 1.2, 1.2, 'FD')

  setText(doc, tone)
  write(doc, label, MARGIN.left + 3.5, y + 0.3, { charSpace: 0.2 })

  if (period.finalized && period.finalizedAt) {
    doc.setFont(FONT, 'normal')
    doc.setFontSize(7.5)
    setText(doc, FAINT)
    write(
      doc,
      `Locked ${new Date(period.finalizedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}`,
      MARGIN.left + width + 4,
      y + 0.3
    )
  }

  return y + 6
}

/**
 * Seven day cells, Monday to Sunday, each showing that day's cut.
 *
 * Days with no work still print, greyed — a blank Wednesday is information, and
 * a gap in the row would make the week look mis-scoped.
 */
function dailyStrip(
  doc: jsPDF,
  y: number,
  detail: EmployeePayrollDetail,
  period: PayslipPeriod
): number {
  const byDay = new Map(detail.byDay.map((d) => [d.dateKey, d]))
  const gap = 2
  const width = (CONTENT_WIDTH - gap * 6) / 7
  const height = 19

  for (let i = 0; i < 7; i += 1) {
    const date = new Date(period.start)
    date.setDate(date.getDate() + i)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`
    const day = byDay.get(key)
    const worked = Boolean(day && day.commissionCentavos > 0)

    const x = MARGIN.left + i * (width + gap)

    setFill(doc, worked ? [253, 240, 240] : [250, 250, 251])
    setStroke(doc, worked ? [246, 205, 205] : RULE)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, y, width, height, 1.4, 1.4, 'FD')

    doc.setFont(FONT, 'bolditalic')
    doc.setFontSize(6.4)
    setText(doc, FAINT)
    write(
      doc,
      date.toLocaleDateString('en-PH', { weekday: 'short' }).toUpperCase(),
      x + width / 2,
      y + 5,
      { align: 'center', charSpace: 0.2 }
    )

    doc.setFont(FONT, 'normal')
    doc.setFontSize(6.4)
    write(doc, String(date.getDate()), x + width / 2, y + 9, { align: 'center' })

    doc.setFont(FONT, 'bold')
    doc.setFontSize(worked ? 7.6 : 7)
    setText(doc, worked ? RED : [200, 200, 206])
    write(
      doc,
      worked ? pdfAmount(day!.commissionCentavos) : '-',
      x + width / 2,
      y + 14,
      { align: 'center' }
    )

    if (worked) {
      doc.setFont(FONT, 'normal')
      doc.setFontSize(5.8)
      setText(doc, FAINT)
      write(doc, `${day!.salesCount} car${day!.salesCount === 1 ? '' : 's'}`, x + width / 2, y + 17.4, {
        align: 'center',
      })
    }
  }

  return y + height
}

/** Received-by line. A cash payout needs a signature to be worth anything. */
function signatureBlock(
  doc: jsPDF,
  y: number,
  detail: EmployeePayrollDetail,
  period: PayslipPeriod,
  amountCentavos: number
): number {
  // Keep the block whole: a signature line split across a page break is worse
  // than one pushed onto the next sheet.
  let top = y
  if (top > PAGE.height - MARGIN.bottom - 34) {
    appendPage(doc)
    runningHeader(doc, { title: 'Payroll Slip', tag: detail.name })
    top = MARGIN.top + 14
  }

  doc.setFont(FONT, 'normal')
  doc.setFontSize(8)
  setText(doc, MUTED)
  write(
      doc,
    `Received the amount of ${pdfPeso(amountCentavos)} as full payment for the period ${periodLabel(
      period
    )}.`,
    MARGIN.left,
    top,
    { maxWidth: CONTENT_WIDTH }
  )

  const lineY = top + 20
  const colWidth = (CONTENT_WIDTH - 16) / 2

  setStroke(doc, INK)
  doc.setLineWidth(0.3)
  doc.line(MARGIN.left, lineY, MARGIN.left + colWidth, lineY)
  doc.line(MARGIN.left + colWidth + 16, lineY, MARGIN.left + colWidth * 2 + 16, lineY)

  doc.setFont(FONT, 'bold')
  doc.setFontSize(8)
  setText(doc, INK)
  write(doc, detail.name, MARGIN.left, lineY + 4)
  write(doc, 'PCA Management', MARGIN.left + colWidth + 16, lineY + 4)

  doc.setFont(FONT, 'normal')
  doc.setFontSize(7)
  setText(doc, FAINT)
  write(doc, 'Employee signature over printed name', MARGIN.left, lineY + 8)
  write(doc, 'Released by', MARGIN.left + colWidth + 16, lineY + 8)

  return lineY + 10
}
