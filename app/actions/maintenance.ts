'use server'

import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { maintenanceWindows, pipelines } from '@/lib/db/schema'
import { newId, requireWorkspace } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { diffObjects } from '@/lib/audit-diff'
import { guard } from '@/lib/server-action'
import { maintenanceWindowSchema } from '@/lib/pipelines/maintenance'
import { loadMaintenanceWindows } from '@/lib/pipelines/maintenance-store'

/**
 * Maintenance windows and blackout dates (SC-4): people who run and schedule
 * pipelines (operators and up) hold automatic runs during them.
 */

const idSchema = z.string().trim().min(1).max(100)

async function listMaintenanceWindowsImpl() {
  const ctx = await requireWorkspace()
  const windows = await loadMaintenanceWindows(ctx.workspaceId)
  const names = await db.select({ id: pipelines.id, name: pipelines.name }).from(pipelines).where(eq(pipelines.workspaceId, ctx.workspaceId)).orderBy(pipelines.name)
  return { windows, pipelines: names }
}

const saveInput = z.object({ id: idSchema.optional(), window: maintenanceWindowSchema })

async function saveMaintenanceWindowImpl(input: z.input<typeof saveInput>) {
  const ctx = await requireWorkspace('pipelines:run')
  const data = saveInput.parse(input)
  const known = new Set((await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.workspaceId, ctx.workspaceId))).map((p) => p.id))
  const spec = { ...data.window, pipelineIds: data.window.pipelineIds.filter((id) => known.has(id)) }
  if (data.id) {
    const [before] = await db.select().from(maintenanceWindows).where(and(eq(maintenanceWindows.id, data.id), eq(maintenanceWindows.workspaceId, ctx.workspaceId))).limit(1)
    if (!before) throw new Error('Maintenance window not found')
    await db.update(maintenanceWindows).set({ spec, updatedAt: new Date() }).where(eq(maintenanceWindows.id, data.id))
    await recordAudit(ctx, { action: 'UPDATE', resource: 'maintenance_window', resourceId: data.id, changes: { name: spec.name }, diff: diffObjects(before.spec as Record<string, unknown>, spec) })
    revalidatePath('/dashboard', 'layout')
    return { id: data.id }
  }
  const id = newId('mw')
  await db.insert(maintenanceWindows).values({ id, workspaceId: ctx.workspaceId, spec, createdBy: ctx.userId })
  await recordAudit(ctx, { action: 'CREATE', resource: 'maintenance_window', resourceId: id, changes: spec })
  revalidatePath('/dashboard', 'layout')
  return { id }
}

async function deleteMaintenanceWindowImpl(rawId: string) {
  const ctx = await requireWorkspace('pipelines:run')
  const id = idSchema.parse(rawId)
  const deleted = await db.delete(maintenanceWindows).where(and(eq(maintenanceWindows.id, id), eq(maintenanceWindows.workspaceId, ctx.workspaceId))).returning({ spec: maintenanceWindows.spec })
  if (!deleted.length) throw new Error('Maintenance window not found')
  await recordAudit(ctx, { action: 'DELETE', resource: 'maintenance_window', resourceId: id, changes: { name: (deleted[0].spec as { name?: string }).name } })
  revalidatePath('/dashboard', 'layout')
}

export async function listMaintenanceWindows(...args: Parameters<typeof listMaintenanceWindowsImpl>) {
  return guard(() => listMaintenanceWindowsImpl(...args))
}
export async function saveMaintenanceWindow(...args: Parameters<typeof saveMaintenanceWindowImpl>) {
  return guard(() => saveMaintenanceWindowImpl(...args))
}
export async function deleteMaintenanceWindow(...args: Parameters<typeof deleteMaintenanceWindowImpl>) {
  return guard(() => deleteMaintenanceWindowImpl(...args))
}
