import { and, desc, eq } from 'drizzle-orm'
import { withResolvedSecrets } from '@/lib/secrets/resolve'
import { NextResponse } from 'next/server'
import { db, pool } from '@/lib/db'
import { catalogEntries, dataSources, domainMappings, executionLogs, nexusDatasets, pipelines } from '@/lib/db/schema'
import { recordAudit } from '@/lib/audit'
import { accessFor, applyMasks, liveTableAccess } from '@/lib/governance/masking'
import { rowAllowed } from '@/lib/governance/row-filters'
import { DOMAIN_BY_NAME } from '@/lib/domain/model'
import { liveQuery } from '@/lib/pipelines/io'
import { enqueueRun } from '@/lib/pipelines/jobs'
import { nudgeWorker, startWorker } from '@/lib/pipelines/worker'
import { activeAliases } from '@/lib/datasets/store'
import { ApiAuthError, authenticate, type ApiCaller, type ApiScope } from './keys'
import { consumeRateLimit, rateLimitHeaders } from './rate-limit'
import { ApiQueryError, buildApiSql, parseApiQuery, toPage, type ApiQuery } from './query'

/** Data API request handling (API-2/3/4/6). Errors are JSON: { error: { message } }. */

type Column = { name: string; type: string }
const QUERY_TIMEOUT = '15s'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

const fail = (status: number, message: string) => json({ error: { status, message } }, status)

