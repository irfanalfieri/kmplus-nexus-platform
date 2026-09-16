'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import {
  fetchSupabaseTableSample,
  maskSupabaseCredentials,
  scanSupabaseSchema,
  testSupabaseConnection,
} from '@/lib/supabase/connector'
import type { SupabaseCredentials } from '@/lib/supabase/types'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

function parseCredentials(raw: unknown): SupabaseCredentials {
  const value = raw as Record<string, string | undefined>
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

export async function testSupabaseConnectionAction(credentials: SupabaseCredentials) {
  await getUserId()
  return testSupabaseConnection(credentials)
}

export async function scanSupabaseSchemaAction(credentials: SupabaseCredentials) {
  await getUserId()
  return scanSupabaseSchema(credentials)
}

export async function scanSupabaseSourceSchema(sourceId: string) {
  const userId = await getUserId()
  const source = await getOwnedSource(sourceId, userId)

  if (source.sourceType !== 'supabase') {
    throw new Error('Source is not a Supabase connection')
  }

  const credentials = parseCredentials(source.credentials)
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
  sourceId: string,
  tableName: string,
  limit = 25
) {
  const userId = await getUserId()
  const source = await getOwnedSource(sourceId, userId)

  if (source.sourceType !== 'supabase') {
    throw new Error('Source is not a Supabase connection')
  }

  const credentials = parseCredentials(source.credentials)
  return fetchSupabaseTableSample(credentials, tableName, limit)
}

export async function updateSupabaseSourceCredentials(
  sourceId: string,
  credentials: SupabaseCredentials
) {
  const userId = await getUserId()
  const test = await testSupabaseConnection(credentials)

  if (!test.ok) {
    return { ok: false as const, message: test.message }
  }

  const scan = await scanSupabaseSchema(credentials)

  await db
    .update(dataSources)
    .set({
      credentials,
      config: { schemaScan: scan },
      status: 'connected',
      lastConnected: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.userId, userId)))

  revalidatePath('/dashboard')
  return { ok: true as const, scan, maskedCredentials: maskSupabaseCredentials(credentials) }
}
