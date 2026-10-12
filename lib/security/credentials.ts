import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Data source credential encryption (AES-256-GCM).
 *
 * Credentials are stored in `data_sources.credentials` (JSONB) as an envelope:
 *   { "__enc": "v2", "kid": <master key id>, "ws": <workspace id>, "iv": <b64>, "tag": <b64>, "data": <b64> }
 *
 * Envelope encryption per workspace (GV-4): each workspace has its own data
 * key, derived from the master key with HKDF-SHA256 (info = workspace id), so
 * no two workspaces share a key and a master-key rotation re-keys every
 * workspace. The data source id and workspace id are bound as additional
 * authenticated data (AAD): a ciphertext copied onto another row or into
 * another workspace fails to decrypt. Older "v1" envelopes (master key used
 * directly) are still read; reencrypt-credentials upgrades them to v2.
 *
 * Keys (32 random bytes, base64):
 *   NEXUS_ENCRYPTION_KEY           current key; all new writes use it
 *   NEXUS_ENCRYPTION_KEY_PREVIOUS  optional, comma-separated retired keys, used
 *                                  only to read rows not yet re-encrypted
 * `kid` is the first 16 hex chars of SHA-256(key), so it identifies a key
 * without revealing it. Envelopes written before key ids existed have no kid
 * and are tried against every configured key.
 *
 * Rotation: set the new key as NEXUS_ENCRYPTION_KEY and the old one in
 * NEXUS_ENCRYPTION_KEY_PREVIOUS, deploy, run
 * `scripts/reencrypt-credentials.mjs --apply`, then drop the previous key.
 * Generate a key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Server-only. Never import this from a client component.
 */

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v2'
const LEGACY = 'v1'

export type StoredCredentials = Record<string, unknown>

export interface EncryptedEnvelope {
  __enc: typeof VERSION | typeof LEGACY
  kid?: string
  /** v2: workspace whose data key sealed it. */
  ws?: string
  iv: string
  tag: string
  data: string
}

interface Key {
  id: string
  bytes: Buffer
}

