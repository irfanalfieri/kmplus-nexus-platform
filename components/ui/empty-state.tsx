import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * An honest empty screen: what this place is for and the one thing to do next.
 * The icon sits on an open bus bar, the board's "nothing connected yet" mark.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
  compact = false,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div data-slot="empty-state" className={cn('flex flex-col items-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14', className)}>
      {icon && (
        <div className="flex items-center gap-1.5 text-muted-foreground [&_svg]:size-5" aria-hidden>
          <span className="h-px w-6 border-t-2 border-dashed border-paused" />
          <span className="flex size-10 items-center justify-center rounded-sm border-2 border-paused">{icon}</span>
          <span className="h-px w-6 border-t-2 border-dashed border-paused" />
        </div>
      )}
      <h3 className={cn('font-semibold text-balance', compact ? 'text-sm' : 'text-base')}>{title}</h3>
      {children && <div className="max-w-md text-sm text-pretty text-muted-foreground">{children}</div>}
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}
