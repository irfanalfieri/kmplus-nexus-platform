import type { ConnectorDefinition, ConnectorSlug } from './types'

export const CONNECTOR_CATALOG: ConnectorDefinition[] = [
  {
    slug: 'sap',
    name: 'SAP Connector',
    category: 'Enterprise',
    version: '2.1.0',
    description: 'Connect to SAP ERP systems via OData services',
    includedByDefault: true,
    premium: false,
    credentialFields: [
      { key: 'host', label: 'OData Base URL', type: 'text', required: true, placeholder: 'https://sap.example.com/sap/opu/odata/sap' },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
      { key: 'client', label: 'SAP Client (optional)', type: 'text', required: false },
    ],
  },
  {
    slug: 'oracle',
    name: 'Oracle Connector',
    category: 'Database',
    version: '1.8.5',
    description: 'Oracle database connectivity with schema introspection',
    includedByDefault: true,
    premium: false,
    credentialFields: [
      { key: 'connectionString', label: 'Connection String', type: 'password', required: true, placeholder: 'oracle://user:pass@host:1521/XEPDB1' },
      { key: 'schema', label: 'Schema (optional)', type: 'text', required: false, placeholder: 'HR' },
    ],
  },
  {
    slug: 'mysql',
    name: 'MySQL Connector',
    category: 'Database',
    version: '1.5.2',
    description: 'MySQL and MariaDB support with live schema scan',
    includedByDefault: true,
    premium: false,
    credentialFields: [
      { key: 'connectionString', label: 'Connection String', type: 'password', required: false, placeholder: 'mysql://user:pass@host:3306/db' },
      { key: 'host', label: 'Host', type: 'text', required: false },
      { key: 'port', label: 'Port', type: 'number', required: false, placeholder: '3306' },
      { key: 'database', label: 'Database', type: 'text', required: false },
      { key: 'username', label: 'Username', type: 'text', required: false },
      { key: 'password', label: 'Password', type: 'password', required: false },
      { key: 'schema', label: 'Schema', type: 'text', required: false, placeholder: 'database name' },
    ],
  },
  {
    slug: 'rest',
    name: 'REST API Connector',
    category: 'API',
    version: '3.2.0',
    description: 'Postman-style REST/GraphQL/OData builder with auth, pagination, and live response preview',
    includedByDefault: true,
    premium: false,
    credentialFields: [],
  },
  {
    slug: 'salesforce',
    name: 'Salesforce Connector',
    category: 'SaaS',
    version: '2.4.0',
    description: 'Salesforce CRM via OAuth web login or legacy username/password',
    includedByDefault: false,
    premium: true,
    credentialFields: [],
  },
  {
    slug: 'snowflake',
    name: 'Snowflake Connector',
    category: 'Data Warehouse',
    version: '1.9.2',
    description: 'Snowflake data warehouse with INFORMATION_SCHEMA scan',
    includedByDefault: false,
    premium: true,
    credentialFields: [
      { key: 'account', label: 'Account Identifier', type: 'text', required: true, placeholder: 'xy12345.us-east-1' },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
      { key: 'warehouse', label: 'Warehouse', type: 'text', required: true },
      { key: 'database', label: 'Database', type: 'text', required: true },
      { key: 'schema', label: 'Schema', type: 'text', required: false, placeholder: 'PUBLIC' },
    ],
  },
  {
    slug: 'supabase',
    name: 'Supabase Connector',
    category: 'Database',
    version: '1.0.0',
    description: 'Connect to Supabase Postgres with live schema scan and data preview',
    includedByDefault: true,
    premium: false,
    credentialFields: [
      { key: 'projectUrl', label: 'Project URL', type: 'text', required: true, placeholder: 'https://xxxx.supabase.co' },
      { key: 'secretKey', label: 'Secret Key', type: 'password', required: true, placeholder: 'sb_secret_…' },
      { key: 'publishableKey', label: 'Publishable Key', type: 'password', required: false, placeholder: 'sb_publishable_…' },
      { key: 'databaseUrl', label: 'Database URL (optional)', type: 'password', required: false },
      { key: 'schema', label: 'Schema', type: 'text', required: false, placeholder: 'public' },
    ],
  },
]

export function getConnectorDefinition(slug: string): ConnectorDefinition | undefined {
  return CONNECTOR_CATALOG.find((c) => c.slug === slug)
}

export function isConnectorSlug(slug: string): slug is ConnectorSlug {
  return CONNECTOR_CATALOG.some((c) => c.slug === slug)
}
