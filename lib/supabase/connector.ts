import { createClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import type {
  SupabaseColumn,
  SupabaseConnectionTest,
  SupabaseCredentials,
  SupabaseSchemaScan,
  SupabaseTable,
} from './types'

function normalizeProjectUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}

function projectRefFromUrl(projectUrl: string) {
  try {
    const host = new URL(projectUrl).hostname
    return host.split('.')[0] ?? undefined
  } catch {
    return undefined
  }
}

function isNewFormatKey(key: string) {
  return key.startsWith('sb_publishable_') || key.startsWith('sb_secret_')
}

/** PostgREST auth headers for Supabase API keys (incl. sb_publishable / sb_secret). */
export function buildSupabaseHeaders(apiKey: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    apikey: apiKey,
    ...extra,
  }

  // New-format keys must NOT be sent as Bearer JWT — only apikey header.
  if (!isNewFormatKey(apiKey)) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  return headers
}

export function resolveSecretKey(credentials: SupabaseCredentials) {
  const primary = credentials.apiKey.trim()
  if (primary.startsWith('sb_secret_') || primary.startsWith('eyJ')) return primary
  return primary
}

export function resolveDataKey(credentials: SupabaseCredentials) {
  const publishable = credentials.publishableKey?.trim()
  if (publishable) return publishable
  return resolveSecretKey(credentials)
}

function mapPostgresType(dataType: string, udtName: string) {
  if (dataType === 'USER-DEFINED') return udtName.toUpperCase()
  if (dataType === 'ARRAY') return `${udtName.toUpperCase()}[]`
  return dataType.toUpperCase()
}

function openApiTypeToColumnType(property: Record<string, unknown>): string {
  if (typeof property.format === 'string') return property.format.toUpperCase()
  if (typeof property.type === 'string') {
    if (property.type === 'integer') return 'INTEGER'
    if (property.type === 'number') return 'NUMERIC'
    if (property.type === 'boolean') return 'BOOLEAN'
    if (property.type === 'string') return 'TEXT'
    if (property.type === 'array') return 'ARRAY'
    if (property.type === 'object') return 'JSONB'
  }
  return 'TEXT'
}

type OpenApiSpec = {
  paths?: Record<string, Record<string, { parameters?: Array<{ $ref?: string }> }>>
  definitions?: Record<
    string,
    {
      properties?: Record<string, Record<string, unknown>>
      required?: string[]
    }
  >
  components?: {
    schemas?: Record<
      string,
      {
        properties?: Record<string, Record<string, unknown>>
        required?: string[]
      }
    >
  }
}

function getTableDefinition(spec: OpenApiSpec, tableName: string) {
  return (
    spec.definitions?.[tableName] ??
    spec.components?.schemas?.[tableName] ??
    spec.components?.schemas?.[`public.${tableName}`]
  )
}

function columnsFromParameters(
  spec: OpenApiSpec,
  parameters: Array<{ $ref?: string }> | undefined
): SupabaseColumn[] {
  if (!parameters?.length) return []

  const columns: SupabaseColumn[] = []
  for (const param of parameters) {
    const ref = param.$ref
    if (!ref) continue
    const match = ref.match(/rowFilter\.([^.]+)\.([^.]+)$/)
    if (!match) continue
    const columnName = match[2]
    if (['select', 'order', 'limit', 'offset', 'range', 'rangeUnit', 'preferCount'].includes(columnName)) {
      continue
    }
    columns.push({ name: columnName, type: 'TEXT', nullable: true })
  }
  return columns
}

