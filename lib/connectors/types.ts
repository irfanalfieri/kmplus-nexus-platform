export type ConnectorSlug =
  | 'sap'
  | 'oracle'
  | 'mysql'
  | 'postgres'
  | 'sqlserver'
  | 'rest'
  | 'salesforce'
  | 'snowflake'
  | 'supabase'
  | 'talenta'
  | 'ldap'
  | 'file'
  | 'kmplus'
  // Infrastructure: observability and cloud file storage (read-only sources)
  | 'prometheus'
  | 'elasticsearch'
  | 'datadog'
  | 'newrelic'
  | 'grafana'
  | 's3'
  | 'azureblob'
  | 'gcs'
  // Productivity and file transfer (DS-9 remainder)
  | 'sharepoint'
  | 'googlesheets'
  | 'googledrive'
  | 'sftp'
  | 'graphql'
  | 'soap'
  // Secrets managers: supply credentials to other data sources, never read as data
  | 'vault'
  | 'awssecrets'
  | 'azurekeyvault'
  | 'gcpsecrets'
  | 'doppler'

export interface CredentialField {
  key: string
  label: string
  /** textarea: several lines (GraphQL queries, SOAP envelopes, private keys). */
  type: 'text' | 'password' | 'number' | 'textarea'
  required: boolean
  placeholder?: string
}

/**
 * How the Connectors screen groups connectors (filter chips and sections).
 * `category` stays the finer label shown on each card.
 */
export const CONNECTOR_GROUPS = ['applications', 'kmplus', 'databases', 'apis', 'files', 'infrastructure', 'identity', 'secrets'] as const
export type ConnectorGroup = (typeof CONNECTOR_GROUPS)[number]

export interface ConnectorDefinition {
  slug: ConnectorSlug
  name: string
  category: string
  group: ConnectorGroup
  /** Extra words people search for (systems, vendors, formats), lower case; English and Indonesian. */
  keywords: string[]
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
  /** MP-7: nested values seen under an object / list column (address.city, assignments[].org), from sample rows. */
  paths?: { path: string; type: string }[]
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
