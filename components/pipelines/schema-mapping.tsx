'use client'

import { useEffect } from 'react'
import { Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/data-table'
import { useT } from '@/components/i18n/i18n-provider'
import type { Translate } from '@/lib/i18n/translate'
import type { DestinationStep, PipelineNode, SchemaBinding } from '@/lib/pipelines/definition'
import { autoMapSchema, mappingIssues, resolveMapping, type DatasetSchema } from '@/lib/datasets/schema'
import { NativeSelect, type BuilderOptions, type Column } from './step-editors'

type DatasetDest = Extract<DestinationStep, { kind: 'dataset' }>

/** The schema of the dataset a destination writes, when it is defined. */
export const schemaFor = (options: BuilderOptions, datasetName: string): DatasetSchema | null => options.datasets.find((d) => d.name === datasetName)?.schema ?? null

/**
 * Checks before Test and Save (lanes design §3): a defined dataset's required
 * columns need a source and conversions must be possible (errors); input
 * columns the destination won't write are asked about once ("Fix the mapping"
 * or "Drop them and continue", which sets `dropExtra`).
 */
export function schemaWriteChecks(nodes: PipelineNode[], columnsOf: (id: string) => Column[], options: BuilderOptions, t: Translate) {
  const errors: string[] = []
  const extras: { nodeId: string; dataset: string; names: string[] }[] = []
  for (const n of nodes) {
    if (n.type !== 'destination' || n.kind !== 'dataset') continue
    const schema = schemaFor(options, n.datasetName)
    if (!schema) continue
    const input = columnsOf(n.id)
    if (!input.length) continue
    const issues = mappingIssues(schema, n, input)
    if (issues.unmappedRequired.length) errors.push(t('steps.destination.schema.requiredMissing', { dataset: n.datasetName, columns: issues.unmappedRequired.join(', ') }))
    for (const i of issues.impossible) errors.push(t('steps.destination.schema.cantConvert', { dataset: n.datasetName, column: i.target, from: i.from, to: i.to }))
    // Auto-add takes extras that are matched by name; anything else is left out.
    if (issues.extras.length && !n.dropExtra && !(schema.autoAdd && issues.byName)) extras.push({ nodeId: n.id, dataset: n.datasetName, names: issues.extras })
  }
  return { errors, extras }
}

const NONE = '__none'
const CONSTANT = '__constant'
const EXPR = '__expr'

/** Target-first mapping: every schema column, and what it takes from this step's input. */
export function SchemaMappingFields({ step, schema, columns, onChange }: { step: DatasetDest; schema: DatasetSchema; columns: Column[]; onChange: (s: DestinationStep) => void }) {
  const t = useT()
  // Upserts match on the schema's keys: the step keeps a copy so it validates (and runs) on them.
  const schemaKeys = schema.keys.join()
  useEffect(() => {
    if (schema.keys.length && step.keys.join() !== schemaKeys) onChange({ ...step, keys: [...schema.keys] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaKeys, step.keys.join()])
  const inputNames = columns.map((c) => c.name)
  const { map, byName } = resolveMapping(schema, step, inputNames)
  const issues = mappingIssues(schema, step, columns)
  const bindingOf = (target: string): SchemaBinding => map.find((m) => m.target === target)?.binding ?? { kind: 'none' }
  const setBinding = (target: string, binding: SchemaBinding) => {
    // The first change turns "matched by name" into an explicit mapping of every column.
    const current = schema.columns.map((c) => ({ target: c.name, binding: bindingOf(c.name) }))
    onChange({ ...step, columnMap: current.map((m) => (m.target === target ? { target, binding } : m)) })
  }
  const choose = (target: string, value: string) => {
    if (value === NONE) setBinding(target, { kind: 'none' })
    else if (value === CONSTANT) setBinding(target, { kind: 'constant', value: '' })
    else if (value !== EXPR) setBinding(target, { kind: 'column', column: value })
  }

  return (
    <section className="space-y-2 rounded-md border border-border p-3" aria-labelledby={`schema-map-${step.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={`schema-map-${step.id}`} className="text-sm font-medium">{t('steps.destination.schema.title')}</h4>
        <span className="text-xs text-muted-foreground">{byName ? t('steps.destination.schema.byName') : t('steps.destination.schema.mapped', { count: map.length, total: schema.columns.length })}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onChange({ ...step, columnMap: schema.columns.map((c) => ({ target: c.name, binding: autoMapSchema(schema, inputNames).find((m) => m.target === c.name)?.binding ?? { kind: 'none' } })) })}>
            <Wand2 className="mr-1 size-3.5" aria-hidden /> {t('steps.destination.schema.autoMatch')}
          </Button>
          {!byName && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...step, columnMap: undefined })}>
              {t('steps.destination.schema.useNames')}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('steps.destination.schema.help')}</p>
      <div className="max-h-80 overflow-auto rounded-md border border-border">
        <Table label={t('steps.destination.schema.tableLabel', { dataset: step.datasetName })}>
          <THead className="sticky top-0 z-10 bg-muted">
            <tr>
              <Th>{t('steps.destination.schema.colTarget')}</Th>
              <Th>{t('steps.destination.schema.colSource')}</Th>
            </tr>
          </THead>
          <TBody>
            {schema.columns.map((c) => {
              const b = bindingOf(c.name)
              const value = b.kind === 'column' ? b.column : b.kind === 'constant' ? CONSTANT : b.kind === 'expr' ? EXPR : NONE
              const missing = b.kind === 'column' && !inputNames.includes(b.column)
              return (
                <Tr key={c.name}>
                  <Td className="py-1 align-top">
                    <span className="font-mono text-xs">{c.name}</span>
                    <span className="ml-1 font-mono text-[11px] text-muted-foreground">{c.type}</span>
                    {schema.keys.includes(c.name) ? (
                      <span className="ml-1 text-[11px] font-medium text-info-text">{t('steps.destination.schema.key')}</span>
                    ) : c.required ? (
                      <span className="ml-1 text-[11px] font-medium text-warning-text">{t('steps.destination.schema.required')}</span>
                    ) : null}
                  </Td>
                  <Td className="py-1">
                    <div className="flex gap-1">
                      <NativeSelect className="h-7 min-w-0 flex-1 text-xs" value={value} onChange={(v) => choose(c.name, v)} aria-label={t('steps.destination.schema.sourceOf', { column: c.name })}>
                        <option value={NONE}>{t('steps.destination.schema.notWritten')}</option>
                        {columns.map((col) => (
                          <option key={col.name} value={col.name}>{col.name}</option>
                        ))}
                        {missing && <option value={b.column}>{t('steps.columnPicker.notInSchema', { name: b.column })}</option>}
                        <option value={CONSTANT}>{t('steps.destination.schema.constant')}</option>
                        {b.kind === 'expr' && <option value={EXPR}>{t('steps.destination.schema.expression')}</option>}
                      </NativeSelect>
                      {b.kind === 'constant' && (
                        <Input className="h-7 w-32 text-xs" value={b.value} onChange={(e) => setBinding(c.name, { kind: 'constant', value: e.target.value })} aria-label={t('steps.destination.schema.constantOf', { column: c.name })} />
                      )}
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </Table>
      </div>
      {step.mode === 'replace' && <Notice tone="warning" className="text-xs">{t('steps.destination.schema.replaceWarning')}</Notice>}
      {schema.keys.length > 0 && step.mode === 'upsert' && <p className="text-xs text-muted-foreground">{t('steps.destination.schema.upsertKeys', { keys: schema.keys.join(', ') })}</p>}
      {issues.unmappedRequired.length > 0 && <Notice tone="warning" className="text-xs">{t('steps.destination.schema.requiredMissing', { dataset: step.datasetName, columns: issues.unmappedRequired.join(', ') })}</Notice>}
      {issues.impossible.map((i) => (
        <Notice key={i.target} tone="danger" className="text-xs">{t('steps.destination.schema.cantConvert', { dataset: step.datasetName, column: i.target, from: i.from, to: i.to })}</Notice>
      ))}
      {issues.extras.length > 0 && (
        <Notice tone="info" className="text-xs">
          {schema.autoAdd && issues.byName ? t('steps.destination.schema.extrasAdded', { columns: issues.extras.join(', ') }) : t('steps.destination.schema.extras', { columns: issues.extras.join(', ') })}
          {!(schema.autoAdd && issues.byName) && (
            <label className="mt-1 flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-primary" checked={Boolean(step.dropExtra)} onChange={(e) => onChange({ ...step, dropExtra: e.target.checked || undefined })} />
              {t('steps.destination.schema.dropExtra')}
            </label>
          )}
        </Notice>
      )}
    </section>
  )
}
