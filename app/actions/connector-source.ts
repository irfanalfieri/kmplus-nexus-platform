'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { assertConnectorInstalled } from '@/app/actions/connectors'
import { isConnectorSlug } from '@/lib/connectors/catalog'
import type { ConnectorCredentials, ConnectorSlug } from '@/lib/connectors/types'
import {
  sampleConnectorTable,
  scanConnectorSchema,
  testConnectorConnection,
} from '@/lib/connectors/runtime'
import { parseRestConfig, previewRestRequest } from '@/lib/connectors/rest-client'
import { resolveSalesforceAuth } from '@/lib/connectors/salesforce/oauth'
import { decryptCredentials, encryptCredentials } from '@/lib/security/credentials'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

function parseCredentials(sourceId: string, stored: unknown): ConnectorCredentials {
  const entries = Object.entries(decryptCredentials(sourceId, stored))
  return Object.fromEntries(
    entries.map(([key, value]) => [key, value == null ? '' : String(value)])
  )
}

async function getOwnedSource(sourceId: string, userId: string) {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.userId, userId)))
    .limit(1)

  if (!source) throw new Error('Data source not found')
  return source
}

export async function testConnectorConnectionAction(slug: string, credentials: ConnectorCredentials) {
  await getUserId()
  if (!isConnectorSlug(slug)) throw new Error('Invalid connector type')
  await assertConnectorInstalled(slug)
  return testConnectorConnection(slug, credentials)
}

export async function scanConnectorSchemaAction(slug: string, credentials: ConnectorCredentials) {
  await getUserId()
  if (!isConnectorSlug(slug)) throw new Error('Invalid connector type')
  await assertConnectorInstalled(slug)
  return scanConnectorSchema(slug, credentials)
}

export async function scanDataSourceSchema(sourceId: string) {
  const userId = await getUserId()
  const source = await getOwnedSource(sourceId, userId)
  if (!isConnectorSlug(source.sourceType)) throw new Error('Unsupported source type')

  await assertConnectorInstalled(source.sourceType)
  let credentials = parseCredentials(source.id, source.credentials)

  if (source.sourceType === 'salesforce') {
    const auth = await resolveSalesforceAuth(credentials)
    if (auth.refreshed) credentials = auth.refreshed as ConnectorCredentials
  }

  const scan = await scanConnectorSchema(source.sourceType as ConnectorSlug, credentials)

  await db
    .update(dataSources)
    .set({
      config: { ...(source.config as Record<string, unknown>), schemaScan: scan },
      credentials: encryptCredentials(sourceId, credentials),
      status: 'connected',
      lastConnected: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.userId, userId)))

  revalidatePath('/dashboard')
  return scan
}

export async function getDataSourceTableSample(sourceId: string, tableName: string, limit = 25) {
  const userId = await getUserId()
  const source = await getOwnedSource(sourceId, userId)
  if (!isConnectorSlug(source.sourceType)) throw new Error('Unsupported source type')

  await assertConnectorInstalled(source.sourceType)
  const credentials = parseCredentials(source.id, source.credentials)
  return sampleConnectorTable(source.sourceType as ConnectorSlug, credentials, tableName, limit)
}

export async function previewRestConnection(credentials: ConnectorCredentials) {
  await getUserId()
  await assertConnectorInstalled('rest')
  return previewRestRequest(parseRestConfig(credentials))
}

export async function testAndScanDataSource(
  slug: string,
  credentials: ConnectorCredentials
) {
  await getUserId()
  if (!isConnectorSlug(slug)) throw new Error('Invalid connector type')
  await assertConnectorInstalled(slug)

  const test = await testConnectorConnection(slug, credentials)
  if (!test.ok) {
    return {
      ok: false as const,
      message: test.message,
      preview: 'preview' in test ? (test as { preview?: unknown }).preview : undefined,
    }
  }

  const scan = await scanConnectorSchema(slug, credentials)
  return {
    ok: true as const,
    test,
    scan,
    preview: 'preview' in test ? (test as { preview?: unknown }).preview : undefined,
  }
}
