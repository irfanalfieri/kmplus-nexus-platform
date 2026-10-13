'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { getAnalyticsDatasets, previewWidget } from '@/lib/actions/analytics'
import {
  AGGREGATIONS,
  FILTER_OPS,
  GRAINS,
  NUMERIC_TYPES,
  SORTS,
  TIME_TYPES,
  WIDGET_TYPES,
  widgetSchema,
  type Widget,
  type WidgetResult,
} from '@/lib/analytics/definition'
import { usePrefs } from '@/components/i18n/i18n-provider'
import type { MessageKey } from '@/lib/i18n/translate'
import { WidgetView, defaultTitleT } from './charts'

type Datasets = Awaited<ReturnType<typeof getAnalyticsDatasets>>
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'
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
  const { t, formatNumber } = usePrefs()
  const defaultTitle = (x: Widget) => defaultTitleT(x, t)
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
    const timer = setTimeout(() => {
      previewWidget(w)
        .then((res) => setPreview(res.ok ? { result: res.result, loading: false } : { message: res.message, loading: false }))
        .catch((err) => setPreview({ message: err instanceof Error ? err.message : t('insights.widgetEditor.previewFailed'), loading: false }))
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(w)])

  const setType = (type: Widget['type']) => {
    if (type === 'kpi') return patch({ type, dimension: null, size: 'small' })
    const first = columns.find((c) => (type === 'line' ? isTime(c.type) : !isNumeric(c.type))) ?? columns[0]
    patch({ type, limit: type === 'line' && w.limit === 12 ? 24 : w.limit, dimension: w.dimension ?? (first ? { column: first.name, grain: type === 'line' && isTime(first.type) ? 'month' : 'none' } : null) })
  }

  const save = async () => {
    const parsed = widgetSchema.safeParse(w)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t('insights.widgetEditor.incomplete'))
    setSaving(true)
    setError('')
    try {
      await onSave({ ...parsed.data, title: parsed.data.title || defaultTitle(parsed.data) })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.widgetEditor.saveFailed'))
      setSaving(false)
    }
  }

  const measureColumns = columns.filter((c) =>
    w.measure.agg === 'sum' || w.measure.agg === 'avg' ? isNumeric(c.type) : w.measure.agg === 'min' || w.measure.agg === 'max' ? isNumeric(c.type) || isTime(c.type) : true
  )
  const dimCol = columns.find((c) => c.name === w.dimension?.column)

  const dirty = !saving && JSON.stringify(w) !== JSON.stringify(initial)

  return (
    <Modal
      onClose={onCancel}
      dirty={dirty}
      size="full"
      title={initial.title ? t('insights.widgetEditor.editTitle') : t('insights.widgetEditor.addTitle')}
      bodyClassName="p-0"
      footer={
        <>
          {error && (
            <Notice tone="danger" className="mr-auto py-1.5">
              {error}
            </Notice>
          )}
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving || !valid.success}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}{t('insights.widgetEditor.save')}
          </Button>
        </>
      }
    >
        <div className="grid gap-0 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4 border-b border-border p-4 lg:border-b-0 lg:border-r">
            <Field label={t('insights.widgetEditor.dataset')}>
              <select className={selectClass} value={w.dataset} onChange={(e) => patch({ dataset: e.target.value, measure: { agg: 'count', column: '' }, dimension: null, filters: [] })}>
                {datasets.map((d) => (
                  <option key={d.name} value={d.name}>{t('insights.widgetEditor.datasetOption', { name: d.name, count: formatNumber(d.rowCount) })}</option>
                ))}
              </select>
            </Field>
            {maskedCount > 0 && <p className="font-mono text-xs text-muted-foreground">{t('insights.widgetEditor.maskedHidden', { count: maskedCount })}</p>}
            <Field label={t('insights.widgetEditor.showAs')}>
              <select className={selectClass} value={w.type} onChange={(e) => setType(e.target.value as Widget['type'])}>
                {WIDGET_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`insights.widgetEditor.types.${type}` as MessageKey)}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('insights.widgetEditor.measure')}>
                <select className={selectClass} value={w.measure.agg} onChange={(e) => patch({ measure: { agg: e.target.value as Widget['measure']['agg'], column: e.target.value === 'count' ? '' : w.measure.column } })}>
                  {AGGREGATIONS.map((a) => (
                    <option key={a} value={a}>{t(`insights.widgetEditor.aggs.${a}` as MessageKey)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('insights.widgetEditor.ofColumn')}>
                <select className={selectClass} value={w.measure.column} disabled={w.measure.agg === 'count'} onChange={(e) => patch({ measure: { ...w.measure, column: e.target.value } })}>
                  <option value="">{w.measure.agg === 'count' ? t('insights.widgetEditor.allRows') : t('insights.widgetEditor.choose')}</option>
                  {measureColumns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            {needsDimension && (
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('insights.widgetEditor.groupBy')}>
                  <select
                    className={selectClass}
                    value={w.dimension?.column ?? ''}
                    onChange={(e) => {
                      const c = columns.find((x) => x.name === e.target.value)
                      patch({ dimension: e.target.value ? { column: e.target.value, grain: c && isTime(c.type) ? (w.dimension?.grain && w.dimension.grain !== 'none' ? w.dimension.grain : 'month') : 'none' } : null })
                    }}
                  >
                    <option value="">{t('insights.widgetEditor.choose')}</option>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('insights.widgetEditor.timeGrain')}>
                  <select className={selectClass} value={w.dimension?.grain ?? 'none'} disabled={!dimCol || !isTime(dimCol.type)} onChange={(e) => w.dimension && patch({ dimension: { ...w.dimension, grain: e.target.value as NonNullable<Widget['dimension']>['grain'] } })}>
                    {GRAINS.map((g) => (
                      <option key={g} value={g}>{t(`insights.widgetEditor.grains.${g}` as MessageKey)}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">{t('insights.widgetEditor.filters')}</legend>
              {w.filters.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-1">
                  <select className={selectClass} value={f.column} onChange={(e) => patch({ filters: w.filters.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })} aria-label={t('insights.widgetEditor.filterColumn', { n: i + 1 })}>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <select className={`${selectClass} w-auto`} value={f.op} onChange={(e) => patch({ filters: w.filters.map((x, j) => (j === i ? { ...x, op: e.target.value as typeof f.op } : x)) })} aria-label={t('insights.widgetEditor.filterOperator', { n: i + 1 })}>
                    {FILTER_OPS.map((o) => (
                      <option key={o} value={o}>{t(`insights.widgetEditor.ops.${o}` as MessageKey)}</option>
                    ))}
                  </select>
                  <Input value={f.value} disabled={f.op === 'empty' || f.op === 'not_empty'} onChange={(e) => patch({ filters: w.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} aria-label={t('insights.widgetEditor.filterValue', { n: i + 1 })} className="h-9" />
                  <Button size="icon" variant="ghost" className="size-9" onClick={() => patch({ filters: w.filters.filter((_, j) => j !== i) })} aria-label={t('insights.widgetEditor.removeFilter', { n: i + 1 })}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
              {columns.length > 0 && w.filters.length < 10 && (
                <Button size="sm" variant="outline" onClick={() => patch({ filters: [...w.filters, { column: columns[0].name, op: 'eq', value: '' }] })}>
                  <Plus aria-hidden /> {t('insights.widgetEditor.addFilter')}
                </Button>
              )}
            </fieldset>
            {needsDimension && (
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('insights.widgetEditor.sort')}>
                  <select className={selectClass} value={w.sort} disabled={w.type === 'line' || (w.dimension?.grain ?? 'none') !== 'none'} onChange={(e) => patch({ sort: e.target.value as Widget['sort'] })}>
                    {SORTS.map((s) => (
                      <option key={s} value={s}>{t(`insights.widgetEditor.sorts.${s}` as MessageKey)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('insights.widgetEditor.maxGroups')}>
                  <Input type="number" min={1} max={100} value={w.limit} onChange={(e) => patch({ limit: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} className="h-9" />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label={t('insights.widgetEditor.title')}>
                <Input value={w.title} placeholder={valid.success ? defaultTitle(valid.data) : t('insights.widgetEditor.titlePlaceholder')} onChange={(e) => patch({ title: e.target.value })} className="h-9" />
              </Field>
              <Field label={t('insights.widgetEditor.width')}>
                <select className={`${selectClass} w-auto`} value={w.size} onChange={(e) => patch({ size: e.target.value as Widget['size'] })}>
                  <option value="small">{t('insights.widgetEditor.half')}</option>
                  <option value="wide">{t('insights.widgetEditor.full')}</option>
                </select>
              </Field>
            </div>
          </div>
          <div className="min-w-0 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
              {t('insights.widgetEditor.preview')}
              {preview.loading && (
                <span role="status" className="text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  <span className="sr-only">{t('insights.widgetEditor.loadingPreview')}</span>
                </span>
              )}
            </h3>
            <div className="rounded-lg border border-border p-4">
              <div className="mb-2 font-medium">{w.title || (valid.success ? defaultTitle(valid.data) : '')}</div>
              {preview.result && valid.success ? (
                <WidgetView widget={valid.data} result={preview.result} />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">{preview.message ?? t('insights.widgetEditor.chooseWhat')}</p>
              )}
              {preview.result && preview.message && (
                <Notice tone="danger" className="mt-2">
                  {preview.message}
                </Notice>
              )}
            </div>
          </div>
        </div>
    </Modal>
  )
}
