import type { JoinStep } from './definition'
import type { Row } from './transforms'
import { compareWatermarks } from './columns'

/**
 * Join (several sources). Pure and client-safe; covered by
 * scripts/engine-tests.ts. The run stages the right side, then looks up the
 * partners of each driver chunk's keys (`WHERE _k = ANY(…)`, lib/pipelines/stage.ts)
 * and joins them here in memory.
 */

export type KeyNormalization = JoinStep['normalize']

/** One key value as compared: trimmed, lower-cased, leading zeros dropped (per the step). Empty → null (never matches). */
export function normalizeKeyPart(v: unknown, n: KeyNormalization): string | null {
  if (v === null || v === undefined) return null
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (n.trim) s = s.trim()
  if (n.ignoreCase) s = s.toLowerCase()
  if (n.leadingZeros) s = s.replace(/^0+(?=.)/, '')
  return s === '' ? null : s
}

/** The comparable key of a row over several columns, or null when any part is empty. */
export function joinKey(row: Row, columns: string[], n: KeyNormalization): string | null {
  const parts: string[] = []
  for (const c of columns) {
    const p = normalizeKeyPart(row[c], n)
    if (p === null) return null
    parts.push(p)
  }
  return parts.join('\u0001')
}

/** Columns of the staged side that never reach the output. */
export const isInternalColumn = (c: string) => c.startsWith('_nexus_') || c.startsWith('_stage_')

export interface JoinOutcome {
  rows: Row[]
  /** Left rows without a partner that the step quarantines. */
  unmatched: Row[]
  /** Left rows that found at least one partner. */
  matched: number
  /** Extra rows from several matches ("rows multiplied"). */
  multiplied: number
}

/**
 * Joins left rows with their staged partners (key → right rows in staging order).
 * `rightColumns` are the staged side's columns, so left rows kept without a
 * partner still get every right column (empty).
 */
export function joinRows(node: JoinStep, left: Row[], partners: Map<string, Row[]>, opts: { prefix: string; rightColumns: string[] }): JoinOutcome {
  const leftCols = node.keys.map((k) => k.left)
  // A right key with the same name as its left key is the same value: kept once.
  const sameKey = new Set(node.keys.filter((k) => k.left === k.right).map((k) => k.right))
  const out: JoinOutcome = { rows: [], unmatched: [], matched: 0, multiplied: 0 }
  const merge = (l: Row, r: Row | null): Row => {
    const row: Row = { ...l }
    for (const c of r ? Object.keys(r) : opts.rightColumns) {
      if (sameKey.has(c) || isInternalColumn(c)) continue
      row[c in l ? `${opts.prefix}${c}` : c] = r ? r[c] : null
    }
    return row
  }
  for (const l of left) {
    const key = joinKey(l, leftCols, node.normalize)
    let matches = key === null ? [] : (partners.get(key) ?? [])
    if (matches.length) out.matched++
    if (node.joinType === 'no_match') {
      if (!matches.length) out.rows.push(l)
      continue
    }
    if (matches.length) {
      if (node.onMany === 'first' && matches.length > 1) matches = [pickFirst(matches, node.firstBy)]
      for (const r of matches) out.rows.push(merge(l, r))
      out.multiplied += matches.length - 1
      continue
    }
    if (node.onNoMatch === 'quarantine') out.unmatched.push(l)
    else if (node.joinType === 'left' && node.onNoMatch === 'keep') out.rows.push(merge(l, null))
  }
  return out
}

/** "First match": the highest (desc) or lowest (asc) value of a column, else the first staged. Empty values sort last. */
export function pickFirst(rows: Row[], by: JoinStep['firstBy']): Row {
  if (!by.column) return rows[0]
  let best = rows[0]
  for (const r of rows.slice(1)) {
    const a = r[by.column]
    const b = best[by.column]
    if (a === null || a === undefined || a === '') continue
    if (b === null || b === undefined || b === '') {
      best = r
      continue
    }
    const cmp = compareWatermarks(a, b)
    if (by.direction === 'desc' ? cmp > 0 : cmp < 0) best = r
  }
  return best
}

/** The columns a Join outputs, for the editor: left columns, then right ones (prefixed on a clash). */
export function joinOutputColumns<C extends { name: string }>(node: JoinStep, left: C[], right: C[], prefix: string): C[] {
  if (node.joinType === 'no_match') return left
  const names = new Set(left.map((c) => c.name))
  const sameKey = new Set(node.keys.filter((k) => k.left === k.right).map((k) => k.right))
  const out = [...left]
  for (const c of right) {
    if (sameKey.has(c.name) || isInternalColumn(c.name)) continue
    out.push({ ...c, name: names.has(c.name) ? `${prefix}${c.name}` : c.name })
  }
  return out
}

/** "code "E00123"" for a quarantine message. */
export function describeKey(row: Row, columns: string[]): string {
  return columns.map((c) => `${c} "${row[c] === null || row[c] === undefined ? '' : String(row[c])}"`).join(', ')
}
