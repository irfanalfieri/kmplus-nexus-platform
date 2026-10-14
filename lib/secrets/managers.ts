import type { ConnectionTestResult, ConnectorCredentials } from '@/lib/connectors/types'
import { getAwsSecret, listAwsSecrets, testAwsSecretsConnection } from '@/lib/connectors/drivers/awssecrets'
import { getAzureSecret, listAzureSecrets, testAzureKeyVaultConnection } from '@/lib/connectors/drivers/azurekeyvault'
import { getDopplerSecret, listDopplerSecrets, testDopplerConnection } from '@/lib/connectors/drivers/doppler'
import { getGcpSecret, listGcpSecrets, testGcpSecretsConnection } from '@/lib/connectors/drivers/gcpsecrets'
import { getVaultSecret, listVaultSecrets, testVaultConnection } from '@/lib/connectors/drivers/vault'
import type { SecretManagerSlug, SecretValue } from './types'

/** The secrets-manager drivers: test the connection, list secret names (never values), read one secret. No database access. */
export interface SecretManagerDriver {
  test(credentials: ConnectorCredentials): Promise<ConnectionTestResult>
  list(credentials: ConnectorCredentials, prefix?: string): Promise<string[]>
  get(credentials: ConnectorCredentials, path: string): Promise<SecretValue>
}

const DRIVERS: Record<SecretManagerSlug, SecretManagerDriver> = {
  vault: { test: testVaultConnection, list: listVaultSecrets, get: getVaultSecret },
  awssecrets: { test: testAwsSecretsConnection, list: listAwsSecrets, get: getAwsSecret },
  azurekeyvault: { test: testAzureKeyVaultConnection, list: listAzureSecrets, get: getAzureSecret },
  gcpsecrets: { test: testGcpSecretsConnection, list: listGcpSecrets, get: getGcpSecret },
  doppler: { test: testDopplerConnection, list: listDopplerSecrets, get: getDopplerSecret },
}

export const secretManagerDriver = (slug: SecretManagerSlug): SecretManagerDriver => DRIVERS[slug]
