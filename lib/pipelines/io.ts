import { createHash, randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import type { PoolClient } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { pool as nexusPool } from '@/lib/db'
import { decryptCredentials } from '@/lib/security/credentials'
import { isConnectorSlug } from '@/lib/connectors/catalog'
import { readConnectorRows, sampleConnectorTable } from '@/lib/connectors/runtime'
import { createPgPool as externalPgPool } from '@/lib/connectors/drivers/postgres'
import { readFileChunk } from '@/lib/connectors/drivers/file'
import { liveSqlServerQuery, readSqlServerChunk, readSqlServerRows } from '@/lib/connectors/drivers/sqlserver'
import type { ConnectorCredentials } from '@/lib/connectors/types'
import { isBatchBody, type ApiDestinationSpec, type ColumnType } from './definition'
import type { ApiCall } from './api-calls'
import type { CallsResult } from '@/lib/connectors/rest/call'
import type { Row } from './transforms'
import { compareWatermarks, type OutputColumn } from './columns'
import { rowFilterSql, type RowFilter } from '@/lib/governance/row-filters'
import { agentOf, callAgent } from '@/lib/agent/server'
import { WRITE_BATCH_ROWS, wireRow } from '@/lib/agent/protocol'
import { agentRestRequest } from '@/lib/connectors/rest/agent-request'

/** Data source row as stored (credentials still encrypted). */
export interface StoredDataSource {
  id: string
  /** Owning workspace (required for sources reached through a Nexus Agent). */
  workspaceId?: string
  name: string
  sourceType: string
  config: unknown
  credentials: unknown
}

/** Connectors a pipeline can write to: tables (destination kind "datasource") or a REST API (kind "api"). */
export const WRITABLE_CONNECTORS = ['postgres', 'mysql', 'supabase', 'kmplus', 'rest'] as const

function credentialsOf(source: StoredDataSource): ConnectorCredentials {
  return Object.fromEntries(
    Object.entries(decryptCredentials(source.id, source.credentials)).map(([k, v]) => [k, v == null ? '' : String(v)])
  )
}

/** For an intranet API reached through an agent: the request designed in Nexus (none for other sources). */
const agentRequestOf = (source: StoredDataSource) => agentRestRequest(source.sourceType, credentialsOf(source))

const qIdent = (name: string) => `"${name.replace(/"/g, '""')}"`
const mIdent = (name: string) => `\`${name.replace(/`/g, '``')}\``


function pgTarget(source: StoredDataSource): { connectionString: string; schema: string; tls?: { mode?: string; ca?: string } } | null {
  const creds = credentialsOf(source)
  if (source.sourceType === 'postgres') {
    return { connectionString: creds.connectionString?.trim() ?? '', schema: creds.schema?.trim() || 'public', tls: { mode: creds.sslMode, ca: creds.caCert } }
  }
  if (source.sourceType === 'supabase' && creds.databaseUrl?.trim()) {
    return { connectionString: creds.databaseUrl.trim(), schema: creds.schema?.trim() || 'public' }
  }
  return null
}

function mysqlConfig(creds: ConnectorCredentials): string | mysql.ConnectionOptions {
  if (creds.connectionString?.trim()) return creds.connectionString.trim()
  return {
    host: creds.host?.trim(),
    port: Number(creds.port || 3306),
    user: creds.username?.trim(),
    password: creds.password ?? '',
    database: creds.database?.trim() || creds.schema?.trim(),
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

const BATCH = 1000

export interface ReadOptions {
  /** Incremental sync: only rows with column > after, read in column order. after = null on the first run. */
  watermark?: { column: string; after: string | null }
}

/** Configuration problems that retrying cannot fix (wrong role, missing table, unsupported connector …). */
export class NonRetryableError extends Error {
  readonly retryable = false
}

export async function readSourceRows(source: StoredDataSource, table: string, maxRows: number, opts: ReadOptions = {}): Promise<Row[]> {
  // Behind a customer's firewall: the Nexus Agent reads it (#13).
  const via = agentOf(source)
  if (via) return (await callAgent(via.agentId, 'readRows', { connection: via.connection, request: agentRequestOf(source), table, maxRows: Math.min(maxRows, 1_000_000), watermark: opts.watermark }, { timeoutMs: 240_000, workspaceId: via.workspaceId })) as Row[]
  const wm = opts.watermark
  const pg = pgTarget(source)
  if (pg) {
    const p = externalPgPool(pg.connectionString, pg.tls)
    try {
      const where = wm?.after != null ? `WHERE ${qIdent(wm.column)} > $3` : ''
      const order = wm ? `ORDER BY ${qIdent(wm.column)} ASC` : ''
      const rows: Row[] = []
      while (rows.length < maxRows) {
        const take = Math.min(BATCH, maxRows - rows.length)
        const params: unknown[] = [take, rows.length]
        if (wm?.after != null) params.push(wm.after)
        const res = await p.query(`SELECT * FROM ${qIdent(pg.schema)}.${qIdent(table)} ${where} ${order} LIMIT $1 OFFSET $2`, params)
        rows.push(...(res.rows as Row[]))
        if (res.rows.length < take) break
      }
      return rows
    } finally {
      await p.end()
    }
  }

  if (source.sourceType === 'mysql') {
    const conn = await mysql.createConnection(mysqlConfig(credentialsOf(source)) as mysql.ConnectionOptions)
    try {
      const where = wm?.after != null ? `WHERE ${mIdent(wm.column)} > ?` : ''
      const order = wm ? `ORDER BY ${mIdent(wm.column)} ASC` : ''
      const rows: Row[] = []
      while (rows.length < maxRows) {
        const take = Math.min(BATCH, maxRows - rows.length)
        const params: unknown[] = wm?.after != null ? [wm.after, take, rows.length] : [take, rows.length]
        const [batch] = await conn.query<mysql.RowDataPacket[]>(`SELECT * FROM ${mIdent(table)} ${where} ${order} LIMIT ? OFFSET ?`, params)
        rows.push(...(batch as Row[]))
        if (batch.length < take) break
      }
      return rows
    } finally {
      await conn.end()
    }
  }

  if (source.sourceType === 'sqlserver') return readSqlServerRows(credentialsOf(source), table, maxRows, wm)

  if (source.sourceType === 'supabase') {
    const creds = credentialsOf(source)
    const key = creds.secretKey?.trim() || creds.apiKey?.trim() || creds.publishableKey?.trim() || ''
    const client = createClient(creds.projectUrl?.trim().replace(/\/+$/, '') ?? '', key, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: creds.schema?.trim() || 'public' },
    })
    const rows: Row[] = []
    while (rows.length < maxRows) {
      const take = Math.min(BATCH, maxRows - rows.length)
      let query = client.from(table).select('*')
      if (wm?.after != null) query = query.gt(wm.column, wm.after)
      if (wm) query = query.order(wm.column, { ascending: true })
      const { data, error } = await query.range(rows.length, rows.length + take - 1)
      if (error) throw new Error(`Supabase read failed: ${error.message}`)
      rows.push(...((data ?? []) as Row[]))
      if ((data ?? []).length < take) break
    }
    return rows
  }

  if (!isConnectorSlug(source.sourceType)) throw new NonRetryableError(`Unsupported source type "${source.sourceType}".`)
  // Cloud storage files and Elasticsearch have their own read (Elasticsearch filters by watermark itself).
  const own = await readConnectorRows(source.sourceType, credentialsOf(source), table, maxRows, wm)
  if (own?.watermarkApplied) return own.rows
  // SAP / Salesforce / REST / Snowflake / Oracle / Talenta / LDAP / observability APIs: the connector's capped read.
  // These APIs can't filter by watermark server-side, so filter and order here.
  let rows = own ? own.rows : (((await sampleConnectorTable(source.sourceType, credentialsOf(source), table, maxRows)).rows ?? []) as Row[])
  if (wm) {
    if (rows.length && !(wm.column in rows[0])) throw new NonRetryableError(`Watermark column "${wm.column}" is not in ${table}.`)
    if (wm.after != null) rows = rows.filter((r) => r[wm.column] != null && compareWatermarks(r[wm.column], wm.after) > 0)
    rows.sort((a, b) => compareWatermarks(a[wm.column], b[wm.column]))
  }
  return rows
}

