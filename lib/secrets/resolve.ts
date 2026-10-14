import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { decryptCredentials } from '@/lib/security/credentials'
import type { ConnectorCredentials } from '@/lib/connectors/types'
import { secretManagerDriver } from './managers'
import { SECRET_MANAGER_SLUGS, SecretRefError, findSecretRefs, isSecretManager, secretField, type SecretValue } from './types'

export { SecretRefError, secretField }

/**
 * Resolves {{secret:<source>:<path>#<field>}} references in data source
 * credentials just before a connector uses them. Server-only.
 *
 * - The secrets manager is a data source of the same workspace, found by name.
 * - Values are cached in memory for 60 seconds, never written to the database,
 *   logs, audit entries or the browser. Saved credentials keep the reference.
 * - A secrets manager's own credentials may use references too (one level).
 */

const TTL_MS = 60_000
const cache = new Map<string, { value: SecretValue; expires: number }>()

const asStrings = (values: Record<string, unknown>): ConnectorCredentials => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v == null ? '' : String(v)]))

async function managerRows(workspaceId: string, names: string[]) {
  if (!names.length) return []
  return db
    .select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType, credentials: dataSources.credentials })
    .from(dataSources)
    .where(and(eq(dataSources.workspaceId, workspaceId), inArray(dataSources.name, names), inArray(dataSources.sourceType, [...SECRET_MANAGER_SLUGS])))
}

/** Credentials with every secret reference replaced by its value. Values without references are returned as they are. */
export async function resolveSecretRefs(workspaceId: string | undefined, credentials: Record<string, unknown>, depth = 0): Promise<ConnectorCredentials> {
  const values = asStrings(credentials)
  const refs = Object.values(values).flatMap(findSecretRefs)
  if (!refs.length) return values
  if (!workspaceId) throw new SecretRefError('Secret references need the data source’s workspace.')
  if (depth > 1) throw new SecretRefError('A secrets manager’s credentials may use references to another secrets manager only one level deep.')

  const names = [...new Set(refs.map((r) => r.source.trim()))]
  const rows = await managerRows(workspaceId, names)
  const byName = new Map(rows.map((r) => [r.name.trim(), r]))
  const resolved = new Map<string, string>()
  for (const ref of refs) {
    if (resolved.has(ref.raw)) continue
    const row = byName.get(ref.source.trim())
    if (!row || !isSecretManager(row.sourceType)) throw new SecretRefError(`No secrets manager named "${ref.source}" in this workspace (Data sources).`)
    const label = `"${ref.path}" in ${row.name}`
    const key = `${row.id}\u0000${ref.path}`
    let hit = cache.get(key)
    if (!hit || hit.expires < Date.now()) {
      const managerCredentials = await resolveSecretRefs(workspaceId, decryptCredentials(row.id, row.credentials, workspaceId), depth + 1)
      try {
        hit = { value: await secretManagerDriver(row.sourceType).get(managerCredentials, ref.path), expires: Date.now() + TTL_MS }
      } catch (err) {
        throw Object.assign(new Error(`Could not read secret ${label}: ${err instanceof Error ? err.message : 'error'}`), { retryable: (err as { retryable?: boolean })?.retryable !== false })
      }
      cache.set(key, hit)
    }
    resolved.set(ref.raw, secretField(hit.value, ref.field, label))
  }
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.replace(/\{\{\s*secret:[^{}]+\}\}/g, (m) => resolved.get(m) ?? m)]))
}

/**
 * A data source row whose credentials are decrypted and resolved, for the I/O
 * layer (plain credentials pass through decryptCredentials). Never save it.
 */
export async function withResolvedSecrets<T extends { id: string; workspaceId?: string | null; credentials: unknown; config?: unknown }>(source: T): Promise<T> {
  const plain = decryptCredentials(source.id, source.credentials)
  if (!Object.values(plain).some((v) => typeof v === 'string' && v.includes('{{'))) return source
  return { ...source, credentials: await resolveSecretRefs(source.workspaceId ?? undefined, plain) }
}

/** Drops cached values (after a secrets manager's credentials change). */
export function forgetCachedSecrets() {
  cache.clear()
}
