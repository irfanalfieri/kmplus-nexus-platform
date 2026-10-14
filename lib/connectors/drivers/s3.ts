import type { ConnectorCredentials } from '../types'
import { configError, request } from '../http'
import { signAwsRequest } from '@/lib/net/aws-sigv4'
import { normalizePrefix, readStorage, sampleStorage, scanStorage, testStorage, xmlBlocks, xmlText, type StorageClient } from '../storage/files'

/**
 * Amazon S3 and S3-compatible storage (MinIO, Cloudflare R2, Wasabi,
 * DigitalOcean Spaces, Backblaze B2, Supabase Storage …), read-only, signed
 * with Signature V4. Without keys, a public bucket is read anonymously. Files
 * become tables (lib/connectors/storage/files.ts). An S3 in a private network
 * (MinIO on premises) is reached through a Nexus Agent.
 */

function settings(credentials: ConnectorCredentials) {
  const bucket = credentials.bucket?.trim() ?? ''
  if (!bucket) throw configError('Enter the bucket name.')
  const region = credentials.region?.trim() || 'us-east-1'
  const custom = credentials.endpoint?.trim().replace(/\/+$/, '')
  if (custom && !/^https?:\/\//i.test(custom)) throw configError('The endpoint must start with http:// or https://')
  // Custom endpoints (MinIO …) use path-style URLs unless told otherwise; AWS uses virtual-hosted style.
  const pathStyle = credentials.forcePathStyle?.trim() ? credentials.forcePathStyle.trim().toLowerCase() === 'true' : Boolean(custom)
  const endpoint = custom || `https://s3.${region}.amazonaws.com`
  const base = pathStyle ? `${endpoint}/${encodeURIComponent(bucket)}` : endpoint.replace('://', `://${bucket}.`)
  const accessKeyId = credentials.accessKeyId?.trim() ?? ''
  const secretAccessKey = credentials.secretAccessKey?.trim() ?? ''
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw configError('Enter both the access key ID and the secret access key (or neither, for a public bucket).')
  return { bucket, region, base, prefix: normalizePrefix(credentials.prefix), aws: accessKeyId ? { accessKeyId, secretAccessKey, sessionToken: credentials.sessionToken?.trim() || undefined } : null }
}

const objectPath = (key: string) => key.split('/').map(encodeURIComponent).join('/')

export function s3Client(credentials: ConnectorCredentials): StorageClient {
  const s = settings(credentials)
  const label = `S3 bucket ${s.bucket}`
  const send = async (url: string, extra: Record<string, string> = {}) => {
    const headers = s.aws ? signAwsRequest({ method: 'GET', url, region: s.region, service: 's3', credentials: s.aws, headers: extra }) : extra
    const res = await request(label, url, { headers, timeoutMs: 120_000 })
    if (res.ok || res.status === 206) return res
    const text = await res.text()
    const code = xmlText(text, 'Code') ?? `HTTP ${res.status}`
    const message = xmlText(text, 'Message')
    if (res.status === 403 || res.status === 401 || res.status === 404 || res.status === 400 || res.status === 301) throw configError(`${label}: ${code}${message ? ` (${message})` : ''}`)
    throw Object.assign(new Error(`${label}: ${code}`), { retryable: true })
  }
  return {
    label,
    async list(prefix, max) {
      const out: { key: string; size: number; modified: string | null }[] = []
      let token: string | null = null
      do {
        const q: URLSearchParams = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) })
        const xml: string = await (await send(`${s.base}/?${q.toString()}`)).text()
        for (const c of xmlBlocks(xml, 'Contents')) out.push({ key: xmlText(c, 'Key') ?? '', size: Number(xmlText(c, 'Size') ?? 0), modified: xmlText(c, 'LastModified') })
        token = xmlText(xml, 'IsTruncated') === 'true' ? xmlText(xml, 'NextContinuationToken') : null
      } while (token && out.length < max)
      return out.slice(0, max)
    },
    async get(key, range) {
      const res = await send(`${s.base}/${objectPath(key)}`, range ? { range: `bytes=${range[0]}-${range[1]}` } : {})
      return Buffer.from(await res.arrayBuffer())
    },
  }
}

export const testS3Connection = (c: ConnectorCredentials) => testStorage(s3Client(c), settings(c).prefix)
export const scanS3Schema = (c: ConnectorCredentials) => scanStorage(s3Client(c), settings(c).prefix, 's3-list-objects-v2')
export const sampleS3Table = (c: ConnectorCredentials, table: string, limit = 25) => sampleStorage(s3Client(c), settings(c).prefix, table, limit)
export const readS3Rows = (c: ConnectorCredentials, table: string, maxRows: number) => readStorage(s3Client(c), settings(c).prefix, table, maxRows)
