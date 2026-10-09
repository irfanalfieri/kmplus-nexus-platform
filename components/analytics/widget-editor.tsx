'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getAnalyticsDatasets, previewWidget } from '@/lib/actions/analytics'
import {
  AGGREGATIONS,
  AGG_INFO,
  FILTER_OPS,
  FILTER_OP_INFO,
  GRAINS,
  NUMERIC_TYPES,
  SORTS,
  SORT_INFO,
  TIME_TYPES,
  WIDGET_TYPES,
  WIDGET_TYPE_INFO,
  defaultTitle,
  widgetSchema,
  type Widget,
  type WidgetResult,
} from '@/lib/analytics/definition'
import { WidgetView } from './charts'

type Datasets = Awaited<ReturnType<typeof getAnalyticsDatasets>>
const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
const isNumeric = (t: string) => (NUMERIC_TYPES as readonly string[]).includes(t)
const isTime = (t: string) => (TIME_TYPES as readonly string[]).includes(t)

export function newWidget(dataset: string): Widget {
  return { id: `w_${Math.random().toString(36).slice(2, 10)}`, title: '', type: 'bar', dataset, measure: { agg: 'count', column: '' }, dimension: null, filters: [], sort: 'value_desc', limit: 12, size: 'small' }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export default function WidgetEditor({ datasets: initialDatasets, initial, onCancel, onSave }: { datasets: Datasets; initial: Widget; onCancel: () => void; onSave: (w: Widget) => Promise<void> }) {
  const [w, setW] = useState<Widget>(initial)
  // Fresh column list on every open: a pipeline run may have added columns or changed their types.
  const [datasets, setDatasets] = useState<Datasets>(initialDatasets)
  useEffect(() => {
    getAnalyticsDatasets().then(setDatasets).catch(() => undefined)
  }, [])
  const [preview, setPreview] = useState<{ result?: WidgetResult; message?: string; loading: boolean }>({ loading: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const dataset = datasets.find((d) => d.name === w.dataset)
  const columns = useMemo(() => (dataset?.columns ?? []).filter((c) => !c.masked), [dataset])
  const maskedCount = (dataset?.columns ?? []).length - columns.length
  const needsDimension = w.type !== 'kpi'
  const patch = (p: Partial<Widget>) => setW((cur) => ({ ...cur, ...p }))
  const valid = widgetSchema.safeParse(w)

  // Live preview, debounced.
  useEffect(() => {
    if (!valid.success) {
      setPreview({ loading: false, message: valid.error.issues[0]?.message })
      return
    }
    setPreview((p) => ({ ...p, loading: true }))
    const t = setTimeout(() => {
      previewWidget(w)
        .then((res) => setPreview(res.ok ? { result: res.result, loading: false } : { message: res.message, loading: false }))
        .catch((err) => setPreview({ message: err instanceof Error ? err.message : 'Preview failed', loading: false }))
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(w)])

  const setType = (type: Widget['type']) => {
    if (type === 'kpi') return patch({ type, dimension: null, size: 'small' })
    const first = columns.find((c) => (type === 'line' ? isTime(c.type) : !isNumeric(c.type))) ?? columns[0]
    patch({ type, limit: type === 'line' && w.limit === 12 ? 24 : w.limit, dimension: w.dimension ?? (first ? { column: first.name, grain: type === 'line' && isTime(first.type) ? 'month' : 'none' } : null) })
  }

  const save = async () => {
    const parsed = widgetSchema.safeParse(w)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Incomplete widget')
    setSaving(true)
    setError('')
    try {
      await onSave({ ...parsed.data, title: parsed.data.title || defaultTitle(parsed.data) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  const measureColumns = columns.filter((c) =>
    w.measure.agg === 'sum' || w.measure.agg === 'avg' ? isNumeric(c.type) : w.measure.agg === 'min' || w.measure.agg === 'max' ? isNumeric(c.type) || isTime(c.type) : true
  )
  const dimCol = columns.find((c) => c.name === w.dimension?.column)

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Edit widget">
      <div className="flex w-full max-w-5xl flex-col overflow-hidden border border-border bg-card sm:rounded-xl">
        <header className="flex items-center gap-3 border-b border-border p-4">
          <div className="flex-1 font-semibold">{initial.title ? 'Edit widget' : 'Add widget'}</div>
          <Button size="sm" variant="ghost" onClick={onCancel} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="grid flex-1 gap-0 overflow-auto lg:grid-cols-[360px_1fr]">
          <div className="space-y-4 border-b border-border p-4 lg:border-b-0 lg:border-r">
            <Field label="Dataset">
              <select className={selectClass} value={w.dataset} onChange={(e) => patch({ dataset: e.target.value, measure: { agg: 'count', column: '' }, dimension: null, filters: [] })}>
                {datasets.map((d) => (
                  <option key={d.name} value={d.name}>{d.name} ({d.rowCount.toLocaleString()} rows)</option>
                ))}
              </select>
            </Field>
            {maskedCount > 0 && <p className="text-xs text-muted-foreground">{maskedCount} masked column{maskedCount === 1 ? ' is' : 's are'} hidden for your role (Governance policy).</p>}
            <Field label="Show as">
              <select className={selectClass} value={w.type} onChange={(e) => setType(e.target.value as Widget['type'])}>
                {WIDGET_TYPES.map((t) => (
                  <option key={t} value={t}>{WIDGET_TYPE_INFO[t]}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Measure">
                <select className={selectClass} value={w.measure.agg} onChange={(e) => patch({ measure: { agg: e.target.value as Widget['measure']['agg'], column: e.target.value === 'count' ? '' : w.measure.column } })}>
                  {AGGREGATIONS.map((a) => (
                    <option key={a} value={a}>{AGG_INFO[a]}</option>
                  ))}
                </select>
              </Field>
              <Field label="of column">
                <select className={selectClass} value={w.measure.column} disabled={w.measure.agg === 'count'} onChange={(e) => patch({ measure: { ...w.measure, column: e.target.value } })}>
                  <option value="">{w.measure.agg === 'count' ? 'all rows' : 'choose…'}</option>
                  {measureColumns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            {needsDimension && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Group by">
                  <select
                    className={selectClass}
                    value={w.dimension?.column ?? ''}
                    onChange={(e) => {
                      const c = columns.find((x) => x.name === e.target.value)
                      patch({ dimension: e.target.value ? { column: e.target.value, grain: c && isTime(c.type) ? (w.dimension?.grain && w.dimension.grain !== 'none' ? w.dimension.grain : 'month') : 'none' } : null })
                    }}
                  >
                    <option value="">choose…</option>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Time grain">
                  <select className={selectClass} value={w.dimension?.grain ?? 'none'} disabled={!dimCol || !isTime(dimCol.type)} onChange={(e) => w.dimension && patch({ dimension: { ...w.dimension, grain: e.target.value as NonNullable<Widget['dimension']>['grain'] } })}>
                    {GRAINS.map((g) => (
                      <option key={g} value={g}>{g === 'none' ? 'exact value' : g}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Filters</div>
              {w.filters.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-1">
                  <select className={selectClass} value={f.column} onChange={(e) => patch({ filters: w.filters.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })} aria-label="Filter column">
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <select className={`${selectClass} w-auto`} value={f.op} onChange={(e) => patch({ filters: w.filters.map((x, j) => (j === i ? { ...x, op: e.target.value as typeof f.op } : x)) })} aria-label="Filter operator">
                    {FILTER_OPS.map((o) => (
                      <option key={o} value={o}>{FILTER_OP_INFO[o]}</option>
                    ))}
                  </select>
                  <Input value={f.value} disabled={f.op === 'empty' || f.op === 'not_empty'} onChange={(e) => patch({ filters: w.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} aria-label="Filter value" className="h-9" />
                  <Button size="sm" variant="ghost" onClick={() => patch({ filters: w.filters.filter((_, j) => j !== i) })} aria-label="Remove filter">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {columns.length > 0 && w.filters.length < 10 && (
                <Button size="sm" variant="outline" onClick={() => patch({ filters: [...w.filters, { column: columns[0].name, op: 'eq', value: '' }] })}>
                  <Plus className="mr-1 h-4 w-4" /> Add filter
                </Button>
              )}
            </div>
            {needsDimension && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Sort">
                  <select className={selectClass} value={w.sort} disabled={w.type === 'line' || (w.dimension?.grain ?? 'none') !== 'none'} onChange={(e) => patch({ sort: e.target.value as Widget['sort'] })}>
                    {SORTS.map((s) => (
                      <option key={s} value={s}>{SORT_INFO[s]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Max groups">
                  <Input type="number" min={1} max={100} value={w.limit} onChange={(e) => patch({ limit: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} className="h-9" />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="Title">
                <Input value={w.title} placeholder={valid.success ? defaultTitle(valid.data) : 'Widget title'} onChange={(e) => patch({ title: e.target.value })} className="h-9" />
              </Field>
              <Field label="Width">
                <select className={`${selectClass} w-auto`} value={w.size} onChange={(e) => patch({ size: e.target.value as Widget['size'] })}>
                  <option value="small">Half</option>
                  <option value="wide">Full</option>
                </select>
              </Field>
            </div>
          </div>
          <div className="min-w-0 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              Preview {preview.loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="mb-2 font-medium">{w.title || (valid.success ? defaultTitle(valid.data) : '')}</div>
              {preview.result && valid.success ? (
                <WidgetView widget={valid.data} result={preview.result} />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">{preview.message ?? 'Choose what to show.'}</p>
              )}
              {preview.result && preview.message && <p className="mt-2 text-sm text-destructive">{preview.message}</p>}
            </div>
          </div>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border p-4">
          {error && <p className="mr-auto text-sm text-destructive">{error}</p>}
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || !valid.success}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save widget
          </Button>
        </footer>
      </div>
    </div>
  )
}
