'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

interface ModalProps {
  title: string
  /** Sits under the title — the sentence that explains the consequence. */
  hint?: string
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * The scrim + card every dialog shares.
 *
 * Focus moves into the card on open, and Escape, the scrim, or the corner X
 * all close, so a dialog is never a trap the owner has to guess their way out
 * of. Entry animates with `@starting-style`, matching the Select list — no
 * mount effect, and reduced-motion users get the opacity change without the
 * scale.
 *
 * The card is capped at the viewport and splits into three bands: the title
 * and the footer hold their place while only the body scrolls. Without the cap
 * a tall dialog simply grew past the screen, putting Save somewhere below the
 * bottom edge with no way to reach it — the page behind is `overflow-hidden`,
 * so there was nothing to scroll. Capping the card rather than each dialog's
 * body means a dialog cannot reintroduce the problem by adding a field.
 *
 * `min-h-0` on the scroller is what actually lets it shrink: a flex child's
 * floor is its content, and it will not go below that without it.
 */
export function Modal({ title, hint, onClose, children, footer, className }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    // Autofocus the first control, falling back to the card itself so the
    // Escape handler has focus context even in a dialog with no inputs. The
    // dismiss X is skipped so it never steals focus from a real control.
    const first = cardRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button:not([data-modal-dismiss])'
    )
    ;(first ?? cardRef.current)?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col rounded-xl border border-line-strong bg-surface p-5 shadow-2xl outline-none',
          'scale-100 opacity-100 transition-[opacity,transform] duration-200',
          '[transition-timing-function:var(--ease-out-strong)] starting:scale-[0.96] starting:opacity-0',
          className
        )}
      >
        <div className="flex shrink-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="board-head text-lg text-chalk">{title}</h2>
            {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
          </div>
          <button
            type="button"
            data-modal-dismiss
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-faint outline-none transition-colors duration-150 hover:bg-surface-2 hover:text-chalk focus-visible:text-chalk focus-visible:ring-2 focus-visible:ring-red/60"
          >
            <X size={16} />
          </button>
        </div>
        {/* `-mx-5 px-5` lets a focus ring on an edge control breathe instead
            of being clipped by the scroll container. */}
        <div className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5">{children}</div>
        {footer ? (
          <div className="mt-4 flex shrink-0 gap-2 border-t border-line pt-4">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  title: string
  hint?: string
  /** The verb on the button — "Delete", "Hide", "Remove". */
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}

export function ConfirmModal({
  title,
  hint,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onClose,
  children,
}: ConfirmModalProps) {
  return (
    <Modal
      title={title}
      hint={hint}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            className="flex-1"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
