'use client'

import { useState } from 'react'
import { Columns2, Plus, Scale, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice, type NoticeTone } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import {
  AGGREGATE_FNS,
  COLUMN_TYPES,
  TIME_GRAINS,
  timeGrainColumn,
  type AggregateFn,
  type AggregateMeasure,
  type AggregateStep,
  type DedupeStep,
  type TimeGrain,
  FILTER_OPERATORS,
  OTHERWISE,
  SEVERITIES,
  TRANSFORMS,
  VALIDATION_RULES,
  newStepId,
  type ColumnType,
  type Condition,
  type DestinationStep,
  type FilterStep,
  type JoinStep,
  type MapStep,
  type RouterStep,
  type RulesStep,
  type SourceStep,
  type TransformName,
  type UnionStep,
  type ValidateStep,
  type ValidationRuleSpec,
} from '@/lib/pipelines/definition'
import { autoMapName } from '@/lib/domain/model'
import { BUILTIN_MAPPING_TEMPLATES, applyMappingTemplate, autoMapFields, columnTypeFromSql, hrRulePack, newValidationRule, type MappingTemplate } from '@/lib/pipelines/templates'
import { saveMappingTemplate } from '@/lib/actions/templates'
import type { getBuilderOptions } from '@/lib/actions/pipelines'
import { AiMappingButton } from '@/components/ai/ai-mapping'
import { useT } from '@/components/i18n/i18n-provider'
import { getConnectorDefinition } from '@/lib/connectors/catalog'
import { ApiDestinationFields, newApiDestination } from './api-destination-editor'
import { SchemaMappingFields, schemaFor } from './schema-mapping'
import { TwoPaneMapper } from './two-pane-mapper'
import { recencyColumn } from '@/lib/pipelines/aggregate'
import type { steps as stepsMessages } from '@/lib/i18n/messages/en/steps'

export type BuilderOptions = Awaited<ReturnType<typeof getBuilderOptions>>
export type Column = { name: string; type: string }

export const selectClass =
  'h-8 w-full rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'

export function NativeSelect({
  value,
  onChange,
  children,
  className = '',
  ...rest
}: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'>) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(selectClass, className)} {...rest}>
      {children}
    </select>
  )
}

