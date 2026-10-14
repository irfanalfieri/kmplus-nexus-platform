import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4 (no SDK): signs requests to S3 and S3-compatible
 * storage (MinIO, Cloudflare R2, Wasabi, DigitalOcean Spaces …) and to AWS
 * Secrets Manager. Pure apart from the clock; checked against AWS's published
 * example in scripts/engine-tests.ts.
 */

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

/** RFC 3986: everything but A-Z a-z 0-9 - _ . ~ is percent-encoded. */
export const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

function canonicalPath(pathname: string, service: string) {
  // S3 encodes each segment once; other services encode the already-encoded path again.
  const segments = pathname.split('/').map((seg) => {
    const once = rfc3986(decodeURIComponent(seg))
    return service === 's3' ? once : rfc3986(once)
  })
  return segments.join('/') || '/'
}

function canonicalQuery(url: URL) {
  return [...url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

export const amzDate = (d: Date) => d.toISOString().replace(/[:-]|\.\d{3}/g, '')

/**
 * Headers to send: the given ones plus host, x-amz-date, x-amz-content-sha256
 * (S3), x-amz-security-token (temporary credentials) and Authorization.
 */
export function signAwsRequest(opts: {
  method: string
  url: string | URL
  region: string
  service: string
  credentials: AwsCredentials
  headers?: Record<string, string>
  body?: string | Uint8Array
  now?: Date
}): Record<string, string> {
  const url = typeof opts.url === 'string' ? new URL(opts.url) : opts.url
  const now = opts.now ?? new Date()
  const stamp = amzDate(now)
  const day = stamp.slice(0, 8)
  const payloadHash = sha256(opts.body ?? '')
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  headers.host = url.host
  headers['x-amz-date'] = stamp
  if (opts.service === 's3') headers['x-amz-content-sha256'] = payloadHash
  if (opts.credentials.sessionToken) headers['x-amz-security-token'] = opts.credentials.sessionToken

  const lower = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const signedHeaders = lower.map(([k]) => k).join(';')
  const canonicalRequest = [
    opts.method.toUpperCase(),
    canonicalPath(url.pathname, opts.service),
    canonicalQuery(url),
    lower.map(([k, v]) => `${k}:${v}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n')
  const scope = `${day}/${opts.region}/${opts.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n')
  const kDate = hmac(`AWS4${opts.credentials.secretAccessKey}`, day)
  const kRegion = hmac(kDate, opts.region)
  const kService = hmac(kRegion, opts.service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${opts.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return headers
}
