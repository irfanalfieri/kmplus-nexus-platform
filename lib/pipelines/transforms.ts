import type { ColumnType, Condition, ConditionGroup, FilterStep, MapStep, Severity, Transform, ValidateStep } from './definition'
import type { BusinessRule } from '@/lib/rules/definition'
import { asString, evalCondition, evalGroup, isEmpty, type Row } from './conditions'
import { sha256Hex } from './sha256'

export type { Row }

// ── Dates ────────────────────────────────────────────────────────────────────

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

/** Parses common enterprise date shapes: ISO, yyyyMMdd (SAP), dd/MM/yyyy, dd-MM-yyyy, epoch ms, Date. */
export function parseDate(value: unknown, inputFormat = ''): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return new Date(value)
  const s = asString(value).trim()
  if (!s) return null
  const fmt = inputFormat.trim()
  let m: RegExpMatchArray | null
  if ((fmt === 'yyyyMMdd' || (!fmt && /^\d{8}$/.test(s))) && (m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    return utc(+m[1], +m[2], +m[3])
  }
  if (fmt === 'MM/dd/yyyy' && (m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return utc(+m[3], +m[1], +m[2])
  if ((fmt === 'dd/MM/yyyy' || fmt === 'dd-MM-yyyy' || !fmt) && (m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/))) {
    return utc(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return utc(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10))
  // Zone-less timestamps (e.g. Postgres "timestamp" columns) are UTC, never server-local.
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/))) {
    const d = utc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0))
    if (d && m[7]) d.setUTCMilliseconds(Math.round(Number(m[7]) * 1000))
    return d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function utc(y: number, mo: number, d: number, h = 0, mi = 0, se = 0) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, se))
  return date.getUTCMonth() === mo - 1 ? date : null
}

export function formatDate(date: Date, pattern = 'yyyy-MM-dd') {
  return pattern
    .replace('yyyy', pad(date.getUTCFullYear(), 4))
    .replace('MM', pad(date.getUTCMonth() + 1))
    .replace('dd', pad(date.getUTCDate()))
    .replace('HH', pad(date.getUTCHours()))
    .replace('mm', pad(date.getUTCMinutes()))
    .replace('ss', pad(date.getUTCSeconds()))
}

// ── Transforms ───────────────────────────────────────────────────────────────

/** Fills {column} placeholders from the row. */
function template(text: string, row: Row) {
  return text.replace(/\{([^{}]+)\}/g, (_, name: string) => asString(row[name.trim()]))
}

/** Formats a date in a timezone (IANA, e.g. Asia/Jakarta); UTC by default. */
function formatDateIn(date: Date, pattern: string, timeZone: string) {
  if (!timeZone || timeZone === 'UTC') return formatDate(date, pattern)
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(date)
        .map((p) => [p.type, p.value])
    )
    return pattern
      .replace('yyyy', parts.year)
      .replace('MM', parts.month)
      .replace('dd', parts.day)
      .replace('HH', parts.hour)
      .replace('mm', parts.minute)
      .replace('ss', parts.second)
  } catch {
    throw new Error(`Unknown timezone "${timeZone}"`)
  }
}

