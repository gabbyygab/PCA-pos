'use client'

import { useMemo, useState } from 'react'
import {
  Bike,
  CalendarRange,
  Car,
  Clock,
  FileDown,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { downloadSalesReport } from '@/lib/pdf/salesReport'
import { Panel, PanelHeader, SlashRule } from '@/components/ui/Panel'
import { ReportsSkeleton } from '@/components/ui/Skeleton'
import {
  dayKeyOf,
  resolveRange,
  useReports,
  useTodayReport,
  type ReportData,
  type ReportDateRange,
  type ReportRange,
} from '@/lib/queries/reports'
import { centavosToPesos, formatPeso } from '@shared/lib/currency'

const RANGES: { id: ReportRange; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'custom', label: 'Custom' },
]

const AXIS = { stroke: '#6b6b70', fontSize: 11 }
const GRID = '#26262b'

export function ReportsTab() {
  const [range, setRange] = useState<ReportRange>('30d')
  // Seeded from the last preset so switching to Custom starts somewhere sane
  // rather than on an empty pair of fields.
  const [custom, setCustom] = useState<ReportDateRange>(() => {
    const { start } = resolveRange('30d')
    return { from: dayKeyOf(start), to: dayKeyOf(new Date()) }
  })

  // An inverted range returns nothing and looks like "no sales" rather than a
  // mistake, so it is caught here instead.
  const rangeError =
    range === 'custom' && custom.from && custom.to && custom.from > custom.to
      ? 'The start date is after the end date.'
      : undefined

  const { data, isLoading, isError, error } = useReports(range, rangeError ? undefined : custom)
  // Always today, whatever the range above is set to.
  const { data: todayData } = useTodayReport()
  const { toast } = useToast()

  const today = useMemo(() => dayKeyOf(new Date()), [])

  function onExport() {
    if (!data) return
    try {
      downloadSalesReport(data, range)
      toast({ message: 'Report exported', detail: 'Saved as PDF.', tone: 'success' })
    } catch (error) {
      toast({
        message: 'Could not export',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <SlashRule className="mb-3" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="board-head text-2xl text-chalk">Reports</h1>
          <div className="flex items-center gap-1.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-semibold',
                  'transition-[transform,background-color,border-color,color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
                  'active:scale-[0.97]',
                  range === r.id
                    ? 'border-red bg-red text-white'
                    : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
                )}
              >
                {r.label}
              </button>
            ))}
            <Button
              size="sm"
              variant="primary"
              className="ml-2"
              onClick={onExport}
              disabled={!data || isLoading}
            >
              <FileDown size={14} />
              Export PDF
            </Button>
          </div>
        </div>

        {range === 'custom' ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <DateField
              id="report-from"
              label="From"
              value={custom.from}
              max={custom.to || today}
              onChange={(from) => setCustom((c) => ({ ...c, from }))}
            />
            <DateField
              id="report-to"
              label="To"
              value={custom.to}
              min={custom.from || undefined}
              max={today}
              onChange={(to) => setCustom((c) => ({ ...c, to }))}
            />
            <div className="flex gap-1.5 pb-0.5">
              {QUICK_SPANS.map((span) => (
                <button
                  key={span.label}
                  onClick={() => setCustom(span.build())}
                  className={cn(
                    'rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-muted',
                    'transition-colors duration-150 hover:border-line-strong hover:text-chalk'
                  )}
                >
                  {span.label}
                </button>
              ))}
            </div>
            {rangeError ? (
              <p className="pb-2 text-xs font-semibold text-red">{rangeError}</p>
            ) : (
              <p className="pb-2 text-xs text-faint">
                <CalendarRange size={11} className="mr-1 inline align-[-1px]" />
                {spanDays(custom)} day{spanDays(custom) === 1 ? '' : 's'} selected
              </p>
            )}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <TodayBand data={todayData} />

        {rangeError ? (
          <p className="text-sm text-muted">Pick a valid date range to see the report.</p>
        ) : isError ? (
          // Without this the page held the skeleton forever on a failed query
          // and read as "slow" rather than "broken".
          <Panel className="p-6">
            <p className="text-sm font-semibold text-red">Could not load the report.</p>
            <p className="mt-1 text-xs text-muted">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </Panel>
        ) : isLoading || !data ? (
          // Charts are the slowest thing the owner waits on, and the range
          // buttons above stay live — so the tiles and panels hold their
          // places instead of the page collapsing to one line of text.
          <ReportsSkeleton />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Names the span the cards below cover. Without it the two groups
                of figures are unlabelled and the range ones read as if they
                were also today's. */}
            <div className="flex items-center gap-2">
              <h2 className="board-label text-[11px] text-muted">
                {resolveRange(range, custom).label}
              </h2>
              <span className="h-px flex-1 bg-line" aria-hidden />
            </div>

            {/* Money first — what the shop earned and kept. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
              <Stat
                label="Gross sales"
                value={formatPeso(data.grossCentavos)}
                sub="Refunds already removed"
              />
              <Stat label="Expenses" value={`- ${formatPeso(data.expenseCentavos)}`} />
              {/* Net carries the accent, not gross: it is the number the owner
                  is actually reading the page for. */}
              <Stat label="Net sales" value={formatPeso(data.netCentavos)} accent />
              <Stat label="Average ticket" value={formatPeso(data.averageTicketCentavos)} />
              <Stat label="Employee cut" value={formatPeso(data.commissionCentavos)} />
            </div>

            {/* Then the shop floor — what was actually driven in and worked on.
                Split from the money row because the owner reads these to answer
                a different question: how busy were we, and is anything stuck. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
              <Stat
                label="Vehicles served"
                value={String(data.salesCount)}
                sub={`${data.days} day${data.days === 1 ? '' : 's'}`}
              />
              <Stat
                label="Cars served"
                value={String(data.carCount)}
                icon={Car}
                sub={perDay(data.carCount, data.days)}
              />
              <Stat
                label="Motorcycles served"
                value={String(data.motorcycleCount)}
                icon={Bike}
                sub={perDay(data.motorcycleCount, data.days)}
              />
              <Stat
                label="In progress"
                value={String(data.pendingCount)}
                icon={Clock}
                tone={data.pendingCount > 0 ? 'warn' : undefined}
                sub={data.pendingCount > 0 ? 'Services not closed out' : 'All work closed out'}
              />
              <Stat
                label="Refunded"
                value={formatPeso(data.refundedCentavos)}
                icon={Undo2}
                tone={data.refundedCount > 0 ? 'danger' : undefined}
                sub={`${data.refundedCount} service${data.refundedCount === 1 ? '' : 's'}`}
              />
            </div>

            <Panel>
              <PanelHeader
                title="Sales per day"
                hint="Net is gross for the day minus the expenses recorded against it."
              />
              <div className="h-64 px-2 py-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data.daily.map((d) => ({
                      ...d,
                      gross: centavosToPesos(d.grossCentavos),
                      net: centavosToPesos(d.netCentavos),
                    }))}
                  >
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} width={56} {...AXIS} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: '#a1a1a6', fontSize: 11 }}
                      formatter={pesoTooltip}
                    />
                    <Legend {...LEGEND} />
                    {/* Gross recedes to a dimmer line: on a day with expenses
                        the gap between the two is the story, and net is the
                        line being read. */}
                    <Line
                      type="monotone"
                      name="Gross"
                      dataKey="gross"
                      stroke="#6b6b70"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      activeDot={{ r: 3, fill: '#6b6b70' }}
                    />
                    <Line
                      type="monotone"
                      name="Net"
                      dataKey="net"
                      stroke="#e11414"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: '#e11414' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Panel>
                <PanelHeader title="Best performing services" />
                <div className="h-72 px-2 py-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={data.topServices.map((s) => ({
                        ...s,
                        gross: centavosToPesos(s.grossCentavos),
                      }))}
                      margin={{ left: 8, right: 12 }}
                    >
                      <CartesianGrid stroke={GRID} horizontal={false} />
                      <XAxis type="number" tickLine={false} axisLine={false} {...AXIS} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        width={130}
                        {...AXIS}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        contentStyle={TOOLTIP_STYLE}
                        formatter={pesoTooltip}
                      />
                      <Bar dataKey="gross" fill="#e11414" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="Sales by vehicle size" />
                <div className="h-72 px-2 py-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.bySize.map((s) => ({
                        label: s.size,
                        gross: centavosToPesos(s.grossCentavos),
                      }))}
                    >
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} />
                      <YAxis tickLine={false} axisLine={false} width={56} {...AXIS} />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        contentStyle={TOOLTIP_STYLE}
                        formatter={pesoTooltip}
                      />
                      <Bar dataKey="gross" radius={[4, 4, 0, 0]}>
                        {data.bySize.map((_, i) => (
                          // One hue, stepped by rank — the sizes are ordered, not categorical.
                          <Cell key={i} fill={i === 0 ? '#e11414' : `rgba(225,20,20,${0.8 - i * 0.13})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>

            <Panel>
              <PanelHeader title="Employee productivity" />
              {data.byEmployee.length === 0 ? (
                <p className="px-4 py-6 text-sm text-faint">No sales in this range.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <Th>Employee</Th>
                      <Th className="text-right">Cars</Th>
                      <Th className="text-right">Gross</Th>
                      <Th className="text-right">Cut</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.byEmployee.map((e) => (
                      <tr key={e.name} className="transition-colors duration-150 hover:bg-surface-2">
                        <td className="px-4 py-3 font-semibold text-chalk">{e.name}</td>
                        <td className="tnum px-4 py-3 text-right text-muted">{e.salesCount}</td>
                        <td className="tnum px-4 py-3 text-right text-muted">
                          {formatPeso(e.grossCentavos)}
                        </td>
                        <td className="tnum px-4 py-3 text-right font-bold text-red">
                          {formatPeso(e.commissionCentavos)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel>
              <PanelHeader
                title="Expenses"
                hint="Grouped by name as typed. Subtracted from gross to give net sales."
              />
              {data.byExpense.length === 0 ? (
                <p className="px-4 py-6 text-sm text-faint">
                  Nothing recorded in this range — net sales equals gross. Log soap, water, or
                  repairs in the Expenses tab.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <Th>Expense</Th>
                      <Th className="text-right">Entries</Th>
                      <Th className="text-right">Share of gross</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.byExpense.map((e) => (
                      <tr key={e.name} className="transition-colors duration-150 hover:bg-surface-2">
                        <td className="px-4 py-3 font-semibold text-chalk">{e.name}</td>
                        <td className="tnum px-4 py-3 text-right text-muted">{e.count}</td>
                        <td className="tnum px-4 py-3 text-right text-muted">
                          {data.grossCentavos
                            ? `${((e.amountCentavos / data.grossCentavos) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="tnum px-4 py-3 text-right font-bold text-red">
                          {formatPeso(e.amountCentavos)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line-strong">
                      <td className="board-label px-4 py-3 text-[10px] text-faint">Total</td>
                      <td />
                      <td />
                      <td className="tnum px-4 py-3 text-right font-bold text-chalk">
                        {formatPeso(data.expenseCentavos)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </Panel>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Quick spans for the custom picker — the periods the owner actually asks for
 * (a calendar month, the month so far) which no fixed "last N days" preset
 * expresses.
 */
const QUICK_SPANS: { label: string; build: () => ReportDateRange }[] = [
  {
    label: 'This month',
    build: () => {
      const now = new Date()
      return {
        from: dayKeyOf(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: dayKeyOf(now),
      }
    },
  },
  {
    label: 'Last month',
    build: () => {
      const now = new Date()
      return {
        from: dayKeyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        // Day 0 of this month is the last day of the previous one.
        to: dayKeyOf(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    },
  },
  {
    label: 'This year',
    build: () => {
      const now = new Date()
      return { from: dayKeyOf(new Date(now.getFullYear(), 0, 1)), to: dayKeyOf(now) }
    },
  },
]

/** Inclusive day count, so a single-day range reads as 1 rather than 0. */
function spanDays(range: ReportDateRange): number {
  if (!range.from || !range.to) return 0
  const from = new Date(`${range.from}T00:00:00`)
  const to = new Date(`${range.to}T00:00:00`)
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1)
}

/**
 * A native date input, deliberately.
 *
 * `ui/README.md` bans native `<select>` because the OS draws its popup and
 * ignores the app's tokens. A date input is not the same case: the field itself
 * is ours to style, and the calendar popup it opens is the one piece of OS
 * chrome worth keeping — it handles month lengths, locales, and keyboard entry
 * far better than a hand-rolled calendar would.
 */
function DateField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string
  label: string
  value: string
  min?: string
  max?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="board-label block text-[10px] text-faint">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'tnum mt-1.5 h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-chalk',
          'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
          'hover:border-line-strong focus:border-red focus:outline-none',
          // The picker glyph is drawn black-on-black by the webview otherwise.
          '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:invert'
        )}
      />
    </div>
  )
}

/**
 * Recharts hands the formatter a loose ValueType, so coerce before formatting.
 * The series name comes back as the second argument — the daily chart plots
 * both gross and net, so labelling every row "Gross" would misread one line.
 */
function pesoTooltip(value: unknown, name?: unknown): [string, string] {
  const pesos = typeof value === 'number' ? value : Number(value ?? 0)
  const label = typeof name === 'string' && name ? name : 'Gross'
  return [`₱${pesos.toLocaleString('en-PH')}`, label]
}

const LEGEND = {
  iconType: 'plainline' as const,
  iconSize: 14,
  wrapperStyle: { fontSize: 11, color: '#a1a1a6', paddingTop: 8 },
}

const TOOLTIP_STYLE = {
  background: '#1a1a1d',
  border: '1px solid #34343b',
  borderRadius: 8,
  fontSize: 12,
  color: '#f5f5f4',
}

/**
 * Today's numbers, pinned above the range-filtered report.
 *
 * Deliberately a different shape from the `Stat` tiles below — one bordered
 * strip rather than a row of cards. The two sets of figures answer different
 * questions and would otherwise be indistinguishable at a glance, which is the
 * one thing this band must never be: an owner reading "₱4,200" off the wrong
 * row is worse than not showing it at all. The red hairline and the TODAY label
 * are what separate them.
 */
function TodayBand({ data }: { data: ReportData | undefined }) {
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
        <span className="h-3 w-[3px] rounded-r bg-red" aria-hidden />
        <h2 className="board-label text-[11px] text-chalk">Today</h2>
        <span className="text-[11px] text-faint">
          {new Date().toLocaleDateString('en-PH', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
        </span>
        <span className="ml-auto text-[10px] text-faint">Not affected by the range</span>
      </div>

      {data ? (
        <dl className="grid grid-cols-2 divide-line sm:grid-cols-3 sm:divide-x lg:grid-cols-6">
          <TodayFigure label="Gross" value={formatPeso(data.grossCentavos)} />
          <TodayFigure label="Net" value={formatPeso(data.netCentavos)} accent />
          <TodayFigure label="Vehicles" value={String(data.salesCount)} />
          <TodayFigure label="Cars" value={String(data.carCount)} />
          <TodayFigure label="Motorcycles" value={String(data.motorcycleCount)} />
          <TodayFigure
            label="In progress"
            value={String(data.pendingCount)}
            tone={data.pendingCount > 0 ? 'warn' : undefined}
          />
        </dl>
      ) : (
        // Only the values are withheld while loading; the strip keeps its
        // height so the report below does not jump when today lands.
        <dl className="grid grid-cols-2 divide-line sm:grid-cols-3 sm:divide-x lg:grid-cols-6">
          {['Gross', 'Net', 'Vehicles', 'Cars', 'Motorcycles', 'In progress'].map((label) => (
            <TodayFigure key={label} label={label} value="—" />
          ))}
        </dl>
      )}
    </div>
  )
}

function TodayFigure({
  label,
  value,
  accent,
  tone,
}: {
  label: string
  value: string
  accent?: boolean
  tone?: 'warn'
}) {
  return (
    <div className="border-b border-line px-4 py-2.5 last:border-b-0 sm:border-b-0">
      <dt className="board-label text-[10px] text-faint">{label}</dt>
      <dd
        className={cn(
          'tnum mt-0.5 text-lg font-extrabold',
          accent ? 'text-red' : tone === 'warn' ? 'text-amber-400' : 'text-chalk'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * The "/day" line under a count. Suppressed on a single day, where the count
 * already is the day's number and the rate would just repeat it.
 */
function perDay(count: number, days: number): string | undefined {
  if (days <= 1) return undefined
  return `${(count / days).toFixed(1)} per day`
}

function Stat({
  label,
  value,
  accent,
  icon: Icon,
  sub,
  tone,
}: {
  label: string
  value: string
  accent?: boolean
  icon?: LucideIcon
  /** The second line — the count behind a peso figure, or a caveat. */
  sub?: string
  tone?: 'warn' | 'danger'
}) {
  return (
    <Panel className="px-4 py-3">
      <div className="flex items-center gap-1.5">
        {Icon ? <Icon size={11} className="shrink-0 text-faint" /> : null}
        <p className="board-label truncate text-[10px] text-faint">{label}</p>
      </div>
      <p
        className={cn(
          'tnum mt-1 text-xl font-extrabold',
          accent
            ? 'text-red'
            : tone === 'warn'
              ? 'text-amber-400'
              : tone === 'danger'
                ? 'text-red'
                : 'text-chalk'
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 truncate text-[11px] text-faint">{sub}</p> : null}
    </Panel>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`board-label px-4 py-2.5 text-[10px] text-faint ${className}`}>{children}</th>
  )
}
