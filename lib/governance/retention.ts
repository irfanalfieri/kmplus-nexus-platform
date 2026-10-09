import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { datasetPolicies, nexusDatasets } from '@/lib/db/schema'

/** How often a dataset's retention is enforced (the worker runs every minute). */
const RETENTION_INTERVAL_MS = 60 * 60 * 1000

const qIdent = (name: string) => `"${name.replace(/"/g, '""')}"`

/**
 * Deletes dataset rows loaded more than `retentionDays` ago (GV-10) and
 * refreshes the dataset's row count. Returns rows deleted.
 */
export async function applyRetentionFor(workspaceId: string, datasetName: string, retentionDays: number): Promise<number> {
  const [dataset] = await db
    .select({ id: nexusDatasets.id, tableName: nexusDatasets.tableName })
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, workspaceId), eq(nexusDatasets.name, datasetName)))
    .limit(1)
  let deleted = 0
  if (dataset) {
    const table = `"nexus_data".${qIdent(dataset.tableName)}`
    const exists = (await pool.query<{ r: string | null }>('SELECT to_regclass($1)::text AS r', [table])).rows[0].r
    if (exists) {
      const res = await pool.query(`DELETE FROM ${table} WHERE "_nexus_loaded_at" < now() - make_interval(days => $1)`, [retentionDays])
      deleted = res.rowCount ?? 0
      const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)
      await db.update(nexusDatasets).set({ rowCount: rows[0].n, updatedAt: new Date() }).where(eq(nexusDatasets.id, dataset.id))
    }
  }
  await db
    .update(datasetPolicies)
    .set({ retentionAppliedAt: new Date() })
    .where(and(eq(datasetPolicies.workspaceId, workspaceId), eq(datasetPolicies.datasetName, datasetName)))
  return deleted
}

/** Enforces every retention policy not checked in the last hour. Called by the worker; never throws. */
export async function applyDueRetention() {
  try {
    const due = await db
      .select({ workspaceId: datasetPolicies.workspaceId, datasetName: datasetPolicies.datasetName, retentionDays: datasetPolicies.retentionDays })
      .from(datasetPolicies)
      .where(
        and(
          isNotNull(datasetPolicies.retentionDays),
          or(isNull(datasetPolicies.retentionAppliedAt), lt(datasetPolicies.retentionAppliedAt, new Date(Date.now() - RETENTION_INTERVAL_MS)))
        )
      )
      .limit(50)
    for (const p of due) {
      const deleted = await applyRetentionFor(p.workspaceId, p.datasetName, p.retentionDays!)
      if (deleted) console.info(`[retention] ${p.workspaceId}/${p.datasetName}: deleted ${deleted} row(s) older than ${p.retentionDays} days`)
    }
  } catch (err) {
    console.error('[retention] failed:', err instanceof Error ? err.message : err)
  }
}
