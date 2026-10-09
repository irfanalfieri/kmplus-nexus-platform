'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, Info, Mail, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { listNotifications, markNotificationsRead } from '@/lib/actions/monitoring'

type Data = Awaited<ReturnType<typeof listNotifications>>

const POLL_MS = 60_000
/** Dispatch on window after anything that may create notifications (e.g. a pipeline run). */
export const NOTIFICATIONS_CHANGED = 'nexus:notifications-changed'
const LEVEL = {
  error: { icon: XCircle, className: 'text-destructive' },
  warning: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-300' },
  info: { icon: Info, className: 'text-primary' },
} as const

function ago(value: Date | string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export default function NotificationBell() {
  const [data, setData] = useState<Data | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setData(await listNotifications(20))
    } catch {
      // Bell is non-critical; keep the last state.
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS)
    const onChange = () => void load()
    window.addEventListener(NOTIFICATIONS_CHANGED, onChange)
    return () => {
      clearInterval(timer)
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChange)
    }
  }, [load])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const markAll = async () => {
    await markNotificationsRead()
    await load()
  }

  const unread = data?.unread ?? 0
  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setOpen((v) => !v)
          if (!open) void load()
        }}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(380px,calc(100vw-2rem))] rounded-xl border border-border bg-popover shadow-lg" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-primary hover:underline" onClick={() => void markAll()}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[420px] overflow-y-auto">
            {!data?.items.length ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications. Failed pipeline runs show up here.</li>
            ) : (
              data.items.map((n) => {
                const meta = LEVEL[(n.level as keyof typeof LEVEL) ?? 'info'] ?? LEVEL.info
                const Icon = meta.icon
                return (
                  <li key={n.id} className={`flex gap-3 border-b border-border/60 px-4 py-3 text-sm ${n.readAt ? '' : 'bg-primary/5'}`}>
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{n.title}</div>
                      {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body.split('\n')[1] ?? n.body}</div>}
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        {ago(n.createdAt)}
                        {n.emailStatus && (
                          <span className="flex items-center gap-1" title={`Email ${n.emailStatus}`}>
                            <Mail className="h-3 w-3" /> {n.emailStatus === 'sent' ? 'emailed' : n.emailStatus === 'skipped' ? 'email not configured' : 'email failed'}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
