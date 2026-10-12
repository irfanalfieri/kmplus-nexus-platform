'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, History, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { StateMark, type FlowState } from '@/components/ui/flow-line'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/data-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { getRunRejects, listRuns, listVersions, restoreVersion } from '@/lib/actions/pipelines'
import type { DestinationResult, StepStat } from '@/lib/pipelines/engine'
import { useCan } from '@/components/workspace/workspace-context'

type Run = Awaited<ReturnType<typeof listRuns>>[number]
type Version = Awaited<ReturnType<typeof listVersions>>[number]

/** Run status as breaker + words. `held`: rows quarantined or held back, for partial runs. */
export function runState(status: string | null | undefined, held?: number | null): { state: FlowState; label: string } {
  switch (status) {
    case 'success':
      return { state: 'live', label: 'Success' }
    case 'partial':
      return { state: 'tripped', label: held ? `Partial · ${held.toLocaleString()} held` : 'Partial' }
    case 'failed':
      return { state: 'tripped', label: 'Failed' }
    case 'running':
      return { state: 'running', label: 'Running…' }
    case 'queued':
      return { state: 'idle', label: 'Queued…' }
    case 'cancelled':
      return { state: 'paused', label: 'Cancelled' }
    default:
      return { state: 'idle', label: 'Never run' }
  }
}

export function statusBadge(status: string | null | undefined, held?: number | null) {
  const { state, label } = runState(status, held)
  return <StateMark state={state}>{label}</StateMark>
}

export function formatWhen(value: Date | string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d) + ' WIB'
}