/**
 * Sample tests of a Join: the rows of a source whose key column matches these
 * normalized keys (lib/pipelines/join.ts normalizeKeyPart, mirrored in SQL),
 * so a test shows "18 of 25 matched" instead of reading the whole lane. SQL
 * sources and file uploads only; null for the rest (the caller reads up to
 * 5,000 rows and filters). The caller checks each row's key exactly again.
 */
export async function readRowsByKeys(
  source: StoredDataSource,
  table: string,
  column: string,
  keys: string[],
  normalize: { trim: boolean; ignoreCase: boolean; leadingZeros: boolean },
  limit = 5000
): Promise<Row[] | null> {
  if (!keys.length) return []
  if (agentOf(source)) return null
  const pgExpr = (col: string) => {
    let e = `${qIdent(col)}::text`
    if (normalize.trim) e = `btrim(${e})`
    if (normalize.ignoreCase) e = `lower(${e})`
    if (normalize.leadingZeros) e = `regexp_replace(${e}, '^0+(?=.)', '')`
    return e
  }
  const pg = pgTarget(source)
  if (pg) {
    const p = externalPgPool(pg.connectionString, pg.tls)
    try {
      const res = await p.query(`SELECT * FROM ${qIdent(pg.schema)}.${qIdent(table)} WHERE ${pgExpr(column)} = ANY($1::text[]) LIMIT $2`, [keys, limit])
      return res.rows as Row[]
    } finally {
      await p.end()
    }
  }
  if (source.sourceType === 'file') {
    const { rawRel, physicalTable, ROW_COLUMN } = await import('@/lib/connectors/drivers/file')
    const res = await nexusPool.query(`SELECT * FROM ${rawRel(physicalTable(credentialsOf(source).storageKey ?? '', table))} WHERE ${pgExpr(column)} = ANY($1::text[]) ORDER BY ${qIdent(ROW_COLUMN)} LIMIT $2`, [keys, limit])
    return res.rows.map(({ [ROW_COLUMN]: _r, ...rest }) => rest as Row)
  }
  if (source.sourceType === 'mysql') {
    let e = `CAST(${mIdent(column)} AS CHAR)`
    if (normalize.trim) e = `TRIM(${e})`
    if (normalize.ignoreCase) e = `LOWER(${e})`
    if (normalize.leadingZeros) e = `TRIM(LEADING '0' FROM ${e})`
    const conn = await mysql.createConnection(mysqlConfig(credentialsOf(source)) as mysql.ConnectionOptions)
    try {
      // TRIM(LEADING '0') also empties "000": compare the stripped keys, then check exactly in the caller.
      const wanted = normalize.leadingZeros ? keys.map((k) => k.replace(/^0+/, '')) : keys
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT * FROM ${mIdent(table)} WHERE ${e} IN (?) LIMIT ?`, [wanted, limit])
      return rows as Row[]
    } finally {
      await conn.end()
    }
  }
  return null
}

// ── Column helpers ───────────────────────────────────────────────────────────

const PG_TYPES: Record<ColumnType, string> = {
  text: 'text', integer: 'bigint', numeric: 'numeric', boolean: 'boolean', date: 'date', timestamp: 'timestamptz', json: 'jsonb',
}

function pgValue(v: unknown, type?: ColumnType) {
  if (v === undefined) return null
  if (type === 'json' || (v !== null && typeof v === 'object' && !(v instanceof Date))) return JSON.stringify(v)
  return v
}

// ── Nexus datasets (nexus_data schema in the Nexus DB) ───────────────────────

export function datasetTableName(workspaceId: string, datasetName: string) {
  const owner = createHash('sha1').update(workspaceId).digest('hex').slice(0, 8)
  return `ds_${owner}_${datasetName}`.slice(0, 63)
}

async function insertBatches(
  client: PoolClient,
  target: string,
  columns: OutputColumn[],
  rows: Row[],
  conflict?: { keys: string[] },
  /** Nexus datasets: stamp each row with the run that wrote it (soft-delete, API updated_since). */
  runId?: string,
  chunk?: number
) {
  const stampChunk = Boolean(runId) && chunk !== undefined
  const colSql = [...columns.map((c) => qIdent(c.name)), ...(runId ? ['"_nexus_run_id"'] : []), ...(stampChunk ? ['"_nexus_chunk"'] : [])].join(', ')
  const perBatch = Math.max(1, Math.floor(30000 / Math.max(columns.length + 1, 1)))
  for (let i = 0; i < rows.length; i += perBatch) {
    const batch = rows.slice(i, i + perBatch)
    const params: unknown[] = []
    const values = batch
      .map((row) => {
        const cells = columns.map((c) => { params.push(pgValue(row[c.name], c.type)); return `$${params.length}` })
        if (runId) {
          params.push(runId)
          cells.push(`$${params.length}`)
        }
        if (stampChunk) {
          params.push(chunk)
          cells.push(`$${params.length}`)
        }
        return `(${cells.join(', ')})`
      })
      .join(', ')
    let sql = `INSERT INTO ${target} (${colSql}) VALUES ${values}`
    if (conflict) {
      const updates = columns.filter((c) => !conflict.keys.includes(c.name)).map((c) => `${qIdent(c.name)} = EXCLUDED.${qIdent(c.name)}`)
      if (runId) updates.push('"_nexus_run_id" = EXCLUDED."_nexus_run_id"', '"_nexus_loaded_at" = now()', '"_nexus_deleted_at" = NULL')
      if (stampChunk) updates.push('"_nexus_chunk" = EXCLUDED."_nexus_chunk"')
      sql += ` ON CONFLICT (${conflict.keys.map(qIdent).join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`
    }
    await client.query(sql, params)
  }
}

/** System columns every dataset table has (see drizzle/0014). */
const SYSTEM_COLUMNS = [
  '"_nexus_loaded_at" timestamptz NOT NULL DEFAULT now()',
  '"_nexus_id" bigint GENERATED BY DEFAULT AS IDENTITY',
  '"_nexus_run_id" text',
  '"_nexus_deleted_at" timestamptz',
  /** Chunk of the run that wrote the row: a resumed chunk replaces its own earlier copy (exactly-once appends, TD-17). */
  '"_nexus_chunk" integer',
]

export async function writeDataset(opts: {
  workspaceId: string
  /** Physical table of an existing dataset (kept as-is when it predates workspaces). */
  existingTableName?: string
  datasetName: string
  mode: 'append' | 'upsert' | 'replace'
  keys: string[]
  columns: OutputColumn[]
  rows: Row[]
  /** The run writing these rows (stamped on each row). */
  runId?: string
  /** Chunk number within the run: appends of the same run+chunk replace each other, so a resumed chunk is written once. */
  chunk?: number
  /** Append only: first delete live rows whose values in these columns match an incoming row (replays into "replace" datasets, TD-24). */
  replaceKeys?: string[]
  /** Defined datasets: every schema column, so the table (or a replace run's staging copy) has them all even when this write maps only some. */
  tableColumns?: OutputColumn[]
}): Promise<{ written: number; tableName: string; rowCount: number }> {
  const tableName = opts.existingTableName ?? datasetTableName(opts.workspaceId, opts.datasetName)
  const target = `"nexus_data".${qIdent(tableName)}`
  const client = await nexusPool.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE SCHEMA IF NOT EXISTS "nexus_data"')
    const tableColumns = [...(opts.tableColumns ?? []), ...opts.columns.filter((c) => !(opts.tableColumns ?? []).some((t) => t.name === c.name))]
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${target} (${[
        ...tableColumns.map((c) => `${qIdent(c.name)} ${PG_TYPES[c.type]}`),
        ...SYSTEM_COLUMNS,
      ].join(', ')})`
    )
    for (const sys of SYSTEM_COLUMNS) await client.query(`ALTER TABLE ${target} ADD COLUMN IF NOT EXISTS ${sys}`)
    // Schema evolution: add columns introduced by newer pipeline versions.
    for (const c of tableColumns) {
      await client.query(`ALTER TABLE ${target} ADD COLUMN IF NOT EXISTS ${qIdent(c.name)} ${PG_TYPES[c.type]}`)
    }
    if (opts.mode === 'replace') await client.query(`TRUNCATE ${target}`)
    if (opts.mode === 'append' && opts.runId && opts.chunk !== undefined) {
      // Exactly-once appends (TD-17): if this chunk was written before a crash, drop that copy in the same transaction.
      const idx = `ix_${createHash('sha1').update(`${tableName}:run_chunk`).digest('hex').slice(0, 12)}`
      await client.query(`CREATE INDEX IF NOT EXISTS ${qIdent(idx)} ON ${target} ("_nexus_run_id", "_nexus_chunk")`)
      await client.query(`DELETE FROM ${target} WHERE "_nexus_run_id" = $1 AND "_nexus_chunk" = $2`, [opts.runId, opts.chunk])
    }
    if (opts.mode === 'append' && opts.replaceKeys?.length && opts.rows.length) {
      const keys = opts.replaceKeys
      const text = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v))
      for (let i = 0; i < opts.rows.length; i += 1000) {
        const params: string[] = []
        const tuples = opts.rows.slice(i, i + 1000).map((r) => `(${keys.map((k) => (params.push(text(r[k])), `$${params.length}`)).join(', ')})`)
        await client.query(`DELETE FROM ${target} WHERE (${keys.map((k) => `coalesce(${qIdent(k)}::text, '')`).join(', ')}) IN (${tuples.join(', ')})`, params)
      }
    }
    if (opts.mode === 'upsert') {
      const idx = `ux_${createHash('sha1').update(tableName + opts.keys.join(',')).digest('hex').slice(0, 12)}`
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${qIdent(idx)} ON ${target} (${opts.keys.map(qIdent).join(', ')})`)
    }
    if (opts.rows.length) {
      await insertBatches(client, target, opts.columns, opts.rows, opts.mode === 'upsert' ? { keys: opts.keys } : undefined, opts.runId, opts.chunk)
    }
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${target} WHERE "_nexus_deleted_at" IS NULL`)
    await client.query('COMMIT')
    return { written: opts.rows.length, tableName, rowCount: rows[0].n }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Latest rows of a dataset, without system columns or soft-deleted rows. */
export async function readDatasetSample(tableName: string, limit = 50, rowFilters: RowFilter[] = [], columns?: string[]) {
  const params: unknown[] = [limit]
  const bind = (v: unknown) => (params.push(v), `$${params.length}`)
  const known = new Set(columns ?? rowFilters.map((f) => f.column))
  const where = ['"_nexus_deleted_at" IS NULL', ...rowFilterSql(rowFilters, known, bind)]
  const { rows } = await nexusPool.query(
    `SELECT * FROM "nexus_data".${qIdent(tableName)} WHERE ${where.join(' AND ')} ORDER BY "_nexus_loaded_at" DESC LIMIT $1`,
    params
  )
  return (rows as Row[]).map(({ _nexus_id, _nexus_run_id, _nexus_deleted_at, _nexus_chunk, ...rest }) => rest)
}

/** PD-6: after a full upsert run, rows this run didn't write are marked deleted. Returns how many. */
export async function softDeleteDatasetMissing(tableName: string, runId: string): Promise<number> {
  const res = await nexusPool.query(
    `UPDATE "nexus_data".${qIdent(tableName)} SET "_nexus_deleted_at" = now() WHERE "_nexus_run_id" IS DISTINCT FROM $1 AND "_nexus_deleted_at" IS NULL`,
    [runId]
  )
  return res.rowCount ?? 0
}

/** Distinct values of a dataset column (exists_in lookups), excluding soft-deleted rows. */
export async function readDatasetColumnValues(tableName: string, column: string, limit = 1_000_000): Promise<Set<string>> {
  const { rows } = await nexusPool.query<{ v: string }>(
    `SELECT DISTINCT ${qIdent(column)}::text AS v FROM "nexus_data".${qIdent(tableName)} WHERE "_nexus_deleted_at" IS NULL AND ${qIdent(column)} IS NOT NULL LIMIT $1`,
    [limit]
  )
  return new Set(rows.map((r) => r.v))
}

/** key → value pairs of two dataset columns, for lookup transforms (first value wins for duplicate keys). */
export async function readDatasetPairs(tableName: string, keyColumn: string, valueColumn: string, limit = 500_000): Promise<Map<string, unknown>> {
  const { rows } = await nexusPool.query<{ k: string; v: unknown }>(
    `SELECT DISTINCT ON (${qIdent(keyColumn)}::text) ${qIdent(keyColumn)}::text AS k, ${qIdent(valueColumn)} AS v FROM "nexus_data".${qIdent(tableName)}
      WHERE "_nexus_deleted_at" IS NULL AND ${qIdent(keyColumn)} IS NOT NULL ORDER BY ${qIdent(keyColumn)}::text, "_nexus_loaded_at" DESC LIMIT $1`,
    [limit]
  )
  return new Map(rows.map((r) => [r.k.trim(), r.v]))
}

export async function dropDatasetTable(tableName: string) {
  await nexusPool.query(`DROP TABLE IF EXISTS "nexus_data".${qIdent(tableName)}`)
}

/**
 * Enrich and "Changes data" calls to a REST data source, directly or through
 * the Nexus Agent next to an intranet API (agent 1.4.0+). Answers already
 * received come back with the error that stopped the rest.
 */
export async function sendApiCalls(
  source: StoredDataSource,
  calls: ApiCall[],
  opts: { maxRequestsPerSecond: number; concurrency: number; timeoutSeconds: number; deadline?: number; writes: boolean }
): Promise<CallsResult> {
  if (source.sourceType !== 'rest') throw new NonRetryableError(`"${source.name}" is not a REST API data source.`)
  if (!calls.length) return { answers: [] }
  const options = { maxRequestsPerSecond: opts.maxRequestsPerSecond, concurrency: opts.concurrency, timeoutSeconds: opts.timeoutSeconds }
  const via = agentOf(source)
  if (!via) {
    const { sendRestCalls } = await import('@/lib/connectors/rest/call')
    return sendRestCalls(credentialsOf(source), calls, { ...options, deadline: opts.deadline })
  }
  const budgetMs = Math.min(opts.deadline ? Math.max(5_000, opts.deadline - Date.now()) : 170_000, 170_000)
  const out: CallsResult = { answers: [] }
  for (let i = 0; i < calls.length; i += 500) {
    const part = calls.slice(i, i + 500)
    const res = (await callAgent(via.agentId, 'apiCall', { connection: via.connection, request: agentRequestOf(source), calls: part, options, writes: opts.writes, budgetMs }, { timeoutMs: budgetMs + 10_000, workspaceId: via.workspaceId })) as CallsResult
    out.answers.push(...part.map((_, j) => res.answers?.[j] ?? undefined))
    if (res.error) return { ...out, error: res.error }
  }
  return out
}

/** JSON-safe value for HTTP destinations (dates as ISO text, bigint as text). */
const jsonValue = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? v.toString() : v === undefined ? null : v)

// ── Write back into a connected database ─────────────────────────────────────

/**
 * PD-6 for databases: marks rows whose key the run didn't write. `isSeen` says
 * whether a key (values joined with \u0001) was written. The marker column is a
 * boolean (set true) or a timestamp (set now). Works directly and through a
 * Nexus Agent: the keys of not-yet-deleted rows are read in pages, the missing
 * ones are computed here, then marked in batches. Returns how many were marked.
 */
export async function softDeleteDataSourceMissing(opts: {
  source: StoredDataSource
  table: string
  keys: string[]
  column: string
  isSeen: (key: string) => boolean
}): Promise<number> {
  const { source, table, keys, column } = opts
  const via = agentOf(source)
  const listPage = (offset: number) =>
    via
      ? (callAgent(via.agentId, 'activeKeys', { connection: via.connection, table, keys, column, offset, limit: ACTIVE_KEYS_PAGE }, { timeoutMs: 180_000, workspaceId: via.workspaceId }) as Promise<string[][]>)
      : listActiveKeys(source, { table, keys, column, offset, limit: ACTIVE_KEYS_PAGE })
  const missing: string[][] = []
  for (let offset = 0; ; offset += ACTIVE_KEYS_PAGE) {
    const page = await listPage(offset)
    if (!Array.isArray(page)) throw new NonRetryableError('The Nexus Agent is too old to mark missing rows deleted. Update it to version 1.1.0 or later.')
    for (const k of page) if (!opts.isSeen(k.join('\u0001'))) missing.push(k)
    if (page.length < ACTIVE_KEYS_PAGE) break
  }
  let marked = 0
  for (let i = 0; i < missing.length; i += MARK_DELETED_BATCH) {
    const batch = missing.slice(i, i + MARK_DELETED_BATCH)
    marked += via
      ? ((await callAgent(via.agentId, 'markDeleted', { connection: via.connection, table, keys, column, keyValues: batch }, { timeoutMs: 180_000, workspaceId: via.workspaceId })) as number)
      : await markRowsDeleted(source, { table, keys, column, keyValues: batch })
  }
  return marked
}

export const ACTIVE_KEYS_PAGE = 20_000
export const MARK_DELETED_BATCH = 1000

async function deletedMarker(p: ReturnType<typeof externalPgPool>, schema: string, table: string, column: string) {
  const { rows: info } = await p.query<{ data_type: string }>(
    'SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3',
    [schema, table, column]
  )
  if (!info.length) throw new NonRetryableError(`Column ${column} is not in ${schema}.${table}.`)
  const isBool = info[0].data_type === 'boolean'
  return { isBool, active: isBool ? `(${qIdent(column)} IS NOT TRUE)` : `(${qIdent(column)} IS NULL)` }
}

function softDeleteTarget(source: StoredDataSource) {
  const pg = pgTarget(source)
  if (!pg) throw new NonRetryableError('Marking missing rows deleted is supported for PostgreSQL destinations.')
  return pg
}

/** One page of the keys (as text) of rows not yet marked deleted, in a stable order. */
export async function listActiveKeys(source: StoredDataSource, opts: { table: string; keys: string[]; column: string; offset: number; limit: number }): Promise<string[][]> {
  const pg = softDeleteTarget(source)
  const p = externalPgPool(pg.connectionString, pg.tls)
  try {
    const { active } = await deletedMarker(p, pg.schema, opts.table, opts.column)
    const cols = opts.keys.map((k) => `${qIdent(k)}::text`)
    const { rows } = await p.query(
      `SELECT ${opts.keys.map((k) => `${qIdent(k)}::text AS ${qIdent(k)}`).join(', ')} FROM ${qIdent(pg.schema)}.${qIdent(opts.table)} WHERE ${active} ORDER BY ${cols.join(', ')} LIMIT $1 OFFSET $2`,
      [opts.limit, opts.offset]
    )
    return (rows as Row[]).map((r) => opts.keys.map((k) => String(r[k] ?? '')))
  } finally {
    await p.end()
  }
}

/** Marks the rows with these key values deleted (only rows not marked yet). */
export async function markRowsDeleted(source: StoredDataSource, opts: { table: string; keys: string[]; column: string; keyValues: string[][] }): Promise<number> {
  if (!opts.keyValues.length) return 0
  const pg = softDeleteTarget(source)
  const p = externalPgPool(pg.connectionString, pg.tls)
  try {
    const { isBool, active } = await deletedMarker(p, pg.schema, opts.table, opts.column)
    const params: unknown[] = []
    const tuples = opts.keyValues.map((values) => `(${opts.keys.map((_k, i) => (params.push(values[i] ?? ''), `$${params.length}`)).join(', ')})`)
    const res = await p.query(
      `UPDATE ${qIdent(pg.schema)}.${qIdent(opts.table)} SET ${qIdent(opts.column)} = ${isBool ? 'true' : 'now()'} WHERE ${active} AND (${opts.keys.map((k) => `${qIdent(k)}::text`).join(', ')}) IN (${tuples.join(', ')})`,
      params
    )
    return res.rowCount ?? 0
  } finally {
    await p.end()
  }
}

export async function writeToDataSource(opts: {
  source: StoredDataSource
  table: string
  mode: 'append' | 'upsert'
  keys: string[]
  columns: OutputColumn[]
  rows: Row[]
  runId?: string
  chunk?: number
  /** REST API destination step: the request to send per row or batch. */
  api?: ApiDestinationSpec
  /** Epoch ms the write must finish by (API writes stop early and fail the chunk instead). */
  deadline?: number
}): Promise<{ written: number; rejected?: { row: Row; error: string; errors?: string[] }[] }> {
  const { source, table, rows } = opts
  if ((source.config as { role?: string } | null)?.role !== 'destination') {
    throw new NonRetryableError(`"${source.name}" was added as a source, so Nexus won't write to it. Add the database again with Data Sources → Add Destination and pick that one.`)
  }
  if (source.sourceType === 'rest' || opts.api) {
    if (source.sourceType !== 'rest' || !opts.api) throw new NonRetryableError(`"${source.name}" is a REST API: write to it with an API request in the Destination step.`)
    return writeApi(source, opts.api, rows, { runId: opts.runId, chunk: opts.chunk, deadline: opts.deadline })
  }

  const via = agentOf(source)
  if (via) {
    let written = 0
    const rejected: { row: Row; error: string }[] = []
    for (let i = 0; i < rows.length; i += WRITE_BATCH_ROWS) {
      const batch = rows.slice(i, i + WRITE_BATCH_ROWS).map((r) => Object.fromEntries(opts.columns.map((c) => [c.name, jsonValue(r[c.name])])))
      const res = (await callAgent(via.agentId, 'write', { connection: via.connection, table, mode: opts.mode, keys: opts.keys, columns: opts.columns, rows: batch, runId: opts.runId, chunk: opts.chunk }, { timeoutMs: 180_000, workspaceId: via.workspaceId })) as { written: number; rejected?: { row: Row; error: string }[] }
      written += res.written
      rejected.push(...(res.rejected ?? []))
    }
    return { written, rejected }
  }

  const pg = pgTarget(source)
  if (pg) {
    const p = externalPgPool(pg.connectionString, pg.tls)
    const client = await p.connect()
    try {
      const { rows: existing } = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [pg.schema, table]
      )
      if (!existing.length) throw new NonRetryableError(`Table ${pg.schema}.${table} doesn't exist in "${source.name}". Nexus never creates tables in your databases; create it first.`)
      const present = new Set(existing.map((r) => r.column_name))
      const missing = opts.columns.filter((c) => !present.has(c.name)).map((c) => c.name)
      if (missing.length) throw new NonRetryableError(`Columns missing in ${table}: ${missing.join(', ')}. Rename them in the Map step or add them to the table.`)
      await client.query('BEGIN')
      if (rows.length) {
        await insertBatches(client, `${qIdent(pg.schema)}.${qIdent(table)}`, opts.columns, rows, opts.mode === 'upsert' ? { keys: opts.keys } : undefined)
      }
      await client.query('COMMIT')
      return { written: rows.length }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
      await p.end()
    }
  }

  if (source.sourceType === 'mysql') {
    const conn = await mysql.createConnection(mysqlConfig(credentialsOf(source)) as mysql.ConnectionOptions)
    try {
      const [cols] = await conn.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${mIdent(table)}`)
      const present = new Set(cols.map((c) => String(c.Field)))
      const missing = opts.columns.filter((c) => !present.has(c.name)).map((c) => c.name)
      if (missing.length) throw new NonRetryableError(`Columns missing in ${table}: ${missing.join(', ')}.`)
      await conn.beginTransaction()
      const names = opts.columns.map((c) => mIdent(c.name)).join(', ')
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map((row) => opts.columns.map((c) => { const v = pgValue(row[c.name], c.type); return v }))
        let sql = `INSERT INTO ${mIdent(table)} (${names}) VALUES ?`
        if (opts.mode === 'upsert') {
          const updates = opts.columns.filter((c) => !opts.keys.includes(c.name)).map((c) => `${mIdent(c.name)} = VALUES(${mIdent(c.name)})`)
          sql += updates.length ? ` ON DUPLICATE KEY UPDATE ${updates.join(', ')}` : ''
        }
        await conn.query(sql, [batch])
      }
      await conn.commit()
      return { written: rows.length }
    } catch (err) {
      await conn.rollback().catch(() => undefined)
      throw err
    } finally {
      await conn.end()
    }
  }

  if (source.sourceType === 'kmplus') {
    // KMPlus products upsert by the entity key (Nexus Ingest Contract); append and upsert behave the same.
    const { writeKmplusEntity } = await import('@/lib/connectors/drivers/kmplus')
    const clean = rows.map((r) => Object.fromEntries(opts.columns.map((c) => [c.name, jsonValue(r[c.name])])))
    return writeKmplusEntity(credentialsOf(source), table, clean, { runId: opts.runId, chunk: opts.chunk })
  }

  if (source.sourceType === 'supabase') {
    throw new NonRetryableError(`To write into Supabase, add the Database URL to "${source.name}" (Data Sources → edit credentials).`)
  }
  throw new NonRetryableError(`Writing to ${source.sourceType} isn't supported yet. Writable connectors: PostgreSQL, MySQL, Supabase (with Database URL), KMPlus products, REST APIs.`)
}

/** Rows to a REST API destination, directly or through the Nexus Agent next to an intranet API. */
async function writeApi(source: StoredDataSource, api: ApiDestinationSpec, rows: Row[], opts: { runId?: string; chunk?: number; deadline?: number }) {
  const via = agentOf(source)
  if (!via) {
    const { writeRestApi } = await import('@/lib/connectors/rest/write')
    return writeRestApi(credentialsOf(source), api, rows, opts)
  }
  // Agent calls carry whole batches, so batch numbers (and idempotency keys) match a direct write.
  const perCall = isBatchBody(api.body.template) ? Math.max(api.batchSize, Math.floor(WRITE_BATCH_ROWS / api.batchSize) * api.batchSize) : WRITE_BATCH_ROWS
  let written = 0
  const rejected: { row: Row; error: string; errors?: string[] }[] = []
  for (let i = 0; i < rows.length; i += perCall) {
    const part = rows.slice(i, i + perCall)
    const budgetMs = opts.deadline ? Math.max(5_000, opts.deadline - Date.now()) : 170_000
    const res = (await callAgent(
      via.agentId,
      'apiWrite',
      { connection: via.connection, request: agentRequestOf(source), api, rows: part.map(wireRow), runId: opts.runId, chunk: opts.chunk, rowOffset: i, budgetMs: Math.min(budgetMs, 170_000) },
      { timeoutMs: Math.min(budgetMs, 170_000) + 10_000, workspaceId: via.workspaceId }
    )) as { written: number; rejected?: { rowIndex: number; error: string; errors?: string[] }[] }
    written += res.written
    for (const r of res.rejected ?? []) if (part[r.rowIndex]) rejected.push({ row: part[r.rowIndex], error: r.error, errors: r.errors })
  }
  return { written, rejected }
}

// ── Chunked reads (background worker) ────────────────────────────────────────

export interface ChunkRead {
  rows: Row[]
  /** No rows after this chunk. */
  exhausted: boolean
  /** Column types the source database reported (SQL sources only). */
  types?: Record<string, ColumnType>
}

/** Postgres type OIDs → dataset column types. */
const PG_OID_TYPES: Record<number, ColumnType> = {
  20: 'integer', 21: 'integer', 23: 'integer', 700: 'numeric', 701: 'numeric', 1700: 'numeric',
  16: 'boolean', 1082: 'date', 1114: 'timestamp', 1184: 'timestamp', 114: 'json', 3802: 'json',
}
/** mysql2 column type codes → dataset column types. */
const MYSQL_TYPES: Record<number, ColumnType> = {
  1: 'integer', 2: 'integer', 3: 'integer', 8: 'integer', 9: 'integer', 4: 'numeric', 5: 'numeric', 0: 'numeric', 246: 'numeric',
  10: 'date', 7: 'timestamp', 12: 'timestamp', 245: 'json',
}

/** Per-invocation cache: API reads (read once, sliced per chunk) and resolved sort keys. */
export type ReadCache = Map<string, unknown>

async function pgOrderKeys(p: ReturnType<typeof externalPgPool>, schema: string, table: string, cache: ReadCache): Promise<string[]> {
  const key = `pgkeys:${schema}.${table}`
  if (cache.has(key)) return cache.get(key) as string[]
  const rel = `${qIdent(schema)}.${qIdent(table)}`
  const { rows } = await p.query<{ attname: string; relkind: string }>(
    `SELECT a.attname, c.relkind
       FROM pg_class c
       LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE c.oid = to_regclass($1)
      ORDER BY array_position(i.indkey::int2[], a.attnum)`,
    [rel]
  )
  // Primary key, else the physical row id for plain tables; views get no tiebreaker.
  const pk = rows.map((r) => r.attname).filter(Boolean).map(qIdent)
  const order = pk.length ? pk : rows[0] && ['r', 'p'].includes(rows[0].relkind) ? ['ctid'] : []
  cache.set(key, order)
  return order
}

async function mysqlOrderKeys(conn: mysql.Connection, table: string, cache: ReadCache): Promise<string[]> {
  const key = `mykeys:${table}`
  if (cache.has(key)) return cache.get(key) as string[]
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`,
    [table]
  )
  const order = rows.map((r) => mIdent(String(r.COLUMN_NAME)))
  cache.set(key, order)
  return order
}

/**
 * Reads rows [offset, offset + limit) of a source in a stable order (watermark
 * column for incremental syncs, then the primary key), so consecutive chunks,
 * even in different function invocations, neither skip nor repeat rows.
 * Sources without server-side paging (APIs) are read once per invocation and sliced.
 */
export async function readSourceChunk(
  source: StoredDataSource,
  table: string,
  opts: { offset: number; limit: number; maxRows: number; watermark?: ReadOptions['watermark']; cache: ReadCache }
): Promise<ChunkRead> {
  const { offset, cache } = opts
  const limit = Math.max(0, Math.min(opts.limit, opts.maxRows - offset))
  if (limit === 0) return { rows: [], exhausted: true }
  const wm = opts.watermark
  const via = agentOf(source)
  if (via) {
    // One agent-side cache per worker invocation, like the cache passed in here.
    let cacheKey = cache.get('agent:cacheKey') as string | undefined
    if (!cacheKey) cache.set('agent:cacheKey', (cacheKey = randomUUID()))
    return (await callAgent(via.agentId, 'readChunk', { connection: via.connection, request: agentRequestOf(source), table, offset, limit, maxRows: opts.maxRows, watermark: wm, cacheKey }, { timeoutMs: 180_000, workspaceId: via.workspaceId })) as ChunkRead
  }
  const pg = pgTarget(source)
  if (pg) {
    const p = externalPgPool(pg.connectionString, pg.tls)
    try {
      const order = [...(wm ? [qIdent(wm.column)] : []), ...(await pgOrderKeys(p, pg.schema, table, cache))]
      const params: unknown[] = [limit, offset]
      if (wm?.after != null) params.push(wm.after)
      const res = await p.query(
        `SELECT * FROM ${qIdent(pg.schema)}.${qIdent(table)} ${wm?.after != null ? `WHERE ${qIdent(wm.column)} > $3` : ''} ${order.length ? `ORDER BY ${order.join(', ')}` : ''} LIMIT $1 OFFSET $2`,
        params
      )
      const types = Object.fromEntries(res.fields.flatMap((f) => (PG_OID_TYPES[f.dataTypeID] ? [[f.name, PG_OID_TYPES[f.dataTypeID]]] : [])))
      return { rows: res.rows as Row[], exhausted: res.rows.length < limit || offset + limit >= opts.maxRows, types }
    } finally {
      await p.end()
    }
  }

  if (source.sourceType === 'mysql') {
    const conn = await mysql.createConnection(mysqlConfig(credentialsOf(source)) as mysql.ConnectionOptions)
    try {
      const order = [...(wm ? [mIdent(wm.column)] : []), ...(await mysqlOrderKeys(conn, table, cache))]
      const params: unknown[] = wm?.after != null ? [wm.after, limit, offset] : [limit, offset]
      const [rows, fields] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT * FROM ${mIdent(table)} ${wm?.after != null ? `WHERE ${mIdent(wm.column)} > ?` : ''} ${order.length ? `ORDER BY ${order.join(', ')}` : ''} LIMIT ? OFFSET ?`,
        params
      )
      const types = Object.fromEntries((fields ?? []).flatMap((f) => (f.type !== undefined && MYSQL_TYPES[f.type] ? [[f.name, MYSQL_TYPES[f.type]]] : [])))
      return { rows: rows as Row[], exhausted: rows.length < limit || offset + limit >= opts.maxRows, types }
    } finally {
      await conn.end()
    }
  }

  if (source.sourceType === 'sqlserver') {
    const read = await readSqlServerChunk(credentialsOf(source), table, { offset, limit, watermark: wm, cache })
    return { rows: read.rows, exhausted: read.rows.length < limit || offset + limit >= opts.maxRows, types: read.types }
  }

  if (source.sourceType === 'file') {
    const rows = await readFileChunk(credentialsOf(source).storageKey ?? '', table, { offset, limit, watermark: wm })
    return { rows, exhausted: rows.length < limit || offset + limit >= opts.maxRows, types: fileTypeHints(source, table) }
  }

  // Supabase REST and API connectors: one capped read per invocation, then slices.
  const key = `rows:${source.id}:${table}:${wm?.after ?? ''}`
  let all = cache.get(key) as Row[] | undefined
  if (!all) {
    all = await readSourceRows(source, table, opts.maxRows, { watermark: wm })
    cache.set(key, all)
  }
  const rows = all.slice(offset, offset + limit)
  return { rows, exhausted: offset + rows.length >= all.length }
}

