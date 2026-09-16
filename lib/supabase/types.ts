export interface SupabaseCredentials {
  projectUrl: string
  /** Primary key — prefer sb_secret_* for schema scan */
  apiKey: string
  /** Optional sb_publishable_* key for RLS-respecting data preview */
  publishableKey?: string
  databaseUrl?: string
  schema?: string
}

export interface SupabaseColumn {
  name: string
  type: string
  format?: string
  nullable: boolean
  isPrimaryKey?: boolean
}

export interface SupabaseTable {
  schema: string
  name: string
  columns: SupabaseColumn[]
  rowCount: number | null
}

export interface SupabaseConnectionTest {
  ok: boolean
  message: string
  projectRef?: string
}

export interface SupabaseSchemaScan {
  tables: SupabaseTable[]
  scannedAt: string
  method: 'postgres' | 'openapi'
}
