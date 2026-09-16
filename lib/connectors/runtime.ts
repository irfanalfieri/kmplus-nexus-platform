import type { ConnectionTestResult, ConnectorCredentials, ConnectorSlug, SchemaScanResult } from './types'
import * as supabase from './drivers/supabase'
import * as mysql from './drivers/mysql'
import * as postgres from './drivers/postgres'
import * as oracle from './drivers/oracle'
import * as rest from './drivers/rest'
import * as sap from './drivers/sap'
import * as salesforce from './drivers/salesforce'
import * as snowflake from './drivers/snowflake'

export async function testConnectorConnection(
  slug: ConnectorSlug,
  credentials: ConnectorCredentials
): Promise<ConnectionTestResult> {
  switch (slug) {
    case 'supabase':
      return supabase.testSupabaseConnector(credentials)
    case 'mysql':
      return mysql.testMysqlConnection(credentials)
    case 'oracle':
      return oracle.testOracleConnection(credentials)
    case 'rest':
      return rest.testRestConnection(credentials)
    case 'sap':
      return sap.testSapConnection(credentials)
    case 'salesforce':
      return salesforce.testSalesforceConnection(credentials)
    case 'snowflake':
      return snowflake.testSnowflakeConnection(credentials)
    default:
      return { ok: false, message: `Unsupported connector: ${slug}` }
  }
}

export async function scanConnectorSchema(
  slug: ConnectorSlug,
  credentials: ConnectorCredentials
): Promise<SchemaScanResult> {
  switch (slug) {
    case 'supabase':
      return supabase.scanSupabaseConnector(credentials)
    case 'mysql':
      return mysql.scanMysqlSchema(credentials)
    case 'oracle':
      return oracle.scanOracleSchema(credentials)
    case 'rest':
      return rest.scanRestSchema(credentials)
    case 'sap':
      return sap.scanSapSchema(credentials)
    case 'salesforce':
      return salesforce.scanSalesforceSchema(credentials)
    case 'snowflake':
      return snowflake.scanSnowflakeSchema(credentials)
    default:
      throw new Error(`Unsupported connector: ${slug}`)
  }
}

export async function sampleConnectorTable(
  slug: ConnectorSlug,
  credentials: ConnectorCredentials,
  tableName: string,
  limit = 25
) {
  switch (slug) {
    case 'supabase':
      return supabase.sampleSupabaseTable(credentials, tableName, limit)
    case 'mysql':
      return mysql.sampleMysqlTable(credentials, tableName, limit)
    case 'oracle':
      return oracle.sampleOracleTable(credentials, tableName, limit)
    case 'rest':
      return rest.sampleRestTable(credentials, tableName, limit)
    case 'sap':
      return sap.sampleSapEntity(credentials, tableName, limit)
    case 'salesforce':
      return salesforce.sampleSalesforceObject(credentials, tableName, limit)
    case 'snowflake':
      return snowflake.sampleSnowflakeTable(credentials, tableName, limit)
    default:
      throw new Error(`Unsupported connector: ${slug}`)
  }
}