export function applyTransform(value: unknown, t: Transform, row: Row = {}): unknown {
  const [a = '', b = '', c = '', d = ''] = t.args
  switch (t.fn) {
    case 'trim':
      return typeof value === 'string' ? value.trim() : value
    case 'uppercase':
      return isEmpty(value) ? value : asString(value).toUpperCase()
    case 'lowercase':
      return isEmpty(value) ? value : asString(value).toLowerCase()
    case 'titlecase':
      return isEmpty(value) ? value : asString(value).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, p, ch) => p + ch.toUpperCase())
    case 'replace':
      return isEmpty(value) ? value : asString(value).split(a).join(b)
    case 'regex_replace':
      if (isEmpty(value)) return value
      try {
        return asString(value).replace(new RegExp(a, 'g'), b)
      } catch {
        throw new Error(`Invalid regex "${a}"`)
      }
    case 'regex_extract': {
      if (isEmpty(value)) return value
      let m: RegExpMatchArray | null
      try {
        m = asString(value).match(new RegExp(a))
      } catch {
        throw new Error(`Invalid regex "${a}"`)
      }
      return m ? (m[Number(b) || (m.length > 1 ? 1 : 0)] ?? null) : null
    }
    case 'default_if_empty':
      return isEmpty(value) ? a : value
    case 'coalesce':
      // First non-empty of: this value, then the listed columns.
      return isEmpty(value) ? t.args.map((col) => row[col]).find((v) => !isEmpty(v)) ?? null : value
    case 'prefix':
      return isEmpty(value) ? value : a + asString(value)
    case 'suffix':
      return isEmpty(value) ? value : asString(value) + a
    case 'substring': {
      if (isEmpty(value)) return value
      const start = Number(a) || 0
      return b ? asString(value).substr(start, Number(b)) : asString(value).slice(start)
    }
    case 'concat':
      // Template with {column} placeholders, e.g. "{first_name} {last_name}"; {value} is this field.
      return template(a.replace(/\{value\}/g, asString(value)), row).replace(/\s+/g, ' ').trim() || null
    case 'split': {
      if (isEmpty(value)) return value
      const parts = asString(value).split(a || ',')
      const i = Number(b) || 0
      return (i < 0 ? parts[parts.length + i] : parts[i])?.trim() ?? null
    }
    case 'format_date': {
      if (isEmpty(value)) return value
      // args: [outputPattern, inputFormat?, timezone?]
      const date = parseDate(value, b)
      if (!date) throw new Error(`"${asString(value)}" is not a recognizable date`)
      return formatDateIn(date, a || 'yyyy-MM-dd', c)
    }
    case 'round': {
      if (isEmpty(value)) return value
      const n = Number(value)
      if (Number.isNaN(n)) throw new Error(`"${asString(value)}" is not a number`)
      const f = 10 ** (Number(a) || 0)
      return Math.round(n * f) / f
    }
    case 'number_format': {
      if (isEmpty(value)) return value
      const n = Number(typeof value === 'string' ? value.replace(/,/g, '') : value)
      if (!Number.isFinite(n)) throw new Error(`"${asString(value)}" is not a number`)
      const digits = Number(a) || 0
      return new Intl.NumberFormat(b || 'id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
    }
    case 'to_number': {
      if (isEmpty(value)) return null
      // Accepts "1.234,56" (id-ID) and "1,234.56" (en-US).
      let s = asString(value).trim().replace(/\s/g, '')
      if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
      else s = s.replace(/,/g, '')
      const n = Number(s)
      if (Number.isNaN(n)) throw new Error(`"${asString(value)}" is not a number`)
      return n
    }
    case 'to_boolean':
      return toBoolean(value)
    case 'hash':
      // SHA-256 hex, optionally with a salt: a stable pseudonym (MP-4 "hash for masking").
      return isEmpty(value) ? value : sha256Hex(a + asString(value))
    case 'conditional': {
      // [operator, value, then, else]: then/else may use {column} placeholders; "{value}" keeps this field.
      const cond: Condition = { field: '__v', operator: (a || 'equals') as Condition['operator'], value: b, valueField: '' }
      const hit = evalCondition({ ...row, __v: value }, cond)
      const out = hit ? c : d
      return out === '{value}' ? value : template(out.replace(/\{value\}/g, asString(value)), row)
    }
  }
}

function toBoolean(value: unknown): boolean | null {
  if (isEmpty(value)) return null
  if (typeof value === 'boolean') return value
  const s = asString(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'ya', 'active', 'aktif', 't'].includes(s)) return true
  if (['false', '0', 'no', 'n', 'tidak', 'inactive', 'nonaktif', 'f'].includes(s)) return false
  throw new Error(`"${asString(value)}" is not a boolean`)
}

/** Converts a value to the column type declared in a Map step. */
export function coerce(value: unknown, type: ColumnType): unknown {
  if (isEmpty(value)) return null
  switch (type) {
    case 'text':
      return asString(value)
    case 'integer': {
      const n = Number(typeof value === 'string' ? value.replace(/,/g, '') : value)
      if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`"${asString(value)}" is not an integer`)
      return n
    }
    case 'numeric': {
      const n = Number(typeof value === 'string' ? value.replace(/,/g, '') : value)
      if (!Number.isFinite(n)) throw new Error(`"${asString(value)}" is not a number`)
      return n
    }
    case 'boolean':
      return toBoolean(value)
    case 'date': {
      const d = parseDate(value)
      if (!d) throw new Error(`"${asString(value)}" is not a date`)
      return formatDate(d, 'yyyy-MM-dd')
    }
    case 'timestamp': {
      const d = parseDate(value)
      if (!d) throw new Error(`"${asString(value)}" is not a timestamp`)
      return d.toISOString()
    }
    case 'json':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      }
      return value
  }
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** Filter node: its conditions and/or its business rule's condition must match. */
export function matchesFilter(row: Row, step: FilterStep, rules?: Map<string, BusinessRule>): boolean {
  if (step.ruleId) {
    const rule = rules?.get(step.ruleId)
    if (!rule) throw new Error(`Business rule ${step.ruleId} not found`)
    if (!evalGroup(row, rule.when)) return false
  }
  if (!step.conditions.length) return true
  return evalGroup(row, { match: step.match, conditions: step.conditions, groups: [] })
}

