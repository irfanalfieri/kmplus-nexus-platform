'use client'

import { useMemo, useState } from 'react'
import { Eraser, FileJson, Loader2, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { useConfirm } from '@/components/ui/dialog'
import { useT } from '@/components/i18n/i18n-provider'
import { useCan } from '@/components/workspace/workspace-context'
import {
  CACHE_MAX_HOURS,
  CHANGE_METHODS,
  COLUMN_TYPES,
  ENRICH_METHODS,
  isBatchBody,
  type AnswerMapping,
  type ApiCallStep,
  type ApiRequestSpec,
  type ColumnType,
  type EnrichStep,
} from '@/lib/pipelines/definition'
import { answerTree } from '@/lib/pipelines/api-calls'
import { clearStepCache, sendApiCallTest, sendEnrichTestCall } from '@/lib/actions/pipelines'
import { setMaxCallsPerRun } from '@/lib/actions/data-sources'
import { BodyDialog } from './api-destination-editor'
import { ColumnPicker, Field, NativeSelect, type BuilderOptions, type Column } from './step-editors'

const clamp = (v: string, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min
}

/** Picks values from a sample answer (pasted or from a test call) into named, typed columns. */
function AnswerMappingEditor({ mapping, onChange }: { mapping: AnswerMapping; onChange: (m: AnswerMapping) => void }) {
  const t = useT()
  const tree = useMemo(() => (mapping.sample.trim() ? answerTree(mapping.sample) : null), [mapping.sample])
  const leaves = tree ? tree.leaves(mapping.listPath) : []
  const picked = new Map(mapping.fields.map((f) => [f.path, f]))
  const toggle = (path: string, on: boolean) => {
    const name = path.split('.').pop()!.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1')
    onChange({ ...mapping, fields: on ? [...mapping.fields, { path, as: name || 'value', type: 'text' }] : mapping.fields.filter((f) => f.path !== path) })
  }
  const setField = (path: string, patch: Partial<AnswerMapping['fields'][number]>) => onChange({ ...mapping, fields: mapping.fields.map((f) => (f.path === path ? { ...f, ...patch } : f)) })
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-2">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{t('steps.answer.title')}</legend>
      <Field label={t('steps.answer.sample')}>
        <textarea
          value={mapping.sample}
          onChange={(e) => onChange({ ...mapping, sample: e.target.value })}
          rows={4}
          className="w-full rounded-md border border-input bg-card px-2 py-1 font-mono text-xs outline-none focus-visible:outline-2 focus-visible:outline-ring"
          placeholder='{"data": {"salary": 12500000}}'
        />
      </Field>
      {mapping.sample.trim() && !tree && <Notice tone="warning">{t('steps.answer.notJson')}</Notice>}
      {tree && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label={t('steps.answer.list')}>
              <NativeSelect value={mapping.listPath} onChange={(v) => onChange({ ...mapping, listPath: v, fields: [] })}>
                <option value="">{t('steps.answer.wholeAnswer')}</option>
                {tree.lists.map((l) => (
                  <option key={l} value={l}>
                    {l || t('steps.answer.topList')}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t('steps.answer.listMode')}>
              <NativeSelect value={mapping.listMode} disabled={!mapping.listPath} onChange={(v) => onChange({ ...mapping, listMode: v as AnswerMapping['listMode'] })}>
                <option value="rows">{t('steps.answer.modeRows')}</option>
                <option value="first">{t('steps.answer.modeFirst')}</option>
                <option value="json">{t('steps.answer.modeJson')}</option>
              </NativeSelect>
            </Field>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label={t('steps.answer.values')}>
            {leaves.map((l) => {
              const f = picked.get(l.path)
              return (
                <li key={l.path} className="grid grid-cols-[auto_1fr] items-center gap-1.5 text-xs">
                  <input type="checkbox" className="size-3.5 accent-primary" checked={Boolean(f)} onChange={(e) => toggle(l.path, e.target.checked)} aria-label={t('steps.answer.pick', { path: l.path })} />
                  <span className="truncate font-mono" title={l.example}>
                    {l.path} <span className="text-muted-foreground">{l.example}</span>
                  </span>
                  {f && (
                    <div className="col-span-2 grid grid-cols-[1fr_7rem] gap-1.5 pl-5">
                      <Input value={f.as} onChange={(e) => setField(l.path, { as: e.target.value.trim() })} aria-label={t('steps.answer.columnName', { path: l.path })} className="h-7 font-mono text-xs" />
                      <NativeSelect value={f.type} onChange={(v) => setField(l.path, { type: v as ColumnType })} aria-label={t('steps.answer.columnType', { path: l.path })} className="h-7">
                        {COLUMN_TYPES.map((ty) => (
                          <option key={ty} value={ty}>
                            {ty}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {mapping.fields.length > 0 && <p className="text-xs text-muted-foreground">{t('steps.answer.adds', { columns: mapping.fields.map((f) => f.as).join(', ') })}</p>}
    </fieldset>
  )
}

function RestSourcePicker({ value, options, role, onChange, label }: { value: string; options: BuilderOptions; role?: 'destination'; onChange: (id: string) => void; label: string }) {
  const t = useT()
  const sources = options.dataSources.filter((d) => d.sourceType === 'rest' && (!role || d.role === role))
  return (
    <Field label={label}>
      <NativeSelect value={value} onChange={onChange}>
        <option value="">{t('steps.enrich.chooseSource')}</option>
        {sources.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  )
}

/** Calls per run for the step's data source; admins raise it here. */
function CallCap({ dataSourceId, options }: { dataSourceId: string; options: BuilderOptions }) {
  const t = useT()
  const canRaise = useCan('sources:manage')
  const source = options.dataSources.find((d) => d.id === dataSourceId)
  const [value, setValue] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  if (!source) return null
  const max = (source as { maxCallsPerRun?: number }).maxCallsPerRun ?? 50_000
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{t('steps.enrich.cap', { max, name: source.name })}</p>
      {canRaise && (
        <div className="flex items-center gap-1.5">
          <Input type="number" min={1} value={value} placeholder={String(max)} onChange={(e) => setValue(e.target.value)} className="h-8 w-32 font-mono" aria-label={t('steps.enrich.capLabel', { name: source.name })} />
          <Button
            size="sm"
            variant="outline"
            disabled={!value || state === 'saving'}
            onClick={async () => {
              setState('saving')
              try {
                await setMaxCallsPerRun(source.id, Number(value))
                setState('saved')
              } catch {
                setState('error')
              }
            }}
          >
            {t('steps.enrich.capSave')}
          </Button>
          {state === 'saved' && <span className="text-xs text-live-text">{t('steps.enrich.capSaved')}</span>}
          {state === 'error' && <span className="text-xs text-danger-text">{t('steps.enrich.capError')}</span>}
        </div>
      )}
    </div>
  )
}

function Pace({ step, onChange }: { step: { maxRequestsPerSecond: number; concurrency: number; timeoutSeconds: number }; onChange: (patch: Partial<{ maxRequestsPerSecond: number; concurrency: number; timeoutSeconds: number }>) => void }) {
  const t = useT()
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <Field label={t('steps.enrich.rate')}>
        <Input type="number" min={0.1} max={50} step={0.5} value={step.maxRequestsPerSecond} onChange={(e) => onChange({ maxRequestsPerSecond: Math.min(50, Math.max(0.1, Number(e.target.value) || 0.1)) })} className="font-mono" />
      </Field>
      <Field label={t('steps.enrich.concurrency')}>
        <Input type="number" min={1} max={4} value={step.concurrency} onChange={(e) => onChange({ concurrency: clamp(e.target.value, 1, 4) })} className="font-mono" />
      </Field>
      <Field label={t('steps.enrich.timeout')}>
        <Input type="number" min={1} max={120} value={step.timeoutSeconds} onChange={(e) => onChange({ timeoutSeconds: clamp(e.target.value, 1, 120) })} className="font-mono" />
      </Field>
    </div>
  )
}

/** Method, path and (for POST/PUT/PATCH) a body from a pasted example. */
function RequestFields({ request, methods, columns, onChange, label }: { request: { method: string; path: string; body: ApiRequestSpec['body'] }; methods: readonly string[]; columns: Column[]; onChange: (r: { method: string; path: string; body: ApiRequestSpec['body'] }) => void; label?: string }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const fields = request.body.template.t === 'object' ? request.body.template.fields.length : 1
  return (
    <div className="space-y-1.5">
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="grid grid-cols-[6rem_1fr] gap-1.5">
        <NativeSelect value={request.method} onChange={(v) => onChange({ ...request, method: v })} aria-label={t('steps.enrich.method')}>
          {methods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </NativeSelect>
        <Input value={request.path} onChange={(e) => onChange({ ...request, path: e.target.value })} placeholder="/employees/{{employee_code}}" aria-label={t('steps.enrich.path')} className="font-mono" />
      </div>
      {request.method !== 'GET' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <FileJson aria-hidden /> {t('steps.enrich.body')}
          </Button>
          {fields ? t('steps.enrich.bodyFields', { count: fields }) : t('steps.enrich.noBody')}
        </div>
      )}
      {editing && <BodyDialog step={{ body: request.body, path: request.path }} columns={columns} onClose={() => setEditing(false)} onSave={(body) => (onChange({ ...request, body }), setEditing(false))} />}
    </div>
  )
}

// ── Enrich ───────────────────────────────────────────────────────────────────

export function EnrichEditor({ step, columns, options, sampleRow, pipelineId, onChange }: { step: EnrichStep; columns: Column[]; options: BuilderOptions; sampleRow?: Record<string, unknown>; pipelineId?: string; onChange: (s: EnrichStep) => void }) {
  const t = useT()
  const [busy, setBusy] = useState<null | 'test' | 'clear'>(null)
  const [note, setNote] = useState('')
  const [confirm, confirmEl] = useConfirm()
  const set = (patch: Partial<EnrichStep>) => onChange({ ...step, ...patch })
  const batch = step.mode !== 'row'

  const testCall = async () => {
    if (!sampleRow) return setNote(t('steps.enrich.testFirst'))
    setBusy('test')
    setNote('')
    try {
      const res = await sendEnrichTestCall({ pipelineId, step, row: sampleRow })
      if (res.status !== null && res.status < 300 && res.answer) set({ answer: { ...step.answer, sample: res.answer } })
      setNote(res.message || t('steps.enrich.testDone', { status: res.status ?? '—', count: res.mapped.length }))
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }
  const clear = async () => {
    if (!pipelineId) return
    if (!(await confirm({ title: t('steps.enrich.clearTitle'), description: t('steps.enrich.clearBody'), confirmLabel: t('steps.enrich.clear') }))) return
    setBusy('clear')
    try {
      const { removed } = await clearStepCache(pipelineId, step.id)
      setNote(t('steps.enrich.cleared', { count: removed }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-3">
      {confirmEl}
      <p className="text-xs text-muted-foreground">{t('steps.enrich.help')}</p>
      <RestSourcePicker value={step.dataSourceId} options={options} onChange={(v) => set({ dataSourceId: v })} label={t('steps.enrich.dataSource')} />
      <Field label={t('steps.enrich.mode')}>
        <NativeSelect value={step.mode} onChange={(v) => set({ mode: v as EnrichStep['mode'], method: v === 'body' ? 'POST' : step.method })}>
          <option value="row">{t('steps.enrich.modeRow')}</option>
          <option value="query">{t('steps.enrich.modeQuery')}</option>
          <option value="body">{t('steps.enrich.modeBody')}</option>
        </NativeSelect>
      </Field>
      <RequestFields request={step} methods={ENRICH_METHODS} columns={columns} onChange={(r) => set({ method: r.method as EnrichStep['method'], path: r.path, body: r.body })} />
      {batch && (
        <div className="grid gap-1.5 rounded-md border border-border p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label={t('steps.enrich.keyColumn')}>
              <ColumnPicker columns={columns} value={step.keyColumn} onChange={(v) => set({ keyColumn: v })} label={null} />
            </Field>
            {step.mode === 'query' ? (
              <Field label={t('steps.enrich.queryParam')}>
                <Input value={step.queryParam} onChange={(e) => set({ queryParam: e.target.value.trim() })} className="font-mono" />
              </Field>
            ) : (
              <p className="self-end text-xs text-muted-foreground">{isBatchBody(step.body.template) ? t('steps.enrich.bodyListOk') : t('steps.enrich.bodyListMissing')}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label={t('steps.enrich.matchField')}>
              <Input value={step.matchField} onChange={(e) => set({ matchField: e.target.value.trim() })} placeholder="employee_code" className="font-mono" />
            </Field>
            <Field label={t('steps.enrich.batchSize')}>
              <Input type="number" min={1} max={500} value={step.batchSize} onChange={(e) => set({ batchSize: clamp(e.target.value, 1, 500) })} className="font-mono" />
            </Field>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null || !step.dataSourceId} onClick={() => void testCall()}>
          {busy === 'test' ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} {t('steps.enrich.testCall')}
        </Button>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      <AnswerMappingEditor mapping={step.answer} onChange={(answer) => set({ answer })} />
      <Field label={t('steps.enrich.noMatch')}>
        <NativeSelect value={step.onNoMatch} onChange={(v) => set({ onNoMatch: v as EnrichStep['onNoMatch'] })}>
          <option value="keep">{t('steps.join.noMatchKeep')}</option>
          <option value="drop">{t('steps.join.noMatchDrop')}</option>
          <option value="quarantine">{t('steps.join.noMatchQuarantine')}</option>
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-[1fr_auto] items-end gap-1.5">
        <Field label={t('steps.enrich.cacheHours', { max: CACHE_MAX_HOURS })}>
          <Input type="number" min={0} max={CACHE_MAX_HOURS} value={step.cacheHours} onChange={(e) => set({ cacheHours: clamp(e.target.value, 0, CACHE_MAX_HOURS) })} className="font-mono" />
        </Field>
        <Button size="sm" variant="ghost" disabled={!pipelineId || busy !== null} onClick={() => void clear()}>
          <Eraser aria-hidden /> {t('steps.enrich.clear')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('steps.enrich.cacheHelp')}</p>
      <Pace step={step} onChange={(patch) => set(patch)} />
      <CallCap dataSourceId={step.dataSourceId} options={options} />
      <Notice tone="info">{t('steps.enrich.testNote')}</Notice>
    </div>
  )
}

// ── "Changes data" ───────────────────────────────────────────────────────────

export function ApiCallEditor({ step, columns, options, sampleRow, pipelineId, onChange }: { step: ApiCallStep; columns: Column[]; options: BuilderOptions; sampleRow?: Record<string, unknown>; pipelineId?: string; onChange: (s: ApiCallStep) => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [confirm, confirmEl] = useConfirm()
  const set = (patch: Partial<ApiCallStep>) => onChange({ ...step, ...patch })
  const target = options.dataSources.find((d) => d.id === step.dataSourceId)

  const testCall = async () => {
    if (!pipelineId) return setNote(t('steps.apicall.saveFirst'))
    if (!sampleRow) return setNote(t('steps.enrich.testFirst'))
    const ok = await confirm({
      title: t('steps.apicall.testTitle', { name: target?.name ?? '' }),
      description: t('steps.apicall.testBody', { method: step.create.method, path: step.create.path }),
      confirmLabel: t('steps.apicall.testConfirm'),
      tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    setNote('')
    try {
      const res = await sendApiCallTest({ pipelineId, step, row: sampleRow })
      setNote(res.message || (res.sent ? t('steps.apicall.testSent', { values: JSON.stringify(res.answer) }) : t('steps.apicall.testKnown')))
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      {confirmEl}
      <Notice tone="warning">{t('steps.apicall.outward')}</Notice>
      <p className="text-xs text-muted-foreground">{t('steps.apicall.help')}</p>
      <RestSourcePicker value={step.dataSourceId} options={options} role="destination" onChange={(v) => set({ dataSourceId: v })} label={t('steps.apicall.dataSource')} />
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-muted-foreground">{t('steps.apicall.keys')}</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {columns.map((c) => (
            <label key={c.name} className="flex items-center gap-1.5 font-mono text-xs">
              <input type="checkbox" className="size-3.5 accent-primary" checked={step.keys.includes(c.name)} onChange={(e) => set({ keys: e.target.checked ? [...step.keys, c.name] : step.keys.filter((k) => k !== c.name) })} />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      <RequestFields label={t('steps.apicall.create')} request={step.create} methods={CHANGE_METHODS} columns={columns} onChange={(r) => set({ create: { ...step.create, ...r, method: r.method as ApiRequestSpec['method'] } })} />
      {step.update ? (
        <div className="space-y-1.5 rounded-md border border-border p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('steps.apicall.updateHelp')}</span>
            <Button size="icon-sm" variant="ghost" onClick={() => set({ update: undefined })} aria-label={t('steps.apicall.removeUpdate')}>
              <X aria-hidden />
            </Button>
          </div>
          <RequestFields label={t('steps.apicall.update')} request={step.update} methods={CHANGE_METHODS} columns={[...columns, ...step.answer.fields.map((f) => ({ name: f.as, type: f.type }))]} onChange={(r) => set({ update: { ...step.update!, ...r, method: r.method as ApiRequestSpec['method'] } })} />
        </div>
      ) : (
        <div>
          <Button size="sm" variant="outline" onClick={() => set({ update: { method: 'PUT', path: step.create.path, body: step.create.body } })}>
            {t('steps.apicall.addUpdate')}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">{t('steps.apicall.noUpdate')}</p>
        </div>
      )}
      <AnswerMappingEditor mapping={step.answer} onChange={(answer) => set({ answer })} />
      <Field label={t('steps.apicall.idempotency')}>
        <Input value={step.idempotencyHeader} onChange={(e) => set({ idempotencyHeader: e.target.value.trim() })} className="font-mono" />
      </Field>
      <p className="text-xs text-muted-foreground">{t('steps.apicall.idempotencyHelp')}</p>
      <Pace step={step} onChange={(patch) => set(patch)} />
      <CallCap dataSourceId={step.dataSourceId} options={options} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy || !step.dataSourceId} onClick={() => void testCall()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} {t('steps.apicall.testCall')}
        </Button>
        {note && <span className="break-all text-xs text-muted-foreground">{note}</span>}
      </div>
      <Notice tone="info">{t('steps.apicall.dryRun')}</Notice>
    </div>
  )
}
