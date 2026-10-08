import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Data source credential encryption (AES-256-GCM).
 *
 * Credentials are stored in `data_sources.credentials` (JSONB) as an envelope:
 *   { "__enc": "v1", "iv": <b64>, "tag": <b64>, "data": <b64> }
 *
 * The data source id is bound as additional authenticated data (AAD), so a
 * ciphertext copied onto another row fails to decrypt.
 *
 * Key: `NEXUS_ENCRYPTION_KEY` = 32 random bytes, base64-encoded.
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Server-only. Never import this from a client component.
 */

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'

export type StoredCredentials = Record<string, unknown>

interface EncryptedEnvelope {
  __enc: typeof VERSION
  iv: string
  tag: string
  data: string
}

function getKey(): Buffer {
  const raw = process.env.NEXUS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('NEXUS_ENCRYPTION_KEY is not set. Data source credentials cannot be encrypted or read.')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('NEXUS_ENCRYPTION_KEY must be 32 bytes, base64-encoded.')
  }
  return key
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

export function encryptCredentials(sourceId: string, credentials: StoredCredentials): EncryptedEnvelope {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  cipher.setAAD(aadFor(sourceId))
  const data = Buffer.concat([cipher.update(JSON.stringify(credentials ?? {}), 'utf8'), cipher.final()])
  return {
    __enc: VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

/**
 * Returns plaintext credentials for a stored value. Legacy rows saved before
 * encryption (plain objects) are returned as-is so they keep working until
 * `scripts/encrypt-existing-credentials.mjs` re-saves them encrypted.
 */
export function decryptCredentials(sourceId: string, stored: unknown): StoredCredentials {
  if (!stored || typeof stored !== 'object') return {}
  if (!isEncryptedCredentials(stored)) return stored as StoredCredentials

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(stored.iv, 'base64'))
  decipher.setAAD(aadFor(sourceId))
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'))
  try {
    const plain = Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()])
    return JSON.parse(plain.toString('utf8')) as StoredCredentials
  } catch {
    throw new Error('Stored credentials could not be decrypted. Re-enter the credentials for this data source.')
  }
}
