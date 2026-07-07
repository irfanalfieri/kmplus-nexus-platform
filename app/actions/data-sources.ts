'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { dataSources, auditLogs } from '@/lib/db/schema'
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

  await db.insert(dataSources).values({
    id,
    userId,
    name: data.name,
    type: data.type,
    sourceType: data.sourceType,
    config: data.config || {},
    credentials: data.credentials || {},
    status: 'disconnected',
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
  
  await db
    .update(dataSources)
    .set({ status: 'connected', lastConnected: new Date(), updatedAt: new Date() })
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
