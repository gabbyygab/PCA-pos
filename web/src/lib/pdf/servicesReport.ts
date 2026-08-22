import { BODY_TOP, MUTED } from './theme'
import {
  createDoc,
  masthead,
  paginate,
  savePdf,
  sectionTitle,
  statRow,
  trimTrailingBlankPage,
  type DocMeta,
} from './doc'
import { emptyNote, houseTable, tableEndY } from './table'
import { pdfPeso } from './text'
import type { ServiceTicket } from '@/lib/queries/services'
import {
  PAYMENT_LABELS,
  SERVICE_STATUS_LABELS,
  VEHICLE_CLASS_LABELS,
  vehicleLabel,
  type PaymentMethod,
} from '@shared/lib/domain'

/**
 * The service record as a printable sheet: every car in the range with its
 * service lines beneath it.
 *
 * Deliberately a different document from the sales report. That one answers
 * "how did the shop do" in aggregate; this one is the ledger a person reads
 * line by line — which car, which services, who worked them, what state each
 * is in. It is what gets printed when a customer queries a bill or the owner
 * reconciles a day by hand, so nothing is rolled up: every line appears.
 */
export function buildServicesReport(
  tickets: ServiceTicket[],
  range: { from: string; to: string },
  filters: { payment: PaymentMethod | 'all' },
  generatedAt = new Date()
) {
  const doc = createDoc()

  const from = new Date(`${range.from}T00:00:00`)
  const to = new Date(`${range.to}T00:00:00`)
  const sameDay = range.from === range.to

  const span = sameDay
    ? from.toLocaleDateString('en-PH', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : `${from.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
      })} — ${to.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`

  const meta: DocMeta = {
    title: 'Service Record',
    subtitle: span,
    tag:
      filters.payment === 'all'
        ? 'All payments'
        : `${PAYMENT_LABELS[filters.payment]} only`,
  }

  masthead(doc, meta)

  // Counted off the lines rather than the headers: a ticket is a car, but the
  // question this sheet answers is about the work on it.
  const lines = tickets.flatMap((t) => t.items)
  const done = lines.filter((l) => l.status === 'done')
  const pending = lines.filter((l) => l.status === 'pending')
  const refunded = lines.filter((l) => l.status === 'refunded')

  const sum = (rows: typeof lines) =>
    rows.reduce((total, l) => total + l.net_total_centavos, 0)

  // Only `done` is revenue, so that tile carries the accent and the other two
  // are labelled for what they are: work owed, and money handed back.
  let y = statRow(doc, BODY_TOP, [
    { label: 'Vehicles', value: String(tickets.length) },
    { label: 'Services', value: String(lines.length) },
    { label: 'Completed', value: pdfPeso(sum(done)), accent: true },
    { label: 'In progress', value: pdfPeso(sum(pending)) },
    { label: 'Refunded', value: pdfPeso(sum(refunded)) },
  ])

  if (tickets.length === 0) {
    y = sectionTitle(doc, y + 12, 'Vehicles', span)
    emptyNote(doc, y, 'No cars were rung up in this range.')
    trimTrailingBlankPage(doc)
    paginate(doc, generatedAt)
    return doc
  }

  y = sectionTitle(
    doc,
    y + 12,
    'Vehicles and services',
    'Only completed services count toward sales'
  )

  // One table per car rather than one long flat table: the reader is looking
  // for a specific vehicle, and a ticket's lines have to stay visually attached
  // to the car they were worked on. autoTable keeps each block off a page break
  // where it can, so a two-line ticket does not straddle the fold.
  for (const ticket of tickets) {
    const voided = ticket.voided_at !== null
    const vehicle = vehicleLabel(ticket.vehicle_note, ticket.plate_number)

    const heading = [
      `#${ticket.receipt_no}`,
      `${VEHICLE_CLASS_LABELS[ticket.vehicle_class]} ${ticket.size}`,
      vehicle,
      ticket.employees?.name,
      new Date(ticket.sold_at).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
      PAYMENT_LABELS[ticket.payment_method],
      voided ? 'VOIDED' : null,
    ]
      .filter(Boolean)
      .join('  ·  ')

    houseTable(doc, {
      meta,
      startY: y,
      head: [[heading, '', '', '', pdfPeso(ticket.total_centavos)]],
      body: ticket.items.map((line) => [
        line.service_name,
        SERVICE_STATUS_LABELS[line.status],
        line.quantity > 1 ? `x${line.quantity}` : '',
        pdfPeso(line.unit_price_centavos),
        // The charged price, struck through in meaning rather than in ink: the
        // status column beside it is what says whether it counted.
        pdfPeso(line.net_total_centavos),
      ]),
      accentColumns: [4],
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 24, textColor: MUTED, fontSize: 7.5 },
        2: { cellWidth: 12, halign: 'center', textColor: MUTED },
        3: { cellWidth: 26, halign: 'right', textColor: MUTED },
        4: { cellWidth: 28, halign: 'right' },
      },
      didParseCell: (cell) => {
        // A refunded or unfinished line prints dimmed, so a glance down the
        // column separates what the shop earned from what it did not.
        if (cell.section !== 'body') return
        const line = ticket.items[cell.row.index]
        if (line && line.status !== 'done') {
          cell.cell.styles.textColor = MUTED
        }
      },
    })

    y = tableEndY(doc) + 6
  }

  trimTrailingBlankPage(doc)
  paginate(doc, generatedAt)
  return doc
}

export function servicesReportFilename(
  range: { from: string; to: string },
  generatedAt = new Date()
): string {
  const span = range.from === range.to ? range.from : `${range.from}_${range.to}`
  return `pca-service-record-${span}-${generatedAt
    .toISOString()
    .slice(11, 16)
    .replace(':', '')}.pdf`
}

export function downloadServicesReport(
  tickets: ServiceTicket[],
  range: { from: string; to: string },
  filters: { payment: PaymentMethod | 'all' }
) {
  const now = new Date()
  savePdf(
    buildServicesReport(tickets, range, filters, now),
    servicesReportFilename(range, now)
  )
}
