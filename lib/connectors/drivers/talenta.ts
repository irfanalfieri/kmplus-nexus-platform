import { createHmac } from 'node:crypto'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult, SchemaTable } from '../types'

/**
 * Mekari Talenta (HRIS) via the Mekari API gateway with HMAC auth.
 * Auth: https://developers.mekari.com/docs/kb/hmac-authentication
 *   signing string = "date: <RFC 7231 date>\n<METHOD> <path?query> HTTP/1.1"
 *   Authorization: hmac username="<client id>", algorithm="hmac-sha256", headers="date request-line", signature="<base64>"
 * HMAC credentials are issued per company by Mekari support.
 */

const DEFAULT_BASE_URL = 'https://api.mekari.com'

/** Known Talenta list endpoints. Extra paths can be added via the "Additional endpoints" field. */
const BUILT_IN_OBJECTS: Record<string, string> = {
  employee: '/v2/talenta/v2/employee',
}

type Row = Record<string, unknown>

export function signMekariRequest(opts: { clientId: string; clientSecret: string; method: string; pathWithQuery: string; date?: Date }) {
  const date = (opts.date ?? new Date()).toUTCString()
  const requestLine = `${opts.method.toUpperCase()} ${opts.pathWithQuery} HTTP/1.1`
  const signature = createHmac('sha256', opts.clientSecret).update(`date: ${date}\n${requestLine}`).digest('base64')
  return {
    Date: date,
    Authorization: `hmac username="${opts.clientId}", algorithm="hmac-sha256", headers="date request-line", signature="${signature}"`,
  }
}

function config(credentials: ConnectorCredentials) {
  const clientId = credentials.clientId?.trim() ?? ''
  const clientSecret = credentials.clientSecret?.trim() ?? ''
  if (!clientId || !clientSecret) throw new Error('Talenta client ID and client secret are required.')
  const baseUrl = (credentials.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const objects: Record<string, string> = { ...BUILT_IN_OBJECTS }
  for (const raw of (credentials.endpoints ?? '').split(/[\n,]/)) {
    const path = raw.trim()
    if (!path) continue
    const name = path.replace(/\/+$/, '').split('/').pop()!.replace(/[^A-Za-z0-9_]/g, '_')
    objects[name] = path.startsWith('/') ? path : `/${path}`
  }
  const pageSize = Math.min(100, Math.max(1, Number(credentials.pageSize) || 50))
  return { clientId, clientSecret, baseUrl, objects, pageSize }
}

async function talentaGet(cfg: ReturnType<typeof config>, path: string, query: Record<string, string | number>) {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
  const pathWithQuery = qs ? `${path}?${qs}` : path
  const response = await fetch(`${cfg.baseUrl}${pathWithQuery}`, {
    headers: {
      ...signMekariRequest({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, method: 'GET', pathWithQuery }),
      Accept: 'application/json',
    },
    cache: 'no-store',
  })
  const text = await response.text()
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Talenta rejected the credentials (${response.status}). Check the HMAC client ID/secret and that the server clock is correct.`)
  }
  if (!response.ok) throw new Error(`Talenta ${path} returned ${response.status}: ${text.slice(0, 200)}`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`Talenta ${path} did not return JSON.`)
  }
}

/** Finds the record list in a response: the first array of objects, searched breadth-first. */
export function extractList(payload: unknown): Row[] {
  const queue: unknown[] = [payload]
  while (queue.length) {
    const node = queue.shift()
    if (Array.isArray(node)) {
      if (node.length === 0 || node.some((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        return node.filter((x) => x && typeof x === 'object') as Row[]
      }
    } else if (node && typeof node === 'object') {
      queue.push(...Object.values(node as Record<string, unknown>))
    }
  }
  return []
}

/** Flattens nested objects to dotted keys (personal.first_name); arrays stay as JSON values. */
export function flatten(row: Row, prefix = '', out: Row = {}): Row {
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v as Row, key, out)
    else out[key] = v
  }
  return out
}

async function readObject(cfg: ReturnType<typeof config>, object: string, maxRows: number): Promise<Row[]> {
  const path = cfg.objects[object]
  if (!path) throw new Error(`Unknown Talenta object "${object}". Known: ${Object.keys(cfg.objects).join(', ')}`)
  const rows: Row[] = []
  for (let page = 1; rows.length < maxRows && page <= 1000; page++) {
    const limit = Math.min(cfg.pageSize, maxRows - rows.length)
    const batch = extractList(await talentaGet(cfg, path, { limit, page }))
    rows.push(...batch.map((r) => flatten(r)))
    if (batch.length < limit) break
  }
  return rows.slice(0, maxRows)
}

export async function testTalentaConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const cfg = config(credentials)
    const rows = await readObject(cfg, 'employee', 1)
    return { ok: true, message: `Connected to Talenta (${rows.length ? 'employee data readable' : 'no employees returned'}).` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Talenta connection failed.' }
  }
}

export async function scanTalentaSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const cfg = config(credentials)
  const tables: SchemaTable[] = []
  for (const name of Object.keys(cfg.objects)) {
    const rows = await readObject(cfg, name, 20)
    const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
    tables.push({
      schema: 'talenta',
      name,
      columns: keys.map((k) => {
        const v = rows.find((r) => r[k] != null)?.[k]
        return { name: k, type: typeof v === 'number' ? 'NUMERIC' : typeof v === 'boolean' ? 'BOOLEAN' : Array.isArray(v) ? 'JSON' : 'TEXT', nullable: true }
      }),
      rowCount: null,
    })
  }
  return { tables, scannedAt: new Date().toISOString(), method: 'talenta-api' }
}

export async function sampleTalentaObject(credentials: ConnectorCredentials, object: string, limit = 25) {
  const rows = await readObject(config(credentials), object, limit)
  return { tableName: object, columns: rows.length ? Object.keys(rows[0]) : [], rows, totalRows: null as number | null }
}
