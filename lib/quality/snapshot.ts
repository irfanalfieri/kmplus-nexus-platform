import { and, eq } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { datasetQualitySnapshots, domainMappings } from '@/lib/db/schema'
import { DOMAIN_BY_NAME } from '@/lib/domain/model'
import { randomUUID } from 'node:crypto'

/**
 * Daily data quality measurements per dataset (DQ-4), taken after each run
 * that writes the dataset (the day's last run wins):
 *   completeness  share of non-empty cells
 *   uniqueness    distinct keys / rows (upsert keys, else the entity key the dataset is published under)
 *   validity      share of the run's rows that passed every check
 *   score         average of the measured dimensions
 * Freshness is measured when viewed (time since the last load).
 */

const qIdent = (name: string) => `"${name.replace(/"/g, '""')}"`
const MAX_COLUMNS = 120
const SAMPLE_ABOVE = 200_000

export const jakartaDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d)

export async function takeQualitySnapshot(opts: {
  workspaceId: string
  datasetName: string
  tableName: string
  columns: string[]
  keys: string[]
  /** Run validity in %, null when the run read nothing. */
  validity: number | null
}) {
  try {
    const rel = `"nexus_data".${qIdent(opts.tableName)}`
    const cols = opts.columns.slice(0, MAX_COLUMNS)
    let keys = opts.keys
    if (!keys.length) {
      const [m] = await db.select().from(domainMappings).where(and(eq(domainMappings.workspaceId, opts.workspaceId), eq(domainMappings.datasetName, opts.datasetName))).limit(1)
      const keyField = m ? DOMAIN_BY_NAME.get(m.entity)?.key : undefined
      const col = keyField ? (m!.fields as Record<string, string>)[keyField] : undefined
      if (col && opts.columns.includes(col)) keys = [col]
    }
    const { rows: [{ n }] } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${rel} WHERE "_nexus_deleted_at" IS NULL`)
    let completeness: number | null = null
    let uniqueness: number | null = null
    if (n > 0 && cols.length) {
      // Large datasets are measured on a ~200k-row sample.
      const sample = n > SAMPLE_ABOVE ? ` TABLESAMPLE SYSTEM (${Math.min(100, Math.max(1, Math.ceil((SAMPLE_ABOVE / n) * 100)))})` : ''
      const filled = cols.map((c) => `count(NULLIF(${qIdent(c)}::text, ''))::bigint`).join(' + ')
      const distinct = keys.length ? `, count(DISTINCT (${keys.map((k) => `${qIdent(k)}::text`).join(', ')}))::bigint AS d` : ''
      const { rows: [r] } = await pool.query<{ total: string; filled: string; d?: string }>(`SELECT count(*)::bigint AS total, (${filled}) AS filled${distinct} FROM ${rel}${sample} WHERE "_nexus_deleted_at" IS NULL`)
      const total = Number(r.total)
      if (total > 0) {
        completeness = Math.round((Number(r.filled) / (total * cols.length)) * 1000) / 10
        if (r.d !== undefined) uniqueness = Math.round((Number(r.d) / total) * 1000) / 10
      }
    }
    const dims = [completeness, uniqueness, opts.validity].filter((x): x is number => x !== null)
    const score = dims.length ? Math.round((dims.reduce((a, b) => a + b, 0) / dims.length) * 10) / 10 : null
    const values = { rowCount: n, completeness: completeness?.toString() ?? null, uniqueness: uniqueness?.toString() ?? null, validity: opts.validity?.toString() ?? null, score: score?.toString() ?? null, takenAt: new Date() }
    await db
      .insert(datasetQualitySnapshots)
      .values({ id: `dqs_${randomUUID()}`, workspaceId: opts.workspaceId, datasetName: opts.datasetName, day: jakartaDay(), ...values })
      .onConflictDoUpdate({ target: [datasetQualitySnapshots.workspaceId, datasetQualitySnapshots.datasetName, datasetQualitySnapshots.day], set: values })
  } catch (err) {
    // Measuring quality must never fail a run.
    console.error('[quality] snapshot failed:', err instanceof Error ? err.message : err)
  }
}
