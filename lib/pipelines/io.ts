import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'
import type { PoolClient } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { pool as nexusPool } from '@/lib/db'
import { decryptCredentials } from '@/lib/security/credentials'
import { isConnectorSlug } from '@/lib/connectors/catalog'
import { sampleConnectorTable } from '@/lib/connectors/runtime'
import { createPgPool as externalPgPool } from '@/lib/connectors/drivers/postgres'
import type { ConnectorCredentials } from '@/lib/connectors/types'
import type { ColumnType } from './definition'
import type { Row } from './transforms'
import { compareWatermarks, type OutputColumn } from './columns'

/** Data source row as stored (credentials still encrypted). */
export interface StoredDataSource {
  id: string
  name: string
  sourceType: string
  config: unknown
  credentials: unknown
}

export const WRITABLE_CONNECTORS = ['postgres', 'mysql', 'supabase'] as const

function credentialsOf(source: StoredDataSource): ConnectorCredentials {
  return Object.fromEntries(
    Object.entries(decryptCredentials(source.id, source.credentials)).map(([k, v]) => [k, v == null ? '' : String(v)])
  )
}

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
  // SAP / Salesforce / REST / Snowflake / Oracle / Talenta / LDAP: the connector's capped read.
  // These APIs can't filter by watermark server-side, so filter and order here.
  const result = await sampleConnectorTable(source.sourceType, credentialsOf(source), table, maxRows)
  let rows = (result.rows ?? []) as Row[]
  if (wm) {
    if (rows.length && !(wm.column in rows[0])) throw new NonRetryableError(`Watermark column "${wm.column}" is not in ${table}.`)
    if (wm.after != null) rows = rows.filter((r) => r[wm.column] != null && compareWatermarks(r[wm.column], wm.after) > 0)
    rows.sort((a, b) => compareWatermarks(a[wm.column], b[wm.column]))
  }
  return rows
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
  conflict?: { keys: string[] }
) {
  const colSql = columns.map((c) => qIdent(c.name)).join(', ')
  const perBatch = Math.max(1, Math.floor(30000 / Math.max(columns.length, 1)))
  for (let i = 0; i < rows.length; i += perBatch) {
    const batch = rows.slice(i, i + perBatch)
    const params: unknown[] = []
    const values = batch
      .map((row) => `(${columns.map((c) => { params.push(pgValue(row[c.name], c.type)); return `$${params.length}` }).join(', ')})`)
      .join(', ')
    let sql = `INSERT INTO ${target} (${colSql}) VALUES ${values}`
    if (conflict) {
      const updates = columns.filter((c) => !conflict.keys.includes(c.name)).map((c) => `${qIdent(c.name)} = EXCLUDED.${qIdent(c.name)}`)
      sql += ` ON CONFLICT (${conflict.keys.map(qIdent).join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`
    }
    await client.query(sql, params)
  }
}

export async function writeDataset(opts: {
  workspaceId: string
  /** Physical table of an existing dataset (kept as-is when it predates workspaces). */
  existingTableName?: string
  datasetName: string
  mode: 'append' | 'upsert' | 'replace'
  keys: string[]
  columns: OutputColumn[]
  rows: Row[]
}): Promise<{ written: number; tableName: string; rowCount: number }> {
  const tableName = opts.existingTableName ?? datasetTableName(opts.workspaceId, opts.datasetName)
  const target = `"nexus_data".${qIdent(tableName)}`
  const client = await nexusPool.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE SCHEMA IF NOT EXISTS "nexus_data"')
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${target} (${[
        ...opts.columns.map((c) => `${qIdent(c.name)} ${PG_TYPES[c.type]}`),
        '"_nexus_loaded_at" timestamptz NOT NULL DEFAULT now()',
      ].join(', ')})`
    )
    // Schema evolution: add columns introduced by newer pipeline versions.
    for (const c of opts.columns) {
      await client.query(`ALTER TABLE ${target} ADD COLUMN IF NOT EXISTS ${qIdent(c.name)} ${PG_TYPES[c.type]}`)
    }
    if (opts.mode === 'replace') await client.query(`TRUNCATE ${target}`)
    if (opts.mode === 'upsert') {
      const idx = `ux_${createHash('sha1').update(tableName + opts.keys.join(',')).digest('hex').slice(0, 12)}`
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${qIdent(idx)} ON ${target} (${opts.keys.map(qIdent).join(', ')})`)
    }
    if (opts.rows.length) {
      await insertBatches(client, target, opts.columns, opts.rows, opts.mode === 'upsert' ? { keys: opts.keys } : undefined)
    }
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${target}`)
    await client.query('COMMIT')
    return { written: opts.rows.length, tableName, rowCount: rows[0].n }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function readDatasetSample(tableName: string, limit = 50) {
  const { rows } = await nexusPool.query(`SELECT * FROM "nexus_data".${qIdent(tableName)} ORDER BY "_nexus_loaded_at" DESC LIMIT $1`, [limit])
  return rows as Row[]
}

export async function dropDatasetTable(tableName: string) {
  await nexusPool.query(`DROP TABLE IF EXISTS "nexus_data".${qIdent(tableName)}`)
}

// ── Write back into a connected database ─────────────────────────────────────

export async function writeToDataSource(opts: {
  source: StoredDataSource
  table: string
  mode: 'append' | 'upsert'
  keys: string[]
  columns: OutputColumn[]
  rows: Row[]
}): Promise<{ written: number }> {
  const { source, table, rows } = opts
  if ((source.config as { role?: string } | null)?.role !== 'destination') {
    throw new NonRetryableError(`"${source.name}" was added as a source, so Nexus won't write to it. Add the database again with Data Sources → Add Destination and pick that one.`)
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

  if (source.sourceType === 'supabase') {
    throw new NonRetryableError(`To write into Supabase, add the Database URL to "${source.name}" (Data Sources → edit credentials).`)
  }
  throw new NonRetryableError(`Writing to ${source.sourceType} isn't supported yet. Writable connectors: PostgreSQL, MySQL, Supabase (with Database URL).`)
}

// ── Chunked reads (background worker) ────────────────────────────────────────

export interface ChunkRead {
  rows: Row[]
  /** No rows after this chunk. */
  exhausted: boolean
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
      return { rows: res.rows as Row[], exhausted: res.rows.length < limit || offset + limit >= opts.maxRows }
    } finally {
      await p.end()
    }
  }

  if (source.sourceType === 'mysql') {
    const conn = await mysql.createConnection(mysqlConfig(credentialsOf(source)) as mysql.ConnectionOptions)
    try {
      const order = [...(wm ? [mIdent(wm.column)] : []), ...(await mysqlOrderKeys(conn, table, cache))]
      const params: unknown[] = wm?.after != null ? [wm.after, limit, offset] : [limit, offset]
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT * FROM ${mIdent(table)} ${wm?.after != null ? `WHERE ${mIdent(wm.column)} > ?` : ''} ${order.length ? `ORDER BY ${order.join(', ')}` : ''} LIMIT ? OFFSET ?`,
        params
      )
      return { rows: rows as Row[], exhausted: rows.length < limit || offset + limit >= opts.maxRows }
    } finally {
      await conn.end()
    }
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
