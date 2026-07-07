'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { pipelines, pipelineSteps, executionLogs, pipelineVersions, auditLogs } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export async function getPipelines() {
  const userId = await getUserId()
  return db
    .select()
    .from(pipelines)
    .where(eq(pipelines.userId, userId))
    .orderBy(desc(pipelines.createdAt))
}

export async function createPipeline(data: any) {
  const userId = await getUserId()
  const id = `pipe_${Date.now()}`
  
  await db.insert(pipelines).values({
    id,
    userId,
    name: data.name,
    description: data.description,
    sourceId: data.sourceId,
    destinationId: data.destinationId,
    config: data.config || {},
    status: 'draft',
  })

  await db.insert(auditLogs).values({
    id: `audit_${Date.now()}`,
    userId,
    action: 'CREATE',
    resource: 'pipeline',
    resourceId: id,
    changes: { created: true },
  })

  revalidatePath('/dashboard')
  return id
}

export async function updatePipeline(id: string, data: any) {
  const userId = await getUserId()

  await db
    .update(pipelines)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, userId)))

  await db.insert(auditLogs).values({
    id: `audit_${Date.now()}`,
    userId,
    action: 'UPDATE',
    resource: 'pipeline',
    resourceId: id,
    changes: data,
  })

  revalidatePath('/dashboard')
}

export async function deletePipeline(id: string) {
  const userId = await getUserId()

  await db
    .delete(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, userId)))

  await db.insert(auditLogs).values({
    id: `audit_${Date.now()}`,
    userId,
    action: 'DELETE',
    resource: 'pipeline',
    resourceId: id,
  })

  revalidatePath('/dashboard')
}

export async function executePipeline(id: string) {
  const userId = await getUserId()
  const pipeline = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, userId)))
    .then((r) => r[0])

  if (!pipeline) throw new Error('Pipeline not found')

  const executionId = `exec_${Date.now()}`
  const startTime = new Date()

  await db.insert(executionLogs).values({
    id: executionId,
    userId,
    pipelineId: id,
    status: 'running',
    startTime,
    executionDetails: { started: true },
  })

  // Simulate execution
  setTimeout(async () => {
    await db
      .update(executionLogs)
      .set({
        status: 'success',
        recordsProcessed: Math.floor(Math.random() * 10000) + 1000,
        recordsSuccess: Math.floor(Math.random() * 9000) + 1000,
        recordsError: Math.floor(Math.random() * 100),
        endTime: new Date(),
        duration: Math.floor(Math.random() * 300) + 30,
        updatedAt: new Date(),
      })
      .where(eq(executionLogs.id, executionId))
  }, 2000)

  revalidatePath('/dashboard')
  return executionId
}

export async function getPipelineHistory(pipelineId: string) {
  const userId = await getUserId()
  return db
    .select()
    .from(executionLogs)
    .where(and(eq(executionLogs.pipelineId, pipelineId), eq(executionLogs.userId, userId)))
    .orderBy(desc(executionLogs.createdAt))
    .limit(10)
}
