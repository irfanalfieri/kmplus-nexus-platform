import sql from 'mssql'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult, SchemaTable } from '../types'
import type { ColumnType } from '@/lib/pipelines/definition'
import { privateNetworkAllowed } from '@/lib/net/safe-url'

/**
 * Microsoft SQL Server / Azure SQL Database (DS-9): test, schema scan, sample,
 * chunked pipeline reads in a stable order and read-only live queries. Every
 * identifier is bracket-quoted and every value bound as a parameter. Reads
 * only: Nexus never writes to SQL Server yet.
 */

type Row = Record<string, unknown>

const flag = (v: string | undefined, fallback: boolean) => (v == null || v.trim() === '' ? fallback : v.trim().toLowerCase() === 'true')

/** Connection settings from the data source's credentials. */
export function sqlServerConfig(credentials: ConnectorCredentials, opts: { requestTimeoutMs?: number } = {}): sql.config {
  const host = credentials.host?.trim() ?? ''
  const database = credentials.database?.trim() ?? ''
  const user = credentials.username?.trim() ?? ''
  if (!host || !database || !user) throw Object.assign(new Error('SQL Server host, database and username are required.'), { retryable: false })
  const instance = credentials.instance?.trim()
  return {
    server: host,
    // A named instance is found through the SQL Browser service (UDP 1434); then no port.
    port: instance ? undefined : Number(credentials.port || 1433),
    database,
    user,
    password: credentials.password ?? '',
    connectionTimeout: 15_000,
    requestTimeout: opts.requestTimeoutMs ?? 60_000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 5_000 },
    options: {
      // Azure SQL requires encryption; on-premises servers usually support it too.
      encrypt: flag(credentials.encrypt, true),
      trustServerCertificate: flag(credentials.trustServerCertificate, false),
      instanceName: instance || undefined,
      appName: 'KMPlus Nexus',
    },
  }
}

export const sqlServerSchema = (credentials: ConnectorCredentials) => credentials.schema?.trim() || 'dbo'

/** [name] with ] doubled: safe for any identifier. */
export const msIdent = (name: string) => `[${name.replace(/]/g, ']]')}]`

async function withPool<T>(credentials: ConnectorCredentials, fn: (pool: sql.ConnectionPool) => Promise<T>, opts: { requestTimeoutMs?: number } = {}): Promise<T> {
  const pool = new sql.ConnectionPool(sqlServerConfig(credentials, opts))
  await pool.connect()
  try {
    return await fn(pool)
  } finally {
    await pool.close().catch(() => undefined)
  }
}

/** Readable messages for the usual connection problems. */
function friendly(err: unknown): string {
  const e = err as { code?: string; message?: string; originalError?: { message?: string } }
  const msg = e?.originalError?.message || e?.message || 'SQL Server connection failed.'
  if (e?.code === 'ELOGIN') return `SQL Server rejected the sign-in: ${msg}`
  if (e?.code === 'ESOCKET' || e?.code === 'ETIMEOUT') {
    // From the cloud, a server inside a company network needs an agent; inside the agent, point at the network.
    return privateNetworkAllowed()
      ? `SQL Server is unreachable: ${msg}. Check host, port and the firewall between this agent and the server.`
      : `SQL Server is unreachable: ${msg}. Check host, port and firewall; a server inside a company network is reached through a Nexus Agent.`
  }
  if (e?.code === 'EINSTLOOKUP') return `SQL Server instance not found: ${msg}. Check the instance name, or use the port instead.`
  return msg
}

export async function testSqlServerConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const version = await withPool(credentials, async (pool) => {
      const res = await pool.request().query<{ v: string }>('SELECT CAST(SERVERPROPERTY(\'ProductVersion\') AS nvarchar(64)) AS v')
      return res.recordset[0]?.v ?? ''
    })
    return { ok: true, message: version ? `Connected to SQL Server ${version}.` : 'Connected to SQL Server.', meta: { version } }
  } catch (err) {
    return { ok: false, message: friendly(err) }
  }
}

