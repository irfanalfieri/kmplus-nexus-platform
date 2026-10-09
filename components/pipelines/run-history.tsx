'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getRunRejects, listRuns, listVersions, restoreVersion } from '@/app/actions/pipelines'
import type { StepStat } from '@/lib/pipelines/engine'

type Run = Awaited<ReturnType<typeof listRuns>>[number]
type Version = Awaited<ReturnType<typeof listVersions>>[number]

export function statusBadge(status: string | null | undefined) {
  switch (status) {
    case 'success':
      return <Badge className="bg-green-600 text-white hover:bg-green-600">Success</Badge>
    case 'partial':
      return <Badge className="bg-amber-500 text-white hover:bg-amber-500">Partial</Badge>
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>
    case 'running':
      return <Badge variant="secondary">Running…</Badge>
    default:
      return <Badge variant="outline">Never run</Badge>
  }
}

export function formatWhen(value: Date | string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d) + ' WIB'
}

export default function RunHistory({ pipelineId, pipelineName, currentVersion, onClose, onRestored }: {
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
  const [rejects, setRejects] = useState<{ row: unknown; errors: unknown }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [r, v] = await Promise.all([listRuns(pipelineId, 30), listVersions(pipelineId)])
      setRuns(r)
      setVersions(v)
      setSelected((cur) => (cur ? r.find((x) => x.id === cur.id) ?? r[0] ?? null : r[0] ?? null))
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
    if (!selected?.recordsError) return setRejects([])
    let cancelled = false
    getRunRejects(selected.id, 100).then((r) => !cancelled && setRejects(r)).catch(() => !cancelled && setRejects([]))
    return () => {
      cancelled = true
    }
  }, [selected])

  const restore = async (version: number) => {
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
    destination?: { target: string; rowCount?: number }
    attempts?: { attempt: number; error?: string; at: string }[]
    watermark?: { column: string; value: string | null }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Pipeline history">
      <div className="flex w-full max-w-5xl flex-col overflow-hidden border border-border bg-card sm:rounded-xl">
        <header className="flex items-center gap-3 border-b border-border p-4">
          <History className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="font-semibold">{pipelineName}</div>
            <div className="text-xs text-muted-foreground">Run and version history · current v{currentVersion}</div>
          </div>
          <Button size="sm" variant={tab === 'runs' ? 'default' : 'outline'} onClick={() => setTab('runs')}>Runs</Button>
          <Button size="sm" variant={tab === 'versions' ? 'default' : 'outline'} onClick={() => setTab('versions')}>Versions</Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close history">
            <X className="h-4 w-4" />
          </Button>
        </header>

        {error && <p className="border-b border-border bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {loading ? (
          <div className="flex flex-1 items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : tab === 'runs' ? (
          runs.length === 0 ? (
            <p className="p-10 text-center text-muted-foreground">No runs yet. Use Run now on the pipeline.</p>
          ) : (
            <div className="grid flex-1 overflow-hidden md:grid-cols-[300px_1fr]">
              <ul className="overflow-y-auto border-b border-border md:border-b-0 md:border-r">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => setSelected(r)} className={`w-full border-b border-border/60 p-3 text-left text-sm ${selected?.id === r.id ? 'bg-primary/5' : 'hover:bg-muted/40'}`}>
                      <div className="flex items-center justify-between gap-2">
                        {statusBadge(r.status)}
                        <span className="text-xs text-muted-foreground">{r.trigger} · v{r.pipelineVersion}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatWhen(r.startTime)}</div>
                      <div className="text-xs">
                        {r.recordsSuccess ?? 0} written / {r.recordsProcessed ?? 0} read{r.recordsError ? ` · ${r.recordsError} rejected` : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {selected && (
                <div className="space-y-4 overflow-y-auto p-4">
                  <div className="grid gap-2 sm:grid-cols-4">
                    {[
                      ['Status', statusBadge(selected.status)],
                      ['Duration', selected.duration != null ? `${selected.duration}s` : '—'],
                      ['Rows read', selected.recordsProcessed ?? 0],
                      ['Rows written', selected.recordsSuccess ?? 0],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md bg-muted/30 p-2">
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="mt-1 font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>
                  {details.destination && (
                    <p className="text-sm text-muted-foreground">
                      Wrote to <span className="font-medium text-foreground">{details.destination.target}</span>
                      {details.destination.rowCount != null && ` (now ${details.destination.rowCount.toLocaleString()} rows)`}
                    </p>
                  )}
                  {selected.errorMessage && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{selected.errorMessage}</p>}
                  {details.attempts && details.attempts.length > 1 && (
                    <div className="rounded-md border border-border p-3 text-sm">
                      <div className="mb-1 font-medium">{details.attempts.length} attempts</div>
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {details.attempts.map((a) => (
                          <li key={a.attempt}>
                            #{a.attempt} · {formatWhen(a.at)} · {a.error ? <span className="text-destructive">{a.error}</span> : 'succeeded'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {details.watermark && (
                    <p className="text-xs text-muted-foreground">
                      Incremental on <span className="font-mono">{details.watermark.column}</span>:{' '}
                      {details.watermark.value ? <>read up to <span className="font-mono">{details.watermark.value}</span></> : 'no new rows'}
                    </p>
                  )}
                  {details.steps && details.steps.length > 0 && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                          <th className="py-2">Step</th>
                          <th>In</th>
                          <th>Out</th>
                          <th>Rejected</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.steps.map((s) => (
                          <tr key={s.id} className="border-b border-border/60">
                            <td className="py-2">
                              {s.label}
                              {s.error && <div className="text-xs text-destructive">{s.error}</div>}
                            </td>
                            <td>{s.rowsIn}</td>
                            <td>{s.rowsOut}</td>
                            <td className={s.rejected ? 'text-destructive' : ''}>{s.rejected}</td>
                            <td>{s.durationMs} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {rejects.length > 0 && (
                    <div>
                      <div className="mb-2 text-sm font-medium">Rejected rows ({selected.recordsError}{selected.recordsError! > rejects.length ? `, showing ${rejects.length}` : ''})</div>
                      {/* Rows rejected at different steps have different columns, so show each row's own fields. */}
                      <div className="max-h-80 overflow-auto rounded-md border border-border">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-muted">
                            <tr>
                              <th className="px-2 py-1 text-left font-medium">Step</th>
                              <th className="px-2 py-1 text-left font-medium">Why</th>
                              <th className="px-2 py-1 text-left font-medium">Row</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rejects.map((r, i) => {
                              const errs = r.errors as { stepId?: string; messages?: string[] }
                              const step = details.steps?.find((s) => s.id === errs.stepId)
                              return (
                                <tr key={i} className="border-t border-border/60 align-top">
                                  <td className="whitespace-nowrap px-2 py-1">{step?.label ?? '—'}</td>
                                  <td className="px-2 py-1 text-destructive">{(errs.messages ?? []).join('; ')}</td>
                                  <td className="px-2 py-1 font-mono">
                                    {Object.entries(r.row as Record<string, unknown>)
                                      .map(([k, v]) => `${k}: ${v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                                      .join(' · ')}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center gap-3 border-b border-border/60 p-3 text-sm">
                <Badge variant={v.version === currentVersion ? 'default' : 'outline'}>v{v.version}</Badge>
                <span className="flex-1">{v.changes}</span>
                <span className="text-xs text-muted-foreground">{formatWhen(v.createdAt)}</span>
                {v.version !== currentVersion && (
                  <Button size="sm" variant="outline" disabled={restoring !== null} onClick={() => restore(v.version)}>
                    {restoring === v.version ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
