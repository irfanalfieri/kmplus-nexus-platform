'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Edit, History, Loader2, Play, Plus, RotateCcw, Trash2, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { deletePipeline, getBuilderOptions, getDatasetPreview, getRunStatus, listPipelines, resetSyncPosition, runPipelineNow, setPipelineEnabled } from '@/lib/actions/pipelines'
import { DEFAULT_SCHEDULE, DEFAULT_SETTINGS, definitionSchema, scheduleSchema, type PipelineStep } from '@/lib/pipelines/definition'
import { describeSchedule } from '@/lib/pipelines/schedule'
import { stepLabel } from '@/lib/pipelines/engine'
import PipelineEditor, { blankPipeline, SampleTable, type EditablePipeline } from '@/components/pipelines/pipeline-editor'
import RunHistory, { formatWhen, statusBadge } from '@/components/pipelines/run-history'
import type { BuilderOptions } from '@/components/pipelines/step-editors'
import { NOTIFICATIONS_CHANGED } from '@/components/dashboard/notification-bell'
import { useCan } from '@/components/workspace/workspace-context'

type PipelineRow = Awaited<ReturnType<typeof listPipelines>>[number]

function toEditable(p: PipelineRow): EditablePipeline {
  const def = definitionSchema.safeParse(p.config)
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    enabled: p.enabled ?? false,
    schedule: scheduleSchema.safeParse(p.schedule ?? {}).data ?? DEFAULT_SCHEDULE,
    steps: def.success ? def.data.steps : blankPipeline().steps,
    settings: def.success ? def.data.settings : DEFAULT_SETTINGS,
    syncPosition: p.syncPosition,
  }
}

