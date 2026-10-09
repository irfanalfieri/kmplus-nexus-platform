'use server'

import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { auditLogs, dataSources, pipelines } from '@/lib/db/schema'
import { assertConnectorInstalled } from '@/app/actions/connectors'
import { isConnectorSlug } from '@/lib/connectors/catalog'
import { decryptCredentials, encryptCredentials } from '@/lib/security/credentials'
import { newId, requireUserId } from '@/lib/auth/session'

const idSchema = z.string().trim().min(1).max(100)
const roleSchema = z.enum(['source', 'destination'])

async function audit(userId: string, action: string, resourceId: string, changes?: Record<string, unknown>) {
  await db.insert(auditLogs).values({ id: newId('audit'), userId, action, resource: 'data_source', resourceId, changes })
}

export async function getDataSources() {
  const userId = await requireUserId()
  // Never send credentials to the client.
  return db
    .select({
      id: dataSources.id,
      userId: dataSources.userId,
      name: dataSources.name,
      type: dataSources.type,
      sourceType: dataSources.sourceType,
      config: dataSources.config,
      status: dataSources.status,
      lastConnected: dataSources.lastConnected,
      createdAt: dataSources.createdAt,
      updatedAt: dataSources.updatedAt,
    })
    .from(dataSources)
    .where(eq(dataSources.userId, userId))
    .orderBy(desc(dataSources.createdAt))
}

const createInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  type: z.string().trim().min(1).max(60),
  sourceType: z.string().trim().min(1).max(60),
  config: z
    .object({ role: roleSchema.default('source'), schemaScan: z.unknown().optional() })
    .passthrough()
    .default({ role: 'source' }),
  credentials: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
})

export async function createDataSource(input: z.input<typeof createInput>) {
  const userId = await requireUserId()
  const data = createInput.parse(input)
  if (!isConnectorSlug(data.sourceType)) throw new Error(`Unknown connector "${data.sourceType}".`)
  await assertConnectorInstalled(data.sourceType)

  const id = newId('src')
  const hasSchemaScan = Boolean(data.config.schemaScan)
  await db.insert(dataSources).values({
    id,
    userId,
    name: data.name,
    type: data.type,
    sourceType: data.sourceType,
    config: data.config,
    credentials: encryptCredentials(id, data.credentials),
    status: hasSchemaScan ? 'connected' : 'disconnected',
    lastConnected: hasSchemaScan ? new Date() : undefined,
  })
  await audit(userId, 'CREATE', id, { sourceType: data.sourceType, role: data.config.role })
  revalidatePath('/dashboard')
  return id
}

export async function testConnection(rawId: string) {
  const userId = await requireUserId()
  const id = idSchema.parse(rawId)
  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))
    .limit(1)
  if (!source) throw new Error('Data source not found')
  if (!isConnectorSlug(source.sourceType)) throw new Error(`Unknown connector "${source.sourceType}".`)

  const { testConnectorConnection, scanConnectorSchema } = await import('@/lib/connectors/runtime')
  await assertConnectorInstalled(source.sourceType)
  const credentials = Object.fromEntries(
    Object.entries(decryptCredentials(source.id, source.credentials)).map(([k, v]) => [k, v == null ? '' : String(v)])
  )
  const test = await testConnectorConnection(source.sourceType, credentials)
  if (!test.ok) throw new Error(test.message)

  const scan = await scanConnectorSchema(source.sourceType, credentials)
  await db
    .update(dataSources)
    .set({
      status: 'connected',
      lastConnected: new Date(),
      updatedAt: new Date(),
      config: { ...(source.config as Record<string, unknown>), schemaScan: scan },
    })
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))
  revalidatePath('/dashboard')
  return { tables: scan.tables.length }
}

export async function renameDataSource(rawId: string, rawName: string) {
  const userId = await requireUserId()
  const id = idSchema.parse(rawId)
  const name = z.string().trim().min(1, 'Name is required').max(120).parse(rawName)
  await db
    .update(dataSources)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))
  await audit(userId, 'UPDATE', id, { name })
  revalidatePath('/dashboard')
}

/** Switches a data source between source and destination (pipelines only write to destinations). */
export async function setDataSourceRole(rawId: string, rawRole: string) {
  const userId = await requireUserId()
  const id = idSchema.parse(rawId)
  const role = roleSchema.parse(rawRole)
  const [source] = await db
    .select({ config: dataSources.config })
    .from(dataSources)
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))
    .limit(1)
  if (!source) throw new Error('Data source not found')
  await db
    .update(dataSources)
    .set({ config: { ...(source.config as Record<string, unknown>), role }, updatedAt: new Date() })
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))
  await audit(userId, 'UPDATE', id, { role })
  revalidatePath('/dashboard')
}

export async function deleteDataSource(rawId: string) {
  const userId = await requireUserId()
  const id = idSchema.parse(rawId)
  const used = await db
    .select({ name: pipelines.name, sourceId: pipelines.sourceId, destinationId: pipelines.destinationId })
    .from(pipelines)
    .where(eq(pipelines.userId, userId))
  const dependents = used.filter((p) => p.sourceId === id || p.destinationId === id).map((p) => p.name)
  if (dependents.length) {
    throw new Error(`Used by pipeline${dependents.length > 1 ? 's' : ''} ${dependents.map((n) => `"${n}"`).join(', ')}. Change or delete ${dependents.length > 1 ? 'them' : 'it'} first.`)
  }
  await db.delete(dataSources).where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))
  await audit(userId, 'DELETE', id)
  revalidatePath('/dashboard')
}
