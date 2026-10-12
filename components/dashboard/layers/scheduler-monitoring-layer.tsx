'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Clock, Database, History, Loader2, RefreshCw, RotateCcw, Square, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { StateMark, type FlowState } from '@/components/ui/flow-line'
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/data-table'
import { useConfirm } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { PageHeader } from '@/components/dashboard/page-header'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { getMonitoringOverview, type PipelineHealth } from '@/lib/actions/monitoring'
import { cancelPipelineRun, getDatasetPreview, retryPipelineRun } from '@/lib/actions/pipelines'
import RunHistory, { formatWhen } from '@/components/pipelines/run-history'
import { SampleTable } from '@/components/pipelines/pipeline-editor'
import { useCan } from '@/components/workspace/workspace-context'

type Overview = Awaited<ReturnType<typeof getMonitoringOverview>>

// Run outcomes in the chart: state colours, always paired with a label (legend + table view).
const STATUS = {
  success: { bar: 'bg-live', label: 'Success' },
  partial: { bar: 'bg-warning', label: 'Partial (rows rejected)' },
  failed: { bar: 'bg-danger', label: 'Failed' },
} as const

type HealthMeta = { label: string } & ({ state: FlowState } | { warning: typeof AlertTriangle })
const HEALTH: Record<PipelineHealth, HealthMeta> = {
  healthy: { label: 'Healthy', state: 'live' },
  warning: { label: 'Rejected rows', warning: AlertTriangle },
  failed: { label: 'Failed', state: 'tripped' },
  delayed: { label: 'Delayed', warning: Clock },
  paused: { label: 'Paused', state: 'paused' },
  never_run: { label: 'Never run', state: 'idle' },
}

function HealthMark({ health }: { health: PipelineHealth }) {
  const meta = HEALTH[health]
  if ('state' in meta) return <StateMark state={meta.state}>{meta.label}</StateMark>
  const Icon = meta.warning
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap text-warning-text">
      <Icon className="size-3.5 text-warning" aria-hidden />
      {meta.label}
    </span>
  )
}

/** A run's status as breaker + words. */
function RunState({ status }: { status: string | null | undefined }) {
  const [state, label]: [FlowState, string] =
    status === 'success'
      ? ['live', 'Succeeded']
      : status === 'partial'
        ? ['tripped', 'Partial']
        : status === 'failed'
          ? ['tripped', 'Failed']
          : status === 'running'
            ? ['running', 'Running']
            : status === 'queued'
              ? ['idle', 'Queued']
              : status === 'cancelled'
                ? ['paused', 'Cancelled']
                : ['idle', 'Never run']
  return <StateMark state={state}>{label}</StateMark>
}

const REFRESH_MS = 30_000

