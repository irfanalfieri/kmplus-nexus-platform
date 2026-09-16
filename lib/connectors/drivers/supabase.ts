import {
  fetchSupabaseTableSample,
  scanSupabaseSchema,
  testSupabaseConnection,
} from '@/lib/supabase/connector'
import type { ConnectorCredentials } from '../types'

function toSupabaseCredentials(credentials: ConnectorCredentials) {
  return {
    projectUrl: credentials.projectUrl ?? '',
    apiKey: credentials.secretKey ?? credentials.apiKey ?? '',
    publishableKey: credentials.publishableKey,
    databaseUrl: credentials.databaseUrl,
    schema: credentials.schema ?? 'public',
  }
}

export async function testSupabaseConnector(credentials: ConnectorCredentials) {
  return testSupabaseConnection(toSupabaseCredentials(credentials))
}

export async function scanSupabaseConnector(credentials: ConnectorCredentials) {
  const scan = await scanSupabaseSchema(toSupabaseCredentials(credentials))
  return {
    ...scan,
    method: scan.method,
  }
}

export async function sampleSupabaseTable(
  credentials: ConnectorCredentials,
  tableName: string,
  limit = 25
) {
  return fetchSupabaseTableSample(toSupabaseCredentials(credentials), tableName, limit)
}
