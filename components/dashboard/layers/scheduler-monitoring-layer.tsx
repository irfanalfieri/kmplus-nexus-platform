'use client'

import { RootCauseHint } from '@/components/monitoring/root-cause-hint'
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
import { useHashTarget, useUrlIntents } from '@/components/dashboard/url-intents'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { getMonitoringOverview, type PipelineHealth } from '@/lib/actions/monitoring'
import { cancelPipelineRun, getDatasetPreview, retryPipelineRun } from '@/lib/actions/pipelines'
import RunHistory from '@/components/pipelines/run-history'
import { SampleTable } from '@/components/pipelines/pipeline-editor'
import { useCan } from '@/components/workspace/workspace-context'
import { localizeCheck } from '@/lib/pipelines/check-messages'
import type { Locale } from '@/lib/i18n/config'
import type { Translate } from '@/lib/i18n/translate'

type Overview = Awaited<ReturnType<typeof getMonitoringOverview>>

// Run outcomes in the chart: state colours, always paired with a label (legend + table view).
const STATUS = {
  success: { bar: 'bg-live' },
  partial: { bar: 'bg-warning' },
  failed: { bar: 'bg-danger' },
} as const

type HealthMeta = { state: FlowState } | { warning: typeof AlertTriangle }
const HEALTH: Record<PipelineHealth, HealthMeta> = {
  healthy: { state: 'live' },
  warning: { warning: AlertTriangle },
  failed: { state: 'tripped' },
  delayed: { warning: Clock },
  paused: { state: 'paused' },
  never_run: { state: 'idle' },
}

// Health reasons the server writes in English; a failed run's own error is shown as a check message.
const REASONS: Record<string, 'waiting' | 'paused' | 'overdue' | 'lastFailed' | 'rejected'> = {
  'A run has been waiting for the background worker for over 10 minutes': 'waiting',
  'Schedule paused': 'paused',
  'Scheduled run is overdue': 'overdue',
  'Last run failed': 'lastFailed',
  'Last run rejected some rows': 'rejected',
}
const healthReason = (reason: string, t: Translate, locale: Locale) => (reason in REASONS ? t(`ops.monitoring.reasons.${REASONS[reason]}`) : localizeCheck(reason, locale))

const TRIGGERS = ['manual', 'schedule', 'replay', 'api', 'webhook', 'chain'] as const
const triggerLabel = (trigger: string, t: Translate) => ((TRIGGERS as readonly string[]).includes(trigger) ? t(`ops.monitoring.triggers.${trigger as (typeof TRIGGERS)[number]}`) : trigger)

/** "13 Oct, 09:05:12 WIB" in the interface language. */
function useWhen() {
  const { formatDateTime } = usePrefs()
  return (value: Date | string | null | undefined) =>
    value ? `${formatDateTime(value, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', dateStyle: undefined, timeStyle: undefined })} WIB` : '—'
}

/** Puts React nodes into a translated template's {placeholders}. */
function rich(template: string, nodes: Record<string, React.ReactNode>) {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part)
    return m && m[1] in nodes ? <span key={i}>{nodes[m[1]]}</span> : part
  })
}

function HealthMark({ health }: { health: PipelineHealth }) {
  const { t } = usePrefs()
  const meta = HEALTH[health]
  const label = t(`ops.monitoring.health.${health}`)
  if ('state' in meta) return <StateMark state={meta.state}>{label}</StateMark>
  const Icon = meta.warning
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap text-warning-text">
      <Icon className="size-3.5 text-warning" aria-hidden />
      {label}
    </span>
  )
}

/** A run's status as breaker + words. */
function RunState({ status }: { status: string | null | undefined }) {
  const { t } = usePrefs()
  const [state, label]: [FlowState, string] =
    status === 'success'
      ? ['live', t('state.succeeded')]
      : status === 'partial'
        ? ['tripped', t('ops.monitoring.run.partial')]
        : status === 'failed'
          ? ['tripped', t('state.failed')]
          : status === 'running'
            ? ['running', t('state.running')]
            : status === 'queued'
              ? ['idle', t('state.queued')]
              : status === 'cancelled'
                ? ['paused', t('state.cancelled')]
                : ['idle', t('ops.monitoring.run.neverRun')]
  return <StateMark state={state}>{label}</StateMark>
}

const REFRESH_MS = 30_000

