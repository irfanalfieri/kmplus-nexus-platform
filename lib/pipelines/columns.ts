import type { ColumnType } from './definition'
import type { Row } from './transforms'

export interface OutputColumn {
  name: string
  type: ColumnType
}

/** Infers column types from data when no Map step declares them. */
export function inferColumns(rows: Row[]): OutputColumn[] {
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
  return [...types].map(([name, type]) => ({ name, type: type ?? 'text' }))
}
