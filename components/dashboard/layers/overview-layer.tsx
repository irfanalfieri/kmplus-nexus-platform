'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { Breaker } from '@/components/ui/flow-line'
import { PageHeader } from '@/components/dashboard/page-header'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { getOverview } from '@/lib/actions/monitoring'
import { useWorkspace } from '@/components/workspace/workspace-context'
import { ROLE_INFO } from '@/lib/auth/permissions'
import { formatWhen } from '@/components/pipelines/run-history'

type Overview = Awaited<ReturnType<typeof getOverview>>

const href = (tab: string) => `/dashboard/${tab}`

export default function OverviewLayer() {
  const { t } = usePrefs()
  const { workspace, role, user } = useWorkspace()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getOverview().then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load overview'))
  }, [])

  const header = (
    <PageHeader
      title={t('pages.overview.title')}
      description={t('pages.overview.description')}
      meta={`Welcome${user.name ? `, ${user.name.split(' ')[0]}` : ''} · ${workspace.name} · you are ${ROLE_INFO[role].label.toLowerCase()}`}
    />
  )

  if (error) {
    return (
      <div>
        {header}
        <Notice tone="danger">{error}</Notice>
      </div>
    )
  }
  if (!data) {
    return (
      <div>
        {header}
        <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-sm text-muted-foreground" role="status">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Loading overview…
        </div>
      </div>
    )
  }

  const doneSteps = data.checklist.filter((s) => s.done).length
  const tiles = [
    { label: 'Pipelines', value: data.pipelines.total.toLocaleString(), sub: `${data.pipelines.scheduled} scheduled`, tab: 'pipelines' },
    { label: 'Data sources', value: data.sources.total.toLocaleString(), sub: `${data.sources.connected} connected`, tab: 'sources' },
    { label: 'Runs · 24h', value: data.last24h.runs.toLocaleString(), sub: data.last24h.failed ? `${data.last24h.failed} failed` : 'none failed', tab: 'monitoring', alert: data.last24h.failed > 0 },
    { label: 'Rows written · 24h', value: data.last24h.written.toLocaleString(), sub: `${data.datasets.count} dataset${data.datasets.count === 1 ? '' : 's'} · ${data.datasets.rows.toLocaleString()} rows`, tab: 'monitoring' },
  ]

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={href(tile.tab)}
            className="group bg-card px-4 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <div className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{tile.label}</div>
            <div className="mt-1 font-mono text-3xl leading-10 tabular-nums">{tile.value}</div>
            <div className={cn('mt-0.5 flex items-center gap-1.5 text-xs', tile.alert ? 'font-medium text-danger-text' : 'text-muted-foreground')}>
              {tile.alert && <XCircle className="size-3.5 text-danger" aria-hidden />}
              {tile.sub}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="overview-checklist">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="overview-checklist" className="text-base font-semibold">
              Getting started
            </h2>
            <span className="font-mono text-xs text-muted-foreground">
              {doneSteps} of {data.checklist.length} done
            </span>
          </div>
          <ol className="space-y-0.5">
            {data.checklist.map((step, i) => (
              <li key={step.key}>
                <Link
                  href={href(step.tab)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Breaker state={step.done ? 'live' : 'idle'} />
                  <span className="sr-only">{step.done ? 'Done:' : 'To do:'}</span>
                  <span className={step.done ? 'text-muted-foreground line-through' : 'font-medium'}>
                    <span className="font-mono text-xs text-muted-foreground">{i + 1}.</span> {step.label}
                  </span>
                  <span className={cn('ml-auto text-xs', step.done ? 'text-live-text' : 'text-muted-foreground')} aria-hidden>
                    {step.done ? 'Done' : 'To do'}
                  </span>
                  {!step.done && <ArrowRight className="size-4 text-muted-foreground" aria-hidden />}
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="overview-attention">
          <h2 id="overview-attention" className="mb-3 text-base font-semibold">
            Needs attention
          </h2>
          {data.attention.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="size-5 text-live" aria-hidden /> No failing or rejecting pipelines.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.attention.map((p) => {
                const failed = p.lastRunStatus === 'failed'
                return (
                  <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className={cn('flex w-32 shrink-0 items-center gap-1.5 text-xs font-medium', failed ? 'text-danger-text' : 'text-warning-text')}>
                      {failed ? <XCircle className="size-4 text-danger" aria-hidden /> : <AlertTriangle className="size-4 text-warning" aria-hidden />}
                      {failed ? 'Failed' : 'Rejected rows'}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatWhen(p.lastRunAt)}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <Link href={href('monitoring')} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3')}>
            Open monitoring <ArrowRight aria-hidden />
          </Link>
        </section>
      </div>
    </div>
  )
}
