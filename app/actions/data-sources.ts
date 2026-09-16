'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { dataSources, auditLogs } from '@/lib/db/schema'
import { assertConnectorInstalled } from '@/app/actions/connectors'
import { isConnectorSlug } from '@/lib/connectors/catalog'
import { eq, and, desc } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export async function getDataSources() {
  const userId = await getUserId()
  return db
    .select()
    .from(dataSources)
    .where(eq(dataSources.userId, userId))
    .orderBy(desc(dataSources.createdAt))
}

export async function createDataSource(data: any) {
  const userId = await getUserId()
  const id = `src_${Date.now()}`

  if (isConnectorSlug(data.sourceType)) {
    await assertConnectorInstalled(data.sourceType)
  }

  const hasSchemaScan = Boolean((data.config as { schemaScan?: unknown })?.schemaScan)

  await db.insert(dataSources).values({
    id,
    userId,
    name: data.name,
    type: data.type,
    sourceType: data.sourceType,
    config: data.config || {},
    credentials: data.credentials || {},
    status: hasSchemaScan ? 'connected' : 'disconnected',
    lastConnected: hasSchemaScan ? new Date() : undefined,
  })

  await db.insert(auditLogs).values({
    id: `audit_${Date.now()}`,
    userId,
    action: 'CREATE',
    resource: 'data_source',
    resourceId: id,
  })

  revalidatePath('/dashboard')
  return id
}

export async function testConnection(id: string) {
  const userId = await getUserId()

  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))
    .limit(1)

  if (!source) throw new Error('Data source not found')

  if (isConnectorSlug(source.sourceType)) {
    const { testConnectorConnection, scanConnectorSchema } = await import('@/lib/connectors/runtime')
    await assertConnectorInstalled(source.sourceType)
    const credentials = Object.fromEntries(
      Object.entries((source.credentials ?? {}) as Record<string, unknown>).map(([k, v]) => [
        k,
        v == null ? '' : String(v),
      ])
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
  } else {
    await db
      .update(dataSources)
      .set({ status: 'connected', lastConnected: new Date(), updatedAt: new Date() })
      .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))
  }

  revalidatePath('/dashboard')
}

export async function updateDataSourceConfig(id: string, config: Record<string, unknown>) {
  const userId = await getUserId()

  await db
    .update(dataSources)
    .set({ config, updatedAt: new Date() })
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))

  revalidatePath('/dashboard')
}

export async function deleteDataSource(id: string) {
  const userId = await getUserId()

  await db
    .delete(dataSources)
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)))

  revalidatePath('/dashboard')
}
