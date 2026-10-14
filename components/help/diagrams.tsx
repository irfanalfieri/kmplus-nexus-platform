'use client'

import { Fragment } from 'react'
import { ArrowDown, ArrowRight, KeyRound, Lock, RotateCcw } from 'lucide-react'
import { useT } from '@/components/i18n/i18n-provider'
import { Breaker, StateMark } from '@/components/ui/flow-line'
import { cn } from '@/lib/utils'
import { PERMISSIONS, ROLES, can } from '@/lib/auth/permissions'
import type { HelpContent, HelpDiagram } from '@/lib/help/types'

/**
 * The guide's diagrams, drawn in the board's own single-line vocabulary: buses
 * (2px boxes), breakers (filled = closed) and 2px lines in a state colour.
 * The words are real text; the drawing itself is hidden from screen readers.
 */
export function Diagram({ diagram, labels }: { diagram: HelpDiagram; labels: HelpContent['diagrams'] }) {
  switch (diagram) {
    case 'workflow':
      return <WorkflowDiagram labels={labels.workflow} />
    case 'pipeline':
      return <PipelineDiagram labels={labels.pipeline} />
    case 'architecture':
      return <ArchitectureDiagram labels={labels.architecture} />
    case 'secrets':
      return <SecretsDiagram labels={labels.secrets} />
    case 'roles':
      return <RolesMatrix labels={labels.roles} />
    case 'environments':
      return <EnvironmentsDiagram labels={labels.environments} />
  }
}

const Line = ({ className, dashed, tone = 'live' }: { className?: string; dashed?: boolean; tone?: 'live' | 'held' | 'paused' }) => (
  <span
    aria-hidden
    className={cn(
      'block shrink-0',
      tone === 'live' ? 'text-live' : tone === 'held' ? 'text-held' : 'text-paused',
      dashed ? 'bg-[repeating-linear-gradient(90deg,currentColor_0_5px,transparent_5px_9px)]' : 'bg-current',
      className,
    )}
  />
)

const VLine = ({ className, dashed, tone = 'live' }: { className?: string; dashed?: boolean; tone?: 'live' | 'held' | 'paused' }) => (
  <span
    aria-hidden
    className={cn(
      'block w-0.5 shrink-0',
      tone === 'live' ? 'text-live' : tone === 'held' ? 'text-held' : 'text-paused',
      dashed ? 'bg-[repeating-linear-gradient(180deg,currentColor_0_5px,transparent_5px_9px)]' : 'bg-current',
      className,
    )}
  />
)

/**
 * A directed connection: a horizontal line and arrowhead from md up, a vertical
 * one below md (drawn, not rotated, so it takes its real space next to labels).
 */
function Connector({ dashed, back }: { dashed?: boolean; back?: boolean }) {
  return (
    <span aria-hidden className="flex flex-col items-center text-live md:flex-row">
      {back && <ArrowRight className="-mr-1 hidden size-3.5 rotate-180 md:block" />}
      {back && <ArrowDown className="-mb-1 size-3.5 rotate-180 md:hidden" />}
      <Line dashed={dashed} className="hidden h-0.5 w-8 md:block" />
      <VLine dashed={dashed} className="h-5 md:hidden" />
      {!back && <ArrowRight className="-ml-1 hidden size-3.5 md:block" />}
      {!back && <ArrowDown className="-mt-1 size-3.5 md:hidden" />}
    </span>
  )
}

const Bus = ({ className }: { className?: string }) => <span aria-hidden className={cn('block h-4 w-1.5 shrink-0 border-2 border-current text-live', className)} />

