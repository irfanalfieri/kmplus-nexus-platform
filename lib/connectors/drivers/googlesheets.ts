import type { ConnectorCredentials, ConnectionTestResult, SchemaScanResult, SchemaTable } from '../types'
import { configError, inferColumns, requestJson, sampleResult, scanResult, type Row } from '../http'
import { googleAccessToken, parseServiceAccount } from '@/lib/net/cloud-auth'
import { toSheet, type Cell } from '@/lib/files/parse'

/**
 * Google Sheets, read-only, through a service account the spreadsheet is
 * shared with (Viewer). Each tab is a table: the first row holds the column
 * names, the rows below are records, typed like uploaded files.
 */

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const MAX_ROWS = 200_000

/** The spreadsheet ID from an ID or a pasted docs.google.com URL. */
export function spreadsheetIdOf(raw: string | undefined) {
  const v = (raw ?? '').trim()
  const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(v)?.[1]
  const id = fromUrl ?? v
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) throw configError('Enter the spreadsheet URL or ID (the long code in docs.google.com/spreadsheets/d/<ID>/…).')
  return id
}

function settings(c: ConnectorCredentials) {
  const api = (c.apiEndpoint?.trim() || 'https://sheets.googleapis.com').replace(/\/+$/, '')
  return { api, id: spreadsheetIdOf(c.spreadsheet), sa: parseServiceAccount(c.serviceAccountJson) }
}

async function get<T>(c: ConnectorCredentials, path: string): Promise<T> {
  const s = settings(c)
  try {
    return await requestJson<T>('Google Sheets', `${s.api}/v4/spreadsheets/${s.id}${path}`, { headers: { authorization: `Bearer ${await googleAccessToken(s.sa, SCOPE)}` } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/HTTP 404/.test(msg) || /rejected the credentials/.test(msg)) throw configError(`Google Sheets: the spreadsheet was not found or not shared with ${s.sa.client_email}. Share it with that address (Viewer).`)
    throw err
  }
}

async function tabs(c: ConnectorCredentials) {
  const meta = await get<{ properties?: { title?: string }; sheets?: { properties: { title: string; sheetType?: string; gridProperties?: { rowCount?: number } } }[] }>(c, '?fields=properties.title,sheets.properties(title,sheetType,gridProperties.rowCount)')
  return { title: meta.properties?.title ?? 'spreadsheet', tabs: (meta.sheets ?? []).map((s) => s.properties).filter((p) => (p.sheetType ?? 'GRID') === 'GRID') }
}

const a1 = (tab: string) => `'${tab.replace(/'/g, "''")}'`

async function tabRows(c: ConnectorCredentials, tab: string, max: number): Promise<Row[]> {
  const known = (await tabs(c)).tabs.find((t) => t.title === tab)
  if (!known) throw configError(`No tab "${tab}" in the spreadsheet. Test the data source again to refresh its tables.`)
  // Header row plus up to `max` rows.
  const last = Math.min(max, MAX_ROWS) + 1
  const res = await get<{ values?: unknown[][] }>(c, `/values/${encodeURIComponent(`${a1(tab)}!1:${last}`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS`)
  const data = (res.values ?? []).map((r) => r.map((v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' || typeof v === 'boolean' ? v : String(v)))) as Cell[][]
  if (data.length < 1) return []
  const sheet = toSheet(data)
  return sheet.rows.slice(0, max).map((r) => Object.fromEntries(sheet.columns.map((col, i) => [col.name, r[i] === null ? null : col.type === 'integer' || col.type === 'numeric' ? Number(r[i]) : col.type === 'boolean' ? /^(true|yes|y|1)$/i.test(String(r[i])) : r[i]])))
}

export async function testGoogleSheetsConnection(c: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const t = await tabs(c)
    return { ok: true, message: `Connected to “${t.title}”. Tabs: ${t.tabs.length}.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Google Sheets connection failed.' }
  }
}

export async function scanGoogleSheetsSchema(c: ConnectorCredentials): Promise<SchemaScanResult> {
  const t = await tabs(c)
  const out: SchemaTable[] = []
  for (const [i, tab] of t.tabs.entries()) {
    const rows = i < 40 ? await tabRows(c, tab.title, 50).catch(() => []) : []
    out.push({ schema: 'sheets', name: tab.title, columns: inferColumns(rows), rowCount: tab.gridProperties?.rowCount ? Math.max(0, tab.gridProperties.rowCount - 1) : null })
  }
  return scanResult(out, 'google-sheets')
}

export async function sampleGoogleSheetsTable(c: ConnectorCredentials, table: string, limit = 25) {
  return sampleResult(table, await tabRows(c, table, limit), limit)
}

export const readGoogleSheetsRows = (c: ConnectorCredentials, table: string, maxRows: number) => tabRows(c, table, maxRows)
