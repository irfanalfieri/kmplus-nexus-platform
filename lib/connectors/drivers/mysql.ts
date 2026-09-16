import mysql from 'mysql2/promise'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult } from '../types'
import { mapSqlType } from '../sql-introspect'

type MysqlConfig = string | mysql.ConnectionOptions

function buildConfig(credentials: ConnectorCredentials): MysqlConfig | null {
  if (credentials.connectionString?.trim()) {
    return credentials.connectionString.trim()
  }
  const host = credentials.host?.trim()
  const user = credentials.username?.trim()
  const database = credentials.database?.trim()
  if (!host || !user) return null
  return {
    host,
    port: Number(credentials.port || 3306),
    user,
    password: credentials.password ?? '',
    database,
  }
}

async function openConnection(config: MysqlConfig) {
  if (typeof config === 'string') return mysql.createConnection(config)
  return mysql.createConnection(config)
}

export async function testMysqlConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  const config = buildConfig(credentials)
  if (!config) return { ok: false, message: 'Provide connection string or host/username/database.' }

  let connection: mysql.Connection | null = null
  try {
    connection = await openConnection(config)
    await connection.query('SELECT 1 AS ok')
    return { ok: true, message: 'Connected to MySQL.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'MySQL connection failed.' }
  } finally {
    await connection?.end()
  }
}

export async function scanMysqlSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const config = buildConfig(credentials)
  if (!config) throw new Error('Invalid MySQL credentials.')
  const schema =
    credentials.schema?.trim() ||
    (typeof config === 'object' && config && 'database' in config
      ? String(config.database ?? '')
      : '') ||
    ''

  if (!schema) throw new Error('Database/schema name is required for MySQL schema scan.')

  let connection: mysql.Connection | null = null
  try {
    connection = await openConnection(config)
    const [columns] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT table_schema, table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = ?
       ORDER BY table_name, ordinal_position`,
      [schema]
    )

    const [counts] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT table_name, table_rows
       FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
      [schema]
    )

    const countMap = new Map(counts.map((r) => [String(r.table_name), Number(r.table_rows)]))
    const tableMap = new Map<string, SchemaScanResult['tables'][0]>()

    for (const row of columns) {
      const name = String(row.table_name)
      if (!tableMap.has(name)) {
        tableMap.set(name, {
          schema: String(row.table_schema),
          name,
          columns: [],
          rowCount: countMap.get(name) ?? null,
        })
      }
      tableMap.get(name)!.columns.push({
        name: String(row.column_name),
        type: mapSqlType(String(row.data_type)),
        nullable: String(row.is_nullable) === 'YES',
      })
    }

    return {
      tables: Array.from(tableMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      scannedAt: new Date().toISOString(),
      method: 'mysql-information_schema',
    }
  } finally {
    await connection?.end()
  }
}

export async function sampleMysqlTable(
  credentials: ConnectorCredentials,
  tableName: string,
  limit = 25
) {
  const config = buildConfig(credentials)
  if (!config) throw new Error('Invalid MySQL credentials.')

  let connection: mysql.Connection | null = null
  try {
    connection = await openConnection(config)
    const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '')
    const [countRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM \`${safeTable}\``
    )
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT * FROM \`${safeTable}\` LIMIT ?`,
      [limit]
    )
    const records = rows as Record<string, unknown>[]
    return {
      tableName,
      columns: records.length ? Object.keys(records[0]) : [],
      rows: records,
      totalRows: Number(countRows[0]?.count ?? 0),
    }
  } finally {
    await connection?.end()
  }
}
