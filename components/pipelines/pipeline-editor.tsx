'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BellRing, Database, Filter, FlaskConical, Loader2, Save, ShieldCheck, Shuffle, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DEFAULT_SCHEDULE,
  DEFAULT_SETTINGS,
  definitionSchema,
  describeDefinitionError,
  newStepId,
  scheduleSchema,
  type PipelineSchedule,
  type PipelineSettings,
  type PipelineStep,
} from '@/lib/pipelines/definition'
import { describeSchedule, formatInTimezone, nextRunTimes } from '@/lib/pipelines/schedule'
import type { EngineResult } from '@/lib/pipelines/engine'
import { savePipeline, testPipeline } from '@/app/actions/pipelines'
import {
  DestinationEditor,
  FilterEditor,
  MapEditor,
  NativeSelect,
  SourceEditor,
  ValidateEditor,
  type BuilderOptions,
  type Column,
} from './step-editors'

export interface EditablePipeline {
  id?: string
  name: string
  description: string
  steps: PipelineStep[]
  schedule: PipelineSchedule
  settings: PipelineSettings
  enabled: boolean
  /** Incremental sync position of the saved pipeline (display only). */
  syncPosition?: string | null
}

export function blankPipeline(): EditablePipeline {
  return {
    name: '',
    description: '',
    enabled: false,
    schedule: DEFAULT_SCHEDULE,
    settings: DEFAULT_SETTINGS,
    steps: [
      { id: newStepId(), type: 'source', dataSourceId: '', table: '', maxRows: 10000, mode: 'full', watermarkColumn: '' },
      { id: newStepId(), type: 'destination', kind: 'dataset', datasetName: '', mode: 'replace', keys: [] },
    ],
  }
}

const STEP_META: Record<PipelineStep['type'], { title: string; icon: typeof Database; hint: string }> = {
  source: { title: 'Source', icon: Database, hint: 'Where rows come from' },
  filter: { title: 'Filter', icon: Filter, hint: 'Keep only matching rows' },
  map: { title: 'Map & transform', icon: Shuffle, hint: 'Rename, convert and clean fields' },
  validate: { title: 'Validate', icon: ShieldCheck, hint: 'Reject rows that break rules' },
  destination: { title: 'Destination', icon: Upload, hint: 'Where results are written' },
}

function newMiddleStep(type: 'filter' | 'map' | 'validate', columns: Column[]): PipelineStep {
  const first = columns[0]?.name ?? ''
  if (type === 'filter') return { id: newStepId(), type, match: 'all', conditions: [{ field: first, operator: 'equals', value: '' }] }
  if (type === 'map') return { id: newStepId(), type, keepUnmapped: false, fields: [{ from: first, to: first.toLowerCase(), type: 'text', transforms: [] }] }
  return { id: newStepId(), type, onFail: 'reject', rules: [{ field: first, rule: 'required', value: '' }] }
}

/** Columns available as input to each step (index-aligned with steps). */
function columnsPerStep(steps: PipelineStep[], options: BuilderOptions): Column[][] {
  const result: Column[][] = []
  let current: Column[] = []
  for (const step of steps) {
    result.push(current)
    if (step.type === 'source') {
      const src = options.dataSources.find((d) => d.id === step.dataSourceId)
      current = src?.tables.find((t) => t.name === step.table)?.columns ?? []
    } else if (step.type === 'map') {
      const mapped = step.fields.filter((f) => f.to).map((f) => ({ name: f.to, type: f.type }))
      const used = new Set(step.fields.map((f) => f.from))
      current = step.keepUnmapped ? [...mapped, ...current.filter((c) => !used.has(c.name) && !mapped.some((m) => m.name === c.name))] : mapped
    }
  }
  result.push(current)
  return result
}

