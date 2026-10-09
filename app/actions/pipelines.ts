'use server'

import { z } from 'zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit, type AuditAction } from '@/lib/audit'
import { db } from '@/lib/db'
import { dataSources, executionLogs, nexusDatasets, pipelineRunRejects, pipelineVersions, pipelines } from '@/lib/db/schema'
import { definitionSchema, scheduleSchema, type PipelineSchedule } from '@/lib/pipelines/definition'
import { assertValidSchedule, nextRunAt } from '@/lib/pipelines/schedule'
import { currentWatermark, parseDefinition, testRunDefinition } from '@/lib/pipelines/runner'
import { enqueueRun } from '@/lib/pipelines/jobs'
import { nudgeWorker, startWorker } from '@/lib/pipelines/worker'
import { readDatasetSample } from '@/lib/pipelines/io'
import type { SchemaScanResult } from '@/lib/connectors/types'

const idSchema = z.string().trim().min(1).max(100)

async function audit(ctx: WorkspaceContext, action: AuditAction, resourceId: string, changes?: Record<string, unknown>, resource = 'pipeline') {
  await recordAudit(ctx, { action, resource, resourceId, changes })
}

async function getOwned(ctx: WorkspaceContext, id: string) {
  const [row] = await db.select().from(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId))).limit(1)
  if (!row) throw new Error('Pipeline not found')
  return row
}

function computeNextRun(enabled: boolean, schedule: PipelineSchedule) {
  return enabled ? nextRunAt(schedule) : null
}

const scope = (ctx: WorkspaceContext) => ({ workspaceId: ctx.workspaceId, actorId: ctx.userId })

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listPipelines() {
  const ctx = await requireWorkspace()
  return db
    .select({
      id: pipelines.id,
      name: pipelines.name,
      description: pipelines.description,
      status: pipelines.status,
      enabled: pipelines.enabled,
      version: pipelines.version,
      config: pipelines.config,
      schedule: pipelines.schedule,
      lastRunAt: pipelines.lastRunAt,
      lastRunStatus: pipelines.lastRunStatus,
      nextRunAt: pipelines.nextRunAt,
      state: pipelines.state,
      updatedAt: pipelines.updatedAt,
    })
    .from(pipelines)
    .where(eq(pipelines.workspaceId, ctx.workspaceId))
    .orderBy(desc(pipelines.updatedAt))
    .then((rows) =>
      rows.map(({ state, ...row }) => {
        const def = definitionSchema.safeParse(row.config)
        return { ...row, syncPosition: def.success ? currentWatermark(def.data, state) : null }
      })
    )
}

/** Everything the builder needs to populate pickers (no credentials). */
export async function getBuilderOptions() {
  const ctx = await requireWorkspace()
  const [sources, datasets] = await Promise.all([
    db
      .select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType, status: dataSources.status, config: dataSources.config })
      .from(dataSources)
      .where(eq(dataSources.workspaceId, ctx.workspaceId))
      .orderBy(dataSources.name),
    db
      .select({ name: nexusDatasets.name, columns: nexusDatasets.columns, rowCount: nexusDatasets.rowCount, lastLoadedAt: nexusDatasets.lastLoadedAt })
      .from(nexusDatasets)
      .where(eq(nexusDatasets.workspaceId, ctx.workspaceId))
      .orderBy(nexusDatasets.name),
  ])
  return {
    dataSources: sources.map((s) => {
      const config = (s.config ?? {}) as { role?: 'source' | 'destination'; schemaScan?: SchemaScanResult }
      return {
        id: s.id,
        name: s.name,
        sourceType: s.sourceType,
        status: s.status,
        role: config.role ?? 'source',
        tables: (config.schemaScan?.tables ?? []).map((t) => ({
          name: t.name,
          columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
        })),
      }
    }),
    datasets: datasets.map((d) => ({ ...d, columns: d.columns as { name: string; type: string }[] })),
  }
}

export async function listRuns(rawPipelineId: string, limit = 20) {
  const ctx = await requireWorkspace()
  const pipelineId = idSchema.parse(rawPipelineId)
  await getOwned(ctx, pipelineId)
  return db
    .select()
    .from(executionLogs)
    .where(and(eq(executionLogs.pipelineId, pipelineId), eq(executionLogs.workspaceId, ctx.workspaceId)))
    .orderBy(desc(executionLogs.createdAt))
    .limit(Math.min(limit, 100))
}

