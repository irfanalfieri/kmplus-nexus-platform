import { connectorFetch, type ConnectorFetchOptions } from '@/lib/net/safe-url'
import type { SchemaColumn, SchemaScanResult, SchemaTable } from './types'

/**
 * Shared pieces of the HTTP-based connectors (observability, cloud storage,
 * secrets managers): JSON requests through the SSRF guard with readable errors,
 * flattening nested records, column inference and "name = query" lists.
 */

export type Row = Record<string, unknown>

/** Configuration problems: retrying won't help (runs fail at once). */
export const configError = (message: string) => Object.assign(new Error(message), { retryable: false })

export interface HttpOptions extends RequestInit {
  timeoutMs?: number
  network?: ConnectorFetchOptions
}

/** Sends a request and returns the response; network failures become "<service> did not answer". */
export async function request(service: string, url: string, init: HttpOptions = {}): Promise<Response> {
  const { timeoutMs = 30_000, network, ...rest } = init
  try {
    return await connectorFetch(url, { ...rest, signal: rest.signal ?? AbortSignal.timeout(timeoutMs) }, network)
  } catch (err) {
    if ((err as { retryable?: boolean })?.retryable === false) throw err
    const cause = (err as { cause?: { message?: string } })?.cause?.message
    throw new Error(`${service} did not answer: ${cause ?? (err instanceof Error ? err.message : 'network error')}`)
  }
}

/** A JSON request: 401/403 are configuration errors, 429/5xx are retried by runs. */
export async function requestJson<T = unknown>(service: string, url: string, init: HttpOptions = {}): Promise<T> {
  const res = await request(service, url, init)
  const text = await res.text()
  if (res.status === 401 || res.status === 403) throw configError(`${service} rejected the credentials (HTTP ${res.status}).`)
  if (!res.ok) {
    throw Object.assign(new Error(`${service} returned HTTP ${res.status}: ${text.slice(0, 200)}`), { retryable: res.status >= 500 || res.status === 429 })
  }
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw configError(`${service} did not return JSON. Check the URL.`)
  }
}

/** Nested objects become dotted keys (labels.job); arrays are kept as JSON values. */
export function flattenRow(row: Row, prefix = '', out: Row = {}): Row {
  for (const [k, v] of Object.entries(row ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flattenRow(v as Row, key, out)
    else out[key] = Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object') ? v.join(', ') : v
  }
  return out
}

export function inferColumns(rows: Row[]): SchemaColumn[] {
  const names = new Map<string, string>()
  for (const r of rows.slice(0, 200)) {
    for (const [k, v] of Object.entries(r)) {
      if (names.has(k) && names.get(k) !== 'TEXT') continue
      names.set(k, typeof v === 'number' ? 'NUMERIC' : typeof v === 'boolean' ? 'BOOLEAN' : v == null && names.has(k) ? names.get(k)! : 'TEXT')
    }
  }
  return [...names].map(([name, type]) => ({ name, type, nullable: true }))
}

export function scanResult(tables: SchemaTable[], method: string): SchemaScanResult {
  return { tables, scannedAt: new Date().toISOString(), method }
}

export function sampleResult(tableName: string, rows: Row[], limit: number) {
  const taken = rows.slice(0, limit)
  return { tableName, columns: inferColumns(taken).map((c) => c.name), rows: taken, totalRows: rows.length }
}

/**
 * Queries written as "name = query", one per line or separated by ";;".
 * Names become table names (lower case, letters, digits and _).
 */
export function parseNamedQueries(raw: string | undefined): { name: string; query: string }[] {
  const out: { name: string; query: string }[] = []
  for (const line of (raw ?? '').split(/\r?\n|;;/)) {
    const m = /^\s*([A-Za-z][\w .-]{0,60}?)\s*=\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    const name = m[1].toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
    if (name && !out.some((q) => q.name === name)) out.push({ name, query: m[2] })
  }
  return out
}

export const baseUrlOf = (raw: string | undefined, label: string) => {
  const url = (raw ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) throw configError(`${label} must start with http:// or https://`)
  return url
}

export const hoursAgo = (hours: number) => Math.floor(Date.now() / 1000) - Math.round(hours * 3600)
export const lookbackHours = (raw: string | undefined, fallback = 24) => Math.min(24 * 90, Math.max(1, Number(raw) || fallback))
