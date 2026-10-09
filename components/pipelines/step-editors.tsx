'use client'

import { Plus, Trash2, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  COLUMN_TYPES,
  FILTER_OPERATORS,
  TRANSFORMS,
  VALIDATION_RULES,
  type ColumnType,
  type DestinationStep,
  type FilterStep,
  type MapStep,
  type SourceStep,
  type TransformName,
  type ValidateStep,
} from '@/lib/pipelines/definition'
import type { getBuilderOptions } from '@/lib/actions/pipelines'

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

const human = (s: string) => s.replace(/_/g, ' ')

/** Maps scan SQL types (VARCHAR, INTEGER, TIMESTAMP WITH TIME ZONE …) to pipeline column types. */
export function columnTypeFromSql(sqlType: string): ColumnType {
  const t = sqlType.toUpperCase()
  if (/^(INT|INTEGER|BIGINT|SMALLINT|TINYINT|INT2|INT4|INT8|SERIAL|BIGSERIAL)\b/.test(t)) return 'integer'
  if (/(NUMERIC|DECIMAL|DOUBLE|REAL|FLOAT|NUMBER|MONEY)/.test(t)) return 'numeric'
  if (/^(BOOL|BOOLEAN|BIT)\b/.test(t)) return 'boolean'
  if (/TIMESTAMP|DATETIME/.test(t)) return 'timestamp'
  if (/^DATE\b/.test(t)) return 'date'
  if (/JSON/.test(t)) return 'json'
  return 'text'
}

// ── Source ───────────────────────────────────────────────────────────────────

