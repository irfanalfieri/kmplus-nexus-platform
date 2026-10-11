import type { Condition, ConditionGroup, Expr } from './definition'

/**
 * Evaluates the declarative condition and expression formats (BR-5) against a
 * row. Pure and client-safe: used by Filter, Router, Validate, business rules
 * and the rule tester.
 */

export type Row = Record<string, unknown>

export const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
export const asString = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))

const num = (v: unknown) => (typeof v === 'number' ? v : Number(typeof v === 'string' ? v.trim().replace(/,/g, '') : v))
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** Orders two values: numbers numerically, ISO dates chronologically, otherwise case-insensitive text. */
export function compareValues(a: unknown, b: unknown): number {
  const na = num(a)
  const nb = num(b)
  if (!isEmpty(a) && !isEmpty(b) && Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  const sa = asString(a).trim()
  const sb = asString(b).trim()
  if ((a instanceof Date || ISO_DATE.test(sa)) && (b instanceof Date || ISO_DATE.test(sb))) {
    const ta = a instanceof Date ? a.getTime() : Date.parse(sa.length === 10 ? `${sa}T00:00:00Z` : sa)
    const tb = b instanceof Date ? b.getTime() : Date.parse(sb.length === 10 ? `${sb}T00:00:00Z` : sb)
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb
  }
  return sa.toLowerCase().localeCompare(sb.toLowerCase())
}

export function evalCondition(row: Row, c: Condition): boolean {
  const raw = row[c.field]
  const target = c.valueField ? row[c.valueField] : c.value
  const left = asString(raw).toLowerCase()
  const right = asString(target).toLowerCase()
  switch (c.operator) {
    case 'equals':
      return isEmpty(raw) && isEmpty(target) ? true : compareValues(raw, target) === 0 || left === right
    case 'not_equals':
      return !(compareValues(raw, target) === 0 || left === right)
    case 'contains':
      return left.includes(right)
    case 'not_contains':
      return !left.includes(right)
    case 'starts_with':
      return left.startsWith(right)
    case 'ends_with':
      return left.endsWith(right)
    case 'greater_than':
      return !isEmpty(raw) && compareValues(raw, target) > 0
    case 'less_than':
      return !isEmpty(raw) && compareValues(raw, target) < 0
    case 'greater_or_equal':
      return !isEmpty(raw) && compareValues(raw, target) >= 0
    case 'less_or_equal':
      return !isEmpty(raw) && compareValues(raw, target) <= 0
    case 'is_empty':
      return isEmpty(raw)
    case 'is_not_empty':
      return !isEmpty(raw)
    case 'in_list':
      return asString(target).split(',').map((v) => v.trim().toLowerCase()).includes(left)
    case 'matches_regex':
      try {
        return new RegExp(asString(target)).test(asString(raw))
      } catch {
        throw new Error(`Invalid regex "${asString(target)}"`)
      }
  }
}

/** True when the group matches. An empty group matches every row. */
export function evalGroup(row: Row, g: ConditionGroup | undefined): boolean {
  if (!g) return true
  const results = [...g.conditions.map((c) => evalCondition(row, c)), ...g.groups.map((sub) => evalGroup(row, sub))]
  if (!results.length) return true
  return g.match === 'all' ? results.every(Boolean) : results.some(Boolean)
}

const DAY_MS = 86_400_000
function toTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  const s = asString(v).trim()
  if (!s) return null
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s)
  return Number.isNaN(t) ? null : t
}

/** Evaluates a calculated-field expression. Arithmetic on non-numbers throws (the row is rejected with the reason). */
export function evalExpr(row: Row, e: Expr): unknown {
  switch (e.kind) {
    case 'field':
      return row[e.name] ?? null
    case 'value':
      return e.value
    case 'op': {
      const l = evalExpr(row, e.left)
      const r = evalExpr(row, e.right)
      if (e.op === 'concat') return asString(l) + asString(r)
      if (isEmpty(l) || isEmpty(r)) return null
      const a = num(l)
      const b = num(r)
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`can't calculate ${asString(l)} ${e.op} ${asString(r)}`)
      if (e.op === '/' && b === 0) throw new Error('division by zero')
      return e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : a / b
    }
    case 'fn': {
      const args = e.args.map((a) => evalExpr(row, a))
      switch (e.fn) {
        case 'upper':
          return isEmpty(args[0]) ? args[0] ?? null : asString(args[0]).toUpperCase()
        case 'lower':
          return isEmpty(args[0]) ? args[0] ?? null : asString(args[0]).toLowerCase()
        case 'trim':
          return isEmpty(args[0]) ? args[0] ?? null : asString(args[0]).trim()
        case 'coalesce':
          return args.find((a) => !isEmpty(a)) ?? null
        case 'round': {
          if (isEmpty(args[0])) return null
          const f = 10 ** (Number(args[1] ?? 0) || 0)
          return Math.round(num(args[0]) * f) / f
        }
        case 'year':
        case 'month': {
          const t = toTime(args[0])
          if (t === null) return null
          const d = new Date(t)
          return e.fn === 'year' ? d.getUTCFullYear() : d.getUTCMonth() + 1
        }
        case 'days_between': {
          const a = toTime(args[0])
          const b = toTime(args[1] ?? new Date())
          return a === null || b === null ? null : Math.floor((b - a) / DAY_MS)
        }
        case 'today':
          return new Date().toISOString().slice(0, 10)
      }
    }
  }
}

/** Readable form of an expression, for the rule builder and audit trail. */
export function describeExpr(e: Expr): string {
  switch (e.kind) {
    case 'field':
      return e.name
    case 'value':
      return JSON.stringify(e.value)
    case 'op':
      return `${describeExpr(e.left)} ${e.op === 'concat' ? '&' : e.op} ${describeExpr(e.right)}`
    case 'fn':
      return `${e.fn}(${e.args.map(describeExpr).join(', ')})`
  }
}