/** Rejected rows contain source data, so they need data:preview. */
export async function getRunRejects(rawRunId: string, limit = 100) {
  const ctx = await requireWorkspace('data:preview')
  const runId = idSchema.parse(rawRunId)
  return db
    .select({ id: pipelineRunRejects.id, row: pipelineRunRejects.row, errors: pipelineRunRejects.errors })
    .from(pipelineRunRejects)
    .where(and(eq(pipelineRunRejects.runId, runId), eq(pipelineRunRejects.workspaceId, ctx.workspaceId)))
    .limit(Math.min(limit, 500))
    .then(async (rows) => {
      await audit(ctx, 'VIEW_DATA', runId, { what: 'rejected_rows', rows: rows.length }, 'run')
      return rows
    })
}

export async function listVersions(rawPipelineId: string) {
  const ctx = await requireWorkspace()
  const pipelineId = idSchema.parse(rawPipelineId)
  await getOwned(ctx, pipelineId)
  return db
    .select({ version: pipelineVersions.version, changes: pipelineVersions.changes, createdAt: pipelineVersions.createdAt })
    .from(pipelineVersions)
    .where(and(eq(pipelineVersions.pipelineId, pipelineId), eq(pipelineVersions.workspaceId, ctx.workspaceId)))
    .orderBy(desc(pipelineVersions.version))
}

export async function getDatasetPreview(rawName: string) {
  const ctx = await requireWorkspace('data:preview')
  const name = z.string().trim().min(1).max(64).parse(rawName)
  const [dataset] = await db
    .select()
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, name)))
    .limit(1)
  if (!dataset) throw new Error('Dataset not found')
  await audit(ctx, 'VIEW_DATA', dataset.id, { what: 'dataset_preview', dataset: dataset.name }, 'dataset')
  return { name: dataset.name, rowCount: dataset.rowCount, lastLoadedAt: dataset.lastLoadedAt, rows: await readDatasetSample(dataset.tableName, 50) }
}

// ── Mutations ────────────────────────────────────────────────────────────────

const saveInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).default(''),
  definition: z.unknown(),
  schedule: scheduleSchema,
  enabled: z.boolean().default(false),
  changeNote: z.string().trim().max(200).optional(),
})

async function savePipelineAs(ctx: WorkspaceContext, input: z.input<typeof saveInput>) {
  const data = saveInput.parse(input)
  const definition = parseDefinition(data.definition)
  assertValidSchedule(data.schedule)
  const source = definition.steps[0]
  const dest = definition.steps[definition.steps.length - 1]
  const now = new Date()
  const common = {
    name: data.name,
    description: data.description,
    config: definition,
    schedule: data.schedule,
    enabled: data.enabled,
    sourceId: source.type === 'source' ? source.dataSourceId : null,
    destinationId: dest.type === 'destination' && dest.kind === 'datasource' ? dest.dataSourceId : null,
    nextRunAt: computeNextRun(data.enabled, data.schedule),
    updatedAt: now,
  }

  let id = data.id
  let version = 1
  if (id) {
    const existing = await getOwned(ctx, id)
    version = (existing.version ?? 1) + 1
    await db.update(pipelines).set({ ...common, version }).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  } else {
    id = newId('pipe')
    await db.insert(pipelines).values({ id, userId: ctx.userId, workspaceId: ctx.workspaceId, ...common, version, status: 'draft' })
  }

  await db.insert(pipelineVersions).values({
    id: newId('pver'),
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    pipelineId: id,
    version,
    config: { definition, schedule: data.schedule, name: data.name, description: data.description },
    changes: data.changeNote || (version === 1 ? 'Created' : 'Updated'),
    createdBy: ctx.userId,
  })
  await audit(ctx, version === 1 ? 'CREATE' : 'UPDATE', id, { version })
  revalidatePath('/dashboard')
  return { id, version }
}

export async function savePipeline(input: z.input<typeof saveInput>) {
  return savePipelineAs(await requireWorkspace('pipelines:edit'), input)
}

export async function setPipelineEnabled(rawId: string, rawEnabled: boolean) {
  const ctx = await requireWorkspace('pipelines:run')
  const id = idSchema.parse(rawId)
  const enabled = z.boolean().parse(rawEnabled)
  const existing = await getOwned(ctx, id)
  const schedule = scheduleSchema.parse(existing.schedule ?? {})
  await db
    .update(pipelines)
    .set({ enabled, nextRunAt: computeNextRun(enabled, schedule), updatedAt: new Date() })
    .where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  await audit(ctx, enabled ? 'ENABLE' : 'DISABLE', id)
  revalidatePath('/dashboard')
}

