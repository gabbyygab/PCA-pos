'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, ListChecks, Plus, Ruler, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Panel, PanelHeader, SlashRule } from '@/components/ui/Panel'
import { CatalogSkeleton, ListSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import {
  useCatalog,
  useCreateInclusionOption,
  useCreateService,
  useDeleteInclusionOption,
  useDeleteService,
  useInclusionOptions,
  useRenameInclusionOption,
  useServiceUsage,
  useSetInclusions,
  useUpdatePrice,
  useUpdateService,
  useCreateVehicleSize,
  useDeleteVehicleSize,
  useSizeUsage,
  useUpdateVehicleSize,
  useVehicleSizes,
  type CatalogService,
} from '@/lib/queries/catalog'
import { centavosToPesos, pesosToCentavos } from '@shared/lib/currency'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEFAULT_COMMISSION_BP,
  VEHICLE_CLASSES,
  VEHICLE_CLASS_LABELS,
  VEHICLE_CLASS_PLURALS,
  sizesForClass,
  type ServiceCategory,
  type VehicleClass,
  type VehicleSizeRow,
} from '@shared/lib/domain'

export function SettingsTab() {
  const { data: catalog, isLoading } = useCatalog()
  const { data: allSizes } = useVehicleSizes()
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('car')
  const [creating, setCreating] = useState<ServiceCategory | null>(null)
  const [managingInclusions, setManagingInclusions] = useState(false)
  const [managingSizes, setManagingSizes] = useState(false)
  const [query, setQuery] = useState('')

  // The scale for the open tab, in board order. Every price row and size chip
  // below reads this rather than a hardcoded list.
  const classSizes = useMemo(
    () => sizesForClass(allSizes ?? [], vehicleClass),
    [allSizes, vehicleClass]
  )

  const services = useMemo(
    () => (catalog ?? []).filter((s) => s.vehicle_class === vehicleClass),
    [catalog, vehicleClass]
  )

  const needle = query.trim().toLowerCase()

  // Inclusions are searchable too, same as the POS: typing "engine wash"
  // should surface the packages that bundle it, not just a service named that.
  const visibleServices = useMemo(() => {
    if (!needle) return services
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.inclusions.some((inc) => inc.toLowerCase().includes(needle))
    )
  }, [services, needle])

  // Counts follow the search so the other class's tab still says how many
  // matches are waiting over there.
  const counts = useMemo(() => {
    const byClass: Record<VehicleClass, number> = { car: 0, motorcycle: 0 }
    for (const s of catalog ?? []) {
      if (
        needle &&
        !s.name.toLowerCase().includes(needle) &&
        !s.inclusions.some((inc) => inc.toLowerCase().includes(needle))
      ) {
        continue
      }
      byClass[s.vehicle_class] += 1
    }
    return byClass
  }, [catalog, needle])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line px-6 pb-0 pt-5">
        <SlashRule className="mb-3" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="board-head text-2xl text-chalk">Services &amp; Prices</h1>
            <p className="mt-1 text-xs text-muted">
              Edits apply from now on. Past sales and finalized slips keep what they charged.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={() => setManagingSizes(true)}>
              <Ruler size={15} />
              Sizes
            </Button>
            <Button size="sm" onClick={() => setManagingInclusions(true)}>
              <ListChecks size={15} />
              Inclusions
            </Button>
          </div>
        </div>

        <div className="relative mt-4">
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

        {/* Cars and motorcycles price on separate scales, so they get separate
            tabs rather than one list the owner has to scan past. */}
        <div className="mt-4 flex gap-1" role="tablist" aria-label="Vehicle class">
          {VEHICLE_CLASSES.map((vc) => {
            const active = vc === vehicleClass
            return (
              <button
                key={vc}
                role="tab"
                aria-selected={active}
                onClick={() => setVehicleClass(vc)}
                className={cn(
                  'relative rounded-t-lg px-4 py-2.5',
                  'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
                  active ? 'bg-surface text-chalk' : 'text-muted hover:bg-surface-2 hover:text-chalk'
                )}
              >
                <span className="board-label text-[11px]">{VEHICLE_CLASS_PLURALS[vc]}</span>
                <span className="ml-2 text-[10px] tabular-nums text-faint">{counts[vc]}</span>
                <span
                  className={cn(
                    'absolute inset-x-0 bottom-0 h-[2px] rounded-t bg-red transition-opacity duration-150',
                    active ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </button>
            )
          })}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <CatalogSkeleton />
        ) : needle && visibleServices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line py-10 text-center">
            <p className="text-sm text-muted">Nothing matches that.</p>
            <button
              onClick={() => setQuery('')}
              className="mt-2 text-xs text-red hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-7">
            {CATEGORY_ORDER.map((category) => {
              const inCategory = visibleServices.filter((s) => s.category === category)
              // While searching, a category with no hits is noise — drop it
              // rather than showing its "add one" prompt against a filter.
              if (needle && inCategory.length === 0) return null
              return (
                <CategorySection
                  key={category}
                  category={category}
                  vehicleClass={vehicleClass}
                  sizes={classSizes}
                  services={inCategory}
                  onAdd={() => setCreating(category)}
                  onManageSizes={() => setManagingSizes(true)}
                />
              )
            })}
          </div>
        )}
      </div>

      {creating ? (
        <NewServiceDialog
          category={creating}
          vehicleClass={vehicleClass}
          catalog={catalog ?? []}
          onClose={() => setCreating(null)}
        />
      ) : null}

      {managingInclusions ? (
        <InclusionCatalogDialog onClose={() => setManagingInclusions(false)} />
      ) : null}

      {managingSizes ? (
        <SizeCatalogDialog
          vehicleClass={vehicleClass}
          onClose={() => setManagingSizes(false)}
        />
      ) : null}
    </div>
  )
}

