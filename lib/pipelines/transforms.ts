import type { ColumnType, FilterStep, MapStep, Transform, ValidateStep } from './definition'

export type Row = Record<string, unknown>

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
const asString = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))

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

export function applyTransform(value: unknown, t: Transform): unknown {
  const [a = '', b = ''] = t.args
  switch (t.fn) {
    case 'trim':
      return typeof value === 'string' ? value.trim() : value
    case 'uppercase':
      return isEmpty(value) ? value : asString(value).toUpperCase()
    case 'lowercase':
      return isEmpty(value) ? value : asString(value).toLowerCase()
    case 'titlecase':
      return isEmpty(value) ? value : asString(value).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())
    case 'replace':
      return isEmpty(value) ? value : asString(value).split(a).join(b)
    case 'regex_replace':
      if (isEmpty(value)) return value
      try {
        return asString(value).replace(new RegExp(a, 'g'), b)
      } catch {
        throw new Error(`Invalid regex "${a}"`)
      }
    case 'default_if_empty':
      return isEmpty(value) ? a : value
    case 'prefix':
      return isEmpty(value) ? value : a + asString(value)
    case 'suffix':
      return isEmpty(value) ? value : asString(value) + a
    case 'substring': {
      if (isEmpty(value)) return value
      const start = Number(a) || 0
      return b ? asString(value).substr(start, Number(b)) : asString(value).slice(start)
    }
    case 'format_date': {
      if (isEmpty(value)) return value
      // args: [outputPattern, inputFormat?]
      const d = parseDate(value, b)
      if (!d) throw new Error(`"${asString(value)}" is not a recognizable date`)
      return formatDate(d, a || 'yyyy-MM-dd')
    }
    case 'round': {
      if (isEmpty(value)) return value
      const n = Number(value)
      if (Number.isNaN(n)) throw new Error(`"${asString(value)}" is not a number`)
      const f = 10 ** (Number(a) || 0)
      return Math.round(n * f) / f
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

export function matchesFilter(row: Row, step: FilterStep): boolean {
  const results = step.conditions.map(({ field, operator, value }) => {
    const raw = row[field]
    const left = asString(raw).toLowerCase()
    const right = value.toLowerCase()
    const num = (v: unknown) => Number(typeof v === 'string' ? v.replace(/,/g, '') : v)
    switch (operator) {
      case 'equals':
        return left === right
      case 'not_equals':
        return left !== right
      case 'contains':
        return left.includes(right)
      case 'not_contains':
        return !left.includes(right)
      case 'starts_with':
        return left.startsWith(right)
      case 'ends_with':
        return left.endsWith(right)
      case 'greater_than':
      case 'less_than': {
        const l = num(raw), r = num(value)
        const ld = parseDate(raw), rd = parseDate(value)
        const [a, b] = !Number.isNaN(l) && !Number.isNaN(r) ? [l, r] : ld && rd ? [ld.getTime(), rd.getTime()] : [left, right]
        return operator === 'greater_than' ? a > b : a < b
      }
      case 'is_empty':
        return isEmpty(raw)
      case 'is_not_empty':
        return !isEmpty(raw)
      case 'in_list':
        return value.split(',').map((v) => v.trim().toLowerCase()).includes(left)
    }
  })
  return step.match === 'all' ? results.every(Boolean) : results.some(Boolean)
}

/** Applies a Map step. Returns the new row plus per-field conversion errors. */
export function applyMap(row: Row, step: MapStep): { row: Row; errors: string[] } {
  const out: Row = {}
  const errors: string[] = []
  if (step.keepUnmapped) {
    const mapped = new Set(step.fields.map((f) => f.from))
    for (const [k, v] of Object.entries(row)) if (!mapped.has(k)) out[k] = v
  }
  for (const field of step.fields) {
    try {
      let value = row[field.from]
      for (const t of field.transforms) value = applyTransform(value, t)
      out[field.to] = coerce(value, field.type)
    } catch (err) {
      out[field.to] = null
      errors.push(`${field.to}: ${err instanceof Error ? err.message : 'conversion failed'}`)
    }
  }
  return { row: out, errors }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Validates rows; `seen` tracks values for `unique` rules across the whole run. */
export function validateRow(row: Row, step: ValidateStep, seen: Map<string, Set<string>>): string[] {
  const errors: string[] = []
  for (const { field, rule, value } of step.rules) {
    const raw = row[field]
    const s = asString(raw)
    switch (rule) {
      case 'required':
        if (isEmpty(raw)) errors.push(`${field} is required`)
        break
      case 'email':
        if (!isEmpty(raw) && !EMAIL.test(s.trim())) errors.push(`${field} is not a valid email`)
        break
      case 'unique': {
        if (isEmpty(raw)) break
        const key = `${field}`
        if (!seen.has(key)) seen.set(key, new Set())
        const set = seen.get(key)!
        if (set.has(s)) errors.push(`${field} "${s}" is duplicated`)
        else set.add(s)
        break
      }
      case 'regex':
        try {
          if (!isEmpty(raw) && !new RegExp(value).test(s)) errors.push(`${field} doesn't match ${value}`)
        } catch {
          errors.push(`Invalid regex "${value}" on ${field}`)
        }
        break
      case 'min_length':
        if (!isEmpty(raw) && s.length < Number(value)) errors.push(`${field} is shorter than ${value}`)
        break
      case 'max_length':
        if (!isEmpty(raw) && s.length > Number(value)) errors.push(`${field} is longer than ${value}`)
        break
      case 'min':
        if (!isEmpty(raw) && Number(raw) < Number(value)) errors.push(`${field} is below ${value}`)
        break
      case 'max':
        if (!isEmpty(raw) && Number(raw) > Number(value)) errors.push(`${field} is above ${value}`)
        break
      case 'one_of': {
        const allowed = value.split(',').map((v) => v.trim().toLowerCase())
        if (!isEmpty(raw) && !allowed.includes(s.toLowerCase())) errors.push(`${field} "${s}" is not one of ${value}`)
        break
      }
    }
  }
  return errors
}