/** Applies a Map step. Returns the new row plus per-field conversion errors. */
export function applyMap(row: Row, step: MapStep): { row: Row; errors: string[] } {
  const out: Row = {}
  const errors: string[] = []
  if (step.keepUnmapped) {
    const mapped = new Set(step.fields.map((f) => f.from))
    for (const [k, v] of Object.entries(row)) if (!mapped.has(k)) out[k] = v
  }
  // Internal routing hints survive mapping.
  for (const [k, v] of Object.entries(row)) if (k.startsWith('_nexus_')) out[k] = v
  for (const field of step.fields) {
    try {
      let value = row[field.from]
      for (const t of field.transforms) value = applyTransform(value, t, row)
      out[field.to] = coerce(value, field.type)
    } catch (err) {
      out[field.to] = null
      errors.push(`${field.to}: ${err instanceof Error ? err.message : 'conversion failed'}`)
    }
  }
  return { row: out, errors }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const digitsOnly = (s: string) => s.replace(/[\s.\-()/]/g, '')

/** Indonesian NIK: 16 digits; digits 7–12 are the birth date (women: day + 40). */
export function isValidNik(s: string) {
  const v = digitsOnly(s)
  if (!/^\d{16}$/.test(v)) return false
  const day = Number(v.slice(6, 8))
  const month = Number(v.slice(8, 10))
  return ((day >= 1 && day <= 31) || (day >= 41 && day <= 71)) && month >= 1 && month <= 12
}
/** NPWP: 15 digits (99.999.999.9-999.999) or the 16-digit form (NIK-based, since 2024). */
export const isValidNpwp = (s: string) => /^(\d{15}|\d{16})$/.test(digitsOnly(s))
/** Indonesian mobile (08…, +628…, 628…) or any international number in E.164 form. */
export const isValidPhone = (s: string) => {
  const v = s.replace(/[\s\-().]/g, '')
  return /^(\+62|62|0)8\d{7,11}$/.test(v) || /^\+[1-9]\d{7,14}$/.test(v)
}

export interface Issue {
  message: string
  severity: Severity
}

export interface ValidateContext {
  /** Values seen by "unique" rules (across the whole run). */
  seen: Map<string, Set<string>>
  /** exists_in lookups: "dataset.column" → values. */
  lookups?: Map<string, Set<string>>
  rules?: Map<string, BusinessRule>
  /** manager rules: (employee key, manager key) pairs, checked once the run has all rows. */
  managerPairs?: { nodeId: string; key: string; manager: string; field: string; keyField: string }[]
  nodeId?: string
}

/** Validates a row. Every failed rule gives an issue with that rule's severity. */
export function validateRow(row: Row, step: ValidateStep, ctx: ValidateContext | Map<string, Set<string>>): Issue[] {
  const c: ValidateContext = ctx instanceof Map ? { seen: ctx } : ctx
  const issues: Issue[] = []
  for (const spec of step.rules) {
    const { field, rule, value } = spec
    const raw = row[field]
    const s = asString(raw)
    const fail = (message: string) => issues.push({ message, severity: spec.severity ?? 'error' })
    switch (rule) {
      case 'required':
        if (isEmpty(raw)) fail(`${field} is required`)
        break
      case 'email':
        if (!isEmpty(raw) && !EMAIL.test(s.trim())) fail(`${field} is not a valid email`)
        break
      case 'phone':
        if (!isEmpty(raw) && !isValidPhone(s)) fail(`${field} "${s}" is not a valid phone number`)
        break
      case 'nik':
        if (!isEmpty(raw) && !isValidNik(s)) fail(`${field} "${s}" is not a valid NIK (16 digits with a birth date)`)
        break
      case 'npwp':
        if (!isEmpty(raw) && !isValidNpwp(s)) fail(`${field} "${s}" is not a valid NPWP (15 or 16 digits)`)
        break
      case 'unique': {
        if (isEmpty(raw)) break
        if (!c.seen.has(field)) c.seen.set(field, new Set())
        const set = c.seen.get(field)!
        if (set.has(s)) fail(`${field} "${s}" is duplicated`)
        else set.add(s)
        break
      }
      case 'regex':
        try {
          if (!isEmpty(raw) && !new RegExp(value).test(s)) fail(`${field} doesn't match ${value}`)
        } catch {
          fail(`Invalid regex "${value}" on ${field}`)
        }
        break
      case 'min_length':
        if (!isEmpty(raw) && s.length < Number(value)) fail(`${field} is shorter than ${value}`)
        break
      case 'max_length':
        if (!isEmpty(raw) && s.length > Number(value)) fail(`${field} is longer than ${value}`)
        break
      case 'min':
        if (!isEmpty(raw) && Number(raw) < Number(value)) fail(`${field} is below ${value}`)
        break
      case 'max':
        if (!isEmpty(raw) && Number(raw) > Number(value)) fail(`${field} is above ${value}`)
        break
      case 'one_of': {
        const allowed = value.split(',').map((v) => v.trim().toLowerCase())
        if (!isEmpty(raw) && !allowed.includes(s.toLowerCase())) fail(`${field} "${s}" is not one of ${value}`)
        break
      }
      case 'date':
        if (!isEmpty(raw) && !parseDate(raw, value)) fail(`${field} "${s}" is not a valid date`)
        break
      case 'not_future': {
        if (isEmpty(raw)) break
        const d = parseDate(raw)
        if (!d) fail(`${field} "${s}" is not a valid date`)
        else if (d.getTime() > Date.now()) fail(`${field} ${formatDate(d)} is in the future`)
        break
      }
      case 'compare': {
        const other = row[spec.otherField]
        if (isEmpty(raw) || isEmpty(other)) break
        if (!evalCondition(row, { field, operator: spec.operator, value: '', valueField: spec.otherField })) {
          fail(`${field} (${s}) must be ${spec.operator.replace(/_/g, ' ')} ${spec.otherField} (${asString(other)})`)
        }
        break
      }
      case 'exists_in': {
        if (isEmpty(raw)) break
        const set = c.lookups?.get(value)
        if (!set) fail(`Lookup ${value} isn't available`)
        else if (!set.has(s)) fail(`${field} "${s}" is not in ${value}`)
        break
      }
      case 'condition': {
        let group: ConditionGroup | undefined = spec.condition
        if (spec.ruleId) {
          const r = c.rules?.get(spec.ruleId)
          if (!r) {
            fail(`Business rule ${spec.ruleId} not found`)
            break
          }
          group = r.when
        }
        if (!evalGroup(row, group)) fail(spec.ruleId ? `${field}: rule "${c.rules?.get(spec.ruleId)?.name}" not met` : `${field}: condition not met`)
        break
      }
      case 'manager':
        // Checked when the run has every row: manager exists and the chain has no cycle.
        // Every employee is recorded (also those without a manager, like the CEO) so their code counts as known.
        if (c.managerPairs && !isEmpty(row[value])) c.managerPairs.push({ nodeId: c.nodeId ?? '', key: asString(row[value]), manager: isEmpty(raw) ? '' : s, field, keyField: value })
        break
    }
  }
  return issues
}

/** Manager checks over the whole run: unknown managers and reporting cycles. */
export function checkManagers(pairs: { key: string; manager: string }[]): { key: string; manager: string; message: string }[] {
  const managerOf = new Map(pairs.map((p) => [p.key, p.manager]))
  const keys = new Set(pairs.map((p) => p.key))
  const out: { key: string; manager: string; message: string }[] = []
  const inCycle = new Set<string>()
  for (const p of pairs) {
    if (!p.manager) continue
    if (p.manager === p.key) {
      out.push({ ...p, message: `${p.key} is their own manager` })
      inCycle.add(p.key)
      continue
    }
    if (!keys.has(p.manager)) {
      out.push({ ...p, message: `manager ${p.manager} of ${p.key} is not an employee in this run` })
      continue
    }
    // Walk up the chain; a repeat means a cycle.
    const visited = new Set<string>([p.key])
    let cur = p.manager
    while (cur && managerOf.has(cur)) {
      if (visited.has(cur)) {
        if (cur === p.key && !inCycle.has(p.key)) {
          inCycle.add(p.key)
          out.push({ ...p, message: `${p.key} is in a circular reporting line` })
        }
        break
      }
      visited.add(cur)
      cur = managerOf.get(cur)!
    }
  }
  return out
}
