import type { ColumnType } from './definition'
import type { Row } from './transforms'

// ── Incremental sync watermarks ──────────────────────────────────────────────

const NUMERIC = /^-?\d+(\.\d+)?$/
const NAIVE_TS = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/

function asTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v !== 'string') return null
  // Timestamps without a zone are treated as UTC so results don't depend on the server's timezone.
  const s = NAIVE_TS.test(v.trim()) ? `${v.trim().replace(' ', 'T')}${v.length > 10 ? 'Z' : 'T00:00:00Z'}` : v
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

/** Orders watermark values: numbers numerically, dates chronologically, otherwise as text. */
export function compareWatermarks(a: unknown, b: unknown): number {
  const na = typeof a === 'number' ? a : typeof a === 'string' && NUMERIC.test(a.trim()) ? Number(a) : null
  const nb = typeof b === 'number' ? b : typeof b === 'string' && NUMERIC.test(b.trim()) ? Number(b) : null
  if (na !== null && nb !== null) return na - nb
  const ta = asTime(a), tb = asTime(b)
  if (ta !== null && tb !== null) return ta - tb
  return String(a).localeCompare(String(b))
}

/** Serializes a watermark for storage (and for passing back as a query parameter). */
export function serializeWatermark(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v)
}

/** Highest non-empty value of `column` in `rows`, or null. */
export function maxWatermark(rows: Row[], column: string): string | null {
  let best: unknown = null
  for (const row of rows) {
    const v = row[column]
    if (v === null || v === undefined || v === '') continue
    if (best === null || compareWatermarks(v, best) > 0) best = v
  }
  return best === null ? null : serializeWatermark(best)
}

export interface OutputColumn {
  name: string
  type: ColumnType
}

/** Infers column types from data when no Map step declares them. */
/** Column types reported by the source database (e.g. numeric, date), keyed by column name. */
export type TypeHints = Record<string, ColumnType>

/**
 * Output columns inferred from values. Drivers return numbers and dates as
 * strings (Postgres numeric/bigint/date), so a type reported by the source
 * database (hints) wins over the value-based guess.
 */
export function inferColumns(rows: Row[], hints: TypeHints = {}): OutputColumn[] {
  // null = only empty values seen so far; mixed types fall back to text.
  const types = new Map<string, ColumnType | null>()
  for (const row of rows.slice(0, 500)) {
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) {
        if (!types.has(k)) types.set(k, null)
        continue
      }
      const t: ColumnType =
        typeof v === 'number' ? 'numeric' : typeof v === 'boolean' ? 'boolean' : v instanceof Date ? 'timestamp' : typeof v === 'object' ? 'json' : 'text'
      const prev = types.get(k)
      types.set(k, prev == null || prev === t ? t : 'text')
    }
  }
  for (const name of Object.keys(hints)) if (!types.has(name) && rows.length) types.set(name, null)
  return [...types].map(([name, type]) => ({ name, type: hints[name] ?? type ?? 'text' }))
}
