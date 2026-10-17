import { z } from 'zod'
import { COLUMN_TYPES, type ColumnType, type DestinationStep, type PipelineDefinition, type SchemaBinding } from '@/lib/pipelines/definition'
import { coerce, type Row } from '@/lib/pipelines/transforms'
import { evalExpr } from '@/lib/pipelines/conditions'
import { checkText } from '@/lib/pipelines/check-messages'
import { suggestColumnPolicy } from '@/lib/governance/definition'
import { autoMapName, type DomainEntity } from '@/lib/domain/model'
import { inferColumns } from '@/lib/pipelines/columns'

/**
 * Defined dataset schemas (lanes design §3, phase D). Pure and client-safe;
 * covered by scripts/engine-tests.ts. A defined dataset owns its columns:
 * pipelines map into it (target-first), each writing only the columns it
 * maps, matched on the schema's keys. Changes are operations
 * (`applySchemaOps`), each one a version; a rename is carried into pipeline
 * mappings, dashboards and governance policies (`rename*`).
 */

export const SCHEMA_CLASSIFICATIONS = ['public', 'internal', 'personal', 'sensitive'] as const
export type SchemaClassification = (typeof SCHEMA_CLASSIFICATIONS)[number]
const identifier = z.string().trim().min(1, 'Name every column').max(63).regex(/^[a-z_][a-z0-9_]*$/, 'Use lowercase letters, numbers and underscores; start with a letter').refine((n) => !n.startsWith('_nexus_'), 'Names starting with _nexus_ are reserved')

export const schemaColumnSchema = z.object({
  name: identifier,
  type: z.enum(COLUMN_TYPES).default('text'),
  required: z.boolean().default(false),
  description: z.string().trim().max(500).default(''),
  /** Feeds Governance masking directly. */
  classification: z.enum(SCHEMA_CLASSIFICATIONS).default('internal'),
  /** Written when a mapped value is empty (as text, converted to the type). */
  default: z.string().max(500).nullable().default(null),
  /** Added because a pipeline sent it ("Add new columns automatically"); not in the Data API until reviewed. */
  autoAdded: z.boolean().default(false),
  reviewed: z.boolean().default(true),
})
export type SchemaColumn = z.infer<typeof schemaColumnSchema>

export const datasetSchemaSpec = z
  .object({
    columns: z.array(schemaColumnSchema).min(1, 'Add at least one column').max(300),
    keys: z.array(z.string()).max(10).default([]),
    autoAdd: z.boolean().default(false),
  })
  .superRefine((s, ctx) => {
    const names = new Set<string>()
    for (const c of s.columns) {
      if (names.has(c.name)) ctx.addIssue({ code: 'custom', message: `The column "${c.name}" appears twice.` })
      names.add(c.name)
    }
    for (const k of s.keys) if (!names.has(k)) ctx.addIssue({ code: 'custom', message: `The key column "${k}" is not in the schema.` })
  })
export type DatasetSchema = z.infer<typeof datasetSchemaSpec>

const classificationOf = (name: string): SchemaClassification => {
  const c = suggestColumnPolicy(name).classification
  return c === 'public' ? 'internal' : (c as SchemaClassification)
}
const column = (name: string, type: ColumnType, extra: Partial<SchemaColumn> = {}): SchemaColumn => schemaColumnSchema.parse({ name, type, classification: classificationOf(name), ...extra })

/** Current column names a schema can't hold as they are, and the names it gives them. */
export function unsafeNames(columns: { name: string }[]): { from: string; to: string }[] {
  return columns.filter((c) => !c.name.startsWith('_nexus_') && safeName(c.name) && safeName(c.name) !== c.name).map((c) => ({ from: c.name, to: safeName(c.name) }))
}

/** "Define from current columns": the dataset's columns as they are (nothing reloaded; unsafe names renamed, see `unsafeNames`). */
export function schemaFromColumns(columns: { name: string; type: string }[], keys: string[] = []): DatasetSchema {
  const safeKeys = keys.map(safeName)
  const cols = columns.filter((c) => !c.name.startsWith('_nexus_') && safeName(c.name)).map((c) => column(safeName(c.name), (COLUMN_TYPES as readonly string[]).includes(c.type) ? (c.type as ColumnType) : 'text', { required: safeKeys.includes(safeName(c.name)) }))
  return { columns: cols, keys: safeKeys.filter((k) => cols.some((c) => c.name === k)), autoAdd: false }
}

