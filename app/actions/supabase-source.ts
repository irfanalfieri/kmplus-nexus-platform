'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import {
  fetchSupabaseTableSample,
  maskSupabaseCredentials,
  scanSupabaseSchema,
  testSupabaseConnection,
} from '@/lib/supabase/connector'
import type { SupabaseCredentials } from '@/lib/supabase/types'
import { decryptCredentials, encryptCredentials } from '@/lib/security/credentials'
import { and, eq } from 'drizzle-orm'
import { requireWorkspace } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import type { Permission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { guard } from '@/lib/server-action'

/** Resolves the active workspace and enforces the permission; returns its id for scoping. */
async function workspaceFor(permission: Permission) {
  return (await requireWorkspace(permission)).workspaceId
}
const idSchema = z.string().trim().min(1).max(100)
const supabaseCredentialsSchema = z.object({
  projectUrl: z.string().trim().url('Project URL must be a URL').max(300),
  apiKey: z.string().trim().min(1, 'API key is required').max(5000),
  publishableKey: z.string().trim().max(5000).optional(),
  databaseUrl: z.string().trim().max(2000).optional(),
  schema: z.string().trim().max(63).optional(),
})

function parseCredentials(sourceId: string, stored: unknown): SupabaseCredentials {
  const value = decryptCredentials(sourceId, stored) as Record<string, string | undefined>
  const secretKey = value.apiKey?.trim() ?? value.secretKey?.trim() ?? ''
  const publishableKey = value.publishableKey?.trim() || undefined
  return {
    projectUrl: value.projectUrl?.trim() ?? '',
    apiKey: secretKey || publishableKey || '',
    publishableKey,
    databaseUrl: value.databaseUrl?.trim() || undefined,
    schema: value.schema?.trim() || 'public',
  }
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

async function testSupabaseConnectionActionImpl(rawCredentials: SupabaseCredentials) {
  await workspaceFor('sources:manage')
  return testSupabaseConnection(supabaseCredentialsSchema.parse(rawCredentials))
}

async function scanSupabaseSchemaActionImpl(rawCredentials: SupabaseCredentials) {
  await workspaceFor('sources:manage')
  return scanSupabaseSchema(supabaseCredentialsSchema.parse(rawCredentials))
}

async function scanSupabaseSourceSchemaImpl(rawSourceId: string) {
  const workspaceId = await workspaceFor('sources:manage')
  const sourceId = idSchema.parse(rawSourceId)
  const source = await getOwnedSource(sourceId, workspaceId)

  if (source.sourceType !== 'supabase') {
    throw new Error('Source is not a Supabase connection')
  }

  const credentials = parseCredentials(source.id, source.credentials)
  const scan = await scanSupabaseSchema(credentials)

  await db
    .update(dataSources)
    .set({
      config: {
        ...(source.config as Record<string, unknown>),
        schemaScan: scan,
      },
      status: 'connected',
      lastConnected: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.workspaceId, workspaceId)))

  revalidatePath('/dashboard')
  return scan
}

async function getSupabaseTableSampleActionImpl(
  rawSourceId: string,
  rawTableName: string,
  rawLimit = 25
) {
  const ctx = await requireWorkspace('data:preview')
  const workspaceId = ctx.workspaceId
  const sourceId = idSchema.parse(rawSourceId)
  const tableName = z.string().trim().min(1).max(256).parse(rawTableName)
  const limit = z.number().int().min(1).max(500).parse(rawLimit)
  const source = await getOwnedSource(sourceId, workspaceId)

  if (source.sourceType !== 'supabase') {
    throw new Error('Source is not a Supabase connection')
  }

  const credentials = parseCredentials(source.id, source.credentials)
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'data_source', resourceId: sourceId, changes: { what: 'source_sample', table: tableName } })
  return fetchSupabaseTableSample(credentials, tableName, limit)
}

async function updateSupabaseSourceCredentialsImpl(
  rawSourceId: string,
  rawCredentials: SupabaseCredentials
) {
  const workspaceId = await workspaceFor('sources:manage')
  const sourceId = idSchema.parse(rawSourceId)
  const credentials = supabaseCredentialsSchema.parse(rawCredentials)
  await getOwnedSource(sourceId, workspaceId)
  const test = await testSupabaseConnection(credentials)

  if (!test.ok) {
    return { ok: false as const, message: test.message }
  }

  const scan = await scanSupabaseSchema(credentials)

  await db
    .update(dataSources)
    .set({
      credentials: encryptCredentials(sourceId, credentials as unknown as Record<string, unknown>),
      config: { schemaScan: scan },
      status: 'connected',
      lastConnected: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.workspaceId, workspaceId)))

  revalidatePath('/dashboard')
  return { ok: true as const, scan, maskedCredentials: maskSupabaseCredentials(credentials) }
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/supabase-source.ts. ──

export async function testSupabaseConnectionAction(...args: Parameters<typeof testSupabaseConnectionActionImpl>) {
  return guard(() => testSupabaseConnectionActionImpl(...args))
}

export async function scanSupabaseSchemaAction(...args: Parameters<typeof scanSupabaseSchemaActionImpl>) {
  return guard(() => scanSupabaseSchemaActionImpl(...args))
}

export async function scanSupabaseSourceSchema(...args: Parameters<typeof scanSupabaseSourceSchemaImpl>) {
  return guard(() => scanSupabaseSourceSchemaImpl(...args))
}

export async function getSupabaseTableSampleAction(...args: Parameters<typeof getSupabaseTableSampleActionImpl>) {
  return guard(() => getSupabaseTableSampleActionImpl(...args))
}

export async function updateSupabaseSourceCredentials(...args: Parameters<typeof updateSupabaseSourceCredentialsImpl>) {
  return guard(() => updateSupabaseSourceCredentialsImpl(...args))
}