export function SourceEditor({ step, options, onChange }: { step: SourceStep; options: BuilderOptions; onChange: (s: SourceStep) => void }) {
  const source = options.dataSources.find((d) => d.id === step.dataSourceId)
  const columns = source?.tables.find((t) => t.name === step.table)?.columns ?? []
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_1fr_140px]">
      <div>
        <FieldLabel>Data source</FieldLabel>
        <NativeSelect value={step.dataSourceId} onChange={(v) => onChange({ ...step, dataSourceId: v, table: '' })}>
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
          <NativeSelect value={step.table} onChange={(v) => onChange({ ...step, table: v })}>
            <option value="">Choose a table…</option>
            {source.tables.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} · {t.columns.length} cols
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Input value={step.table} onChange={(e) => onChange({ ...step, table: e.target.value })} placeholder="Table, entity set or endpoint name" />
        )}
      </div>
      <div>
        <FieldLabel>Max rows per run</FieldLabel>
        <Input type="number" min={1} max={1000000} value={step.maxRows} onChange={(e) => onChange({ ...step, maxRows: Math.max(1, Math.min(1000000, Number(e.target.value) || 1)) })} />
      </div>
      {source && source.tables.length === 0 && (
        <p className="text-xs text-muted-foreground md:col-span-3">
          No schema scan for this source yet. Open Data Sources and re-test the connection to load its tables, or type the name.
        </p>
      )}
      <div className="grid gap-3 md:col-span-3 md:grid-cols-[200px_1fr]">
        <div>
          <FieldLabel>Sync mode</FieldLabel>
          <NativeSelect value={step.mode} onChange={(v) => onChange({ ...step, mode: v as 'full' | 'incremental' })}>
            <option value="full">Full: read every row each run</option>
            <option value="incremental">Incremental: only new or changed rows</option>
          </NativeSelect>
        </div>
        {step.mode === 'incremental' && (
          <div>
            <FieldLabel>Watermark column (always increases, e.g. updated_at or id)</FieldLabel>
            {columns.length ? (
              <NativeSelect value={step.watermarkColumn} onChange={(v) => onChange({ ...step, watermarkColumn: v })}>
                <option value="">Choose a column…</option>
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input value={step.watermarkColumn} placeholder="updated_at" onChange={(e) => onChange({ ...step, watermarkColumn: e.target.value })} />
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Each run reads rows where this column is greater than the last value synced, oldest first.
              {source && !['postgres', 'mysql', 'supabase'].includes(source.sourceType) &&
                ' This connector filters after reading, so keep max rows above the number of new rows per run.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Filter ───────────────────────────────────────────────────────────────────

const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty'])

export function FilterEditor({ step, columns, onChange }: { step: FilterStep; columns: Column[]; onChange: (s: FilterStep) => void }) {
  const update = (i: number, patch: Partial<FilterStep['conditions'][number]>) =>
    onChange({ ...step, conditions: step.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        Keep rows matching
        <NativeSelect className="w-24" value={step.match} onChange={(v) => onChange({ ...step, match: v as 'all' | 'any' })}>
          <option value="all">all</option>
          <option value="any">any</option>
        </NativeSelect>
        of these conditions:
      </div>
      {step.conditions.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
          <ColumnPicker columns={columns} value={c.field} onChange={(v) => update(i, { field: v })} />
          <NativeSelect value={c.operator} onChange={(v) => update(i, { operator: v as FilterStep['conditions'][number]['operator'] })}>
            {FILTER_OPERATORS.map((op) => (
              <option key={op} value={op}>
                {human(op)}
              </option>
            ))}
          </NativeSelect>
          <Input
            value={c.value}
            disabled={NO_VALUE_OPS.has(c.operator)}
            placeholder={c.operator === 'in_list' ? 'a, b, c' : 'value'}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <Button size="sm" variant="ghost" disabled={step.conditions.length === 1} onClick={() => onChange({ ...step, conditions: step.conditions.filter((_, j) => j !== i) })} aria-label="Remove condition">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange({ ...step, conditions: [...step.conditions, { field: columns[0]?.name ?? '', operator: 'equals', value: '' }] })}>
        <Plus className="mr-1 h-4 w-4" /> Condition
      </Button>
    </div>
  )
}

function ColumnPicker({ columns, value, onChange }: { columns: Column[]; value: string; onChange: (v: string) => void }) {
  if (!columns.length) return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="column" />
  const known = columns.some((c) => c.name === value)
  return (
    <NativeSelect value={value} onChange={onChange}>
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
  default_if_empty: ['default'],
  prefix: ['prefix'],
  suffix: ['suffix'],
  substring: ['start', 'length'],
  format_date: ['output e.g. yyyy-MM-dd', 'input e.g. yyyyMMdd'],
  round: ['decimals'],
}

export function MapEditor({ step, columns, onChange }: { step: MapStep; columns: Column[]; onChange: (s: MapStep) => void }) {
  const update = (i: number, patch: Partial<MapStep['fields'][number]>) =>
    onChange({ ...step, fields: step.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const autoMap = () => {
    const existing = new Set(step.fields.map((f) => f.from))
    const added = columns
      .filter((c) => !existing.has(c.name))
      .map((c) => ({
        from: c.name,
        to: c.name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').toLowerCase(),
        type: columnTypeFromSql(c.type),
        transforms: [],
      }))
    onChange({ ...step, fields: [...step.fields.filter((f) => f.from), ...added] })
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={autoMap} disabled={!columns.length}>
          <Wand2 className="mr-1 h-4 w-4" /> Auto-map all columns
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={step.keepUnmapped} onChange={(e) => onChange({ ...step, keepUnmapped: e.target.checked })} />
          Pass through unmapped columns
        </label>
      </div>
      <div className="hidden grid-cols-[1fr_1fr_120px_auto] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
        <span>Source column</span>
        <span>Target column</span>
        <span>Type</span>
        <span />
      </div>
      {step.fields.map((f, i) => (
        <div key={i} className="rounded-md border border-border/70 p-2">
          <div className="grid grid-cols-[1fr_1fr_120px_auto] gap-2">
            <ColumnPicker columns={columns} value={f.from} onChange={(v) => update(i, { from: v, to: f.to || v.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
            <Input value={f.to} placeholder="target_name" onChange={(e) => update(i, { to: e.target.value })} />
            <NativeSelect value={f.type} onChange={(v) => update(i, { type: v as ColumnType })}>
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
            <Button size="sm" variant="ghost" disabled={step.fields.length === 1} onClick={() => onChange({ ...step, fields: step.fields.filter((_, j) => j !== i) })} aria-label="Remove field">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {f.transforms.map((t, ti) => (
              <div key={ti} className="flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1 text-xs">
                <span className="font-medium">{human(t.fn)}</span>
                {(TRANSFORM_ARGS[t.fn] ?? []).map((placeholder, ai) => (
                  <input
                    key={ai}
                    value={t.args[ai] ?? ''}
                    placeholder={placeholder}
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

const RULE_NEEDS_VALUE = new Set(['regex', 'min_length', 'max_length', 'min', 'max', 'one_of'])

export function ValidateEditor({ step, columns, onChange }: { step: ValidateStep; columns: Column[]; onChange: (s: ValidateStep) => void }) {
  const update = (i: number, patch: Partial<ValidateStep['rules'][number]>) =>
    onChange({ ...step, rules: step.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  return (
    <div className="space-y-2">
      {step.rules.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
          <ColumnPicker columns={columns} value={r.field} onChange={(v) => update(i, { field: v })} />
          <NativeSelect value={r.rule} onChange={(v) => update(i, { rule: v as ValidateStep['rules'][number]['rule'] })}>
            {VALIDATION_RULES.map((rule) => (
              <option key={rule} value={rule}>
                {human(rule)}
              </option>
            ))}
          </NativeSelect>
          <Input value={r.value} disabled={!RULE_NEEDS_VALUE.has(r.rule)} placeholder={r.rule === 'one_of' ? 'a, b, c' : 'value'} onChange={(e) => update(i, { value: e.target.value })} />
          <Button size="sm" variant="ghost" disabled={step.rules.length === 1} onClick={() => onChange({ ...step, rules: step.rules.filter((_, j) => j !== i) })} aria-label="Remove rule">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => onChange({ ...step, rules: [...step.rules, { field: columns[0]?.name ?? '', rule: 'required', value: '' }] })}>
          <Plus className="mr-1 h-4 w-4" /> Rule
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          When a row fails:
          <NativeSelect className="w-56" value={step.onFail} onChange={(v) => onChange({ ...step, onFail: v as 'reject' | 'abort' })}>
            <option value="reject">Skip it and record it (run continues)</option>
            <option value="abort">Stop the whole run</option>
          </NativeSelect>
        </label>
      </div>
    </div>
  )
}

// ── Destination ──────────────────────────────────────────────────────────────

const WRITABLE = new Set(['postgres', 'mysql', 'supabase'])

export function DestinationEditor({
  step,
  options,
  columns,
  onChange,
}: {
  step: DestinationStep
  options: BuilderOptions
  columns: Column[]
  onChange: (s: DestinationStep) => void
}) {
  const writable = options.dataSources.filter((d) => WRITABLE.has(d.sourceType))
  const target = step.kind === 'datasource' ? options.dataSources.find((d) => d.id === step.dataSourceId) : undefined
  const toggleKey = (k: string) => onChange({ ...step, keys: step.keys.includes(k) ? step.keys.filter((x) => x !== k) : [...step.keys, k] } as DestinationStep)

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant={step.kind === 'dataset' ? 'default' : 'outline'} onClick={() => onChange({ id: step.id, type: 'destination', kind: 'dataset', datasetName: '', mode: 'replace', keys: [] })}>
          Nexus dataset
        </Button>
        <Button size="sm" variant={step.kind === 'datasource' ? 'default' : 'outline'} onClick={() => onChange({ id: step.id, type: 'destination', kind: 'datasource', dataSourceId: '', table: '', mode: 'append', keys: [] })}>
          Write back to a database
        </Button>
      </div>

      {step.kind === 'dataset' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <FieldLabel>Dataset name</FieldLabel>
            <Input list="nexus-datasets" value={step.datasetName} placeholder="employee_master" onChange={(e) => onChange({ ...step, datasetName: e.target.value.toLowerCase() })} />
            <datalist id="nexus-datasets">
              {options.datasets.map((d) => (
                <option key={d.name} value={d.name} />
              ))}
            </datalist>
          </div>
          <div>
            <FieldLabel>Write mode</FieldLabel>
            <NativeSelect value={step.mode} onChange={(v) => onChange({ ...step, mode: v as 'append' | 'upsert' | 'replace' })}>
              <option value="replace">Replace (clear, then load)</option>
              <option value="upsert">Upsert (update by key)</option>
              <option value="append">Append</option>
            </NativeSelect>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <FieldLabel>Destination database</FieldLabel>
              <NativeSelect value={step.dataSourceId} onChange={(v) => onChange({ ...step, dataSourceId: v, table: '' })}>
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
                <NativeSelect value={step.table} onChange={(v) => onChange({ ...step, table: v })}>
                  <option value="">Choose a table…</option>
                  {target.tables.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input value={step.table} placeholder="table_name" onChange={(e) => onChange({ ...step, table: e.target.value })} />
              )}
            </div>
            <div>
              <FieldLabel>Write mode</FieldLabel>
              <NativeSelect value={step.mode} onChange={(v) => onChange({ ...step, mode: v as 'append' | 'upsert' })}>
                <option value="append">Insert (append)</option>
                <option value="upsert">Upsert (needs a unique key)</option>
              </NativeSelect>
            </div>
          </div>
          {!writable.length && <p className="text-xs text-muted-foreground">Add a PostgreSQL, MySQL or Supabase (with Database URL) data source to write back.</p>}
          {target && target.role !== 'destination' && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              &ldquo;{target.name}&rdquo; was added as a source, so runs will refuse to write to it. Add the database with Data Sources → Add Destination and choose that one here.
            </p>
          )}
        </div>
      )}

      {step.mode === 'upsert' && (
        <div>
          <FieldLabel>Key column(s) for upsert</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {columns.length ? (
              columns.map((c) => (
                <label key={c.name} className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs ${step.keys.includes(c.name) ? 'border-primary bg-primary/10' : 'border-border'}`}>
                  <input type="checkbox" checked={step.keys.includes(c.name)} onChange={() => toggleKey(c.name)} />
                  {c.name}
                </label>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">Configure the Source and Map steps first.</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
