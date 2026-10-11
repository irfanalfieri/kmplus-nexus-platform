import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db, pool } from '@/lib/db'
import { catalogEntries, dataSources, domainMappings, nexusDatasets } from '@/lib/db/schema'
import { recordAudit } from '@/lib/audit'
import { accessFor, applyMasks, liveTableAccess } from '@/lib/governance/masking'
import { rowAllowed } from '@/lib/governance/row-filters'
import { DOMAIN_BY_NAME } from '@/lib/domain/model'
import { liveQuery } from '@/lib/pipelines/io'
import { ApiAuthError, authenticate, type ApiCaller, type ApiScope } from './keys'
import { ApiQueryError, buildApiSql, parseApiQuery, toPage, type ApiQuery } from './query'

/** Data API request handling (API-2/API-3). Errors are JSON: { error: { message } }. */

type Column = { name: string; type: string }
const QUERY_TIMEOUT = '15s'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

const fail = (status: number, message: string) => json({ error: { status, message } }, status)

export async function handle(req: Request, scope: ApiScope, fn: (caller: ApiCaller, params: URLSearchParams) => Promise<Response>) {
  try {
    const caller = await authenticate(req.headers.get('authorization'), scope)
    return await fn(caller, new URL(req.url).searchParams)
  } catch (err) {
    if (err instanceof ApiAuthError) return fail(err.status, err.message)
    if (err instanceof ApiQueryError) return fail(400, err.message)
    if (err instanceof NotFound) return fail(404, err.message)
    console.error('[api] request failed:', err instanceof Error ? err.message : err)
    return fail(500, err instanceof Error && /policy|timeout|took longer/i.test(err.message) ? err.message : 'The request failed. Try again, or contact your workspace admin.')
  }
}

class NotFound extends Error {}

async function runPage(table: string, columnMap: Record<string, string>, query: ApiQuery, datasetColumns: string[], rowFilters: Parameters<typeof buildApiSql>[3]['rowFilters']) {
  const { text, params } = buildApiSql(table, columnMap, query, { rowFilters, datasetColumns })
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`)
    const exists = (await client.query<{ r: string | null }>('SELECT to_regclass($1)::text AS r', [table])).rows[0].r
    const res = exists ? await client.query(text, params) : { rows: [] }
    await client.query('COMMIT')
    return toPage(res.rows as Record<string, unknown>[], query.limit)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

const tableRef = (tableName: string) => `"nexus_data"."${tableName.replace(/"/g, '""')}"`

/** GET /api/v1/datasets: datasets and published live tables this key can read. */
export async function listDatasets(caller: ApiCaller) {
  const [datasets, live] = await Promise.all([
    db.select({ name: nexusDatasets.name, columns: nexusDatasets.columns, rowCount: nexusDatasets.rowCount, lastLoadedAt: nexusDatasets.lastLoadedAt }).from(nexusDatasets).where(eq(nexusDatasets.workspaceId, caller.workspaceId)),
    db.select({ alias: catalogEntries.alias, tableName: catalogEntries.tableName }).from(catalogEntries).where(and(eq(catalogEntries.workspaceId, caller.workspaceId), eq(catalogEntries.accessMode, 'live'))),
  ])
  return json({
    data: [
      ...datasets.map((d) => ({ name: d.name, mode: 'cached', fields: ((d.columns as Column[]) ?? []).map((c) => c.name), row_count: d.rowCount ?? 0, last_loaded_at: d.lastLoadedAt })),
      ...live.filter((l) => l.alias).map((l) => ({ name: l.alias, mode: 'live', fields: null, row_count: null, last_loaded_at: null })),
    ],
  })
}

/** GET /api/v1/datasets/:name */
export async function readDataset(caller: ApiCaller, name: string, params: URLSearchParams) {
  const [d] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, caller.workspaceId), eq(nexusDatasets.name, name))).limit(1)
  if (!d) return readLiveTable(caller, name, params)
  const columns = ((d.columns as Column[]) ?? []).map((c) => c.name)
  const query = parseApiQuery(params, columns)
  const { masks, rowFilters } = await accessFor(caller.workspaceId, name, caller.role)
  // Masked columns can't be filtered on: a filter would reveal the hidden value.
  const blocked = query.filters.find((f) => masks[f.column])
  if (blocked) throw new ApiQueryError(`Field "${blocked.column}" is masked for this API key and can't be filtered.`)
  const page = await runPage(tableRef(d.tableName), Object.fromEntries(columns.map((c) => [c, c])), query, columns, rowFilters)
  await recordAudit({ userId: `apikey:${caller.keyId}`, workspaceId: caller.workspaceId }, { action: 'API_READ', resource: 'dataset', resourceId: d.id, changes: { dataset: name, rows: page.data.length, filters: query.filters.map((f) => f.column) } })
  return json(
    { data: applyMasks(page.data, masks), next_cursor: page.next_cursor, meta: { dataset: name, mode: 'cached', last_loaded_at: d.lastLoadedAt, masked_fields: Object.keys(masks) } },
    200,
    d.lastLoadedAt ? { 'Last-Modified': new Date(d.lastLoadedAt).toUTCString() } : {}
  )
}

