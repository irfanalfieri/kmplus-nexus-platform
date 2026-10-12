'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { catalogEntries, dataSources } from '@/lib/db/schema'
import { assertConnectorInstalled } from '@/lib/connectors/install-check'
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
import { requireWorkspace } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { restoreSecrets } from '@/lib/connectors/secret-mask'
import type { Permission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { guard } from '@/lib/server-action'
import { sampleSource, scanSource } from '@/lib/agent/sources'
import { sourceKey } from '@/lib/catalog/definition'
import { applyMasks, liveTableAccess } from '@/lib/governance/masking'

const slugSchema = z.string().trim().min(1).max(60)
const idSchema = z.string().trim().min(1).max(100)
const tableSchema = z.string().trim().min(1).max(256)
const limitSchema = z.number().int().min(1).max(500).default(25)
/** Credential form values: flat string map, bounded in size. */
const credentialsSchema = z
  .record(z.string().max(100), z.union([z.string().max(20000), z.number(), z.boolean(), z.null()]))
  .refine((v) => Object.keys(v).length <= 100, 'Too many credential fields')
  .transform((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x == null ? '' : String(x)])) as ConnectorCredentials)

/**
 * Credentials typed in the browser. File sources have none: their storage key
 * is assigned by the server, so a key sent from the browser (which could name
 * another source's uploads) is dropped.
 */
function userCredentials(slug: ConnectorSlug, raw: unknown): ConnectorCredentials {
  return slug === 'file' ? {} : credentialsSchema.parse(raw)
}

function parseSlug(raw: string): ConnectorSlug {
  const slug = slugSchema.parse(raw)
  if (!isConnectorSlug(slug)) throw new Error('Invalid connector type')
  return slug
}

/** Resolves the active workspace and enforces the permission; returns its id for scoping. */
async function workspaceFor(permission: Permission) {
  return (await requireWorkspace(permission)).workspaceId
}

function parseCredentials(sourceId: string, stored: unknown): ConnectorCredentials {
  const entries = Object.entries(decryptCredentials(sourceId, stored))
  return Object.fromEntries(
    entries.map(([key, value]) => [key, value == null ? '' : String(value)])
  )
}

async function getOwnedSource(sourceId: string, workspaceId: string) {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.workspaceId, workspaceId)))
    .limit(1)

  if (!source) throw new Error('Data source not found')
  return source
}

async function testConnectorConnectionActionImpl(rawSlug: string, rawCredentials: ConnectorCredentials) {
  await workspaceFor('sources:manage')
  const slug = parseSlug(rawSlug)
  const credentials = userCredentials(slug, rawCredentials)
  await assertConnectorInstalled(slug)
  return testConnectorConnection(slug, credentials)
}

async function scanConnectorSchemaActionImpl(rawSlug: string, rawCredentials: ConnectorCredentials) {
  await workspaceFor('sources:manage')
  const slug = parseSlug(rawSlug)
  const credentials = userCredentials(slug, rawCredentials)
  await assertConnectorInstalled(slug)
  return scanConnectorSchema(slug, credentials)
}

async function scanDataSourceSchemaImpl(rawSourceId: string) {
  const workspaceId = await workspaceFor('sources:manage')
  const sourceId = idSchema.parse(rawSourceId)
  const source = await getOwnedSource(sourceId, workspaceId)
  if (!isConnectorSlug(source.sourceType)) throw new Error('Unsupported source type')

  await assertConnectorInstalled(source.sourceType)
  let credentials = parseCredentials(source.id, source.credentials)

  if (source.sourceType === 'salesforce') {
    const auth = await resolveSalesforceAuth(credentials)
    if (auth.refreshed) credentials = auth.refreshed as ConnectorCredentials
  }

  const scan = await scanSource(source, credentials)

  await db
    .update(dataSources)
    .set({
      config: { ...(source.config as Record<string, unknown>), schemaScan: scan },
      credentials: encryptCredentials(sourceId, credentials, workspaceId),
      status: 'connected',
      lastConnected: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.workspaceId, workspaceId)))

  revalidatePath('/dashboard', 'layout')
  return scan
}

async function getDataSourceTableSampleImpl(rawSourceId: string, rawTableName: string, rawLimit = 25) {
  const ctx = await requireWorkspace('data:preview')
  const workspaceId = ctx.workspaceId
  const sourceId = idSchema.parse(rawSourceId)
  const tableName = tableSchema.parse(rawTableName)
  const limit = limitSchema.parse(rawLimit)
  const source = await getOwnedSource(sourceId, workspaceId)
  if (!isConnectorSlug(source.sourceType)) throw new Error('Unsupported source type')

  await assertConnectorInstalled(source.sourceType)
  const credentials = parseCredentials(source.id, source.credentials)
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'data_source', resourceId: sourceId, changes: { what: 'source_sample', table: tableName } })
  const sample = await sampleSource(source, credentials, tableName, limit)
  // Personal columns are masked for roles without unmasked access, like catalog live samples (TD-21).
  const [entry] = await db.select({ alias: catalogEntries.alias }).from(catalogEntries).where(and(eq(catalogEntries.workspaceId, workspaceId), eq(catalogEntries.key, sourceKey(sourceId, tableName)))).limit(1)
  const rows = sample.rows as Record<string, unknown>[]
  const { masks } = await liveTableAccess(workspaceId, entry?.alias ?? null, ctx.role, Array.from(new Set(rows.flatMap((r) => Object.keys(r)))))
  return { ...sample, rows: applyMasks(rows, masks), masked: Object.keys(masks) }
}

/** Live REST request preview. With sourceId (edit form), masked secrets are filled from that source. */
async function previewRestConnectionImpl(rawCredentials: ConnectorCredentials, rawSourceId?: string) {
  const workspaceId = await workspaceFor('sources:manage')
  let credentials = credentialsSchema.parse(rawCredentials)
  if (rawSourceId) {
    const source = await getOwnedSource(idSchema.parse(rawSourceId), workspaceId)
    credentials = restoreSecrets('rest', credentials, parseCredentials(source.id, source.credentials))
  }
  await assertConnectorInstalled('rest')
  return previewRestRequest(parseRestConfig(credentials))
}

async function testAndScanDataSourceImpl(
  rawSlug: string,
  rawCredentials: ConnectorCredentials
) {
  await workspaceFor('sources:manage')
  const slug = parseSlug(rawSlug)
  const credentials = userCredentials(slug, rawCredentials)
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

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/connector-source.ts. ──

export async function testConnectorConnectionAction(...args: Parameters<typeof testConnectorConnectionActionImpl>) {
  return guard(() => testConnectorConnectionActionImpl(...args))
}

export async function scanConnectorSchemaAction(...args: Parameters<typeof scanConnectorSchemaActionImpl>) {
  return guard(() => scanConnectorSchemaActionImpl(...args))
}

export async function scanDataSourceSchema(...args: Parameters<typeof scanDataSourceSchemaImpl>) {
  return guard(() => scanDataSourceSchemaImpl(...args))
}

export async function getDataSourceTableSample(...args: Parameters<typeof getDataSourceTableSampleImpl>) {
  return guard(() => getDataSourceTableSampleImpl(...args))
}

export async function previewRestConnection(...args: Parameters<typeof previewRestConnectionImpl>) {
  return guard(() => previewRestConnectionImpl(...args))
}

export async function testAndScanDataSource(...args: Parameters<typeof testAndScanDataSourceImpl>) {
  return guard(() => testAndScanDataSourceImpl(...args))
}
