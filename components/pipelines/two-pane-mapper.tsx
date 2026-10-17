'use client'

import { useState } from 'react'
import { ArrowRight, GripVertical, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { useT } from '@/components/i18n/i18n-provider'
import { cn } from '@/lib/utils'
import { DOMAIN_ENTITIES } from '@/lib/domain/model'
import type { MapStep } from '@/lib/pipelines/definition'
import { addColumn, addTargets, assign, fieldsFromRows, rowsFromStep, usage, type MapperRow } from '@/lib/pipelines/mapper'
import { NativeSelect, type BuilderOptions, type Column } from './step-editors'

const DRAG_TYPE = 'application/x-nexus-column'

/**
 * MP-1: source columns ↔ target fields. Drag a column onto a target to fill
 * it, or onto "New field" to add one. Keyboard: pick a column (Enter), then
 * "Use" on a target. Transforms set in the Map step stay with their field.
 */
export function TwoPaneMapper({ step, columns, options, onApply, onClose }: { step: MapStep; columns: Column[]; options?: BuilderOptions; onApply: (fields: MapStep['fields']) => void; onClose: () => void }) {
  const t = useT()
  const [rows, setRows] = useState<MapperRow[]>(() => rowsFromStep(step))
  const [picked, setPicked] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [over, setOver] = useState<string | null>(null)
  const initial = JSON.stringify(rowsFromStep(step))
  const used = usage(rows)
  const visible = columns.filter((c) => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()))
  const schemas = (options?.datasets ?? []).filter((d) => d.schema)
  const columnOf = (name: string) => columns.find((c) => c.name === name)

  const fill = (target: string, name: string) => {
    const col = columnOf(name)
    if (col) setRows((r) => assign(r, target, col))
    setPicked(null)
  }
  const addNew = (name: string) => {
    const col = columnOf(name)
    if (col) setRows((r) => addColumn(r, col))
    setPicked(null)
  }
  const loadTargets = (value: string) => {
    if (!value) return
    const [kind, name] = value.split(':')
    const targets =
      kind === 'entity'
        ? (DOMAIN_ENTITIES.find((e) => e.name === name)?.fields ?? []).map((f) => ({ name: f.name, type: f.type }))
        : (schemas.find((d) => d.name === name)?.schema?.columns ?? []).map((c) => ({ name: c.name, type: c.type }))
    setRows((r) => addTargets(r, targets, columns))
  }
  const dropProps = (key: string, onDrop: (name: string) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link' as const
      if (over !== key) setOver(key)
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(null)
      const name = e.dataTransfer.getData(DRAG_TYPE)
      if (name) onDrop(name)
    },
  })
  const unfilled = rows.filter((r) => !r.from).length

  return (
    <Modal
      title={t('steps.map.mapper.title')}
      description={t('steps.map.mapper.description')}
      size="xl"
      onClose={onClose}
      dirty={JSON.stringify(rows) !== initial}
      footer={
        <>
          {unfilled > 0 && <span className="mr-auto text-xs text-muted-foreground">{t('steps.map.mapper.unfilled', { count: unfilled })}</span>}
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!fieldsFromRows(rows).length} onClick={() => onApply(fieldsFromRows(rows))}>{t('steps.map.mapper.apply')}</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="mapper-sources" className="min-w-0 space-y-2">
          <h3 id="mapper-sources" className="text-sm font-medium">{t('steps.map.mapper.sources', { count: columns.length })}</h3>
          <div className="relative">
            <Search className="absolute top-2 left-2 size-4 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('steps.map.mapper.search')} aria-label={t('steps.map.mapper.search')} className="h-8 pl-8" />
          </div>
          {picked && (
            <p className="flex items-center gap-1 text-xs text-info-text" role="status">
              {t('steps.map.mapper.picked', { name: picked })}
              <button type="button" className="rounded-sm p-0.5 hover:bg-muted" onClick={() => setPicked(null)} aria-label={t('steps.map.mapper.unpick')}>
                <X className="size-3" aria-hidden />
              </button>
            </p>
          )}
          <ul className="max-h-[55vh] space-y-1 overflow-auto pr-1" aria-label={t('steps.map.mapper.sourcesList')}>
            {visible.map((c) => {
              const n = used.get(c.name) ?? 0
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, c.name)
                      e.dataTransfer.effectAllowed = 'link'
                    }}
                    onClick={() => setPicked((p) => (p === c.name ? null : c.name))}
                    aria-pressed={picked === c.name}
                    aria-label={t('steps.map.mapper.sourceLabel', { name: c.name, type: c.type, count: n })}
                    className={cn(
                      'flex w-full cursor-grab items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      picked === c.name ? 'border-ring bg-accent text-accent-foreground' : n ? 'border-border bg-card' : 'border-dashed border-border bg-card',
                    )}
                  >
                    <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono">{c.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{c.type}</span>
                    {n > 0 && <span className="rounded-sm bg-live-soft px-1 text-[10px] text-live-text">{n > 1 ? `×${n}` : '✓'}</span>}
                  </button>
                </li>
              )
            })}
            {!visible.length && <li className="text-xs text-muted-foreground">{t('steps.map.mapper.noSources')}</li>}
          </ul>
        </section>

        <section aria-labelledby="mapper-targets" className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="mapper-targets" className="mr-auto text-sm font-medium">{t('steps.map.mapper.targets', { count: rows.length })}</h3>
            <NativeSelect value="" onChange={loadTargets} className="h-8 w-auto text-xs" aria-label={t('steps.map.mapper.targetsFrom')}>
              <option value="">{t('steps.map.mapper.targetsFrom')}</option>
              <optgroup label={t('steps.map.mapper.entities')}>
                {DOMAIN_ENTITIES.map((e) => (
                  <option key={e.name} value={`entity:${e.name}`}>{e.label}</option>
                ))}
              </optgroup>
              {schemas.length > 0 && (
                <optgroup label={t('steps.map.mapper.schemas')}>
                  {schemas.map((d) => (
                    <option key={d.name} value={`schema:${d.name}`}>{d.name}</option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
          </div>
          <ul className="max-h-[55vh] space-y-1 overflow-auto pr-1" aria-label={t('steps.map.mapper.targetsList')}>
            {rows.map((r, i) => (
              <li
                key={`${r.to}-${i}`}
                {...dropProps(`row:${r.to}`, (name) => fill(r.to, name))}
                className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs', over === `row:${r.to}` ? 'border-ring bg-accent' : r.from ? 'border-border bg-card' : 'border-dashed border-warning/60 bg-warning-soft/40')}
              >
                <span className={cn('min-w-0 flex-1 truncate font-mono', !r.from && 'text-muted-foreground')}>{r.from || t('steps.map.mapper.dropHere')}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono font-medium">{r.to}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{r.type}</span>
                {r.transforms.length > 0 && <span className="text-[10px] text-muted-foreground">{t('steps.map.mapper.transforms', { count: r.transforms.length })}</span>}
                {picked && (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => fill(r.to, picked)}>
                    {t('steps.map.mapper.use')}
                  </Button>
                )}
                {r.from && (
                  <button type="button" className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, from: '' } : x)))} aria-label={t('steps.map.mapper.clear', { name: r.to })}>
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
                <button type="button" className="rounded-sm p-0.5 text-muted-foreground hover:text-danger-text focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={t('steps.map.mapper.remove', { name: r.to })}>
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
            <li {...dropProps('new', addNew)}>
              <button
                type="button"
                disabled={!picked}
                onClick={() => picked && addNew(picked)}
                className={cn('flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed px-2 py-3 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', over === 'new' ? 'border-ring bg-accent' : 'border-border')}
              >
                <Plus className="size-3.5" aria-hidden /> {picked ? t('steps.map.mapper.addPicked', { name: picked }) : t('steps.map.mapper.newField')}
              </button>
            </li>
          </ul>
        </section>
      </div>
    </Modal>
  )
}