/** From a Unified Data Model entity: its fields, the natural key required. */
export function schemaFromEntity(entity: DomainEntity): DatasetSchema {
  return {
    columns: entity.fields.map((f) => column(f.name, f.type, { required: f.name === entity.key, description: f.label, classification: f.pii ? 'personal' : classificationOf(f.name) })),
    keys: [entity.key],
    autoAdd: false,
  }
}

/** From a pasted example: a JSON object (or the first item of a list), else a CSV / tab-separated header line. */
export function schemaFromExample(text: string): DatasetSchema {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    const parsed = JSON.parse(t) as unknown
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as Row | undefined
    if (!first || typeof first !== 'object') throw new Error('The example has no fields.')
    return { columns: inferColumns([first]).map((c) => column(safeName(c.name), c.type)), keys: [], autoAdd: false }
  }
  const header = t.split(/\r?\n/)[0] ?? ''
  const sep = header.includes('\t') ? '\t' : header.includes(';') ? ';' : ','
  const names = header.split(sep).map((h) => safeName(h.trim().replace(/^"|"$/g, ''))).filter(Boolean)
  if (!names.length) throw new Error('The example has no fields.')
  return { columns: [...new Set(names)].map((n) => column(n, 'text')), keys: [], autoAdd: false }
}

/** A column name as a schema allows it: lowercase, letters, numbers and underscores. */
export function safeName(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 63)
  return /^[a-z_]/.test(s) ? s : s ? `c_${s}`.slice(0, 63) : ''
}

// ── Changes ──────────────────────────────────────────────────────────────────

export const schemaOpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), column: schemaColumnSchema }),
  z.object({ kind: z.literal('remove'), name: z.string().min(1) }),
  z.object({ kind: z.literal('rename'), from: z.string().min(1), to: identifier }),
  z.object({ kind: z.literal('type'), name: z.string().min(1), type: z.enum(COLUMN_TYPES) }),
  z.object({ kind: z.literal('require'), name: z.string().min(1), required: z.boolean() }),
  z.object({ kind: z.literal('describe'), name: z.string().min(1), description: z.string().trim().max(500).optional(), classification: z.enum(SCHEMA_CLASSIFICATIONS).optional(), default: z.string().max(500).nullable().optional() }),
  z.object({ kind: z.literal('keys'), keys: z.array(z.string()).max(10) }),
  z.object({ kind: z.literal('autoAdd'), on: z.boolean() }),
  z.object({ kind: z.literal('review'), name: z.string().min(1) }),
])
export type SchemaOp = z.infer<typeof schemaOpSchema>

/** Rename, type change and removal can break readers: confirmed with their impact, and destructive for approvals. */
export const isDestructiveOp = (op: SchemaOp) => op.kind === 'rename' || op.kind === 'type' || op.kind === 'remove'

