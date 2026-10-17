import type { ConnectorCredentials, ConnectionTestResult, SchemaScanResult, SchemaTable } from '../types'
import { configError, flattenRow, inferColumns, request, requestJson, sampleResult, scanResult, type Row } from '../http'
import { azureAccessToken } from '@/lib/net/cloud-auth'
import { fileTables, normalizePrefix, parseFile, MAX_FILE_BYTES, type StorageClient, type StorageObject } from '../storage/files'

/**
 * Microsoft 365 / SharePoint Online through Microsoft Graph, read-only, with an
 * app registration (application permission Sites.Read.All, or Sites.Selected
 * granted on the site). Tables:
 * - `lists/<list name>`: the items of each SharePoint list (custom columns as fields);
 * - `files/<path>`: CSV / TSV / JSON / NDJSON / Excel files in the site's
 *   document library (or a named library), folders of one format as `files/<dir>/*.csv`.
 */

const LIST_PREFIX = 'lists/'
const FILE_PREFIX = 'files/'
const MAX_LIST_ITEMS = 200_000
const MAX_DEPTH = 6
/** Graph adds these to every list item. */
const SYSTEM_FIELDS = new Set(['@odata.etag', 'ContentType', 'Attachments', 'Edit', 'LinkTitleNoMenu', 'LinkTitle', 'DocIcon', 'ItemChildCount', 'FolderChildCount', '_UIVersionString', '_ComplianceFlags', '_ComplianceTag', '_ComplianceTagWrittenTime', '_ComplianceTagUserId', 'AppAuthorLookupId', 'AppEditorLookupId'])

interface Settings {
  graph: string
  hostname: string
  sitePath: string
  library: string
  prefix: string
  token: () => Promise<string>
}

function settings(c: ConnectorCredentials): Settings {
  let site: URL
  try {
    site = new URL((c.siteUrl ?? '').trim())
  } catch {
    throw configError('Enter the SharePoint site URL, e.g. https://contoso.sharepoint.com/sites/HR.')
  }
  const graph = (c.graphEndpoint?.trim() || 'https://graph.microsoft.com').replace(/\/+$/, '')
  return {
    graph,
    hostname: site.hostname,
    sitePath: site.pathname.replace(/\/+$/, ''),
    library: c.library?.trim() ?? '',
    prefix: normalizePrefix(c.folder),
    token: () => azureAccessToken({ tenantId: c.tenantId?.trim() ?? '', clientId: c.clientId?.trim() ?? '', clientSecret: c.clientSecret ?? '', scope: `${graph}/.default`, authorityHost: c.authorityHost }),
  }
}

