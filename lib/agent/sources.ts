import { sampleConnectorTable, scanConnectorSchema, testConnectorConnection } from '@/lib/connectors/runtime'
import type { ConnectionTestResult, ConnectorCredentials, ConnectorSlug, SchemaScanResult } from '@/lib/connectors/types'
import { agentOf, callAgent } from './server'

/**
 * Test / scan / sample for a data source, wherever it lives: directly from
 * Nexus, or through the Nexus Agent named in its config (#13).
 */

type Source = { sourceType: string; config: unknown; workspaceId: string }

export async function testSource(source: Source, credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  const via = agentOf(source)
  if (via) return (await callAgent(via.agentId, 'test', { connection: via.connection }, { timeoutMs: 60_000, workspaceId: via.workspaceId })) as ConnectionTestResult
  return testConnectorConnection(source.sourceType as ConnectorSlug, credentials)
}

export async function scanSource(source: Source, credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const via = agentOf(source)
  if (via) return (await callAgent(via.agentId, 'scan', { connection: via.connection }, { timeoutMs: 120_000, workspaceId: via.workspaceId })) as SchemaScanResult
  return scanConnectorSchema(source.sourceType as ConnectorSlug, credentials)
}

export async function sampleSource(source: Source, credentials: ConnectorCredentials, table: string, limit: number) {
  const via = agentOf(source)
  if (via) return (await callAgent(via.agentId, 'sample', { connection: via.connection, table, limit }, { timeoutMs: 60_000, workspaceId: via.workspaceId })) as Awaited<ReturnType<typeof sampleConnectorTable>>
  return sampleConnectorTable(source.sourceType as ConnectorSlug, credentials, table, limit)
}