async function fetchOpenApiTables(
  projectUrl: string,
  apiKey: string,
  schema: string
): Promise<SupabaseTable[]> {
  const response = await fetch(`${projectUrl}/rest/v1/`, {
    headers: buildSupabaseHeaders(apiKey, { Accept: 'application/openapi+json' }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`PostgREST OpenAPI request failed (${response.status})`)
  }

  const spec = (await response.json()) as OpenApiSpec
  const tables: SupabaseTable[] = []
  const paths = spec.paths ?? {}

  for (const path of Object.keys(paths)) {
    const match = path.match(/^\/([^/?]+)$/)
    if (!match) continue

    const tableName = decodeURIComponent(match[1])
    if (tableName === '' || tableName === 'rpc') continue

    const getOp = paths[path]?.get
    if (!getOp) continue

    const definition = getTableDefinition(spec, tableName)
    const properties = definition?.properties ?? {}
    const required = new Set(definition?.required ?? [])

    let columns: SupabaseColumn[] = Object.entries(properties).map(([name, property]) => ({
      name,
      type: openApiTypeToColumnType(property),
      format: typeof property.format === 'string' ? property.format : undefined,
      nullable: !required.has(name),
    }))

    if (columns.length === 0) {
      columns = columnsFromParameters(spec, getOp.parameters)
    }

    tables.push({
      schema,
      name: tableName,
      columns,
      rowCount: null,
    })
  }

  const supabase = createClient(projectUrl, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const enriched = await Promise.all(
    tables.map(async (table) => {
      if (table.columns.length > 0) return table

      const { data, error } = await supabase.from(table.name).select('*').limit(1)
      if (error || !data?.length) return table

      const row = data[0] as Record<string, unknown>
      return {
        ...table,
        columns: Object.entries(row).map(([name, value]) => ({
          name,
          type: inferTypeFromValue(value),
          nullable: value == null,
        })),
      }
    })
  )

  return enriched.sort((a, b) => a.name.localeCompare(b.name))
}

function inferTypeFromValue(value: unknown): string {
  if (value == null) return 'TEXT'
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'NUMERIC'
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (Array.isArray(value)) return 'ARRAY'
  if (typeof value === 'object') return 'JSONB'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return 'TIMESTAMP'
  return 'TEXT'
}

async function scanViaPostgres(databaseUrl: string, schema: string): Promise<SupabaseTable[]> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
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
         AND table_name NOT LIKE 'pg_%'
       ORDER BY table_name, ordinal_position`,
      [schema]
    )

    const pkResult = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = $1`,
      [schema]
    )

    const countResult = await pool.query<{ relname: string; n_live_tup: string }>(
      `SELECT c.relname, s.n_live_tup::text
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE n.nspname = $1
         AND c.relkind = 'r'`,
      [schema]
    )

    const pkSet = new Set(pkResult.rows.map((row) => `${row.table_name}.${row.column_name}`))
    const countMap = new Map(countResult.rows.map((row) => [row.relname, Number(row.n_live_tup)]))
    const tableMap = new Map<string, SupabaseTable>()

    for (const row of columnsResult.rows) {
      const key = `${row.table_schema}.${row.table_name}`
      if (!tableMap.has(key)) {
        tableMap.set(key, {
          schema: row.table_schema,
          name: row.table_name,
          columns: [],
          rowCount: countMap.get(row.table_name) ?? null,
        })
      }

      tableMap.get(key)!.columns.push({
        name: row.column_name,
        type: mapPostgresType(row.data_type, row.udt_name),
        nullable: row.is_nullable === 'YES',
        isPrimaryKey: pkSet.has(`${row.table_name}.${row.column_name}`),
      })
    }

    return Array.from(tableMap.values()).sort((a, b) => a.name.localeCompare(b.name))
  } finally {
    await pool.end()
  }
}

