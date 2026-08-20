'use client'

import { useMemo, useState } from 'react'
import { Bike, Car, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCatalog, useVehicleSizes, type CatalogService } from '@/lib/queries/catalog'
import { useEmployees } from '@/lib/queries/employees'
import { useCreateSale } from '@/lib/queries/sales'
import { useToast } from '@/components/ui/Toast'
import { SlashRule } from '@/components/ui/Panel'
import { ServiceGridSkeleton } from '@/components/ui/Skeleton'
import { ServiceGrid } from './ServiceGrid'
import { Cart } from './Cart'
import { OpenPriceDialog } from './OpenPriceDialog'
import { CustomServiceDialog, type CustomServiceDraft } from './CustomServiceDialog'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEFAULT_COMMISSION_BP,
  sizesForClass,
  type PaymentMethod,
  type ServiceCategory,
  type VehicleClass,
  type VehicleSizeRow,
} from '@shared/lib/domain'
import {
  isAvailableAtSize,
  isCustomLine,
  newCustomLineId,
  resolvePrice,
  type CartLine,
} from '@shared/lib/pricing'

export function PosTab() {
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('car')
  // The selected size row's id. Null until the scale loads, or when the class
  // has no sizes yet -- a shop that has not set up its board can still open
  // the tab rather than crashing on a missing default.
  const [sizeId, setSizeId] = useState<string | null>(null)
  const [lines, setLines] = useState<CartLine[]>([])
  const [employeeIds, setEmployeeIds] = useState<string[]>([])
  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [plate, setPlate] = useState('')
  const [openPriceFor, setOpenPriceFor] = useState<CatalogService | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ServiceCategory | 'all'>('all')
  const [offeredOnly, setOfferedOnly] = useState(false)

  const { data: catalog, isLoading } = useCatalog()
  const { data: allSizes } = useVehicleSizes()
  const { data: employees } = useEmployees()
  const createSale = useCreateSale()
  const { toast } = useToast()

  // Hidden sizes are off the POS entirely; Settings is where they come back.
  const sizes = useMemo(
    () => sizesForClass(allSizes ?? [], vehicleClass).filter((s) => s.is_active),
    [allSizes, vehicleClass]
  )

  const size = useMemo(
    () => sizes.find((s) => s.id === sizeId) ?? sizes[0] ?? null,
    [sizes, sizeId]
  )

  const services = useMemo(
    () =>
      (catalog ?? []).filter((s) => s.is_active && s.vehicle_class === vehicleClass),
    [catalog, vehicleClass]
  )

  /**
   * What the grid actually shows. Kept separate from `services` because the
   * cart re-prices against the full catalog — a line must not be dropped just
   * because the cashier has typed a filter that hides its tile.
   */
  const visibleServices = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return services.filter((service) => {
      if (category !== 'all' && service.category !== category) return false
      if (offeredOnly && (!size || !isAvailableAtSize(service, size.id))) return false
      if (!needle) return true
      // Inclusions are searchable too: "engine wash" should surface the
      // packages that bundle it, not just a service literally named that.
      return (
        service.name.toLowerCase().includes(needle) ||
        service.inclusions.some((inc) => inc.toLowerCase().includes(needle))
      )
    })
  }, [services, query, category, offeredOnly, size])

  const filtered = query.trim() !== '' || category !== 'all' || offeredOnly

  function clearFilters() {
    setQuery('')
    setCategory('all')
    setOfferedOnly(false)
  }

  function switchClass(next: VehicleClass) {
    if (next === vehicleClass) return
    setVehicleClass(next)
    // The two classes have different size scales, so the cart cannot carry
    // over; the new class falls back to the first size on its own scale.
    setSizeId(null)
    setLines([])
  }

  function switchSize(next: VehicleSizeRow) {
    if (next.id === size?.id) return
    setSizeId(next.id)
    // Prices are per size; re-price what is still offered and drop the rest.
    setLines((prev) =>
      prev.flatMap((line) => {
        // A custom line has no catalogue price to re-resolve; it keeps the
        // amount the cashier agreed regardless of the size selected.
        if (isCustomLine(line)) return [line]
        const service = services.find((s) => s.id === line.serviceId)
        if (!service) return []
        if (service.is_open_price) return [line]
        const price = resolvePrice(service, next.id)
        if (price === null) return []
        return [{ ...line, unitPriceCentavos: price }]
      })
    )
  }

  function addService(service: CatalogService) {
    if (service.is_open_price) {
      setOpenPriceFor(service)
      return
    }
    if (!size) return
    const price = resolvePrice(service, size.id)
    if (price === null) return

    setLines((prev) => {
      const existing = prev.find((l) => l.serviceId === service.id)
      if (existing) {
        return prev.map((l) =>
          l.serviceId === service.id ? { ...l, quantity: l.quantity + 1 } : l
        )
      }
      return [
        ...prev,
        {
          serviceId: service.id,
          serviceName: service.name,
          category: service.category,
          quantity: 1,
          unitPriceCentavos: price,
          commissionRateBp: service.commission_rate_bp,
        },
      ]
    })
  }

  function confirmOpenPrice(centavos: number) {
    const service = openPriceFor
    if (!service) return
    setLines((prev) => [
      ...prev,
      {
        serviceId: service.id,
        serviceName: service.name,
        category: service.category,
        quantity: 1,
        unitPriceCentavos: centavos,
        commissionRateBp: service.commission_rate_bp,
      },
    ])
    setOpenPriceFor(null)
  }

  function confirmCustom(draft: CustomServiceDraft) {
    setLines((prev) => [
      ...prev,
      {
        // A fresh key every time: two custom lines on one ticket are two
        // different jobs and must not merge the way a repeated tile does.
        serviceId: newCustomLineId(),
        serviceName: draft.name,
        description: draft.description || undefined,
        category: draft.category,
        quantity: 1,
        unitPriceCentavos: draft.centavos,
        commissionRateBp: DEFAULT_COMMISSION_BP[draft.category],
      },
    ])
    setCustomOpen(false)
  }

  function reset() {
    setLines([])
    setPlate('')
    setPayment('cash')
    // The crew is deliberately kept: the same two or three people work several
    // cars in a row, so re-picking them after every sale would be busywork.
  }

  async function submit() {
    if (employeeIds.length === 0 || lines.length === 0 || !size) return
    try {
      await createSale.mutateAsync({
        employeeIds,
        vehicleClass,
        // The label, not the id: a sale snapshots what it printed.
        size: size.label,
        lines,
        paymentMethod: payment,
        plateNumber: plate,
      })
      const names = employeeIds
        .map((id) => employees?.find((e) => e.id === id)?.name)
        .filter((n): n is string => Boolean(n))
      toast({
        message: 'Sale saved',
        detail: names.length ? `Assigned to ${names.join(', ')}` : undefined,
        tone: 'success',
      })
      reset()
    } catch (error) {
      toast({
        message: 'Could not save the sale',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-line px-6 pb-4 pt-5">
          <SlashRule className="mb-3" />
          <h1 className="board-head text-2xl text-chalk">Ring Up</h1>

          <div className="mt-4 flex flex-wrap items-center gap-6">
            <div className="flex gap-2">
              {(
                [
                  { id: 'car', label: 'Car', icon: Car },
                  { id: 'motorcycle', label: 'Motorcycle', icon: Bike },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => switchClass(id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold',
                    'transition-[transform,background-color,border-color,color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
                    'active:scale-[0.97]',
                    vehicleClass === id
                      ? 'border-red bg-red text-white'
                      : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
                  )}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {sizes.length === 0 ? (
                <p className="text-xs text-faint">
                  No {vehicleClass === 'car' ? 'car' : 'motorcycle'} sizes yet — add
                  them under Settings &rsaquo; Sizes.
                </p>
              ) : null}
              {sizes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => switchSize(s)}
                  title={s.description ?? s.label}
                  className={cn(
                    'min-w-[4.25rem] rounded-lg border px-3 py-2 text-center',
                    'transition-[transform,background-color,border-color,color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
                    'active:scale-[0.97]',
                    size?.id === s.id
                      ? 'border-red bg-red/12 text-chalk'
                      : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
                  )}
                >
                  <span className="board-label block text-xs">{s.label}</span>
                  {s.description ? (
                    <span className="mt-0.5 block truncate text-[10px] text-faint">
                      {s.description}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                placeholder="Search services or inclusions…"
                aria-label="Search services"
                className={cn(
                  'h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-8 text-sm text-chalk',
                  'placeholder:text-faint focus:border-red focus:outline-none',
                  'transition-colors duration-150'
                )}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-chalk"
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(['all', ...CATEGORY_ORDER] as const).map((id) => (
                <button
                  key={id}
                  onClick={() => setCategory(id)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-semibold',
                    'transition-[transform,background-color,border-color,color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
                    'active:scale-[0.97]',
                    category === id
                      ? 'border-red bg-red/12 text-chalk'
                      : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
                  )}
                >
                  {id === 'all' ? 'All' : CATEGORY_LABELS[id]}
                </button>
              ))}

              <button
                onClick={() => setOfferedOnly((v) => !v)}
                title="Hide services with no price at the selected size"
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-semibold',
                  'transition-[transform,background-color,border-color,color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
                  'active:scale-[0.97]',
                  offeredOnly
                    ? 'border-red bg-red/12 text-chalk'
                    : 'border-line bg-surface text-muted hover:border-line-strong hover:text-chalk'
                )}
              >
                Offered at {size?.label ?? 'size'}
              </button>

              {filtered ? (
                <button
                  onClick={clearFilters}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-faint hover:text-chalk"
                >
                  Clear
                </button>
              ) : null}

              {/*
                Work that is not on the board and is not worth adding to it.
                It sits with the filters rather than in the grid because it is
                not a service the shop offers — it is an escape hatch.
              */}
              <button
                onClick={() => setCustomOpen(true)}
                title="Ring up a one-off service that is not on the price board"
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-xs font-semibold text-muted',
                  'transition-[transform,background-color,border-color,color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
                  'hover:border-red hover:text-chalk active:scale-[0.97]'
                )}
              >
                <Plus size={13} />
                Custom
              </button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            // Tiles where the tiles are about to be, so the board does not
            // reflow under the cursor when the catalog lands.
            <ServiceGridSkeleton />
          ) : visibleServices.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted">Nothing matches that.</p>
              {filtered ? (
                <button
                  onClick={clearFilters}
                  className="mt-2 text-xs font-semibold text-red hover:underline"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            <ServiceGrid
              services={visibleServices}
              sizeId={size?.id ?? null}
              onSelect={addService}
              isAvailable={(s) => (size ? isAvailableAtSize(s, size.id) : false)}
              selectedIds={new Set(lines.map((l) => l.serviceId))}
            />
          )}
        </div>
      </div>

      <Cart
        lines={lines}
        sizeLabel={size?.label ?? null}
        employees={employees ?? []}
        employeeIds={employeeIds}
        onEmployeeChange={setEmployeeIds}
        payment={payment}
        onPaymentChange={setPayment}
        plate={plate}
        onPlateChange={setPlate}
        onQuantityChange={(serviceId, quantity) =>
          setLines((prev) =>
            quantity <= 0
              ? prev.filter((l) => l.serviceId !== serviceId)
              : prev.map((l) => (l.serviceId === serviceId ? { ...l, quantity } : l))
          )
        }
        onRemove={(serviceId) =>
          setLines((prev) => prev.filter((l) => l.serviceId !== serviceId))
        }
        onClear={reset}
        onSubmit={submit}
        isSaving={createSale.isPending}
      />

      {customOpen ? (
        <CustomServiceDialog
          onCancel={() => setCustomOpen(false)}
          onConfirm={confirmCustom}
        />
      ) : null}

      {openPriceFor ? (
        <OpenPriceDialog
          serviceName={openPriceFor.name}
          onCancel={() => setOpenPriceFor(null)}
          onConfirm={confirmOpenPrice}
        />
      ) : null}
    </div>
  )
}
