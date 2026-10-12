'use client'

import { useState } from 'react'
import { Plus, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  COLUMN_TYPES,
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
  type MapStep,
  type RouterStep,
  type RulesStep,
  type SourceStep,
  type TransformName,
  type ValidateStep,
  type ValidationRuleSpec,
} from '@/lib/pipelines/definition'
import { autoMapName } from '@/lib/domain/model'
import { BUILTIN_MAPPING_TEMPLATES, applyMappingTemplate, autoMapFields, columnTypeFromSql, hrRulePack, newValidationRule, type MappingTemplate } from '@/lib/pipelines/templates'
import { saveMappingTemplate } from '@/lib/actions/templates'
import type { getBuilderOptions } from '@/lib/actions/pipelines'
import { AiMappingButton } from '@/components/ai/ai-mapping'

export type BuilderOptions = Awaited<ReturnType<typeof getBuilderOptions>>
export type Column = { name: string; type: string }

export const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

export function NativeSelect({
  value,
  onChange,
  children,
  className = '',
  ...rest
}: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'>) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${selectClass} ${className}`} {...rest}>
      {children}
    </select>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-xs font-medium text-muted-foreground">{children}</div>
}

export const human = (s: string) => s.replace(/_/g, ' ')

export const newCondition = (field = ''): Condition => ({ field, operator: 'equals', value: '', valueField: '' })
export { columnTypeFromSql, newValidationRule }

// ── Source ───────────────────────────────────────────────────────────────────

