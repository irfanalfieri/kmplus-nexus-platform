import { createHmac } from 'node:crypto'
import type { ConnectorCredentials } from '../types'
import { configError, request } from '../http'
import { normalizePrefix, readStorage, sampleStorage, scanStorage, testStorage, xmlBlocks, xmlText, type StorageClient } from '../storage/files'

/**
 * Azure Blob Storage (and Azure Data Lake Storage Gen2 containers), read-only,
 * with a SAS token (preferred: read + list on one container) or the account
 * key (Shared Key signing). Files become tables (lib/connectors/storage/files.ts).
 */

const VERSION = '2021-08-06'

function settings(credentials: ConnectorCredentials) {
  const account = credentials.account?.trim() ?? ''
  const container = credentials.container?.trim() ?? ''
  if (!account || !container) throw configError('Enter the storage account and container names.')
  const endpoint = (credentials.endpoint?.trim() || `https://${account}.blob.core.windows.net`).replace(/\/+$/, '')
  const sas = credentials.sasToken?.trim().replace(/^\?/, '') ?? ''
  const key = credentials.accountKey?.trim() ?? ''
  return { account, container, endpoint, sas, key, prefix: normalizePrefix(credentials.prefix) }
}

/** Shared Key Authorization for a GET (Blob service, version 2015-02-21+). */
export function sharedKeyAuthorization(opts: { account: string; key: string; url: URL; headers: Record<string, string> }) {
  const h = Object.fromEntries(Object.entries(opts.headers).map(([k, v]) => [k.toLowerCase(), v]))
  const canonicalHeaders = Object.keys(h)
    .filter((k) => k.startsWith('x-ms-'))
    .sort()
    .map((k) => `${k}:${h[k].trim()}\n`)
    .join('')
  const params = [...opts.url.searchParams.entries()].reduce<Record<string, string[]>>((acc, [k, v]) => ((acc[k.toLowerCase()] ??= []).push(v), acc), {})
  // The resource path is /account/<url path>; on Azurite-style endpoints the path already starts with the account.
  const path = opts.url.pathname.startsWith(`/${opts.account}/`) ? opts.url.pathname : `/${opts.account}${opts.url.pathname}`
  const canonicalResource = path + Object.keys(params).sort().map((k) => `\n${k}:${params[k].sort().join(',')}`).join('')
  const stringToSign = ['GET', '', '', '', '', '', '', '', '', '', '', h.range ?? '', canonicalHeaders + canonicalResource].join('\n')
  const signature = createHmac('sha256', Buffer.from(opts.key, 'base64')).update(stringToSign, 'utf8').digest('base64')
  return `SharedKey ${opts.account}:${signature}`
}

export function azureBlobClient(credentials: ConnectorCredentials): StorageClient {
  const s = settings(credentials)
  if (!s.sas && !s.key) throw configError('Enter a SAS token or the account key.')
  const label = `Azure container ${s.container}`
  const send = async (raw: string, extra: Record<string, string> = {}) => {
    const url = new URL(raw)
    const headers: Record<string, string> = { 'x-ms-version': VERSION, 'x-ms-date': new Date().toUTCString(), ...extra }
    if (s.sas) for (const [k, v] of new URLSearchParams(s.sas)) url.searchParams.set(k, v)
    else headers.authorization = sharedKeyAuthorization({ account: s.account, key: s.key, url, headers })
    const res = await request(label, url.toString(), { headers, timeoutMs: 120_000 })
    if (res.ok || res.status === 206) return res
    const text = await res.text()
    const code = xmlText(text, 'Code') ?? `HTTP ${res.status}`
    if (res.status === 403 || res.status === 404 || res.status === 400) throw configError(`${label}: ${code}`)
    throw Object.assign(new Error(`${label}: ${code}`), { retryable: true })
  }
  const base = `${s.endpoint}/${encodeURIComponent(s.container)}`
  return {
    label,
    async list(prefix, max) {
      const out: { key: string; size: number; modified: string | null }[] = []
      let marker = ''
      do {
        const q = new URLSearchParams({ restype: 'container', comp: 'list', prefix, maxresults: '1000', ...(marker ? { marker } : {}) })
        const xml = await (await send(`${base}?${q.toString()}`)).text()
        for (const b of xmlBlocks(xml, 'Blob')) out.push({ key: xmlText(b, 'Name') ?? '', size: Number(xmlText(b, 'Content-Length') ?? 0), modified: xmlText(b, 'Last-Modified') })
        marker = xmlText(xml, 'NextMarker') ?? ''
      } while (marker && out.length < max)
      return out.slice(0, max)
    },
    async get(key, range) {
      const res = await send(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`, range ? { 'x-ms-range': `bytes=${range[0]}-${range[1]}` } : {})
      return Buffer.from(await res.arrayBuffer())
    },
  }
}

export const testAzureBlobConnection = (c: ConnectorCredentials) => testStorage(azureBlobClient(c), settings(c).prefix)
export const scanAzureBlobSchema = (c: ConnectorCredentials) => scanStorage(azureBlobClient(c), settings(c).prefix, 'azure-blob-list')
export const sampleAzureBlobTable = (c: ConnectorCredentials, table: string, limit = 25) => sampleStorage(azureBlobClient(c), settings(c).prefix, table, limit)
export const readAzureBlobRows = (c: ConnectorCredentials, table: string, maxRows: number) => readStorage(azureBlobClient(c), settings(c).prefix, table, maxRows)