function parseKey(raw: string, name: string): Key {
  const bytes = Buffer.from(raw.trim(), 'base64')
  if (bytes.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded.`)
  return { id: createHash('sha256').update(bytes).digest('hex').slice(0, 16), bytes }
}

function currentKey(): Key {
  const raw = process.env.NEXUS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('NEXUS_ENCRYPTION_KEY is not set. Data source credentials cannot be encrypted or read.')
  }
  return parseKey(raw, 'NEXUS_ENCRYPTION_KEY')
}

/** Current key first, then retired keys. */
function allKeys(): Key[] {
  const previous = (process.env.NEXUS_ENCRYPTION_KEY_PREVIOUS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => parseKey(k, 'NEXUS_ENCRYPTION_KEY_PREVIOUS'))
  return [currentKey(), ...previous]
}

/** Id of the key new credentials are sealed with. */
export function currentKeyId() {
  return currentKey().id
}

function aadFor(sourceId: string, workspaceId?: string) {
  return Buffer.from(workspaceId ? `data_sources:${sourceId}:workspace:${workspaceId}` : `data_sources:${sourceId}`, 'utf8')
}

/** The workspace's data key: HKDF-SHA256(master key, info = workspace id). */
function workspaceKey(master: Key, workspaceId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master.bytes, Buffer.from('kmplus-nexus/workspace-data-key'), Buffer.from(workspaceId, 'utf8'), 32))
}

export function isEncryptedCredentials(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== 'object') return false
  const env = value as { __enc?: unknown; data?: unknown; ws?: unknown }
  return (env.__enc === VERSION && typeof env.ws === 'string' || env.__enc === LEGACY) && typeof env.data === 'string'
}

/** True when a stored value is plaintext, a v1 envelope, or sealed with a key other than the current one. */
export function needsReencryption(stored: unknown) {
  return !isEncryptedCredentials(stored) || stored.__enc !== VERSION || stored.kid !== currentKeyId()
}

export function encryptCredentials(sourceId: string, credentials: StoredCredentials, workspaceId: string): EncryptedEnvelope {
  if (!workspaceId) throw new Error('encryptCredentials needs the workspace id')
  const key = currentKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, workspaceKey(key, workspaceId), iv)
  cipher.setAAD(aadFor(sourceId, workspaceId))
  const data = Buffer.concat([cipher.update(JSON.stringify(credentials ?? {}), 'utf8'), cipher.final()])
  return {
    __enc: VERSION,
    kid: key.id,
    ws: workspaceId,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

function tryDecrypt(key: Key, sourceId: string, stored: EncryptedEnvelope): StoredCredentials | null {
  try {
    const v2 = stored.__enc === VERSION
    const decipher = createDecipheriv(ALGORITHM, v2 ? workspaceKey(key, stored.ws!) : key.bytes, Buffer.from(stored.iv, 'base64'))
    decipher.setAAD(aadFor(sourceId, v2 ? stored.ws : undefined))
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'))
    const plain = Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()])
    return JSON.parse(plain.toString('utf8')) as StoredCredentials
  } catch {
    return null
  }
}

/**
 * Returns plaintext credentials for a stored value. Legacy rows saved before
 * encryption (plain objects) are returned as-is so they keep working until
 * `scripts/reencrypt-credentials.mjs` re-saves them encrypted.
 */
export function decryptCredentials(sourceId: string, stored: unknown, expectedWorkspaceId?: string): StoredCredentials {
  if (!stored || typeof stored !== 'object') return {}
  if (!isEncryptedCredentials(stored)) return stored as StoredCredentials
  if (expectedWorkspaceId && stored.ws && stored.ws !== expectedWorkspaceId) throw new Error('Stored credentials belong to another workspace.')

  const keys = allKeys()
  const candidates = stored.kid ? keys.filter((k) => k.id === stored.kid) : keys
  if (stored.kid && !candidates.length) {
    throw new Error(
      `Stored credentials were encrypted with a key (${stored.kid}) that is not configured. Add it to NEXUS_ENCRYPTION_KEY_PREVIOUS or re-enter the credentials for this data source.`
    )
  }
  for (const key of candidates) {
    const plain = tryDecrypt(key, sourceId, stored)
    if (plain) return plain
  }
  throw new Error('Stored credentials could not be decrypted. Re-enter the credentials for this data source.')
}

// ── SSO provider secrets ─────────────────────────────────────────────────────

/**
 * SSO provider secrets at rest (TD-25). `ssoProvider.oidcConfig` / `samlConfig`
 * are JSON the Better Auth SSO plugin reads; Nexus stores their secret fields
 * (the OIDC client secret, a SAML signing key) sealed in `__sealed` with the
 * workspace's data key, bound to the provider id. lib/auth/sso-config-plugin.ts
 * opens them when Better Auth reads the row, so the plugin sees plain config
 * and a database dump shows no secrets.
 */

export const SSO_SECRET_FIELDS = ['clientSecret', 'privateKey', 'decryptionPvk'] as const
const SEALED = '__sealed'

const bindingId = (providerId: string) => `sso:${providerId}`

/** Config JSON for the database: secret fields removed and sealed for the workspace. */
export function sealSsoConfig(providerId: string, workspaceId: string, config: Record<string, unknown>): string {
  const { [SEALED]: _old, ...plain } = config
  const secrets: Record<string, unknown> = {}
  for (const field of SSO_SECRET_FIELDS) {
    if (typeof plain[field] === 'string' && plain[field]) secrets[field] = plain[field]
    delete plain[field]
  }
  if (!Object.keys(secrets).length) return JSON.stringify(plain)
  return JSON.stringify({ ...plain, [SEALED]: encryptCredentials(bindingId(providerId), secrets, workspaceId) })
}

/** Plain config (secrets restored) from stored JSON; JSON without sealed secrets is returned unchanged. */
export function openSsoConfig(providerId: string, stored: string): Record<string, unknown> {
  const config = JSON.parse(stored) as Record<string, unknown>
  const sealed = config[SEALED]
  if (!sealed) return config
  const { [SEALED]: _sealed, ...rest } = config
  return { ...rest, ...decryptCredentials(bindingId(providerId), sealed) }
}

/** Same as openSsoConfig, returning JSON (what the plugin parses). Unreadable or non-JSON values pass through. */
export function openSsoConfigJson(providerId: string, stored: string): string {
  if (!stored.includes(SEALED)) return stored
  return JSON.stringify(openSsoConfig(providerId, stored))
}

/** True when stored config has a plaintext secret, or secrets sealed with an old key or envelope version. */
export function ssoConfigNeedsSealing(stored: string | null): boolean {
  if (!stored) return false
  let config: Record<string, unknown>
  try {
    config = JSON.parse(stored) as Record<string, unknown>
  } catch {
    return false
  }
  if (SSO_SECRET_FIELDS.some((f) => typeof config[f] === 'string' && config[f])) return true
  const sealed = config[SEALED]
  return Boolean(sealed) && (!isEncryptedCredentials(sealed) || needsReencryption(sealed as EncryptedEnvelope))
}
