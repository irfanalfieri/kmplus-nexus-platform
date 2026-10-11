import type { ColumnType } from '@/lib/pipelines/definition'

/**
 * Turning a parsed CSV/Excel sheet into upload parts (DS-9). Pure and
 * client-safe: headers become unique column names, cells become text (or
 * null), and each column gets a detected type that pipelines use as a hint.
 */

export type Cell = string | number | boolean | Date | null | undefined

/** Unique, non-empty column names from a header row ("Employee ID" stays readable; duplicates get _2, _3). */
export function columnNames(header: Cell[]): string[] {
  const used = new Map<string, number>()
  return header.map((h, i) => {
    let base = (h === null || h === undefined ? '' : String(h)).replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!base) base = `column_${i + 1}`
    if (base.startsWith('_nexus_')) base = base.slice(1)
    const key = base.toLowerCase()
    const n = (used.get(key) ?? 0) + 1
    used.set(key, n)
    return n === 1 ? base : `${base}_${n}`
  })
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Cell → stored text. Excel dates without a time become yyyy-MM-dd. */
export function cellText(v: Cell): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    const dateOnly = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 && v.getUTCMilliseconds() === 0
    return dateOnly ? `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}` : v.toISOString()
  }
  const s = typeof v === 'string' ? v.trim() : String(v)
  return s === '' ? null : s
}

const INT = /^-?\d{1,15}$/
const NUM = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
const BOOL = /^(true|false)$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

/**
 * Type every non-empty value in the sample fits, else text. Codes with leading
 * zeros (employee numbers, NIK) stay text so they aren't turned into numbers.
 */
export function detectType(values: (string | null)[]): ColumnType {
  const present = values.filter((v): v is string => v !== null)
  if (!present.length) return 'text'
  const all = (re: RegExp) => present.every((v) => re.test(v))
  if (present.some((v) => /^-?0\d/.test(v))) return 'text'
  if (all(INT)) return 'integer'
  if (all(NUM)) return 'numeric'
  if (all(BOOL)) return 'boolean'
  if (all(DATE)) return 'date'
  if (all(TIMESTAMP) || present.every((v) => DATE.test(v) || TIMESTAMP.test(v))) return 'timestamp'
  return 'text'
}

export interface ParsedSheet {
  columns: { name: string; type: ColumnType }[]
  rows: (string | null)[][]
}

/** Header row + data rows → columns with detected types and text rows (blank rows dropped). */
export function toSheet(data: Cell[][], headerRow = 0): ParsedSheet {
  const header = data[headerRow] ?? []
  const body = data.slice(headerRow + 1).map((r) => r.map(cellText)).filter((r) => r.some((v) => v !== null))
  const width = Math.max(header.length, ...body.slice(0, 1000).map((r) => r.length))
  const names = columnNames(Array.from({ length: width }, (_, i) => header[i]))
  const rows = body.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null))
  const sample = rows.slice(0, 2000)
  return { columns: names.map((name, i) => ({ name, type: detectType(sample.map((r) => r[i])) })), rows }
}

/** Splits rows into parts small enough for one request (~1.5 MB of JSON). */
export function uploadParts(rows: (string | null)[][], maxBytes = 1_500_000, maxRows = 10_000): (string | null)[][][] {
  const parts: (string | null)[][][] = []
  let current: (string | null)[][] = []
  let size = 0
  for (const r of rows) {
    const bytes = JSON.stringify(r).length + 1
    if (current.length && (size + bytes > maxBytes || current.length >= maxRows)) {
      parts.push(current)
      current = []
      size = 0
    }
    current.push(r)
    size += bytes
  }
  parts.push(current)
  return parts
}

/** Table names users see: lowercase letters, digits and _ (the file extension is dropped). */
export function cleanTableName(name: string) {
  const base = name
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return /^[a-z_]/.test(base) ? base || 'file' : `t_${base}`
}
