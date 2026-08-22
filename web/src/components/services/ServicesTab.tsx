'use client'

import { useMemo, useState } from 'react'
import {
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileDown,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/auth/session'
import { Button } from '@/components/ui/Button'
import { Panel, PanelHeader, SlashRule } from '@/components/ui/Panel'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ConfirmModal } from '@/components/ui/Modal'
import { DateField, QuickSpans, spanDays } from '@/components/ui/DateRange'
import { useToast } from '@/components/ui/Toast'
import { dayKeyOf } from '@/lib/queries/reports'
import { downloadServicesReport } from '@/lib/pdf/servicesReport'
import {
  serviceStatusErrorMessage,
  useDeleteServiceLines,
  useEditServiceLine,
  useEditSaleTicket,
  useSetSaleDiscount,
  useServiceRecords,
  useSetServiceStatus,
  type ServiceFilters,
  type ServiceLine,
  type ServiceTicket,
} from '@/lib/queries/services'
import { ServiceLineDialog, type ServiceLineEdit } from './ServiceLineDialog'
import { formatPeso } from '@shared/lib/currency'
import {
  PAYMENT_LABELS,
  SERVICE_STATUS_LABELS,
  VEHICLE_CLASS_LABELS,
  vehicleLabel,
  type PaymentMethod,
  type ServiceStatus,
} from '@shared/lib/domain'

/** `all` plus every method, in the order the POS offers them. */
const PAYMENT_FILTERS: (PaymentMethod | 'all')[] = [
  'all',
  'cash',
  'gcash',
  'card',
  'bank_transfer',
]

/**
 * The service record: every service rung up in a span of days, grouped by the
 * car, with its fulfilment state editable in place.
 *
 * Built to the same layout on both clients. The owner reads it on the desktop
 * where the grid opens to two columns, and on a phone where it collapses to one
 * — the controls are thumb-sized in both, because the cashier standing at the
 * bay is the primary user and a second, denser desktop-only variant would be a
 * second thing to keep correct.
 *
 * Only a `done` line is revenue, so this page is where the day's takings are
 * actually decided: a service sits at 0 until someone here marks it finished.
 */
