import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult, SchemaTable } from '../types'
import { baseUrlOf, configError, flattenRow, hoursAgo, inferColumns, lookbackHours, requestJson, sampleResult, scanResult, type Row } from '../http'

/**
 * Grafana (self-hosted or Grafana Cloud), read-only, with a service account
 * token (Viewer): dashboards, folders, alert rules, firing alerts, annotations
 * over the lookback window, and data sources (names and types only; Grafana
 * never returns their secrets).
 */

const SERVICE = 'Grafana'
const TABLES = ['dashboards', 'folders', 'alert_rules', 'alerts', 'annotations', 'datasources'] as const

function settings(credentials: ConnectorCredentials) {
  const url = baseUrlOf(credentials.url, 'The Grafana URL')
  const token = credentials.apiToken?.trim() ?? ''
  if (!token) throw configError('Enter a Grafana service account token (glsa_…).')
  const network = credentials.caCert?.trim() ? { tls: { caCert: credentials.caCert } } : undefined
  return { url, headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, network, hours: lookbackHours(credentials.lookbackHours) }
}

const gf = <T>(credentials: ConnectorCredentials, path: string) => {
  const { url, headers, network } = settings(credentials)
  return requestJson<T>(SERVICE, `${url}${path}`, { headers, network })
}

async function readTable(credentials: ConnectorCredentials, table: string, maxRows: number): Promise<Row[]> {
  const limit = Math.min(maxRows, 5000)
  switch (table) {
    case 'dashboards':
      return (await gf<Row[]>(credentials, `/api/search?type=dash-db&limit=${limit}`)).map((d) => flattenRow(d))
    case 'folders':
      return (await gf<Row[]>(credentials, `/api/folders?limit=${limit}`)).map((f) => flattenRow(f))
    case 'alert_rules':
      return (await gf<Row[]>(credentials, '/api/v1/provisioning/alert-rules')).slice(0, maxRows).map((r) => flattenRow({ ...r, data: undefined }))
    case 'alerts':
      return (await gf<Row[]>(credentials, '/api/alertmanager/grafana/api/v2/alerts')).slice(0, maxRows).map((a) => flattenRow(a))
    case 'annotations': {
      const from = hoursAgo(settings(credentials).hours) * 1000
      return (await gf<Row[]>(credentials, `/api/annotations?from=${from}&to=${Date.now()}&limit=${limit}`)).map((a) => flattenRow({ ...a, time: a.time ? new Date(Number(a.time)).toISOString() : null, timeEnd: a.timeEnd ? new Date(Number(a.timeEnd)).toISOString() : null }))
    }
    case 'datasources':
      return (await gf<Row[]>(credentials, '/api/datasources')).slice(0, maxRows).map(({ id, uid, name, type, url, access, isDefault, readOnly }) => ({ id, uid, name, type, url, access, isDefault, readOnly }))
  }
  throw configError(`Unknown Grafana table "${table}". Known: ${TABLES.join(', ')}`)
}

export async function testGrafanaConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const health = await gf<{ version?: string; database?: string }>(credentials, '/api/health')
    await gf(credentials, '/api/search?limit=1')
    return { ok: true, message: health.version ? `Connected to Grafana ${health.version}.` : 'Connected to Grafana.' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

export async function scanGrafanaSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const tables: SchemaTable[] = []
  for (const name of TABLES) {
    const rows = await readTable(credentials, name, 200).catch(() => null)
    if (rows) tables.push({ schema: 'grafana', name, columns: inferColumns(rows), rowCount: rows.length })
  }
  return scanResult(tables, 'grafana-http-api')
}

export async function sampleGrafanaTable(credentials: ConnectorCredentials, table: string, limit = 25) {
  return sampleResult(table, await readTable(credentials, table, Math.max(limit, 1)), limit)
}
