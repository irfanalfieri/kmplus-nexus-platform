import type { ConnectorGroup, ConnectorSlug } from './types'

/**
 * What each connector can do (CM-4 connector detail page). Client-safe and
 * pure; engine tests keep it equal to the code paths that implement it:
 * writers (`WRITABLE_CONNECTORS` in lib/pipelines/io.ts), incremental reads
 * and live queries filtered at the source (io.ts), and the connection types a
 * Nexus Agent accepts.
 */

/** Pipelines can write to these (destination role). Mirrors WRITABLE_CONNECTORS in lib/pipelines/io.ts. */
export const WRITE_CAPABLE: readonly ConnectorSlug[] = ['postgres', 'mysql', 'supabase', 'kmplus', 'rest']
/** Incremental reads filter by the watermark in the source's own query. Others filter after reading. */
export const INCREMENTAL_AT_SOURCE: readonly ConnectorSlug[] = ['postgres', 'supabase', 'mysql', 'sqlserver', 'file', 'elasticsearch']
/** Catalog live queries push equality filters down to the source. Others filter in Nexus. */
export const LIVE_PUSHDOWN: readonly ConnectorSlug[] = ['postgres', 'supabase', 'mysql', 'sqlserver', 'file']
/** Connection types a Nexus Agent can reach inside a customer network (agent/README.md). */
export const AGENT_CAPABLE: readonly ConnectorSlug[] = ['postgres', 'mysql', 'sqlserver', 'oracle', 'prometheus', 'elasticsearch', 'grafana', 'datadog', 'newrelic', 's3', 'azureblob', 'gcs', 'snowflake', 'sap', 'ldap', 'rest', 'talenta', 'supabase', 'kmplus']
const SECRETS: readonly ConnectorSlug[] = ['vault', 'awssecrets', 'azurekeyvault', 'gcpsecrets', 'doppler']

export type Support = 'yes' | 'partial' | 'no'

export interface Capabilities {
  /** Credential provider only: never read or written as data. */
  secrets: boolean
  read: Support
  write: Support
  /** yes = filtered at the source, partial = filtered by Nexus after reading. */
  incremental: Support
  /** Catalog live queries: yes = filters pushed down, partial = filtered in Nexus. */
  live: Support
  /** Change data capture (log-based): not offered yet; incremental reads cover updates with a timestamp column. */
  cdc: Support
  /** Reachable inside a private network through a Nexus Agent. */
  agent: Support
  /** Enrich / "Changes data" API steps call it. */
  apiSteps: Support
}

export function connectorCapabilities(slug: ConnectorSlug): Capabilities {
  const secrets = SECRETS.includes(slug)
  if (secrets) return { secrets, read: 'no', write: 'no', incremental: 'no', live: 'no', cdc: 'no', agent: 'no', apiSteps: 'no' }
  return {
    secrets,
    read: 'yes',
    write: WRITE_CAPABLE.includes(slug) ? 'yes' : 'no',
    incremental: INCREMENTAL_AT_SOURCE.includes(slug) ? 'yes' : 'partial',
    live: LIVE_PUSHDOWN.includes(slug) ? 'yes' : 'partial',
    cdc: 'no',
    agent: AGENT_CAPABLE.includes(slug) ? 'yes' : 'no',
    apiSteps: slug === 'rest' ? 'yes' : 'no',
  }
}

/** The Help & FAQ section that explains a connector group in depth. */
export const GROUP_HELP: Record<ConnectorGroup, string> = {
  applications: 'connect-sources',
  kmplus: 'connect-destinations',
  databases: 'connect-sources',
  apis: 'connect-intranet',
  files: 'connect-files',
  infrastructure: 'connect-infrastructure',
  identity: 'connect-sources',
  secrets: 'connect-secrets',
}
