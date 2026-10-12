import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The mimic-panel signature: a flow drawn as a single-line diagram,
 * source bus ── breaker ── destination bus, read like a breaker.
 *
 *   live      closed breaker, teal line     (last run succeeded / enabled)
 *   running   closed breaker, line energising
 *   tripped   closed red breaker            (failed, or rows held back)
 *   held      purple breaker                (waiting for approval)
 *   paused    open breaker, dashed outgoing line
 *   idle      open breaker, grey            (never run)
 */
export type FlowState = 'live' | 'running' | 'tripped' | 'held' | 'paused' | 'idle'

const COLOR: Record<FlowState, string> = {
  live: 'text-live',
  running: 'text-live',
  tripped: 'text-danger',
  held: 'text-held',
  paused: 'text-paused',
  idle: 'text-paused',
}

const OPEN: Record<FlowState, boolean> = { live: false, running: false, tripped: false, held: false, paused: true, idle: true }

export function Breaker({ state, className }: { state: FlowState; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.5 shrink-0 rounded-[1px] border-2 border-current', !OPEN[state] && 'bg-current', COLOR[state], state === 'running' && 'animate-pulse', className)}
    />
  )
}

/** A state written as breaker + words. Never colour alone. */
export function StateMark({ state, children, className }: { state: FlowState; children: React.ReactNode; className?: string }) {
  const text = { live: 'text-live-text', running: 'text-live-text', tripped: 'text-danger-text', held: 'text-held-text', paused: 'text-muted-foreground', idle: 'text-muted-foreground' }[state]
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap', text, className)}>
      <Breaker state={state} />
      {children}
    </span>
  )
}

export function FlowLine({
  from,
  to,
  state,
  srLabel,
  className,
}: {
  from: React.ReactNode
  to: React.ReactNode
  state: FlowState
  /** Spoken instead of the drawing, e.g. "employees_sap to employees". */
  srLabel?: string
  className?: string
}) {
  const open = OPEN[state]
  return (
    <span className={cn('flex min-w-0 items-center font-mono text-xs', COLOR[state], className)}>
      {srLabel && <span className="sr-only">{srLabel}</span>}
      <span aria-hidden className="h-4 w-1.5 shrink-0 border-2 border-current" />
      <span aria-hidden={!!srLabel || undefined} title={typeof from === 'string' ? from : undefined} className="min-w-0 truncate px-1.5 text-muted-foreground">
        {from}
      </span>
      <span aria-hidden className={cn('h-0.5 min-w-4 flex-1 bg-current', state === 'running' && 'flow-energise')} />
      <span aria-hidden className={cn('mx-0.5 size-3 shrink-0 rounded-[1px] border-2 border-current', !open && 'bg-current')} />
      <span
        aria-hidden
        className={cn('h-0.5 min-w-4 flex-1', open ? 'bg-[repeating-linear-gradient(90deg,currentColor_0_5px,transparent_5px_9px)]' : 'bg-current', state === 'running' && 'flow-energise')}
      />
      <span aria-hidden={!!srLabel || undefined} title={typeof to === 'string' ? to : undefined} className="min-w-0 truncate px-1.5 text-muted-foreground">
        {to}
      </span>
      <span aria-hidden className="h-4 w-1.5 shrink-0 border-2 border-current" />
    </span>
  )
}