/** A catalog source table published under `alias` in live mode: read from the source with its guardrails (DV-3). */
async function readLiveTable(caller: ApiCaller, alias: string, params: URLSearchParams) {
  const [e] = await db.select().from(catalogEntries).where(and(eq(catalogEntries.workspaceId, caller.workspaceId), eq(catalogEntries.alias, alias))).limit(1)
  if (!e || e.accessMode !== 'live' || !e.dataSourceId || !e.tableName) throw new NotFound(`No dataset named "${alias}".`)
  const [source] = await db.select().from(dataSources).where(and(eq(dataSources.id, e.dataSourceId), eq(dataSources.workspaceId, caller.workspaceId))).limit(1)
  if (!source) throw new NotFound(`No dataset named "${alias}".`)
  if (params.get('cursor')) throw new ApiQueryError('Live tables return one page (up to their row limit); cache the table in the catalog to page through it.')
  const filters: { column: string; value: string }[] = []
  for (const [key, value] of params) {
    const m = /^filter\[([^\]]+)\](?:\[eq\])?$/.exec(key)
    if (m) filters.push({ column: m[1], value })
    else if (key.startsWith('filter')) throw new ApiQueryError('Live tables support equality filters only: filter[field]=value.')
  }
  const limit = Math.min(Number(params.get('limit') ?? e.liveRowLimit) || e.liveRowLimit, e.liveRowLimit)
  const res = await liveQuery(source, e.tableName, { limit, timeoutMs: e.liveTimeoutSeconds * 1000, filters })
  const columns = Array.from(new Set(res.rows.flatMap((r) => Object.keys(r))))
  const { masks, rowFilters } = await liveTableAccess(caller.workspaceId, alias, caller.role, columns)
  const blocked = filters.find((f) => masks[f.column])
  if (blocked) throw new ApiQueryError(`Field "${blocked.column}" is masked for this API key and can't be filtered.`)
  let rows = res.rows.filter((r) => rowAllowed(r, rowFilters))
  const fields = params.get('fields')?.split(',').map((f) => f.trim()).filter(Boolean)
  if (fields?.length) rows = rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f] ?? null])))
  await recordAudit({ userId: `apikey:${caller.keyId}`, workspaceId: caller.workspaceId }, { action: 'API_READ', resource: 'data_source', resourceId: source.id, changes: { table: e.tableName, alias, live: true, rows: rows.length } })
  return json({ data: applyMasks(rows, masks), next_cursor: null, meta: { dataset: alias, mode: 'live', read_at: new Date().toISOString(), truncated: res.truncated, pushdown: res.pushdown, masked_fields: Object.keys(masks) } })
}

/** GET /api/v1/domains/:entity: the dataset published as this entity, with canonical field names (API-3). */
export async function readDomain(caller: ApiCaller, entityName: string, params: URLSearchParams) {
  const entity = DOMAIN_BY_NAME.get(entityName)
  if (!entity) throw new NotFound(`Unknown entity "${entityName}". Entities: ${[...DOMAIN_BY_NAME.keys()].join(', ')}.`)
  const [m] = await db.select().from(domainMappings).where(and(eq(domainMappings.workspaceId, caller.workspaceId), eq(domainMappings.entity, entity.name))).limit(1)
  if (!m) throw new NotFound(`No dataset is published as ${entity.label} in this workspace. Map one in Data Catalog.`)
  const [d] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, caller.workspaceId), eq(nexusDatasets.name, m.datasetName))).limit(1)
  if (!d) throw new NotFound(`Dataset ${m.datasetName} (published as ${entity.label}) no longer exists.`)
  const datasetColumns = ((d.columns as Column[]) ?? []).map((c) => c.name)
  const fields = Object.fromEntries(Object.entries(m.fields as Record<string, string>).filter(([, col]) => datasetColumns.includes(col)))
  const query = parseApiQuery(params, Object.keys(fields))
  const { masks, rowFilters } = await accessFor(caller.workspaceId, d.name, caller.role)
  const canonicalMasks = Object.fromEntries(Object.entries(fields).flatMap(([canonical, col]) => (masks[col] ? [[canonical, masks[col]]] : [])))
  const blocked = query.filters.find((f) => canonicalMasks[f.column])
  if (blocked) throw new ApiQueryError(`Field "${blocked.column}" is masked for this API key and can't be filtered.`)
  const page = await runPage(tableRef(d.tableName), fields, query, datasetColumns, rowFilters)
  await recordAudit({ userId: `apikey:${caller.keyId}`, workspaceId: caller.workspaceId }, { action: 'API_READ', resource: 'domain', resourceId: entity.name, changes: { dataset: d.name, rows: page.data.length } })
  return json({
    data: applyMasks(page.data, canonicalMasks),
    next_cursor: page.next_cursor,
    meta: { entity: entity.name, key: entity.key, dataset: d.name, last_loaded_at: d.lastLoadedAt, masked_fields: Object.keys(canonicalMasks), unmapped_fields: entity.fields.map((f) => f.name).filter((f) => !fields[f]) },
  })
}
