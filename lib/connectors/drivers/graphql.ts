import type { ConnectorCredentials, ConnectionTestResult, SchemaScanResult } from '../types'
import { baseUrlOf, configError, inferColumns, request, sampleResult, scanResult, type Row } from '../http'
import { graphqlErrors, graphqlPaged, graphqlRecords, parseOperations } from '../api-records'

/**
 * GraphQL APIs (DS-9), read-only: each query the user writes (under a
 * `### name` line) is a table; its first list of objects is the rows. Queries
 * with an `$after` variable are paged through `pageInfo { hasNextPage endCursor }`.
 * Sign-in: a header (Authorization: Bearer …, x-api-key …) or basic auth.
 */

const MAX_PAGES = 500

function settings(c: ConnectorCredentials) {
  const endpoint = baseUrlOf(c.endpoint, 'The GraphQL endpoint')
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
  const name = c.authHeader?.trim()
  if (name) {
    if (!/^[A-Za-z0-9-]{1,60}$/.test(name)) throw configError('The sign-in header name may only contain letters, digits and hyphens.')
    headers[name.toLowerCase()] = c.authValue ?? ''
  } else if (c.username) {
    headers.authorization = `Basic ${Buffer.from(`${c.username}:${c.password ?? ''}`).toString('base64')}`
  }
  let variables: Record<string, unknown> = {}
  if (c.variables?.trim()) {
    try {
      variables = JSON.parse(c.variables) as Record<string, unknown>
    } catch {
      throw configError('Variables must be a JSON object, e.g. {"company": "KMP"}.')
    }
  }
  const ops = parseOperations(c.queries, 'result')
  return { endpoint, headers, variables, ops }
}

async function post(c: ConnectorCredentials, query: string, variables: Record<string, unknown>) {
  const s = settings(c)
  const res = await request('GraphQL API', s.endpoint, { method: 'POST', headers: s.headers, body: JSON.stringify({ query, variables }), timeoutMs: 60_000 })
  const text = await res.text()
  if (res.status === 401 || res.status === 403) throw configError(`The GraphQL API rejected the sign-in (HTTP ${res.status}).`)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw Object.assign(new Error(`The GraphQL API did not answer with JSON (HTTP ${res.status}).`), { retryable: res.status >= 500 })
  }
  const errors = graphqlErrors(body)
  // GraphQL reports errors with HTTP 200; partial data with errors is still an error for a pipeline.
  if (errors) throw Object.assign(new Error(`GraphQL: ${errors}`), { retryable: false })
  if (!res.ok) throw Object.assign(new Error(`The GraphQL API returned HTTP ${res.status}.`), { retryable: res.status >= 500 || res.status === 429 })
  return (body as { data?: unknown }).data
}

async function rows(c: ConnectorCredentials, table: string, max: number): Promise<Row[]> {
  const s = settings(c)
  const op = s.ops.find((o) => o.name === table)
  if (!op) throw configError(`No query "${table}". Test the data source again to refresh its tables.`)
  const out: Row[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES && out.length < max; page++) {
    const data = await post(c, op.body, { ...s.variables, ...(graphqlPaged(op.body) ? { after } : {}) })
    const found = graphqlRecords(data)
    out.push(...found.rows)
    if (!graphqlPaged(op.body) || !found.pageInfo?.hasNextPage || !found.pageInfo.endCursor || found.pageInfo.endCursor === after) break
    after = found.pageInfo.endCursor
  }
  return out.slice(0, max)
}

export async function testGraphqlConnection(c: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const s = settings(c)
    await post(c, '{ __typename }', {})
    return { ok: true, message: `Connected to the GraphQL API. Queries set up: ${s.ops.length}.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'GraphQL connection failed.' }
  }
}

export async function scanGraphqlSchema(c: ConnectorCredentials): Promise<SchemaScanResult> {
  const s = settings(c)
  if (!s.ops.length) throw configError('Write at least one query (under a line ### name).')
  const tables = []
  for (const op of s.ops) tables.push({ schema: 'graphql', name: op.name, columns: inferColumns(await rows(c, op.name, 50).catch(() => [])), rowCount: null })
  return scanResult(tables, 'graphql-queries')
}

export async function sampleGraphqlTable(c: ConnectorCredentials, table: string, limit = 25) {
  return sampleResult(table, await rows(c, table, limit), limit)
}

export const readGraphqlRows = (c: ConnectorCredentials, table: string, maxRows: number) => rows(c, table, maxRows)
