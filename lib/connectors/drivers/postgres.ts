import { Pool } from 'pg'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult } from '../types'
import { mapSqlType } from '../sql-introspect'

function getConnectionString(credentials: ConnectorCredentials) {
  return credentials.connectionString?.trim() ?? ''
}

export async function testPostgresConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  const connectionString = getConnectionString(credentials)
  if (!connectionString) return { ok: false, message: 'Connection string is required.' }

  const pool = new Pool({ connectionString, max: 1 })
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
  const pool = new Pool({ connectionString, max: 1 })

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
  const pool = new Pool({ connectionString: getConnectionString(credentials), max: 1 })
  try {
    const quoted = `"${tableName.replace(/"/g, '""')}"`
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
