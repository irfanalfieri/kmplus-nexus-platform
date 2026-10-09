'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getOverview } from '@/app/actions/monitoring'
import { useWorkspace } from '@/components/workspace/workspace-context'
import { ROLE_INFO } from '@/lib/auth/permissions'
import { formatWhen } from '@/components/pipelines/run-history'

type Overview = Awaited<ReturnType<typeof getOverview>>

export default function OverviewLayer({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { workspace, role, user } = useWorkspace()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getOverview().then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load overview'))
  }, [])

  if (error) return <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
  if (!data) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading overview…
      </div>
    )
  }

  const doneSteps = data.checklist.filter((s) => s.done).length
  const tiles = [
    { label: 'Pipelines', value: data.pipelines.total, sub: `${data.pipelines.scheduled} scheduled`, tab: 'pipelines' },
    { label: 'Data sources', value: data.sources.total, sub: `${data.sources.connected} connected`, tab: 'sources' },
    { label: 'Runs · 24h', value: data.last24h.runs, sub: data.last24h.failed ? `${data.last24h.failed} failed` : 'none failed', tab: 'monitoring', alert: data.last24h.failed > 0 },
    { label: 'Rows written · 24h', value: data.last24h.written.toLocaleString(), sub: `${data.datasets.count} dataset${data.datasets.count === 1 ? '' : 's'} · ${data.datasets.rows.toLocaleString()} rows`, tab: 'monitoring' },
  ]

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-2xl font-bold">Welcome{user.name ? `, ${user.name.split(' ')[0]}` : ''}</h2>
        <p className="mt-1 text-muted-foreground">
          {workspace.name} · you are {ROLE_INFO[role].label.toLowerCase()}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <button key={t.label} onClick={() => onNavigate(t.tab)} className={`rounded-xl border bg-card p-4 text-left hover:bg-muted/40 ${t.alert ? 'border-destructive/50' : 'border-border'}`}>
            <div className="text-sm text-muted-foreground">{t.label}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{t.value}</div>
            <div className={`mt-1 text-xs ${t.alert ? 'text-destructive' : 'text-muted-foreground'}`}>{t.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Getting started</h3>
            <span className="text-sm text-muted-foreground">
              {doneSteps} of {data.checklist.length} done
            </span>
          </div>
          <ol className="space-y-1">
            {data.checklist.map((step, i) => (
              <li key={step.key}>
                <button onClick={() => onNavigate(step.tab)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted/40">
                  {step.done ? <CheckCircle2 className="h-5 w-5 text-green-600" aria-label="Done" /> : <Circle className="h-5 w-5 text-muted-foreground" aria-label="To do" />}
                  <span className={step.done ? 'text-muted-foreground line-through' : 'font-medium'}>
                    {i + 1}. {step.label}
                  </span>
                  {!step.done && <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-3 font-semibold">Needs attention</h3>
          {data.attention.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 text-green-600" /> No failing or rejecting pipelines.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.attention.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                  {p.lastRunStatus === 'failed' ? (
                    <XCircle className="h-4 w-4 text-destructive" aria-label="Failed" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Rejected rows" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.lastRunStatus === 'failed' ? 'Failed' : 'Rejected rows'} · {formatWhen(p.lastRunAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" size="sm" className="mt-3" onClick={() => onNavigate('monitoring')}>
            Open monitoring <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </section>
      </div>
    </div>
  )
}