export async function scanSqlServerSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const schema = sqlServerSchema(credentials)
  return withPool(credentials, async (pool) => {
    const columns = await pool
      .request()
      .input('schema', sql.NVarChar(128), schema)
      .query<{ TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string }>(
        `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @schema
          ORDER BY TABLE_NAME, ORDINAL_POSITION`
      )
    const keys = await pool
      .request()
      .input('schema', sql.NVarChar(128), schema)
      .query<{ TABLE_NAME: string; COLUMN_NAME: string }>(
        `SELECT k.TABLE_NAME, k.COLUMN_NAME
           FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t
           JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
             ON k.CONSTRAINT_NAME = t.CONSTRAINT_NAME AND k.TABLE_SCHEMA = t.TABLE_SCHEMA AND k.TABLE_NAME = t.TABLE_NAME
          WHERE t.TABLE_SCHEMA = @schema AND t.CONSTRAINT_TYPE = 'PRIMARY KEY'`
      )
    const counts = await pool
      .request()
      .input('schema', sql.NVarChar(128), schema)
      .query<{ name: string; n: number | string }>(
        `SELECT t.name, SUM(p.rows) AS n
           FROM sys.tables t
           JOIN sys.schemas s ON s.schema_id = t.schema_id
           JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
          WHERE s.name = @schema
          GROUP BY t.name`
      )
    const pk = new Set(keys.recordset.map((k) => `${k.TABLE_NAME}\u0000${k.COLUMN_NAME}`))
    const rowCounts = new Map(counts.recordset.map((c) => [c.name, Number(c.n)]))
    const tables = new Map<string, SchemaTable>()
    for (const c of columns.recordset) {
      if (!tables.has(c.TABLE_NAME)) tables.set(c.TABLE_NAME, { schema, name: c.TABLE_NAME, columns: [], rowCount: rowCounts.get(c.TABLE_NAME) ?? null })
      tables.get(c.TABLE_NAME)!.columns.push({ name: c.COLUMN_NAME, type: c.DATA_TYPE, nullable: c.IS_NULLABLE === 'YES', isPrimaryKey: pk.has(`${c.TABLE_NAME}\u0000${c.COLUMN_NAME}`) })
    }
    return { tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)), scannedAt: new Date().toISOString(), method: 'sqlserver-information_schema' }
  })
}

export async function sampleSqlServerTable(credentials: ConnectorCredentials, tableName: string, limit = 25) {
  const schema = sqlServerSchema(credentials)
  return withPool(credentials, async (pool) => {
    const res = await pool.request().input('limit', sql.Int, Math.max(1, Math.min(limit, 10_000))).query(`SELECT TOP (@limit) * FROM ${msIdent(schema)}.${msIdent(tableName)}`)
    const types = columnTypes(res.recordset.columns)
    const rows = normalizeRows(res.recordset as Row[], types)
    return { tableName, columns: Object.keys(res.recordset.columns ?? {}), rows, totalRows: rows.length }
  })
}

// ── Pipeline reads (lib/pipelines/io.ts) ─────────────────────────────────────

/** Dataset column types from result metadata (mssql type factories carry their SQL declaration). */
export function sqlServerColumnType(declaration: string | undefined): ColumnType | null {
  switch ((declaration ?? '').toLowerCase()) {
    case 'int':
    case 'bigint':
    case 'smallint':
    case 'tinyint':
      return 'integer'
    case 'decimal':
    case 'numeric':
    case 'money':
    case 'smallmoney':
    case 'float':
    case 'real':
      return 'numeric'
    case 'bit':
      return 'boolean'
    case 'date':
      return 'date'
    case 'datetime':
    case 'datetime2':
    case 'smalldatetime':
    case 'datetimeoffset':
      return 'timestamp'
    default:
      return null
  }
}

function columnTypes(columns: sql.IColumnMetadata | undefined): Record<string, ColumnType> {
  const out: Record<string, ColumnType> = {}
  for (const [name, meta] of Object.entries(columns ?? {})) {
    const t = sqlServerColumnType((meta.type as { declaration?: string })?.declaration)
    if (t) out[name] = t
  }
  return out
}

/** DATE columns come back as Date objects: keep them as YYYY-MM-DD like the other SQL sources. */
function normalizeRows(rows: Row[], types: Record<string, ColumnType>): Row[] {
  const dates = Object.entries(types).filter(([, t]) => t === 'date').map(([n]) => n)
  if (!dates.length) return rows
  return rows.map((r) => {
    const out = { ...r }
    for (const d of dates) if (out[d] instanceof Date) out[d] = (out[d] as Date).toISOString().slice(0, 10)
    return out
  })
}

/**
 * SELECT for one chunk: rows ordered by the watermark column (incremental) then
 * the primary key, so chunks read in different invocations neither skip nor
 * repeat rows. Tables without a key fall back to (SELECT NULL), like views.
 */
