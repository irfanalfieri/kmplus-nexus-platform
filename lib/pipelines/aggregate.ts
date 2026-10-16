import { timeGrainColumn, type AggregateMeasure, type AggregateStep, type ColumnType, type DedupeStep, type TimeGrain } from './definition'
import type { Row } from './transforms'
import { compareWatermarks } from './columns'
import { evalGroup } from './conditions'
import { describeKey, joinKey } from './join'
import { checkText } from './check-messages'

/**
 * Blocking steps (several sources, phase B): Aggregate and Deduplicate. Pure and
 * client-safe; covered by scripts/engine-tests.ts. The worker stages the rows
 * that reach the step with a group key (`aggregateKey` / `dedupeKey`), then in
 * the finish phase reads whole groups back in key order and answers each one
 * here, so conditions behave exactly as in Filter, Router and Validate.
 */

const DAY = 86_400_000
const NAIVE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/

/** A date value as a UTC instant (timestamps without a zone are UTC); null when it isn't a date. */
function toTime(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim()
  const t = Date.parse(NAIVE.test(s) ? `${s.replace(' ', 'T')}${s.length > 10 ? 'Z' : 'T00:00:00Z'}` : s)
  return Number.isNaN(t) ? null : t
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/** The first day of the value's day, ISO week (Monday), month, quarter or year, as YYYY-MM-DD. */
export function timeBucket(value: unknown, grain: TimeGrain): string | null {
  const t = toTime(value)
  if (t === null) return null
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (grain) {
    case 'day':
      return iso(Date.UTC(y, m, d.getUTCDate()))
    case 'week': {
      const day = Date.UTC(y, m, d.getUTCDate())
      return iso(day - ((d.getUTCDay() + 6) % 7) * DAY)
    }
    case 'month':
      return iso(Date.UTC(y, m, 1))
    case 'quarter':
      return iso(Date.UTC(y, m - (m % 3), 1))
    case 'year':
      return iso(Date.UTC(y, 0, 1))
  }
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === ''
const plain = (v: unknown) => (v instanceof Date ? v.toISOString() : v)

/** The group a row belongs to: its group-by values and time bucket. Never null. */
export function aggregateKey(row: Row, node: AggregateStep): string {
  return JSON.stringify([...node.groupBy.map((c) => (isEmpty(row[c]) ? null : plain(row[c]))), ...(node.timeGrain ? [timeBucket(row[node.timeGrain.column], node.timeGrain.grain)] : [])])
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.trim()))) return Number(v.trim())
  return null
}

/** One measure over a group's rows (in the order they were read). */
export function measure(m: AggregateMeasure, rows: Row[]): unknown {
  const rs = m.condition ? rows.filter((r) => evalGroup(r, m.condition)) : rows
  const values = m.column ? rs.map((r) => r[m.column]).filter((v) => !isEmpty(v)) : []
  switch (m.fn) {
    case 'count':
      return m.column ? values.length : rs.length
    case 'count_distinct':
      return new Set(values.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(plain(v))))).size
    case 'sum': {
      const nums = values.map(toNumber).filter((n): n is number => n !== null)
      // Fixed-point sum keeps 0.1 + 0.2 = 0.3 for money.
      return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) * 1e9) / 1e9 : null
    }
    case 'avg': {
      const nums = values.map(toNumber).filter((n): n is number => n !== null)
      return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1e9) / 1e9 : null
    }
    case 'min':
    case 'max': {
      let best: unknown = null
      for (const v of values) if (best === null || (m.fn === 'min' ? compareWatermarks(v, best) < 0 : compareWatermarks(v, best) > 0)) best = v
      return plain(best)
    }
    case 'first':
    case 'last': {
      const withValue = rs.filter((r) => !isEmpty(r[m.column]))
      if (!withValue.length) return null
      if (!m.sortBy) return plain((m.fn === 'first' ? withValue[0] : withValue[withValue.length - 1])[m.column])
      let best: Row | null = null
      for (const r of withValue) {
        if (isEmpty(r[m.sortBy])) continue
        const cmp = best ? compareWatermarks(r[m.sortBy], best[m.sortBy]) : 0
        if (!best || (m.fn === 'first' ? cmp < 0 : cmp >= 0)) best = r
      }
      return plain((best ?? withValue[0])[m.column])
    }
    case 'join':
      return [...new Set(values.map((v) => String(plain(v))))].join(m.separator)
    case 'list':
      return values.map(plain)
  }
}

