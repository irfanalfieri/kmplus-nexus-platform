import type { SchemaScanResult } from './types'

/**
 * Schema drift (DS-8): what changed between two schema scans of a data source,
 * and which pipelines read what changed. Pure and client-safe; covered by
 * scripts/engine-tests.ts.
 *
 * Breaking changes (a table or column removed, a column's type changed) are
 * what a run can feel; additions are listed too but never alert on their own.
 */

/** DS-7: how often a data source can be checked, in minutes (0 = off). */
export const HEALTH_CHECK_MINUTES = [0, 5, 15, 60, 360, 1440] as const

export type DriftChange =
  | { kind: 'table_removed'; table: string }
  | { kind: 'table_added'; table: string }
  | { kind: 'column_removed'; table: string; column: string }
  | { kind: 'column_added'; table: string; column: string; type: string }
  | { kind: 'column_retyped'; table: string; column: string; from: string; to: string }

export interface SchemaDrift {
  detectedAt: string
  /** Scan times compared (previous → new). */
  from: string | null
  to: string
  changes: DriftChange[]
  /** Pipelines reading a removed or retyped table / column, with what they read. */
  affected: { pipelineId: string; name: string; changes: string[] }[]
}

export const isBreaking = (c: DriftChange) => c.kind === 'table_removed' || c.kind === 'column_removed' || c.kind === 'column_retyped'

const tableKey = (t: { schema: string; name: string }) => t.name
/** Types compared loosely: "character varying(50)" and "varchar" are the same column to a pipeline. */
const typeFamily = (t: string) => {
  const s = t.toLowerCase().replace(/\(.*\)/, '').trim()
  if (/^(var)?char|text|string|character|nvarchar|nchar|clob|uuid|citext/.test(s)) return 'text'
  if (/^(big|small|tiny|medium)?int|integer|serial|long|short/.test(s)) return 'integer'
  if (/numeric|decimal|number|float|double|real|money/.test(s)) return 'numeric'
  if (/bool|bit/.test(s)) return 'boolean'
  if (/timestamp|datetime/.test(s)) return 'timestamp'
  if (/^date$/.test(s)) return 'date'
  if (/json/.test(s)) return 'json'
  return s
}

/** Changes from the previous scan to the new one. No previous scan = nothing to compare. */
export function diffScans(prev: SchemaScanResult | null | undefined, next: SchemaScanResult): DriftChange[] {
  if (!prev?.tables?.length) return []
  const out: DriftChange[] = []
  const before = new Map(prev.tables.map((t) => [tableKey(t), t]))
  const after = new Map(next.tables.map((t) => [tableKey(t), t]))
  for (const [name, t] of before) {
    const n = after.get(name)
    if (!n) {
      out.push({ kind: 'table_removed', table: name })
      continue
    }
    const cols = new Map(n.columns.map((c) => [c.name, c]))
    for (const c of t.columns) {
      const now = cols.get(c.name)
      if (!now) out.push({ kind: 'column_removed', table: name, column: c.name })
      // TEXT → JSON is how REST scans now report nested objects (MP-7): the values are the same.
      else if (typeFamily(now.type) !== typeFamily(c.type) && !(typeFamily(c.type) === 'text' && typeFamily(now.type) === 'json')) out.push({ kind: 'column_retyped', table: name, column: c.name, from: c.type, to: now.type })
    }
    const had = new Set(t.columns.map((c) => c.name))
    for (const c of n.columns) if (!had.has(c.name)) out.push({ kind: 'column_added', table: name, column: c.name, type: c.type })
  }
  for (const name of after.keys()) if (!before.has(name)) out.push({ kind: 'table_added', table: name })
  return out
}

export function describeChange(c: DriftChange): string {
  switch (c.kind) {
    case 'table_removed':
      return `Table ${c.table} removed`
    case 'table_added':
      return `Table ${c.table} added`
    case 'column_removed':
      return `${c.table}.${c.column} removed`
    case 'column_added':
      return `${c.table}.${c.column} added (${c.type})`
    case 'column_retyped':
      return `${c.table}.${c.column} changed from ${c.from} to ${c.to}`
  }
}

type PipelineLike = { id: string; name: string; definition: { nodes: { id: string; type: string; dataSourceId?: string; table?: string }[] } }

/**
 * Pipelines a breaking change reaches: they read the table from this data
 * source, and (for a column) name the column anywhere in their definition.
 * A pipeline that only passes every column through without naming it is not
 * listed for a column change; its run will show the effect.
 */
export function affectedPipelines(dataSourceId: string, changes: DriftChange[], pipelines: PipelineLike[]): SchemaDrift['affected'] {
  const breaking = changes.filter(isBreaking)
  if (!breaking.length) return []
  const out: SchemaDrift['affected'] = []
  for (const p of pipelines) {
    const tables = new Set(p.definition.nodes.filter((n) => n.type === 'source' && n.dataSourceId === dataSourceId && n.table).map((n) => n.table!))
    if (!tables.size) continue
    const text = JSON.stringify(p.definition.nodes.filter((n) => n.type !== 'source'))
    const hits = breaking.filter((c) => tables.has(c.table) && (c.kind === 'table_removed' || text.includes(JSON.stringify(c.column))))
    if (hits.length) out.push({ pipelineId: p.id, name: p.name, changes: hits.map(describeChange) })
  }
  return out
}

/** The drift to keep on the data source: only when something breaking changed. */
export function driftFrom(dataSourceId: string, prev: SchemaScanResult | null | undefined, next: SchemaScanResult, pipelines: PipelineLike[], now = new Date()): SchemaDrift | null {
  const changes = diffScans(prev, next)
  if (!changes.some(isBreaking)) return null
  return { detectedAt: now.toISOString(), from: prev?.scannedAt ?? null, to: next.scannedAt, changes, affected: affectedPipelines(dataSourceId, changes, pipelines) }
}

/** Two drifts on the same source merge (the earlier one may not have been reviewed yet). */
export function mergeDrift(old: SchemaDrift | null | undefined, next: SchemaDrift | null): SchemaDrift | null {
  if (!next) return old ?? null
  if (!old) return next
  const seen = new Set(next.changes.map(describeChange))
  const changes = [...next.changes, ...old.changes.filter((c) => !seen.has(describeChange(c)))]
  const byPipeline = new Map<string, SchemaDrift['affected'][number]>()
  for (const a of [...old.affected, ...next.affected]) {
    const cur = byPipeline.get(a.pipelineId)
    byPipeline.set(a.pipelineId, cur ? { ...a, changes: [...new Set([...cur.changes, ...a.changes])] } : a)
  }
  return { ...next, from: old.from, changes, affected: [...byPipeline.values()] }
}

/** Health summary over a window: share of passing checks and the last failure. */
export function uptime(checks: { ok: boolean; checkedAt: Date | string }[], sinceMs: number, now = Date.now()): { checks: number; ok: number; percent: number | null } {
  const recent = checks.filter((c) => now - new Date(c.checkedAt).getTime() <= sinceMs)
  const ok = recent.filter((c) => c.ok).length
  return { checks: recent.length, ok, percent: recent.length ? Math.round((ok / recent.length) * 1000) / 10 : null }
}