export function ServicesTab() {
  const { isOwner } = useSession()
  const today = useMemo(() => dayKeyOf(new Date()), [])
  // A span, not a day. Defaults to today alone, which is the shape the page had
  // before and still the overwhelmingly common case.
  const [range, setRange] = useState({ from: today, to: today })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ServiceStatus | 'all'>('all')
  const [filters, setFilters] = useState<ServiceFilters>({ payment: 'all' })
  /* Refunds move money, so they are confirmed rather than fired on a tap. */
  const [refunding, setRefunding] = useState<{ line: ServiceLine; ticket: ServiceTicket } | null>(
    null
  )
  const [editing, setEditing] = useState<{ line: ServiceLine; ticket: ServiceTicket } | null>(
    null
  )
  /** Line ids ticked for a batch action. Owner-only; see `canDelete`. */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const rangeError =
    range.from && range.to && range.from > range.to
      ? 'The start date is after the end date.'
      : undefined

  const { data, isLoading, isError, error } = useServiceRecords(range, filters)
  const setStatus = useSetServiceStatus()
  const editLine = useEditServiceLine()
  const editTicket = useEditSaleTicket()
  const setDiscount = useSetSaleDiscount()
  const deleteLines = useDeleteServiceLines()
  const { toast } = useToast()

  const isToday = range.from === today && range.to === today
  const singleDay = range.from === range.to
  // A cashier's RLS only reaches today, so offering them a date picker would
  // show an empty yesterday and read as "the shop had no sales".
  const canChangeDay = isOwner
  // Deletion is owner-only in Postgres too; hiding it from a cashier keeps the
  // UI honest rather than letting them tap into a refusal.
  const canDelete = isOwner

  const tickets = useMemo(() => {
    const rows = data ?? []
    const needle = search.trim().toLowerCase()
    return rows
      .map((ticket) => ({
        ...ticket,
        // Kept off the filtered list: the card's refund badge must still show
        // while the view is narrowed to "In progress".
        refundedCount: ticket.items.filter((i) => i.status === 'refunded').length,
        items: ticket.items.filter((i) => filter === 'all' || i.status === filter),
      }))
      .filter((ticket) => {
        if (ticket.items.length === 0) return false
        if (!needle) return true
        return (
          ticket.plate_number?.toLowerCase().includes(needle) ||
          ticket.vehicle_note?.toLowerCase().includes(needle) ||
          String(ticket.receipt_no).includes(needle) ||
          ticket.employees?.name.toLowerCase().includes(needle) ||
          ticket.items.some((i) => i.service_name.toLowerCase().includes(needle))
        )
      })
  }, [data, search, filter])

  const counts = useMemo(() => {
    const all = (data ?? []).flatMap((t) => t.items)
    return {
      all: all.length,
      pending: all.filter((i) => i.status === 'pending').length,
      done: all.filter((i) => i.status === 'done').length,
      refunded: all.filter((i) => i.status === 'refunded').length,
    }
  }, [data])

  /** The ids currently on screen — what "select all" means at this moment. */
  const visibleIds = useMemo(
    () => tickets.flatMap((t) => t.items.map((i) => i.id)),
    [tickets]
  )

  /**
   * The selection, narrowed to what is actually on screen.
   *
   * Derived during render rather than pruned in an effect: a stored selection
   * that outlived a filter change would let the owner delete rows they can no
   * longer see, and syncing it back with `setSelected` in an effect is a
   * cascading render for state React can simply compute. `selected` stays the
   * raw record of what was ticked, so narrowing the filter and widening it
   * again does not silently drop the ticks in between.
   */
  const effectiveSelection = useMemo(() => {
    if (selected.size === 0) return selected
    const visible = new Set(visibleIds)
    return new Set([...selected].filter((id) => visible.has(id)))
  }, [selected, visibleIds])

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => effectiveSelection.has(id))

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function shiftDay(delta: number) {
    // Steps the whole span, keeping its width — paging a week back moves to the
    // week before it, not to a one-day window.
    const from = new Date(`${range.from}T00:00:00`)
    const to = new Date(`${range.to}T00:00:00`)
    from.setDate(from.getDate() + delta)
    to.setDate(to.getDate() + delta)
    const nextTo = dayKeyOf(to)
    if (nextTo > today) return
    setRange({ from: dayKeyOf(from), to: nextTo })
  }

  async function apply(line: ServiceLine, status: ServiceStatus) {
    try {
      await setStatus.mutateAsync({ saleItemId: line.id, status })
      toast({
        message:
          status === 'refunded'
            ? `${line.service_name} refunded`
            : `${line.service_name} marked ${SERVICE_STATUS_LABELS[status].toLowerCase()}`,
        detail:
          status === 'refunded'
            ? `${formatPeso(line.net_total_centavos)} taken off the sale and the crew's commission.`
            : status === 'done'
              ? `${formatPeso(line.net_total_centavos)} now counts toward sales.`
              : `${formatPeso(line.net_total_centavos)} no longer counts until it is done again.`,
        tone: status === 'refunded' ? 'error' : 'success',
      })
    } catch (err) {
      toast({
        message: 'Could not update',
        detail: serviceStatusErrorMessage(err),
        tone: 'error',
      })
    }
  }

  /** Mark every ticked line done in one pass — the end-of-day sweep. */
  async function markSelectedDone() {
    const ids = [...effectiveSelection]
    let failed = 0
    for (const id of ids) {
      try {
        await setStatus.mutateAsync({ saleItemId: id, status: 'done' })
      } catch {
        failed += 1
      }
    }
    setSelected(new Set())
    toast({
      message: failed
        ? `${ids.length - failed} of ${ids.length} marked done`
        : `${ids.length} service${ids.length === 1 ? '' : 's'} marked done`,
      detail: failed ? `${failed} could not be updated.` : 'They now count toward sales.',
      tone: failed ? 'error' : 'success',
    })
  }

  async function deleteSelected() {
    const ids = [...effectiveSelection]
    try {
      const removed = await deleteLines.mutateAsync(ids)
      setSelected(new Set())
      setConfirmingDelete(false)
      setEditing(null)
      toast({
        message: `${removed} service${removed === 1 ? '' : 's'} deleted`,
        detail: 'Removed from the ticket entirely, and the totals resummed.',
        tone: 'success',
      })
    } catch (err) {
      toast({
        message: 'Could not delete',
        detail: serviceStatusErrorMessage(err),
        tone: 'error',
      })
    }
  }

  async function saveEdit(edit: ServiceLineEdit) {
    const target = editing
    if (!target) return
    try {
      await editLine.mutateAsync({
        saleItemId: target.line.id,
        quantity: edit.quantity,
        unitPriceCentavos: edit.unitPriceCentavos,
        employeeIds: edit.employeeIds,
      })
      // Status moves through its own RPC, and only when it actually changed —
      // `edit_sale_item` deliberately does not touch it.
      if (edit.status !== target.line.status) {
        await setStatus.mutateAsync({ saleItemId: target.line.id, status: edit.status })
      }
      // The header is a third RPC, and only when one of its fields actually
      // moved: a line edit on an untouched ticket should not write `sales`.
      // Empty is a real answer for the two optional text fields — it clears
      // them — so it is compared against null, not skipped.
      const nextNote = edit.vehicleNote === '' ? null : edit.vehicleNote
      const nextPlate = edit.plateNumber === '' ? null : edit.plateNumber
      const ticketChanged =
        edit.paymentMethod !== target.ticket.payment_method ||
        nextNote !== (target.ticket.vehicle_note ?? null) ||
        nextPlate !== (target.ticket.plate_number ?? null)
      if (ticketChanged) {
        await editTicket.mutateAsync({
          saleId: target.ticket.id,
          paymentMethod: edit.paymentMethod,
          vehicleNote: nextNote,
          plateNumber: nextPlate,
        })
      }
      // The promo is a fourth RPC, for the same reason the header is a third:
      // it writes different rows (every line on the ticket), and it must not
      // fire on a ticket whose promo nobody touched. `edit_sale_item` above
      // already re-applied this line's own discount at its stored rate, so
      // this call is only for an actual change of rate.
      const promoChanged = edit.discountRateBp !== target.line.discount_rate_bp
      if (promoChanged) {
        await setDiscount.mutateAsync({
          saleId: target.ticket.id,
          discountRateBp: edit.discountRateBp,
        })
      }
      setEditing(null)
      toast({
        message: `${target.line.service_name} updated`,
        detail: promoChanged
          ? 'The promo was applied across the whole ticket. Commission is unchanged — the crew is paid on the full price.'
          : ticketChanged
            ? 'The line, its commission, the sale total, and the ticket details were updated.'
            : 'The line, its commission, and the sale total were recalculated.',
        tone: 'success',
      })
    } catch (err) {
      toast({
        message: 'Could not save',
        detail: serviceStatusErrorMessage(err),
        tone: 'error',
      })
    }
  }

  function onExport() {
    if (!data) return
    try {
      // Exports what is on screen, filters and all — a PDF that silently
      // disagreed with the page it was printed from would be worse than none.
      downloadServicesReport(tickets, range, filters)
      toast({ message: 'Service record exported', detail: 'Saved as PDF.', tone: 'success' })
    } catch (err) {
      toast({
        message: 'Could not export',
        detail: err instanceof Error ? err.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  const busy =
    setStatus.isPending ||
    editLine.isPending ||
    editTicket.isPending ||
    setDiscount.isPending ||
    deleteLines.isPending

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line px-4 pb-4 pt-5 sm:px-6">
        <SlashRule className="mb-3" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="board-head text-2xl text-chalk">Services</h1>
            {canChangeDay ? (
              <div className="flex items-center gap-1">
                <DayArrow label="Previous period" onClick={() => shiftDay(-1)}>
                  <ChevronLeft size={16} />
                </DayArrow>
                <DayArrow
                  label="Next period"
                  disabled={range.to >= today}
                  onClick={() => shiftDay(1)}
                >
                  <ChevronRight size={16} />
                </DayArrow>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <p className="text-xs text-faint">
              {isToday ? 'Today' : ''}{' '}
              <span className="text-muted">
                {singleDay
                  ? new Date(`${range.from}T00:00:00`).toLocaleDateString('en-PH', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })
                  : `${range.from} → ${range.to}`}
              </span>
            </p>
            <Button
              size="sm"
              variant="primary"
              onClick={onExport}
              disabled={!data || isLoading || tickets.length === 0}
            >
              <FileDown size={14} />
              Export PDF
            </Button>
          </div>
        </div>

        {canChangeDay ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <DateField
              id="services-from"
              label="From"
              value={range.from}
              max={range.to || today}
              onChange={(from) => setRange((r) => ({ ...r, from }))}
            />
            <DateField
              id="services-to"
              label="To"
              value={range.to}
              min={range.from || undefined}
              max={today}
              onChange={(to) => setRange((r) => ({ ...r, to }))}
            />
            <QuickSpans onPick={setRange} />
            <button
              onClick={() => setRange({ from: today, to: today })}
              className={cn(
                'rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-muted',
                'transition-colors duration-150 hover:border-line-strong hover:text-chalk'
              )}
            >
              Today
            </button>
            {rangeError ? (
              <p className="pb-2 text-xs font-semibold text-red">{rangeError}</p>
            ) : (
              <p className="pb-2 text-xs text-faint">
                <CalendarRange size={11} className="mr-1 inline align-[-1px]" />
                {spanDays(range)} day{spanDays(range) === 1 ? '' : 's'}
              </p>
            )}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Vehicle, plate, receipt, service, crew"
              className={cn(
                'w-full rounded-lg border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-chalk',
                'placeholder:text-faint focus:border-line-strong focus:outline-none'
              )}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All {counts.all}
            </FilterChip>
            <FilterChip
              active={filter === 'pending'}
              tone="pending"
              onClick={() => setFilter('pending')}
            >
              In progress {counts.pending}
            </FilterChip>
            <FilterChip active={filter === 'done'} tone="done" onClick={() => setFilter('done')}>
              Done {counts.done}
            </FilterChip>
            <FilterChip
              active={filter === 'refunded'}
              tone="refunded"
              onClick={() => setFilter('refunded')}
            >
              Refunded {counts.refunded}
            </FilterChip>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="board-label text-[10px] text-faint">Payment</span>
          {PAYMENT_FILTERS.map((method) => (
            <button
              key={method}
              onClick={() => setFilters((f) => ({ ...f, payment: method }))}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-[11px] font-semibold',
                'transition-[transform,background-color,border-color,color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
                'active:scale-[0.97]',
                filters.payment === method
                  ? 'border-red bg-red/12 text-chalk'
                  : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
              )}
            >
              {method === 'all' ? 'All' : PAYMENT_LABELS[method]}
            </button>
          ))}
        </div>
      </header>

      {/* The batch bar only exists while something is ticked, so it never takes
          room from the record in the ordinary case. */}
      {canDelete && effectiveSelection.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5 sm:px-6">
          <p className="text-xs font-semibold text-chalk">
            {effectiveSelection.size} selected
          </p>
          <button
            onClick={() =>
              setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))
            }
            className="text-[11px] font-semibold text-muted hover:text-chalk"
          >
            {allVisibleSelected ? 'Clear all' : `Select all ${visibleIds.length}`}
          </button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={markSelectedDone} disabled={busy}>
              <CheckCircle2 size={13} />
              Mark done
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              <Trash2 size={13} />
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
        {rangeError ? (
          <Panel className="p-6">
            <p className="text-sm text-muted">Pick a valid date range to see the record.</p>
          </Panel>
        ) : isError ? (
          <Panel className="p-6">
            <p className="text-sm font-semibold text-red">Could not load the service record.</p>
            <p className="mt-1 text-xs text-muted">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </Panel>
        ) : isLoading ? (
          <TableSkeleton />
        ) : tickets.length === 0 ? (
          <Panel className="p-8 text-center">
            <p className="text-sm text-muted">
              {search || filter !== 'all' || filters.payment !== 'all'
                ? 'No services match that.'
                : isToday
                  ? 'No cars rung up yet today.'
                  : 'No sales in this range.'}
            </p>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                refundedCount={ticket.refundedCount}
                busy={busy}
                selectable={canDelete}
                selected={effectiveSelection}
                onToggleSelect={toggleSelected}
                onSet={apply}
                onRefund={(line) => setRefunding({ line, ticket })}
                onEdit={(line) => setEditing({ line, ticket })}
              />
            ))}
          </div>
        )}
      </div>

      {editing ? (
        <ServiceLineDialog
          line={editing.line}
          ticket={editing.ticket}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
          onDelete={
            canDelete
              ? () => {
                  // Routed through the same batch confirm, so a one-line delete
                  // and a ten-line delete take the identical path.
                  setSelected(new Set([editing.line.id]))
                  setConfirmingDelete(true)
                }
              : undefined
          }
        />
      ) : null}

      {refunding ? (
        <ConfirmModal
          title={`Refund ${refunding.line.service_name}?`}
          hint={`${formatPeso(
            refunding.line.net_total_centavos
          )} comes off receipt #${refunding.ticket.receipt_no} and off the crew's commission for it. The line stays on the ticket marked refunded.`}
          confirmLabel="Refund"
          destructive
          busy={busy}
          onConfirm={async () => {
            await apply(refunding.line, 'refunded')
            setRefunding(null)
          }}
          onClose={() => setRefunding(null)}
        />
      ) : null}

      {confirmingDelete ? (
        <ConfirmModal
          title={`Delete ${effectiveSelection.size} service${
            effectiveSelection.size === 1 ? '' : 's'
          }?`}
          hint="This removes the line from the ticket for good, along with the crew's commission for it, and cannot be undone. To keep a record of what was ordered, refund it instead — that leaves the line on the receipt, struck through. A ticket left with no lines is voided."
          confirmLabel="Delete"
          destructive
          busy={busy}
          onConfirm={deleteSelected}
          onClose={() => setConfirmingDelete(false)}
        />
      ) : null}
    </div>
  )
}

