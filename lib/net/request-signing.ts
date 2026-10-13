import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed connector requests: lets a company's API gateway admit only Nexus
 * when an intranet API is published for Nexus by hand (no Nexus Agent).
 * See docs/integrations/intranet-apis.md.
 *
 *   X-Nexus-Timestamp: <unix seconds>
 *   X-Nexus-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<METHOD>.<path?query>.<hex SHA-256 of body>")>
 *
 * The gateway recomputes the signature with the shared secret and rejects
 * requests older than 5 minutes.
 */

export const SIGNATURE_HEADER = 'X-Nexus-Signature'
export const TIMESTAMP_HEADER = 'X-Nexus-Timestamp'
export const MAX_SIGNATURE_AGE_SECONDS = 300

const sha256Hex = (body: string | Uint8Array) => createHash('sha256').update(body).digest('hex')

export function signaturePayload(timestamp: string, method: string, url: string | URL, body: string | Uint8Array = '') {
  const u = typeof url === 'string' ? new URL(url) : url
  return `${timestamp}.${method.toUpperCase()}.${u.pathname}${u.search}.${sha256Hex(body)}`
}

/** Headers to add to a request signed with `secret`. */
export function signRequest(secret: string, method: string, url: string | URL, body: string | Uint8Array = '', now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000))
  const signature = createHmac('sha256', secret).update(signaturePayload(timestamp, method, url, body)).digest('hex')
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: `v1=${signature}` }
}

/** Reference check for gateways and tests: true when the signature matches and is recent. */
export function verifyRequestSignature(opts: {
  secret: string
  method: string
  url: string | URL
  body?: string | Uint8Array
  timestamp: string | null
  signature: string | null
  now?: number
}) {
  const { secret, method, url, body = '', timestamp, signature, now = Date.now() } = opts
  if (!timestamp || !signature?.startsWith('v1=') || !/^\d+$/.test(timestamp)) return false
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SIGNATURE_AGE_SECONDS) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(signaturePayload(timestamp, method, url, body)).digest('hex'))
  const given = Buffer.from(signature.slice(3))
  return expected.length === given.length && timingSafeEqual(expected, given)
}