export function sqlServerChunkQuery(opts: { schema: string; table: string; orderBy: string[]; watermarkColumn?: string; afterWatermark: boolean }) {
  const where = opts.watermarkColumn && opts.afterWatermark ? `WHERE ${msIdent(opts.watermarkColumn)} > @after` : ''
  const order = [...(opts.watermarkColumn ? [opts.watermarkColumn] : []), ...opts.orderBy.filter((c) => c !== opts.watermarkColumn)].map(msIdent)
  return `SELECT * FROM ${msIdent(opts.schema)}.${msIdent(opts.table)} ${where} ORDER BY ${order.length ? order.join(', ') : '(SELECT NULL)'} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`.replace(/\s+/g, ' ')
}

/** SELECT for a live query: equality filters compared as text, read-only by construction. */
export function sqlServerLiveQuery(opts: { schema: string; table: string; filterColumns: string[] }) {
  const where = opts.filterColumns.map((c, i) => `CAST(${msIdent(c)} AS nvarchar(max)) = @f${i}`)
  return `SELECT TOP (@take) * FROM ${msIdent(opts.schema)}.${msIdent(opts.table)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`
}

async function primaryKey(pool: sql.ConnectionPool, schema: string, table: string): Promise<string[]> {
  const res = await pool
    .request()
    .input('schema', sql.NVarChar(128), schema)
    .input('table', sql.NVarChar(128), table)
    .query<{ COLUMN_NAME: string }>(
      `SELECT k.COLUMN_NAME
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
           ON k.CONSTRAINT_NAME = t.CONSTRAINT_NAME AND k.TABLE_SCHEMA = t.TABLE_SCHEMA AND k.TABLE_NAME = t.TABLE_NAME
        WHERE t.TABLE_SCHEMA = @schema AND t.TABLE_NAME = @table AND t.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ORDER BY k.ORDINAL_POSITION`
    )
  return res.recordset.map((r) => r.COLUMN_NAME)
}

export async function readSqlServerChunk(
  credentials: ConnectorCredentials,
  table: string,
  opts: { offset: number; limit: number; watermark?: { column: string; after: string | null }; cache: Map<string, unknown> }
): Promise<{ rows: Row[]; types: Record<string, ColumnType> }> {
  const schema = sqlServerSchema(credentials)
  return withPool(credentials, async (pool) => {
    const key = `mskeys:${schema}.${table}`
    let keys = opts.cache.get(key) as string[] | undefined
    if (!keys) opts.cache.set(key, (keys = await primaryKey(pool, schema, table)))
    const wm = opts.watermark
    const req = pool.request().input('offset', sql.Int, opts.offset).input('limit', sql.Int, opts.limit)
    if (wm?.after != null) req.input('after', wm.after)
    const res = await req.query(sqlServerChunkQuery({ schema, table, orderBy: keys, watermarkColumn: wm?.column, afterWatermark: wm?.after != null }))
    const types = columnTypes(res.recordset.columns)
    return { rows: normalizeRows(res.recordset as Row[], types), types }
  })
}

export async function readSqlServerRows(credentials: ConnectorCredentials, table: string, maxRows: number, watermark?: { column: string; after: string | null }): Promise<Row[]> {
  const cache = new Map<string, unknown>()
  const rows: Row[] = []
  while (rows.length < maxRows) {
    const take = Math.min(5_000, maxRows - rows.length)
    const chunk = await readSqlServerChunk(credentials, table, { offset: rows.length, limit: take, watermark, cache })
    rows.push(...chunk.rows)
    if (chunk.rows.length < take) break
  }
  return rows
}

export async function liveSqlServerQuery(credentials: ConnectorCredentials, table: string, opts: { take: number; timeoutMs: number; filters: { column: string; value: string }[] }): Promise<Row[]> {
  const schema = sqlServerSchema(credentials)
  return withPool(
    credentials,
    async (pool) => {
      const req = pool.request().input('take', sql.Int, opts.take)
      opts.filters.forEach((f, i) => req.input(`f${i}`, sql.NVarChar(sql.MAX), f.value))
      const res = await req.query(sqlServerLiveQuery({ schema, table, filterColumns: opts.filters.map((f) => f.column) }))
      return normalizeRows(res.recordset as Row[], columnTypes(res.recordset.columns))
    },
    { requestTimeoutMs: opts.timeoutMs }
  )
}
