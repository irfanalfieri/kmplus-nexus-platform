import type { ColumnType } from './definition'

/**
 * Nested objects and JSON (MP-7). Pure and client-safe; covered by scripts/engine-tests.ts.
 *
 * Reading: a Map field's source may be a path into a nested value:
 *   address.city          object fields
 *   phones.0.number       a list item by position (from 0)
 *   assignments[].org     every item of a list (gives a list)
 * JSON text (a string holding an object or list) is read as if it were the value.
 * A column whose name literally contains dots (e.g. flattened "labels.job") wins.
 *
 * Building: a Map output name with dots (address.city) writes a nested object.
 * Splitting: the Split list step gives one row per item of a list.
 */

type Row = Record<string, unknown>

/** A known nested value under a column: its path (from the column, e.g. "address.city") and type. */
export interface NestedPath {
  path: string
  type: ColumnType
}

const MAX_DEPTH = 10
export const MAX_PATHS = 200

interface Segment {
  key: string
  /** `key[]`: every item of the list under key. */
  each: boolean
}

/** "a.b[].c" → [a, b[], c]; "phones[0]" is read as "phones.0". */
export function parsePath(path: string): Segment[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s.length)
    .map((s) => (s.endsWith('[]') ? { key: s.slice(0, -2), each: true } : { key: s, each: false }))
}

export const isPlainObject = (v: unknown): v is Row => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

/** JSON text holding an object or a list, parsed; anything else unchanged. */
export function parseJsonText(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (!((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')))) return v
  try {
    return JSON.parse(s)
  } catch {
    return v
  }
}

function step(value: unknown, key: string): unknown {
  const v = parseJsonText(value)
  if (Array.isArray(v)) return /^\d+$/.test(key) ? v[Number(key)] : undefined
  return isPlainObject(v) ? v[key] : undefined
}

function walk(value: unknown, segs: Segment[]): unknown {
  let v = value
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    v = s.key ? step(v, s.key) : parseJsonText(v)
    if (v === undefined || v === null) return v ?? null
    if (s.each) {
      const list = parseJsonText(v)
      if (!Array.isArray(list)) return null
      const rest = segs.slice(i + 1)
      return list.map((item) => (rest.length ? walk(item, rest) : item))
    }
  }
  return v
}

/** True when a Map source names a nested value rather than a column. */
export const isPath = (from: string) => from.includes('.') || from.includes('[')

/** The value a Map source names: a column, or a path into a nested value. */
export function readPath(row: Row, path: string): unknown {
  if (path in row || !isPath(path)) return row[path]
  const v = walk(row, parsePath(path))
  return v === undefined ? null : v
}

/** The column a path starts at ("address.city" → "address"). */
export function pathRoot(path: string): string {
  return parsePath(path)[0]?.key ?? path
}

const OUTPUT_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/
export const isOutputPath = (to: string) => OUTPUT_PATH.test(to)

/** Writes `value` at a dotted output name, creating (copies of) the objects on the way; never changes the input row's objects. */
export function setPath(out: Row, path: string, value: unknown) {
  const keys = path.split('.')
  let cur = out
  for (const k of keys.slice(0, -1)) {
    const next = cur[k]
    cur[k] = isPlainObject(next) ? { ...next } : {}
    cur = cur[k] as Row
  }
  cur[keys[keys.length - 1]] = value
}

/** Output names that clash: "address" written as a value and as a group (address.city). English; validation messages. */
export function outputPathIssues(names: string[]): string[] {
  const issues: string[] = []
  const set = new Set(names)
  for (const name of set) {
    const parts = name.split('.')
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('.')
      if (set.has(prefix)) issues.push(`"${prefix}" is both a value and a group (${name}).`)
    }
  }
  return [...new Set(issues)]
}

/** Columns a Map step outputs: dotted names become one json column per group, with their paths. */
export function mapOutputColumns(fields: { to: string; type: ColumnType }[]): { name: string; type: ColumnType; paths?: NestedPath[] }[] {
  const out: { name: string; type: ColumnType; paths?: NestedPath[] }[] = []
  for (const f of fields) {
    if (!f.to) continue
    const dot = f.to.indexOf('.')
    if (dot < 0) {
      if (!out.some((c) => c.name === f.to)) out.push({ name: f.to, type: f.type })
      continue
    }
    const root = f.to.slice(0, dot)
    let col = out.find((c) => c.name === root)
    if (!col) out.push((col = { name: root, type: 'json', paths: [] }))
    col.paths = [...(col.paths ?? []), { path: f.to, type: f.type }]
  }
  return out
}

const typeOf = (v: unknown): ColumnType =>
  typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'numeric') : typeof v === 'boolean' ? 'boolean' : v instanceof Date ? 'timestamp' : typeof v === 'object' && v !== null ? 'json' : 'text'

