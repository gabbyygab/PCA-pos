'use client'

import { Bike, Car, Receipt } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { EmployeeDetailSkeleton } from '@/components/ui/Skeleton'
import { useEmployeeStats, type EmployeeStatsBucket } from '@/lib/queries/employees'
import { formatPeso } from '@shared/lib/currency'
import { weekEnd, weekStart } from '@shared/lib/payroll'

const DATE_FMT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
const STAMP_FMT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}

/**
 * The panel behind a roster row. Read-only on purpose: money is written by the
 * POS and locked by payroll, so this is the place to *see* someone's numbers,
 * never to edit them.
 */
export function EmployeeDetail({ employeeId }: { employeeId: string }) {
  const { data, isLoading, error } = useEmployeeStats(employeeId)

  if (isLoading) return <EmployeeDetailSkeleton />

  if (error) {
    return (
      <p className="px-4 py-5 text-sm text-red">
        Could not load sales — {error instanceof Error ? error.message : 'unknown error'}
      </p>
    )
  }

  if (!data) return null

  if (data.window.salesCount === 0) {
    return (
      <p className="px-4 py-5 text-sm text-faint">
        No sales in the last 90 days. Assign them a car in the POS and their cut shows up here.
      </p>
    )
  }

  const start = weekStart(new Date())
  const end = weekEnd(new Date())
  const busiest = [...data.byWeekday].sort((a, b) => b.salesCount - a.salesCount)[0]
  const peakDay = busiest && busiest.salesCount > 0 ? busiest.label : null
  const maxWeekday = Math.max(1, ...data.byWeekday.map((d) => d.salesCount))

  return (
    <div className="space-y-4 px-4 pb-5 pt-4">
      {/* The windows the owner actually asks about — cut first, gross second. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2.5">
        <Bucket
          label="Today"
          bucket={data.today}
          hint={new Date().toLocaleDateString('en-PH', DATE_FMT)}
        />
        <Bucket
          label="This week"
          bucket={data.week}
          hint={`${start.toLocaleDateString('en-PH', DATE_FMT)} — ${end.toLocaleDateString('en-PH', DATE_FMT)}`}
          accent
        />
        <Bucket label="Last 30 days" bucket={data.month} hint="Rolling" />
        <Bucket label="Last 90 days" bucket={data.window} hint="Rolling" />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2.5">
        <Mini label="Avg cut / car" value={formatPeso(data.averageCutCentavos)} />
        <Mini label="Avg ticket" value={formatPeso(data.averageTicketCentavos)} />
        <Mini label="Busiest day" value={peakDay ?? '—'} />
        <Mini
          label="Last sale"
          value={
            data.lastSoldAt ? new Date(data.lastSoldAt).toLocaleDateString('en-PH', DATE_FMT) : '—'
          }
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Top services" hint="By cars worked, last 90 days">
          <ul className="divide-y divide-line">
            {data.topServices.map((service) => (
              <li key={service.name} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-xs text-chalk">{service.name}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tnum text-[11px] text-faint">{service.count}×</span>
                  <span className="tnum text-xs font-bold text-red">
                    {formatPeso(service.commissionCentavos)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Work mix" hint="Vehicle sizes and days covered">
          <div className="space-y-3 px-3 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              {data.bySize.map((entry) => (
                <span
                  key={entry.size}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-muted"
                >
                  <span className="font-semibold text-chalk">{entry.size}</span>
                  <span className="tnum text-faint">{entry.count}</span>
                </span>
              ))}
            </div>

            <div className="flex items-end gap-1.5">
              {data.byWeekday.map((day) => (
                <div key={day.label} className="flex flex-1 flex-col items-center gap-1">
                  <span className="tnum text-[10px] text-faint">{day.salesCount || ''}</span>
                  <div
                    className="w-full rounded-sm bg-red/70 transition-[height] duration-200"
                    style={{ height: `${Math.max(2, (day.salesCount / maxWeekday) * 40)}px` }}
                    aria-hidden
                  />
                  <span className="board-label text-[9px] text-faint">{day.label}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card title="Recent sales" hint="Their cut on each car, newest first">
        <ul className="divide-y divide-line">
          {data.recentSales.map((sale) => (
            <li key={sale.saleId} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-chalk">
                  {sale.vehicleClass === 'car' ? <Car size={12} /> : <Bike size={12} />}
                  {sale.size}
                  {sale.plateNumber ? (
                    <span className="tnum text-muted">· {sale.plateNumber}</span>
                  ) : null}
                  <span className="tnum inline-flex items-center gap-1 text-faint">
                    <Receipt size={10} />
                    {sale.receiptNo}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted">{sale.services.join(', ')}</p>
                <p className="mt-0.5 text-[10px] text-faint">
                  {new Date(sale.soldAt).toLocaleString('en-PH', STAMP_FMT)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tnum text-xs text-muted">{formatPeso(sale.grossCentavos)}</p>
                <p className="tnum text-sm font-bold text-red">
                  {formatPeso(sale.commissionCentavos)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function Bucket({
  label,
  bucket,
  hint,
  accent,
}: {
  label: string
  bucket: EmployeeStatsBucket
  hint?: string
  accent?: boolean
}) {
  return (
    <Panel className={`px-3 py-2.5 ${accent ? 'border-red/30' : ''}`}>
      <p className="board-label text-[10px] text-faint">{label}</p>
      <p className={`tnum mt-1 text-lg font-extrabold ${accent ? 'text-red' : 'text-chalk'}`}>
        {formatPeso(bucket.commissionCentavos)}
      </p>
      <p className="tnum mt-0.5 text-[11px] text-muted">
        {bucket.salesCount} {bucket.salesCount === 1 ? 'car' : 'cars'} ·{' '}
        {formatPeso(bucket.grossCentavos)} gross
      </p>
      {hint ? <p className="mt-0.5 text-[10px] text-faint">{hint}</p> : null}
    </Panel>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <Panel className="px-3 py-2">
      <p className="board-label text-[10px] text-faint">{label}</p>
      <p className="tnum mt-0.5 text-sm font-bold text-chalk">{value}</p>
    </Panel>
  )
}

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <Panel>
      <div className="border-b border-line px-3 py-2">
        <h3 className="board-label text-[10px] text-muted">{title}</h3>
        {hint ? <p className="mt-0.5 text-[10px] text-faint">{hint}</p> : null}
      </div>
      {children}
    </Panel>
  )
}