function TicketCard({
  ticket,
  refundedCount,
  busy,
  selectable,
  selected,
  onToggleSelect,
  onSet,
  onRefund,
  onEdit,
}: {
  ticket: ServiceTicket
  /** Off the whole ticket, not the filtered view — see `tickets` above. */
  refundedCount: number
  busy: boolean
  selectable: boolean
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onSet: (line: ServiceLine, status: ServiceStatus) => void
  onRefund: (line: ServiceLine) => void
  onEdit: (line: ServiceLine) => void
}) {
  const voided = ticket.voided_at !== null

  return (
    <Panel className={cn(voided && 'opacity-60')}>
      <PanelHeader
        title={`#${ticket.receipt_no} · ${VEHICLE_CLASS_LABELS[ticket.vehicle_class]} ${ticket.size}`}
        hint={
          [
            // The vehicle name leads: it is what someone at the bay is looking
            // at, with the plate as the tie-breaker between two of the same car.
            vehicleLabel(ticket.vehicle_note, ticket.plate_number),
            ticket.employees?.name,
            PAYMENT_LABELS[ticket.payment_method],
            new Date(ticket.sold_at).toLocaleTimeString('en-PH', {
              hour: 'numeric',
              minute: '2-digit',
            }),
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        action={
          <div className="flex items-center gap-2">
            {/* The struck-through line is easy to miss on a long ticket, so the
                card says up front that money came back off it. */}
            {refundedCount > 0 ? (
              <span className="board-label flex items-center gap-1 rounded-full border border-red/40 bg-red/10 px-2 py-1 text-[10px] text-red">
                <RotateCcw size={10} />
                {refundedCount} refunded
              </span>
            ) : null}
            <div className="text-right">
              <p className="text-sm font-bold tabular-nums text-chalk">
                {formatPeso(ticket.total_centavos)}
              </p>
              {voided ? <p className="board-label text-[10px] text-red">Voided</p> : null}
            </div>
          </div>
        }
      />
      <ul className="divide-y divide-line">
        {ticket.items.map((line) => (
          <LineRow
            key={line.id}
            line={line}
            disabled={busy || voided}
            selectable={selectable && !voided}
            checked={selected.has(line.id)}
            onToggleSelect={() => onToggleSelect(line.id)}
            onSet={(status) => onSet(line, status)}
            onRefund={() => onRefund(line)}
            onEdit={() => onEdit(line)}
          />
        ))}
      </ul>
    </Panel>
  )
}

function LineRow({
  line,
  disabled,
  selectable,
  checked,
  onToggleSelect,
  onSet,
  onRefund,
  onEdit,
}: {
  line: ServiceLine
  disabled: boolean
  selectable: boolean
  checked: boolean
  onToggleSelect: () => void
  onSet: (status: ServiceStatus) => void
  onRefund: () => void
  onEdit: () => void
}) {
  const refunded = line.status === 'refunded'

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3',
        checked && 'bg-red/8'
      )}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleSelect}
          aria-label={`Select ${line.service_name}`}
          className="size-4 shrink-0 accent-red"
        />
      ) : null}

      {/* The name is the affordance for the modal: a whole row that opened a
          dialog would fight the buttons sitting inside it. */}
      <button
        onClick={onEdit}
        disabled={disabled}
        className="min-w-0 flex-1 text-left disabled:pointer-events-none"
      >
        <p
          className={cn(
            'flex items-center gap-1.5 truncate text-sm text-chalk',
            refunded && 'text-muted line-through decoration-red/70'
          )}
        >
          {line.service_name}
          {line.quantity > 1 ? (
            <span className="text-faint">×{line.quantity}</span>
          ) : null}
          <Pencil size={11} className="shrink-0 text-faint" />
        </p>
        <StatusPill status={line.status} />
      </button>

      {/* A discounted line shows what the customer paid, with the board price
          struck above it — the promo has to be visible on the record, or the
          ticket looks mispriced against the price board. */}
      <div className="text-right">
        {line.discount_centavos > 0 ? (
          <p className="text-[11px] font-medium tabular-nums text-faint line-through">
            {formatPeso(line.line_total_centavos)}
          </p>
        ) : null}
        <p
          className={cn(
            'text-sm font-semibold tabular-nums',
            refunded ? 'text-muted line-through' : 'text-chalk'
          )}
        >
          {formatPeso(line.net_total_centavos)}
        </p>
        {line.discount_centavos > 0 ? (
          <p className="text-[10px] font-semibold uppercase tracking-wide text-red">
            {line.discount_rate_bp / 100}% off
          </p>
        ) : null}
      </div>

      {/* Actions are full-width on a phone so each is a comfortable thumb
          target, and tuck onto the row once there is width for them. */}
      <div className="flex w-full gap-1.5 sm:w-auto">
        {refunded ? (
          <LineAction disabled={disabled} onClick={() => onSet('done')}>
            <Undo2 size={13} />
            Undo refund
          </LineAction>
        ) : (
          <>
            <LineAction
              disabled={disabled}
              active={line.status === 'done'}
              onClick={() => onSet(line.status === 'done' ? 'pending' : 'done')}
            >
              <CheckCircle2 size={13} />
              {line.status === 'done' ? 'Done' : 'Mark done'}
            </LineAction>
            <LineAction disabled={disabled} tone="danger" onClick={onRefund}>
              Refund
            </LineAction>
          </>
        )}
      </div>
    </li>
  )
}