/** Column types detected when the file was uploaded (values are stored as text). */
function fileTypeHints(source: StoredDataSource, table: string): Record<string, ColumnType> {
  const files = ((source.config ?? {}) as { files?: { table: string; columns: { name: string; type: ColumnType }[] }[] }).files ?? []
  const f = files.find((x) => x.table === table)
  return Object.fromEntries((f?.columns ?? []).filter((c) => c.type !== 'text').map((c) => [c.name, c.type]))
}

// ── Dataset replace via staging table ────────────────────────────────────────
// A replace run loads into a staging table and swaps it in only when the whole
// run succeeds, so readers never see a half-loaded dataset.

export function stagingTableName(tableName: string, runId: string) {
  return `${tableName.slice(0, 44)}__stg_${createHash('sha1').update(runId).digest('hex').slice(0, 8)}`
}

/** Swaps the staging table in for the dataset table. No staging table (no rows) empties the dataset. */
export async function finalizeDatasetReplace(tableName: string, staging: string): Promise<number> {
  const target = `"nexus_data".${qIdent(tableName)}`
  const stagingRel = `"nexus_data".${qIdent(staging)}`
  const exists = async (client: PoolClient, rel: string) =>
    (await client.query<{ r: string | null }>('SELECT to_regclass($1)::text AS r', [rel])).rows[0].r !== null
  const client = await nexusPool.connect()
  try {
    await client.query('BEGIN')
    if (await exists(client, stagingRel)) {
      await client.query(`DROP TABLE IF EXISTS ${target}`)
      await client.query(`ALTER TABLE ${stagingRel} RENAME TO ${qIdent(tableName)}`)
    } else if (await exists(client, target)) {
      await client.query(`TRUNCATE ${target}`)
    }
    const n = (await exists(client, target)) ? (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${target}`)).rows[0].n : 0
    await client.query('COMMIT')
    return n
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

// ── Live queries (DV-1 / DV-3) ───────────────────────────────────────────────
// Catalog tables in "live" mode are read from the source on demand, read-only,
// with a row limit and a timeout. Equality filters are pushed down to SQL
// sources (PostgreSQL, MySQL, SQL Server, file uploads); other connectors read up to the
// limit and filter in Nexus.

export interface LiveQueryResult {
  rows: Row[]
  /** Filters ran in the source's query. */
  pushdown: boolean
  /** More rows may exist past the limit. */
  truncated: boolean
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s and was stopped.`)), ms)
    }),
  ])
}

