'use client'

import { Check, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPeso } from '@shared/lib/currency'
import { CATEGORY_LABELS, type ServiceCategory } from '@shared/lib/domain'
import { resolvePrice } from '@shared/lib/pricing'
import type { CatalogService } from '@/lib/queries/catalog'

interface ServiceGridProps {
  services: CatalogService[]
  /** The selected size row's id, or null when the class has no sizes. */
  sizeId: string | null
  selectedIds: Set<string>
  onSelect: (service: CatalogService) => void
  isAvailable: (service: CatalogService) => boolean
}

const ORDER: ServiceCategory[] = ['basic', 'package', 'addon']

export function ServiceGrid({
  services,
  sizeId,
  selectedIds,
  onSelect,
  isAvailable,
}: ServiceGridProps) {
  return (
    <div className="flex flex-col gap-7">
      {ORDER.map((category) => {
        const group = services.filter((s) => s.category === category)
        if (group.length === 0) return null

        return (
          <section key={category}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="board-label text-[11px] text-red">{CATEGORY_LABELS[category]}</h2>
              <div className="h-px flex-1 bg-line" />
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-3">
              {group.map((service) => {
                const available = isAvailable(service)
                const price = sizeId ? resolvePrice(service, sizeId) : null
                const selected = selectedIds.has(service.id)

                return (
                  <button
                    key={service.id}
                    onClick={() => onSelect(service)}
                    disabled={!available}
                    className={cn(
                      'group relative flex min-h-[6.5rem] flex-col justify-between rounded-xl border p-3 text-left',
                      'transition-[transform,background-color,border-color] duration-150 [transition-timing-function:var(--ease-out-strong)]',
                      'enabled:active:scale-[0.97]',
                      available
                        ? selected
                          ? 'border-red bg-red/10'
                          : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
                        : 'cursor-not-allowed border-line/60 bg-surface/40 opacity-45'
                    )}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold leading-snug text-chalk">
                          {service.name}
                        </h3>
                        <span
                          className={cn(
                            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                            'transition-colors duration-150',
                            selected
                              ? 'bg-red text-white'
                              : 'bg-surface-2 text-faint group-enabled:group-hover:text-muted'
                          )}
                        >
                          {selected ? <Check size={12} /> : <Plus size={12} />}
                        </span>
                      </div>

                      {service.inclusions.length > 0 ? (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-faint">
                          {service.inclusions.join(' · ')}
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-2">
                      <span className="tnum text-base font-bold text-chalk">
                        {service.is_open_price
                          ? 'Open price'
                          : price !== null
                            ? formatPeso(price)
                            : 'Not offered'}
                      </span>
                      <span className="board-label text-[9px] text-faint">
                        {service.commission_rate_bp / 100}%
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