/** Seconds as "42s", "3m 05s", "1h 02m". */
function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export default function RunHistory({
  pipelineId,
  pipelineName,
  currentVersion,
  onClose,
  onRestored,
}: {
  pipelineId: string
  pipelineName: string
  currentVersion: number
  onClose: () => void
  onRestored: () => void
}) {
  const [tab, setTab] = useState<'runs' | 'versions'>('runs')
  const [runs, setRuns] = useState<Run[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [selected, setSelected] = useState<Run | null>(null)
  const [rejects, setRejects] = useState<{ row: unknown; errors: unknown; severity: string | null; kind: string | null; status: string | null }[]>([])
  const [showLog, setShowLog] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState<number | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const canEdit = useCan('pipelines:edit')
  const canPreview = useCan('data:preview')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [r, v] = await Promise.all([listRuns(pipelineId, 30), listVersions(pipelineId)])
      setRuns(r)
      setVersions(v)
      setSelected((cur) => (cur ? (r.find((x) => x.id === cur.id) ?? r[0] ?? null) : (r[0] ?? null)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [pipelineId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const flagged = Number((selected?.executionDetails as { flagged?: number } | null)?.flagged ?? 0)
    if (!selected || (!selected.recordsError && !flagged) || !canPreview) return setRejects([])
    let cancelled = false
    getRunRejects(selected.id, 100)
      .then((r) => !cancelled && setRejects(r))
      .catch(() => !cancelled && setRejects([]))
    return () => {
      cancelled = true
    }
  }, [selected, canPreview])

  const restore = async (version: number) => {
    const ok = await confirm({
      title: `Restore and publish v${version}?`,
      description: `v${version} becomes the running version${currentVersion ? ` instead of v${currentVersion}` : ''}. If this workspace requires approval, it waits for a second person first.`,
      confirmLabel: 'Restore & publish',
    })
    if (!ok) return
    setRestoring(version)
    try {
      await restoreVersion(pipelineId, version)
      await load()
      onRestored()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  const details = (selected?.executionDetails ?? {}) as {
    steps?: StepStat[]
    destination?: DestinationResult
    destinations?: DestinationResult[]
    flagged?: number
    held?: number
    log?: { at: string; level: 'info' | 'warn' | 'error'; message: string }[]
    errorStack?: string
    attempts?: { attempt: number; error?: string; at: string }[]
    watermark?: { column: string; value: string | null }
  }

  // One time scale for every listed run, so bar lengths compare true durations.
  const maxDuration = Math.max(0, ...runs.map((r) => r.duration ?? 0))

  return (
    <Modal
      onClose={onClose}
      size="xl"
      className="sm:h-[calc(100dvh-2rem)]"
      title={pipelineName}
      description={`Run and version history · ${currentVersion ? `published v${currentVersion}` : 'never published'}`}
      bodyClassName="flex flex-col p-0 md:overflow-hidden"
    >
      {confirmDialog}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="min-h-0 flex-1 flex-col gap-0">
        <TabsList variant="line" className="w-full shrink-0 justify-start border-b border-border px-4 pt-2" aria-label="History">
          <TabsTrigger value="runs">
            <History aria-hidden /> Runs
          </TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        {error && (
          <Notice tone="danger" className="m-4 mb-0">
            {error}
          </Notice>
        )}
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 p-10 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </div>
        ) : (
          <>
            <TabsContent value="runs" className="flex min-h-0 flex-1 flex-col">
              {runs.length === 0 ? (
                <EmptyState icon={<History />} title="No runs yet">
                  Use Run now on the pipeline.
                </EmptyState>
              ) : (
                <div className="grid min-h-0 flex-1 md:grid-cols-[320px_1fr]">
                  <ul className="min-h-0 overflow-y-auto border-b border-border md:border-r md:border-b-0" aria-label="Runs, newest first">
                    {runs.map((r) => {
                      const { state, label } = runState(r.status, r.recordsError)
                      const isSelected = selected?.id === r.id
                      const width = maxDuration > 0 && r.duration != null ? Math.max((r.duration / maxDuration) * 100, r.duration > 0 ? 1.5 : 0) : 0
                      return (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(r)}
                            aria-current={isSelected ? 'true' : undefined}
                            className={cn(
                              'w-full border-b border-border px-4 py-3 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                              isSelected ? 'bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--live)]' : 'hover:bg-muted',
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <StateMark state={state}>{label}</StateMark>
                              <span className="font-mono text-xs text-muted-foreground">
                                {r.trigger} · v{r.pipelineVersion}
                              </span>
                            </div>
                            <div className="mt-1 font-mono text-xs text-muted-foreground">{formatWhen(r.startTime)}</div>
                            <div className="text-xs">
                              <span className="font-mono">{r.recordsSuccess ?? 0}</span> written / <span className="font-mono">{r.recordsProcessed ?? 0}</span> read
                              {r.recordsError ? (
                                <>
                                  {' '}
                                  · <span className="font-mono">{r.recordsError}</span> quarantined
                                </>
                              ) : null}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <span className="h-1 min-w-0 flex-1 bg-muted" aria-hidden>
                                {width > 0 && <span className={cn('block h-full', state === 'tripped' ? 'bg-danger' : 'bg-live')} style={{ width: `${width}%` }} />}
                              </span>
                              <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
                                <span className="sr-only">Duration </span>
                                {formatDuration(r.duration)}
                              </span>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {selected && (
                    <div className="min-h-0 space-y-4 overflow-y-auto p-4" aria-label="Run details" role="region">
                      <dl className="grid gap-2 sm:grid-cols-4">
                        {(
                          [
                            ['Status', statusBadge(selected.status, selected.recordsError)],
                            [
                              'Duration',
                              <span key="d" className="font-mono">
                                {formatDuration(selected.duration)}
                              </span>,
                            ],
                            [
                              'Rows read',
                              <span key="r" className="font-mono">
                                {selected.recordsProcessed ?? 0}
                              </span>,
                            ],
                            [
                              'Rows written',
                              <span key="w" className="font-mono">
                                {selected.recordsSuccess ?? 0}
                              </span>,
                            ],
                          ] as const
                        ).map(([label, value]) => (
                          <div key={label} className="rounded-md border border-border p-2">
                            <dt className="text-xs text-muted-foreground">{label}</dt>
                            <dd className="mt-1 font-semibold">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      {(details.destinations ?? (details.destination ? [details.destination] : [])).map((d) => (
                        <p key={d.id ?? d.target} className="text-sm text-muted-foreground">
                          Wrote{' '}
                          {d.written != null && (
                            <>
                              <span className="font-mono">{d.written.toLocaleString()}</span> rows{' '}
                            </>
                          )}
                          to <span className="font-medium text-foreground">{d.target}</span>
                          {d.rowCount != null && (
                            <>
                              {' '}
                              (now <span className="font-mono">{d.rowCount.toLocaleString()}</span> rows)
                            </>
                          )}
                        </p>
                      ))}
                      {(!!details.flagged || !!details.held) && (
                        <Notice tone={details.held ? 'held' : 'warning'} live={false}>
                          {!!details.held && <>{details.held.toLocaleString()} row(s) held for approval. </>}
                          {!!details.flagged && <>{details.flagged.toLocaleString()} row(s) written with warnings. </>}
                          Review them in Data Quality.
                        </Notice>
                      )}
                      {selected.errorMessage && (
                        <Notice tone="danger" live={false}>
                          {selected.errorMessage}
                        </Notice>
                      )}
                      {details.errorStack && (
                        <details className="rounded-md border border-border p-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground">Stack trace (admins only)</summary>
                          <pre className="mt-2 max-h-60 overflow-auto font-mono whitespace-pre-wrap">{details.errorStack}</pre>
                        </details>
                      )}
                      {details.attempts && details.attempts.length > 1 && (
                        <section className="rounded-md border border-border p-3 text-sm" aria-labelledby="run-attempts">
                          <h3 id="run-attempts" className="mb-1 font-medium">
                            {details.attempts.length} attempts
                          </h3>
                          <ul className="space-y-0.5 text-xs text-muted-foreground">
                            {details.attempts.map((a) => (
                              <li key={a.attempt}>
                                <span className="font-mono">
                                  #{a.attempt} · {formatWhen(a.at)}
                                </span>{' '}
                                · {a.error ? <span className="text-danger-text">failed: {a.error}</span> : 'succeeded'}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                      {details.watermark && (
                        <p className="text-xs text-muted-foreground">
                          Incremental on <span className="font-mono">{details.watermark.column}</span>:{' '}
                          {details.watermark.value ? (
                            <>
                              read up to <span className="font-mono">{details.watermark.value}</span>
                            </>
                          ) : (
                            'no new rows'
                          )}
                        </p>
                      )}
                      {details.steps && details.steps.length > 0 && (
                        <div className="rounded-md border border-border">
                          <Table label="Steps of this run">
                            <THead>
                              <tr>
                                <Th>Step</Th>
                                <Th className="text-right">In</Th>
                                <Th className="text-right">Out</Th>
                                <Th className="text-right">Quarantined</Th>
                                <Th className="text-right">Time</Th>
                              </tr>
                            </THead>
                            <TBody>
                              {details.steps.map((s) => (
                                <Tr key={s.id}>
                                  <Td>
                                    {s.label}
                                    {s.error && <div className="text-xs text-danger-text">Failed: {s.error}</div>}
                                  </Td>
                                  <Td className="text-right font-mono">{s.rowsIn}</Td>
                                  <Td className="text-right font-mono">{s.rowsOut}</Td>
                                  <Td className={cn('text-right font-mono', s.rejected ? 'text-danger-text' : '')}>{s.rejected}</Td>
                                  <Td className="text-right font-mono">{s.durationMs} ms</Td>
                                </Tr>
                              ))}
                            </TBody>
                          </Table>
                        </div>
                      )}
                      {details.log && details.log.length > 0 && (
                        <div className="rounded-md border border-border">
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded-md p-2 text-left text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                            onClick={() => setShowLog((v) => !v)}
                            aria-expanded={showLog}
                          >
                            {showLog ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                            Run log ({details.log.length} lines)
                          </button>
                          {showLog && (
                            <ol className="max-h-64 overflow-auto border-t border-border p-2 font-mono text-xs">
                              {details.log.map((l, i) => (
                                <li key={i} className={l.level === 'error' ? 'text-danger-text' : l.level === 'warn' ? 'text-warning-text' : 'text-muted-foreground'}>
                                  {formatWhen(l.at)} {l.level.toUpperCase()} {l.message}
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      )}
                      {rejects.length > 0 && (
                        <section aria-labelledby="run-rejects">
                          <h3 id="run-rejects" className="mb-2 text-sm font-medium">
                            Quarantined and flagged rows (showing {rejects.length}; fix or approve them in Data Quality)
                          </h3>
                          {/* Rows rejected at different steps have different columns, so show each row's own fields. */}
                          <div className="max-h-80 overflow-auto rounded-md border border-border" tabIndex={0} role="region" aria-label="Quarantined and flagged rows">
                            <table className="w-full border-collapse text-left text-xs">
                              <THead className="sticky top-0 z-[1] bg-muted">
                                <tr>
                                  <Th className="h-7 px-2 first:pl-2">Step</Th>
                                  <Th className="h-7 px-2">Kind</Th>
                                  <Th className="h-7 px-2">Why</Th>
                                  <Th className="h-7 px-2 last:pr-2">Row</Th>
                                </tr>
                              </THead>
                              <TBody>
                                {rejects.map((r, i) => {
                                  const errs = r.errors as { stepId?: string; messages?: string[] }
                                  const step = details.steps?.find((s) => s.id === errs.stepId)
                                  return (
                                    <Tr key={i} className="align-top">
                                      <Td className="px-2 py-1 whitespace-nowrap first:pl-2">{step?.label ?? '—'}</Td>
                                      <Td className="px-2 py-1 whitespace-nowrap">
                                        {r.kind === 'flag' ? `flag (${r.severity})` : r.kind === 'approval' ? 'approval' : 'invalid'}
                                        {r.status && r.status !== 'open' ? ` · ${r.status}` : ''}
                                      </Td>
                                      <Td className={cn('px-2 py-1', r.kind === 'flag' ? 'text-warning-text' : r.kind === 'approval' ? 'text-held-text' : 'text-danger-text')}>
                                        {(errs.messages ?? []).join('; ')}
                                      </Td>
                                      <Td className="px-2 py-1 font-mono last:pr-2">
                                        {Object.entries(r.row as Record<string, unknown>)
                                          .map(([k, v]) => `${k}: ${v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                                          .join(' · ')}
                                      </Td>
                                    </Tr>
                                  )
                                })}
                              </TBody>
                            </table>
                          </div>
                        </section>
                      )}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
            <TabsContent value="versions" className="flex min-h-0 flex-1 flex-col">
              {versions.length === 0 ? (
                <EmptyState icon={<History />} title="No versions yet">
                  Save the pipeline to create its first version.
                </EmptyState>
              ) : (
                <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Versions, newest first">
                  {versions.map((v) => {
                    const live = v.version === currentVersion
                    return (
                      <li key={v.version} className={cn('flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-sm', live && 'bg-accent text-accent-foreground')}>
                        <span className="w-10 font-mono font-semibold">v{v.version}</span>
                        {live ? (
                          <StateMark state="live">live</StateMark>
                        ) : v.publishedAt ? (
                          <span className="text-xs text-muted-foreground">
                            published <span className="font-mono">{formatWhen(v.publishedAt)}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">draft</span>
                        )}
                        <span className="min-w-0 flex-1">{v.changes}</span>
                        <span className="font-mono text-xs text-muted-foreground">{formatWhen(v.createdAt)}</span>
                        {!live && canEdit && (
                          <Button size="sm" variant="outline" disabled={restoring !== null} onClick={() => void restore(v.version)}>
                            {restoring === v.version ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
                            Restore &amp; publish
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
    </Modal>
  )
}
