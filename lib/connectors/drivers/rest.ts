import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult } from '../types'
import {
  parseRestConfig,
  sampleRestConfig,
  scanRestConfig,
  testRestConfig,
} from '../rest-client'

export async function testRestConnection(
  credentials: ConnectorCredentials
): Promise<ConnectionTestResult> {
  return testRestConfig(parseRestConfig(credentials))
}

export async function scanRestSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  return scanRestConfig(parseRestConfig(credentials))
}

export async function sampleRestTable(
  credentials: ConnectorCredentials,
  tableName: string,
  limit = 25
) {
  return sampleRestConfig(parseRestConfig(credentials), tableName, limit)
}