/**
 * Leaf paths inside a nested value, starting with `prefix` (the column):
 * object fields recursively, a list as one json path, and the fields of a
 * list's object items as `list[].field` (what Split list makes columns of).
 */
export function leafPaths(value: unknown, prefix: string, out = new Map<string, ColumnType>(), depth = 0): Map<string, ColumnType> {
  const v = parseJsonText(value)
  if (out.size >= MAX_PATHS || depth > MAX_DEPTH) return out
  if (isPlainObject(v)) {
    for (const [k, child] of Object.entries(v)) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k)) continue
      const p = `${prefix}.${k}`
      const c = parseJsonText(child)
      if (isPlainObject(c)) leafPaths(c, p, out, depth + 1)
      else {
        if (!out.has(p) || out.get(p) === 'text') out.set(p, c === null || c === undefined ? (out.get(p) ?? 'text') : typeOf(c))
        if (Array.isArray(c)) for (const item of c.slice(0, 20)) if (isPlainObject(item)) leafPaths(item, `${p}[]`, out, depth + 1)
      }
    }
  } else if (Array.isArray(v) && depth === 0) {
    for (const item of v.slice(0, 20)) if (isPlainObject(item)) leafPaths(item, `${prefix}[]`, out, depth + 1)
  }
  return out
}

/** Nested paths per column, from sample rows (scans and the editor). Only columns holding objects, lists or JSON text. */
export function collectPaths(rows: Row[]): Map<string, NestedPath[]> {
  const byColumn = new Map<string, Map<string, ColumnType>>()
  for (const row of rows.slice(0, 200)) {
    for (const [k, raw] of Object.entries(row)) {
      const v = parseJsonText(raw)
      if (!isPlainObject(v) && !Array.isArray(v)) continue
      const paths = byColumn.get(k) ?? new Map<string, ColumnType>()
      leafPaths(v, k, paths)
      byColumn.set(k, paths)
    }
  }
  return new Map([...byColumn].map(([k, paths]) => [k, [...paths].map(([path, type]) => ({ path, type }))]))
}

/** Columns with the nested paths found in sample rows added (the editor's last test rows). */
export function withPaths<C extends { name: string; type: string; paths?: NestedPath[] }>(cols: C[], rows: Row[]): C[] {
  if (!rows.length) return cols
  const found = collectPaths(rows)
  if (!found.size) return cols
  return cols.map((c) => {
    const extra = (found.get(c.name) ?? []).filter((p) => !(c.paths ?? []).some((q) => q.path === p.path))
    return extra.length ? { ...c, paths: [...(c.paths ?? []), ...extra].slice(0, MAX_PATHS) } : c
  })
}

/** Lists a Split list step can take: json columns and lists found inside nested values (employment.assignments). */
export function listCandidates(columns: { name: string; type: string; paths?: NestedPath[] }[]): string[] {
  const out: string[] = []
  for (const c of columns) {
    const paths = c.paths ?? []
    if (c.type === 'json' || /json|array|object/i.test(c.type) || paths.some((p) => p.path.startsWith(`${c.name}[]`))) out.push(c.name)
    for (const p of paths) {
      if (p.path.includes('[]') || p.type !== 'json') continue
      // A json leaf is a list (objects are walked into); its items show as "<path>[]…" when they hold objects.
      out.push(p.path)
    }
  }
  return [...new Set(out)]
}

/** A column name for a nested path: address.city → address_city, assignments[].org → assignments_org. */
export function flattenName(path: string): string {
  const name = path
    .replace(/\[\]/g, '')
    .replace(/\[(\d+)\]/g, '_$1')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return (/^[a-z_]/.test(name) ? name : `f_${name}`).slice(0, 63) || 'value'
}