export default function PipelineDesignerLayer() {
  const [items, setItems] = useState<PipelineRow[]>([])
  const [options, setOptions] = useState<BuilderOptions>({ dataSources: [], datasets: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ id: string; kind: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  const [editing, setEditing] = useState<EditablePipeline | null>(null)
  const [historyFor, setHistoryFor] = useState<PipelineRow | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null)
  const canEdit = useCan('pipelines:edit')
  const canRun = useCan('pipelines:run')
  const canPreview = useCan('data:preview')

  const load = useCallback(async () => {
    try {
      const [rows, opts] = await Promise.all([listPipelines(), getBuilderOptions()])
      setItems(rows)
      setOptions(opts)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pipelines')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sourceName = useCallback((id: string) => options.dataSources.find((d) => d.id === id)?.name ?? 'missing source', [options])

  const stats = useMemo(() => {
    const ran = items.filter((p) => p.lastRunStatus)
    return {
      total: items.length,
      scheduled: items.filter((p) => p.enabled && p.nextRunAt).length,
      healthy: ran.filter((p) => p.lastRunStatus === 'success').length,
      failing: ran.filter((p) => p.lastRunStatus === 'failed').length,
    }
  }, [items])

  /** Runs execute in the background worker; poll the run until it finishes. */
  const run = async (p: PipelineRow) => {
    setRunning(p.id)
    setNotice(null)
    try {
      const outcome = await runPipelineNow(p.id)
      if (outcome.status === 'skipped') {
        setNotice({ id: p.id, kind: 'warn', text: outcome.message })
        return
      }
      setNotice({ id: p.id, kind: 'ok', text: 'Queued…' })
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000))
        const s = await getRunStatus(outcome.runId)
        if (s.active) {
          const progress = s.recordsProcessed ? `${s.recordsProcessed.toLocaleString()} rows read, ${(s.recordsSuccess ?? 0).toLocaleString()} written` : 'starting'
          setNotice({ id: p.id, kind: 'ok', text: `${s.status === 'queued' ? 'Queued' : 'Running'} in the background: ${progress}${s.errorMessage ? ` · ${s.errorMessage}` : ''}` })
          continue
        }
        const summary = `${(s.recordsSuccess ?? 0).toLocaleString()} of ${(s.recordsProcessed ?? 0).toLocaleString()} rows written${s.recordsError ? `, ${s.recordsError.toLocaleString()} rejected` : ''}.`
        setNotice({
          id: p.id,
          kind: s.status === 'success' ? 'ok' : s.status === 'failed' ? 'err' : 'warn',
          text: s.status === 'failed' ? `Run failed: ${s.errorMessage ?? 'unknown error'}` : s.status === 'cancelled' ? `Run cancelled: ${summary}` : `Run finished: ${summary}`,
        })
        break
      }
      await load()
    } catch (err) {
      setNotice({ id: p.id, kind: 'err', text: err instanceof Error ? err.message : 'Run failed' })
    } finally {
      setRunning(null)
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
    }
  }

  const toggle = async (p: PipelineRow) => {
    try {
      await setPipelineEnabled(p.id, !p.enabled)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const resetSync = async (p: PipelineRow) => {
    try {
      await resetSyncPosition(p.id)
      setNotice({ id: p.id, kind: 'ok', text: 'Sync position reset. The next run reads every row again.' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    }
  }

  const remove = async (id: string) => {
    try {
      await deletePipeline(id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const openPreview = async (name: string) => {
    try {
      const res = await getDatasetPreview(name)
      setPreview({ name, rows: res.rows })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    }
  }

  return (
    <div className="space-y-6">
      {editing && (
        <PipelineEditor
          initial={editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
      {historyFor && (
        <RunHistory
          pipelineId={historyFor.id}
          pipelineName={historyFor.name}
          currentVersion={items.find((p) => p.id === historyFor.id)?.version ?? historyFor.version ?? 1}
          onClose={() => setHistoryFor(null)}
          onRestored={load}
        />
      )}

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Workflow className="h-5 w-5 text-primary" />
              <Badge variant="outline">Layer 4</Badge>
            </div>
            <h2 className="text-2xl font-bold">Pipelines</h2>
            <p className="mt-1 text-muted-foreground">Read from a data source, filter, map and validate rows, then write to a Nexus dataset or back into a database.</p>
          </div>
          {canEdit && (
            <Button onClick={() => setEditing(blankPipeline())} disabled={loading}>
              <Plus className="mr-2 h-4 w-4" /> New pipeline
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['Pipelines', stats.total],
          ['Scheduled', stats.scheduled],
          ['Last run OK', stats.healthy],
          ['Last run failed', stats.failing],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-border bg-card p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading pipelines…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
            <Workflow className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No pipelines yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {options.dataSources.length
                ? 'Create your first pipeline to move data from a connected source into a Nexus dataset or another database.'
                : 'Connect a data source first (Data Sources tab), then create a pipeline that reads from it.'}
            </p>
            {canEdit ? (
              <Button className="mt-4" onClick={() => setEditing(blankPipeline())}>
                <Plus className="mr-2 h-4 w-4" /> New pipeline
              </Button>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">Admins and data stewards create pipelines.</p>
            )}
          </div>
        ) : (
          items.map((p) => {
            const def = definitionSchema.safeParse(p.config)
            const steps: PipelineStep[] = def.success ? def.data.steps : []
            const src = steps[0]?.type === 'source' ? steps[0] : null
            const dst = steps[steps.length - 1]?.type === 'destination' ? steps[steps.length - 1] : null
            const schedule = scheduleSchema.safeParse(p.schedule ?? {}).data ?? DEFAULT_SCHEDULE
            return (
              <div key={p.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{p.name}</span>
                      {statusBadge(p.lastRunStatus)}
                      <Badge variant="outline">v{p.version}</Badge>
                    </div>
                    {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {src ? `${sourceName(src.dataSourceId)} · ${src.table}` : 'No source'} →{' '}
                      {steps.slice(1, -1).map((s) => stepLabel(s)).join(' → ') || 'no transforms'} →{' '}
                      {dst?.type === 'destination' ? (dst.kind === 'dataset' ? `dataset ${dst.datasetName}` : `${sourceName(dst.dataSourceId)} · ${dst.table}`) : 'No destination'}
                    </p>
                    {src?.mode === 'incremental' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Incremental on <span className="font-mono">{src.watermarkColumn}</span> ·{' '}
                        {p.syncPosition ? <>synced up to <span className="font-mono">{p.syncPosition}</span></> : 'first run will read everything'}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {describeSchedule(schedule)}
                      {schedule.type !== 'manual' && (p.enabled ? ` · next ${formatWhen(p.nextRunAt)}` : ' · paused')} · last run {formatWhen(p.lastRunAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {schedule.type !== 'manual' && canRun && (
                      <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                        <input type="checkbox" checked={p.enabled ?? false} onChange={() => toggle(p)} />
                        Scheduled
                      </label>
                    )}
                    {canRun && <Button size="sm" onClick={() => run(p)} disabled={running !== null}>
                      {running === p.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
                      {running === p.id ? 'Running…' : 'Run now'}
                    </Button>}
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(toEditable(p))}>
                        <Edit className="mr-1 h-4 w-4" /> Edit
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setHistoryFor(p)}>
                      <History className="mr-1 h-4 w-4" /> History
                    </Button>
                    {src?.mode === 'incremental' && p.syncPosition && canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => void resetSync(p)} title="Forget the sync position so the next run reads every row">
                        <RotateCcw className="mr-1 h-4 w-4" /> Reset sync
                      </Button>
                    )}
                    {!canEdit ? null : confirmDelete === p.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        Delete &ldquo;{p.name}&rdquo; and its run history?
                        <Button size="sm" variant="destructive" onClick={() => remove(p.id)}>Delete</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(p.id)} aria-label={`Delete ${p.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {notice?.id === p.id && (
                  <p
                    className={`mt-3 rounded-md p-2 text-sm ${
                      notice.kind === 'ok' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : notice.kind === 'warn' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-destructive/10 text-destructive'
                    }`}
                  >
                    {notice.text}
                  </p>
                )}
              </div>
            )
          })
        )}
      </div>

      {options.datasets.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Nexus datasets</h3>
            <span className="text-xs text-muted-foreground">Outputs written by your pipelines</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {options.datasets.map((d) => (
              <button key={d.name} disabled={!canPreview} title={canPreview ? undefined : 'Your role cannot view dataset contents'} onClick={() => openPreview(d.name)} className={`rounded-lg border p-3 text-left text-sm hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent ${preview?.name === d.name ? 'border-primary' : 'border-border'}`}>
                <div className="font-mono font-medium">{d.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {(d.rowCount ?? 0).toLocaleString()} rows · {d.columns.length} columns · loaded {formatWhen(d.lastLoadedAt)}
                </div>
              </button>
            ))}
          </div>
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
        </div>
      )}
    </div>
  )
}