function CategorySection({
  category,
  vehicleClass,
  sizes,
  services,
  onAdd,
  onManageSizes,
}: {
  category: ServiceCategory
  vehicleClass: VehicleClass
  sizes: VehicleSizeRow[]
  services: CatalogService[]
  onAdd: () => void
  onManageSizes: () => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2.5">
          <h2 className="board-head text-lg text-chalk">{CATEGORY_LABELS[category]}</h2>
          <span className="text-[11px] text-faint">
            {DEFAULT_COMMISSION_BP[category] / 100}% default commission
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <Plus size={14} />
          Add
        </Button>
      </div>

      {services.length === 0 ? (
        <button
          onClick={onAdd}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-6',
            'text-xs text-faint transition-colors duration-150 hover:border-line-strong hover:text-muted'
          )}
        >
          <Plus size={14} />
          No {CATEGORY_LABELS[category].toLowerCase()} for{' '}
          {VEHICLE_CLASS_PLURALS[vehicleClass].toLowerCase()} yet — add one
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          {services.map((service) => (
            <ServiceEditor
              key={service.id}
              service={service}
              sizes={sizes}
              onManageSizes={onManageSizes}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ServiceEditor({
  service,
  sizes,
  onManageSizes,
}: {
  service: CatalogService
  sizes: VehicleSizeRow[]
  onManageSizes: () => void
}) {
  const updatePrice = useUpdatePrice()
  const updateService = useUpdateService()
  const deleteService = useDeleteService()
  const { data: usage } = useServiceUsage()
  const { toast } = useToast()

  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [editingInclusions, setEditingInclusions] = useState(false)

  // Hidden sizes stay visible on a service that still prices them, so retiring
  // a size never makes an existing price silently unreachable.
  const allSizes = sizes.filter(
    (s) => s.is_active || service.prices[s.id] !== undefined
  )
  // A size with no price row is not offered. Keeping that distinction visible
  // is the whole point — a blank input and "not offered" mean the same thing
  // in the database, but only one of them reads as deliberate.
  const pricedSizes = allSizes.filter((s) => service.prices[s.id] !== undefined)
  const missingSizes = allSizes.filter((s) => service.prices[s.id] === undefined)
  const soldCount = usage?.[service.id] ?? 0

  function savePrice(sizeId: string, raw: string) {
    const trimmed = raw.trim()
    const current = service.prices[sizeId]

    if (trimmed === '') {
      // Blanking is not how a size is removed — that is the × button, which
      // asks first. Restore the field so a stray Tab cannot drop a price.
      return current
    }

    const pesos = Number.parseFloat(trimmed)
    if (!Number.isFinite(pesos) || pesos < 0) {
      toast({ message: 'That price is not a number', tone: 'error' })
      return current
    }
    const centavos = pesosToCentavos(pesos)
    if (centavos === current) return centavos
    updatePrice.mutate({ serviceId: service.id, sizeId, priceCentavos: centavos })
    return centavos
  }

  function saveRate(raw: string) {
    const percent = Number.parseFloat(raw)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast({ message: 'Commission must be between 0 and 100', tone: 'error' })
      return
    }
    const bp = Math.round(percent * 100)
    if (bp === service.commission_rate_bp) return
    updateService.mutate({ id: service.id, commission_rate_bp: bp })
  }

  function addSize(sizeId: string) {
    // A new size opens at the nearest existing price rather than zero — the
    // owner is almost always stepping up from the size below.
    const seed = pricedSizes.length
      ? service.prices[pricedSizes[pricedSizes.length - 1].id]!
      : 0
    updatePrice.mutate({ serviceId: service.id, sizeId, priceCentavos: seed })
  }

  function removeSize(sizeId: string) {
    updatePrice.mutate({ serviceId: service.id, sizeId, priceCentavos: null })
  }

  async function confirmDelete() {
    try {
      await deleteService.mutateAsync(service.id)
      toast({ message: `${service.name} deleted`, tone: 'success' })
      setConfirmingDelete(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast({
        message: 'Could not delete the service',
        detail: message.includes('SERVICE_IN_USE')
          ? 'It is on past sales. Hide it instead.'
          : message,
        tone: 'error',
      })
    }
  }

  return (
    <>
      <Panel className={cn(!service.is_active && 'opacity-55')}>
        <PanelHeader
          title={service.name}
          hint={[
            service.is_open_price ? 'Open price' : `${pricedSizes.length} of ${allSizes.length} sizes`,
            soldCount > 0 ? `${soldCount} past sale${soldCount === 1 ? '' : 's'}` : null,
            !service.is_active ? 'Hidden from the POS' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          action={
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
                Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  updateService.mutate({ id: service.id, is_active: !service.is_active })
                }
              >
                {service.is_active ? 'Hide' : 'Show'}
              </Button>
              <button
                onClick={() => setConfirmingDelete(true)}
                aria-label={`Delete ${service.name}`}
                title={
                  soldCount > 0
                    ? 'On past sales — hide it instead of deleting'
                    : `Delete ${service.name}`
                }
                className={cn(
                  'rounded-md p-1.5 text-faint transition-colors duration-150',
                  'hover:bg-red/10 hover:text-red'
                )}
              >
                <Trash2 size={14} />
              </button>
            </div>
          }
        />

        <div className="p-4">
          {service.is_open_price ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="text-xs text-faint">
                The cashier types the amount at sale time — no board price to set.
              </p>
              <CommissionField service={service} onSave={saveRate} />
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-2.5">
              {pricedSizes.map((size) => (
                <div key={size.id} className="group relative">
                  <Field
                    label={size.label}
                    hint={size.description ?? undefined}
                    className="w-[6.75rem]"
                  >
                    <Input
                      size="sm"
                      numeric
                      prefix="₱"
                      defaultValue={String(centavosToPesos(service.prices[size.id]!))}
                      key={`${size.id}-${service.prices[size.id]}`}
                      onBlur={(e) => {
                        const next = savePrice(size.id, e.target.value)
                        if (next !== undefined) e.target.value = String(centavosToPesos(next))
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      inputMode="decimal"
                      aria-label={`${service.name} price, ${size.label}`}
                    />
                  </Field>
                  <button
                    onClick={() => removeSize(size.id)}
                    aria-label={`Stop offering ${service.name} at ${size.label}`}
                    title={`Not offered at ${size.label}`}
                    className={cn(
                      'absolute -right-1 -top-1 rounded-full border border-line bg-surface-2 p-0.5',
                      'text-faint opacity-0 transition-opacity duration-150',
                      'hover:border-red/40 hover:text-red',
                      'group-hover:opacity-100 focus-visible:opacity-100'
                    )}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}

              {missingSizes.map((size) => (
                <button
                  key={size.id}
                  onClick={() => addSize(size.id)}
                  title={`Offer ${service.name} at ${size.label}`}
                  className={cn(
                    'mt-[1.15rem] flex h-9 w-[6.75rem] items-center justify-center gap-1.5 rounded-lg',
                    'border border-dashed border-line text-[11px] text-faint',
                    'transition-colors duration-150 hover:border-line-strong hover:text-muted'
                  )}
                >
                  <Plus size={12} />
                  {size.label}
                </button>
              ))}

              {/* A size the scale does not have yet. The owner is looking at
                  the price row when they realise one is missing, so the way to
                  add it belongs here and not only in the Sizes dialog. */}
              <button
                onClick={onManageSizes}
                title={`Add a new ${VEHICLE_CLASS_LABELS[service.vehicle_class].toLowerCase()} size`}
                className={cn(
                  'mt-[1.15rem] flex h-9 items-center justify-center gap-1.5 rounded-lg px-3',
                  'border border-dashed border-line/60 text-[11px] text-faint',
                  'transition-colors duration-150 hover:border-red/40 hover:text-red'
                )}
              >
                <Ruler size={12} />
                New size
              </button>

              <div className="ml-auto">
                <CommissionField service={service} onSave={saveRate} />
              </div>
            </div>
          )}

          <InclusionRow service={service} onEdit={() => setEditingInclusions(true)} />
        </div>
      </Panel>

      {renaming ? (
        <RenameServiceDialog service={service} onClose={() => setRenaming(false)} />
      ) : null}

      {editingInclusions ? (
        <InclusionPickerDialog service={service} onClose={() => setEditingInclusions(false)} />
      ) : null}

      {confirmingDelete ? (
        soldCount > 0 ? (
          <ConfirmModal
            title="Hide it instead"
            hint={`${service.name} is on ${soldCount} past sale${soldCount === 1 ? '' : 's'}. Deleting it would break those records, so it can only be hidden — it disappears from the POS and keeps its history.`}
            confirmLabel={service.is_active ? 'Hide it' : 'Already hidden'}
            busy={!service.is_active}
            onConfirm={() => {
              updateService.mutate({ id: service.id, is_active: false })
              setConfirmingDelete(false)
            }}
            onClose={() => setConfirmingDelete(false)}
          />
        ) : (
          <ConfirmModal
            title={`Delete ${service.name}?`}
            hint="It has never been sold, so nothing in your history points at it. This cannot be undone."
            confirmLabel="Delete"
            destructive
            busy={deleteService.isPending}
            onConfirm={confirmDelete}
            onClose={() => setConfirmingDelete(false)}
          />
        )
      ) : null}
    </>
  )
}

function CommissionField({
  service,
  onSave,
}: {
  service: CatalogService
  onSave: (raw: string) => void
}) {
  return (
    <Field label="Commission" className="w-[6.75rem]">
      <Input
        size="sm"
        numeric
        suffix="%"
        defaultValue={String(service.commission_rate_bp / 100)}
        key={service.commission_rate_bp}
        onBlur={(e) => onSave(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        inputMode="decimal"
        aria-label={`${service.name} commission rate`}
      />
    </Field>
  )
}

/** The inclusions strip under a service — read-only here; editing is the dialog. */
function InclusionRow({ service, onEdit }: { service: CatalogService; onEdit: () => void }) {
  return (
    <div className="mt-4 flex items-start justify-between gap-4 border-t border-line pt-3">
      <div className="min-w-0">
        <p className="board-label text-[10px] text-faint">Includes</p>
        {service.inclusions.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-faint">Nothing listed.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {service.inclusions.map((label) => (
              <span
                key={label}
                className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-muted"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={onEdit}>
        Edit
      </Button>
    </div>
  )
}

/**
 * Ticks inclusions off the shared list instead of retyping them, so two
 * packages can never disagree about whether it is "Tire Black" or "Tire black".
 */
function InclusionPickerDialog({
  service,
  onClose,
}: {
  service: CatalogService
  onClose: () => void
}) {
  const { data: options, isLoading } = useInclusionOptions()
  const createOption = useCreateInclusionOption()
  const setInclusions = useSetInclusions()
  const { toast } = useToast()

  const [selected, setSelected] = useState<string[]>(service.inclusions)
  const [draft, setDraft] = useState('')

  // Anything a package already lists but the catalog has dropped still shows,
  // so opening the dialog can never silently discard an inclusion.
  const labels = useMemo(() => {
    const known = (options ?? []).map((o) => o.label)
    return [...known, ...selected.filter((l) => !known.includes(l))]
  }, [options, selected])

  function toggle(label: string) {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    )
  }

  async function addNew() {
    const label = draft.trim()
    if (!label) return
    setDraft('')
    if (labels.includes(label)) {
      if (!selected.includes(label)) setSelected((prev) => [...prev, label])
      return
    }
    try {
      await createOption.mutateAsync(label)
      setSelected((prev) => [...prev, label])
    } catch (error) {
      toast({
        message: 'Could not add that inclusion',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  async function save() {
    try {
      // Saved in the catalog's order, not click order, so every package prints
      // its inclusions the same way round.
      const ordered = labels.filter((l) => selected.includes(l))
      await setInclusions.mutateAsync({ serviceId: service.id, labels: ordered })
      onClose()
    } catch (error) {
      toast({
        message: 'Could not save the inclusions',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  return (
    <Modal
      title={`${service.name} includes`}
      hint="Tick what this covers. These print on the receipt and carry no price of their own."
      onClose={onClose}
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={setInclusions.isPending}
            onClick={save}
          >
            Save
          </Button>
        </>
      }
    >
      {isLoading ? (
        <ListSkeleton rows={8} label="Loading inclusions" />
      ) : (
        <div className="mt-4 grid max-h-[19rem] grid-cols-2 gap-1 overflow-y-auto pr-1">
          {labels.map((label) => {
            const on = selected.includes(label)
            return (
              <button
                key={label}
                onClick={() => toggle(label)}
                role="checkbox"
                aria-checked={on}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs',
                  'transition-colors duration-150 [transition-timing-function:var(--ease-out-strong)]',
                  on
                    ? 'border-red/40 bg-red/10 text-chalk'
                    : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:text-chalk'
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    on ? 'border-red bg-red text-white' : 'border-line-strong'
                  )}
                >
                  {on ? <Check size={11} strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 truncate">{label}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-3 flex gap-2 border-t border-line pt-3">
        <Input
          size="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addNew()
            }
          }}
          placeholder="New inclusion…"
          aria-label="New inclusion"
        />
        <Button size="sm" className="shrink-0" disabled={!draft.trim()} onClick={addNew}>
          <Plus size={14} />
          Add
        </Button>
      </div>
    </Modal>
  )
}

/** Manages the shared list itself — rename carries into every package using it. */
function InclusionCatalogDialog({ onClose }: { onClose: () => void }) {
  const { data: options, isLoading } = useInclusionOptions()
  const { data: catalog } = useCatalog()
  const createOption = useCreateInclusionOption()
  const renameOption = useRenameInclusionOption()
  const deleteOption = useDeleteInclusionOption()
  const { toast } = useToast()

  const [draft, setDraft] = useState('')

  const usedBy = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of catalog ?? []) {
      for (const label of s.inclusions) map[label] = (map[label] ?? 0) + 1
    }
    return map
  }, [catalog])

  async function add() {
    const label = draft.trim()
    if (!label) return
    setDraft('')
    try {
      await createOption.mutateAsync(label)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast({
        message: 'Could not add that inclusion',
        detail: message.includes('duplicate') ? 'It is already on the list.' : message,
        tone: 'error',
      })
    }
  }

  return (
    <Modal
      title="Inclusions"
      hint="The vocabulary packages are built from. Renaming one updates every package that lists it."
      onClose={onClose}
      className="max-w-md"
      footer={
        <Button variant="primary" className="flex-1" onClick={onClose}>
          Done
        </Button>
      }
    >
      {isLoading ? (
        <ListSkeleton rows={8} label="Loading the inclusion catalog" />
      ) : (
        <ul className="mt-4 flex max-h-[19rem] flex-col gap-1 overflow-y-auto pr-1">
          {(options ?? []).map((option) => {
            const uses = usedBy[option.label] ?? 0
            return (
              <li key={option.id} className="flex items-center gap-2">
                <Input
                  size="sm"
                  defaultValue={option.label}
                  key={option.label}
                  onBlur={(e) => {
                    const next = e.target.value.trim()
                    if (!next || next === option.label) {
                      e.target.value = option.label
                      return
                    }
                    renameOption.mutate({ id: option.id, from: option.label, to: next })
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  aria-label={`Rename ${option.label}`}
                />
                <span className="w-20 shrink-0 text-right text-[10px] text-faint">
                  {uses > 0 ? `${uses} package${uses === 1 ? '' : 's'}` : 'unused'}
                </span>
                <button
                  onClick={() => deleteOption.mutate(option.id)}
                  aria-label={`Remove ${option.label} from the list`}
                  title={
                    uses > 0
                      ? `Removes it from the list; the ${uses} package${uses === 1 ? '' : 's'} already using it keep it`
                      : `Remove ${option.label}`
                  }
                  className="shrink-0 rounded-md p-1.5 text-faint transition-colors duration-150 hover:bg-red/10 hover:text-red"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex gap-2 border-t border-line pt-3">
        <Input
          size="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="New inclusion…"
          aria-label="New inclusion"
        />
        <Button size="sm" className="shrink-0" disabled={!draft.trim()} onClick={add}>
          <Plus size={14} />
          Add
        </Button>
      </div>
    </Modal>
  )
}

function RenameServiceDialog({
  service,
  onClose,
}: {
  service: CatalogService
  onClose: () => void
}) {
  const updateService = useUpdateService()
  const { toast } = useToast()
  const [name, setName] = useState(service.name)

  async function save() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === service.name) {
      onClose()
      return
    }
    try {
      await updateService.mutateAsync({ id: service.id, name: trimmed })
      onClose()
    } catch (error) {
      toast({
        message: 'Could not rename the service',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  return (
    <Modal
      title="Rename service"
      hint="Past sales keep the name they were rung up under."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={!name.trim() || updateService.isPending}
            onClick={save}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="rename-service" className="mt-4">
        <Input
          id="rename-service"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          autoFocus
        />
      </Field>
    </Modal>
  )
}

function NewServiceDialog({
  category,
  vehicleClass,
  catalog,
  onClose,
}: {
  category: ServiceCategory
  vehicleClass: VehicleClass
  catalog: CatalogService[]
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [openPrice, setOpenPrice] = useState(false)
  const create = useCreateService()
  const { toast } = useToast()

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) return

    // Land at the end of this class + category group so the new row appears
    // where the owner was just looking, not at the top of the whole board.
    const peers = catalog.filter(
      (s) => s.vehicle_class === vehicleClass && s.category === category
    )
    const sortOrder = peers.reduce((max, s) => Math.max(max, s.sort_order), 0) + 10

    try {
      await create.mutateAsync({
        name: trimmed,
        category,
        vehicle_class: vehicleClass,
        commission_rate_bp: DEFAULT_COMMISSION_BP[category],
        is_open_price: openPrice,
        sort_order: sortOrder,
      })
      toast({
        message: `${trimmed} added`,
        detail: openPrice ? 'The cashier types its price.' : 'Add its sizes and prices below.',
        tone: 'success',
      })
      onClose()
    } catch (error) {
      toast({
        message: 'Could not add the service',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  return (
    <Modal
      title={`New ${CATEGORY_LABELS[category].toLowerCase().replace(/s$/, '')}`}
      hint={`For ${VEHICLE_CLASS_PLURALS[vehicleClass].toLowerCase()}, at ${DEFAULT_COMMISSION_BP[category] / 100}% commission. Both are editable after saving.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={!name.trim() || create.isPending}
            onClick={submit}
          >
            Create
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="new-service-name" className="mt-4">
        <Input
          id="new-service-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={
            category === 'package'
              ? `Package ${catalog.filter((s) => s.category === 'package' && s.vehicle_class === vehicleClass).length + 1}`
              : 'Service name'
          }
          autoFocus
        />
      </Field>

      <label className="mt-3 flex items-start gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={openPrice}
          onChange={(e) => setOpenPrice(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#e11414]"
        />
        <span>
          Open price — the cashier types the amount
          <span className="mt-0.5 block text-[11px] text-faint">
            For &ldquo;and up&rdquo; work with no fixed board price.
          </span>
        </span>
      </label>

      {!openPrice ? (
        <p className="mt-3 text-[11px] text-faint">
          Starts with no sizes priced. Add {VEHICLE_CLASS_LABELS[vehicleClass].toLowerCase()} sizes
          on the card once it is created.
        </p>
      ) : null}
    </Modal>
  )
}

/**
 * The size scale itself. Adding a row here makes a new column appear on every
 * price row for that class, and renaming one reaches the POS immediately —
 * while past sales keep the label they printed, so history never moves.
 */
function SizeCatalogDialog({
  vehicleClass,
  onClose,
}: {
  vehicleClass: VehicleClass
  onClose: () => void
}) {
  const { data: sizes, isLoading } = useVehicleSizes()
  const { data: usage } = useSizeUsage()
  const createSize = useCreateVehicleSize()
  const updateSize = useUpdateVehicleSize()
  const deleteSize = useDeleteVehicleSize()
  const { toast } = useToast()

  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')

  const scale = useMemo(
    () => sizesForClass(sizes ?? [], vehicleClass),
    [sizes, vehicleClass]
  )

  async function add() {
    const trimmed = label.trim()
    if (!trimmed) return

    if (scale.some((s) => s.label.trim().toLowerCase() === trimmed.toLowerCase())) {
      toast({ message: `${trimmed} is already on this scale`, tone: 'error' })
      return
    }

    const sortOrder = scale.reduce((max, s) => Math.max(max, s.sort_order), 0) + 1
    try {
      await createSize.mutateAsync({
        vehicle_class: vehicleClass,
        label: trimmed,
        description: description.trim() || null,
        sort_order: sortOrder,
      })
      setLabel('')
      setDescription('')
      toast({
        message: `${trimmed} added`,
        detail: 'Set its price on each service that offers it.',
        tone: 'success',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast({
        message: 'Could not add that size',
        detail: message.includes('duplicate') ? 'It is already on this scale.' : message,
        tone: 'error',
      })
    }
  }

  async function remove(size: VehicleSizeRow) {
    try {
      await deleteSize.mutateAsync(size.id)
      toast({ message: `${size.label} removed`, tone: 'success' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast({
        message: 'Could not remove that size',
        detail: message.includes('SIZE_IN_USE')
          ? 'It is on past sales. Hide it instead.'
          : message,
        tone: 'error',
      })
    }
  }

  // Swapping sort_order with the neighbour is enough to reorder a scale this
  // short, and it avoids a drag affordance on a touch-first screen.
  function move(index: number, delta: number) {
    const a = scale[index]
    const b = scale[index + delta]
    if (!a || !b) return
    updateSize.mutate({ id: a.id, sort_order: b.sort_order })
    updateSize.mutate({ id: b.id, sort_order: a.sort_order })
  }

  return (
    <Modal
      title={`${VEHICLE_CLASS_LABELS[vehicleClass]} sizes`}
      hint="The scale every price row on this tab is priced against. Past sales keep the size they were rung up at."
      onClose={onClose}
      className="max-w-lg"
      footer={
        <Button variant="primary" className="flex-1" onClick={onClose}>
          Done
        </Button>
      }
    >
      {isLoading ? (
        <ListSkeleton rows={5} label="Loading the size scale" />
      ) : (
        <ul className="mt-4 flex max-h-[19rem] flex-col gap-1.5 overflow-y-auto pr-1">
          {scale.map((size, i) => {
            const sold = usage?.[size.label.trim().toLowerCase()] ?? 0
            return (
              <li key={size.id} className="flex items-center gap-2">
                <div className="flex shrink-0 flex-col">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${size.label} earlier`}
                    className="rounded px-1 text-[9px] text-faint hover:text-chalk disabled:opacity-30"
                  >
                    <ChevronUp size={11} />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === scale.length - 1}
                    aria-label={`Move ${size.label} later`}
                    className="rounded px-1 text-[9px] text-faint hover:text-chalk disabled:opacity-30"
                  >
                    <ChevronDown size={11} />
                  </button>
                </div>

                <Input
                  size="sm"
                  className="w-24 shrink-0"
                  defaultValue={size.label}
                  key={`label-${size.id}-${size.label}`}
                  onBlur={(e) => {
                    const next = e.target.value.trim()
                    if (!next || next === size.label) {
                      e.target.value = size.label
                      return
                    }
                    updateSize.mutate({ id: size.id, label: next })
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  aria-label={`Rename ${size.label}`}
                />

                <Input
                  size="sm"
                  defaultValue={size.description ?? ''}
                  key={`desc-${size.id}-${size.description}`}
                  placeholder="What fits…"
                  onBlur={(e) => {
                    const next = e.target.value.trim()
                    if (next === (size.description ?? '')) return
                    updateSize.mutate({ id: size.id, description: next })
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  aria-label={`Describe ${size.label}`}
                />

                <button
                  onClick={() => updateSize.mutate({ id: size.id, is_active: !size.is_active })}
                  title={
                    size.is_active
                      ? `Hide ${size.label} from the POS`
                      : `Show ${size.label} on the POS`
                  }
                  className={cn(
                    'shrink-0 rounded-md px-2 py-1 text-[10px] transition-colors duration-150',
                    size.is_active
                      ? 'text-faint hover:text-chalk'
                      : 'bg-surface-2 text-red hover:text-chalk'
                  )}
                >
                  {size.is_active ? 'Hide' : 'Hidden'}
                </button>

                <button
                  onClick={() => remove(size)}
                  disabled={sold > 0}
                  aria-label={`Remove ${size.label}`}
                  title={
                    sold > 0
                      ? `On ${sold} past sale line${sold === 1 ? '' : 's'} — hide it instead`
                      : `Remove ${size.label} and its prices`
                  }
                  className={cn(
                    'shrink-0 rounded-md p-1.5 text-faint transition-colors duration-150',
                    'hover:bg-red/10 hover:text-red disabled:opacity-30 disabled:hover:bg-transparent',
                    'disabled:hover:text-faint'
                  )}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex gap-2 border-t border-line pt-3">
        <Input
          size="sm"
          className="w-24 shrink-0"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Name"
          aria-label="New size name"
        />
        <Input
          size="sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="What fits (optional)…"
          aria-label="New size description"
        />
        <Button
          size="sm"
          className="shrink-0"
          disabled={!label.trim() || createSize.isPending}
          onClick={add}
        >
          <Plus size={14} />
          Add
        </Button>
      </div>

      <p className="mt-2 text-[11px] text-faint">
        A new size starts unpriced everywhere. Set what it costs on each service
        that offers it.
      </p>
    </Modal>
  )
}
