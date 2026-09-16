import type { SchemaColumn, SchemaTable } from './types'

export function mapSqlType(dataType: string, udtName?: string) {
  if (dataType === 'USER-DEFINED' && udtName) return udtName.toUpperCase()
  if (dataType === 'ARRAY' && udtName) return `${udtName.toUpperCase()}[]`
  return dataType.toUpperCase()
}

export async function introspectFromQueryRunner(
  schema: string,
  query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>
): Promise<SchemaTable[]> {
  const columns = await query<{
    table_schema: string
    table_name: string
    column_name: string
    data_type: string
    udt_name: string
    is_nullable: string
  }>(
    `SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = ?
       AND table_name NOT LIKE 'pg_%'
     ORDER BY table_name, ordinal_position`,
    [schema]
  )

  const tableMap = new Map<string, SchemaTable>()

  for (const row of columns) {
    const key = `${row.table_schema}.${row.table_name}`
    if (!tableMap.has(key)) {
      tableMap.set(key, {
        schema: row.table_schema,
        name: row.table_name,
        columns: [],
        rowCount: null,
      })
    }
    tableMap.get(key)!.columns.push({
      name: row.column_name,
      type: mapSqlType(row.data_type, row.udt_name),
      nullable: row.is_nullable === 'YES',
    })
  }

  return Array.from(tableMap.values()).sort((a, b) => a.name.localeCompare(b.name))
}