/** Connect → Build → Operate → Govern → Deliver, as one energised line. Vertical on phones. */
function WorkflowDiagram({ labels }: { labels: HelpContent['diagrams']['workflow'] }) {
  const last = labels.stages.length - 1
  return (
    <ol className="flex flex-col md:flex-row">
      {labels.stages.map((stage, i) => (
        <li key={stage.title} className="flex min-w-0 flex-1 gap-3 md:flex-col md:gap-0">
          {/* Drawing: vertical on phones, horizontal from md. */}
          <div aria-hidden className="flex w-3 shrink-0 flex-col items-center md:h-4 md:w-auto md:flex-row">
            {i === 0 ? <Bus className="hidden md:block" /> : <Line className="hidden h-0.5 flex-1 md:block" />}
            {i === 0 ? <Bus className="h-1.5 w-4 md:hidden" /> : <VLine className="h-3 md:hidden" />}
            <Breaker state="live" className="size-3" />
            {i === last ? <Bus className="hidden md:block" /> : <Line className="hidden h-0.5 flex-1 md:block" />}
            {i === last ? <Bus className="h-1.5 w-4 md:hidden" /> : <VLine className="min-h-6 flex-1 md:hidden" />}
          </div>
          <div className="min-w-0 pb-4 md:px-2 md:pt-3 md:pb-0 md:text-center">
            <p className="text-sm font-semibold">{stage.title}</p>
            <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{stage.body}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Steps on one live line; a held branch drops from Validate and Rules to the quarantine and replays back up. */
function PipelineDiagram({ labels }: { labels: HelpContent['diagrams']['pipeline'] }) {
  const holds = (i: number) => i === 2 || i === 3
  return (
    <div>
      <ol className="grid gap-2 md:grid-cols-5 md:gap-0">
        {labels.steps.map((step, i) => (
          <li key={step.title} className="flex min-w-0 flex-col">
            <div className="flex items-center">
              <Line className={cn('hidden h-0.5 flex-1 md:block', i === 0 && 'invisible')} />
              <div className={cn('min-w-0 flex-1 rounded-sm border border-border bg-background px-2.5 py-2 md:flex-[0_1_9.5rem]', holds(i) && 'border-held/60')}>
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Breaker state="live" />
                  {step.title}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={step.body}>
                  {step.body}
                </p>
              </div>
              <Line className={cn('hidden h-0.5 flex-1 md:block', i === labels.steps.length - 1 && 'invisible')} />
            </div>
            {holds(i) && <VLine tone="held" dashed className="mx-auto hidden h-6 md:block" />}
          </li>
        ))}
      </ol>
      <div className="mt-2 grid md:mt-0 md:grid-cols-5">
        <div className="flex items-center gap-2 rounded-sm border border-held/60 bg-held-soft px-3 py-2 text-sm md:col-span-2 md:col-start-3 md:mx-4">
          <Breaker state="held" />
          <span className="font-medium text-held-text">{labels.quarantine}</span>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-held-text md:col-span-2 md:col-start-3 md:mx-4 md:justify-center">
          <RotateCcw className="size-3.5" aria-hidden />
          {labels.replay}
        </p>
      </div>
    </div>
  )
}

function Box({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-sm border border-border bg-background px-3 py-2 text-sm', className)}>{children}</div>
}

/** Network → Agent ⇢ Nexus → consumers. Only outbound arrows leave the company network. */
function ArchitectureDiagram({ labels }: { labels: HelpContent['diagrams']['architecture'] }) {
  const Arrow = ({ label }: { label?: string }) => (
    <div className="flex flex-col items-center justify-center gap-1 py-1 md:px-1 md:py-0">
      <Connector />
      {label && <span className="font-mono text-[11px] text-muted-foreground md:max-w-24 md:text-center">{label}</span>}
    </div>
  )
  return (
    <div className="grid items-stretch gap-1 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
      <div className="rounded-sm border-2 border-dashed border-paused p-3">
        <p className="text-xs font-medium text-muted-foreground">{labels.network}</p>
        <div className="mt-2 space-y-1.5">
          <Box>{labels.systems}</Box>
          <div aria-hidden className="flex justify-center">
            <VLine className="h-3" />
          </div>
          <Box className="flex items-center gap-2 font-medium">
            <Breaker state="live" />
            {labels.agent}
          </Box>
        </div>
      </div>
      <Arrow label={labels.outbound} />
      <div className="rounded-sm border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">{labels.cloud}</p>
        <div className="mt-2 space-y-1.5">
          <Box className="flex items-center gap-2 border-live/50 font-medium">
            <Breaker state="live" />
            {labels.nexus}
          </Box>
          <Box className="flex items-center gap-2 text-muted-foreground">
            <KeyRound className="size-3.5 shrink-0" aria-hidden />
            {labels.secrets}
          </Box>
          <Box className="text-muted-foreground">{labels.direct}</Box>
        </div>
      </div>
      <Arrow />
      <div className="rounded-sm border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">{labels.consumers}</p>
        <div className="mt-2 space-y-1.5">
          <Box className="font-medium">{labels.products}</Box>
          <Box>{labels.api}</Box>
        </div>
      </div>
    </div>
  )
}

/** A data source holds only the reference; the value travels from the manager at connect time. */
function SecretsDiagram({ labels }: { labels: HelpContent['diagrams']['secrets'] }) {
  return (
    <div className="space-y-3">
      <div className="grid items-center gap-2 md:grid-cols-[minmax(0,1.6fr)_auto_minmax(0,1fr)]">
        <Box>
          <p className="font-medium">{labels.source}</p>
          <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">{labels.reference}</p>
        </Box>
        <div className="flex flex-col items-center gap-1 px-2">
          <Connector dashed back />
          <span className="max-w-40 text-center font-mono text-[11px] text-muted-foreground">{labels.connect}</span>
        </div>
        <Box className="flex items-center gap-2 font-medium">
          <KeyRound className="size-4 shrink-0 text-live-text" aria-hidden />
          {labels.manager}
        </Box>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        {labels.note}
      </p>
    </div>
  )
}

/**
 * Development → Staging → Production: one workspace per stage, each with its own
 * sources; Promote moves the published version one stage forward. Production is
 * locked (open breaker + lock): it changes only by promotion.
 */
function EnvironmentsDiagram({ labels }: { labels: HelpContent['diagrams']['environments'] }) {
  const last = labels.stages.length - 1
  return (
    <ol className="grid items-stretch gap-1 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
      {labels.stages.map((stage, i) => (
        <Fragment key={stage.title}>
          <li className={cn('flex min-w-0 flex-col rounded-sm border bg-background p-3', i === last ? 'border-live/60' : 'border-border')}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              {i === last ? <Lock className="size-3.5 shrink-0 text-live-text" aria-hidden /> : <Breaker state="live" />}
              {stage.title}
            </p>
            <p className="mt-1 text-xs text-pretty text-muted-foreground">{stage.body}</p>
            <p className={cn('mt-auto pt-2 font-mono text-[11px]', i === last ? 'text-live-text' : 'text-muted-foreground')}>{stage.note}</p>
          </li>
          {i < last && (
            <li className="flex flex-col items-center justify-center gap-1 px-2 py-1 md:py-0">
              <span className="text-xs font-medium text-live-text">{labels.promote}</span>
              <Connector />
              <span className="max-w-32 text-center font-mono text-[11px] leading-4 text-muted-foreground">{i === last - 1 ? labels.approval : labels.matches}</span>
            </li>
          )}
        </Fragment>
      ))}
    </ol>
  )
}

/** The permission matrix from lib/auth/permissions.ts, drawn as breakers: closed = can, open = cannot. */
function RolesMatrix({ labels }: { labels: HelpContent['diagrams']['roles'] }) {
  const t = useT()
  return (
    <div>
      <p className="mb-3 flex gap-5" aria-hidden>
        <StateMark state="live">{t('tour.page.roleCan')}</StateMark>
        <StateMark state="idle">{t('tour.page.roleCannot')}</StateMark>
      </p>
      <div className="relative -mx-5 overflow-x-auto border-t border-border">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="h-9 bg-muted/60">
            <th scope="col" className="sticky left-0 bg-muted px-4 text-left font-mono text-[11px] font-medium tracking-[0.025em] text-muted-foreground uppercase">
              {labels.permission}
            </th>
            {ROLES.map((role) => (
              <th key={role} scope="col" className="px-2 text-center font-mono text-[11px] font-medium tracking-[0.025em] whitespace-nowrap text-muted-foreground uppercase">
                {t(`ws.roles.${role}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSIONS.map((p) => (
            <tr key={p} className="border-t border-border">
              <th scope="row" className="sticky left-0 bg-card px-4 py-2 text-left font-normal">
                {labels.permissions[p]}
              </th>
              {ROLES.map((role) => {
                const yes = can(role, p)
                return (
                  <td key={role} className="px-2 py-2 text-center">
                    <Breaker state={yes ? 'live' : 'idle'} className="align-middle" />
                    <span className="sr-only">{yes ? t('tour.page.roleCan') : t('tour.page.roleCannot')}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
