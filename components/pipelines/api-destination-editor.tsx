'use client'

import { useMemo, useState } from 'react'
import { Eye, Loader2, Send, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { cn } from '@/lib/utils'
import {
  API_METHODS,
  BODY_FORMATS,
  BODY_META,
  BODY_VALUE_TYPES,
  PATH_PLACEHOLDER,
  apiDestinationIssues,
  isBatchBody,
  type BodyBinding,
  type BodyFormat,
  type BodyNode,
  type DestinationStep,
} from '@/lib/pipelines/definition'
import {
  BodySampleError,
  autoBindBody,
  bodyArrays,
  bodyColumns,
  bodyLeaves,
  bodyRepeatables,
  carryOverBody,
  parseBodySample,
  renderRequests,
  repeatElement,
  setRowsArray,
  updateBodyNode,
  type BodyLeaf,
} from '@/lib/pipelines/body-template'
import { localizeCheck } from '@/lib/pipelines/check-messages'
import { localizeServerError } from '@/lib/i18n/server-errors'
import { suggestColumnPolicy } from '@/lib/governance/definition'
import { sendApiTestRequest } from '@/lib/actions/pipelines'
import type { ApiTestResult } from '@/lib/connectors/rest/write'
import { ExprEditor } from './expr-editor'
import { ColumnPicker, Field, NativeSelect, type BuilderOptions, type Column } from './step-editors'

export type ApiStep = Extract<DestinationStep, { kind: 'api' }>
type Leaf = Extract<BodyNode, { t: 'value' }>

/** A new API destination step for a REST data source (defaults match the schema). */
export function newApiDestination(base: { id: string; position: { x: number; y: number } }, dataSourceId: string): ApiStep {
  return {
    ...base,
    type: 'destination',
    kind: 'api',
    dataSourceId,
    method: 'POST',
    path: '/',
    body: { format: 'json', sample: '', template: { t: 'object', fields: [] } },
    batchSize: 100,
    maxRequestsPerSecond: 10,
    concurrency: 1,
    timeoutSeconds: 30,
    idempotencyKey: false,
    idempotencyHeader: 'Idempotency-Key',
    response: { rejectedPath: '', indexField: 'index', indexBase: 0, messageField: 'message' },
    mode: 'append',
    keys: [],
    softDeleteMissing: false,
  }
}

const num = (v: string, min: number, max: number, int = true) => {
  const n = int ? Math.round(Number(v)) : Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

/** Destination step fields for a REST API: request, body, pace, duplicates, refused items, tests. */
export function ApiDestinationFields({
  step,
  options,
  columns,
  sampleRow,
  pipelineId,
  onChange,
}: {
  step: ApiStep
  options: BuilderOptions
  columns: Column[]
  sampleRow?: Record<string, unknown>
  pipelineId?: string
  onChange: (s: ApiStep) => void
}) {
  const { t, locale } = usePrefs()
  const [editing, setEditing] = useState(false)
  const [preview, setPreview] = useState(false)
  const [result, setResult] = useState<ApiTestResult | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [confirm, confirmEl] = useConfirm()
  const target = options.dataSources.find((d) => d.id === step.dataSourceId)
  const leaves = bodyLeaves(step.body.template)
  const mapped = leaves.filter((l) => l.node.binding.kind !== 'none').length
  const batch = isBatchBody(step.body.template)
  const rowsPath = bodyArrays(step.body.template).find((a) => a.items === 'rows')?.path ?? ''
  const issues = apiDestinationIssues(step)
  const names = new Set(columns.map((c) => c.name))
  const unknown = [...step.path.matchAll(new RegExp(PATH_PLACEHOLDER.source, 'g'))].map((m) => m[1]).filter((n) => columns.length && !names.has(n))
  const classified = (options.classifiedColumns ?? {}) as Record<string, string>
  const personal = bodyColumns(step.body.template, step.path).filter((c) => classified[c] || ['personal', 'sensitive'].includes(suggestColumnPolicy(c).classification))
  const set = (patch: Partial<ApiStep>) => onChange({ ...step, ...patch })

  const send = async () => {
    if (!sampleRow) return
    const ok = await confirm({
      title: t('steps.destination.api.sendConfirmTitle', { name: target?.name ?? '' }),
      description: t('steps.destination.api.sendConfirmBody', { method: step.method, path: step.path }),
      confirmLabel: t('steps.destination.api.sendConfirm'),
    })
    if (!ok) return
    setSending(true)
    setSendError('')
    try {
      setResult(await sendApiTestRequest({ pipelineId, step, row: sampleRow }))
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="grid gap-3" data-tour="api-destination">
      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
        <Field label={t('steps.destination.api.method')}>
          <NativeSelect value={step.method} onChange={(v) => set({ method: v as ApiStep['method'] })}>
            {API_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('steps.destination.api.path')}>
          <Input value={step.path} onChange={(e) => set({ path: e.target.value })} placeholder="/employees/{{employee_id}}" className="font-mono" spellCheck={false} />
        </Field>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">{t('steps.destination.api.pathHelp')}</p>
      {unknown.length > 0 && <p className="text-xs text-warning-text">{t('steps.destination.api.pathUnknown', { names: unknown.join(', ') })}</p>}

      <section className="space-y-2 rounded-md border border-border p-2" aria-label={t('steps.destination.api.body')}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-medium text-muted-foreground">{t('steps.destination.api.body')}</h4>
            {leaves.length ? (
              <>
                <p className="font-mono text-xs tabular-nums">
                  {t(`steps.destination.api.formats.${step.body.format}`)} · {t('steps.destination.api.bodySummary', { mapped, count: leaves.length })}
                </p>
                <p className="text-xs text-muted-foreground">{batch ? t('steps.destination.api.modeBatch', { size: step.batchSize, path: rowsPath }) : t('steps.destination.api.modeSingle')}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t('steps.destination.api.bodyEmpty')}</p>
            )}
          </div>
          <Button size="sm" variant={leaves.length ? 'outline' : 'default'} onClick={() => setEditing(true)}>
            {t('steps.destination.api.editBody')}
          </Button>
        </div>
      </section>

      {issues.length > 0 && (
        <Notice tone="danger" className="text-xs">
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.map((m) => (
              <li key={m}>{localizeServerError(m, locale)}</li>
            ))}
          </ul>
        </Notice>
      )}
      {personal.length > 0 && (
        <Notice tone="warning" className="text-xs">
          {t('steps.destination.api.personal', { columns: personal.join(', ') })}
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-2">
        {batch && (
          <Field label={t('steps.destination.api.batchSize')}>
            <Input type="number" min={1} max={1000} value={step.batchSize} onChange={(e) => set({ batchSize: num(e.target.value, 1, 1000) })} className="font-mono tabular-nums" />
          </Field>
        )}
        <Field label={t('steps.destination.api.rate')}>
          <Input type="number" min={0.1} max={50} step={0.1} value={step.maxRequestsPerSecond} onChange={(e) => set({ maxRequestsPerSecond: num(e.target.value, 0.1, 50, false) })} className="font-mono tabular-nums" />
        </Field>
        <Field label={t('steps.destination.api.concurrency')}>
          <NativeSelect value={String(step.concurrency)} onChange={(v) => set({ concurrency: Number(v) })}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('steps.destination.api.timeout')}>
          <Input type="number" min={1} max={120} value={step.timeoutSeconds} onChange={(e) => set({ timeoutSeconds: num(e.target.value, 1, 120) })} className="font-mono tabular-nums" />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={step.idempotencyKey} onChange={(e) => set({ idempotencyKey: e.target.checked })} />
        <span>
          {t('steps.destination.api.idempotency')}
          <span className="block text-xs text-muted-foreground">{t('steps.destination.api.idempotencyHelp')}</span>
        </span>
      </label>
      {step.idempotencyKey && (
        <Field label={t('steps.destination.api.idempotencyHeader')}>
          <Input value={step.idempotencyHeader} onChange={(e) => set({ idempotencyHeader: e.target.value })} className="font-mono" spellCheck={false} />
        </Field>
      )}
      {step.method === 'POST' && (
        <Notice tone="warning" className="text-xs">
          {t('steps.destination.api.duplicatesPost')}
        </Notice>
      )}
      <p className="text-xs text-muted-foreground">{t('steps.destination.api.retryNote')}</p>

      <details className="rounded-md border border-border p-2 text-sm" open={!!step.response.rejectedPath}>
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t('steps.destination.api.response')}</summary>
        <p className="mt-1 text-xs text-muted-foreground">{t('steps.destination.api.responseHelp')}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label={t('steps.destination.api.rejectedPath')} className="col-span-2">
            <Input value={step.response.rejectedPath} onChange={(e) => set({ response: { ...step.response, rejectedPath: e.target.value } })} placeholder="errors" className="font-mono" spellCheck={false} />
          </Field>
          <Field label={t('steps.destination.api.indexField')}>
            <Input value={step.response.indexField} onChange={(e) => set({ response: { ...step.response, indexField: e.target.value } })} className="font-mono" spellCheck={false} />
          </Field>
          <Field label={t('steps.destination.api.indexBase')}>
            <NativeSelect value={String(step.response.indexBase)} onChange={(v) => set({ response: { ...step.response, indexBase: v === '1' ? 1 : 0 } })}>
              <option value="0">0</option>
              <option value="1">1</option>
            </NativeSelect>
          </Field>
          <Field label={t('steps.destination.api.messageField')} className="col-span-2">
            <Input value={step.response.messageField} onChange={(e) => set({ response: { ...step.response, messageField: e.target.value } })} className="font-mono" spellCheck={false} />
          </Field>
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!sampleRow || !leaves.length} onClick={() => setPreview(true)}>
          <Eye aria-hidden /> {t('steps.destination.api.preview')}
        </Button>
        <Button size="sm" variant="outline" disabled={!sampleRow || !leaves.length || sending || !step.dataSourceId} onClick={send}>
          {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} {sending ? t('steps.destination.api.sending') : t('steps.destination.api.send')}
        </Button>
      </div>
      {!sampleRow && <p className="text-xs text-muted-foreground">{t('steps.destination.api.noSampleRow')}</p>}
      {sendError && <Notice tone="danger">{sendError}</Notice>}

      {editing && <BodyDialog step={step} columns={columns} onClose={() => setEditing(false)} onSave={(body) => (set({ body }), setEditing(false))} />}
      {preview && sampleRow && <PreviewDialog step={step} row={sampleRow} onClose={() => setPreview(false)} />}
      {result && <ResultDialog result={result} onClose={() => setResult(null)} />}
      {confirmEl}
    </div>
  )
}

