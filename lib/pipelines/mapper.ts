import { COLUMN_TYPES, type ColumnType, type MapStep } from './definition'
import { autoMapName } from '@/lib/domain/model'

/**
 * The two-pane mapper (MP-1): source columns on the left, target fields on
 * the right; a column dropped on a target fills it. Pure and client-safe;
 * covered by scripts/engine-tests.ts. Rows without a source are kept while
 * mapping and left out when the mapping is applied to the Map step.
 */

export type MapperRow = { to: string; type: ColumnType; from: string; transforms: MapStep['fields'][number]['transforms'] }
type Column = { name: string; type: string }

const asType = (t: string): ColumnType => ((COLUMN_TYPES as readonly string[]).includes(t) ? (t as ColumnType) : 'text')

/** A field name a Map step accepts: letters, numbers and underscores, not starting with a digit. */
export function fieldName(raw: string): string {
  const s = raw.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[A-Za-z_]/.test(s) ? s : s ? `f_${s}` : ''
}

export const rowsFromStep = (step: Pick<MapStep, 'fields'>): MapperRow[] => step.fields.map((f) => ({ to: f.to, type: f.type, from: f.from, transforms: f.transforms }))

/** The Map step's fields after mapping: rows with a source and a name, in order. */
export const fieldsFromRows = (rows: MapperRow[]): MapStep['fields'] => rows.filter((r) => r.from && r.to).map((r) => ({ from: r.from, to: r.to, type: r.type, transforms: r.transforms }))

/** Drops a column on a target: it fills the target (a target without a type of its own takes the column's). */
export function assign(rows: MapperRow[], target: string, column: Column): MapperRow[] {
  return rows.map((r) => (r.to === target ? { ...r, from: column.name, type: r.from || r.type !== 'text' ? r.type : asType(column.type) } : r))
}

/** Drops a column on "New field": a new target named after it (HR synonyms first: PERNR → employee_code). */
export function addColumn(rows: MapperRow[], column: Column): MapperRow[] {
  let name = autoMapName(column.name) || fieldName(column.name)
  if (!name) return rows
  if (rows.some((r) => r.to === name)) {
    let n = 2
    while (rows.some((r) => r.to === `${name}_${n}`)) n++
    name = `${name}_${n}`
  }
  return [...rows, { to: name, type: asType(column.type), from: column.name, transforms: [] }]
}

/**
 * Adds targets the rows don't have yet (from a business entity or a dataset
 * schema), each filled with the input column of the same name or a known
 * synonym when one is free.
 */
export function addTargets(rows: MapperRow[], targets: Column[], input: Column[]): MapperRow[] {
  const used = new Set(rows.map((r) => r.from).filter(Boolean))
  const out = [...rows]
  for (const t of targets) {
    if (out.some((r) => r.to === t.name)) continue
    const match = input.find((c) => !used.has(c.name) && (c.name === t.name || c.name.toLowerCase() === t.name.toLowerCase())) ?? input.find((c) => !used.has(c.name) && autoMapName(c.name) === t.name)
    if (match) used.add(match.name)
    out.push({ to: t.name, type: asType(t.type), from: match?.name ?? '', transforms: [] })
  }
  return out
}

/** How often each input column is used (a column can fill several targets). */
export function usage(rows: MapperRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) if (r.from) m.set(r.from, (m.get(r.from) ?? 0) + 1)
  return m
}