export function SourceEditor({ step, options, onChange }: { step: SourceStep; options: BuilderOptions; onChange: (s: SourceStep) => void }) {
  const source = options.dataSources.find((d) => d.id === step.dataSourceId)
  const columns = source?.tables.find((t) => t.name === step.table)?.columns ?? []
  return (
    <div className="grid gap-3">
      <div>
        <FieldLabel>Data source</FieldLabel>
        <NativeSelect value={step.dataSourceId} onChange={(v) => onChange({ ...step, dataSourceId: v, table: '' })} aria-label="Data source">
          <option value="">Choose a data source…</option>
          {options.dataSources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.sourceType})
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <FieldLabel>Table / object</FieldLabel>
        {source && source.tables.length > 0 ? (
          <NativeSelect value={step.table} onChange={(v) => onChange({ ...step, table: v })} aria-label="Table">
            <option value="">Choose a table…</option>
            {source.tables.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} · {t.columns.length} cols
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Input value={step.table} onChange={(e) => onChange({ ...step, table: e.target.value })} placeholder="Table, entity set or endpoint name" aria-label="Table" />
        )}
        {source && source.tables.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">No schema scan for this source yet. Re-test it in Data Sources to load its tables, or type the name.</p>
        )}
      </div>
      <div>
        <FieldLabel>Max rows per run</FieldLabel>
        <Input type="number" min={1} max={1000000} value={step.maxRows} onChange={(e) => onChange({ ...step, maxRows: Math.max(1, Math.min(1000000, Number(e.target.value) || 1)) })} aria-label="Max rows per run" />
      </div>
      <div>
        <FieldLabel>Sync mode</FieldLabel>
        <NativeSelect value={step.mode} onChange={(v) => onChange({ ...step, mode: v as 'full' | 'incremental' })} aria-label="Sync mode">
          <option value="full">Full: read every row each run</option>
          <option value="incremental">Incremental: only new or changed rows</option>
        </NativeSelect>
      </div>
      {step.mode === 'incremental' && (
        <div>
          <FieldLabel>Watermark column (always increases, e.g. updated_at or id)</FieldLabel>
          {columns.length ? (
            <NativeSelect value={step.watermarkColumn} onChange={(v) => onChange({ ...step, watermarkColumn: v })} aria-label="Watermark column">
              <option value="">Choose a column…</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.type})
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input value={step.watermarkColumn} placeholder="updated_at" onChange={(e) => onChange({ ...step, watermarkColumn: e.target.value })} aria-label="Watermark column" />
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Each run reads rows where this column is greater than the last value synced, oldest first.
            {source && !['postgres', 'mysql', 'supabase'].includes(source.sourceType) && ' This connector filters after reading, so keep max rows above the number of new rows per run.'}
          </p>
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
  label = 'Rows matching',
}: {
  match: 'all' | 'any'
  conditions: Condition[]
  columns: Column[]
  onChange: (match: 'all' | 'any', conditions: Condition[]) => void
  label?: string
}) {
  const update = (i: number, patch: Partial<Condition>) => onChange(match, conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {label}
        <NativeSelect className="w-20" value={match} onChange={(v) => onChange(v as 'all' | 'any', conditions)} aria-label="Match all or any">
          <option value="all">all</option>
          <option value="any">any</option>
        </NativeSelect>
        of:
      </div>
      {conditions.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 rounded-md border border-border/60 p-1.5">
          <ColumnPicker columns={columns} value={c.field} onChange={(v) => update(i, { field: v })} label="Field" />
          <NativeSelect value={c.operator} onChange={(v) => update(i, { operator: v as Condition['operator'] })} aria-label="Operator">
            {FILTER_OPERATORS.map((op) => (
              <option key={op} value={op}>
                {human(op)}
              </option>
            ))}
          </NativeSelect>
          <Button size="sm" variant="ghost" onClick={() => onChange(match, conditions.filter((_, j) => j !== i))} aria-label="Remove condition">
            <X className="h-4 w-4" />
          </Button>
          {!NO_VALUE_OPS.has(c.operator) && (
            <div className="col-span-3 grid grid-cols-[auto_1fr] items-center gap-1.5">
              <NativeSelect className="w-28" value={c.valueField ? 'field' : 'value'} onChange={(v) => update(i, { valueField: v === 'field' ? columns[0]?.name ?? '' : '' })} aria-label="Compare with">
                <option value="value">value</option>
                <option value="field">field</option>
              </NativeSelect>
              {c.valueField ? (
                <ColumnPicker columns={columns} value={c.valueField} onChange={(v) => update(i, { valueField: v })} label="Other field" />
              ) : (
                <Input value={c.value} placeholder={c.operator === 'in_list' ? 'a, b, c' : 'value'} onChange={(e) => update(i, { value: e.target.value })} aria-label="Value" />
              )}
            </div>
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange(match, [...conditions, newCondition(columns[0]?.name ?? '')])}>
        <Plus className="mr-1 h-4 w-4" /> Condition
      </Button>
    </div>
  )
}

function RulePicker({ rules, value, onChange, label = 'Business rule' }: { rules: BuilderOptions['rules']; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <NativeSelect value={value} onChange={onChange} aria-label={label}>
      <option value="">{rules.length ? 'Choose a rule…' : 'No business rules yet'}</option>
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
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Keep rows matching a business rule (optional)</FieldLabel>
        <RulePicker rules={options.rules} value={step.ruleId} onChange={(v) => onChange({ ...step, ruleId: v })} />
      </div>
      <ConditionsEditor
        label={step.ruleId ? 'and' : 'Keep rows matching'}
        match={step.match}
        conditions={step.conditions}
        columns={columns}
        onChange={(match, conditions) => onChange({ ...step, match, conditions })}
      />
    </div>
  )
}

export function ColumnPicker({ columns, value, onChange, label = 'Column' }: { columns: Column[]; value: string; onChange: (v: string) => void; label?: string }) {
  if (!columns.length) return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="column" aria-label={label} />
  const known = columns.some((c) => c.name === value)
  return (
    <NativeSelect value={value} onChange={onChange} aria-label={label}>
      <option value="">Column…</option>
      {!known && value && <option value={value}>{value} (not in schema)</option>}
      {columns.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </NativeSelect>
  )
}

// ── Map ──────────────────────────────────────────────────────────────────────

const TRANSFORM_ARGS: Partial<Record<TransformName, string[]>> = {
  replace: ['find', 'replace with'],
  regex_replace: ['pattern', 'replace with'],
  regex_extract: ['pattern', 'group (1)'],
  default_if_empty: ['default'],
  coalesce: ['column', 'column'],
  prefix: ['prefix'],
  suffix: ['suffix'],
  substring: ['start', 'length'],
  concat: ['{first_name} {last_name}'],
  split: ['separator', 'part (0, -1 = last)'],
  format_date: ['output e.g. yyyy-MM-dd', 'input e.g. yyyyMMdd', 'timezone e.g. Asia/Jakarta'],
  round: ['decimals'],
  number_format: ['decimals', 'locale (id-ID)'],
  hash: ['salt (optional)'],
  conditional: ['operator (equals)', 'value', 'then', 'else ({value} keeps it)'],
  lookup: ['dataset', 'key column', 'value column', 'if not found (empty = null, {value} keeps it)'],
}

export function MapEditor({ step, columns, options, source, onChange }: { step: MapStep; columns: Column[]; options?: BuilderOptions; source?: { dataSourceId: string; table: string }; onChange: (s: MapStep) => void }) {
  const update = (i: number, patch: Partial<MapStep['fields'][number]>) => onChange({ ...step, fields: step.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const [templateMsg, setTemplateMsg] = useState('')
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
    if (!fields.length) return setTemplateMsg(`None of the template's columns (${tpl.fields.map((f) => f.from).slice(0, 5).join(', ')}…) are in this step's input.`)
    onChange({ ...step, fields, keepUnmapped: tpl.keepUnmapped })
    setTemplateMsg(`Applied "${tpl.name}": ${fields.length} fields${missing.length ? `; not in the input: ${missing.join(', ')}` : ''}.`)
  }
  const saveTemplate = async () => {
    const name = window.prompt('Template name (e.g. "HRIS export → Employee")')
    if (!name) return
    try {
      const res = await saveMappingTemplate({ name, fields: step.fields.filter((f) => f.from && f.to), keepUnmapped: step.keepUnmapped })
      setTemplateMsg(`${res.replaced ? 'Updated' : 'Saved'} template "${name}". It appears in the templates list of every pipeline (after reopening the editor).`)
    } catch (err) {
      setTemplateMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={autoMap} disabled={!columns.length}>
          <Wand2 className="mr-1 h-4 w-4" /> Auto-map all columns
        </Button>
        <select value="" onChange={(e) => applyTemplate(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs" aria-label="Apply a mapping template">
          <option value="">Apply template…</option>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
              {tpl.builtIn ? '' : ' (saved)'}
            </option>
          ))}
        </select>
        <AiMappingButton
          columns={columns.filter((c) => !step.fields.some((f) => f.from === c.name))}
          mapped={step.fields.map((f) => f.to).filter(Boolean)}
          source={source}
          onAccept={(added) => onChange({ ...step, fields: [...step.fields.filter((f) => f.from), ...added.filter((a) => !step.fields.some((f) => f.to === a.to))] })}
        />
        <Button size="sm" variant="ghost" onClick={() => void saveTemplate()} disabled={!step.fields.some((f) => f.from && f.to)}>
          Save as template
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={step.keepUnmapped} onChange={(e) => onChange({ ...step, keepUnmapped: e.target.checked })} />
          Pass through unmapped columns
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Auto-map recognizes common HR column names (e.g. PERNR → employee_code, TGL_LAHIR → birth_date). Templates map SAP, Talenta and Active Directory fields; the lookup transform translates codes using a dataset.</p>
      {templateMsg && <p className="rounded-md bg-muted/50 p-2 text-xs">{templateMsg}</p>}
      {step.fields.map((f, i) => (
        <div key={i} className="rounded-md border border-border/70 p-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <ColumnPicker columns={columns} value={f.from} onChange={(v) => update(i, { from: v, to: f.to || autoMapName(v) })} label="Source column" />
            <Input value={f.to} placeholder="target_name" onChange={(e) => update(i, { to: e.target.value })} aria-label="Target column" />
            <Button size="sm" variant="ghost" disabled={step.fields.length === 1} onClick={() => onChange({ ...step, fields: step.fields.filter((_, j) => j !== i) })} aria-label="Remove field">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <NativeSelect className="h-7 w-28 text-xs" value={f.type} onChange={(v) => update(i, { type: v as ColumnType })} aria-label="Type">
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
            {f.transforms.map((t, ti) => (
              <div key={ti} className="flex flex-wrap items-center gap-1 rounded-md bg-muted/50 px-2 py-1 text-xs">
                <span className="font-medium">{human(t.fn)}</span>
                {(TRANSFORM_ARGS[t.fn] ?? []).map((placeholder, ai) => (
                  <input
                    key={ai}
                    value={t.args[ai] ?? ''}
                    placeholder={placeholder}
                    aria-label={`${human(t.fn)} ${placeholder}`}
                    onChange={(e) => {
                      const args = [...t.args]
                      args[ai] = e.target.value
                      update(i, { transforms: f.transforms.map((x, xi) => (xi === ti ? { ...x, args } : x)) })
                    }}
                    className="h-6 w-28 rounded border border-input bg-background px-1"
                  />
                ))}
                <button className="text-muted-foreground hover:text-foreground" onClick={() => update(i, { transforms: f.transforms.filter((_, xi) => xi !== ti) })} aria-label="Remove transform">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <select
              value=""
              aria-label="Add transform"
              onChange={(e) => e.target.value && update(i, { transforms: [...f.transforms, { fn: e.target.value as TransformName, args: [] }] })}
              className="h-7 rounded-md border border-dashed border-input bg-background px-1 text-xs text-muted-foreground"
            >
              <option value="">+ transform</option>
              {TRANSFORMS.map((t) => (
                <option key={t} value={t}>
                  {human(t)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange({ ...step, fields: [...step.fields, { from: '', to: '', type: 'text', transforms: [] }] })}>
        <Plus className="mr-1 h-4 w-4" /> Field
      </Button>
    </div>
  )
}

// ── Validate ─────────────────────────────────────────────────────────────────

const RULE_LABEL: Record<ValidationRuleSpec['rule'], string> = {
  required: 'required',
  email: 'valid email',
  phone: 'valid phone',
  nik: 'valid NIK',
  npwp: 'valid NPWP',
  unique: 'unique',
  regex: 'matches regex',
  min_length: 'min length',
  max_length: 'max length',
  min: 'min value',
  max: 'max value',
  one_of: 'one of',
  date: 'valid date',
  not_future: 'not in the future',
  compare: 'compared with field',
  exists_in: 'exists in dataset',
  condition: 'business rule holds',
  manager: 'valid manager (no cycles)',
}
const VALUE_RULES = new Set(['regex', 'min_length', 'max_length', 'min', 'max', 'one_of'])

export function ValidateEditor({ step, columns, options, onChange }: { step: ValidateStep; columns: Column[]; options: BuilderOptions; onChange: (s: ValidateStep) => void }) {
  const update = (i: number, patch: Partial<ValidationRuleSpec>) => onChange({ ...step, rules: step.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const lookups = options.datasets.flatMap((d) => d.columns.map((c) => `${d.name}.${c.name}`))
  const addPack = () => {
    const { rules, notes } = hrRulePack(columns, options.datasets)
    if (!rules.length) return window.alert(notes.join('\n') || 'No HR columns recognized in this step\'s input.')
    const existing = step.rules.filter((r) => r.field)
    onChange({ ...step, rules: [...existing, ...rules] })
    if (notes.length) window.alert(`HR rule pack added ${rules.length} rules.\n\n${notes.join('\n')}`)
  }
  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={addPack} disabled={!columns.length}>
        <Sparkles className="mr-1 h-4 w-4" /> Add HR rule pack
      </Button>
      {step.rules.map((r, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border/60 p-1.5">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <ColumnPicker columns={columns} value={r.field} onChange={(v) => update(i, { field: v })} label="Field" />
            <NativeSelect value={r.rule} onChange={(v) => update(i, { rule: v as ValidationRuleSpec['rule'], value: '' })} aria-label="Rule">
              {VALIDATION_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {RULE_LABEL[rule]}
                </option>
              ))}
            </NativeSelect>
            <Button size="sm" variant="ghost" disabled={step.rules.length === 1} onClick={() => onChange({ ...step, rules: step.rules.filter((_, j) => j !== i) })} aria-label="Remove rule">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-1.5">
            {VALUE_RULES.has(r.rule) ? (
              <Input value={r.value} placeholder={r.rule === 'one_of' ? 'a, b, c' : 'value'} onChange={(e) => update(i, { value: e.target.value })} aria-label="Rule value" />
            ) : r.rule === 'exists_in' ? (
              <NativeSelect value={r.value} onChange={(v) => update(i, { value: v })} aria-label="Lookup dataset column">
                <option value="">{lookups.length ? 'dataset.column…' : 'No datasets yet'}</option>
                {lookups.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            ) : r.rule === 'compare' ? (
              <div className="grid grid-cols-2 gap-1.5">
                <NativeSelect value={r.operator} onChange={(v) => update(i, { operator: v as ValidationRuleSpec['operator'] })} aria-label="Comparison">
                  {(['greater_or_equal', 'greater_than', 'less_or_equal', 'less_than', 'equals', 'not_equals'] as const).map((op) => (
                    <option key={op} value={op}>
                      {human(op)}
                    </option>
                  ))}
                </NativeSelect>
                <ColumnPicker columns={columns} value={r.otherField} onChange={(v) => update(i, { otherField: v })} label="Other field" />
              </div>
            ) : r.rule === 'condition' ? (
              <RulePicker rules={options.rules} value={r.ruleId} onChange={(v) => update(i, { ruleId: v })} />
            ) : r.rule === 'manager' ? (
              <ColumnPicker columns={columns} value={r.value} onChange={(v) => update(i, { value: v })} label="Employee key column" />
            ) : r.rule === 'date' ? (
              <Input value={r.value} placeholder="input format (optional), e.g. dd/MM/yyyy" onChange={(e) => update(i, { value: e.target.value })} aria-label="Date input format" />
            ) : (
              <span />
            )}
            <NativeSelect value={r.severity} onChange={(v) => update(i, { severity: v as ValidationRuleSpec['severity'] })} aria-label="Severity">
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onChange({ ...step, rules: [...step.rules, newValidationRule(columns[0]?.name ?? '')] })}>
          <Plus className="mr-1 h-4 w-4" /> Rule
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          On an error:
          <NativeSelect className="w-48" value={step.onFail} onChange={(v) => onChange({ ...step, onFail: v as 'reject' | 'abort' })} aria-label="On an error">
            <option value="reject">Quarantine the row</option>
            <option value="abort">Stop the whole run</option>
          </NativeSelect>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Error: the row goes to the quarantine, not the destination. Warning / info: the row is written and flagged in Data Quality.</p>
    </div>
  )
}

// ── Business rules node ──────────────────────────────────────────────────────

export function RulesEditor({ step, options, onChange }: { step: RulesStep; options: BuilderOptions; onChange: (s: RulesStep) => void }) {
  const toggle = (id: string) => onChange({ ...step, ruleIds: step.ruleIds.includes(id) ? step.ruleIds.filter((x) => x !== id) : [...step.ruleIds, id] })
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Applies these rules to every row, in order: keep or drop rows, set or calculate fields, route, notify, hold for approval or trigger pipelines. Manage rules in the Business Rules tab.</p>
      {options.rules.length === 0 && <p className="text-sm text-muted-foreground">No business rules yet.</p>}
      {options.rules.map((r) => (
        <label key={r.id} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${step.ruleIds.includes(r.id) ? 'border-primary bg-primary/5' : 'border-border'}`}>
          <input type="checkbox" className="mt-0.5" checked={step.ruleIds.includes(r.id)} onChange={() => toggle(r.id)} />
          <span>
            <span className="font-medium">{r.name}</span>
            {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
          </span>
        </label>
      ))}
      {step.ruleIds.length > 1 && (
        <p className="text-xs text-muted-foreground">Order: {step.ruleIds.map((id) => options.rules.find((r) => r.id === id)?.name ?? id).join(' → ')}</p>
      )}
    </div>
  )
}

// ── Router ───────────────────────────────────────────────────────────────────

export function RouterEditor({ step, columns, options, onChange }: { step: RouterStep; columns: Column[]; options: BuilderOptions; onChange: (s: RouterStep) => void }) {
  const update = (i: number, patch: Partial<RouterStep['branches'][number]>) => onChange({ ...step, branches: step.branches.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Each row goes down the first branch that matches; rows a business rule routed by name go to that branch first. Connect each branch&apos;s handle on the canvas.</p>
      {step.branches.map((b, i) => (
        <div key={b.id} className="space-y-2 rounded-md border border-border p-2">
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <Input value={b.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Branch name" aria-label="Branch name" />
            <Button size="sm" variant="ghost" disabled={step.branches.length === 1} onClick={() => onChange({ ...step, branches: step.branches.filter((_, j) => j !== i) })} aria-label="Remove branch">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <NativeSelect value={b.ruleId ? 'rule' : 'conditions'} onChange={(v) => update(i, v === 'rule' ? { ruleId: options.rules[0]?.id ?? '', condition: undefined } : { ruleId: '', condition: { match: 'all', conditions: [newCondition(columns[0]?.name ?? '')], groups: [] } })} aria-label="Branch matches by">
            <option value="conditions">Matches conditions</option>
            <option value="rule">Matches a business rule</option>
          </NativeSelect>
          {b.ruleId || (!b.condition && options.rules.length) ? (
            <RulePicker rules={options.rules} value={b.ruleId} onChange={(v) => update(i, { ruleId: v })} />
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
      <Button size="sm" variant="outline" onClick={() => onChange({ ...step, branches: [...step.branches, { id: newStepId(), label: `Branch ${step.branches.length + 1}`, ruleId: '', condition: { match: 'all', conditions: [newCondition(columns[0]?.name ?? '')], groups: [] } }] })}>
        <Plus className="mr-1 h-4 w-4" /> Branch
      </Button>
      <p className="text-xs text-muted-foreground">Rows matching no branch go to <span className="font-medium">{OTHERWISE}</span>; leave it unconnected to drop them.</p>
    </div>
  )
}

// ── Destination ──────────────────────────────────────────────────────────────

const WRITABLE = new Set(['postgres', 'mysql', 'supabase', 'kmplus'])

export function DestinationEditor({ step, options, columns, onChange }: { step: DestinationStep; options: BuilderOptions; columns: Column[]; onChange: (s: DestinationStep) => void }) {
  const writable = options.dataSources.filter((d) => WRITABLE.has(d.sourceType))
  const target = step.kind === 'datasource' ? options.dataSources.find((d) => d.id === step.dataSourceId) : undefined
  const targetColumns = target?.tables.find((t) => t.name === (step.kind === 'datasource' ? step.table : ''))?.columns ?? []
  const toggleKey = (k: string) => onChange({ ...step, keys: step.keys.includes(k) ? step.keys.filter((x) => x !== k) : [...step.keys, k] } as DestinationStep)
  const base = { id: step.id, type: 'destination' as const, position: step.position, keys: [], softDeleteMissing: false }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={step.kind === 'dataset' ? 'default' : 'outline'} onClick={() => onChange({ ...base, kind: 'dataset', datasetName: '', mode: 'replace' })}>
          Nexus dataset
        </Button>
        <Button size="sm" variant={step.kind === 'datasource' ? 'default' : 'outline'} onClick={() => onChange({ ...base, kind: 'datasource', dataSourceId: '', table: '', mode: 'append', softDeleteColumn: '' })}>
          Write back to a database
        </Button>
      </div>

      {step.kind === 'dataset' ? (
        <div className="grid gap-3">
          <div>
            <FieldLabel>Dataset name</FieldLabel>
            <Input list="nexus-datasets" value={step.datasetName} placeholder="employee_master" onChange={(e) => onChange({ ...step, datasetName: e.target.value.toLowerCase() })} aria-label="Dataset name" />
            <datalist id="nexus-datasets">
              {options.datasets.map((d) => (
                <option key={d.name} value={d.name} />
              ))}
            </datalist>
          </div>
          <div>
            <FieldLabel>Write mode</FieldLabel>
            <NativeSelect value={step.mode} onChange={(v) => onChange({ ...step, mode: v as 'append' | 'upsert' | 'replace', softDeleteMissing: v === 'upsert' ? step.softDeleteMissing : false })} aria-label="Write mode">
              <option value="replace">Replace (load a fresh copy)</option>
              <option value="upsert">Upsert (update by key)</option>
              <option value="append">Append</option>
            </NativeSelect>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <div>
            <FieldLabel>Destination database</FieldLabel>
            <NativeSelect value={step.dataSourceId} onChange={(v) => onChange({ ...step, dataSourceId: v, table: '' })} aria-label="Destination database">
              <option value="">Choose…</option>
              {writable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.sourceType}){d.role !== 'destination' ? ' · not a destination' : ''}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <FieldLabel>Table (must already exist)</FieldLabel>
            {target && target.tables.length ? (
              <NativeSelect value={step.table} onChange={(v) => onChange({ ...step, table: v })} aria-label="Destination table">
                <option value="">Choose a table…</option>
                {target.tables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input value={step.table} placeholder="table_name" onChange={(e) => onChange({ ...step, table: e.target.value })} aria-label="Destination table" />
            )}
          </div>
          <div>
            <FieldLabel>Write mode</FieldLabel>
            <NativeSelect value={step.mode} onChange={(v) => onChange({ ...step, mode: v as 'append' | 'upsert', softDeleteMissing: v === 'upsert' ? step.softDeleteMissing : false })} aria-label="Write mode">
              <option value="append">Insert (append)</option>
              <option value="upsert">Upsert (needs a unique key)</option>
            </NativeSelect>
          </div>
          {!writable.length && <p className="text-xs text-muted-foreground">Add a PostgreSQL, MySQL or Supabase (with Database URL) data source to write back.</p>}
          {target && target.role !== 'destination' && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              &ldquo;{target.name}&rdquo; was added as a source, so runs will refuse to write to it. Add the database with Data Sources → Add Destination.
            </p>
          )}
        </div>
      )}

      {(step.mode === 'upsert' || step.mode === 'replace') && (
        <div>
          <FieldLabel>{step.mode === 'replace' ? 'Key column(s), optional' : 'Key column(s)'}</FieldLabel>
          {step.mode === 'replace' && (
            <p className="mb-2 text-xs text-muted-foreground">Used when fixed rows are replayed from Data Quality: a replayed row replaces the row with the same key instead of adding a copy.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {columns.length ? (
              columns.map((c) => (
                <label key={c.name} className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs ${step.keys.includes(c.name) ? 'border-primary bg-primary/10' : 'border-border'}`}>
                  <input type="checkbox" checked={step.keys.includes(c.name)} onChange={() => toggleKey(c.name)} />
                  {c.name}
                </label>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">Configure the steps before this one first.</span>
            )}
          </div>
          {step.mode === 'upsert' && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={step.softDeleteMissing} onChange={(e) => onChange({ ...step, softDeleteMissing: e.target.checked } as DestinationStep)} />
            <span>
              Mark rows missing from the source as deleted
              <span className="block text-xs text-muted-foreground">After each full run, rows this run didn&apos;t write are flagged deleted (not removed). Needs a full read, not incremental.</span>
            </span>
          </label>
          )}
          {step.mode === 'upsert' && step.kind === 'datasource' && step.softDeleteMissing && (
            <div className="mt-2">
              <FieldLabel>Column marking deleted rows (boolean or timestamp)</FieldLabel>
              <ColumnPicker columns={targetColumns} value={step.softDeleteColumn} onChange={(v) => onChange({ ...step, softDeleteColumn: v })} label="Deleted marker column" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