/** Map fields that read every nested value of the given columns (lists stay whole, as json; list items need Split list). */
export function flattenFields(columns: { name: string; paths?: NestedPath[] }[], existing: Set<string>): { from: string; to: string; type: ColumnType }[] {
  const out: { from: string; to: string; type: ColumnType }[] = []
  const taken = new Set(existing)
  for (const c of columns) {
    for (const p of c.paths ?? []) {
      if (p.path.includes('[]')) continue
      let to = flattenName(p.path)
      for (let i = 2; taken.has(to); i++) to = `${flattenName(p.path).slice(0, 60)}_${i}`
      taken.add(to)
      out.push({ from: p.path, to, type: p.type })
    }
  }
  return out
}

// ── Split list (one row per item) ──

export interface SplitSpec {
  path: string
  as: string
  flattenItems: boolean
  indexColumn: string
  onEmpty: 'keep' | 'drop'
  dropList: boolean
  maxItems: number
}

/** Name of the item column (or prefix of an object item's fields): `as`, else the list's last name. */
export function splitItemName(spec: Pick<SplitSpec, 'path' | 'as'>): string {
  if (spec.as) return spec.as
  const segs = parsePath(spec.path)
  return flattenName(segs[segs.length - 1]?.key || 'item')
}

/** An item's fields as columns: nested objects joined with "_", lists kept whole. */
function flattenItem(item: Row, prefix: string, out: Row, depth = 0) {
  for (const [k, v] of Object.entries(item)) {
    const name = `${prefix}_${k}`.replace(/[^A-Za-z0-9_]+/g, '_')
    if (isPlainObject(v) && depth < MAX_DEPTH) flattenItem(v, name, out, depth + 1)
    else out[name] = v
  }
}

/**
 * One row per item of the list at `spec.path`; the other columns repeat on
 * every row. A single object counts as a list of one. `truncated` = items
 * left out over `maxItems`.
 */
export function splitRow(row: Row, spec: SplitSpec): { rows: Row[]; truncated: number } {
  const raw = parseJsonText(readPath(row, spec.path))
  const list = Array.isArray(raw) ? raw : raw === null || raw === undefined || raw === '' ? [] : [raw]
  const base: Row = { ...row }
  if (spec.dropList) {
    if (spec.path in base) delete base[spec.path]
    else if (parsePath(spec.path).length === 1) delete base[pathRoot(spec.path)]
  }
  const name = splitItemName(spec)
  if (!list.length) return { rows: spec.onEmpty === 'keep' ? [base] : [], truncated: 0 }
  const items = list.slice(0, spec.maxItems)
  const rows = items.map((item, i) => {
    const out: Row = { ...base }
    const v = parseJsonText(item)
    if (spec.flattenItems && isPlainObject(v)) flattenItem(v, name, out)
    else out[name] = item
    if (spec.indexColumn) out[spec.indexColumn] = i + 1
    return out
  })
  return { rows, truncated: list.length - items.length }
}

/** Columns after a Split list step (editor): the list column replaced by the item columns. */
export function splitOutputColumns<C extends { name: string; type: string; paths?: NestedPath[] }>(cols: C[], spec: SplitSpec): { name: string; type: string; paths?: NestedPath[] }[] {
  const root = pathRoot(spec.path)
  const name = splitItemName(spec)
  const listCol = cols.find((c) => c.name === root)
  const listPath = spec.path.replace(/\[\]$/, '')
  const itemPaths = (listCol?.paths ?? []).filter((p) => p.path.startsWith(`${listPath}[].`))
  const added: { name: string; type: string }[] =
    spec.flattenItems && itemPaths.length
      ? itemPaths.filter((p) => !p.path.slice(listPath.length + 3).includes('[]')).map((p) => ({ name: `${name}_${p.path.slice(listPath.length + 3).replace(/\./g, '_')}`, type: p.type }))
      : [{ name, type: 'json' }]
  if (spec.indexColumn) added.push({ name: spec.indexColumn, type: 'integer' })
  const kept = cols.filter((c) => !(spec.dropList && parsePath(spec.path).length === 1 && c.name === root) && !added.some((a) => a.name === c.name))
  return [...kept, ...added]
}