// ── Body mapping ─────────────────────────────────────────────────────────────

function sampleError(err: unknown, t: ReturnType<typeof usePrefs>['t']) {
  if (err instanceof BodySampleError) return t(`steps.destination.body.errors.${err.code}`, { detail: err.detail })
  return err instanceof Error ? err.message : String(err)
}

/** Edits a request body from a pasted example (API destinations, Enrich POST bodies, "Changes data" requests). */
export function BodyDialog({ step, columns, onClose, onSave }: { step: Pick<ApiStep, 'body' | 'path'>; columns: Column[]; onClose: () => void; onSave: (body: ApiStep['body']) => void }) {
  const { t, locale } = usePrefs()
  const [format, setFormat] = useState<BodyFormat>(step.body.format)
  const [sample, setSample] = useState(step.body.sample)
  const [template, setTemplate] = useState<BodyNode>(step.body.template)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const dirty = format !== step.body.format || sample !== step.body.sample || template !== step.body.template
  const leaves = bodyLeaves(template)
  const batch = isBatchBody(template)
  const arrays = bodyArrays(template).filter((a) => !a.nested)
  const repeatables = format === 'xml' ? bodyRepeatables(template) : []
  const rows = arrays.find((a) => a.items === 'rows')
  const issues = apiDestinationIssues({ path: step.path, body: { format, sample, template } })
  const names = columns.map((c) => c.name)

  const read = () => {
    setError('')
    try {
      const parsed = carryOverBody(parseBodySample(format, sample), template)
      const { template: bound } = autoBindBody(parsed, names)
      setTemplate(bound)
      setNote(t('steps.destination.body.readDone', { count: bodyLeaves(bound).length }))
    } catch (err) {
      setError(sampleError(err, t))
    }
  }
  const autoMatch = () => {
    const { template: bound, bound: count } = autoBindBody(template, names)
    setTemplate(bound)
    setNote(t('steps.destination.body.autoMatched', { count }))
  }
  const setRows = (value: string) => {
    if (value === 'none') return setTemplate(setRowsArray(template, null))
    const [kind, raw] = value.split(':')
    const addr = raw ? raw.split('.').map(Number) : []
    setTemplate(kind === 'x' ? setRowsArray(repeatElement(template, addr), addr) : setRowsArray(template, addr))
  }
  const updateLeaf = (leaf: BodyLeaf, patch: Partial<Leaf>) => setTemplate(updateBodyNode(template, leaf.addr, (n) => (n.t === 'value' ? { ...n, ...patch } : n)))

  return (
    <Modal
      onClose={onClose}
      dirty={dirty}
      size="full"
      title={t('steps.destination.body.title')}
      description={t('steps.destination.body.description')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onSave({ format, sample, template })} disabled={!leaves.length}>
            {t('steps.destination.body.apply')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="space-y-2">
          <Field label={t('steps.destination.api.format')}>
            <NativeSelect value={format} onChange={(v) => setFormat(v as BodyFormat)}>
              {BODY_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`steps.destination.api.formats.${f}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('steps.destination.body.sample')}>
            <textarea
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              rows={14}
              spellCheck={false}
              maxLength={50_000}
              placeholder={format === 'json' ? '{\n  "employee_id": "E001",\n  "name": "Ani"\n}' : format === 'form' ? 'employee_id=E001&name=Ani' : '<employee>\n  <id>E001</id>\n  <name>Ani</name>\n</employee>'}
              className="w-full rounded-md border border-input bg-card p-2 font-mono text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={read}>
              {t('steps.destination.body.read')}
            </Button>
            <Button size="sm" variant="outline" onClick={autoMatch} disabled={!leaves.length || !names.length}>
              <Wand2 aria-hidden /> {t('steps.destination.body.autoMatch')}
            </Button>
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          {note && !error && <p className="text-xs text-muted-foreground" role="status">{note}</p>}
          {(arrays.length > 0 || repeatables.length > 0) && (
            <Field label={t('steps.destination.body.rowsList')}>
              <NativeSelect
                value={rows ? `a:${rows.addr.join('.')}` : 'none'}
                onChange={setRows}
              >
                <option value="none">{t('steps.destination.body.rowsNone')}</option>
                {arrays.map((a) => (
                  <option key={`a:${a.addr.join('.')}`} value={`a:${a.addr.join('.')}`}>
                    {t('steps.destination.body.rowsArray', { path: a.path })}
                  </option>
                ))}
                {repeatables.map((r) => (
                  <option key={`x:${r.addr.join('.')}`} value={`x:${r.addr.join('.')}`}>
                    {t('steps.destination.body.rowsRepeat', { path: r.path })}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {batch && <p className="text-xs text-muted-foreground">{t('steps.destination.body.outsideRowsHelp')}</p>}
        </div>

        <div className="min-w-0 space-y-2">
          {issues.length > 0 && (
            <Notice tone="danger" className="text-xs">
              <ul className="list-disc space-y-0.5 pl-4">
                {issues.map((m) => (
                  <li key={m}>{localizeServerError(m, locale)}</li>
                ))}
              </ul>
            </Notice>
          )}
          {leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground">{sample.trim() ? t('steps.destination.body.noLeaves') : t('steps.destination.api.bodyEmpty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-muted/60">
                  <tr className="text-left font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="w-[28%] min-w-36 px-3 py-2 font-medium">{t('steps.destination.body.path')}</th>
                    <th className="px-2 py-2 font-medium">{t('steps.destination.body.value')}</th>
                    <th className="px-2 py-2 font-medium">{t('steps.destination.body.type')}</th>
                    <th className="px-2 py-2 font-medium">{t('steps.destination.body.required')}</th>
                    <th className="px-3 py-2 font-medium">{t('steps.destination.body.ifEmpty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((leaf) => (
                    <LeafRow key={leaf.path} leaf={leaf} columns={columns} outside={batch && !leaf.inRows} format={format} onChange={(patch) => updateLeaf(leaf, patch)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

const BINDINGS = ['none', 'column', 'constant', 'expr', 'meta'] as const

function newBinding(kind: (typeof BINDINGS)[number], columns: Column[], current: BodyBinding): BodyBinding {
  switch (kind) {
    case 'none':
      return { kind: 'none' }
    case 'column':
      return { kind: 'column', column: current.kind === 'expr' && current.expr.kind === 'field' ? current.expr.name : columns[0]?.name ?? '' }
    case 'constant':
      return { kind: 'constant', value: '' }
    case 'expr':
      return { kind: 'expr', expr: current.kind === 'column' ? { kind: 'field', name: current.column } : { kind: 'field', name: columns[0]?.name ?? '' } }
    case 'meta':
      return { kind: 'meta', name: 'batch_id' }
  }
}

function LeafRow({ leaf, columns, outside, format, onChange }: { leaf: BodyLeaf; columns: Column[]; outside: boolean; format: BodyFormat; onChange: (patch: Partial<Leaf>) => void }) {
  const { t } = usePrefs()
  const n = leaf.node
  const kinds = outside ? BINDINGS.filter((k) => k !== 'column' && k !== 'expr') : BINDINGS
  const label = (s: string) => `${leaf.path}: ${s}`
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2">
        {/* Break only between path parts, never inside a key. */}
        <code className="font-mono text-xs">
          {leaf.path.split('.').map((part, i) => (
            <span key={i}>
              {i > 0 && (
                <>
                  .<wbr />
                </>
              )}
              {part}
            </span>
          ))}
        </code>
        {outside && <span className="block text-[11px] text-muted-foreground">{t('steps.destination.body.outsideRows')}</span>}
      </td>
      <td className="min-w-56 px-2 py-1.5">
        <div className="space-y-1.5">
          <NativeSelect value={n.binding.kind} onChange={(v) => onChange({ binding: newBinding(v as (typeof BINDINGS)[number], columns, n.binding) })} aria-label={label(t('steps.destination.body.value'))}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`steps.destination.body.binding.${k}`)}
              </option>
            ))}
          </NativeSelect>
          {n.binding.kind === 'column' && <ColumnPicker columns={columns} value={n.binding.column} onChange={(column) => onChange({ binding: { kind: 'column', column } })} label={label(t('steps.destination.body.binding.column'))} />}
          {n.binding.kind === 'constant' && (
            <Input value={n.binding.value} onChange={(e) => onChange({ binding: { kind: 'constant', value: e.target.value } })} aria-label={label(t('steps.destination.body.binding.constant'))} className="font-mono" />
          )}
          {n.binding.kind === 'meta' && (
            <NativeSelect value={n.binding.name} onChange={(v) => onChange({ binding: { kind: 'meta', name: v as (typeof BODY_META)[number] } })} aria-label={label(t('steps.destination.body.binding.meta'))}>
              {BODY_META.map((m) => (
                <option key={m} value={m}>
                  {t(`steps.destination.body.meta.${m}`)}
                </option>
              ))}
            </NativeSelect>
          )}
          {n.binding.kind === 'expr' && <ExprEditor expr={n.binding.expr} columns={columns} onChange={(expr) => onChange({ binding: { kind: 'expr', expr } })} />}
        </div>
      </td>
      <td className="px-2 py-1.5">
        <NativeSelect className="min-w-32" value={n.type} onChange={(v) => onChange({ type: v as Leaf['type'] })} aria-label={label(t('steps.destination.body.type'))} disabled={format !== 'json' && n.type === 'auto'}>
          {BODY_VALUE_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`steps.destination.body.types.${ty}`)}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="px-2 py-2 text-center">
        <input type="checkbox" className="size-4 accent-primary" checked={n.required} onChange={(e) => onChange({ required: e.target.checked })} aria-label={t('steps.destination.body.requiredLabel', { path: leaf.path })} />
      </td>
      <td className="px-3 py-1.5">
        <NativeSelect value={n.empty} onChange={(v) => onChange({ empty: v as Leaf['empty'] })} aria-label={label(t('steps.destination.body.ifEmpty'))} disabled={n.required}>
          {(['null', 'omit', 'empty'] as const).map((e) => (
            <option key={e} value={e}>
              {t(`steps.destination.body.empty.${e}`)}
            </option>
          ))}
        </NativeSelect>
      </td>
    </tr>
  )
}

// ── Preview and test request ─────────────────────────────────────────────────

function pretty(body: string, contentType: string) {
  if (contentType.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      return body
    }
  }
  if (contentType.includes('x-www-form-urlencoded')) return [...new URLSearchParams(body)].map(([k, v]) => `${k} = ${v}`).join('\n')
  if (contentType.includes('xml')) return body.replace(/></g, '>\n<')
  return body
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
      {children}
    </section>
  )
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-all" tabIndex={0}>
      {text}
    </pre>
  )
}

function PreviewDialog({ step, row, onClose }: { step: ApiStep; row: Record<string, unknown>; onClose: () => void }) {
  const { t, locale } = usePrefs()
  const rendered = useMemo(() => renderRequests(step, [row], { runId: 'preview', chunk: 0 }), [step, row])
  const req = rendered.requests[0]
  return (
    <Modal onClose={onClose} size="lg" title={t('steps.destination.api.previewTitle')} description={t('steps.destination.api.dryRunNote')}>
      {req ? (
        <div className="space-y-3">
          <Block label={t('steps.destination.api.request')}>
            <p className="font-mono text-sm break-all">
              {step.method} {req.path}
            </p>
            <p className="font-mono text-xs text-muted-foreground">Content-Type: {req.contentType}</p>
            {step.idempotencyKey && (
              <p className="font-mono text-xs text-muted-foreground">
                {step.idempotencyHeader}: {req.batchId}
              </p>
            )}
          </Block>
          <Block label={t('steps.destination.api.body')}>
            <Pre text={pretty(req.body, req.contentType)} />
          </Block>
        </div>
      ) : (
        <Notice tone="danger">{t('steps.destination.api.outcome.not_sent', { message: (rendered.rejects[0]?.errors ?? []).map((m) => localizeCheck(m, locale)).join('; ') })}</Notice>
      )}
    </Modal>
  )
}

function ResultDialog({ result, onClose }: { result: ApiTestResult; onClose: () => void }) {
  const { t, locale } = usePrefs()
  const res = result.response
  const message = result.renderErrors.length ? result.renderErrors.map((m) => localizeCheck(m, locale)).join('; ') : localizeCheck(result.message, locale)
  const tone = result.outcome === 'written' ? 'success' : result.outcome === 'retry' ? 'warning' : 'danger'
  return (
    <Modal onClose={onClose} size="lg" title={t('steps.destination.api.testTitle')}>
      <div className="space-y-3">
        <Notice tone={tone}>{t(`steps.destination.api.outcome.${result.outcome}`, { message, status: res?.status ?? '' })}</Notice>
        <Block label={t('steps.destination.api.request')}>
          <p className="font-mono text-sm break-all">
            {result.request.method} {result.request.url}
          </p>
          <ul className="font-mono text-xs text-muted-foreground">
            {Object.entries(result.request.headers).map(([k, v]) => (
              <li key={k} className="break-all">
                {k}: {v}
              </li>
            ))}
          </ul>
          {result.request.bodyPreview && <Pre text={pretty(result.request.bodyPreview, result.request.headers['Content-Type'] ?? Object.entries(result.request.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '')} />}
        </Block>
        <Block label={t('steps.destination.api.responseTitle')}>
          {res ? (
            <>
              <p className={cn('font-mono text-sm tabular-nums', res.status >= 200 && res.status < 300 ? 'text-live-text' : 'text-danger-text')}>
                HTTP {res.status} {res.statusText} · {res.durationMs} ms
              </p>
              <ul className="font-mono text-xs text-muted-foreground">
                {Object.entries(res.headers).map(([k, v]) => (
                  <li key={k} className="break-all">
                    {k}: {v}
                  </li>
                ))}
              </ul>
              {res.bodyPreview && <Pre text={pretty(res.bodyPreview, res.contentType)} />}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('steps.destination.api.noAnswer')}</p>
          )}
        </Block>
      </div>
    </Modal>
  )
}
