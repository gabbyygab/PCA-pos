'use client'

import { useState } from 'react'
import { Archive, ChevronRight, RotateCcw, Trash2, UserPlus } from 'lucide-react'
import { EmployeeDetail } from '@/components/employees/EmployeeDetail'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Panel, PanelHeader, SlashRule } from '@/components/ui/Panel'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import {
  useCreateEmployee,
  useDeleteEmployee,
  useEmployeeDeletable,
  useEmployees,
  useUpdateEmployee,
  type Employee,
} from '@/lib/queries/employees'

export function EmployeesTab() {
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  /* Archived staff are out of the way by default, not gone. */
  const [view, setView] = useState<'active' | 'archived'>('active')
  const [deleting, setDeleting] = useState<Employee | null>(null)
  const { data: employees, isLoading } = useEmployees()
  const create = useCreateEmployee()
  const update = useUpdateEmployee()
  const remove = useDeleteEmployee()
  const { data: deletable } = useEmployeeDeletable(deleting?.id ?? null)
  const blocked = deletable !== undefined && !deletable.deletable
  const { toast } = useToast()

  // Resolved from the live list, so renaming or deactivating someone updates
  // the open dialog instead of showing a stale copy of the row.
  const openEmployee = (employees ?? []).find((e) => e.id === openId) ?? null

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await create.mutateAsync(trimmed)
      setName('')
      toast({ message: `${trimmed} added`, tone: 'success' })
    } catch (error) {
      toast({
        message: 'Could not add employee',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  const roster = employees ?? []
  const active = roster.filter((e) => e.is_active)
  const archived = roster.filter((e) => !e.is_active)
  const shown = view === 'active' ? active : archived

  async function setArchived(employee: Employee, archive: boolean) {
    try {
      await update.mutateAsync({ id: employee.id, is_active: !archive })
      toast({
        message: archive ? `${employee.name} archived` : `${employee.name} restored`,
        detail: archive
          ? 'Hidden from the POS. Past sales and payslips are untouched.'
          : 'Back on the roster and selectable at the counter.',
        tone: 'success',
      })
    } catch (error) {
      toast({
        message: archive ? 'Could not archive' : 'Could not restore',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  async function confirmDelete() {
    if (!deleting || blocked) return
    const name = deleting.name
    try {
      await remove.mutateAsync(deleting.id)
      setDeleting(null)
      toast({ message: `${name} deleted`, tone: 'success' })
    } catch (error) {
      toast({
        message: 'Could not delete',
        detail: error instanceof Error ? error.message : 'Unknown error',
        tone: 'error',
      })
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <SlashRule className="mb-3" />
        <h1 className="board-head text-2xl text-chalk">Employees</h1>
        <p className="mt-1 text-xs text-muted">
          Each sale is assigned to one employee, who earns the cut on every line.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-4xl">
          <Panel className="mb-4 p-4">
            <label className="board-label block text-[10px] text-faint">Add employee</label>
            <div className="mt-2 flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder="Name"
                aria-label="Employee name"
                className="flex-1"
              />
              <Button variant="primary" onClick={add} disabled={!name.trim() || create.isPending}>
                <UserPlus size={15} />
                Add
              </Button>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Roster"
              hint="Archiving hides someone from the POS without touching their past sales."
            />

            {/* Active / Archived split. Archived staff stay reachable — their
                sales still count toward past weeks — but never clutter the
                counter's picker. */}
            <div className="flex gap-1 border-b border-line px-4 pb-3">
              {(['active', 'archived'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`board-label rounded-md px-3 py-1.5 text-[10px] transition-colors duration-150 ${
                    view === key
                      ? 'bg-red text-chalk'
                      : 'text-faint hover:bg-surface-2 hover:text-chalk'
                  }`}
                >
                  {key === 'active' ? 'Active' : 'Archived'}
                  <span className="ml-1.5 opacity-70">
                    {key === 'active' ? active.length : archived.length}
                  </span>
                </button>
              ))}
            </div>
            {isLoading ? (
              <TableSkeleton label="Loading the roster" rows={6} columns={['45%', '22%']} />
            ) : shown.length === 0 ? (
              <p className="px-4 py-6 text-sm text-faint">
                {view === 'archived'
                  ? 'Nobody is archived. Staff you archive are kept here.'
                  : roster.length === 0
                    ? 'No employees yet. Add the first one above.'
                    : 'Everyone is archived. Switch to Archived to restore someone.'}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {shown.map((employee) => (
                  <li
                    key={employee.id}
                    className="flex items-center justify-between gap-3 px-4 py-1.5 transition-colors duration-150 hover:bg-surface-2"
                  >
                    {/* The row opens the detail dialog; Deactivate stays a
                        sibling so it is never a button inside a button. */}
                    <button
                      type="button"
                      onClick={() => setOpenId(employee.id)}
                      aria-haspopup="dialog"
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg py-1.5 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-chalk">
                          {employee.name}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-faint">
                          {employee.is_active ? 'View sales and cut' : 'Archived'}
                        </span>
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-faint" aria-hidden />
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        variant={employee.is_active ? 'ghost' : 'secondary'}
                        onClick={() => setArchived(employee, employee.is_active)}
                        disabled={update.isPending}
                      >
                        {employee.is_active ? <Archive size={13} /> : <RotateCcw size={13} />}
                        {employee.is_active ? 'Archive' : 'Restore'}
                      </Button>
                      {/* Delete lives only on archived rows: it is unreachable
                          for anyone with sales anyway, and archiving first
                          makes that a deliberate two-step. */}
                      {!employee.is_active ? (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeleting(employee)}
                          aria-label={`Delete ${employee.name}`}
                        >
                          <Trash2 size={13} />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {deleting ? (
        <ConfirmModal
          title={`Delete ${deleting.name}?`}
          hint={
            blocked
              ? 'This employee has history tied to them, so deleting them would orphan it. Leave them archived instead — their name keeps printing on every past ticket and payslip.'
              : 'Permanent. Use this only for a row added by mistake — archiving is what keeps a former employee’s history intact.'
          }
          confirmLabel="Delete permanently"
          destructive
          // Blocked is a dead end, not a slow path: the database will refuse it,
          // so the button never fires rather than failing into a toast.
          busy={remove.isPending || deletable === undefined || blocked}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        >
          {blocked ? (
            <div className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-chalk">
              <p className="font-semibold">Tied to:</p>
              <ul className="mt-1 list-inside list-disc text-muted">
                {deletable.blockedBy.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="mt-2 text-muted">Cancel and keep them archived.</p>
            </div>
          ) : null}
        </ConfirmModal>
      ) : null}

      {openEmployee ? (
        <Modal
          title={openEmployee.name}
          hint={
            openEmployee.is_active
              ? 'Sales worked and commission earned.'
              : 'Inactive — past sales are still counted below.'
          }
          onClose={() => setOpenId(null)}
          // Wider than the default dialog: the detail carries a stat grid, and
          // the body scrolls on its own so a long sale list never pushes the
          // title off a laptop screen.
          className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden"
        >
          {/* Negative margin cancels the card's own padding so the detail's
              panels reach the edges, while the title keeps its inset. */}
          <div className="-mx-5 -mb-5 mt-3 min-h-0 flex-1 overflow-y-auto border-t border-line">
            <EmployeeDetail employeeId={openEmployee.id} />
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