/** A schema with the operations applied, or the first problem. */
export function applySchemaOps(schema: DatasetSchema, ops: SchemaOp[]): { schema: DatasetSchema } | { error: string } {
  let cols = schema.columns.map((c) => ({ ...c }))
  let keys = [...schema.keys]
  let autoAdd = schema.autoAdd
  const find = (name: string) => cols.find((c) => c.name === name)
  for (const op of ops) {
    switch (op.kind) {
      case 'add':
        if (find(op.column.name)) return { error: `The column "${op.column.name}" already exists.` }
        cols.push({ ...op.column })
        break
      case 'remove':
        if (!find(op.name)) return { error: `The schema has no column "${op.name}".` }
        if (keys.includes(op.name)) return { error: `"${op.name}" is a key column. Change the keys first.` }
        cols = cols.filter((c) => c.name !== op.name)
        break
      case 'rename': {
        const c = find(op.from)
        if (!c) return { error: `The schema has no column "${op.from}".` }
        if (find(op.to)) return { error: `The column "${op.to}" already exists.` }
        c.name = op.to
        keys = keys.map((k) => (k === op.from ? op.to : k))
        break
      }
      case 'type': {
        const c = find(op.name)
        if (!c) return { error: `The schema has no column "${op.name}".` }
        c.type = op.type
        break
      }
      case 'require': {
        const c = find(op.name)
        if (!c) return { error: `The schema has no column "${op.name}".` }
        c.required = op.required
        break
      }
      case 'describe': {
        const c = find(op.name)
        if (!c) return { error: `The schema has no column "${op.name}".` }
        if (op.description !== undefined) c.description = op.description
        if (op.classification !== undefined) c.classification = op.classification
        if (op.default !== undefined) c.default = op.default
        break
      }
      case 'keys':
        for (const k of op.keys) if (!find(k)) return { error: `The key column "${k}" is not in the schema.` }
        keys = op.keys
        for (const c of cols) if (keys.includes(c.name)) c.required = true
        break
      case 'autoAdd':
        autoAdd = op.on
        break
      case 'review': {
        const c = find(op.name)
        if (!c) return { error: `The schema has no column "${op.name}".` }
        c.reviewed = true
        break
      }
    }
  }
  const parsed = datasetSchemaSpec.safeParse({ columns: cols, keys, autoAdd })
  return parsed.success ? { schema: parsed.data } : { error: parsed.error.issues[0]?.message ?? 'Invalid schema.' }
}

/** One line per operation, for the version history and the audit log. */
export function describeOp(op: SchemaOp): string {
  switch (op.kind) {
    case 'add':
      return `Added ${op.column.name} (${op.column.type}${op.column.required ? ', required' : ''}${op.column.autoAdded ? ', added automatically' : ''})`
    case 'remove':
      return `Removed ${op.name}`
    case 'rename':
      return `Renamed ${op.from} to ${op.to}`
    case 'type':
      return `Changed ${op.name} to ${op.type}`
    case 'require':
      return `${op.name} is ${op.required ? 'required' : 'optional'}`
    case 'describe':
      return `Described ${op.name}`
    case 'keys':
      return `Keys: ${op.keys.join(', ') || 'none'}`
    case 'autoAdd':
      return op.on ? 'New columns are added automatically' : 'New columns are no longer added automatically'
    case 'review':
      return `Reviewed ${op.name}`
  }
}

/** Columns the Data API exposes: all but automatically added ones nobody has reviewed. */
export const exposedColumns = (schema: DatasetSchema) => schema.columns.filter((c) => !(c.autoAdded && !c.reviewed))

/** Whether values of one type can become another at all (text can try anything; the run checks each value). */
export function canConvert(from: string, to: ColumnType): boolean {
  if (from === to || from === 'text' || to === 'text') return true
  const ok: Record<string, ColumnType[]> = {
    integer: ['numeric', 'boolean', 'json'],
    numeric: ['integer', 'json'],
    boolean: ['integer', 'json'],
    date: ['timestamp'],
    timestamp: ['date'],
    json: [],
  }
  return (ok[from] ?? []).includes(to)
}

/** Schema columns against another schema (promotion previews): what would change, and whether it is only additive. */
export function schemaDiff(from: DatasetSchema, to: DatasetSchema | null): { lines: string[]; additive: boolean } {
  if (!to) return { lines: [`New schema with ${from.columns.length} columns`], additive: true }
  const lines: string[] = []
  let additive = true
  const target = new Map(to.columns.map((c) => [c.name, c]))
  for (const c of from.columns) {
    const t = target.get(c.name)
    if (!t) lines.push(`Adds ${c.name} (${c.type})`)
    else {
      if (t.type !== c.type) (lines.push(`${c.name}: ${t.type} → ${c.type}`), (additive = false))
      if (t.required !== c.required) lines.push(`${c.name}: ${c.required ? 'required' : 'optional'}`)
      if (t.classification !== c.classification || t.description !== c.description || t.default !== c.default) lines.push(`${c.name}: description or classification`)
    }
  }
  for (const t of to.columns) if (!from.columns.some((c) => c.name === t.name)) (lines.push(`Removes ${t.name}`), (additive = false))
  if (from.keys.join() !== to.keys.join()) (lines.push(`Keys: ${from.keys.join(', ') || 'none'}`), (additive = false))
  if (from.autoAdd !== to.autoAdd) lines.push(from.autoAdd ? 'Adds new columns automatically' : 'Stops adding new columns automatically')
  return { lines, additive }
}