async function graphGet<T>(s: Settings, pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${s.graph}/v1.0${pathOrUrl}`
  if (!url.startsWith(s.graph)) throw configError('Microsoft Graph returned a link outside its own address.')
  try {
    return await requestJson<T>('Microsoft Graph', url, { headers: { authorization: `Bearer ${await s.token()}`, accept: 'application/json' } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/HTTP 404/.test(msg)) throw configError('Microsoft Graph: the site, list or library was not found. Check the site URL and that the app has access to the site.')
    throw err
  }
}

/** Every page of a Graph collection (follows @odata.nextLink). */
async function graphAll<T>(s: Settings, path: string, max: number): Promise<T[]> {
  const out: T[] = []
  let next: string | undefined = path
  while (next && out.length < max) {
    const page: { value?: T[]; '@odata.nextLink'?: string } = await graphGet(s, next)
    out.push(...(page.value ?? []))
    next = page['@odata.nextLink']
  }
  return out.slice(0, max)
}

const siteCache = new Map<string, { id: string; at: number }>()
async function siteId(s: Settings) {
  const key = `${s.graph}|${s.hostname}|${s.sitePath}`
  const hit = siteCache.get(key)
  if (hit && hit.at > Date.now() - 10 * 60_000) return hit.id
  const site = await graphGet<{ id: string }>(s, s.sitePath ? `/sites/${s.hostname}:${encodeURI(s.sitePath)}` : `/sites/${s.hostname}`)
  siteCache.set(key, { id: site.id, at: Date.now() })
  return site.id
}

interface GraphList {
  id: string
  displayName: string
  list?: { hidden?: boolean; template?: string }
}

async function lists(s: Settings) {
  const all = await graphAll<GraphList>(s, `/sites/${await siteId(s)}/lists?$select=id,displayName,list`, 1000)
  return all.filter((l) => !l.list?.hidden && l.list?.template !== 'documentLibrary')
}

async function driveId(s: Settings) {
  const site = await siteId(s)
  if (!s.library) return (await graphGet<{ id: string }>(s, `/sites/${site}/drive?$select=id`)).id
  const drives = await graphAll<{ id: string; name: string }>(s, `/sites/${site}/drives?$select=id,name`, 200)
  const found = drives.find((d) => d.name.toLowerCase() === s.library.toLowerCase())
  if (!found) throw configError(`No document library "${s.library}" on the site. Libraries: ${drives.map((d) => d.name).join(', ') || 'none'}.`)
  return found.id
}

interface DriveItem {
  name: string
  size?: number
  lastModifiedDateTime?: string
  folder?: unknown
  file?: unknown
  '@microsoft.graph.downloadUrl'?: string
}

/** The document library as a StorageClient (paths relative to the library root). */
function libraryClient(s: Settings): StorageClient {
  const label = 'SharePoint document library'
  const downloads = new Map<string, string>()
  return {
    label,
    async list(prefix, max) {
      const drive = await driveId(s)
      const out: StorageObject[] = []
      const walk = async (folder: string, depth: number) => {
        if (out.length >= max || depth > MAX_DEPTH) return
        const path = folder.replace(/\/+$/, '')
        const items = await graphAll<DriveItem>(s, path ? `/drives/${drive}/root:/${encodeURI(path)}:/children?$top=200` : `/drives/${drive}/root/children?$top=200`, max)
        for (const item of items) {
          const key = `${path ? `${path}/` : ''}${item.name}`
          if (item.folder) await walk(key, depth + 1)
          else if (item.file) {
            out.push({ key, size: item.size ?? 0, modified: item.lastModifiedDateTime ?? null })
            if (item['@microsoft.graph.downloadUrl']) downloads.set(key, item['@microsoft.graph.downloadUrl'])
          }
        }
      }
      await walk(prefix, 0)
      return out.slice(0, max)
    },
    async get(key, range) {
      const drive = await driveId(s)
      // The pre-authenticated download link from the listing, or the content endpoint (which redirects to one).
      const url = downloads.get(key) ?? (await graphGet<DriveItem>(s, `/drives/${drive}/root:/${encodeURI(key)}?$select=name,@microsoft.graph.downloadUrl`))['@microsoft.graph.downloadUrl']
      if (!url) throw configError(`${key} has no download link.`)
      const res = await request(label, url, { headers: range ? { range: `bytes=${range[0]}-${range[1]}` } : {}, timeoutMs: 120_000 })
      if (!res.ok && res.status !== 206) throw Object.assign(new Error(`${label}: HTTP ${res.status} reading ${key}`), { retryable: res.status >= 500 || res.status === 429 })
      return Buffer.from(await res.arrayBuffer())
    },
  }
}

const fieldsRow = (fields: Record<string, unknown> | undefined): Row => {
  const out: Row = {}
  for (const [k, v] of Object.entries(fields ?? {})) if (!SYSTEM_FIELDS.has(k) && !k.startsWith('@odata')) out[k] = v
  return flattenRow(out)
}

async function listRows(s: Settings, name: string, max: number): Promise<Row[]> {
  const list = (await lists(s)).find((l) => l.displayName === name)
  if (!list) throw configError(`No list "${name}" on the site. Test the data source again to refresh its tables.`)
  const items = await graphAll<{ id: string; fields?: Record<string, unknown> }>(s, `/sites/${await siteId(s)}/lists/${list.id}/items?$expand=fields&$top=200`, Math.min(max, MAX_LIST_ITEMS))
  return items.map((i) => ({ id: i.id, ...fieldsRow(i.fields) }))
}

async function fileRows(s: Settings, table: string, max: number): Promise<Row[]> {
  const client = libraryClient(s)
  const t = fileTables(await client.list(s.prefix, 5000), s.prefix).find((x) => x.name === table)
  if (!t) throw configError(`No file or folder "${table}" in the document library. Test the data source again to refresh its tables.`)
  const rows: Row[] = []
  for (const key of t.keys) {
    if (rows.length >= max) break
    const bytes = await client.get(key)
    if (bytes.length > MAX_FILE_BYTES) throw configError(`${key} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
    const part = await parseFile(t.format, bytes, max - rows.length)
    rows.push(...(t.keys.length > 1 ? part.map((r) => ({ ...r, _source_file: key })) : part))
  }
  return rows
}

async function readTable(c: ConnectorCredentials, table: string, max: number): Promise<Row[]> {
  const s = settings(c)
  if (table.startsWith(LIST_PREFIX)) return listRows(s, table.slice(LIST_PREFIX.length), max)
  if (table.startsWith(FILE_PREFIX)) return fileRows(s, table.slice(FILE_PREFIX.length), max)
  throw configError(`Unknown table "${table}": SharePoint tables start with lists/ or files/.`)
}

export async function testSharePointConnection(c: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const s = settings(c)
    await siteId(s)
    const found = await lists(s)
    const files = fileTables(await libraryClient(s).list(s.prefix, 5000), s.prefix)
    return { ok: true, message: `Connected to the SharePoint site: ${found.length} lists, ${files.length} readable files and folders.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'SharePoint connection failed.' }
  }
}

export async function scanSharePointSchema(c: ConnectorCredentials): Promise<SchemaScanResult> {
  const s = settings(c)
  const tables: SchemaTable[] = []
  for (const [i, l] of (await lists(s)).entries()) {
    const rows = i < 40 ? await listRows(s, l.displayName, 50).catch(() => []) : []
    tables.push({ schema: 'sharepoint', name: `${LIST_PREFIX}${l.displayName}`, columns: inferColumns(rows), rowCount: null })
  }
  const client = libraryClient(s)
  for (const [i, t] of fileTables(await client.list(s.prefix, 5000), s.prefix).entries()) {
    const rows = i < 40 && t.size <= MAX_FILE_BYTES ? await client.get(t.keys[0]).then((b) => parseFile(t.format, b, 50)).catch(() => []) : []
    tables.push({ schema: 'sharepoint', name: `${FILE_PREFIX}${t.name}`, columns: [...inferColumns(rows), ...(t.keys.length > 1 ? [{ name: '_source_file', type: 'TEXT', nullable: false }] : [])], rowCount: null })
  }
  return scanResult(tables, 'microsoft-graph')
}

export async function sampleSharePointTable(c: ConnectorCredentials, table: string, limit = 25) {
  return sampleResult(table, await readTable(c, table, limit), limit)
}

export const readSharePointRows = (c: ConnectorCredentials, table: string, maxRows: number) => readTable(c, table, maxRows)
