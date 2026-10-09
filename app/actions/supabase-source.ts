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
import { requireUserId } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'

const getUserId = requireUserId
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

async function getOwnedSource(sourceId: string, userId: string) {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.userId, userId)))
    .limit(1)

  if (!source) throw new Error('Data source not found')
  return source
}

export async function testSupabaseConnectionAction(rawCredentials: SupabaseCredentials) {
  await getUserId()
  return testSupabaseConnection(supabaseCredentialsSchema.parse(rawCredentials))
}

export async function scanSupabaseSchemaAction(rawCredentials: SupabaseCredentials) {
  await getUserId()
  return scanSupabaseSchema(supabaseCredentialsSchema.parse(rawCredentials))
}

export async function scanSupabaseSourceSchema(rawSourceId: string) {
  const userId = await getUserId()
  const sourceId = idSchema.parse(rawSourceId)
  const source = await getOwnedSource(sourceId, userId)

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
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.userId, userId)))

  revalidatePath('/dashboard')
  return scan
}

export async function getSupabaseTableSampleAction(
  rawSourceId: string,
  rawTableName: string,
  rawLimit = 25
) {
  const userId = await getUserId()
  const sourceId = idSchema.parse(rawSourceId)
  const tableName = z.string().trim().min(1).max(256).parse(rawTableName)
  const limit = z.number().int().min(1).max(500).parse(rawLimit)
  const source = await getOwnedSource(sourceId, userId)

  if (source.sourceType !== 'supabase') {
    throw new Error('Source is not a Supabase connection')
  }

  const credentials = parseCredentials(source.id, source.credentials)
  return fetchSupabaseTableSample(credentials, tableName, limit)
}

export async function updateSupabaseSourceCredentials(
  rawSourceId: string,
  rawCredentials: SupabaseCredentials
) {
  const userId = await getUserId()
  const sourceId = idSchema.parse(rawSourceId)
  const credentials = supabaseCredentialsSchema.parse(rawCredentials)
  await getOwnedSource(sourceId, userId)
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
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.userId, userId)))

  revalidatePath('/dashboard')
  return { ok: true as const, scan, maskedCredentials: maskSupabaseCredentials(credentials) }
}
