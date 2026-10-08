export type ConnectorSlug =
  | 'sap'
  | 'oracle'
  | 'mysql'
  | 'rest'
  | 'salesforce'
  | 'snowflake'
  | 'supabase'

export interface CredentialField {
  key: string
  label: string
  type: 'text' | 'password' | 'number'
  required: boolean
  placeholder?: string
}

export interface ConnectorDefinition {
  slug: ConnectorSlug
  name: string
  category: string
  version: string
  description: string
  /** Included free on account creation (shows as Installed) */
  includedByDefault: boolean
  /** Requires marketplace purchase before Install */
  premium: boolean
  credentialFields: CredentialField[]
}

export interface SchemaColumn {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey?: boolean
}

export interface SchemaTable {
  schema: string
  name: string
  columns: SchemaColumn[]
  rowCount: number | null
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  meta?: Record<string, string>
}

export interface SchemaScanResult {
  tables: SchemaTable[]
  scannedAt: string
  method: string
}

export type ConnectorCredentials = Record<string, string>
