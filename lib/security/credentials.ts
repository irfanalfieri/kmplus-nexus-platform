import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Data source credential encryption (AES-256-GCM).
 *
 * Credentials are stored in `data_sources.credentials` (JSONB) as an envelope:
 *   { "__enc": "v1", "kid": <key id>, "iv": <b64>, "tag": <b64>, "data": <b64> }
 *
 * The data source id is bound as additional authenticated data (AAD), so a
 * ciphertext copied onto another row fails to decrypt.
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
const VERSION = 'v1'

export type StoredCredentials = Record<string, unknown>

interface EncryptedEnvelope {
  __enc: typeof VERSION
  kid?: string
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

function aadFor(sourceId: string) {
  return Buffer.from(`data_sources:${sourceId}`, 'utf8')
}

export function isEncryptedCredentials(value: unknown): value is EncryptedEnvelope {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { __enc?: unknown }).__enc === VERSION &&
    typeof (value as EncryptedEnvelope).data === 'string'
  )
}

/** True when a stored value is plaintext or sealed with a key other than the current one. */
export function needsReencryption(stored: unknown) {
  return !isEncryptedCredentials(stored) || stored.kid !== currentKeyId()
}

export function encryptCredentials(sourceId: string, credentials: StoredCredentials): EncryptedEnvelope {
  const key = currentKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key.bytes, iv)
  cipher.setAAD(aadFor(sourceId))
  const data = Buffer.concat([cipher.update(JSON.stringify(credentials ?? {}), 'utf8'), cipher.final()])
  return {
    __enc: VERSION,
    kid: key.id,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

function tryDecrypt(key: Key, sourceId: string, stored: EncryptedEnvelope): StoredCredentials | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key.bytes, Buffer.from(stored.iv, 'base64'))
    decipher.setAAD(aadFor(sourceId))
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
export function decryptCredentials(sourceId: string, stored: unknown): StoredCredentials {
  if (!stored || typeof stored !== 'object') return {}
  if (!isEncryptedCredentials(stored)) return stored as StoredCredentials

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
