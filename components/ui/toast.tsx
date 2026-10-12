'use client'

import * as React from 'react'
import { CheckCircle2, OctagonAlert, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/components/i18n/i18n-provider'

interface ToastInput {
  message: React.ReactNode
  tone?: 'default' | 'danger'
  /** e.g. Undo. Runs once; the toast closes. */
  action?: { label: string; onClick: () => void }
  durationMs?: number
}
interface ToastItem extends ToastInput {
  id: number
}

const ToastCtx = React.createContext<((t: ToastInput) => void) | null>(null)

/** Short confirmations at the bottom of the screen, announced politely. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const nextId = React.useRef(1)
  const close = React.useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), [])
  const toast = React.useCallback((input: ToastInput) => setItems((all) => [...all.slice(-2), { ...input, id: nextId.current++ }]), [])
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div role="region" aria-label="Notifications" className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end">
        <div aria-live="polite" className="flex flex-col gap-2">
          {items.map((t) => (
            <Toast key={t.id} item={t} onClose={() => close(t.id)} />
          ))}
        </div>
      </div>
    </ToastCtx.Provider>
  )
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const t = useT()
  const [paused, setPaused] = React.useState(false)
  React.useEffect(() => {
    if (paused) return
    const timer = setTimeout(onClose, item.durationMs ?? (item.action ? 8000 : 5000))
    return () => clearTimeout(timer)
  }, [paused, item, onClose])
  const Icon = item.tone === 'danger' ? OctagonAlert : CheckCircle2
  return (
    <div
      className="pointer-events-auto flex w-full max-w-sm animate-in items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2.5 text-sm shadow-raised fade-in slide-in-from-bottom-2 sm:w-96"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className={cn('size-4 shrink-0', item.tone === 'danger' ? 'text-danger-text' : 'text-live-text')} aria-hidden />
      <div className="min-w-0 flex-1">{item.message}</div>
      {item.action && (
        <button
          type="button"
          className="rounded-sm px-1.5 py-0.5 font-medium text-info-text hover:underline"
          onClick={() => {
            item.action!.onClick()
            onClose()
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" aria-label={t('common.close')} className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground" onClick={onClose}>
        <XIcon className="size-4" />
      </button>
    </div>
  )
}

export function useToast() {
  const value = React.useContext(ToastCtx)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}