// ── Pipelines → defined datasets ─────────────────────────────────────────────

export type ColumnMapEntry = { target: string; binding: SchemaBinding }

/** Auto-match: each schema column gets the input column with the same name, else a known synonym (Unified Data Model). */
export function autoMapSchema(schema: DatasetSchema, inputColumns: string[]): ColumnMapEntry[] {
  const used = new Set<string>()
  const out: ColumnMapEntry[] = []
  for (const c of schema.columns) {
    const exact = inputColumns.find((i) => i === c.name) ?? inputColumns.find((i) => i.toLowerCase() === c.name)
    const synonym = exact ?? inputColumns.find((i) => !used.has(i) && autoMapName(i) === c.name)
    if (synonym) {
      used.add(synonym)
      out.push({ target: c.name, binding: { kind: 'column', column: synonym } })
    }
  }
  return out
}

/** The columns a destination writes and what each takes: its mapping, else input columns matched by name. */
export function resolveMapping(schema: DatasetSchema, dest: Pick<Extract<DestinationStep, { kind: 'dataset' }>, 'columnMap'>, inputColumns: string[]): { map: ColumnMapEntry[]; byName: boolean } {
  const columnMap = dest.columnMap ?? []
  const explicit = columnMap.filter((m) => m.binding.kind !== 'none' && schema.columns.some((c) => c.name === m.target))
  if (columnMap.length) return { map: explicit, byName: false }
  // By name: the same name, or the name a schema gives it ("NIK" → nik).
  const map: ColumnMapEntry[] = []
  for (const c of schema.columns) {
    const input = inputColumns.find((i) => i === c.name) ?? inputColumns.find((i) => safeName(i) === c.name)
    if (input) map.push({ target: c.name, binding: { kind: 'column', column: input } })
  }
  return { map, byName: true }
}

/**
 * Editor checks for a destination writing a defined dataset: required columns
 * without a source, conversions that can never work, and input columns that
 * won't be written (extra columns).
 */
export function mappingIssues(schema: DatasetSchema, dest: Pick<Extract<DestinationStep, { kind: 'dataset' }>, 'columnMap'>, input: { name: string; type: string }[]) {
  const { map, byName } = resolveMapping(schema, dest, input.map((c) => c.name))
  const mapped = new Set(map.map((m) => m.target))
  const used = new Set(map.flatMap((m) => (m.binding.kind === 'column' ? [m.binding.column] : [])))
  const unmappedRequired = schema.columns.filter((c) => c.required && !mapped.has(c.name)).map((c) => c.name)
  const impossible = map.flatMap((m) => {
    const target = schema.columns.find((c) => c.name === m.target)!
    const from = m.binding.kind === 'column' ? input.find((c) => c.name === (m.binding as { column: string }).column)?.type : undefined
    return from && !canConvert(from, target.type) ? [{ target: m.target, from, to: target.type }] : []
  })
  const extras = input.map((c) => c.name).filter((n) => !n.startsWith('_') && !used.has(n) && (byName || !schema.columns.some((c) => c.name === n)))
  return { unmappedRequired, impossible, extras, byName, mapped: [...mapped] }
}

/**
 * Rows as the schema takes them: each mapped column's value (binding, then
 * the column's default when empty), converted to its type. A row missing a
 * required value it maps, or a value that doesn't convert, is held (replayable
 * from the Destination step). Only mapped columns are written: other columns of
 * a row already there are left alone (column ownership, partial upserts).
 */