export default function SchedulerMonitoringLayer() {
  const { t, locale, formatNumber } = usePrefs()
  const formatWhen = useWhen()
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
      setError(err instanceof Error ? err.message : t('ops.monitoring.loadFailed'))
    } finally {
      setRefreshing(false)
    }
  }, [t])

  const runAction = async (key: string, fn: () => Promise<{ message: string }>) => {
    setActing(key)
    setError('')
    try {
      toast({ message: (await fn()).message })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.monitoring.actionFailed'))
    } finally {
      setActing(null)
    }
  }

  const cancelJob = async (job: { id: string; pipelineName: string }) => {
    const ok = await confirm({
      title: t('ops.monitoring.cancelTitle', { name: job.pipelineName }),
      description: t('ops.monitoring.cancelBody'),
      confirmLabel: t('ops.monitoring.cancelConfirm'),
      cancelLabel: t('ops.monitoring.keepRunning'),
      tone: 'danger',
    })
    if (ok) await runAction(`cancel:${job.id}`, () => cancelPipelineRun(job.id))
  }

  const retryRun = async (run: { id: string; pipelineName: string }) => {
    const ok = await confirm({
      title: t('ops.monitoring.retryTitle', { name: run.pipelineName }),
      description: t('ops.monitoring.retryBody'),
      confirmLabel: t('ops.monitoring.retryConfirm'),
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
      setError(err instanceof Error ? err.message : t('ops.monitoring.previewFailed'))
    }
  }

  const versionOf = (id: string) => data?.health.find((h) => h.id === id)?.version ?? 1
  useHashTarget(data !== null)

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
        meta={t('ops.monitoring.meta')}
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
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> {t('ops.monitoring.loading')}
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
            <Stat label={t('ops.monitoring.stats.success')} value={formatNumber(data.today.success)} />
            <Stat label={t('ops.monitoring.stats.partial')} value={formatNumber(data.today.partial)} />
            <Stat label={t('ops.monitoring.stats.failed')} value={formatNumber(data.today.failed)} danger={data.today.failed > 0} />
            <Stat label={t('ops.monitoring.stats.running')} value={formatNumber(data.today.running)} />
            <Stat label={t('ops.monitoring.stats.written')} value={formatNumber(data.rowsWritten24h)} />
            <Stat label={t('ops.monitoring.stats.rejected')} value={formatNumber(data.rowsRejected24h)} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <RunTrend trend={data.trend} />

            <section data-tour="monitoring-health" className="rounded-lg border border-border bg-card p-5" aria-labelledby="mon-health">
              <h2 id="mon-health" className="text-base font-semibold">
                {t('ops.monitoring.healthTitle')}
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">{t('ops.monitoring.healthHelp')}</p>
              {data.health.length === 0 ? (
                <EmptyState compact icon={<Activity />} title={t('ops.monitoring.noPipelinesTitle')}>
                  {t('ops.monitoring.noPipelinesBody')}
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
                        <div className="truncate text-xs text-muted-foreground" title={h.reason ? healthReason(h.reason, t, locale) : undefined}>
                          {h.reason ? healthReason(h.reason, t, locale) : h.scheduled ? t('ops.monitoring.next', { when: formatWhen(h.nextRunAt) }) : t('ops.monitoring.manual')} · {t('ops.monitoring.last', { when: formatWhen(h.lastRunAt) })}
                        </div>
                      </div>
                      <span className="w-20 text-right font-mono text-xs text-muted-foreground">{h.successRate7d === null ? '—' : t('ops.monitoring.rate', { rate: formatNumber(h.successRate7d), runs: formatNumber(h.runs7d) })}</span>
                      <Button size="sm" variant="ghost" onClick={() => setHistoryFor({ id: h.id, name: h.name, version: h.version })} aria-label={t('ops.monitoring.historyOf', { name: h.name })}>
                        <History aria-hidden /> {t('ops.monitoring.history')}
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
                {t('ops.monitoring.jobs.title')}
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">{t('ops.monitoring.jobs.help')}</p>
              <ul className="divide-y divide-border">
                {data.jobs.map((j) => {
                  const retrying = j.status === 'queued' && j.attempts > 0
                  const cancelling = j.status === 'cancelling'
                  return (
                    <li key={j.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <span className="w-28">
                        <StateMark state={cancelling ? 'paused' : j.status === 'running' ? 'running' : 'idle'}>{cancelling ? t('ops.monitoring.jobs.cancelling') : j.status === 'running' ? t('state.running') : retrying ? t('ops.monitoring.jobs.retrying') : t('state.queued')}</StateMark>
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{j.pipelineName}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {t('ops.monitoring.jobs.progress', { read: formatNumber(j.rowsRead), written: formatNumber(j.rowsWritten) })}
                        {j.chunks ? ` · ${t('ops.monitoring.jobs.chunks', { count: j.chunks })}` : ''}
                      </span>
                      <span className="w-48 text-right font-mono text-xs text-muted-foreground">
                        {retrying ? t('ops.monitoring.jobs.attempt', { attempt: j.attempts + 1, when: formatWhen(j.availableAt) }) : t('ops.monitoring.jobs.queuedAt', { trigger: triggerLabel(j.trigger, t), when: formatWhen(j.createdAt) })}
                      </span>
                      {canRun && !cancelling && (
                        <Button size="sm" variant="outline" disabled={acting !== null} onClick={() => void cancelJob(j)} aria-label={t('ops.monitoring.jobs.cancelNamed', { name: j.pipelineName })}>
                          {acting === `cancel:${j.id}` ? <Loader2 className="animate-spin" aria-hidden /> : <Square aria-hidden />}
                          {t('ops.monitoring.jobs.cancel')}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <section id="runs" className="scroll-mt-6 rounded-lg border border-border bg-card" aria-labelledby="mon-runs">
            <h2 id="mon-runs" className="px-5 pt-5 pb-3 text-base font-semibold">
              {t('ops.monitoring.runs.title')}
            </h2>
            {data.recentRuns.length === 0 ? (
              <EmptyState compact icon={<History />} title={t('ops.monitoring.runs.empty')} />
            ) : (
              <Table label={t('ops.monitoring.runs.title')} className="min-w-[760px]">
                <THead>
                  <tr>
                    <Th>{t('ops.monitoring.runs.started')}</Th>
                    <Th>{t('ops.monitoring.runs.pipeline')}</Th>
                    <Th>{t('ops.monitoring.runs.trigger')}</Th>
                    <Th>{t('ops.monitoring.runs.status')}</Th>
                    <Th className="text-right">{t('ops.monitoring.runs.read')}</Th>
                    <Th className="text-right">{t('ops.monitoring.runs.written')}</Th>
                    <Th className="text-right">{t('ops.monitoring.runs.rejected')}</Th>
                    <Th className="text-right">{t('ops.monitoring.runs.duration')}</Th>
                    {canRun && (
                      <Th>
                        <span className="sr-only">{t('ops.monitoring.runs.actions')}</span>
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
                          <span className="sr-only">{t('ops.monitoring.runs.openHistory')}</span>
                        </button>
                        {r.errorMessage && (
                          <p className="truncate text-xs text-danger-text" title={localizeCheck(r.errorMessage, locale)}>
                            {localizeCheck(r.errorMessage, locale)}
                          </p>
                        )}
                        {(r.status === 'failed' || r.status === 'partial') && <RootCauseHint message={r.errorMessage} compact />}
                      </Td>
                      <Td className="font-mono text-xs text-muted-foreground">{r.trigger ? triggerLabel(r.trigger, t) : null}</Td>
                      <Td>
                        <RunState status={r.status} />
                      </Td>
                      <Td className="text-right font-mono">{formatNumber(r.recordsProcessed ?? 0)}</Td>
                      <Td className="text-right font-mono">{formatNumber(r.recordsSuccess ?? 0)}</Td>
                      <Td className="text-right font-mono">{formatNumber(r.recordsError ?? 0)}</Td>
                      <Td className="text-right font-mono">{r.duration != null ? `${r.duration}s` : '—'}</Td>
                      {canRun && (
                        <Td className="text-right">
                          {(r.status === 'failed' || r.status === 'cancelled' || r.status === 'partial') && (
                            <Button size="sm" variant="ghost" disabled={acting !== null} onClick={() => void retryRun(r)} aria-label={t('ops.monitoring.runs.retryNamed', { name: r.pipelineName })}>
                              {acting === `retry:${r.id}` ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
                              {t('ops.monitoring.runs.retry')}
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
              {t('ops.monitoring.datasets.title')}
            </h2>
            {data.datasets.length === 0 ? (
              <EmptyState compact icon={<Database />} title={t('ops.monitoring.datasets.emptyTitle')}>
                {t('ops.monitoring.datasets.emptyBody')}
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
                    title={canPreview ? undefined : t('ops.monitoring.datasets.noAccess')}
                    className={cn(
                      'rounded-md border p-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:hover:bg-transparent',
                      preview?.name === d.name ? 'border-primary bg-accent text-accent-foreground' : 'border-border',
                    )}
                  >
                    <div className="font-mono font-medium">{d.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{formatNumber(d.rowCount ?? 0)}</span> {t('ops.monitoring.datasets.rows', { count: d.rowCount ?? 0 })} · <span className="font-mono">{formatNumber(d.columnCount)}</span>{' '}
                      {t('ops.monitoring.datasets.columns', { count: d.columnCount })} · {t('ops.monitoring.datasets.loaded', { when: formatWhen(d.lastLoadedAt) })}
                      {d.pipelineName ? ` · ${t('ops.monitoring.datasets.by', { name: d.pipelineName })}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {preview && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-sm">
                  <h3>{rich(t('ops.monitoring.datasets.previewTitle'), { name: <span className="font-mono">{preview.name}</span> })}</h3>
                  <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                    {t('ops.monitoring.datasets.closePreview')}
                  </Button>
                </div>
                {preview.rows.length ? <SampleTable rows={preview.rows} /> : <p className="text-sm text-muted-foreground">{t('ops.monitoring.datasets.empty')}</p>}
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
  const { t, formatDateTime } = usePrefs()
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const max = useMemo(() => Math.max(1, ...trend.map((d) => d.success + d.partial + d.failed)), [trend])
  const ticks = useMemo(() => {
    const step = Math.max(1, Math.ceil(max / 4))
    return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  }, [max])
  const top = ticks[ticks.length - 1] || 1
  const dayLabel = (d: string) => formatDateTime(`${d}T00:00:00Z`, { weekday: 'short', day: 'numeric', timeZone: 'UTC', dateStyle: undefined, timeStyle: undefined })
  const H = 160

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="mon-trend">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="mon-trend" className="text-base font-semibold">
            {t('ops.monitoring.trend.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('ops.monitoring.trend.subtitle')}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? t('ops.monitoring.trend.showChart') : t('ops.monitoring.trend.showTable')}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden={asTable}>
        {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn('inline-block size-2.5 rounded-[1px]', STATUS[k].bar)} />
            {t(`ops.monitoring.outcome.${k}`)}
          </span>
        ))}
      </div>

      {asTable ? (
        <Table label={t('ops.monitoring.trend.title')} className="mt-4">
          <THead>
            <tr>
              <Th>{t('ops.monitoring.trend.day')}</Th>
              <Th className="text-right">{t('ops.monitoring.trend.success')}</Th>
              <Th className="text-right">{t('ops.monitoring.trend.partial')}</Th>
              <Th className="text-right">{t('ops.monitoring.trend.failed')}</Th>
            </tr>
          </THead>
          <TBody>
            {trend.map((d) => (
              <Tr key={d.day}>
                <Td>{dayLabel(d.day)}</Td>
                <Td className="text-right font-mono">{d.success}</Td>
                <Td className="text-right font-mono">{d.partial}</Td>
                <Td className="text-right font-mono">{d.failed}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <div className="relative mt-4 flex gap-2" role="img" aria-label={t('ops.monitoring.trend.aria', { days: trend.map((d) => t('ops.monitoring.trend.ariaDay', { day: dayLabel(d.day), success: d.success, partial: d.partial, failed: d.failed })).join('; ') })}>
          <div className="flex flex-col justify-between text-right font-mono text-[11px] text-muted-foreground tabular-nums" style={{ height: H }}>
            {[...ticks].reverse().map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: H }}>
              {ticks.map((tick) => (
                <div key={tick} className="border-t border-border/60" />
              ))}
            </div>
            <div className="relative flex items-end gap-2" style={{ height: H }}>
              {trend.map((d, i) => {
                const total = d.success + d.partial + d.failed
                return (
                  <div key={d.day} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    {/* Stack bottom → top: success, partial, failed; 2px surface gaps between segments. */}
                    <div className="mx-auto flex w-full max-w-[36px] flex-col-reverse gap-[2px]">
                      {(['success', 'partial', 'failed'] as const)
                        .filter((k) => d[k] > 0)
                        .map((k, idx, arr) => (
                          <div
                            key={k}
                            style={{ height: Math.max(2, (d[k] / top) * H - 2), opacity: hover === null || hover === i ? 1 : 0.45 }}
                            className={cn(STATUS[k].bar, idx === arr.length - 1 && 'rounded-t-[2px]')}
                          />
                        ))}
                    </div>
                    {hover === i && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-36 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-xs shadow-raised">
                        <div className="mb-1 font-medium">
                          {t('ops.monitoring.trend.tooltip', { day: dayLabel(d.day), count: total })}
                        </div>
                        {(['success', 'partial', 'failed'] as const).map((k) => (
                          <div key={k} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              <span className={cn('inline-block size-2 rounded-[1px]', STATUS[k].bar)} />
                              {t(`ops.monitoring.series.${k}`)}
                            </span>
                            <span className="font-mono tabular-nums">{d[k]}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-1 flex gap-2">
              {trend.map((d) => (
                <span key={d.day} className="flex-1 text-center text-[11px] text-muted-foreground">
                  {dayLabel(d.day)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
