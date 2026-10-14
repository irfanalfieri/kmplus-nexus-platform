import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult, SchemaTable } from '../types'
import { configError, flattenRow, inferColumns, parseNamedQueries, requestJson, sampleResult, scanResult, type Row } from '../http'

/**
 * New Relic over NerdGraph (GraphQL), read-only: APM applications with their
 * health summary, open alert issues, and one table per configured NRQL query
 * ("name = SELECT average(duration) FROM Transaction FACET appName SINCE 1 day ago").
 * Needs a user API key (NRAK-…) and the account ID.
 */

const SERVICE = 'New Relic'
const BUILT_IN = ['apm_applications', 'alert_issues'] as const

function settings(credentials: ConnectorCredentials) {
  const apiKey = credentials.apiKey?.trim() ?? ''
  if (!apiKey) throw configError('Enter a New Relic user API key (NRAK-…).')
  const region = (credentials.region?.trim() || 'US').toUpperCase()
  const endpoint = credentials.endpoint?.trim() || (region === 'EU' ? 'https://api.eu.newrelic.com/graphql' : 'https://api.newrelic.com/graphql')
  const accountId = Number(credentials.accountId)
  return { apiKey, endpoint, accountId: Number.isFinite(accountId) && accountId > 0 ? accountId : null, queries: parseNamedQueries(credentials.queries) }
}

async function graphql<T>(credentials: ConnectorCredentials, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { apiKey, endpoint } = settings(credentials)
  const res = await requestJson<{ data?: T; errors?: { message: string }[] }>(SERVICE, endpoint, {
    method: 'POST',
    headers: { 'API-Key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (res.errors?.length) throw configError(`${SERVICE}: ${res.errors[0].message}`)
  return res.data as T
}

const needAccount = (credentials: ConnectorCredentials) => {
  const id = settings(credentials).accountId
  if (!id) throw configError('Enter the New Relic account ID.')
  return id
}

async function readTable(credentials: ConnectorCredentials, table: string, maxRows: number): Promise<Row[]> {
  if (table === 'apm_applications') {
    const data = await graphql<{ actor: { entitySearch: { results: { entities: Row[] } } } }>(
      credentials,
      `{ actor { entitySearch(query: "domain = 'APM' AND type = 'APPLICATION'") { results { entities { guid name accountId alertSeverity reporting
        ... on ApmApplicationEntityOutline { language apmSummary { apdexScore errorRate hostCount instanceCount responseTimeAverage throughput } } } } } } }`
    )
    return data.actor.entitySearch.results.entities.slice(0, maxRows).map((e) => flattenRow(e))
  }
  if (table === 'alert_issues') {
    const data = await graphql<{ actor: { account: { aiIssues: { issues: { issues: Row[] } } } } }>(
      credentials,
      `query($id: Int!) { actor { account(id: $id) { aiIssues { issues { issues { issueId title priority state activatedAt closedAt entityNames sources } } } } } }`,
      { id: needAccount(credentials) }
    )
    return (data.actor.account.aiIssues.issues.issues ?? []).slice(0, maxRows).map((i) => flattenRow(i))
  }
  const q = settings(credentials).queries.find((x) => x.name === table)
  if (!q) throw configError(`Unknown New Relic table "${table}". Known: ${[...BUILT_IN, ...settings(credentials).queries.map((x) => x.name)].join(', ')}`)
  const data = await graphql<{ actor: { account: { nrql: { results: Row[] } } } }>(credentials, `query($id: Int!, $q: Nrql!) { actor { account(id: $id) { nrql(query: $q, timeout: 60) { results } } } }`, {
    id: needAccount(credentials),
    q: q.query,
  })
  return (data.actor.account.nrql.results ?? []).slice(0, maxRows).map((r) => flattenRow(r))
}

export async function testNewRelicConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const data = await graphql<{ actor: { user: { name?: string; email?: string } } }>(credentials, '{ actor { user { name email } } }')
    return { ok: true, message: `Connected to ${SERVICE} as ${data.actor.user.name ?? data.actor.user.email ?? 'API key user'}.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

export async function scanNewRelicSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const tables: SchemaTable[] = []
  for (const name of [...BUILT_IN, ...settings(credentials).queries.map((q) => q.name)]) {
    const rows = await readTable(credentials, name, 200).catch(() => null)
    if (rows) tables.push({ schema: 'newrelic', name, columns: inferColumns(rows), rowCount: rows.length })
  }
  return scanResult(tables, 'newrelic-nerdgraph')
}

export async function sampleNewRelicTable(credentials: ConnectorCredentials, table: string, limit = 25) {
  return sampleResult(table, await readTable(credentials, table, Math.max(limit, 1)), limit)
}
