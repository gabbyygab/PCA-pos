import type { RowInput } from 'jspdf-autotable'
import { BODY_TOP, MUTED } from './theme'
import {
  appendPage,
  createDoc,
  trimTrailingBlankPage,
  masthead,
  paginate,
  savePdf,
  sectionTitle,
  statRow,
  type DocMeta,
} from './doc'
import { emptyNote, houseTable, tableEndY } from './table'
import { pdfPeso, pdfText, signedPeso } from './text'
import { periodLabel, renderPayslip, type PayslipPeriod } from './payslip'
import { netPay } from '@shared/lib/payroll'
import type { EmployeePayrollDetail } from '@/lib/queries/payrollDetail'

/**
 * The owner's copy of a payroll week: one row per employee, plus a per-day
 * distribution so the week's shape is visible at a glance.
 *
 * This is the sheet that gets filed. The individual payslips are what the crew
 * receives; the register is what reconciles against the cash drawer.
 */
export function buildPayrollRegister(
  details: EmployeePayrollDetail[],
  period: PayslipPeriod,
  generatedAt = new Date()
) {
  const doc = createDoc()
  const meta: DocMeta = {
    title: 'Payroll Register',
    subtitle: periodLabel(period),
    tag: period.finalized ? 'Finalized week' : 'Preview — not yet finalized',
  }

  masthead(doc, meta)

  const totalGross = details.reduce((sum, d) => sum + d.grossCentavos, 0)
  const totalCut = details.reduce((sum, d) => sum + d.commissionCentavos, 0)
  const adjustmentOf = (d: EmployeePayrollDetail) =>
    d.adjustmentCentavos ?? (d.adjustments ?? []).reduce((sum, a) => sum + a.amount_centavos, 0)
  const totalAdjust = details.reduce((sum, d) => sum + adjustmentOf(d), 0)
  const totalNet = details.reduce(
    (sum, d) => sum + netPay(d.commissionCentavos, adjustmentOf(d)),
    0
  )
  // Only widen the table when the week actually has adjustments — a register
  // with two dead columns is harder to read at the counter.
  const hasAdjustments = details.some((d) => adjustmentOf(d) !== 0)
  // Cars are counted across the whole week, not summed per employee — a crew of
  // three on one car must not read as three cars.
  const carIds = new Set<string>()
  for (const detail of details) for (const line of detail.lines) carIds.add(line.saleId)

  let y = statRow(doc, BODY_TOP, [
    { label: 'Cars washed', value: String(carIds.size) },
    { label: 'Gross sales', value: pdfPeso(totalGross) },
    {
      label: hasAdjustments ? 'Net payout' : 'Total payout',
      value: pdfPeso(hasAdjustments ? totalNet : totalCut),
      accent: true,
    },
    { label: 'Employees', value: String(details.length) },
  ])

  y = sectionTitle(doc, y + 12, 'Payout per employee', periodLabel(period))

  if (details.length === 0) {
    y = emptyNote(doc, y, 'No sales were recorded in this week.')
  } else {
    const body: RowInput[] = details.map((detail) => {
      const adjust = adjustmentOf(detail)
      const row = [
        detail.name,
        String(detail.salesCount),
        String(detail.lines.length),
        pdfPeso(detail.grossCentavos),
        pdfPeso(detail.commissionCentavos),
      ]
      if (hasAdjustments) {
        row.push(adjust === 0 ? '-' : signedPeso(adjust))
        row.push(pdfPeso(netPay(detail.commissionCentavos, adjust)))
      }
      row.push('')
      return row
    })

    const head = hasAdjustments
      ? [['Employee', 'Cars', 'Lines', 'Gross worked', 'Commission', 'Adjust.', 'Net pay', 'Signature']]
      : [['Employee', 'Cars', 'Lines', 'Gross worked', 'Cut to pay', 'Signature']]

    const footRow = [
      'Total',
      String(carIds.size),
      String(details.reduce((sum, d) => sum + d.lines.length, 0)),
      pdfPeso(totalGross),
      pdfPeso(totalCut),
    ]
    if (hasAdjustments) {
      footRow.push(totalAdjust === 0 ? '-' : signedPeso(totalAdjust))
      footRow.push(pdfPeso(totalNet))
    }
    footRow.push('')

    // The signature column is always last, and the money column that matters
    // (net pay when adjustments exist, the cut otherwise) is the one before it.
    const signatureCol = head[0].length - 1
    const payCol = signatureCol - 1

    houseTable(doc, {
      meta,
      startY: y,
      head,
      body,
      foot: [footRow],
      accentColumns: [payCol],
      columnStyles: hasAdjustments
        ? {
            0: { cellWidth: 'auto', fontStyle: 'bold' },
            1: { cellWidth: 12, halign: 'center', textColor: MUTED },
            2: { cellWidth: 12, halign: 'center', textColor: MUTED },
            3: { cellWidth: 26, halign: 'right', textColor: MUTED },
            4: { cellWidth: 26, halign: 'right', textColor: MUTED },
            5: { cellWidth: 24, halign: 'right', textColor: MUTED },
            6: { cellWidth: 26, halign: 'right' },
            // Left blank on purpose: signed as the cash is handed over.
            7: { cellWidth: 28 },
          }
        : {
            0: { cellWidth: 'auto', fontStyle: 'bold' },
            1: { cellWidth: 16, halign: 'center', textColor: MUTED },
            2: { cellWidth: 16, halign: 'center', textColor: MUTED },
            3: { cellWidth: 30, halign: 'right', textColor: MUTED },
            4: { cellWidth: 30, halign: 'right' },
            5: { cellWidth: 38 },
          },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === signatureCol) {
          data.cell.styles.lineWidth = { bottom: 0.2, top: 0, left: 0, right: 0 }
        }
      },
    })
    y = tableEndY(doc)
  }

  // Daily distribution across the week, so the owner can see which days carried
  // the payroll.
  const byDay = new Map<string, { commission: number; cars: Set<string> }>()
  for (const detail of details) {
    for (const line of detail.lines) {
      const bucket = byDay.get(line.dateKey) ?? { commission: 0, cars: new Set<string>() }
      bucket.commission += line.commissionCentavos
      bucket.cars.add(line.saleId)
      byDay.set(line.dateKey, bucket)
    }
  }

  if (byDay.size > 0) {
    y = sectionTitle(doc, y + 12, 'Payout by day', 'Monday to Sunday')

    const dayRows: RowInput[] = []
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(period.start)
      date.setDate(date.getDate() + i)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
      ).padStart(2, '0')}`
      const bucket = byDay.get(key)
      dayRows.push([
        date.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' }),
        bucket ? String(bucket.cars.size) : '—',
        bucket ? pdfPeso(bucket.commission) : '—',
      ])
    }

    houseTable(doc, {
      meta,
      startY: y,
      head: [['Day', 'Cars', 'Cut paid']],
      body: dayRows,
      accentColumns: [2],
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 24, halign: 'center', textColor: MUTED },
        2: { cellWidth: 34, halign: 'right' },
      },
    })
    y = tableEndY(doc)
  }

  trimTrailingBlankPage(doc)
  paginate(doc, generatedAt)
  return doc
}

export function registerFilename(period: PayslipPeriod): string {
  return `pca-payroll-${period.start.toISOString().slice(0, 10)}.pdf`
}

export function downloadPayrollRegister(
  details: EmployeePayrollDetail[],
  period: PayslipPeriod
) {
  savePdf(buildPayrollRegister(details, period), registerFilename(period))
}

/**
 * Every payslip for the week in one file, one employee per page.
 *
 * Printing 8 separate PDFs means 8 save dialogs and 8 print jobs; the shop
 * wants to print the stack once and hand them out. Each slip is rendered into
 * the same document via `renderPayslip`, so a slip looks identical whether it
 * is exported alone or as part of the batch.
 */
export function buildAllPayslips(
  details: EmployeePayrollDetail[],
  period: PayslipPeriod,
  generatedAt = new Date()
) {
  const doc = createDoc()

  details.forEach((detail, i) => {
    if (i > 0) appendPage(doc)
    renderPayslip(doc, detail, period)
    // autoTable adds a page whenever a table ends near the bottom margin, so a
    // slip can finish on a blank sheet. Drop it now, while this employee's
    // pages are still the last ones — otherwise the stack grows an empty page
    // between every pair of payslips.
    trimTrailingBlankPage(doc)
  })

  trimTrailingBlankPage(doc)
  paginate(doc, generatedAt)
  return doc
}

export function allPayslipsFilename(period: PayslipPeriod): string {
  return `pca-payslips-${period.start.toISOString().slice(0, 10)}.pdf`
}

export function downloadAllPayslips(details: EmployeePayrollDetail[], period: PayslipPeriod) {
  savePdf(buildAllPayslips(details, period), allPayslipsFilename(period))
}