export default function SchedulerMonitoringLayer() {
  const { t } = usePrefs()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string; version: number } | null>(null)
  const [preview, setPreview] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null)
  const canPreview = useCan('data:preview')
  const canRun = useCan('pipelines:run')
  const [acting, setActing] = useState<string | null>(null)
  const [confirm, confirmEl] = useConfirm()
  const toast = useToast()

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

  const runAction = async (key: string, fn: () => Promise<{ message: string }>) => {
    setActing(key)
    setError('')
    try {
      toast({ message: (await fn()).message })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActing(null)
    }
  }

  const cancelJob = async (job: { id: string; pipelineName: string }) => {
    const ok = await confirm({
      title: `Cancel the run of ${job.pipelineName}?`,
      description: 'A queued run is cancelled at once; a running one stops after the chunk it is writing now.',
      confirmLabel: 'Cancel run',
      cancelLabel: 'Keep running',
      tone: 'danger',
    })
    if (ok) await runAction(`cancel:${job.id}`, () => cancelPipelineRun(job.id))
  }

  const retryRun = async (run: { id: string; pipelineName: string }) => {
    const ok = await confirm({
      title: `Run ${run.pipelineName} again?`,
      description: 'A new run of the current published version is queued.',
      confirmLabel: 'Retry run',
    })
    if (ok) await runAction(`retry:${run.id}`, () => retryPipelineRun(run.id))
  }

  useEffect(() => {
    void load()
  }, [load])

  // Faster refresh while background runs are in progress.
  const busy = (data?.jobs.length ?? 0) > 0
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, busy ? 5_000 : REFRESH_MS)
    return () => clearInterval(timer)
  }, [load, busy])

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
      {confirmEl}
      {historyFor && (
        <RunHistory
          pipelineId={historyFor.id}
          pipelineName={historyFor.name}
          currentVersion={historyFor.version}
          onClose={() => setHistoryFor(null)}
          onRestored={load}
        />
      )}

      <PageHeader
        title={t('pages.monitoring.title')}
        description={t('pages.monitoring.description')}
        meta="Pipeline health, run outcomes and produced datasets · refreshes every 30 seconds"
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden /> {t('common.refresh')}
          </Button>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {!data ? (
        !error && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-sm text-muted-foreground" role="status">
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Loading monitoring data…
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Runs today · success" value={data.today.success} />
            <Stat label="Runs today · partial" value={data.today.partial} />
            <Stat label="Runs today · failed" value={data.today.failed} danger={data.today.failed > 0} />
            <Stat label="Running now" value={data.today.running} />
            <Stat label="Rows written · 24h" value={data.rowsWritten24h.toLocaleString()} />
            <Stat label="Rows rejected · 24h" value={data.rowsRejected24h.toLocaleString()} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <RunTrend trend={data.trend} />

            <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="mon-health">
              <h2 id="mon-health" className="text-base font-semibold">
                Pipeline health
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">Problems first. Success rate covers the last 7 days.</p>
              {data.health.length === 0 ? (
                <EmptyState compact icon={<Activity />} title="No pipelines yet">
                  Create one in Pipelines.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-border">
                  {data.health.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="w-32">
                        <HealthMark health={h.state} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{h.name}</div>
                        <div className="truncate text-xs text-muted-foreground" title={h.reason}>
                          {h.reason || (h.scheduled ? `Next ${formatWhen(h.nextRunAt)}` : 'Manual')} · last {formatWhen(h.lastRunAt)}
                        </div>
                      </div>
                      <span className="w-20 text-right font-mono text-xs text-muted-foreground">{h.successRate7d === null ? '—' : `${h.successRate7d}% of ${h.runs7d}`}</span>
                      <Button size="sm" variant="ghost" onClick={() => setHistoryFor({ id: h.id, name: h.name, version: h.version })} aria-label={`Run history of ${h.name}`}>
                        <History aria-hidden /> History
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {data.jobs.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="mon-jobs" aria-live="polite">
              <h2 id="mon-jobs" className="text-base font-semibold">
                Background runs
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">Runs execute in chunks of 5,000 rows in the background worker and survive restarts. This list refreshes every 5 seconds.</p>
              <ul className="divide-y divide-border">
                {data.jobs.map((j) => {
                  const retrying = j.status === 'queued' && j.attempts > 0
                  const cancelling = j.status === 'cancelling'
                  return (
                    <li key={j.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <span className="w-28">
                        <StateMark state={cancelling ? 'paused' : j.status === 'running' ? 'running' : 'idle'}>{cancelling ? 'Cancelling' : j.status === 'running' ? 'Running' : retrying ? 'Retrying' : 'Queued'}</StateMark>
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{j.pipelineName}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {j.rowsRead.toLocaleString()} read · {j.rowsWritten.toLocaleString()} written{j.chunks ? ` · ${j.chunks} chunk${j.chunks === 1 ? '' : 's'}` : ''}
                      </span>
                      <span className="w-48 text-right font-mono text-xs text-muted-foreground">
                        {retrying ? `attempt ${j.attempts + 1} at ${formatWhen(j.availableAt)}` : `${j.trigger} · queued ${formatWhen(j.createdAt)}`}
                      </span>
                      {canRun && !cancelling && (
                        <Button size="sm" variant="outline" disabled={acting !== null} onClick={() => void cancelJob(j)} aria-label={`Cancel the run of ${j.pipelineName}`}>
                          {acting === `cancel:${j.id}` ? <Loader2 className="animate-spin" aria-hidden /> : <Square aria-hidden />}
                          Cancel
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <section className="rounded-lg border border-border bg-card" aria-labelledby="mon-runs">
            <h2 id="mon-runs" className="px-5 pt-5 pb-3 text-base font-semibold">
              Recent runs
            </h2>
            {data.recentRuns.length === 0 ? (
              <EmptyState compact icon={<History />} title="No runs in the last 7 days" />
            ) : (
              <Table label="Recent runs" className="min-w-[760px]">
                <THead>
                  <tr>
                    <Th>Started</Th>
                    <Th>Pipeline</Th>
                    <Th>Trigger</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Read</Th>
                    <Th className="text-right">Written</Th>
                    <Th className="text-right">Rejected</Th>
                    <Th className="text-right">Duration</Th>
                    {canRun && (
                      <Th>
                        <span className="sr-only">Actions</span>
                      </Th>
                    )}
                  </tr>
                </THead>
                <TBody>
                  {data.recentRuns.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatWhen(r.startTime)}</Td>
                      <Td className="max-w-xs">
                        <button
                          type="button"
                          className="rounded-sm text-left font-medium outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          onClick={() => setHistoryFor({ id: r.pipelineId, name: r.pipelineName, version: versionOf(r.pipelineId) })}
                        >
                          {r.pipelineName}
                          <span className="sr-only"> — open run history</span>
                        </button>
                        {r.errorMessage && (
                          <p className="truncate text-xs text-danger-text" title={r.errorMessage}>
                            {r.errorMessage}
                          </p>
                        )}
                      </Td>
                      <Td className="font-mono text-xs text-muted-foreground">{r.trigger}</Td>
                      <Td>
                        <RunState status={r.status} />
                      </Td>
                      <Td className="text-right font-mono">{(r.recordsProcessed ?? 0).toLocaleString()}</Td>
                      <Td className="text-right font-mono">{(r.recordsSuccess ?? 0).toLocaleString()}</Td>
                      <Td className="text-right font-mono">{(r.recordsError ?? 0).toLocaleString()}</Td>
                      <Td className="text-right font-mono">{r.duration != null ? `${r.duration}s` : '—'}</Td>
                      {canRun && (
                        <Td className="text-right">
                          {(r.status === 'failed' || r.status === 'cancelled' || r.status === 'partial') && (
                            <Button size="sm" variant="ghost" disabled={acting !== null} onClick={() => void retryRun(r)} aria-label={`Run ${r.pipelineName} again`}>
                              {acting === `retry:${r.id}` ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
                              Retry
                            </Button>
                          )}
                        </Td>
                      )}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="mon-datasets">
            <h2 id="mon-datasets" className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Database className="size-4 text-primary" aria-hidden />
              Produced datasets
            </h2>
            {data.datasets.length === 0 ? (
              <EmptyState compact icon={<Database />} title="No datasets yet">
                Pipelines that write to a Nexus dataset will show their output here.
              </EmptyState>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {data.datasets.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => void openPreview(d.name)}
                    disabled={!canPreview}
                    aria-pressed={preview?.name === d.name}
                    title={canPreview ? undefined : 'Your role cannot view dataset contents'}
                    className={cn(
                      'rounded-md border p-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:hover:bg-transparent',
                      preview?.name === d.name ? 'border-primary bg-accent text-accent-foreground' : 'border-border',
                    )}
                  >
                    <div className="font-mono font-medium">{d.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{(d.rowCount ?? 0).toLocaleString()}</span> rows · <span className="font-mono">{d.columnCount}</span> columns · loaded {formatWhen(d.lastLoadedAt)}
                      {d.pipelineName ? ` · by ${d.pipelineName}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {preview && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-sm">
                  <h3>
                    Latest rows in <span className="font-mono">{preview.name}</span>
                  </h3>
                  <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                    Close preview
                  </Button>
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

function Stat({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className="bg-card px-4 py-3.5">
      <div className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn('mt-1 flex items-center gap-2 font-mono text-2xl leading-8 tabular-nums', danger && 'text-danger-text')}>
        {danger && <XCircle className="size-4 text-danger" aria-hidden />}
        {value}
      </div>
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
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="mon-trend">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="mon-trend" className="text-base font-semibold">
            Runs per day
          </h2>
          <p className="text-sm text-muted-foreground">Last 7 days, by outcome</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden={asTable}>
        {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn('inline-block size-2.5 rounded-[1px]', STATUS[k].bar)} />
            {STATUS[k].label}
          </span>
        ))}
      </div>

      {asTable ? (
        <Table label="Runs per day" className="mt-4">
          <THead>
            <tr>
              <Th>Day</Th>
              <Th className="text-right">Success</Th>
              <Th className="text-right">Partial</Th>
              <Th className="text-right">Failed</Th>
            </tr>
          </THead>
          <TBody>
            {trend.map((t) => (
              <Tr key={t.day}>
                <Td>{dayLabel(t.day)}</Td>
                <Td className="text-right font-mono">{t.success}</Td>
                <Td className="text-right font-mono">{t.partial}</Td>
                <Td className="text-right font-mono">{t.failed}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <div className="relative mt-4 flex gap-2" role="img" aria-label={`Runs per day: ${trend.map((t) => `${dayLabel(t.day)} ${t.success} success, ${t.partial} partial, ${t.failed} failed`).join('; ')}`}>
          <div className="flex flex-col justify-between text-right font-mono text-[10px] text-muted-foreground tabular-nums" style={{ height: H }}>
            {[...ticks].reverse().map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: H }}>
              {ticks.map((t) => (
                <div key={t} className="border-t border-border/60" />
              ))}
            </div>
            <div className="relative flex items-end gap-2" style={{ height: H }}>
              {trend.map((t, i) => {
                const total = t.success + t.partial + t.failed
                return (
                  <div key={t.day} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    {/* Stack bottom → top: success, partial, failed; 2px surface gaps between segments. */}
                    <div className="mx-auto flex w-full max-w-[36px] flex-col-reverse gap-[2px]">
                      {(['success', 'partial', 'failed'] as const)
                        .filter((k) => t[k] > 0)
                        .map((k, idx, arr) => (
                          <div
                            key={k}
                            style={{ height: Math.max(2, (t[k] / top) * H - 2), opacity: hover === null || hover === i ? 1 : 0.45 }}
                            className={cn(STATUS[k].bar, idx === arr.length - 1 && 'rounded-t-[2px]')}
                          />
                        ))}
                    </div>
                    {hover === i && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-36 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-xs shadow-raised">
                        <div className="mb-1 font-medium">
                          {dayLabel(t.day)} · {total} run{total === 1 ? '' : 's'}
                        </div>
                        {(['success', 'partial', 'failed'] as const).map((k) => (
                          <div key={k} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              <span className={cn('inline-block size-2 rounded-[1px]', STATUS[k].bar)} />
                              {k}
                            </span>
                            <span className="font-mono tabular-nums">{t[k]}</span>
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
