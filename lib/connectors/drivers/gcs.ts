import type { ConnectorCredentials } from '../types'
import { configError, request } from '../http'
import { googleAccessToken, parseServiceAccount } from '@/lib/net/cloud-auth'
import { normalizePrefix, readStorage, sampleStorage, scanStorage, testStorage, type StorageClient } from '../storage/files'

/**
 * Google Cloud Storage, read-only, through a service account key (role
 * "Storage Object Viewer" on the bucket); without a key, a public bucket is
 * read anonymously. Files become tables (lib/connectors/storage/files.ts).
 */

const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only'

function settings(credentials: ConnectorCredentials) {
  const bucket = credentials.bucket?.trim() ?? ''
  if (!bucket) throw configError('Enter the bucket name.')
  const api = (credentials.apiEndpoint?.trim() || 'https://storage.googleapis.com').replace(/\/+$/, '')
  const sa = credentials.serviceAccountJson?.trim() ? parseServiceAccount(credentials.serviceAccountJson) : null
  return { bucket, api, sa, prefix: normalizePrefix(credentials.prefix) }
}

export function gcsClient(credentials: ConnectorCredentials): StorageClient {
  const s = settings(credentials)
  const label = `Cloud Storage bucket ${s.bucket}`
  const send = async (url: string, extra: Record<string, string> = {}) => {
    const headers = { ...extra, ...(s.sa ? { authorization: `Bearer ${await googleAccessToken(s.sa, SCOPE)}` } : {}) }
    const res = await request(label, url, { headers, timeoutMs: 120_000 })
    if (res.ok || res.status === 206) return res
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    const msg = body.error?.message ?? `HTTP ${res.status}`
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 400) throw configError(`${label}: ${msg}`)
    throw Object.assign(new Error(`${label}: ${msg}`), { retryable: true })
  }
  const base = `${s.api}/storage/v1/b/${encodeURIComponent(s.bucket)}/o`
  return {
    label,
    async list(prefix, max) {
      const out: { key: string; size: number; modified: string | null }[] = []
      let token = ''
      do {
        const q = new URLSearchParams({ prefix, maxResults: '1000', fields: 'items(name,size,updated),nextPageToken', ...(token ? { pageToken: token } : {}) })
        const page = (await (await send(`${base}?${q.toString()}`)).json()) as { items?: { name: string; size: string; updated?: string }[]; nextPageToken?: string }
        out.push(...(page.items ?? []).map((i) => ({ key: i.name, size: Number(i.size), modified: i.updated ?? null })))
        token = page.nextPageToken ?? ''
      } while (token && out.length < max)
      return out.slice(0, max)
    },
    async get(key, range) {
      const res = await send(`${base}/${encodeURIComponent(key)}?alt=media`, range ? { range: `bytes=${range[0]}-${range[1]}` } : {})
      return Buffer.from(await res.arrayBuffer())
    },
  }
}

export const testGcsConnection = (c: ConnectorCredentials) => testStorage(gcsClient(c), settings(c).prefix)
export const scanGcsSchema = (c: ConnectorCredentials) => scanStorage(gcsClient(c), settings(c).prefix, 'gcs-list-objects')
export const sampleGcsTable = (c: ConnectorCredentials, table: string, limit = 25) => sampleStorage(gcsClient(c), settings(c).prefix, table, limit)
export const readGcsRows = (c: ConnectorCredentials, table: string, maxRows: number) => readStorage(gcsClient(c), settings(c).prefix, table, maxRows)
