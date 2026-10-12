import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

const TONES = {
  info: { box: 'border-info/40 bg-info-soft', icon: 'text-info-text', Icon: Info },
  success: { box: 'border-live/40 bg-live-soft', icon: 'text-live-text', Icon: CheckCircle2 },
  warning: { box: 'border-warning/50 bg-warning-soft', icon: 'text-warning-text', Icon: AlertTriangle },
  danger: { box: 'border-danger/40 bg-danger-soft', icon: 'text-danger-text', Icon: OctagonAlert },
  held: { box: 'border-held/40 bg-held-soft', icon: 'text-held-text', Icon: ShieldAlert },
} as const
export type NoticeTone = keyof typeof TONES

/**
 * An inline message. Errors and warnings are announced (role="alert"), the rest
 * politely (role="status"). Always an icon and words, never colour alone.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
  live,
}: {
  tone?: NoticeTone
  title?: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
  /** Override the announcement role; `false` for static help text. */
  live?: 'alert' | 'status' | false
}) {
  const { box, icon, Icon } = TONES[tone]
  const role = live === false ? undefined : (live ?? (tone === 'danger' || tone === 'warning' ? 'alert' : 'status'))
  return (
    <div role={role} data-slot="notice" className={cn('flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm text-foreground', box, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-pretty [&_a]:underline')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
