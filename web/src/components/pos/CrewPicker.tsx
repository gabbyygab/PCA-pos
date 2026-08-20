'use client'

import { Combobox } from '@/components/ui/Combobox'
import type { Employee } from '@/lib/queries/employees'

interface CrewPickerProps {
  employees: Employee[]
  selected: string[]
  onChange: (ids: string[]) => void
  id?: string
}

/**
 * Who washed this car. A searchable multi-select: the roster grows as the shop
 * hires, and the cashier picks two or three names per car at ~40 cars a day,
 * so typing three letters has to be enough to land a name.
 *
 * Inactive employees are filtered out rather than disabled -- someone who no
 * longer works here is noise in the list, not a choice to explain.
 */
export function CrewPicker({ employees, selected, onChange, id }: CrewPickerProps) {
  const active = employees.filter((e) => e.is_active)

  return (
    <Combobox
      id={id}
      multiple
      value={selected}
      onChange={onChange}
      options={active.map((e) => ({ value: e.id, label: e.name }))}
      placeholder={active.length ? 'Search employees…' : 'No active employees'}
      emptyMessage="No employee by that name."
      disabled={active.length === 0}
      invalid={selected.length === 0}
      aria-label="Employees who worked this car"
    />
  )
}
