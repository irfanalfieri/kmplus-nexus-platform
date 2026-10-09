'use server'

import { z } from 'zod'
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
import { requireUserId } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'

const slugSchema = z.string().trim().min(1).max(60)
const idSchema = z.string().trim().min(1).max(100)
const tableSchema = z.string().trim().min(1).max(256)
const limitSchema = z.number().int().min(1).max(500).default(25)
/** Credential form values: flat string map, bounded in size. */
const credentialsSchema = z
  .record(z.string().max(100), z.union([z.string().max(20000), z.number(), z.boolean(), z.null()]))
  .refine((v) => Object.keys(v).length <= 100, 'Too many credential fields')
  .transform((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x == null ? '' : String(x)])) as ConnectorCredentials)

function parseSlug(raw: string): ConnectorSlug {
  const slug = slugSchema.parse(raw)
  if (!isConnectorSlug(slug)) throw new Error('Invalid connector type')
  return slug
}

const getUserId = requireUserId

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

export async function testConnectorConnectionAction(rawSlug: string, rawCredentials: ConnectorCredentials) {
  await getUserId()
  const slug = parseSlug(rawSlug)
  const credentials = credentialsSchema.parse(rawCredentials)
  await assertConnectorInstalled(slug)
  return testConnectorConnection(slug, credentials)
}

export async function scanConnectorSchemaAction(rawSlug: string, rawCredentials: ConnectorCredentials) {
  await getUserId()
  const slug = parseSlug(rawSlug)
  const credentials = credentialsSchema.parse(rawCredentials)
  await assertConnectorInstalled(slug)
  return scanConnectorSchema(slug, credentials)
}

export async function scanDataSourceSchema(rawSourceId: string) {
  const userId = await getUserId()
  const sourceId = idSchema.parse(rawSourceId)
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

export async function getDataSourceTableSample(rawSourceId: string, rawTableName: string, rawLimit = 25) {
  const userId = await getUserId()
  const sourceId = idSchema.parse(rawSourceId)
  const tableName = tableSchema.parse(rawTableName)
  const limit = limitSchema.parse(rawLimit)
  const source = await getOwnedSource(sourceId, userId)
  if (!isConnectorSlug(source.sourceType)) throw new Error('Unsupported source type')

  await assertConnectorInstalled(source.sourceType)
  const credentials = parseCredentials(source.id, source.credentials)
  return sampleConnectorTable(source.sourceType as ConnectorSlug, credentials, tableName, limit)
}

export async function previewRestConnection(rawCredentials: ConnectorCredentials) {
  await getUserId()
  const credentials = credentialsSchema.parse(rawCredentials)
  await assertConnectorInstalled('rest')
  return previewRestRequest(parseRestConfig(credentials))
}

export async function testAndScanDataSource(
  rawSlug: string,
  rawCredentials: ConnectorCredentials
) {
  await getUserId()
  const slug = parseSlug(rawSlug)
  const credentials = credentialsSchema.parse(rawCredentials)
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
