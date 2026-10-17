'use client'

import { useState } from 'react'
import { Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { DATE_PRESETS, TIME_TYPES, type DashboardFilter, type DashboardFilterValues, type DatePreset } from '@/lib/analytics/definition'

type Column = { name: string; type: string; masked?: boolean }

/**
 * DB-4: the filter bar above a dashboard's widgets. Choices apply to every
 * widget whose dataset has the filter's column; they belong to this view and
 * aren't saved with the dashboard.
 */
export function DashboardFilterBar({
  filters,
  values,
  options,
  onChange,
  onEdit,
}: {
  filters: DashboardFilter[]
  values: DashboardFilterValues
  options: Record<string, string[]>
  onChange: (values: DashboardFilterValues) => void
  onEdit?: () => void
}) {
  const { t } = usePrefs()
  if (!filters.length) {
    return onEdit ? (
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <SlidersHorizontal className="mr-1 h-4 w-4" aria-hidden /> {t('insights.analytics.dashFilters.add')}
        </Button>
      </div>
    ) : null
  }
  const set = (id: string, v: DashboardFilterValues[string]) => onChange({ ...values, [id]: v })
  const active = filters.some((f) => (f.kind === 'date' ? (values[f.id]?.preset ?? 'all') !== 'all' : Boolean(values[f.id]?.value)))
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3" role="group" aria-label={t('insights.analytics.dashFilters.label')}>
      {filters.map((f) => {
        const v = values[f.id] ?? {}
        return (
          <div key={f.id} className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{f.label}</span>
            {f.kind === 'date' ? (
              <div className="flex flex-wrap items-center gap-2">
                <select className={nativeSelectClass} value={v.preset ?? 'all'} onChange={(e) => set(f.id, { ...v, preset: e.target.value as DatePreset })} aria-label={f.label}>
                  {DATE_PRESETS.map((p) => (
                    <option key={p} value={p}>{t(`insights.analytics.dashFilters.presets.${p}`)}</option>
                  ))}
                </select>
                {v.preset === 'custom' && (
                  <>
                    <Input type="date" className="h-9 w-40" value={v.from ?? ''} onChange={(e) => set(f.id, { ...v, from: e.target.value || undefined })} aria-label={t('insights.analytics.dashFilters.from', { label: f.label })} />
                    <Input type="date" className="h-9 w-40" value={v.to ?? ''} onChange={(e) => set(f.id, { ...v, to: e.target.value || undefined })} aria-label={t('insights.analytics.dashFilters.to', { label: f.label })} />
                  </>
                )}
              </div>
            ) : (
              <select className={nativeSelectClass} value={v.value ?? ''} onChange={(e) => set(f.id, { value: e.target.value || undefined })} aria-label={f.label}>
                <option value="">{t('insights.analytics.dashFilters.any')}</option>
                {(options[f.id] ?? []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )}
          </div>
        )
      })}
      <div className="ml-auto flex gap-1">
        {active && (
          <Button size="sm" variant="ghost" onClick={() => onChange({})}>
            <X className="mr-1 h-4 w-4" aria-hidden /> {t('insights.analytics.dashFilters.clear')}
          </Button>
        )}
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <SlidersHorizontal className="mr-1 h-4 w-4" aria-hidden /> {t('insights.analytics.dashFilters.edit')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Adds, renames and removes a dashboard's filters (people who edit dashboards). */
export function DashboardFiltersEditor({ initial, columns, onCancel, onSave }: { initial: DashboardFilter[]; columns: Column[]; onCancel: () => void; onSave: (filters: DashboardFilter[]) => Promise<void> }) {
  const { t } = usePrefs()
  const [filters, setFilters] = useState<DashboardFilter[]>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dateColumns = columns.filter((c) => (TIME_TYPES as readonly string[]).includes(c.type))
  const valueColumns = columns.filter((c) => !(TIME_TYPES as readonly string[]).includes(c.type) && c.type !== 'json')
  /** The name a filter gets when nobody typed one: the period for dates, the column for values. */
  const autoLabel = (f: Pick<DashboardFilter, 'kind' | 'column'>) => (f.kind === 'date' ? t('insights.analytics.dashFilters.defaultDate') : f.column)
  const patch = (i: number, p: Partial<DashboardFilter>) =>
    setFilters(
      filters.map((f, j) => {
        if (j !== i) return f
        const next = { ...f, ...p }
        // A name that was automatic follows the type and column.
        return f.label === autoLabel(f) && !('label' in p) ? { ...next, label: autoLabel(next) } : next
      })
    )
  const add = () => {
    const col = dateColumns[0] ?? valueColumns[0]
    if (!col) return
    const kind = dateColumns[0] ? 'date' : 'value'
    setFilters([...filters, { id: `f_${crypto.randomUUID().slice(0, 8)}`, label: autoLabel({ kind, column: col.name }), kind, column: col.name }])
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await onSave(filters)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
      setBusy(false)
    }
  }
  return (
    <Modal
      title={t('insights.analytics.dashFilters.editTitle')}
      description={t('insights.analytics.dashFilters.editDescription')}
      size="lg"
      onClose={onCancel}
      dirty={JSON.stringify(filters) !== JSON.stringify(initial)}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button disabled={busy || filters.some((f) => !f.label.trim())} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <Notice tone="danger">{error}</Notice>}
        {!columns.length && <p className="text-muted-foreground">{t('insights.analytics.dashFilters.noColumns')}</p>}
        {filters.map((f, i) => {
          const choices = f.kind === 'date' ? dateColumns : valueColumns
          return (
            <div key={f.id} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
              <label className="min-w-40 flex-1">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('insights.analytics.dashFilters.name')}</span>
                <Input value={f.label} onChange={(e) => patch(i, { label: e.target.value })} />
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('insights.analytics.dashFilters.kind')}</span>
                <select
                  className={nativeSelectClass}
                  value={f.kind}
                  onChange={(e) => {
                    const kind = e.target.value as DashboardFilter['kind']
                    const first = (kind === 'date' ? dateColumns : valueColumns)[0]
                    patch(i, { kind, column: first?.name ?? f.column })
                  }}
                >
                  <option value="date" disabled={!dateColumns.length}>{t('insights.analytics.dashFilters.kindDate')}</option>
                  <option value="value" disabled={!valueColumns.length}>{t('insights.analytics.dashFilters.kindValue')}</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('insights.analytics.dashFilters.column')}</span>
                <select className={nativeSelectClass} value={f.column} onChange={(e) => patch(i, { column: e.target.value })}>
                  {choices.map((c) => (
                    <option key={c.name} value={c.name} disabled={c.masked}>{c.name}{c.masked ? ` (${t('insights.analytics.dashFilters.masked')})` : ''}</option>
                  ))}
                </select>
              </label>
              <Button size="icon-sm" variant="ghost" onClick={() => setFilters(filters.filter((_, j) => j !== i))} aria-label={t('insights.analytics.dashFilters.remove', { label: f.label })}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )
        })}
        {filters.length < 4 && columns.length > 0 && (
          <Button size="sm" variant="outline" onClick={add}>
            <Plus className="mr-1 h-4 w-4" aria-hidden /> {t('insights.analytics.dashFilters.addOne')}
          </Button>
        )}
      </div>
    </Modal>
  )
}