function StatusPill({ status }: { status: ServiceStatus }) {
  // Refunded is the one status that changes what the ticket is worth, so it
  // gets a filled badge; done and pending stay quiet text on their own line.
  if (status === 'refunded') {
    return (
      <span className="board-label mt-1 inline-flex items-center gap-1 rounded-full border border-red/40 bg-red/10 px-2 py-0.5 text-[10px] text-red">
        <RotateCcw size={10} />
        {SERVICE_STATUS_LABELS.refunded}
      </span>
    )
  }

  return (
    <span
      className={cn(
        'board-label mt-0.5 flex items-center gap-1 text-[10px]',
        status === 'done' ? 'text-emerald-400' : 'text-amber-400'
      )}
    >
      {status === 'pending' ? <Clock size={10} /> : null}
      {SERVICE_STATUS_LABELS[status]}
    </span>
  )
}

function LineAction({
  children,
  onClick,
  disabled,
  active,
  tone,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  tone?: 'danger'
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold sm:flex-none',
        'transition-[transform,background-color,border-color,color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
        'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        active
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : tone === 'danger'
            ? 'border-line bg-surface text-muted hover:border-red/50 hover:text-red'
            : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
      )}
    >
      {children}
    </button>
  )
}

function FilterChip({
  children,
  active,
  onClick,
  tone,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  tone?: 'pending' | 'done' | 'refunded'
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-2 text-[11px] font-semibold',
        'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
        active
          ? tone === 'refunded'
            ? 'border-red bg-red text-white'
            : 'border-line-strong bg-surface-2 text-chalk'
          : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
      )}
    >
      {children}
    </button>
  )
}

function DayArrow({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-muted',
        'transition-colors duration-150 hover:border-line-strong hover:text-chalk',
        'disabled:pointer-events-none disabled:opacity-30'
      )}
    >
      {children}
    </button>
  )
}
