import { sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { currentKeyId, decryptCredentials, encryptCredentials, needsReencryption } from './credentials'

/**
 * Re-seals data source credentials that aren't on the current master key with
 * a per-workspace key (TD-22). Runs in the scheduler tick, where production's
 * NEXUS_ENCRYPTION_KEY (and NEXUS_ENCRYPTION_KEY_PREVIOUS after a rotation) is
 * available, so nobody has to handle the production key by hand.
 * scripts/reencrypt-credentials.mjs does the same from a terminal.
 */
export async function upgradeCredentialEnvelopes(limit = 50): Promise<{ upgraded: number; failed: number }> {
  const rows = await db
    .select({ id: dataSources.id, workspaceId: dataSources.workspaceId, credentials: dataSources.credentials })
    .from(dataSources)
    .where(sql`coalesce(${dataSources.credentials}->>'__enc', '') <> 'v2' OR ${dataSources.credentials}->>'kid' IS DISTINCT FROM ${currentKeyId()}`)
    .limit(limit)
  let upgraded = 0
  let failed = 0
  for (const row of rows) {
    if (!needsReencryption(row.credentials)) continue
    try {
      const plain = decryptCredentials(row.id, row.credentials ?? {})
      const sealed = encryptCredentials(row.id, plain, row.workspaceId)
      // Round-trip check before writing; only replace the exact value we read.
      if (JSON.stringify(decryptCredentials(row.id, sealed)) !== JSON.stringify(plain)) throw new Error('round-trip mismatch')
      const res = await pool.query('UPDATE data_sources SET credentials = $1 WHERE id = $2 AND credentials = $3::jsonb', [sealed, row.id, JSON.stringify(row.credentials)])
      if (res.rowCount) upgraded++
    } catch (err) {
      failed++
      // Never log the credentials themselves.
      console.error(`[credentials] could not re-seal data source ${row.id}:`, err instanceof Error ? err.message : 'failed')
    }
  }
  return { upgraded, failed }
}

