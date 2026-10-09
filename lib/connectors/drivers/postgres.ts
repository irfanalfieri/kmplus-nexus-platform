import { Pool, types } from 'pg'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult } from '../types'
import { mapSqlType } from '../sql-introspect'
import { SUPABASE_ROOT_CA } from '@/lib/db/supabase-ca'

function getConnectionString(credentials: ConnectorCredentials) {
  return credentials.connectionString?.trim() ?? ''
}

const PG_DATE_OID = 1082
const PG_TIMESTAMP_OID = 1114 // timestamp without time zone

/**
 * Keep DATE and zone-less TIMESTAMP columns as their text form. pg's default
 * turns them into a Date in the server's local timezone, which shifts values
 * when the process isn't running in UTC (and breaks incremental watermarks).
 */
const externalTypes = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === PG_DATE_OID || oid === PG_TIMESTAMP_OID ? (value: string) => value : types.getTypeParser(oid, format)) as typeof types.getTypeParser,
}

export type PgSslMode = 'verify' | 'require' | 'disable'

/**
 * TLS settings for a user's Postgres:
 * - localhost: no TLS
 * - Supabase hosts: always verified against the bundled Supabase root CA
 * - verify: verified against the supplied CA (PEM) or the system trust store
 * - require (default): encrypted, certificate not verified
 * - disable: plain connection
 * An sslmode in the connection string still takes precedence (pg applies it).
 */
export function pgSslOptions(connectionString: string, tls: { mode?: string; ca?: string } = {}) {
  const host = (() => {
    try {
      return new URL(connectionString).hostname
    } catch {
      return ''
    }
  })()
  if (/^(localhost|127\.0\.0\.1|::1)$/.test(host)) return undefined
  if (/\.(supabase\.com|supabase\.co)$/.test(host)) return { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true }
  const mode = (tls.mode ?? 'require') as PgSslMode
  if (mode === 'disable') return false
  if (mode === 'verify') return { ca: tls.ca?.trim() || undefined, rejectUnauthorized: true }
  return { rejectUnauthorized: false }
}

export function createPgPool(connectionString: string, tls?: { mode?: string; ca?: string }) {
  return new Pool({ connectionString, max: 1, ssl: pgSslOptions(connectionString, tls), types: externalTypes })
}

const tlsOf = (c: ConnectorCredentials) => ({ mode: c.sslMode, ca: c.caCert })

export async function testPostgresConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  const connectionString = getConnectionString(credentials)
  if (!connectionString) return { ok: false, message: 'Connection string is required.' }

  const pool = createPgPool(connectionString, tlsOf(credentials))
  try {
    await pool.query('SELECT 1 AS ok')
    return { ok: true, message: 'Connected to PostgreSQL.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'PostgreSQL connection failed.' }
  } finally {
    await pool.end()
  }
}

export async function scanPostgresSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const connectionString = getConnectionString(credentials)
  const schema = credentials.schema?.trim() || 'public'
  const pool = createPgPool(connectionString, tlsOf(credentials))

  try {
    const columnsResult = await pool.query<{
      table_schema: string
      table_name: string
      column_name: string
      data_type: string
      udt_name: string
      is_nullable: string
    }>(
      `SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [schema]
    )

    const countResult = await pool.query<{ relname: string; n_live_tup: string }>(
      `SELECT c.relname, s.n_live_tup::text
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE n.nspname = $1 AND c.relkind = 'r'`,
      [schema]
    )

    const countMap = new Map(countResult.rows.map((r) => [r.relname, Number(r.n_live_tup)]))
    const tableMap = new Map<string, SchemaScanResult['tables'][0]>()

    for (const row of columnsResult.rows) {
      if (!tableMap.has(row.table_name)) {
        tableMap.set(row.table_name, {
          schema: row.table_schema,
          name: row.table_name,
          columns: [],
          rowCount: countMap.get(row.table_name) ?? null,
        })
      }
      tableMap.get(row.table_name)!.columns.push({
        name: row.column_name,
        type: mapSqlType(row.data_type, row.udt_name),
        nullable: row.is_nullable === 'YES',
      })
    }

    return {
      tables: Array.from(tableMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      scannedAt: new Date().toISOString(),
      method: 'postgres',
    }
  } finally {
    await pool.end()
  }
}

export async function samplePostgresTable(
  credentials: ConnectorCredentials,
  tableName: string,
  limit = 25
) {
  const pool = createPgPool(getConnectionString(credentials), tlsOf(credentials))
  const schema = credentials.schema?.trim() || 'public'
  try {
    const quoted = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`
    const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoted}`)
    const dataResult = await pool.query(`SELECT * FROM ${quoted} LIMIT $1`, [limit])
    const rows = dataResult.rows as Record<string, unknown>[]
    return {
      tableName,
      columns: rows.length ? Object.keys(rows[0]) : [],
      rows,
      totalRows: Number(countResult.rows[0]?.count ?? 0),
    }
  } finally {
    await pool.end()
  }
}
