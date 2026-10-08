import oracledb from 'oracledb'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult } from '../types'

function parseOracleConnectString(raw: string) {
  const value = raw.trim()
  if (value.startsWith('oracle://') || value.startsWith('oracledb://')) {
    const url = new URL(value.replace(/^oracle(db)?:\/\//, 'http://'))
    return {
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      connectString: url.hostname + (url.port ? `:${url.port}` : '') + url.pathname,
    }
  }
  return { connectString: value }
}

function getOracleConfig(credentials: ConnectorCredentials) {
  const connectionString = credentials.connectionString?.trim()
  if (!connectionString) return null
  const parsed = parseOracleConnectString(connectionString)
  return {
    user: parsed.user || credentials.username,
    password: parsed.password || credentials.password,
    connectString: parsed.connectString,
  }
}

export async function testOracleConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  const config = getOracleConfig(credentials)
  if (!config?.connectString || !config.user) {
    return { ok: false, message: 'Oracle connection string with user is required (oracle://user:pass@host:1521/XEPDB1).' }
  }

  let connection: Awaited<ReturnType<typeof oracledb.getConnection>> | undefined
  try {
    connection = await oracledb.getConnection(config)
    await connection.execute('SELECT 1 FROM DUAL')
    return { ok: true, message: 'Connected to Oracle Database.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Oracle connection failed.' }
  } finally {
    await connection?.close()
  }
}

export async function scanOracleSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const config = getOracleConfig(credentials)
  if (!config?.connectString || !config.user) throw new Error('Invalid Oracle credentials.')

  const schema = (credentials.schema?.trim() || config.user).toUpperCase()
  let connection: Awaited<ReturnType<typeof oracledb.getConnection>> | undefined

  try {
    connection = await oracledb.getConnection(config)
    const columnsResult = await connection.execute<{
      TABLE_NAME: string
      COLUMN_NAME: string
      DATA_TYPE: string
      NULLABLE: string
    }>(
      `SELECT table_name, column_name, data_type, nullable
       FROM all_tab_columns
       WHERE owner = :owner
       ORDER BY table_name, column_id`,
      { owner: schema },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    )

    const countResult = await connection.execute<{ TABLE_NAME: string; NUM_ROWS: number }>(
      `SELECT table_name, num_rows FROM all_tables WHERE owner = :owner`,
      { owner: schema },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    )

    const countMap = new Map(
      (countResult.rows ?? []).map((r: { TABLE_NAME: string; NUM_ROWS: number }) => [
        r.TABLE_NAME,
        r.NUM_ROWS,
      ])
    )
    const tableMap = new Map<string, SchemaScanResult['tables'][0]>()

    for (const row of columnsResult.rows ?? []) {
      if (!tableMap.has(row.TABLE_NAME)) {
        tableMap.set(row.TABLE_NAME, {
          schema,
          name: row.TABLE_NAME,
          columns: [],
          rowCount: countMap.get(row.TABLE_NAME) ?? null,
        })
      }
      tableMap.get(row.TABLE_NAME)!.columns.push({
        name: row.COLUMN_NAME,
        type: row.DATA_TYPE,
        nullable: row.NULLABLE === 'Y',
      })
    }

    return {
      tables: Array.from(tableMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      scannedAt: new Date().toISOString(),
      method: 'oracle-all_tab_columns',
    }
  } finally {
    await connection?.close()
  }
}

export async function sampleOracleTable(
  credentials: ConnectorCredentials,
  tableName: string,
  limit = 25
) {
  const config = getOracleConfig(credentials)
  if (!config) throw new Error('Invalid Oracle credentials.')
  const schema = (credentials.schema?.trim() || config.user)?.toUpperCase()
  const safeTable = tableName.replace(/[^a-zA-Z0-9_$/]/g, '')

  let connection: Awaited<ReturnType<typeof oracledb.getConnection>> | undefined
  try {
    connection = await oracledb.getConnection(config)
    const countResult = await connection.execute<{ CNT: number }>(
      `SELECT COUNT(*) AS cnt FROM "${schema}"."${safeTable}"`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    )
    const dataResult = await connection.execute(
      `SELECT * FROM "${schema}"."${safeTable}" FETCH FIRST :limit ROWS ONLY`,
      { limit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    )
    const rows = (dataResult.rows ?? []) as Record<string, unknown>[]
    return {
      tableName,
      columns: rows.length ? Object.keys(rows[0]) : [],
      rows,
      totalRows: Number(countResult.rows?.[0]?.CNT ?? 0),
    }
  } finally {
    await connection?.close()
  }
}
