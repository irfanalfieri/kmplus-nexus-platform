import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult, SchemaTable } from '../types'
import { baseUrlOf, flattenRow, inferColumns, parseNamedQueries, requestJson, sampleResult, scanResult, configError, type Row } from '../http'

/**
 * Prometheus and Prometheus-compatible servers (Thanos, VictoriaMetrics,
 * Grafana Mimir, Cortex) over the HTTP API, read-only. Tables:
 * targets, alerts, rules, metrics (names, types, help) and one table per
 * configured PromQL query (instant query: labels, value, timestamp).
 */

const SERVICE = 'Prometheus'
const BUILT_IN = ['targets', 'alerts', 'rules', 'metrics'] as const

function settings(credentials: ConnectorCredentials) {
  const url = baseUrlOf(credentials.url, 'The Prometheus URL')
  const headers: Record<string, string> = { accept: 'application/json' }
  if (credentials.bearerToken?.trim()) headers.authorization = `Bearer ${credentials.bearerToken.trim()}`
  else if (credentials.username?.trim()) headers.authorization = `Basic ${Buffer.from(`${credentials.username.trim()}:${credentials.password ?? ''}`).toString('base64')}`
  return { url, headers, queries: parseNamedQueries(credentials.queries) }
}

type PromResponse<T> = { status: string; data: T; error?: string }

async function api<T>(credentials: ConnectorCredentials, path: string): Promise<T> {
  const { url, headers } = settings(credentials)
  const body = await requestJson<PromResponse<T>>(SERVICE, `${url}${path}`, { headers })
  if (body.status !== 'success') throw configError(`${SERVICE}: ${body.error ?? 'query failed'}`)
  return body.data
}

/** Instant-vector, scalar or matrix results as rows: one row per series (matrix: per sample). */
export function promResultRows(data: { resultType: string; result: unknown }): Row[] {
  const toNum = (v: unknown) => (v === undefined ? null : Number(v))
  const ts = (t: unknown) => new Date(Number(t) * 1000).toISOString()
  if (data.resultType === 'scalar' || data.resultType === 'string') {
    const [t, v] = data.result as [number, string]
    return [{ value: data.resultType === 'scalar' ? toNum(v) : v, timestamp: ts(t) }]
  }
  const series = (data.result ?? []) as { metric: Record<string, string>; value?: [number, string]; values?: [number, string][] }[]
  if (data.resultType === 'matrix') return series.flatMap((s) => (s.values ?? []).map(([t, v]) => ({ ...s.metric, value: toNum(v), timestamp: ts(t) })))
  return series.map((s) => ({ ...s.metric, value: toNum(s.value?.[1]), timestamp: s.value ? ts(s.value[0]) : null }))
}

async function readTable(credentials: ConnectorCredentials, table: string, maxRows: number): Promise<Row[]> {
  if (table === 'targets') {
    const data = await api<{ activeTargets: Row[] }>(credentials, '/api/v1/targets?state=active')
    return (data.activeTargets ?? []).slice(0, maxRows).map((t) => flattenRow({ ...t, discoveredLabels: undefined }))
  }
  if (table === 'alerts') {
    const data = await api<{ alerts: Row[] }>(credentials, '/api/v1/alerts')
    return (data.alerts ?? []).slice(0, maxRows).map((a) => flattenRow(a))
  }
  if (table === 'rules') {
    const data = await api<{ groups: { name: string; file?: string; rules: Row[] }[] }>(credentials, '/api/v1/rules')
    return (data.groups ?? []).flatMap((g) => g.rules.map((r) => flattenRow({ group: g.name, file: g.file, ...r, alerts: undefined }))).slice(0, maxRows)
  }
  if (table === 'metrics') {
    const data = await api<Record<string, { type: string; help: string; unit: string }[]>>(credentials, '/api/v1/metadata')
    return Object.entries(data ?? {})
      .slice(0, maxRows)
      .map(([metric, meta]) => ({ metric, type: meta[0]?.type ?? null, help: meta[0]?.help ?? null, unit: meta[0]?.unit || null }))
  }
  const q = settings(credentials).queries.find((x) => x.name === table)
  if (!q) throw configError(`Unknown Prometheus table "${table}". Known: ${[...BUILT_IN, ...settings(credentials).queries.map((x) => x.name)].join(', ')}`)
  const data = await api<{ resultType: string; result: unknown }>(credentials, `/api/v1/query?query=${encodeURIComponent(q.query)}`)
  return promResultRows(data).slice(0, maxRows)
}

export async function testPrometheusConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const data = await api<{ resultType: string; result: unknown }>(credentials, '/api/v1/query?query=1')
    const build = await api<{ version?: string }>(credentials, '/api/v1/status/buildinfo').catch(() => ({ version: undefined }))
    return { ok: data.resultType === 'scalar', message: build.version ? `Connected to Prometheus ${build.version}.` : 'Connected to Prometheus.', meta: build.version ? { version: build.version } : undefined }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

export async function scanPrometheusSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const tables: SchemaTable[] = []
  for (const name of [...BUILT_IN, ...settings(credentials).queries.map((q) => q.name)]) {
    const rows = await readTable(credentials, name, 200).catch(() => null)
    if (rows) tables.push({ schema: 'prometheus', name, columns: inferColumns(rows), rowCount: rows.length })
  }
  return scanResult(tables, 'prometheus-http-api')
}

export async function samplePrometheusTable(credentials: ConnectorCredentials, table: string, limit = 25) {
  return sampleResult(table, await readTable(credentials, table, Math.max(limit, 1)), limit)
}
