'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Circle, Clock, Database, History, Loader2, PauseCircle, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getMonitoringOverview, type PipelineHealth } from '@/app/actions/monitoring'
import { getDatasetPreview } from '@/app/actions/pipelines'
import RunHistory, { formatWhen, statusBadge } from '@/components/pipelines/run-history'
import { SampleTable } from '@/components/pipelines/pipeline-editor'
import { useCan } from '@/components/workspace/workspace-context'

type Overview = Awaited<ReturnType<typeof getMonitoringOverview>>

// Status palette (reserved for state; always paired with an icon + label).
const STATUS = {
  success: { color: '#0ca30c', label: 'Success' },
  partial: { color: '#fab219', label: 'Partial (rows rejected)' },
  failed: { color: '#d03b3b', label: 'Failed' },
} as const

const HEALTH: Record<PipelineHealth, { label: string; icon: typeof CheckCircle2; className: string }> = {
  healthy: { label: 'Healthy', icon: CheckCircle2, className: 'text-green-700 dark:text-green-400' },
  warning: { label: 'Rejected rows', icon: AlertTriangle, className: 'text-amber-700 dark:text-amber-300' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-destructive' },
  delayed: { label: 'Delayed', icon: Clock, className: 'text-amber-700 dark:text-amber-300' },
  paused: { label: 'Paused', icon: PauseCircle, className: 'text-muted-foreground' },
  never_run: { label: 'Never run', icon: Circle, className: 'text-muted-foreground' },
}

const REFRESH_MS = 30_000

export default function SchedulerMonitoringLayer() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string; version: number } | null>(null)
  const [preview, setPreview] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null)
  const canPreview = useCan('data:preview')

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      setData(await getMonitoringOverview())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitoring data')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const openPreview = async (name: string) => {
    try {
      const res = await getDatasetPreview(name)
      setPreview({ name, rows: res.rows })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    }
  }

  const versionOf = (id: string) => data?.health.find((h) => h.id === id)?.version ?? 1

  return (
    <div className="space-y-6">
      {historyFor && (
        <RunHistory
          pipelineId={historyFor.id}
          pipelineName={historyFor.name}
          currentVersion={historyFor.version}
          onClose={() => setHistoryFor(null)}
          onRestored={load}
        />
      )}

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <Badge variant="outline">Layer 6</Badge>
            </div>
            <h2 className="text-2xl font-bold">Monitoring</h2>
            <p className="mt-1 text-muted-foreground">Pipeline health, run outcomes and produced datasets. Refreshes every 30 seconds.</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {!data ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card p-10 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading monitoring data…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <Tile label="Runs today · success" value={data.today.success} />
            <Tile label="Runs today · partial" value={data.today.partial} />
            <Tile label="Runs today · failed" value={data.today.failed} emphasis={data.today.failed > 0} />
            <Tile label="Running now" value={data.today.running} />
            <Tile label="Rows written · 24h" value={data.rowsWritten24h.toLocaleString()} />
            <Tile label="Rows rejected · 24h" value={data.rowsRejected24h.toLocaleString()} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <RunTrend trend={data.trend} />

            <section className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-semibold">Pipeline health</h3>
              <p className="mb-3 text-sm text-muted-foreground">Problems first. Success rate covers the last 7 days.</p>
              {data.health.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No pipelines yet. Create one in the Pipelines tab.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.health.map((h) => {
                    const meta = HEALTH[h.state]
                    const Icon = meta.icon
                    return (
                      <li key={h.id} className="flex flex-wrap items-center gap-3 py-2.5">
                        <span className={`flex w-32 items-center gap-1.5 text-sm font-medium ${meta.className}`}>
                          <Icon className="h-4 w-4" aria-hidden /> {meta.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{h.name}</div>
                          <div className="truncate text-xs text-muted-foreground" title={h.reason}>
                            {h.reason || (h.scheduled ? `Next ${formatWhen(h.nextRunAt)}` : 'Manual')} · last {formatWhen(h.lastRunAt)}
                          </div>
                        </div>
                        <span className="w-20 text-right text-xs text-muted-foreground">
                          {h.successRate7d === null ? '—' : `${h.successRate7d}% of ${h.runs7d}`}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => setHistoryFor({ id: h.id, name: h.name, version: h.version })}>
                          <History className="mr-1 h-4 w-4" /> History
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 font-semibold">Recent runs</h3>
            {data.recentRuns.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No runs in the last 7 days.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="px-2 py-2">Started</th>
                      <th className="px-2 py-2">Pipeline</th>
                      <th className="px-2 py-2">Trigger</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2 text-right">Read</th>
                      <th className="px-2 py-2 text-right">Written</th>
                      <th className="px-2 py-2 text-right">Rejected</th>
                      <th className="px-2 py-2 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentRuns.map((r) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer border-b border-border/60 hover:bg-muted/40"
                        onClick={() => setHistoryFor({ id: r.pipelineId, name: r.pipelineName, version: versionOf(r.pipelineId) })}
                        title={r.errorMessage ?? 'Open run history'}
                      >
                        <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{formatWhen(r.startTime)}</td>
                        <td className="px-2 py-2 font-medium">{r.pipelineName}</td>
                        <td className="px-2 py-2 text-muted-foreground">{r.trigger}</td>
                        <td className="px-2 py-2">{statusBadge(r.status)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{(r.recordsProcessed ?? 0).toLocaleString()}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{(r.recordsSuccess ?? 0).toLocaleString()}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{(r.recordsError ?? 0).toLocaleString()}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{r.duration != null ? `${r.duration}s` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Produced datasets</h3>
            </div>
            {data.datasets.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Pipelines that write to a Nexus dataset will show their output here.</p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {data.datasets.map((d) => (
                  <button
                    key={d.name}
                    onClick={() => void openPreview(d.name)}
                    disabled={!canPreview}
                    title={canPreview ? undefined : 'Your role cannot view dataset contents'}
                    className={`rounded-lg border p-3 text-left text-sm hover:bg-muted/40 ${preview?.name === d.name ? 'border-primary' : 'border-border'}`}
                  >
                    <div className="font-mono font-medium">{d.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {(d.rowCount ?? 0).toLocaleString()} rows · {d.columnCount} columns · loaded {formatWhen(d.lastLoadedAt)}
                      {d.pipelineName ? ` · by ${d.pipelineName}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {preview && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    Latest rows in <span className="font-mono">{preview.name}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Close</Button>
                </div>
                {preview.rows.length ? <SampleTable rows={preview.rows} /> : <p className="text-sm text-muted-foreground">The dataset is empty.</p>}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, emphasis }: { label: string; value: number | string; emphasis?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card p-4 ${emphasis ? 'border-destructive/50' : 'border-border'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

/** Stacked columns: runs per day by outcome (last 7 days, WIB). */
function RunTrend({ trend }: { trend: Overview['trend'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const max = useMemo(() => Math.max(1, ...trend.map((t) => t.success + t.partial + t.failed)), [trend])
  const ticks = useMemo(() => {
    const step = Math.max(1, Math.ceil(max / 4))
    return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  }, [max])
  const top = ticks[ticks.length - 1] || 1
  const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
  const H = 160

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Runs per day</h3>
          <p className="text-sm text-muted-foreground">Last 7 days, by outcome</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)}>{asTable ? 'Show chart' : 'Show table'}</Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden={asTable}>
        {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: STATUS[k].color }} />
            {STATUS[k].label}
          </span>
        ))}
      </div>

      {asTable ? (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="py-1.5">Day</th>
              <th className="text-right">Success</th>
              <th className="text-right">Partial</th>
              <th className="text-right">Failed</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((t) => (
              <tr key={t.day} className="border-b border-border/60">
                <td className="py-1.5">{dayLabel(t.day)}</td>
                <td className="text-right tabular-nums">{t.success}</td>
                <td className="text-right tabular-nums">{t.partial}</td>
                <td className="text-right tabular-nums">{t.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative mt-4 flex gap-2" role="img" aria-label={`Runs per day: ${trend.map((t) => `${dayLabel(t.day)} ${t.success} success, ${t.partial} partial, ${t.failed} failed`).join('; ')}`}>
          <div className="flex flex-col justify-between text-right text-[10px] tabular-nums text-muted-foreground" style={{ height: H }}>
            {[...ticks].reverse().map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: H }}>
              {ticks.map((t) => (
                <div key={t} className="border-t border-border/50" />
              ))}
            </div>
            <div className="relative flex items-end gap-2" style={{ height: H }}>
              {trend.map((t, i) => {
                const total = t.success + t.partial + t.failed
                return (
                  <div
                    key={t.day}
                    className="relative flex h-full flex-1 flex-col justify-end"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {/* Stack bottom → top: success, partial, failed; 2px surface gaps between segments. */}
                    <div className="mx-auto flex w-full max-w-[36px] flex-col-reverse gap-[2px]">
                      {(['success', 'partial', 'failed'] as const)
                        .filter((k) => t[k] > 0)
                        .map((k, idx, arr) => (
                          <div
                            key={k}
                            style={{ height: Math.max(2, (t[k] / top) * H - 2), background: STATUS[k].color, opacity: hover === null || hover === i ? 1 : 0.45 }}
                            className={idx === arr.length - 1 ? 'rounded-t-[4px]' : ''}
                          />
                        ))}
                    </div>
                    {hover === i && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-36 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-xs shadow-md">
                        <div className="mb-1 font-medium">{dayLabel(t.day)} · {total} run{total === 1 ? '' : 's'}</div>
                        {(['success', 'partial', 'failed'] as const).map((k) => (
                          <div key={k} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS[k].color }} />
                              {k}
                            </span>
                            <span className="tabular-nums">{t[k]}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-1 flex gap-2">
              {trend.map((t) => (
                <span key={t.day} className="flex-1 text-center text-[10px] text-muted-foreground">
                  {dayLabel(t.day)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
