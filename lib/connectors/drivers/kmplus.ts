import { connectorFetch, UnsafeUrlError } from '@/lib/net/safe-url'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult } from '../types'

/**
 * KMPlus products (KMS, LMS, TMS, PMS, CMS, IMS) as first-class destinations.
 * Each product implements the Nexus Ingest Contract v1
 * (docs/integrations/kmplus-ingest-contract.md):
 *
 *   GET  {baseUrl}/nexus/v1/health
 *   GET  {baseUrl}/nexus/v1/entities                       which entities it accepts, with fields
 *   POST {baseUrl}/nexus/v1/entities/{entity}/upsert       { batch_id, run_id, records }
 *   GET  {baseUrl}/nexus/v1/entities/{entity}?limit=       sample (optional)
 *
 * Records use Unified Data Model field names (employee_code, full_name …) and
 * are upserted by the entity key, so re-sending a batch is harmless.
 */

export const KMPLUS_PRODUCTS = ['KMS', 'LMS', 'TMS', 'PMS', 'CMS', 'IMS'] as const
const BATCH = 500
const TIMEOUT_MS = 30_000

type Entity = { name: string; key: string; fields: { name: string; type?: string; required?: boolean }[] }

function settings(credentials: ConnectorCredentials) {
  const baseUrl = (credentials.baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('Base URL is required, e.g. https://kms.kmplus.co.id')
  const token = (credentials.apiToken ?? '').trim()
  if (!token) throw new Error('API token is required (issued by the KMPlus product for Nexus).')
  return { baseUrl, token, product: (credentials.product ?? '').trim().toUpperCase() || 'KMPlus product' }
}

async function call<T>(credentials: ConnectorCredentials, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { baseUrl, token } = settings(credentials)
  let res: Response
  try {
    // https and a public address from the cloud; an on-premises product is reached through a Nexus Agent.
    res = await connectorFetch(
      `${baseUrl}/nexus/v1${path}`,
      {
        method: init.method ?? 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), 'user-agent': 'KMPlus-Nexus/1.0' },
        body: init.body ? JSON.stringify(init.body) : undefined,
      },
      { httpsOnly: true }
    )
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new Error(err.message)
    throw new Error(`${baseUrl} did not answer (${err instanceof Error ? err.message : 'network error'}).`)
  }
  const text = await res.text()
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('The KMPlus product rejected the API token.'), { retryable: false })
  if (!res.ok) throw Object.assign(new Error(`${init.method ?? 'GET'} /nexus/v1${path} → HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`), { retryable: res.status >= 500 || res.status === 429 })
  try {
    return (text ? JSON.parse(text) : {}) as T
  } catch {
    throw new Error(`/nexus/v1${path} did not return JSON. Is the base URL right?`)
  }
}

export async function testKmplusConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const { product } = settings(credentials)
    const health = await call<{ product?: string; version?: string }>(credentials, '/health')
    const entities = await call<{ entities?: Entity[] }>(credentials, '/entities')
    return { ok: true, message: `${health.product ?? product} ${health.version ?? ''} accepts ${(entities.entities ?? []).map((e) => e.name).join(', ') || 'no entities'}`.trim(), meta: { product: health.product ?? product } }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed' }
  }
}

export async function scanKmplusSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const { entities = [] } = await call<{ entities?: Entity[] }>(credentials, '/entities')
  return {
    tables: entities.map((e) => ({ schema: 'kmplus', name: e.name, rowCount: null, columns: e.fields.map((f) => ({ name: f.name, type: f.type ?? 'text', nullable: !f.required, isPrimaryKey: f.name === e.key })) })),
    scannedAt: new Date().toISOString(),
    method: 'nexus-ingest-contract-v1',
  }
}

export async function sampleKmplusEntity(credentials: ConnectorCredentials, entity: string, limit = 25) {
  try {
    const { records = [] } = await call<{ records?: Record<string, unknown>[] }>(credentials, `/entities/${encodeURIComponent(entity)}?limit=${Math.min(limit, 100)}`)
    return { tableName: entity, columns: Array.from(new Set(records.flatMap((r) => Object.keys(r)))), rows: records, totalRows: null as number | null }
  } catch {
    // Reading back is optional in the contract.
    return { tableName: entity, columns: [] as string[], rows: [] as Record<string, unknown>[], totalRows: null as number | null }
  }
}

/** Upserts rows in batches; returns accepted count and the rows the product rejected (they go to the quarantine). */
export async function writeKmplusEntity(credentials: ConnectorCredentials, entity: string, rows: Record<string, unknown>[], opts: { runId?: string; chunk?: number } = {}) {
  let written = 0
  const rejected: { row: Record<string, unknown>; error: string }[] = []
  for (let i = 0; i < rows.length; i += BATCH) {
    const records = rows.slice(i, i + BATCH)
    // Stable per run, chunk and position: the product can ignore a batch it already applied.
    const batchId = `${opts.runId ?? 'adhoc'}:${opts.chunk ?? 0}:${i / BATCH}`
    const res = await call<{ accepted?: number; rejected?: { index: number; error: string }[] }>(credentials, `/entities/${encodeURIComponent(entity)}/upsert`, { method: 'POST', body: { batch_id: batchId, run_id: opts.runId ?? null, records } })
    const bad = res.rejected ?? []
    for (const r of bad) if (records[r.index]) rejected.push({ row: records[r.index], error: r.error || 'rejected by the product' })
    written += res.accepted ?? records.length - bad.length
  }
  return { written, rejected }
}