export function conformRows(schema: DatasetSchema, map: ColumnMapEntry[], rows: Row[]): { rows: Row[]; rejects: { index: number; row: Row; errors: string[] }[] } {
  const cols = map.map((m) => ({ m, col: schema.columns.find((c) => c.name === m.target)! })).filter((x) => x.col)
  const out: Row[] = []
  const rejects: { index: number; row: Row; errors: string[] }[] = []
  rows.forEach((row, index) => {
    const conformed: Row = {}
    const errors: string[] = []
    for (const { m, col } of cols) {
      let v: unknown
      try {
        v = m.binding.kind === 'column' ? row[m.binding.column] : m.binding.kind === 'constant' ? m.binding.value : m.binding.kind === 'expr' ? evalExpr(row, m.binding.expr) : null
      } catch (err) {
        errors.push(`${col.name}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      if ((v === null || v === undefined || v === '') && col.default !== null) v = col.default
      if (v === null || v === undefined || v === '') {
        if (col.required) errors.push(checkText('schemaRequired', { column: col.name }))
        conformed[col.name] = null
        continue
      }
      try {
        conformed[col.name] = coerce(v, col.type)
      } catch (err) {
        errors.push(`${col.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (errors.length) rejects.push({ index, row, errors })
    else out.push(conformed)
  })
  return { rows: out, rejects }
}

/** Columns "Add new columns automatically" adds for these extras: optional, typed from the data, classification suggested from the name. */
export function autoAddedColumns(extras: string[], rows: Row[], hints: Record<string, ColumnType> = {}): SchemaColumn[] {
  const types = new Map(inferColumns(rows.map((r) => Object.fromEntries(extras.map((e) => [e, r[e]]))), hints).map((c) => [c.name, c.type]))
  return extras.map((e) => column(safeName(e), types.get(e) ?? 'text', { autoAdded: true, reviewed: false }))
}

/** Which pipelines fill which column (from their target-first mappings); a column claimed twice is "last writer wins". */
export function columnOwners(datasetName: string, pipelines: { id: string; name: string; definition: PipelineDefinition }[]): { byColumn: Record<string, string[]>; byName: string[] } {
  const byColumn: Record<string, string[]> = {}
  const byName: string[] = []
  for (const p of pipelines) {
    for (const n of p.definition.nodes) {
      if (n.type !== 'destination' || n.kind !== 'dataset' || n.datasetName !== datasetName) continue
      if (!n.columnMap?.length) {
        if (!byName.includes(p.name)) byName.push(p.name)
        continue
      }
      for (const m of n.columnMap) if (m.binding.kind !== 'none') byColumn[m.target] = [...new Set([...(byColumn[m.target] ?? []), p.name])]
    }
  }
  return { byColumn, byName }
}

/**
 * A destination after renames of its dataset's columns (active aliases, old → new): a
 * published pipeline keeps writing the renamed column until someone republishes it.
 * Its mapping targets and keys follow; matched by name, the rows' old names do.
 */
export function followRenames<D extends Pick<Extract<DestinationStep, { kind: 'dataset' }>, 'columnMap' | 'keys'>>(dest: D, rows: Row[], aliases: { oldName: string; newName: string }[]): { dest: D; rows: Row[] } {
  if (!aliases.length) return { dest, rows }
  const to = new Map(aliases.map((a) => [a.oldName, a.newName]))
  const next = { ...dest, keys: dest.keys.map((k) => to.get(k) ?? k), ...(dest.columnMap ? { columnMap: dest.columnMap.map((m) => ({ ...m, target: to.get(m.target) ?? m.target })) } : {}) }
  if (dest.columnMap?.length) return { dest: next, rows }
  const renamed = rows.map((r) => {
    if (!aliases.some((a) => a.oldName in r && !(a.newName in r))) return r
    const out: Row = {}
    for (const [k, v] of Object.entries(r)) out[to.has(k) && !(to.get(k)! in r) ? to.get(k)! : k] = v
    return out
  })
  return { dest: next, rows: renamed }
}

// ── Renames carried everywhere (so a masked column never becomes unmasked) ──

/** A pipeline definition with a dataset column renamed: target mappings and keys of its destinations, lookups and exists_in checks reading it. */
export function renameInDefinition(def: PipelineDefinition, datasetName: string, from: string, to: string): { definition: PipelineDefinition; changed: boolean } {
  let changed = false
  const nodes = def.nodes.map((n) => {
    if (n.type === 'destination' && n.kind === 'dataset' && n.datasetName === datasetName) {
      const columnMap = (n.columnMap ?? []).map((m) => (m.target === from ? ((changed = true), { ...m, target: to }) : m))
      const keys = n.keys.map((k) => (k === from ? ((changed = true), to) : k))
      return { ...n, columnMap, keys }
    }
    if (n.type === 'map') {
      return {
        ...n,
        fields: n.fields.map((f) => ({
          ...f,
          transforms: f.transforms.map((t) => {
            if (t.fn !== 'lookup' || t.args[0]?.trim() !== datasetName) return t
            const args = t.args.map((a, i) => (i > 0 && i < 3 && a.trim() === from ? ((changed = true), to) : a))
            return { ...t, args }
          }),
        })),
      }
    }
    if (n.type === 'validate') {
      return { ...n, rules: n.rules.map((r) => (r.rule === 'exists_in' && r.value === `${datasetName}.${from}` ? ((changed = true), { ...r, value: `${datasetName}.${to}` }) : r)) }
    }
    return n
  }) as PipelineDefinition['nodes']
  return { definition: { ...def, nodes }, changed }
}

type WidgetLike = { dataset: string; measure: { column: string }; dimension: { column: string } | null; filters: { column: string }[] }
/** Dashboard widgets of the dataset with a column renamed. */
export function renameInWidgets<W extends WidgetLike>(widgets: W[], datasetName: string, from: string, to: string): { widgets: W[]; changed: boolean } {
  let changed = false
  const fix = (c: string) => (c === from ? ((changed = true), to) : c)
  const out = widgets.map((w) =>
    w.dataset !== datasetName ? w : { ...w, measure: { ...w.measure, column: fix(w.measure.column) }, dimension: w.dimension ? { ...w.dimension, column: fix(w.dimension.column) } : null, filters: w.filters.map((f) => ({ ...f, column: fix(f.column) })) }
  )
  return { widgets: out, changed }
}

/** A governance policy with a column renamed: its mask and classification, and row filters on it. */
export function renameInPolicy<P, F extends { column: string }>(columns: Record<string, P>, rowFilters: F[], from: string, to: string): { columns: Record<string, P>; rowFilters: F[] } {
  const next = Object.fromEntries(Object.entries(columns).map(([k, v]) => [k === from ? to : k, v]))
  return { columns: next, rowFilters: rowFilters.map((f) => (f.column === from ? { ...f, column: to } : f)) }
}

// ── Promotion (GV-7) ─────────────────────────────────────────────────────────

/**
 * The changes that bring the next environment's schema up to this one:
 * additive ones (new columns, descriptions, required, auto-add) become
 * operations; a removed column, a type or key change blocks the promotion.
 */
export function schemaPromotion(from: DatasetSchema, to: DatasetSchema | null): { status: 'create' | 'update' | 'same' | 'blocked'; lines: string[]; ops: SchemaOp[] } {
  const diff = schemaDiff(from, to)
  if (!to) return { status: 'create', lines: diff.lines, ops: [] }
  if (!diff.additive) return { status: 'blocked', lines: diff.lines, ops: [] }
  const ops: SchemaOp[] = []
  const target = new Map(to.columns.map((c) => [c.name, c]))
  for (const c of from.columns) {
    const t = target.get(c.name)
    if (!t) {
      ops.push({ kind: 'add', column: { ...c } })
      continue
    }
    if (t.required !== c.required) ops.push({ kind: 'require', name: c.name, required: c.required })
    if (t.classification !== c.classification || t.description !== c.description || t.default !== c.default) {
      ops.push({ kind: 'describe', name: c.name, description: c.description, classification: c.classification, default: c.default ?? null })
    }
    if (c.reviewed && !t.reviewed) ops.push({ kind: 'review', name: c.name })
  }
  if (from.autoAdd !== to.autoAdd) ops.push({ kind: 'autoAdd', on: from.autoAdd })
  return { status: ops.length ? 'update' : 'same', lines: diff.lines, ops }
}