/** A visible label wrapped around its control, so the control is named by the words on screen. */
export function Field({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('grid gap-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** Small native input used inside transform chips. */
const chipInputClass = 'h-6 w-28 rounded-sm border border-input bg-card px-1 font-mono outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring'

export const human = (s: string) => s.replace(/_/g, ' ')

export const newCondition = (field = ''): Condition => ({ field, operator: 'equals', value: '', valueField: '' })
export { columnTypeFromSql, newValidationRule }

// ── Source ───────────────────────────────────────────────────────────────────

/** Where a Source sits among several (lanes): the driver, looked up by a Join (staged), or neither. */
export type SourceLane = { several: boolean; driver: boolean; staged: boolean; hasJoins: boolean }

export function SourceEditor({ step, options, lane, onMakeDriver, onChange }: { step: SourceStep; options: BuilderOptions; lane?: SourceLane; onMakeDriver?: () => void; onChange: (s: SourceStep) => void }) {
  const t = useT()
  const source = options.dataSources.find((d) => d.id === step.dataSourceId)
  const columns = source?.tables.find((tb) => tb.name === step.table)?.columns ?? []
  return (
    <div className="grid gap-3">
      {lane?.several && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="radio" className="size-4 accent-primary" checked={lane.driver} onChange={() => onMakeDriver?.()} />
            {t('steps.source.driver')}
          </label>
          <p className="text-xs text-muted-foreground">{t('steps.source.driverHelp')}</p>
          {lane.staged && <Notice tone="info">{t('steps.source.stagedNote')}</Notice>}
        </div>
      )}
      <Field label={t('steps.source.dataSource')}>
        <NativeSelect value={step.dataSourceId} onChange={(v) => onChange({ ...step, dataSourceId: v, table: '' })}>
          <option value="">{t('steps.source.chooseSource')}</option>
          {options.dataSources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.sourceType})
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div>
        <Field label={t('steps.source.table')}>
          {source && source.tables.length > 0 ? (
            <NativeSelect value={step.table} onChange={(v) => onChange({ ...step, table: v })}>
              <option value="">{t('steps.source.chooseTable')}</option>
              {source.tables.map((tb) => (
                <option key={tb.name} value={tb.name}>
                  {t('steps.source.tableCols', { name: tb.name, count: tb.columns.length })}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input value={step.table} onChange={(e) => onChange({ ...step, table: e.target.value })} placeholder={t('steps.source.tablePlaceholder')} className="font-mono" />
          )}
        </Field>
        {source && source.tables.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{t('steps.source.noScan')}</p>
        )}
      </div>
      <Field label={t('steps.source.maxRows')}>
        <Input type="number" min={1} max={1000000} value={step.maxRows} onChange={(e) => onChange({ ...step, maxRows: Math.max(1, Math.min(1000000, Number(e.target.value) || 1)) })} className="font-mono" />
      </Field>
      <Field label={t('steps.source.syncMode')}>
        <NativeSelect value={step.mode} onChange={(v) => onChange({ ...step, mode: v as 'full' | 'incremental' })}>
          <option value="full">{t('steps.source.modeFull')}</option>
          <option value="incremental">{t('steps.source.modeIncremental')}</option>
        </NativeSelect>
      </Field>
      {step.mode === 'incremental' && (
        <div>
          <Field label={t('steps.source.watermark')}>
            {columns.length ? (
              <NativeSelect value={step.watermarkColumn} onChange={(v) => onChange({ ...step, watermarkColumn: v })}>
                <option value="">{t('steps.source.chooseColumn')}</option>
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input value={step.watermarkColumn} placeholder="updated_at" onChange={(e) => onChange({ ...step, watermarkColumn: e.target.value })} className="font-mono" />
            )}
          </Field>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('steps.source.watermarkHelp')}
            {source && !['postgres', 'mysql', 'sqlserver', 'supabase'].includes(source.sourceType) && t('steps.source.watermarkPostFilter')}
          </p>
          {lane?.staged && <Notice tone="warning" className="mt-2">{t('steps.source.stagedIncremental')}</Notice>}
          {lane?.driver && lane.hasJoins && <Notice tone="warning" className="mt-2">{t('steps.source.driverIncrementalJoin')}</Notice>}
        </div>
      )}
    </div>
  )
}

// ── Conditions (shared by Filter and Router) ─────────────────────────────────

const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty'])

export function ConditionsEditor({
  match,
  conditions,
  columns,
  onChange,
  label,
}: {
  match: 'all' | 'any'
  conditions: Condition[]
  columns: Column[]
  onChange: (match: 'all' | 'any', conditions: Condition[]) => void
  label?: string
}) {
  const t = useT()
  const update = (i: number, patch: Partial<Condition>) => onChange(match, conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {label ?? t('steps.conditions.rowsMatching')}
        <NativeSelect className="w-28" value={match} onChange={(v) => onChange(v as 'all' | 'any', conditions)} aria-label={t('steps.conditions.matchAllAny')}>
          <option value="all">{t('steps.conditions.all')}</option>
          <option value="any">{t('steps.conditions.any')}</option>
        </NativeSelect>
        {t('steps.conditions.of')}
      </div>
      {conditions.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 rounded-md border border-border p-1.5">
          <ColumnPicker columns={columns} value={c.field} onChange={(v) => update(i, { field: v })} label={t('steps.conditions.field')} />
          <NativeSelect value={c.operator} onChange={(v) => update(i, { operator: v as Condition['operator'] })} aria-label={t('steps.conditions.operator')}>
            {FILTER_OPERATORS.map((op) => (
              <option key={op} value={op}>
                {t(`steps.operators.${op}`)}
              </option>
            ))}
          </NativeSelect>
          <Button size="icon-sm" variant="ghost" onClick={() => onChange(match, conditions.filter((_, j) => j !== i))} aria-label={t('steps.conditions.removeCondition', { n: i + 1 })}>
            <X aria-hidden />
          </Button>
          {!NO_VALUE_OPS.has(c.operator) && (
            <div className="col-span-3 grid grid-cols-[auto_1fr] items-center gap-1.5">
              <NativeSelect className="w-28" value={c.valueField ? 'field' : 'value'} onChange={(v) => update(i, { valueField: v === 'field' ? columns[0]?.name ?? '' : '' })} aria-label={t('steps.conditions.compareWith')}>
                <option value="value">{t('steps.conditions.compareValue')}</option>
                <option value="field">{t('steps.conditions.compareField')}</option>
              </NativeSelect>
              {c.valueField ? (
                <ColumnPicker columns={columns} value={c.valueField} onChange={(v) => update(i, { valueField: v })} label={t('steps.conditions.otherField')} />
              ) : (
                <Input value={c.value} placeholder={c.operator === 'in_list' ? 'a, b, c' : t('steps.conditions.valuePlaceholder')} onChange={(e) => update(i, { value: e.target.value })} aria-label={t('steps.conditions.value')} />
              )}
            </div>
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange(match, [...conditions, newCondition(columns[0]?.name ?? '')])}>
        <Plus aria-hidden /> {t('steps.conditions.addCondition')}
      </Button>
    </div>
  )
}

/** `label`: the accessible name; pass null when a visible <Field> already names it. */
function RulePicker({ rules, value, onChange, label }: { rules: BuilderOptions['rules']; value: string; onChange: (v: string) => void; label?: string | null }) {
  const t = useT()
  const name = label === undefined ? t('steps.rulePicker.label') : label
  return (
    <NativeSelect value={value} onChange={onChange} aria-label={name ?? undefined}>
      <option value="">{rules.length ? t('steps.rulePicker.choose') : t('steps.rulePicker.none')}</option>
      {rules.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </NativeSelect>
  )
}

// ── Filter ───────────────────────────────────────────────────────────────────

export function FilterEditor({ step, columns, options, onChange }: { step: FilterStep; columns: Column[]; options: BuilderOptions; onChange: (s: FilterStep) => void }) {
  const t = useT()
  return (
    <div className="space-y-3">
      <Field label={t('steps.filter.rule')}>
        <RulePicker rules={options.rules} value={step.ruleId} onChange={(v) => onChange({ ...step, ruleId: v })} label={null} />
      </Field>
      <ConditionsEditor
        label={step.ruleId ? t('steps.filter.and') : t('steps.filter.keepMatching')}
        match={step.match}
        conditions={step.conditions}
        columns={columns}
        onChange={(match, conditions) => onChange({ ...step, match, conditions })}
      />
    </div>
  )
}

/** `label`: the accessible name; pass null when a visible <Field> already names it. */
export function ColumnPicker({ columns, value, onChange, label }: { columns: Column[]; value: string; onChange: (v: string) => void; label?: string | null }) {
  const t = useT()
  const name = label === undefined ? t('steps.columnPicker.label') : label
  if (!columns.length) return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('steps.columnPicker.placeholder')} aria-label={name ?? undefined} className="font-mono" />
  const known = columns.some((c) => c.name === value)
  return (
    <NativeSelect value={value} onChange={onChange} aria-label={name ?? undefined}>
      <option value="">{t('steps.columnPicker.choose')}</option>
      {!known && value && <option value={value}>{t('steps.columnPicker.notInSchema', { name: value })}</option>}
      {columns.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </NativeSelect>
  )
}

// ── Map ──────────────────────────────────────────────────────────────────────

type ArgKey = keyof (typeof stepsMessages)['map']['args']
/** The concat template is an example value, not text, so it is shown as is. */
const CONCAT_EXAMPLE = '{first_name} {last_name}'

const TRANSFORM_ARGS: Partial<Record<TransformName, (ArgKey | typeof CONCAT_EXAMPLE)[]>> = {
  replace: ['find', 'replaceWith'],
  regex_replace: ['pattern', 'replaceWith'],
  regex_extract: ['pattern', 'group'],
  default_if_empty: ['default'],
  coalesce: ['column', 'column'],
  prefix: ['prefix'],
  suffix: ['suffix'],
  substring: ['start', 'length'],
  concat: [CONCAT_EXAMPLE],
  split: ['separator', 'part'],
  format_date: ['outputFormat', 'inputFormat', 'timezone'],
  round: ['decimals'],
  number_format: ['decimals', 'locale'],
  hash: ['salt'],
  conditional: ['operator', 'value', 'then', 'else'],
  lookup: ['dataset', 'keyColumn', 'valueColumn', 'notFound'],
}

export function MapEditor({ step, columns, options, source, onChange }: { step: MapStep; columns: Column[]; options?: BuilderOptions; source?: { dataSourceId: string; table: string }; onChange: (s: MapStep) => void }) {
  const t = useT()
  const argText = (a: ArgKey | typeof CONCAT_EXAMPLE) => (a === CONCAT_EXAMPLE ? a : t(`steps.map.args.${a}`))
  const update = (i: number, patch: Partial<MapStep['fields'][number]>) => onChange({ ...step, fields: step.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const [templateMsg, setTemplateMsg] = useState<{ tone: NoticeTone; text: string } | null>(null)
  const [templateName, setTemplateName] = useState<string | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [mapperOpen, setMapperOpen] = useState(false)
  const autoMap = () => {
    // HR synonyms (PERNR → employee_code, TGL_LAHIR → birth_date …), else a safe snake_case name.
    const existing = new Set(step.fields.map((f) => f.from))
    const added = autoMapFields(columns, existing).filter((f) => !step.fields.some((x) => x.to === f.to))
    onChange({ ...step, fields: [...step.fields.filter((f) => f.from), ...added] })
  }
  const templates: MappingTemplate[] = [...BUILTIN_MAPPING_TEMPLATES, ...(options?.mappingTemplates ?? [])]
  const applyTemplate = (id: string) => {
    const tpl = templates.find((x) => x.id === id)
    if (!tpl) return
    const { fields, missing } = applyMappingTemplate(tpl, columns.length ? columns : tpl.fields.map((f) => ({ name: f.from, type: 'text' })))
    if (!fields.length) return setTemplateMsg({ tone: 'warning', text: t('steps.map.templateNoMatch', { columns: tpl.fields.map((f) => f.from).slice(0, 5).join(', ') }) })
    onChange({ ...step, fields, keepUnmapped: tpl.keepUnmapped })
    setTemplateMsg({
      tone: 'success',
      text: missing.length
        ? t('steps.map.templateAppliedMissing', { name: tpl.name, count: fields.length, missing: missing.join(', ') })
        : t('steps.map.templateApplied', { name: tpl.name, count: fields.length }),
    })
  }
  const saveTemplate = async () => {
    const name = templateName?.trim()
    if (!name) return
    setSavingTemplate(true)
    try {
      const res = await saveMappingTemplate({ name, fields: step.fields.filter((f) => f.from && f.to), keepUnmapped: step.keepUnmapped })
      setTemplateMsg({ tone: 'success', text: res.replaced ? t('steps.map.templateUpdated', { name }) : t('steps.map.templateSaved', { name }) })
      setTemplateName(null)
    } catch (err) {
      setTemplateMsg({ tone: 'danger', text: err instanceof Error ? err.message : t('steps.map.saveFailed') })
    } finally {
      setSavingTemplate(false)
    }
  }
  return (
    <div className="space-y-2">
      {mapperOpen && (
        <TwoPaneMapper
          step={step}
          columns={columns}
          options={options}
          onClose={() => setMapperOpen(false)}
          onApply={(fields) => {
            onChange({ ...step, fields })
            setMapperOpen(false)
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setMapperOpen(true)} disabled={!columns.length}>
          <Columns2 aria-hidden /> {t('steps.map.mapper.open')}
        </Button>
        <Button size="sm" variant="outline" onClick={autoMap} disabled={!columns.length}>
          <Wand2 aria-hidden /> {t('steps.map.autoMap')}
        </Button>
        <NativeSelect value="" onChange={applyTemplate} className="w-auto text-xs" aria-label={t('steps.map.applyTemplateLabel')}>
          <option value="">{t('steps.map.applyTemplate')}</option>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
              {tpl.builtIn ? '' : t('steps.map.saved')}
            </option>
          ))}
        </NativeSelect>
        <AiMappingButton
          columns={columns.filter((c) => !step.fields.some((f) => f.from === c.name))}
          mapped={step.fields.map((f) => f.to).filter(Boolean)}
          source={source}
          onAccept={(added) => onChange({ ...step, fields: [...step.fields.filter((f) => f.from), ...added.filter((a) => !step.fields.some((f) => f.to === a.to))] })}
        />
        <Button size="sm" variant="ghost" onClick={() => setTemplateName((v) => (v === null ? '' : null))} disabled={!step.fields.some((f) => f.from && f.to)} aria-expanded={templateName !== null}>
          {t('steps.map.saveAsTemplate')}
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4 accent-primary" checked={step.keepUnmapped} onChange={(e) => onChange({ ...step, keepUnmapped: e.target.checked })} />
          {t('steps.map.passThrough')}
        </label>
      </div>
      {templateName !== null && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
          onSubmit={(e) => {
            e.preventDefault()
            void saveTemplate()
          }}
        >
          <Field label={t('steps.map.templateName')} className="min-w-0 flex-1">
            <Input autoFocus value={templateName} placeholder={t('steps.map.templateNamePlaceholder')} onChange={(e) => setTemplateName(e.target.value)} />
          </Field>
          <Button type="submit" size="sm" disabled={!templateName.trim() || savingTemplate}>
            {t('steps.map.saveTemplate')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTemplateName(null)}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground">{t('steps.map.help')}</p>
      {templateMsg && (
        <Notice tone={templateMsg.tone} className="text-xs">
          {templateMsg.text}
        </Notice>
      )}
      {step.fields.map((f, i) => (
        <div key={i} className="rounded-md border border-border p-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <ColumnPicker columns={columns} value={f.from} onChange={(v) => update(i, { from: v, to: f.to || autoMapName(v) })} label={t('steps.map.sourceColumn', { n: i + 1 })} />
            <Input value={f.to} placeholder={t('steps.map.targetPlaceholder')} onChange={(e) => update(i, { to: e.target.value })} aria-label={t('steps.map.targetColumn', { n: i + 1 })} className="font-mono" />
            <Button size="icon-sm" variant="ghost" disabled={step.fields.length === 1} onClick={() => onChange({ ...step, fields: step.fields.filter((_, j) => j !== i) })} aria-label={t('steps.map.removeField', { name: f.to || i + 1 })}>
              <Trash2 aria-hidden />
            </Button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <NativeSelect className="h-7 w-28 text-xs" value={f.type} onChange={(v) => update(i, { type: v as ColumnType })} aria-label={t('steps.map.typeOf', { name: f.to || t('steps.map.fieldN', { n: i + 1 }) })}>
              {COLUMN_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {ty}
                </option>
              ))}
            </NativeSelect>
            {f.transforms.map((tr, ti) => (
              <div key={ti} className="flex flex-wrap items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                <span className="font-medium">{t(`steps.transforms.${tr.fn}`)}</span>
                {(TRANSFORM_ARGS[tr.fn] ?? []).map((arg, ai) => (
                  <input
                    key={ai}
                    value={tr.args[ai] ?? ''}
                    placeholder={argText(arg)}
                    aria-label={t('steps.map.argLabel', { transform: t(`steps.transforms.${tr.fn}`), arg: argText(arg) })}
                    onChange={(e) => {
                      const args = [...tr.args]
                      args[ai] = e.target.value
                      update(i, { transforms: f.transforms.map((x, xi) => (xi === ti ? { ...x, args } : x)) })
                    }}
                    className={chipInputClass}
                  />
                ))}
                <button
                  type="button"
                  className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  onClick={() => update(i, { transforms: f.transforms.filter((_, xi) => xi !== ti) })}
                  aria-label={t('steps.map.removeTransform', { name: t(`steps.transforms.${tr.fn}`) })}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            ))}
            <NativeSelect
              value=""
              aria-label={t('steps.map.addTransformTo', { name: f.to || t('steps.map.fieldN', { n: i + 1 }) })}
              onChange={(v) => v && update(i, { transforms: [...f.transforms, { fn: v as TransformName, args: [] }] })}
              className="h-7 w-auto border-dashed px-1 text-xs text-muted-foreground"
            >
              <option value="">{t('steps.map.addTransform')}</option>
              {TRANSFORMS.map((tr) => (
                <option key={tr} value={tr}>
                  {t(`steps.transforms.${tr}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange({ ...step, fields: [...step.fields, { from: '', to: '', type: 'text', transforms: [] }] })}>
        <Plus aria-hidden /> {t('steps.map.addField')}
      </Button>
    </div>
  )
}

// ── Validate ─────────────────────────────────────────────────────────────────

const VALUE_RULES = new Set(['regex', 'min_length', 'max_length', 'min', 'max', 'one_of'])
const COMPARE_OPERATORS = ['greater_or_equal', 'greater_than', 'less_or_equal', 'less_than', 'equals', 'not_equals'] as const

export function ValidateEditor({ step, columns, options, onChange }: { step: ValidateStep; columns: Column[]; options: BuilderOptions; onChange: (s: ValidateStep) => void }) {
  const t = useT()
  const update = (i: number, patch: Partial<ValidationRuleSpec>) => onChange({ ...step, rules: step.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const lookups = options.datasets.flatMap((d) => d.columns.map((c) => `${d.name}.${c.name}`))
  const [packMsg, setPackMsg] = useState<{ tone: NoticeTone; title?: string; lines: string[] } | null>(null)
  /** hrRulePack (lib/pipelines/templates.ts) writes its notes in English; show the known ones in the interface language. */
  const packNote = (note: string) => {
    const noDataset = /^No dataset with (\S+) yet;/.exec(note)
    if (noDataset) return t('steps.validate.packNoDataset', { column: noDataset[1] })
    if (note.startsWith('No employee code column recognized')) return t('steps.validate.packNoCode')
    return note
  }
  const addPack = () => {
    const { rules, notes } = hrRulePack(columns, options.datasets)
    const lines = notes.map(packNote)
    if (!rules.length) return setPackMsg({ tone: 'warning', lines: lines.length ? lines : [t('steps.validate.packNone')] })
    const existing = step.rules.filter((r) => r.field)
    onChange({ ...step, rules: [...existing, ...rules] })
    setPackMsg({ tone: 'success', title: t('steps.validate.packAdded', { count: rules.length }), lines })
  }
  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={addPack} disabled={!columns.length}>
        <Sparkles aria-hidden /> {t('steps.validate.addPack')}
      </Button>
      {packMsg && (
        <Notice
          tone={packMsg.tone}
          title={packMsg.title}
          className="text-xs"
          action={
            <Button size="icon-xs" variant="ghost" onClick={() => setPackMsg(null)} aria-label={t('steps.validate.dismissPack')}>
              <X aria-hidden />
            </Button>
          }
        >
          {packMsg.lines.length > 0 && (
            <ul className="space-y-0.5">
              {packMsg.lines.map((l, k) => (
                <li key={k}>{l}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      {step.rules.map((r, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border p-1.5">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <ColumnPicker columns={columns} value={r.field} onChange={(v) => update(i, { field: v })} label={t('steps.validate.fieldOfRule', { n: i + 1 })} />
            <NativeSelect value={r.rule} onChange={(v) => update(i, { rule: v as ValidationRuleSpec['rule'], value: '' })} aria-label={t('steps.validate.ruleN', { n: i + 1 })}>
              {VALIDATION_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {t(`steps.validate.rules.${rule}`)}
                </option>
              ))}
            </NativeSelect>
            <Button size="icon-sm" variant="ghost" disabled={step.rules.length === 1} onClick={() => onChange({ ...step, rules: step.rules.filter((_, j) => j !== i) })} aria-label={t('steps.validate.removeRule', { n: i + 1 })}>
              <X aria-hidden />
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-1.5">
            {VALUE_RULES.has(r.rule) ? (
              <Input value={r.value} placeholder={r.rule === 'one_of' ? 'a, b, c' : t('steps.validate.valuePlaceholder')} onChange={(e) => update(i, { value: e.target.value })} aria-label={t('steps.validate.ruleValue')} />
            ) : r.rule === 'exists_in' ? (
              <NativeSelect value={r.value} onChange={(v) => update(i, { value: v })} aria-label={t('steps.validate.lookupColumn')}>
                <option value="">{lookups.length ? t('steps.validate.lookupPlaceholder') : t('steps.validate.noDatasets')}</option>
                {lookups.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            ) : r.rule === 'compare' ? (
              <div className="grid grid-cols-2 gap-1.5">
                <NativeSelect value={r.operator} onChange={(v) => update(i, { operator: v as ValidationRuleSpec['operator'] })} aria-label={t('steps.validate.comparison')}>
                  {COMPARE_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {t(`steps.operators.${op}`)}
                    </option>
                  ))}
                </NativeSelect>
                <ColumnPicker columns={columns} value={r.otherField} onChange={(v) => update(i, { otherField: v })} label={t('steps.validate.otherField')} />
              </div>
            ) : r.rule === 'condition' ? (
              <RulePicker rules={options.rules} value={r.ruleId} onChange={(v) => update(i, { ruleId: v })} label={t('steps.validate.ruleForRule', { n: i + 1 })} />
            ) : r.rule === 'manager' ? (
              <ColumnPicker columns={columns} value={r.value} onChange={(v) => update(i, { value: v })} label={t('steps.validate.employeeKey')} />
            ) : r.rule === 'date' ? (
              <Input value={r.value} placeholder={t('steps.validate.datePlaceholder')} onChange={(e) => update(i, { value: e.target.value })} aria-label={t('steps.validate.dateFormat')} />
            ) : (
              <span />
            )}
            <NativeSelect value={r.severity} onChange={(v) => update(i, { severity: v as ValidationRuleSpec['severity'] })} aria-label={t('steps.validate.severityOf', { n: i + 1 })}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`steps.validate.severities.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onChange({ ...step, rules: [...step.rules, newValidationRule(columns[0]?.name ?? '')] })}>
          <Plus aria-hidden /> {t('steps.validate.addRule')}
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('steps.validate.onError')}
          <NativeSelect className="w-48" value={step.onFail} onChange={(v) => onChange({ ...step, onFail: v as 'reject' | 'abort' })}>
            <option value="reject">{t('steps.validate.onFailReject')}</option>
            <option value="abort">{t('steps.validate.onFailAbort')}</option>
          </NativeSelect>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t('steps.validate.help')}</p>
    </div>
  )
}

// ── Business rules node ──────────────────────────────────────────────────────

export function RulesEditor({ step, options, onChange }: { step: RulesStep; options: BuilderOptions; onChange: (s: RulesStep) => void }) {
  const t = useT()
  const toggle = (id: string) => onChange({ ...step, ruleIds: step.ruleIds.includes(id) ? step.ruleIds.filter((x) => x !== id) : [...step.ruleIds, id] })
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('steps.rules.help')}</p>
      {options.rules.length === 0 && (
        <EmptyState compact icon={<Scale />} title={t('steps.rules.emptyTitle')} className="rounded-md border border-border">
          {t('steps.rules.emptyBody')}
        </EmptyState>
      )}
      {options.rules.map((r) => (
        <label
          key={r.id}
          className={cn(
            'flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
            step.ruleIds.includes(r.id) ? 'border-ring bg-accent text-accent-foreground' : 'border-border hover:bg-muted',
          )}
        >
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={step.ruleIds.includes(r.id)} onChange={() => toggle(r.id)} />
          <span>
            <span className="font-medium">{r.name}</span>
            {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
          </span>
        </label>
      ))}
      {step.ruleIds.length > 1 && (
        <p className="text-xs text-muted-foreground">{t('steps.rules.order', { order: step.ruleIds.map((id) => options.rules.find((r) => r.id === id)?.name ?? id).join(' → ') })}</p>
      )}
    </div>
  )
}

// ── Router ───────────────────────────────────────────────────────────────────

export function RouterEditor({ step, columns, options, onChange }: { step: RouterStep; columns: Column[]; options: BuilderOptions; onChange: (s: RouterStep) => void }) {
  const t = useT()
  const update = (i: number, patch: Partial<RouterStep['branches'][number]>) => onChange({ ...step, branches: step.branches.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('steps.router.help')}</p>
      {step.branches.map((b, i) => (
        <div key={b.id} className="space-y-2 rounded-md border border-border p-2">
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <Input value={b.label} onChange={(e) => update(i, { label: e.target.value })} placeholder={t('steps.router.branchName')} aria-label={t('steps.router.branchNameN', { n: i + 1 })} />
            <Button size="icon-sm" variant="ghost" disabled={step.branches.length === 1} onClick={() => onChange({ ...step, branches: step.branches.filter((_, j) => j !== i) })} aria-label={t('steps.router.removeBranch', { name: b.label || i + 1 })}>
              <Trash2 aria-hidden />
            </Button>
          </div>
          <NativeSelect value={b.ruleId ? 'rule' : 'conditions'} onChange={(v) => update(i, v === 'rule' ? { ruleId: options.rules[0]?.id ?? '', condition: undefined } : { ruleId: '', condition: { match: 'all', conditions: [newCondition(columns[0]?.name ?? '')], groups: [] } })} aria-label={t('steps.router.matchesBy', { name: b.label || i + 1 })}>
            <option value="conditions">{t('steps.router.byConditions')}</option>
            <option value="rule">{t('steps.router.byRule')}</option>
          </NativeSelect>
          {b.ruleId || (!b.condition && options.rules.length) ? (
            <RulePicker rules={options.rules} value={b.ruleId} onChange={(v) => update(i, { ruleId: v })} label={t('steps.router.ruleForBranch', { name: b.label || i + 1 })} />
          ) : (
            <ConditionsEditor
              match={b.condition?.match ?? 'all'}
              conditions={b.condition?.conditions ?? []}
              columns={columns}
              onChange={(match, conditions) => update(i, { condition: { match, conditions, groups: [] } })}
            />
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange({ ...step, branches: [...step.branches, { id: newStepId(), label: t('steps.router.defaultLabel', { n: step.branches.length + 1 }), ruleId: '', condition: { match: 'all', conditions: [newCondition(columns[0]?.name ?? '')], groups: [] } }] })}>
        <Plus aria-hidden /> {t('steps.router.addBranch')}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t('steps.router.otherwiseBefore')}
        <span className="font-mono font-medium">{OTHERWISE}</span>
        {t('steps.router.otherwiseAfter')}
      </p>
    </div>
  )
}

// ── Destination ──────────────────────────────────────────────────────────────

/** Data sources a pipeline can write to: tables (kind "datasource") or a REST API (kind "api"). Mirrors WRITABLE_CONNECTORS in lib/pipelines/io.ts. */
const WRITABLE = new Set(['postgres', 'mysql', 'supabase', 'kmplus', 'rest'])

export function DestinationEditor({
  step,
  options,
  columns,
  sampleRow,
  pipelineId,
  onChange,
}: {
  step: DestinationStep
  options: BuilderOptions
  columns: Column[]
  /** First row reaching this step in the last test run (API test requests). */
  sampleRow?: Record<string, unknown>
  pipelineId?: string
  onChange: (s: DestinationStep) => void
}) {
  const t = useT()
  const writable = options.dataSources.filter((d) => WRITABLE.has(d.sourceType))
  // Added as destinations but of a type Nexus has no writer for: listed, not selectable.
  const unwritable = options.dataSources.filter((d) => d.role === 'destination' && !WRITABLE.has(d.sourceType))
  const target = step.kind !== 'dataset' ? options.dataSources.find((d) => d.id === step.dataSourceId) : undefined
  const targetColumns = target?.tables.find((tb) => tb.name === (step.kind === 'datasource' ? step.table : ''))?.columns ?? []
  const chooseSource = (id: string) => {
    const ds = options.dataSources.find((d) => d.id === id)
    if (ds?.sourceType === 'rest') onChange(step.kind === 'api' ? { ...step, dataSourceId: id } : newApiDestination({ id: step.id, position: step.position }, id))
    else onChange({ id: step.id, type: 'destination', position: step.position, kind: 'datasource', dataSourceId: id, table: '', mode: 'append', keys: [], softDeleteMissing: false, softDeleteColumn: '' })
  }
  const toggleKey = (k: string) => onChange({ ...step, keys: step.keys.includes(k) ? step.keys.filter((x) => x !== k) : [...step.keys, k] } as DestinationStep)
  const base = { id: step.id, type: 'destination' as const, position: step.position, keys: [], softDeleteMissing: false }
  // A defined dataset: the schema's keys and columns, mapped target first.
  const schema = step.kind === 'dataset' ? schemaFor(options, step.datasetName) : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('steps.destination.writeTo')}>
        <Button size="sm" aria-pressed={step.kind === 'dataset'} variant={step.kind === 'dataset' ? 'default' : 'outline'} onClick={() => onChange({ ...base, kind: 'dataset', datasetName: '', mode: 'replace' })}>
          {t('steps.destination.dataset')}
        </Button>
        <Button size="sm" aria-pressed={step.kind !== 'dataset'} variant={step.kind !== 'dataset' ? 'default' : 'outline'} onClick={() => step.kind === 'dataset' && onChange({ ...base, kind: 'datasource', dataSourceId: '', table: '', mode: 'append', softDeleteColumn: '' })}>
          {t('steps.destination.database')}
        </Button>
      </div>

      {step.kind === 'dataset' ? (
        <div className="grid gap-3">
          <Field label={t('steps.destination.datasetName')}>
            <Input list="nexus-datasets" value={step.datasetName} placeholder="employee_master" onChange={(e) => onChange({ ...step, datasetName: e.target.value.toLowerCase() })} className="font-mono" />
          </Field>
          <datalist id="nexus-datasets">
            {options.datasets.map((d) => (
              <option key={d.name} value={d.name} />
            ))}
          </datalist>
          <Field label={t('steps.destination.writeMode')}>
            <NativeSelect value={step.mode} onChange={(v) => onChange({ ...step, mode: v as 'append' | 'upsert' | 'replace', softDeleteMissing: v === 'upsert' ? step.softDeleteMissing : false })}>
              <option value="replace">{t('steps.destination.modeReplace')}</option>
              <option value="upsert">{t('steps.destination.modeUpsert')}</option>
              <option value="append">{t('steps.destination.modeAppend')}</option>
            </NativeSelect>
          </Field>
          {schema && <SchemaMappingFields step={step} schema={schema} columns={columns} onChange={onChange} />}
        </div>
      ) : (
        <div className="grid gap-3">
          <Field label={t('steps.destination.destinationDb')}>
            <NativeSelect value={step.dataSourceId} onChange={chooseSource}>
              <option value="">{t('steps.destination.choose')}</option>
              {writable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.sourceType}){d.role !== 'destination' ? t('steps.destination.notDestination') : ''}
                </option>
              ))}
              {unwritable.map((d) => (
                <option key={d.id} value={d.id} disabled>
                  {t('steps.destination.cantWrite', { name: d.name, type: getConnectorDefinition(d.sourceType)?.name ?? d.sourceType })}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {!writable.length && <p className="text-xs text-muted-foreground">{t('steps.destination.noWritable')}</p>}
          {target && target.role !== 'destination' && (
            <Notice tone="warning" className="text-xs">
              {t('steps.destination.addedAsSource', { name: target.name })}
            </Notice>
          )}
          {step.kind === 'api' ? (
            <ApiDestinationFields step={step} options={options} columns={columns} sampleRow={sampleRow} pipelineId={pipelineId} onChange={onChange} />
          ) : (
          <>
          <Field label={t('steps.destination.tableExisting')}>
            {target && target.tables.length ? (
              <NativeSelect value={step.table} onChange={(v) => onChange({ ...step, table: v })}>
                <option value="">{t('steps.destination.chooseTable')}</option>
                {target.tables.map((tb) => (
                  <option key={tb.name} value={tb.name}>
                    {tb.name}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input value={step.table} placeholder="table_name" onChange={(e) => onChange({ ...step, table: e.target.value })} className="font-mono" />
            )}
          </Field>
          <Field label={t('steps.destination.writeMode')}>
            <NativeSelect value={step.mode} onChange={(v) => onChange({ ...step, mode: v as 'append' | 'upsert', softDeleteMissing: v === 'upsert' ? step.softDeleteMissing : false })}>
              <option value="append">{t('steps.destination.dbAppend')}</option>
              <option value="upsert">{t('steps.destination.dbUpsert')}</option>
            </NativeSelect>
          </Field>
          </>
          )}
        </div>
      )}

      {(step.mode === 'upsert' || step.mode === 'replace') && !schema?.keys.length && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted-foreground">{step.mode === 'replace' ? t('steps.destination.keysOptional') : t('steps.destination.keys')}</legend>
          {step.mode === 'replace' && (
            <p className="mb-2 text-xs text-muted-foreground">{t('steps.destination.keysReplaceHelp')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {columns.length ? (
              columns.map((c) => (
                <label
                  key={c.name}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                    step.keys.includes(c.name) ? 'border-ring bg-accent text-accent-foreground' : 'border-border hover:bg-muted',
                  )}
                >
                  <input type="checkbox" className="accent-primary" checked={step.keys.includes(c.name)} onChange={() => toggleKey(c.name)} />
                  {c.name}
                </label>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">{t('steps.destination.configureFirst')}</span>
            )}
          </div>
          {step.mode === 'upsert' && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={step.softDeleteMissing} onChange={(e) => onChange({ ...step, softDeleteMissing: e.target.checked } as DestinationStep)} />
            <span>
              {t('steps.destination.softDelete')}
              <span className="block text-xs text-muted-foreground">{t('steps.destination.softDeleteHelp')}</span>
            </span>
          </label>
          )}
          {step.mode === 'upsert' && step.kind === 'datasource' && step.softDeleteMissing && (
            <Field label={t('steps.destination.softDeleteColumn')} className="mt-2">
              <ColumnPicker columns={targetColumns} value={step.softDeleteColumn} onChange={(v) => onChange({ ...step, softDeleteColumn: v })} label={null} />
            </Field>
          )}
        </fieldset>
      )}
    </div>
  )
}

// ── Join ─────────────────────────────────────────────────────────────────────

export function JoinEditor({ step, left, right, defaultPrefix, connected, onChange }: { step: JoinStep; left: Column[]; right: Column[]; defaultPrefix: string; connected: boolean; onChange: (s: JoinStep) => void }) {
  const t = useT()
  const setKey = (i: number, patch: Partial<JoinStep['keys'][number]>) => onChange({ ...step, keys: step.keys.map((k, j) => (j === i ? { ...k, ...patch } : k)) })
  const check = (key: keyof JoinStep['normalize'], label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-primary" checked={step.normalize[key]} onChange={(e) => onChange({ ...step, normalize: { ...step.normalize, [key]: e.target.checked } })} />
      {label}
    </label>
  )
  const setType = (v: string) => {
    const joinType = v as JoinStep['joinType']
    // Inner joins can't keep rows without a partner; left joins keep them by default.
    const onNoMatch = joinType === 'inner' && step.onNoMatch === 'keep' ? 'drop' : joinType === 'left' && step.onNoMatch === 'drop' ? 'keep' : step.onNoMatch
    onChange({ ...step, joinType, onNoMatch })
  }
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{t('steps.join.help')}</p>
      {!connected && <Notice tone="warning">{t('steps.join.connectBoth')}</Notice>}
      <Field label={t('steps.join.type')}>
        <NativeSelect value={step.joinType} onChange={setType}>
          <option value="left">{t('steps.join.typeLeft')}</option>
          <option value="inner">{t('steps.join.typeInner')}</option>
          <option value="no_match">{t('steps.join.typeNoMatch')}</option>
        </NativeSelect>
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-muted-foreground">{t('steps.join.keys')}</legend>
        {step.keys.map((k, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
            <ColumnPicker columns={left} value={k.left} onChange={(v) => setKey(i, { left: v, right: k.right || (right.some((c) => c.name === v) ? v : '') })} label={t('steps.join.leftKey', { n: i + 1 })} />
            <ColumnPicker columns={right} value={k.right} onChange={(v) => setKey(i, { right: v })} label={t('steps.join.rightKey', { n: i + 1 })} />
            <Button size="icon-sm" variant="ghost" disabled={step.keys.length === 1} onClick={() => onChange({ ...step, keys: step.keys.filter((_, j) => j !== i) })} aria-label={t('steps.join.removeKey', { n: i + 1 })}>
              <X aria-hidden />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" disabled={step.keys.length >= 5} onClick={() => onChange({ ...step, keys: [...step.keys, { left: '', right: '' }] })}>
          <Plus aria-hidden /> {t('steps.join.addKey')}
        </Button>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-muted-foreground">{t('steps.join.normalize')}</legend>
        {check('trim', t('steps.join.trim'))}
        {check('ignoreCase', t('steps.join.ignoreCase'))}
        {check('leadingZeros', t('steps.join.leadingZeros'))}
      </fieldset>
      {step.joinType !== 'no_match' && (
        <>
          <Field label={t('steps.join.many')}>
            <NativeSelect value={step.onMany} onChange={(v) => onChange({ ...step, onMany: v as JoinStep['onMany'] })}>
              <option value="all">{t('steps.join.manyAll')}</option>
              <option value="first">{t('steps.join.manyFirst')}</option>
            </NativeSelect>
          </Field>
          {step.onMany === 'all' ? (
            <p className="text-xs text-muted-foreground">{t('steps.join.multiplyNote')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              <Field label={t('steps.join.firstBy')}>
                <NativeSelect value={step.firstBy.column} onChange={(v) => onChange({ ...step, firstBy: { ...step.firstBy, column: v } })}>
                  <option value="">{t('steps.join.firstByStaged')}</option>
                  {right.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={<span className="sr-only">{t('steps.join.firstBy')}</span>}>
                <NativeSelect value={step.firstBy.direction} disabled={!step.firstBy.column} onChange={(v) => onChange({ ...step, firstBy: { ...step.firstBy, direction: v as 'asc' | 'desc' } })}>
                  <option value="desc">{t('steps.join.desc')}</option>
                  <option value="asc">{t('steps.join.asc')}</option>
                </NativeSelect>
              </Field>
            </div>
          )}
          <Field label={t('steps.join.noMatch')}>
            <NativeSelect value={step.onNoMatch} onChange={(v) => onChange({ ...step, onNoMatch: v as JoinStep['onNoMatch'] })}>
              {step.joinType === 'left' && <option value="keep">{t('steps.join.noMatchKeep')}</option>}
              <option value="drop">{t('steps.join.noMatchDrop')}</option>
              <option value="quarantine">{t('steps.join.noMatchQuarantine')}</option>
            </NativeSelect>
          </Field>
          <Field label={t('steps.join.prefix')}>
            <Input value={step.prefix} placeholder={t('steps.join.prefixDefault', { prefix: defaultPrefix })} onChange={(e) => onChange({ ...step, prefix: e.target.value.trim() })} className="font-mono" />
          </Field>
        </>
      )}
    </div>
  )
}

// ── Union ────────────────────────────────────────────────────────────────────

export function UnionEditor({ step, inputs, onChange }: { step: UnionStep; inputs: { from: string; name: string; defaultLabel: string }[]; onChange: (s: UnionStep) => void }) {
  const t = useT()
  const labelOf = (from: string) => step.labels.find((l) => l.from === from)?.label ?? ''
  const setLabel = (from: string, label: string) => onChange({ ...step, labels: [...step.labels.filter((l) => l.from !== from), ...(label ? [{ from, label }] : [])] })
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{t('steps.union.help')}</p>
      {inputs.length < 2 && <Notice tone="warning">{t('steps.union.noInputs')}</Notice>}
      <div>
        <Field label={t('steps.union.sourceColumn')}>
          <Input value={step.sourceColumn} onChange={(e) => onChange({ ...step, sourceColumn: e.target.value.trim() })} className="font-mono" />
        </Field>
        <p className="mt-1 text-xs text-muted-foreground">{t('steps.union.sourceColumnHelp')}</p>
      </div>
      {step.sourceColumn &&
        inputs.map((i) => (
          <Field key={i.from} label={t('steps.union.labelFor', { name: i.name })}>
            <Input value={labelOf(i.from)} placeholder={i.defaultLabel} onChange={(e) => setLabel(i.from, e.target.value)} />
          </Field>
        ))}
    </div>
  )
}

// ── Aggregate ────────────────────────────────────────────────────────────────

const FN_NEEDS_COLUMN = (fn: AggregateFn) => fn !== 'count'

/** A column picked from a list, or none. */
function ColumnChecklist({ columns, value, onChange, label }: { columns: Column[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {columns.map((c) => (
          <label key={c.name} className="flex items-center gap-1.5 font-mono text-xs">
            <input type="checkbox" className="size-3.5 accent-primary" checked={value.includes(c.name)} onChange={(e) => onChange(e.target.checked ? [...value, c.name] : value.filter((x) => x !== c.name))} />
            {c.name}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function AggregateEditor({ step, columns, onChange }: { step: AggregateStep; columns: Column[]; onChange: (s: AggregateStep) => void }) {
  const t = useT()
  const dates = columns.filter((c) => c.type === 'date' || c.type === 'timestamp' || /date|time|_at$/i.test(c.name))
  const setMeasure = (i: number, patch: Partial<AggregateMeasure>) => onChange({ ...step, measures: step.measures.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{t('steps.aggregate.help')}</p>
      {columns.length ? (
        <ColumnChecklist columns={columns} value={step.groupBy} onChange={(groupBy) => onChange({ ...step, groupBy })} label={t('steps.aggregate.groupBy')} />
      ) : (
        <Field label={t('steps.aggregate.groupBy')}>
          <Input value={step.groupBy.join(', ')} onChange={(e) => onChange({ ...step, groupBy: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} className="font-mono" />
        </Field>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-1.5">
        <Field label={t('steps.aggregate.timeGrain')}>
          <NativeSelect value={step.timeGrain?.column ?? ''} onChange={(v) => onChange({ ...step, timeGrain: v ? { column: v, grain: step.timeGrain?.grain ?? 'month', as: step.timeGrain?.as ?? '' } : undefined })}>
            <option value="">{t('steps.aggregate.noTimeGrain')}</option>
            {(dates.length ? dates : columns).map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={<span className="sr-only">{t('steps.aggregate.grain')}</span>}>
          <NativeSelect value={step.timeGrain?.grain ?? 'month'} disabled={!step.timeGrain} onChange={(v) => step.timeGrain && onChange({ ...step, timeGrain: { ...step.timeGrain, grain: v as TimeGrain } })}>
            {TIME_GRAINS.map((g) => (
              <option key={g} value={g}>
                {t(`steps.aggregate.grains.${g}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {step.timeGrain && (
        <Field label={t('steps.aggregate.bucketName')}>
          <Input value={step.timeGrain.as} placeholder={timeGrainColumn({ ...step.timeGrain, as: '' })} onChange={(e) => step.timeGrain && onChange({ ...step, timeGrain: { ...step.timeGrain, as: e.target.value.trim() } })} className="font-mono" />
        </Field>
      )}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">{t('steps.aggregate.measures')}</legend>
        {step.measures.map((m, i) => (
          <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <Input value={m.name} onChange={(e) => setMeasure(i, { name: e.target.value.trim() })} aria-label={t('steps.aggregate.measureName', { n: i + 1 })} className="font-mono" />
              <Button size="icon-sm" variant="ghost" disabled={step.measures.length === 1} onClick={() => onChange({ ...step, measures: step.measures.filter((_, j) => j !== i) })} aria-label={t('steps.aggregate.removeMeasure', { n: i + 1 })}>
                <Trash2 aria-hidden />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <NativeSelect value={m.fn} onChange={(v) => setMeasure(i, { fn: v as AggregateFn })} aria-label={t('steps.aggregate.fn', { n: i + 1 })}>
                {AGGREGATE_FNS.map((f) => (
                  <option key={f} value={f}>
                    {t(`steps.aggregate.fns.${f}`)}
                  </option>
                ))}
              </NativeSelect>
              <ColumnPicker columns={columns} value={m.column} onChange={(v) => setMeasure(i, { column: v })} label={t('steps.aggregate.column', { n: i + 1 })} />
            </div>
            {!FN_NEEDS_COLUMN(m.fn) && !m.column && <p className="text-xs text-muted-foreground">{t('steps.aggregate.countRows')}</p>}
            {(m.fn === 'first' || m.fn === 'last') && (
              <Field label={t('steps.aggregate.sortBy')}>
                <NativeSelect value={m.sortBy} onChange={(v) => setMeasure(i, { sortBy: v })}>
                  <option value="">{t('steps.aggregate.readOrder')}</option>
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {m.fn === 'join' && (
              <Field label={t('steps.aggregate.separator')}>
                <Input value={m.separator} onChange={(e) => setMeasure(i, { separator: e.target.value })} className="w-24 font-mono" />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={Boolean(m.condition)} onChange={(e) => setMeasure(i, { condition: e.target.checked ? { match: 'all', conditions: [newCondition(columns[0]?.name ?? '')], groups: [] } : undefined })} />
              {t('steps.aggregate.onlyWhere')}
            </label>
            {m.condition && (
              <ConditionsEditor match={m.condition.match} conditions={m.condition.conditions} columns={columns} onChange={(match, conditions) => setMeasure(i, { condition: { match, conditions, groups: [] } })} label={t('steps.aggregate.countRowsMatching')} />
            )}
          </div>
        ))}
        <Button size="sm" variant="outline" disabled={step.measures.length >= 30} onClick={() => onChange({ ...step, measures: [...step.measures, { name: `measure_${step.measures.length + 1}`, fn: 'count', column: '', sortBy: '', separator: ', ' }] })}>
          <Plus aria-hidden /> {t('steps.aggregate.addMeasure')}
        </Button>
      </fieldset>
      <Notice tone="info">{t('steps.aggregate.fullRead')}</Notice>
    </div>
  )
}

// ── Deduplicate ──────────────────────────────────────────────────────────────

export function DedupeEditor({ step, columns, onChange }: { step: DedupeStep; columns: Column[]; onChange: (s: DedupeStep) => void }) {
  const t = useT()
  const dates = columns.filter((c) => c.type === 'date' || c.type === 'timestamp' || /date|time|_at$/i.test(c.name))
  const check = (key: keyof DedupeStep['normalize'], label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-primary" checked={step.normalize[key]} onChange={(e) => onChange({ ...step, normalize: { ...step.normalize, [key]: e.target.checked } })} />
      {label}
    </label>
  )
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{t('steps.dedupe.help')}</p>
      {columns.length ? (
        <ColumnChecklist columns={columns} value={step.keys} onChange={(keys) => onChange({ ...step, keys })} label={t('steps.dedupe.keys')} />
      ) : (
        <Field label={t('steps.dedupe.keys')}>
          <Input value={step.keys.join(', ')} onChange={(e) => onChange({ ...step, keys: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} className="font-mono" />
        </Field>
      )}
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-muted-foreground">{t('steps.join.normalize')}</legend>
        {check('trim', t('steps.join.trim'))}
        {check('ignoreCase', t('steps.join.ignoreCase'))}
        {check('leadingZeros', t('steps.join.leadingZeros'))}
      </fieldset>
      <Field label={t('steps.dedupe.keep')}>
        <NativeSelect value={step.keep} onChange={(v) => onChange({ ...step, keep: v as DedupeStep['keep'], recentBy: v === 'most_recent' && !step.recentBy ? (recencyColumn(columns) ?? dates[0])?.name ?? '' : step.recentBy })}>
          <option value="most_recent">{t('steps.dedupe.keepRecent')}</option>
          <option value="first">{t('steps.dedupe.keepFirst')}</option>
          <option value="last">{t('steps.dedupe.keepLast')}</option>
        </NativeSelect>
      </Field>
      {step.keep === 'most_recent' && (
        <Field label={t('steps.dedupe.recentBy')}>
          <ColumnPicker columns={dates.length ? dates : columns} value={step.recentBy} onChange={(v) => onChange({ ...step, recentBy: v })} label={null} />
        </Field>
      )}
      <p className="text-xs text-muted-foreground">{step.keep === 'first' ? t('steps.dedupe.streams') : t('steps.dedupe.blocking')}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={step.flagRemoved} onChange={(e) => onChange({ ...step, flagRemoved: e.target.checked })} />
        {t('steps.dedupe.flagRemoved')}
      </label>
    </div>
  )
}
