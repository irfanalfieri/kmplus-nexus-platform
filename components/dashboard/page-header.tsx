import * as React from 'react'
import { cn } from '@/lib/utils'

/** The screen's title (the page's only h1), what it is for, and its main actions on the right. */
export function PageHeader({ title, description, meta, actions, className }: { title: React.ReactNode; description?: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-end gap-x-6 gap-y-3', className)}>
      <div className="min-w-0 flex-[1_1_20rem]">
        <h1 className="text-[1.625rem] leading-9 font-normal tracking-[-0.01em] text-balance">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-pretty text-muted-foreground">{description}</p>}
        {meta && <p className="mt-1.5 font-mono text-xs text-muted-foreground">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
