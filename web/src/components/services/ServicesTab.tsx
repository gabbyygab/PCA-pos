'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Search, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/auth/session'
import { Panel, PanelHeader, SlashRule } from '@/components/ui/Panel'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ConfirmModal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { dayKeyOf } from '@/lib/queries/reports'
import {
  serviceStatusErrorMessage,
  useServiceRecords,
  useSetServiceStatus,
  type ServiceLine,
  type ServiceTicket,
} from '@/lib/queries/services'
import { formatPeso } from '@shared/lib/currency'
import {
  SERVICE_STATUS_LABELS,
  VEHICLE_CLASS_LABELS,
  type ServiceStatus,
} from '@shared/lib/domain'

/**
 * The service record: every service rung up on a day, grouped by the car, with
 * its fulfilment state editable in place.
 *
 * Built to the same layout on both clients. The owner reads it on the desktop
 * where the grid opens to two columns, and on a phone where it collapses to one
 * — the controls are thumb-sized in both, because the cashier standing at the
 * bay is the primary user and a second, denser desktop-only variant would be a
 * second thing to keep correct.
 */
export function ServicesTab() {
  const { isOwner } = useSession()
  const today = useMemo(() => dayKeyOf(new Date()), [])
  const [day, setDay] = useState(today)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ServiceStatus | 'all'>('all')
  /* Refunds move money, so they are confirmed rather than fired on a tap. */
  const [refunding, setRefunding] = useState<{ line: ServiceLine; ticket: ServiceTicket } | null>(
    null
  )

  const { data, isLoading, isError, error } = useServiceRecords(day)
  const setStatus = useSetServiceStatus()
  const { toast } = useToast()

  const isToday = day === today
  // A cashier's RLS only reaches today; showing them arrows into an empty
  // yesterday would look like the shop had no sales.
  const canChangeDay = isOwner

  const tickets = useMemo(() => {
    const rows = data ?? []
    const needle = search.trim().toLowerCase()
    return rows
      .map((ticket) => ({
        ...ticket,
        items: ticket.items.filter((i) => filter === 'all' || i.status === filter),
      }))
      .filter((ticket) => {
        if (ticket.items.length === 0) return false
        if (!needle) return true
        return (
          ticket.plate_number?.toLowerCase().includes(needle) ||
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

  function shiftDay(delta: number) {
    const d = new Date(`${day}T00:00:00`)
    d.setDate(d.getDate() + delta)
    const next = dayKeyOf(d)
    if (next > today) return
    setDay(next)
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
            ? `${formatPeso(line.line_total_centavos)} taken off the sale and the crew's commission.`
            : undefined,
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line px-4 pb-4 pt-5 sm:px-6">
        <SlashRule className="mb-3" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="board-head text-2xl text-chalk">Services</h1>
            {canChangeDay ? (
              <div className="flex items-center gap-1">
                <DayArrow label="Previous day" onClick={() => shiftDay(-1)}>
                  <ChevronLeft size={16} />
                </DayArrow>
                <DayArrow label="Next day" disabled={isToday} onClick={() => shiftDay(1)}>
                  <ChevronRight size={16} />
                </DayArrow>
              </div>
            ) : null}
          </div>

          <p className="text-xs text-faint">
            {isToday ? 'Today' : ''}{' '}
            <span className="text-muted">
              {new Date(`${day}T00:00:00`).toLocaleDateString('en-PH', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Plate, receipt, service, crew"
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
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
        {isError ? (
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
              {search || filter !== 'all'
                ? 'No services match that.'
                : isToday
                  ? 'No cars rung up yet today.'
                  : 'No sales on this day.'}
            </p>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                busy={setStatus.isPending}
                onSet={apply}
                onRefund={(line) => setRefunding({ line, ticket })}
              />
            ))}
          </div>
        )}
      </div>

      {refunding ? (
        <ConfirmModal
          title={`Refund ${refunding.line.service_name}?`}
          hint={`${formatPeso(
            refunding.line.line_total_centavos
          )} comes off receipt #${refunding.ticket.receipt_no} and off the crew's commission for it. The line stays on the ticket marked refunded.`}
          confirmLabel="Refund"
          destructive
          busy={setStatus.isPending}
          onConfirm={async () => {
            await apply(refunding.line, 'refunded')
            setRefunding(null)
          }}
          onClose={() => setRefunding(null)}
        />
      ) : null}
    </div>
  )
}

function TicketCard({
  ticket,
  busy,
  onSet,
  onRefund,
}: {
  ticket: ServiceTicket
  busy: boolean
  onSet: (line: ServiceLine, status: ServiceStatus) => void
  onRefund: (line: ServiceLine) => void
}) {
  const voided = ticket.voided_at !== null

  return (
    <Panel className={cn(voided && 'opacity-60')}>
      <PanelHeader
        title={`#${ticket.receipt_no} · ${VEHICLE_CLASS_LABELS[ticket.vehicle_class]} ${ticket.size}`}
        hint={
          [
            ticket.plate_number,
            ticket.employees?.name,
            new Date(ticket.sold_at).toLocaleTimeString('en-PH', {
              hour: 'numeric',
              minute: '2-digit',
            }),
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        action={
          <div className="text-right">
            <p className="text-sm font-bold tabular-nums text-chalk">
              {formatPeso(ticket.total_centavos)}
            </p>
            {voided ? (
              <p className="board-label text-[10px] text-red">Voided</p>
            ) : null}
          </div>
        }
      />
      <ul className="divide-y divide-line">
        {ticket.items.map((line) => (
          <LineRow
            key={line.id}
            line={line}
            disabled={busy || voided}
            onSet={(status) => onSet(line, status)}
            onRefund={() => onRefund(line)}
          />
        ))}
      </ul>
    </Panel>
  )
}

function LineRow({
  line,
  disabled,
  onSet,
  onRefund,
}: {
  line: ServiceLine
  disabled: boolean
  onSet: (status: ServiceStatus) => void
  onRefund: () => void
}) {
  const refunded = line.status === 'refunded'

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm text-chalk',
            refunded && 'text-muted line-through decoration-red/70'
          )}
        >
          {line.service_name}
          {line.quantity > 1 ? (
            <span className="ml-1 text-faint">×{line.quantity}</span>
          ) : null}
        </p>
        <StatusPill status={line.status} />
      </div>

      <p
        className={cn(
          'text-sm font-semibold tabular-nums',
          refunded ? 'text-muted line-through' : 'text-chalk'
        )}
      >
        {formatPeso(line.line_total_centavos)}
      </p>

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
  const tone =
    status === 'done'
      ? 'text-emerald-400'
      : status === 'refunded'
        ? 'text-red'
        : 'text-amber-400'
  return (
    <span className={cn('board-label mt-0.5 flex items-center gap-1 text-[10px]', tone)}>
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
