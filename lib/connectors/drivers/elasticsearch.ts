import type { ConnectionTestResult, ConnectorCredentials, SchemaColumn, SchemaScanResult, SchemaTable } from '../types'
import { baseUrlOf, configError, flattenRow, requestJson, sampleResult, scanResult, type HttpOptions, type Row } from '../http'

/**
 * Elasticsearch and OpenSearch, read-only: logs, metrics and Elastic APM data
 * (traces-apm*, metrics-apm*, logs-apm*). Indices and data streams are
 * tables; documents are flattened to dotted columns. Reads page with the scroll
 * API; incremental syncs filter and sort on the watermark field in the query.
 */

const SERVICE = 'Elasticsearch'

function settings(credentials: ConnectorCredentials) {
  const url = baseUrlOf(credentials.url, 'The Elasticsearch / OpenSearch URL')
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' }
  if (credentials.apiKey?.trim()) headers.authorization = `ApiKey ${credentials.apiKey.trim()}`
  else if (credentials.username?.trim()) headers.authorization = `Basic ${Buffer.from(`${credentials.username.trim()}:${credentials.password ?? ''}`).toString('base64')}`
  const network = credentials.caCert?.trim() ? { tls: { caCert: credentials.caCert } } : undefined
  const pattern = credentials.indexPattern?.trim() || '*'
  return { url, headers, network, pattern }
}

function es<T>(credentials: ConnectorCredentials, path: string, init: HttpOptions = {}) {
  const { url, headers, network } = settings(credentials)
  return requestJson<T>(SERVICE, `${url}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) }, network, timeoutMs: init.timeoutMs ?? 60_000 })
}

const indexPath = (table: string) => {
  if (!/^[^\s,"*\\/?#<>|]+$/.test(table) || table.startsWith('_')) throw configError(`"${table}" is not an index or data stream name.`)
  return encodeURIComponent(table)
}

const docRow = (hit: { _id: string; _index?: string; _source?: Row }) => flattenRow({ _id: hit._id, ...(hit._source ?? {}) })

export async function testElasticsearchConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const info = await es<{ cluster_name?: string; version?: { number?: string; distribution?: string } }>(credentials, '/')
    const product = info.version?.distribution === 'opensearch' ? 'OpenSearch' : 'Elasticsearch'
    return { ok: true, message: `Connected to ${product} ${info.version?.number ?? '?'} (cluster ${info.cluster_name ?? '?'}).`, meta: { version: info.version?.number ?? '', product } }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

type Mapping = { properties?: Record<string, Mapping & { type?: string }> }

/** Dotted field names and types from an index mapping. */
export function mappingColumns(mapping: Mapping, prefix = '', out: SchemaColumn[] = []): SchemaColumn[] {
  for (const [name, field] of Object.entries(mapping.properties ?? {})) {
    const path = prefix ? `${prefix}.${name}` : name
    if (field.properties) mappingColumns(field, path, out)
    else out.push({ name: path, type: (field.type ?? 'object').toUpperCase(), nullable: true })
  }
  return out
}

export async function scanElasticsearchSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const { pattern } = settings(credentials)
  const target = pattern.split(',').map((p) => encodeURIComponent(p.trim())).join(',')
  const indices = await es<{ index: string; 'docs.count'?: string }[]>(credentials, `/_cat/indices/${target}?format=json&h=index,docs.count&expand_wildcards=open`)
  const streams = await es<{ data_streams?: { name: string; indices?: { index_name: string }[] }[] }>(credentials, `/_data_stream/${target}`).catch(() => ({ data_streams: [] }))
  const backing = new Set((streams.data_streams ?? []).flatMap((s) => (s.indices ?? []).map((i) => i.index_name)))
  const names = [
    ...(streams.data_streams ?? []).map((s) => ({ name: s.name, count: null as number | null })),
    ...indices.filter((i) => !i.index.startsWith('.') && !backing.has(i.index)).map((i) => ({ name: i.index, count: i['docs.count'] != null ? Number(i['docs.count']) : null })),
  ].slice(0, 300)
  const tables: SchemaTable[] = []
  for (const n of names) {
    const mapping = await es<Record<string, { mappings?: Mapping }>>(credentials, `/${indexPath(n.name)}/_mapping`).catch(() => ({}))
    // A data stream answers with its backing indices: merge their fields.
    const columns = new Map<string, SchemaColumn>()
    for (const m of Object.values(mapping)) for (const c of mappingColumns(m.mappings ?? {})) columns.set(c.name, c)
    tables.push({ schema: 'elasticsearch', name: n.name, columns: [{ name: '_id', type: 'KEYWORD', nullable: false, isPrimaryKey: true }, ...[...columns.values()].slice(0, 500)], rowCount: n.count })
  }
  return scanResult(tables, 'elasticsearch-mapping')
}

export async function sampleElasticsearchIndex(credentials: ConnectorCredentials, table: string, limit = 25) {
  const res = await es<{ hits?: { hits?: { _id: string; _source?: Row }[]; total?: { value?: number } | number } }>(credentials, `/${indexPath(table)}/_search`, {
    method: 'POST',
    body: JSON.stringify({ size: Math.min(Math.max(limit, 1), 1000), track_total_hits: true }),
  })
  const rows = (res.hits?.hits ?? []).map(docRow)
  const total = typeof res.hits?.total === 'number' ? res.hits.total : (res.hits?.total?.value ?? rows.length)
  return { ...sampleResult(table, rows, limit), totalRows: total }
}

/** Up to maxRows documents; with a watermark only newer ones, oldest first. */
export async function readElasticsearchRows(credentials: ConnectorCredentials, table: string, maxRows: number, watermark?: { column: string; after: string | null }): Promise<Row[]> {
  const query = watermark?.after != null ? { range: { [watermark.column]: { gt: watermark.after } } } : { match_all: {} }
  const sort = watermark ? [{ [watermark.column]: { order: 'asc' } }, '_doc'] : ['_doc']
  const rows: Row[] = []
  let page = await es<{ _scroll_id?: string; hits?: { hits?: { _id: string; _source?: Row }[] } }>(credentials, `/${indexPath(table)}/_search?scroll=2m`, {
    method: 'POST',
    body: JSON.stringify({ size: Math.min(1000, maxRows), query, sort }),
  })
  let scrollId = page._scroll_id
  try {
    while (rows.length < maxRows) {
      const hits = page.hits?.hits ?? []
      rows.push(...hits.map(docRow))
      if (!hits.length || !scrollId) break
      page = await es(credentials, '/_search/scroll', { method: 'POST', body: JSON.stringify({ scroll: '2m', scroll_id: scrollId }) })
      scrollId = page._scroll_id ?? scrollId
    }
  } finally {
    if (scrollId) await es(credentials, '/_search/scroll', { method: 'DELETE', body: JSON.stringify({ scroll_id: scrollId }) }).catch(() => undefined)
  }
  return rows.slice(0, maxRows)
}