/** One output row for a group: group-by values, the time bucket and every measure. */
export function aggregateGroup(node: AggregateStep, rows: Row[]): Row {
  const first = rows[0] ?? {}
  const out: Row = {}
  for (const c of node.groupBy) out[c] = isEmpty(first[c]) ? null : plain(first[c])
  if (node.timeGrain) out[timeGrainColumn(node.timeGrain)] = timeBucket(first[node.timeGrain.column], node.timeGrain.grain)
  for (const m of node.measures) out[m.name] = measure(m, rows)
  return out
}

/** Aggregates rows in memory (test runs; the worker groups through staging). Groups keep first-seen order. */
export function aggregateRows(node: AggregateStep, rows: Row[]): Row[] {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const k = aggregateKey(r, node)
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups.values()].map((g) => aggregateGroup(node, g))
}

/** Output column types of an Aggregate, from the types of the columns it reads. */
export function aggregateOutputTypes(node: AggregateStep, input: Record<string, ColumnType> = {}): Record<string, ColumnType> {
  const out: Record<string, ColumnType> = {}
  for (const c of node.groupBy) if (input[c]) out[c] = input[c]
  if (node.timeGrain) out[timeGrainColumn(node.timeGrain)] = 'date'
  for (const m of node.measures) {
    out[m.name] =
      m.fn === 'count' || m.fn === 'count_distinct' ? 'integer'
        : m.fn === 'sum' || m.fn === 'avg' ? 'numeric'
          : m.fn === 'join' ? 'text'
            : m.fn === 'list' ? 'json'
              : (input[m.column] ?? 'text')
  }
  return out
}

// ── Deduplicate ──────────────────────────────────────────────────────────────

/**
 * The column that says which record is most recent, for the decided default
 * (most recent when the data has one, else first read): a change time such as
 * updated_at, else a timestamp column. Business dates (birth_date, hire_date) don't count.
 */
export function recencyColumn<C extends { name: string; type: string }>(columns: C[]): C | undefined {
  return (
    columns.find((c) => /(updated|modified|changed|last_?mod|refreshed)/i.test(c.name)) ??
    columns.find((c) => /_at$|_on$|timestamp/i.test(c.name) && !/(birth|hire|join|start|end|termination|created)/i.test(c.name)) ??
    columns.find((c) => c.type === 'timestamp' && !/(birth|hire|join|start|end|termination|created)/i.test(c.name))
  )
}

/** The normalized key a row is deduplicated on (as Join keys); null when a key part is empty (never a duplicate). */
export function dedupeKey(row: Row, node: DedupeStep): string | null {
  return joinKey(row, node.keys, node.normalize)
}

/** Which row of a group of duplicates stays: the first or last read, or the most recent by a date column (ties: the later one). */
export function pickSurvivor(node: DedupeStep, rows: Row[]): { kept: Row; removed: Row[] } {
  let index = node.keep === 'first' ? 0 : rows.length - 1
  if (node.keep === 'most_recent' && node.recentBy) {
    index = -1
    rows.forEach((r, i) => {
      if (isEmpty(r[node.recentBy])) return
      if (index < 0 || compareWatermarks(r[node.recentBy], rows[index][node.recentBy]) >= 0) index = i
    })
    if (index < 0) index = rows.length - 1
  }
  return { kept: rows[index], removed: rows.filter((_, i) => i !== index) }
}

/** The flag message for a removed duplicate (listed in Data quality). */
export function duplicateMessage(node: DedupeStep, row: Row, kept: Row): string {
  const keys = describeKey(row, node.keys)
  if (node.keep === 'most_recent' && node.recentBy) {
    const v = kept[node.recentBy]
    return checkText('duplicateRemovedRecent', { keys, column: node.recentBy, value: v instanceof Date ? v.toISOString() : String(v ?? '') })
  }
  return checkText(node.keep === 'last' ? 'duplicateRemovedLast' : 'duplicateRemovedFirst', { keys })
}

/** Deduplicates rows in memory (test runs). Output keeps the order of the kept rows. */
export function dedupeRows(node: DedupeStep, rows: Row[]): { rows: Row[]; removed: { row: Row; message: string }[] } {
  const groups = new Map<string, number[]>()
  rows.forEach((r, i) => {
    const k = dedupeKey(r, node) ?? `\u0002${i}`
    groups.set(k, [...(groups.get(k) ?? []), i])
  })
  const keep = new Set<number>()
  const removed: { row: Row; message: string }[] = []
  for (const idx of groups.values()) {
    const { kept, removed: gone } = pickSurvivor(node, idx.map((i) => rows[i]))
    keep.add(idx[idx.map((i) => rows[i]).indexOf(kept)])
    for (const r of gone) removed.push({ row: r, message: duplicateMessage(node, r, kept) })
  }
  return { rows: rows.filter((_, i) => keep.has(i)), removed }
}
