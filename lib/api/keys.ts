import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { apiKeys } from '@/lib/db/schema'
import { isRole, type Role } from '@/lib/auth/permissions'

/**
 * Data API keys (API-1). Server-only. Keys look like `nxk_<random>`; only a
 * SHA-256 hash is stored, the key itself is shown once at creation.
 */

export const API_SCOPES = ['datasets:read', 'domains:read'] as const
export type ApiScope = (typeof API_SCOPES)[number]
/** Roles a key can read as: analyst sees masked data, steward sees real values. */
export const API_KEY_ROLES = ['analyst', 'steward'] as const

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

export function generateKey() {
  const key = `nxk_${randomBytes(30).toString('base64url')}`
  return { key, hash: hashKey(key), prefix: key.slice(0, 12) }
}

export interface ApiCaller {
  keyId: string
  workspaceId: string
  role: Role
  scopes: ApiScope[]
}

export class ApiAuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message)
  }
}

/** Resolves `Authorization: Bearer nxk_…` to its workspace, role and scopes, or throws. */
export async function authenticate(header: string | null, scope: ApiScope): Promise<ApiCaller> {
  const m = /^Bearer\s+(nxk_[A-Za-z0-9_-]{20,})\s*$/.exec(header ?? '')
  if (!m) throw new ApiAuthError('Send an API key: Authorization: Bearer nxk_…', 401)
  const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.hash, hashKey(m[1])), isNull(apiKeys.revokedAt))).limit(1)
  if (!row) throw new ApiAuthError('Invalid or revoked API key.', 401)
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw new ApiAuthError('This API key has expired.', 401)
  const scopes = ((row.scopes as string[]) ?? []).filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s))
  if (!scopes.includes(scope)) throw new ApiAuthError(`This API key lacks the "${scope}" scope.`, 403)
  // Last use is recorded at most once a minute per key.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id))
  }
  return { keyId: row.id, workspaceId: row.workspaceId, role: isRole(row.role) ? row.role : 'viewer', scopes }
}