async function attachRowCounts(
  projectUrl: string,
  apiKey: string,
  tables: SupabaseTable[]
): Promise<SupabaseTable[]> {
  const supabase = createClient(projectUrl, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const withCounts = await Promise.all(
    tables.map(async (table) => {
      const { count, error } = await supabase
        .from(table.name)
        .select('*', { count: 'exact', head: true })

      if (error) return table
      return { ...table, rowCount: count ?? table.rowCount }
    })
  )

  return withCounts
}

async function probeTableAccess(projectUrl: string, apiKey: string, tableName: string) {
  const response = await fetch(
    `${projectUrl}/rest/v1/${encodeURIComponent(tableName)}?select=*&limit=1`,
    {
      headers: buildSupabaseHeaders(apiKey, { Accept: 'application/json' }),
      cache: 'no-store',
    }
  )
  return response.status !== 401 && response.status !== 403
}

export async function testSupabaseConnection(
  credentials: SupabaseCredentials
): Promise<SupabaseConnectionTest> {
  const projectUrl = normalizeProjectUrl(credentials.projectUrl)
  const secretKey = resolveSecretKey(credentials)
  const dataKey = resolveDataKey(credentials)

  if (!projectUrl || !secretKey) {
    return { ok: false, message: 'Project URL and secret API key are required.' }
  }

  try {
    new URL(projectUrl)
  } catch {
    return { ok: false, message: 'Project URL must be a valid URL (https://xxxx.supabase.co).' }
  }

  try {
    // Prefer OpenAPI probe with secret key (full schema access).
    if (secretKey.startsWith('sb_secret_') || secretKey.startsWith('eyJ')) {
      const response = await fetch(`${projectUrl}/rest/v1/`, {
        headers: buildSupabaseHeaders(secretKey, { Accept: 'application/openapi+json' }),
        cache: 'no-store',
      })

      if (response.ok) {
        return {
          ok: true,
          message: 'Connected to Supabase PostgREST API.',
          projectRef: projectRefFromUrl(projectUrl),
        }
      }

      if (response.status !== 401 && response.status !== 403) {
        return { ok: false, message: `Connection failed with status ${response.status}.` }
      }
    }

    // Publishable keys cannot read OpenAPI root — probe a live table instead.
    const scanKey = secretKey.startsWith('sb_secret_') || secretKey.startsWith('eyJ') ? secretKey : dataKey
    const tablesToTry = ['users', 'breeder_pig', 'farms']
    for (const table of tablesToTry) {
      if (await probeTableAccess(projectUrl, scanKey, table)) {
        return {
          ok: true,
          message: `Connected to Supabase (verified via ${table}).`,
          projectRef: projectRefFromUrl(projectUrl),
        }
      }
    }

    return { ok: false, message: 'Invalid API key or insufficient permissions.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to reach Supabase project.',
    }
  }
}

export async function scanSupabaseSchema(
  credentials: SupabaseCredentials
): Promise<SupabaseSchemaScan> {
  const projectUrl = normalizeProjectUrl(credentials.projectUrl)
  const schema = credentials.schema?.trim() || 'public'
  const scanKey = resolveSecretKey(credentials)
  const countKey = resolveDataKey(credentials)

  let tables: SupabaseTable[] = []
  let method: SupabaseSchemaScan['method'] = 'openapi'

  if (credentials.databaseUrl?.trim()) {
    tables = await scanViaPostgres(credentials.databaseUrl.trim(), schema)
    method = 'postgres'
  } else {
    if (!scanKey.startsWith('sb_secret_') && !scanKey.startsWith('eyJ')) {
      throw new Error(
        'Schema scan requires a secret key (sb_secret_…) or a database connection URL. Publishable keys can preview data but cannot read the schema catalog.'
      )
    }
    tables = await fetchOpenApiTables(projectUrl, scanKey, schema)
  }

  tables = await attachRowCounts(projectUrl, countKey, tables)

  return {
    tables,
    scannedAt: new Date().toISOString(),
    method,
  }
}

export async function fetchSupabaseTableSample(
  credentials: SupabaseCredentials,
  tableName: string,
  limit = 25
) {
  const projectUrl = normalizeProjectUrl(credentials.projectUrl)
  const dataKey = resolveDataKey(credentials)
  const supabase = createClient(projectUrl, dataKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error, count } = await supabase
    .from(tableName)
    .select('*', { count: 'exact' })
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []

  return {
    tableName,
    columns,
    rows,
    totalRows: count,
  }
}

export function maskSupabaseCredentials(credentials: SupabaseCredentials) {
  const mask = (key: string) =>
    key.length <= 8 ? '••••••••' : `${key.slice(0, 4)}${'•'.repeat(Math.min(key.length - 8, 24))}${key.slice(-4)}`

  return {
    projectUrl: credentials.projectUrl,
    apiKey: mask(credentials.apiKey.trim()),
    publishableKey: credentials.publishableKey ? mask(credentials.publishableKey.trim()) : undefined,
    databaseUrl: credentials.databaseUrl ? '••••••••' : undefined,
    schema: credentials.schema ?? 'public',
  }
}
