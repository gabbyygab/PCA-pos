'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Check, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Toast {
  id: number
  message: string
  detail?: string
  tone: 'success' | 'error'
}

const ToastContext = createContext<{
  toast: (t: Omit<Toast, 'id'>) => void
} | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId++
    setToasts((prev) => [...prev, { ...t, id }])
    // Errors stay longer; the cashier may need to read what went wrong.
    const ttl = t.tone === 'error' ? 6000 : 2600
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), ttl)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * Enters with @starting-style so no mount effect is needed, and uses a
 * transition rather than keyframes — toasts stack fast and must retarget
 * smoothly rather than restart from zero.
 */
function ToastCard({ toast }: { toast: Toast }) {
  const isError = toast.tone === 'error'
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl',
        'backdrop-blur-xl',
        'translate-y-0 scale-100 opacity-100',
        'transition-[opacity,transform] duration-[260ms] [transition-timing-function:var(--ease-out-strong)]',
        'starting:translate-y-3 starting:scale-[0.96] starting:opacity-0',
        isError
          ? 'border-red/40 bg-[rgba(45,12,12,0.82)]'
          : 'border-line-strong bg-[rgba(22,22,25,0.82)]'
      )}
      role="status"
    >
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
          isError ? 'bg-red/20 text-red' : 'bg-good/20 text-good'
        )}
      >
        {isError ? <TriangleAlert size={12} /> : <Check size={12} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-chalk">{toast.message}</p>
        {toast.detail ? <p className="mt-0.5 text-xs text-muted">{toast.detail}</p> : null}
      </div>
    </div>
  )
}
