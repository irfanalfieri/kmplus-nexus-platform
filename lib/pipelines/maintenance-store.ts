import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { maintenanceWindows, pipelines } from '@/lib/db/schema'
import { scheduleSchema } from './definition'
import { nextRunAt } from './schedule'
import { holdRun, maintenanceWindowSchema, type MaintenanceWindow } from './maintenance'

/** A workspace's maintenance windows (SC-4), invalid rows left out. Server only. */
export async function loadMaintenanceWindows(workspaceId: string): Promise<MaintenanceWindow[]> {
  const rows = await db.select().from(maintenanceWindows).where(eq(maintenanceWindows.workspaceId, workspaceId)).orderBy(asc(maintenanceWindows.createdAt))
  return rows.flatMap((r) => {
    const parsed = maintenanceWindowSchema.safeParse(r.spec)
    return parsed.success ? [{ ...parsed.data, id: r.id }] : []
  })
}

/**
 * The scheduler's check for a due pipeline: when a window holds it, move its
 * nextRunAt to the end of the window (defer) or the first scheduled time after
 * it (skip) and return what happened; null when the run may go ahead.
 */
export async function holdDuePipeline(
  p: { id: string; workspaceId: string; schedule: unknown; nextRunAt: Date | null },
  now: Date,
  cache: Map<string, MaintenanceWindow[]>
): Promise<string | null> {
  if (!cache.has(p.workspaceId)) cache.set(p.workspaceId, await loadMaintenanceWindows(p.workspaceId))
  const held = holdRun(cache.get(p.workspaceId)!, p.id, now)
  if (!held.hold) return null
  const schedule = scheduleSchema.safeParse(p.schedule ?? {})
  const later = held.action === 'defer' ? held.until : schedule.success ? nextRunAt(schedule.data, held.until) : null
  const guard = p.nextRunAt ? eq(pipelines.nextRunAt, p.nextRunAt) : undefined
  await db.update(pipelines).set({ nextRunAt: later }).where(and(eq(pipelines.id, p.id), guard))
  return `held by "${held.window}" until ${later?.toISOString() ?? 'its next run'}`
}