export async function deletePipeline(rawId: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = idSchema.parse(rawId)
  await getOwned(ctx, id)
  const runIds = (await db.select({ id: executionLogs.id }).from(executionLogs).where(and(eq(executionLogs.pipelineId, id), eq(executionLogs.workspaceId, ctx.workspaceId)))).map((r) => r.id)
  if (runIds.length) await db.delete(pipelineRunRejects).where(and(inArray(pipelineRunRejects.runId, runIds), eq(pipelineRunRejects.workspaceId, ctx.workspaceId)))
  await db.delete(executionLogs).where(and(eq(executionLogs.pipelineId, id), eq(executionLogs.workspaceId, ctx.workspaceId)))
  await db.delete(pipelineVersions).where(and(eq(pipelineVersions.pipelineId, id), eq(pipelineVersions.workspaceId, ctx.workspaceId)))
  await db.delete(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  // Datasets produced by the pipeline are kept; they may be used elsewhere.
  await audit(ctx, 'DELETE', id)
  revalidatePath('/dashboard')
}

export async function restoreVersion(rawId: string, rawVersion: number) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = idSchema.parse(rawId)
  const version = z.number().int().min(1).parse(rawVersion)
  const existing = await getOwned(ctx, id)
  const [snapshot] = await db
    .select()
    .from(pipelineVersions)
    .where(and(eq(pipelineVersions.pipelineId, id), eq(pipelineVersions.workspaceId, ctx.workspaceId), eq(pipelineVersions.version, version)))
    .limit(1)
  if (!snapshot) throw new Error(`Version ${version} not found`)
  const cfg = snapshot.config as { definition: unknown; schedule: unknown; name: string; description: string }
  return savePipelineAs(ctx, {
    id,
    name: cfg.name ?? existing.name,
    description: cfg.description ?? '',
    definition: cfg.definition,
    schedule: scheduleSchema.parse(cfg.schedule ?? {}),
    enabled: existing.enabled ?? false,
    changeNote: `Restored v${version}`,
  })
}

/** Queues a run and starts a background worker for it; returns immediately. */
export async function runPipelineNow(rawId: string) {
  const ctx = await requireWorkspace('pipelines:run')
  const id = idSchema.parse(rawId)
  const outcome = await enqueueRun(id, scope(ctx), 'manual')
  if (outcome.status === 'queued') startWorker()
  revalidatePath('/dashboard')
  return outcome
}

/**
 * Status of a run for live progress. Also restarts the worker when a job is
 * waiting (paused between invocations, or due for a retry), so runs progress
 * even where no scheduler runs (development and preview).
 */
export async function getRunStatus(rawRunId: string) {
  const ctx = await requireWorkspace()
  const runId = idSchema.parse(rawRunId)
  const [run] = await db
    .select({ id: executionLogs.id, pipelineId: executionLogs.pipelineId, status: executionLogs.status, recordsProcessed: executionLogs.recordsProcessed, recordsSuccess: executionLogs.recordsSuccess, recordsError: executionLogs.recordsError, errorMessage: executionLogs.errorMessage, duration: executionLogs.duration })
    .from(executionLogs)
    .where(and(eq(executionLogs.id, runId), eq(executionLogs.workspaceId, ctx.workspaceId)))
    .limit(1)
  if (!run) throw new Error('Run not found')
  const active = run.status === 'queued' || run.status === 'running'
  if (active) await nudgeWorker(ctx.workspaceId)
  return { ...run, active }
}

/** Test run of an unsaved definition: real source data, nothing written. Uses the saved sync position when editing. */
export async function testPipeline(definition: unknown, rawPipelineId?: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  try {
    let state: unknown = null
    if (rawPipelineId) state = (await getOwned(ctx, idSchema.parse(rawPipelineId))).state
    const result = await testRunDefinition(scope(ctx), definition, 25, state)
    await audit(ctx, 'TEST_RUN', rawPipelineId ?? 'unsaved', { rowsRead: result.rowsRead })
    // Plain JSON only (rows may hold Buffers/BigInts from drivers).
    return { ok: true as const, result: JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as typeof result }
  } catch (err) {
    return { ok: false as const, message: err instanceof Error ? err.message : 'Test run failed' }
  }
}

/** Forget the incremental sync position so the next run reads everything again. */
export async function resetSyncPosition(rawId: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = idSchema.parse(rawId)
  const existing = await getOwned(ctx, id)
  const state = { ...((existing.state as Record<string, unknown> | null) ?? {}) }
  delete state.watermark
  await db.update(pipelines).set({ state, updatedAt: new Date() }).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'RESET_SYNC', id)
  revalidatePath('/dashboard')
}
