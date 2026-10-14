import type { ConnectionTestResult, ConnectorCredentials, ConnectorSlug, SchemaScanResult } from './types'
import * as supabase from './drivers/supabase'
import * as mysql from './drivers/mysql'
import * as postgres from './drivers/postgres'
import * as oracle from './drivers/oracle'
import * as sqlserver from './drivers/sqlserver'
import * as rest from './drivers/rest'
import * as sap from './drivers/sap'
import * as salesforce from './drivers/salesforce'
import * as snowflake from './drivers/snowflake'
import * as talenta from './drivers/talenta'
import * as ldap from './drivers/ldap'
import * as file from './drivers/file'
import * as kmplus from './drivers/kmplus'
import * as prometheus from './drivers/prometheus'
import * as elasticsearch from './drivers/elasticsearch'
import * as datadog from './drivers/datadog'
import * as newrelic from './drivers/newrelic'
import * as grafana from './drivers/grafana'
import * as s3 from './drivers/s3'
import * as azureblob from './drivers/azureblob'
import * as gcs from './drivers/gcs'
import { secretManagerDriver } from '@/lib/secrets/managers'
import { isSecretManager } from '@/lib/secrets/types'
import type { Row } from './http'

export async function testConnectorConnection(
  slug: ConnectorSlug,
  credentials: ConnectorCredentials
): Promise<ConnectionTestResult> {
  switch (slug) {
    case 'supabase':
      return supabase.testSupabaseConnector(credentials)
    case 'mysql':
      return mysql.testMysqlConnection(credentials)
    case 'sqlserver':
      return sqlserver.testSqlServerConnection(credentials)
    case 'postgres':
      return postgres.testPostgresConnection(credentials)
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
    case 'talenta':
      return talenta.testTalentaConnection(credentials)
    case 'ldap':
      return ldap.testLdapConnection(credentials)
    case 'file':
      return file.testFileConnection(credentials)
    case 'kmplus':
      return kmplus.testKmplusConnection(credentials)
    case 'prometheus':
      return prometheus.testPrometheusConnection(credentials)
    case 'elasticsearch':
      return elasticsearch.testElasticsearchConnection(credentials)
    case 'datadog':
      return datadog.testDatadogConnection(credentials)
    case 'newrelic':
      return newrelic.testNewRelicConnection(credentials)
    case 'grafana':
      return grafana.testGrafanaConnection(credentials)
    case 's3':
      return s3.testS3Connection(credentials)
    case 'azureblob':
      return azureblob.testAzureBlobConnection(credentials)
    case 'gcs':
      return gcs.testGcsConnection(credentials)
    case 'vault':
    case 'awssecrets':
    case 'azurekeyvault':
    case 'gcpsecrets':
    case 'doppler':
      return secretManagerDriver(slug).test(credentials)
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
    case 'sqlserver':
      return sqlserver.scanSqlServerSchema(credentials)
    case 'postgres':
      return postgres.scanPostgresSchema(credentials)
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
    case 'talenta':
      return talenta.scanTalentaSchema(credentials)
    case 'ldap':
      return ldap.scanLdapSchema(credentials)
    case 'file':
      return file.scanFileSchema(credentials)
    case 'kmplus':
      return kmplus.scanKmplusSchema(credentials)
    case 'prometheus':
      return prometheus.scanPrometheusSchema(credentials)
    case 'elasticsearch':
      return elasticsearch.scanElasticsearchSchema(credentials)
    case 'datadog':
      return datadog.scanDatadogSchema(credentials)
    case 'newrelic':
      return newrelic.scanNewRelicSchema(credentials)
    case 'grafana':
      return grafana.scanGrafanaSchema(credentials)
    case 's3':
      return s3.scanS3Schema(credentials)
    case 'azureblob':
      return azureblob.scanAzureBlobSchema(credentials)
    case 'gcs':
      return gcs.scanGcsSchema(credentials)
    case 'vault':
    case 'awssecrets':
    case 'azurekeyvault':
    case 'gcpsecrets':
    case 'doppler':
      // Secrets managers have no tables: their secrets are never listed in the catalog or pipelines.
      return { tables: [], scannedAt: new Date().toISOString(), method: 'secrets-manager' }
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
    case 'sqlserver':
      return sqlserver.sampleSqlServerTable(credentials, tableName, limit)
    case 'postgres':
      return postgres.samplePostgresTable(credentials, tableName, limit)
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
    case 'talenta':
      return talenta.sampleTalentaObject(credentials, tableName, limit)
    case 'ldap':
      return ldap.sampleLdapObject(credentials, tableName, limit)
    case 'file':
      return file.sampleFileTable(credentials, tableName, limit)
    case 'kmplus':
      return kmplus.sampleKmplusEntity(credentials, tableName, limit)
    case 'prometheus':
      return prometheus.samplePrometheusTable(credentials, tableName, limit)
    case 'elasticsearch':
      return elasticsearch.sampleElasticsearchIndex(credentials, tableName, limit)
    case 'datadog':
      return datadog.sampleDatadogTable(credentials, tableName, limit)
    case 'newrelic':
      return newrelic.sampleNewRelicTable(credentials, tableName, limit)
    case 'grafana':
      return grafana.sampleGrafanaTable(credentials, tableName, limit)
    case 's3':
      return s3.sampleS3Table(credentials, tableName, limit)
    case 'azureblob':
      return azureblob.sampleAzureBlobTable(credentials, tableName, limit)
    case 'gcs':
      return gcs.sampleGcsTable(credentials, tableName, limit)
    default:
      if (isSecretManager(slug)) throw Object.assign(new Error('Secrets managers are never read as data. Reference their secrets in other data sources’ credentials instead.'), { retryable: false })
      throw new Error(`Unsupported connector: ${slug}`)
  }
}

/**
 * Pipeline reads for connectors with their own read path (instead of a large
 * "sample"): whole files from cloud storage, and Elasticsearch scrolls with the
 * incremental watermark in the query. `watermarkApplied`: the rows are already
 * filtered and ordered by the watermark. Null: use the sample.
 */
export async function readConnectorRows(
  slug: ConnectorSlug,
  credentials: ConnectorCredentials,
  table: string,
  maxRows: number,
  watermark?: { column: string; after: string | null }
): Promise<{ rows: Row[]; watermarkApplied: boolean } | null> {
  switch (slug) {
    case 's3':
      return { rows: await s3.readS3Rows(credentials, table, maxRows), watermarkApplied: false }
    case 'azureblob':
      return { rows: await azureblob.readAzureBlobRows(credentials, table, maxRows), watermarkApplied: false }
    case 'gcs':
      return { rows: await gcs.readGcsRows(credentials, table, maxRows), watermarkApplied: false }
    case 'elasticsearch':
      return { rows: await elasticsearch.readElasticsearchRows(credentials, table, maxRows, watermark), watermarkApplied: Boolean(watermark) }
    default:
      if (isSecretManager(slug)) throw Object.assign(new Error('Secrets managers are never read as data. Reference their secrets in other data sources’ credentials instead.'), { retryable: false })
      return null
  }
}
