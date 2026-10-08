import snowflake from 'snowflake-sdk'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult } from '../types'

function createConnection(credentials: ConnectorCredentials) {
  return snowflake.createConnection({
    account: credentials.account?.trim(),
    username: credentials.username?.trim(),
    password: credentials.password ?? '',
    warehouse: credentials.warehouse?.trim(),
    database: credentials.database?.trim(),
    schema: credentials.schema?.trim() || 'PUBLIC',
  })
}

function exec(connection: snowflake.Connection, sql: string) {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      complete: (err, _stmt, rows) => {
        if (err) reject(err)
        else resolve((rows ?? []) as Record<string, unknown>[])
      },
    })
  })
}

export async function testSnowflakeConnection(
  credentials: ConnectorCredentials
): Promise<ConnectionTestResult> {
  const connection = createConnection(credentials)
  try {
    await new Promise<void>((resolve, reject) => {
      connection.connect((err) => (err ? reject(err) : resolve()))
    })
    await exec(connection, 'SELECT 1 AS ok')
    return { ok: true, message: 'Connected to Snowflake.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Snowflake connection failed.',
    }
  } finally {
    connection.destroy(() => undefined)
  }
}

export async function scanSnowflakeSchema(
  credentials: ConnectorCredentials
): Promise<SchemaScanResult> {
  const schema = (credentials.schema?.trim() || 'PUBLIC').toUpperCase()
  const database = credentials.database?.trim()?.toUpperCase()
  const connection = createConnection(credentials)

  try {
    await new Promise<void>((resolve, reject) => {
      connection.connect((err) => (err ? reject(err) : resolve()))
    })

    const columns = await exec(
      connection,
      `SELECT table_schema, table_name, column_name, data_type, is_nullable
       FROM ${database ? `"${database}".` : ''}INFORMATION_SCHEMA.COLUMNS
       WHERE table_schema = '${schema}'
       ORDER BY table_name, ordinal_position`
    )

    const counts = await exec(
      connection,
      `SELECT table_name, row_count
       FROM ${database ? `"${database}".` : ''}INFORMATION_SCHEMA.TABLES
       WHERE table_schema = '${schema}' AND table_type = 'BASE TABLE'`
    )

    const countMap = new Map(counts.map((r) => [String(r.TABLE_NAME), Number(r.ROW_COUNT)]))
    const tableMap = new Map<string, SchemaScanResult['tables'][0]>()

    for (const row of columns) {
      const name = String(row.TABLE_NAME)
      if (!tableMap.has(name)) {
        tableMap.set(name, {
          schema: String(row.TABLE_SCHEMA),
          name,
          columns: [],
          rowCount: countMap.get(name) ?? null,
        })
      }
      tableMap.get(name)!.columns.push({
        name: String(row.COLUMN_NAME),
        type: String(row.DATA_TYPE).toUpperCase(),
        nullable: String(row.IS_NULLABLE) === 'YES',
      })
    }

    return {
      tables: Array.from(tableMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      scannedAt: new Date().toISOString(),
      method: 'snowflake-information_schema',
    }
  } finally {
    connection.destroy(() => undefined)
  }
}

export async function sampleSnowflakeTable(
  credentials: ConnectorCredentials,
  tableName: string,
  limit = 25
) {
  const schema = (credentials.schema?.trim() || 'PUBLIC').toUpperCase()
  const database = credentials.database?.trim()
  const connection = createConnection(credentials)
  const fqTable = database
    ? `"${database}"."${schema}"."${tableName.replace(/"/g, '')}"`
    : `"${schema}"."${tableName.replace(/"/g, '')}"`

  try {
    await new Promise<void>((resolve, reject) => {
      connection.connect((err) => (err ? reject(err) : resolve()))
    })
    const countRows = await exec(connection, `SELECT COUNT(*) AS cnt FROM ${fqTable}`)
    const rows = await exec(connection, `SELECT * FROM ${fqTable} LIMIT ${limit}`)
    return {
      tableName,
      columns: rows.length ? Object.keys(rows[0]) : [],
      rows,
      totalRows: Number(countRows[0]?.CNT ?? 0),
    }
  } finally {
    connection.destroy(() => undefined)
  }
}
