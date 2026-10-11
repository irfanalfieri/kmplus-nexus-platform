import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pipelineVersions, pipelines } from '@/lib/db/schema'
import { newId, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { definitionSchema, newStepId } from './definition'
import { nextRunAt } from './schedule'

/**
 * Pipelines Nexus manages for the user, such as the copy job behind a cached
 * catalog table (DV-1/DV-2). They are ordinary published pipelines (visible
 * in Pipelines and Monitoring, run by the same worker), created and updated
 * here instead of through the editor.
 */

import { refreshSchedule, type CacheRefreshOption as CacheRefresh } from '@/lib/catalog/refresh'

/** Source table → dataset copy (replace), published as a new version of the managed pipeline. */
export async function upsertCachePipeline(
  ctx: WorkspaceContext,
  opts: { pipelineId?: string | null; name: string; dataSourceId: string; table: string; datasetName: string; refresh: CacheRefresh; maxRows: number; enabled: boolean }
): Promise<string> {
  const sourceId = newStepId()
  const destId = newStepId()
  const definition = definitionSchema.parse({
    schemaVersion: 2,
    nodes: [
      { id: sourceId, type: 'source', position: { x: 40, y: 120 }, dataSourceId: opts.dataSourceId, table: opts.table, maxRows: opts.maxRows, mode: 'full', watermarkColumn: '' },
      { id: destId, type: 'destination', position: { x: 420, y: 120 }, kind: 'dataset', datasetName: opts.datasetName, mode: 'replace', keys: [], softDeleteMissing: false },
    ],
    edges: [{ id: newStepId(), from: sourceId, to: destId, branch: '' }],
    settings: { retries: 2, alertOn: 'failure' },
  })
  const schedule = refreshSchedule(opts.refresh)
  const scheduled = opts.enabled && schedule.type !== 'manual'
  const now = new Date()

  let id = opts.pipelineId ?? null
  if (id) {
    const [existing] = await db.select({ id: pipelines.id }).from(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId))).limit(1)
    if (!existing) id = null
  }
  let version = 1
  if (id) {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${pipelineVersions.version}), 0)::int` }).from(pipelineVersions).where(eq(pipelineVersions.pipelineId, id))
    version = max + 1
    await db
      .update(pipelines)
      .set({ name: opts.name, config: definition, version, draftConfig: null, draftVersion: null, schedule, enabled: scheduled, nextRunAt: scheduled ? nextRunAt(schedule) : null, sourceId: opts.dataSourceId, status: 'active', updatedAt: now })
      .where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  } else {
    id = newId('pipe')
    await db.insert(pipelines).values({
      id,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      name: opts.name,
      description: 'Managed by the Data Catalog: keeps a cached copy of a source table. Change it from the catalog entry.',
      config: definition,
      schedule,
      enabled: scheduled,
      nextRunAt: scheduled ? nextRunAt(schedule) : null,
      version,
      status: 'active',
      sourceId: opts.dataSourceId,
      updatedAt: now,
    })
  }
  await db.insert(pipelineVersions).values({
    id: newId('pver'),
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    pipelineId: id,
    version,
    config: { definition, schedule, name: opts.name },
    changes: `Catalog cache: ${opts.refresh} refresh`,
    createdBy: ctx.userId,
    publishedAt: now,
    publishedBy: ctx.userId,
  })
  await recordAudit(ctx, { action: version === 1 ? 'CREATE' : 'UPDATE', resource: 'pipeline', resourceId: id, changes: { managedBy: 'catalog', version, refresh: opts.refresh } })
  return id
}

/** Pauses a managed pipeline (cached → live); the cached dataset stays until deleted. */
export async function pauseManagedPipeline(workspaceId: string, pipelineId: string) {
  await db.update(pipelines).set({ enabled: false, nextRunAt: null, updatedAt: new Date() }).where(and(eq(pipelines.id, pipelineId), eq(pipelines.workspaceId, workspaceId)))
}