export default function PipelineEditor({
  initial,
  options,
  onClose,
  onSaved,
}: {
  initial: EditablePipeline
  options: BuilderOptions
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [draft, setDraft] = useState<EditablePipeline>(initial)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [test, setTest] = useState<EngineResult | null>(null)
  const [openSample, setOpenSample] = useState<string | null>(null)

  const columns = useMemo(() => columnsPerStep(draft.steps, options), [draft.steps, options])
  const validation = useMemo(() => definitionSchema.safeParse({ steps: draft.steps, settings: draft.settings }), [draft.steps, draft.settings])
  const scheduleCheck = useMemo(() => scheduleSchema.safeParse(draft.schedule), [draft.schedule])
  const upcoming = useMemo(() => (scheduleCheck.success ? nextRunTimes(scheduleCheck.data, 3) : []), [scheduleCheck])

  const setStep = (i: number, step: PipelineStep) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? step : s)) }))
  const insertStep = (type: 'filter' | 'map' | 'validate') =>
    setDraft((d) => {
      const at = d.steps.length - 1 // before destination
      const steps = [...d.steps]
      steps.splice(at, 0, newMiddleStep(type, columns[at]))
      return { ...d, steps }
    })
  const moveStep = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const steps = [...d.steps]
      const j = i + dir
      if (j <= 0 || j >= steps.length - 1) return d
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...d, steps }
    })
  const removeStep = (i: number) => setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))
  const setSchedule = (patch: Partial<PipelineSchedule>) => setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }))

  const runTest = async () => {
    setError('')
    if (!validation.success) return setError(describeDefinitionError(validation.error))
    setTesting(true)
    setTest(null)
    try {
      const res = await testPipeline({ steps: draft.steps, settings: draft.settings }, draft.id)
      if (!res.ok) setError(res.message)
      else setTest(res.result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test run failed')
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setError('')
    if (!draft.name.trim()) return setError('Give the pipeline a name.')
    if (!validation.success) return setError(describeDefinitionError(validation.error))
    if (!scheduleCheck.success) return setError('Check the schedule settings.')
    if (draft.schedule.type === 'cron' && !upcoming.length) return setError('The cron expression is invalid.')
    setSaving(true)
    try {
      const { id } = await savePipeline({
        id: draft.id,
        name: draft.name,
        description: draft.description,
        definition: { steps: draft.steps, settings: draft.settings },
        schedule: draft.schedule,
        enabled: draft.enabled,
      })
      onSaved(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const statFor = (id: string) => test?.steps.find((s) => s.id === id)

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Pipeline editor">
      <div className="flex w-full max-w-5xl flex-col overflow-hidden border border-border bg-card sm:rounded-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1.5fr]">
            <Input value={draft.name} placeholder="Pipeline name, e.g. Employee Sync" onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="font-medium" />
            <Input value={draft.description} placeholder="Description (optional)" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close editor">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {draft.steps.map((step, i) => {
            const meta = STEP_META[step.type]
            const Icon = meta.icon
            const stat = statFor(step.id)
            const middle = i > 0 && i < draft.steps.length - 1
            return (
              <section key={step.id} className="rounded-lg border border-border bg-background/50">
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-medium">{meta.title}</span>
                  <span className="text-xs text-muted-foreground">{meta.hint}</span>
                  {stat && (
                    <span className="ml-auto flex items-center gap-2 text-xs">
                      {stat.error ? (
                        <Badge variant="destructive">Failed</Badge>
                      ) : (
                        <>
                          <Badge variant="secondary">{stat.rowsOut} out</Badge>
                          {stat.rejected > 0 && <Badge variant="destructive">{stat.rejected} rejected</Badge>}
                        </>
                      )}
                      {stat.sample && stat.sample.length > 0 && (
                        <button className="text-primary underline-offset-2 hover:underline" onClick={() => setOpenSample(openSample === step.id ? null : step.id)}>
                          {openSample === step.id ? 'Hide rows' : 'Show rows'}
                        </button>
                      )}
                    </span>
                  )}
                  {middle && (
                    <span className={`flex gap-1 ${stat ? '' : 'ml-auto'}`}>
                      <Button size="sm" variant="ghost" onClick={() => moveStep(i, -1)} disabled={i <= 1} aria-label="Move step up">
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => moveStep(i, 1)} disabled={i >= draft.steps.length - 2} aria-label="Move step down">
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeStep(i)} aria-label="Remove step">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </span>
                  )}
                </div>
                <div className="p-3">
                  {step.type === 'source' && <SourceEditor step={step} options={options} onChange={(s) => setStep(i, s)} />}
                  {step.type === 'filter' && <FilterEditor step={step} columns={columns[i]} onChange={(s) => setStep(i, s)} />}
                  {step.type === 'map' && <MapEditor step={step} columns={columns[i]} onChange={(s) => setStep(i, s)} />}
                  {step.type === 'validate' && <ValidateEditor step={step} columns={columns[i]} onChange={(s) => setStep(i, s)} />}
                  {step.type === 'destination' && <DestinationEditor step={step} options={options} columns={columns[i]} onChange={(s) => setStep(i, s)} />}
                  {stat?.error && <p className="mt-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">{stat.error}</p>}
                  {openSample === step.id && stat?.sample && <SampleTable rows={stat.sample} />}
                </div>
              </section>
            )
          })}

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm">
            <span className="text-muted-foreground">Add a step before the destination:</span>
            <Button size="sm" variant="outline" onClick={() => insertStep('filter')}>
              <Filter className="mr-1 h-4 w-4" /> Filter
            </Button>
            <Button size="sm" variant="outline" onClick={() => insertStep('map')}>
              <Shuffle className="mr-1 h-4 w-4" /> Map & transform
            </Button>
            <Button size="sm" variant="outline" onClick={() => insertStep('validate')}>
              <ShieldCheck className="mr-1 h-4 w-4" /> Validate
            </Button>
          </div>

          <SettingsSection settings={draft.settings} onChange={(patch) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }))} />

          <ScheduleSection schedule={draft.schedule} enabled={draft.enabled} upcoming={upcoming} onChange={setSchedule} onEnabled={(enabled) => setDraft({ ...draft, enabled })} />

          {test && !test.error && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              {test.watermark && (
                <div className="mb-1 text-xs text-muted-foreground">
                  Incremental: reading rows after {draft.syncPosition ? `${test.watermark.column} > ${draft.syncPosition}` : 'the beginning (first sync)'}
                  {test.watermark.value ? ` · a run would advance the position to ${test.watermark.value}` : ' · no new rows'}
                </div>
              )}
              Test run on a sample: read {test.rowsRead} rows, {test.steps[test.steps.length - 1]?.rowsOut ?? 0} would be written
              {test.rejectedCount > 0 && `, ${test.rejectedCount} rejected`}. Nothing was written.
              {test.rejects.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                  {test.rejects.slice(0, 5).map((r, k) => (
                    <li key={k}>{r.errors.join('; ')}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border p-4">
          {error ? <p className="mr-auto text-sm text-destructive">{error}</p> : <p className="mr-auto text-xs text-muted-foreground">{validation.success ? 'Ready to test or save.' : describeDefinitionError(validation.error)}</p>}
          <Button variant="outline" onClick={runTest} disabled={testing || saving}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
            Test on sample
          </Button>
          <Button onClick={save} disabled={saving || testing}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {draft.id ? 'Save new version' : 'Create pipeline'}
          </Button>
        </footer>
      </div>
    </div>
  )
}

function SettingsSection({ settings, onChange }: { settings: PipelineSettings; onChange: (patch: Partial<PipelineSettings>) => void }) {
  const [emails, setEmails] = useState(settings.alertEmails.join(', '))
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="mb-3 flex items-center gap-2 font-medium">
        <BellRing className="h-4 w-4 text-primary" /> Retries & alerts
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Retries on failure</span>
          <NativeSelect value={String(settings.retries)} onChange={(v) => onChange({ retries: Number(v) })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'No retries' : `${n} retr${n === 1 ? 'y' : 'ies'}`}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">First retry after</span>
          <NativeSelect value={String(settings.retryDelaySeconds)} onChange={(v) => onChange({ retryDelaySeconds: Number(v) })} disabled={!settings.retries}>
            {[5, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} seconds (then doubles)
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Email alerts</span>
          <NativeSelect value={settings.alertOn} onChange={(v) => onChange({ alertOn: v as PipelineSettings['alertOn'] })}>
            <option value="failure">When a run fails</option>
            <option value="failure_or_rejects">When it fails or rejects rows</option>
            <option value="never">Never (bell only)</option>
          </NativeSelect>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Send alerts to</span>
          <Input
            value={emails}
            disabled={settings.alertOn === 'never'}
            placeholder="Your account email"
            onChange={(e) => {
              setEmails(e.target.value)
              onChange({ alertEmails: e.target.value.split(/[,s]+/).map((x) => x.trim()).filter(Boolean) })
            }}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Retries apply to connection and write errors, not to bad data or configuration. Failed runs always appear under the bell icon.
      </p>
    </section>
  )
}

function ScheduleSection({
  schedule,
  enabled,
  upcoming,
  onChange,
  onEnabled,
}: {
  schedule: PipelineSchedule
  enabled: boolean
  upcoming: Date[]
  onChange: (patch: Partial<PipelineSchedule>) => void
  onEnabled: (v: boolean) => void
}) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="font-medium">Schedule</span>
        <NativeSelect className="w-40" value={schedule.type} onChange={(v) => onChange({ type: v as PipelineSchedule['type'] })}>
          <option value="manual">Manual only</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="cron">Cron expression</option>
        </NativeSelect>
        {schedule.type === 'hourly' && (
          <label className="flex items-center gap-2 text-sm">
            at minute
            <Input type="number" min={0} max={59} className="w-20" value={schedule.minute} onChange={(e) => onChange({ minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })} />
          </label>
        )}
        {['daily', 'weekly', 'monthly'].includes(schedule.type) && (
          <label className="flex items-center gap-2 text-sm">
            at
            <Input type="time" className="w-32" value={schedule.time} onChange={(e) => e.target.value && onChange({ time: e.target.value })} />
            WIB
          </label>
        )}
        {schedule.type === 'monthly' && (
          <label className="flex items-center gap-2 text-sm">
            on day
            <Input type="number" min={1} max={28} className="w-20" value={schedule.dayOfMonth} onChange={(e) => onChange({ dayOfMonth: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })} />
          </label>
        )}
        {schedule.type === 'cron' && <Input className="w-48 font-mono" placeholder="0 1 * * 1-5" value={schedule.cron} onChange={(e) => onChange({ cron: e.target.value })} />}
        {schedule.type !== 'manual' && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
            Enabled
          </label>
        )}
      </div>
      {schedule.type === 'weekly' && (
        <div className="mb-3 flex flex-wrap gap-1">
          {days.map((d, i) => (
            <button
              key={d}
              onClick={() => onChange({ weekdays: schedule.weekdays.includes(i) ? schedule.weekdays.filter((x) => x !== i) : [...schedule.weekdays, i] })}
              className={`rounded-md border px-2 py-1 text-xs ${schedule.weekdays.includes(i) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {describeSchedule(schedule)}
        {schedule.type !== 'manual' &&
          (upcoming.length ? ` · next: ${upcoming.map((d) => formatInTimezone(d, schedule.timezone)).join(' · ')}` : ' · invalid schedule')}
        {schedule.type !== 'manual' && !enabled && ' · disabled, will not run automatically'}
      </p>
    </section>
  )
}

export function SampleTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 20)
  const show = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return (
    <div className="mt-3 max-h-72 overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">
              {cols.map((c) => (
                <td key={c} className="max-w-[220px] truncate whitespace-nowrap px-2 py-1 font-mono" title={show(r[c])}>
                  {show(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
