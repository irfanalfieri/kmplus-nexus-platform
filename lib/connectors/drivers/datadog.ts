import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult, SchemaTable } from '../types'
import { configError, flattenRow, hoursAgo, inferColumns, lookbackHours, parseNamedQueries, requestJson, sampleResult, scanResult, type Row } from '../http'

/**
 * Datadog, read-only: monitors, SLOs, hosts, events and APM services over the
 * lookback window, and one table per configured metric query
 * ("name = avg:trace.http.request.duration{service:hr-api}"). Needs an API key
 * and an application key (read scopes).
 */

const SERVICE = 'Datadog'
const BUILT_IN = ['monitors', 'slos', 'hosts', 'events', 'apm_services'] as const
const SITES = ['datadoghq.com', 'us3.datadoghq.com', 'us5.datadoghq.com', 'datadoghq.eu', 'ap1.datadoghq.com', 'ap2.datadoghq.com', 'ddog-gov.com']

function settings(credentials: ConnectorCredentials) {
  const site = (credentials.site?.trim() || 'datadoghq.com').replace(/^https?:\/\/(api\.)?/, '').replace(/\/+$/, '')
  const api = credentials.apiUrl?.trim() ? credentials.apiUrl.trim().replace(/\/+$/, '') : `https://api.${site}`
  if (!credentials.apiUrl?.trim() && !SITES.includes(site)) throw configError(`Unknown Datadog site "${site}". Use one of: ${SITES.join(', ')}.`)
  const apiKey = credentials.apiKey?.trim() ?? ''
  const appKey = credentials.appKey?.trim() ?? ''
  if (!apiKey || !appKey) throw configError('Datadog needs an API key and an application key.')
  return { api, headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey, accept: 'application/json' }, hours: lookbackHours(credentials.lookbackHours), queries: parseNamedQueries(credentials.queries) }
}

const dd = <T>(credentials: ConnectorCredentials, path: string) => {
  const { api, headers } = settings(credentials)
  return requestJson<T>(SERVICE, `${api}${path}`, { headers })
}

async function readTable(credentials: ConnectorCredentials, table: string, maxRows: number): Promise<Row[]> {
  const { hours, queries } = settings(credentials)
  const from = hoursAgo(hours)
  const to = Math.floor(Date.now() / 1000)
  switch (table) {
    case 'monitors':
      return (await dd<Row[]>(credentials, `/api/v1/monitor?page_size=${Math.min(maxRows, 1000)}`)).map((m) => flattenRow({ ...m, options: undefined, matching_downtimes: undefined })).slice(0, maxRows)
    case 'slos':
      return ((await dd<{ data?: Row[] }>(credentials, `/api/v1/slo?limit=${Math.min(maxRows, 1000)}`)).data ?? []).map((s) => flattenRow(s)).slice(0, maxRows)
    case 'hosts':
      return ((await dd<{ host_list?: Row[] }>(credentials, `/api/v1/hosts?count=${Math.min(maxRows, 1000)}&from=${from}`)).host_list ?? []).map((h) => flattenRow({ ...h, metrics: undefined, meta: undefined })).slice(0, maxRows)
    case 'events':
      return ((await dd<{ events?: Row[] }>(credentials, `/api/v1/events?start=${from}&end=${to}`)).events ?? []).map((e) => flattenRow(e)).slice(0, maxRows)
    case 'apm_services':
      return ((await dd<{ data?: { attributes?: { services?: string[] } } }>(credentials, `/api/v2/services?filter%5Bstart%5D=${from}`)).data?.attributes?.services ?? []).map((name) => ({ service: name })).slice(0, maxRows)
  }
  const q = queries.find((x) => x.name === table)
  if (!q) throw configError(`Unknown Datadog table "${table}". Known: ${[...BUILT_IN, ...queries.map((x) => x.name)].join(', ')}`)
  const res = await dd<{ series?: { scope?: string; metric?: string; expression?: string; pointlist?: [number, number | null][] }[]; error?: string }>(
    credentials,
    `/api/v1/query?from=${from}&to=${to}&query=${encodeURIComponent(q.query)}`
  )
  if (res.error) throw configError(`${SERVICE}: ${res.error}`)
  return (res.series ?? []).flatMap((s) => (s.pointlist ?? []).map(([t, v]) => ({ metric: s.metric ?? s.expression ?? q.query, scope: s.scope ?? null, timestamp: new Date(t).toISOString(), value: v }))).slice(0, maxRows)
}

export async function testDatadogConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const valid = await dd<{ valid?: boolean }>(credentials, '/api/v1/validate')
    if (!valid.valid) return { ok: false, message: 'Datadog says the API key is not valid.' }
    await dd(credentials, '/api/v1/monitor?page_size=1')
    return { ok: true, message: `Connected to ${SERVICE} (${settings(credentials).api.replace('https://api.', '')}).` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

export async function scanDatadogSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const tables: SchemaTable[] = []
  for (const name of [...BUILT_IN, ...settings(credentials).queries.map((q) => q.name)]) {
    const rows = await readTable(credentials, name, 200).catch(() => null)
    if (rows) tables.push({ schema: 'datadog', name, columns: inferColumns(rows), rowCount: rows.length })
  }
  return scanResult(tables, 'datadog-api')
}

export async function sampleDatadogTable(credentials: ConnectorCredentials, table: string, limit = 25) {
  return sampleResult(table, await readTable(credentials, table, Math.max(limit, 1)), limit)
}