export async function handle(req: Request, scope: ApiScope | ApiScope[], fn: (caller: ApiCaller, params: URLSearchParams) => Promise<Response>) {
  try {
    const caller = await authenticate(req.headers.get('authorization'), scope)
    const limit = await consumeRateLimit(`key:${caller.keyId}`, caller.rateLimitPerMinute)
    const headers = rateLimitHeaders(limit)
    if (!limit.allowed) return json({ error: { status: 429, message: `Rate limit of ${limit.limit} requests per minute reached. Retry after the Retry-After header.` } }, 429, headers)
    const res = await fn(caller, new URL(req.url).searchParams)
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
    return res
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
  // A renamed column of a defined dataset keeps answering under its old name for 30 days.
  const aliases = (await activeAliases(caller.workspaceId, name)).filter((a) => columns.includes(a.newName) && !columns.includes(a.oldName))
  const columnMap = { ...Object.fromEntries(columns.map((c) => [c, c])), ...Object.fromEntries(aliases.map((a) => [a.oldName, a.newName])) }
  const query = parseApiQuery(params, Object.keys(columnMap))
  const access = await accessFor(caller.workspaceId, name, caller.role)
  const masks = { ...access.masks, ...Object.fromEntries(aliases.flatMap((a) => (access.masks[a.newName] ? [[a.oldName, access.masks[a.newName]]] : []))) }
  // Masked columns can't be filtered on: a filter would reveal the hidden value.
  const blocked = query.filters.find((f) => masks[f.column])
  if (blocked) throw new ApiQueryError(`Field "${blocked.column}" is masked for this API key and can't be filtered.`)
  const page = await runPage(tableRef(d.tableName), columnMap, query, columns, access.rowFilters)
  await recordAudit({ userId: `apikey:${caller.keyId}`, workspaceId: caller.workspaceId }, { action: 'API_READ', resource: 'dataset', resourceId: d.id, changes: { dataset: name, rows: page.data.length, filters: query.filters.map((f) => f.column) } })
  const headers: Record<string, string> = d.lastLoadedAt ? { 'Last-Modified': new Date(d.lastLoadedAt).toUTCString() } : {}
  if (aliases.length) {
    headers.Deprecation = 'true'
    headers.Sunset = new Date(Math.min(...aliases.map((a) => new Date(a.expiresAt).getTime()))).toUTCString()
    headers['X-Nexus-Renamed-Fields'] = aliases.map((a) => `${a.oldName}=${a.newName}`).join(', ')
  }
  return json(
    {
      data: applyMasks(page.data, masks),
      next_cursor: page.next_cursor,
      meta: { dataset: name, mode: 'cached', last_loaded_at: d.lastLoadedAt, masked_fields: Object.keys(masks), ...(aliases.length ? { deprecated_fields: Object.fromEntries(aliases.map((a) => [a.oldName, { use: a.newName, until: a.expiresAt }])) } : {}) },
    },
    200,
    headers
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
  const res = await liveQuery(await withResolvedSecrets(source), e.tableName, { limit, timeoutMs: e.liveTimeoutSeconds * 1000, filters })
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

// ── Pipelines and runs (API-4) ───────────────────────────────────────────────

const runView = (r: typeof executionLogs.$inferSelect) => ({
  id: r.id,
  pipeline_id: r.pipelineId,
  status: r.status,
  trigger: r.trigger,
  pipeline_version: r.pipelineVersion,
  rows_read: r.recordsProcessed ?? 0,
  rows_written: r.recordsSuccess ?? 0,
  rows_quarantined: r.recordsError ?? 0,
  error: r.errorMessage,
  started_at: r.startTime,
  finished_at: r.endTime,
  duration_seconds: r.duration,
})

/** GET /api/v1/pipelines */
export async function listPipelinesApi(caller: ApiCaller) {
  const rows = await db
    .select({ id: pipelines.id, name: pipelines.name, version: pipelines.version, enabled: pipelines.enabled, lastRunAt: pipelines.lastRunAt, lastRunStatus: pipelines.lastRunStatus, nextRunAt: pipelines.nextRunAt })
    .from(pipelines)
    .where(eq(pipelines.workspaceId, caller.workspaceId))
  return json({ data: rows.map((p) => ({ id: p.id, name: p.name, published_version: p.version || null, scheduled: p.enabled, last_run_at: p.lastRunAt, last_run_status: p.lastRunStatus, next_run_at: p.nextRunAt })) })
}

/** POST /api/v1/pipelines/:id/runs: queue a run of the published version. */
export async function triggerRunApi(caller: ApiCaller, pipelineId: string, origin: string) {
  const [p] = await db.select({ id: pipelines.id, version: pipelines.version, userId: pipelines.userId }).from(pipelines).where(and(eq(pipelines.id, pipelineId), eq(pipelines.workspaceId, caller.workspaceId))).limit(1)
  if (!p) throw new NotFound(`No pipeline ${pipelineId}.`)
  if (!p.version) return fail(409, 'This pipeline has no published version yet.')
  // Like scheduled runs, API runs act as the pipeline's creator (alerts go to the workspace as usual).
  const outcome = await enqueueRun(p.id, { workspaceId: caller.workspaceId, actorId: p.userId }, 'api')
  await recordAudit({ userId: `apikey:${caller.keyId}`, workspaceId: caller.workspaceId }, { action: 'RUN', resource: 'pipeline', resourceId: p.id, changes: { trigger: 'api', runId: outcome.runId, status: outcome.status } })
  if (outcome.status === 'skipped') return json({ error: { status: 409, message: outcome.message }, run_id: outcome.runId || null }, 409)
  startWorker()
  return json({ run_id: outcome.runId, status: 'queued', status_url: `${origin}/api/v1/runs/${outcome.runId}` }, 202, { Location: `${origin}/api/v1/runs/${outcome.runId}` })
}

/** GET /api/v1/pipelines/:id/runs: latest runs. */
export async function listRunsApi(caller: ApiCaller, pipelineId: string, params: URLSearchParams) {
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 20) || 20, 1), 100)
  const rows = await db.select().from(executionLogs).where(and(eq(executionLogs.workspaceId, caller.workspaceId), eq(executionLogs.pipelineId, pipelineId))).orderBy(desc(executionLogs.createdAt)).limit(limit)
  return json({ data: rows.map(runView) })
}

/** GET /api/v1/runs/:id */
export async function getRunApi(caller: ApiCaller, runId: string) {
  const [r] = await db.select().from(executionLogs).where(and(eq(executionLogs.id, runId), eq(executionLogs.workspaceId, caller.workspaceId))).limit(1)
  if (!r) throw new NotFound(`No run ${runId}.`)
  // Where no scheduler runs (dev/preview), polling keeps a waiting run moving.
  if (r.status === 'queued' || r.status === 'running') await nudgeWorker(caller.workspaceId)
  return json({ data: runView(r) })
}
