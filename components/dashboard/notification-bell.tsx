'use client'

import { useCallback, useEffect, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { AlertTriangle, Bell, BellOff, Info, Mail, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { listNotifications, markNotificationsRead } from '@/lib/actions/monitoring'

type Data = Awaited<ReturnType<typeof listNotifications>>

const POLL_MS = 60_000
/** Dispatch on window after anything that may create notifications (e.g. a pipeline run). */
export const NOTIFICATIONS_CHANGED = 'nexus:notifications-changed'
const LEVEL = {
  error: { icon: XCircle, className: 'text-danger', label: 'Error' },
  warning: { icon: AlertTriangle, className: 'text-warning', label: 'Warning' },
  info: { icon: Info, className: 'text-info', label: 'Info' },
} as const

function ago(value: Date | string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

/** The bell in the top bar: a keyboard-reachable popover, Escape closes it and focus returns to the bell. */
export default function NotificationBell() {
  const [data, setData] = useState<Data | null>(null)
  const [open, setOpen] = useState(false)

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

  const markAll = async () => {
    await markNotificationsRead()
    await load()
  }

  const unread = data?.unread ?? 0
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void load()
      }}
    >
      <Popover.Trigger render={<Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unread} unread)`} />}>
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span aria-hidden className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-sm bg-danger px-1 font-mono text-[10px] font-semibold text-white dark:text-background">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-[min(380px,calc(100vw-2rem))] origin-(--transform-origin) rounded-lg border border-border bg-popover text-popover-foreground shadow-raised outline-none transition-[opacity,transform] duration-100 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <Popover.Title className="text-sm font-semibold">
                Notifications <span className="font-mono text-xs font-normal text-muted-foreground">({unread} unread)</span>
              </Popover.Title>
              {unread > 0 && (
                <Button size="xs" variant="link" className="px-0" onClick={() => void markAll()}>
                  Mark all read
                </Button>
              )}
            </div>
            {!data?.items.length ? (
              <EmptyState compact icon={<BellOff />} title="No notifications">
                Failed pipeline runs show up here.
              </EmptyState>
            ) : (
              <ul className="max-h-[420px] overflow-y-auto" aria-label="Recent notifications">
                {data.items.map((n) => {
                  const meta = LEVEL[(n.level as keyof typeof LEVEL) ?? 'info'] ?? LEVEL.info
                  const Icon = meta.icon
                  return (
                    <li
                      key={n.id}
                      className={cn('flex gap-3 border-b border-border px-4 py-3 text-sm last:border-0', !n.readAt && 'bg-accent shadow-[inset_3px_0_0_var(--live)]')}
                    >
                      <Icon className={cn('mt-0.5 size-4 shrink-0', meta.className)} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          <span className="sr-only">
                            {meta.label}
                            {n.readAt ? ': ' : ', unread: '}
                          </span>
                          {n.title}
                        </div>
                        {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body.split('\n')[1] ?? n.body}</div>}
                        <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                          {ago(n.createdAt)}
                          {!n.readAt && <span className="font-sans font-medium text-live-text" aria-hidden>New</span>}
                          {n.emailStatus && (
                            <span className="flex items-center gap-1 font-sans" title={`Email ${n.emailStatus}`}>
                              <Mail className="size-3" aria-hidden /> {n.emailStatus === 'sent' ? 'emailed' : n.emailStatus === 'skipped' ? 'email not configured' : 'email failed'}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
