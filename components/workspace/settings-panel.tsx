import * as React from 'react'
import { cn } from '@/lib/utils'

/** A settings panel: flat plate on the board with its own h2. */
export function SettingsPanel({ id, title, description, children, className }: { id?: string; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-6 rounded-lg border border-border bg-card p-5', className)}>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Native <select> styled like the other controls. */
export const nativeSelectClass =
  'h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'