export async function liveQuery(
  source: StoredDataSource,
  table: string,
  opts: { limit: number; timeoutMs: number; filters?: { column: string; value: string }[] }
): Promise<LiveQueryResult> {
  const limit = Math.max(1, Math.min(opts.limit, 10_000))
  const filters = opts.filters ?? []
  const take = limit + 1
  const finish = (rows: Row[], pushdown: boolean): LiveQueryResult => ({ rows: rows.slice(0, limit), pushdown, truncated: rows.length > limit })

  const via = agentOf(source)
  if (via) return (await callAgent(via.agentId, 'liveQuery', { connection: via.connection, request: agentRequestOf(source), table, limit, timeoutMs: Math.min(opts.timeoutMs, 120_000), filters }, { timeoutMs: opts.timeoutMs + 15_000, workspaceId: via.workspaceId })) as LiveQueryResult

  const pg = pgTarget(source)
  if (pg) {
    const p = externalPgPool(pg.connectionString, pg.tls)
    const client = await p.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query(`SET LOCAL statement_timeout = ${Math.round(opts.timeoutMs)}`)
      const params: unknown[] = [take]
      const where = filters.map((f) => (params.push(f.value), `${qIdent(f.column)}::text = $${params.length}`))
      const res = await client.query(`SELECT * FROM ${qIdent(pg.schema)}.${qIdent(table)} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} LIMIT $1`, params)
      await client.query('ROLLBACK')
      return finish(res.rows as Row[], true)
    } finally {
      client.release()
      await p.end()
    }
  }

  if (source.sourceType === 'mysql') {
    const conn = await mysql.createConnection(mysqlConfig(credentialsOf(source)) as mysql.ConnectionOptions)
    try {
      await conn.query('START TRANSACTION READ ONLY')
      const params: unknown[] = filters.map((f) => f.value)
      const where = filters.map((f) => `CAST(${mIdent(f.column)} AS CHAR) = ?`)
      const [rows] = await conn.query<mysql.RowDataPacket[]>({
        sql: `SELECT * FROM ${mIdent(table)} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} LIMIT ?`,
        values: [...params, take],
        timeout: opts.timeoutMs,
      })
      await conn.query('ROLLBACK')
      return finish(rows as Row[], true)
    } finally {
      await conn.end()
    }
  }

  if (source.sourceType === 'sqlserver') {
    // Only a SELECT we build (identifiers quoted, values bound) runs, with the request timeout.
    return finish(await liveSqlServerQuery(credentialsOf(source), table, { take, timeoutMs: opts.timeoutMs, filters }), true)
  }

  if (source.sourceType === 'file') {
    const { rawRel, physicalTable, ROW_COLUMN } = await import('@/lib/connectors/drivers/file')
    const client = await nexusPool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query(`SET LOCAL statement_timeout = ${Math.round(opts.timeoutMs)}`)
      const params: unknown[] = [take]
      const where = filters.map((f) => (params.push(f.value), `${qIdent(f.column)} = $${params.length}`))
      const rel = rawRel(physicalTable(credentialsOf(source).storageKey ?? '', table))
      const res = await client.query(`SELECT * FROM ${rel} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${qIdent(ROW_COLUMN)} LIMIT $1`, params)
      await client.query('ROLLBACK')
      return finish(res.rows.map(({ [ROW_COLUMN]: _r, ...rest }) => rest as Row), true)
    } finally {
      client.release()
    }
  }

  // API connectors: read up to the limit (no server-side filters), then filter here.
  const rows = await withTimeout(readSourceRows(source, table, filters.length ? Math.min(limit * 10, 10_000) : take), opts.timeoutMs, 'The live query')
  const matched = rows.filter((r) => filters.every((f) => (r[f.column] === null || r[f.column] === undefined ? '' : String(r[f.column])) === f.value))
  return finish(matched, false)
}
