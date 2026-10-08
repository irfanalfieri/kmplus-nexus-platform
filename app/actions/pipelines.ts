'use server'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  auditLogs,
  dataSources,
  executionLogs,
  nexusDatasets,
  pipelineRunRejects,
  pipelineVersions,
  pipelines,
} from '@/lib/db/schema'
import { scheduleSchema, type PipelineSchedule } from '@/lib/pipelines/definition'
import { assertValidSchedule, nextRunAt } from '@/lib/pipelines/schedule'
import { executePipelineRun, parseDefinition, testRunDefinition } from '@/lib/pipelines/runner'
import { readDatasetSample } from '@/lib/pipelines/io'
import type { SchemaScanResult } from '@/lib/connectors/types'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

async function audit(userId: string, action: string, resourceId: string, changes?: Record<string, unknown>) {
  await db.insert(auditLogs).values({ id: `audit_${randomUUID()}`, userId, action, resource: 'pipeline', resourceId, changes })
}

async function getOwned(userId: string, id: string) {
  const [row] = await db.select().from(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.userId, userId))).limit(1)
  if (!row) throw new Error('Pipeline not found')
  return row
}

function computeNextRun(enabled: boolean, schedule: PipelineSchedule) {
  return enabled ? nextRunAt(schedule) : null
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listPipelines() {
  const userId = await getUserId()
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
      updatedAt: pipelines.updatedAt,
    })
    .from(pipelines)
    .where(eq(pipelines.userId, userId))
    .orderBy(desc(pipelines.updatedAt))
}

/** Everything the builder needs to populate pickers (no credentials). */
export async function getBuilderOptions() {
  const userId = await getUserId()
  const [sources, datasets] = await Promise.all([
    db
      .select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType, status: dataSources.status, config: dataSources.config })
      .from(dataSources)
      .where(eq(dataSources.userId, userId))
      .orderBy(dataSources.name),
    db
      .select({ name: nexusDatasets.name, columns: nexusDatasets.columns, rowCount: nexusDatasets.rowCount, lastLoadedAt: nexusDatasets.lastLoadedAt })
      .from(nexusDatasets)
      .where(eq(nexusDatasets.userId, userId))
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

export async function listRuns(pipelineId: string, limit = 20) {
  const userId = await getUserId()
  await getOwned(userId, pipelineId)
  return db
    .select()
    .from(executionLogs)
    .where(and(eq(executionLogs.pipelineId, pipelineId), eq(executionLogs.userId, userId)))
    .orderBy(desc(executionLogs.createdAt))
    .limit(Math.min(limit, 100))
}

export async function getRunRejects(runId: string, limit = 100) {
  const userId = await getUserId()
  return db
    .select({ id: pipelineRunRejects.id, row: pipelineRunRejects.row, errors: pipelineRunRejects.errors })
    .from(pipelineRunRejects)
    .where(and(eq(pipelineRunRejects.runId, runId), eq(pipelineRunRejects.userId, userId)))
    .limit(Math.min(limit, 500))
}

export async function listVersions(pipelineId: string) {
  const userId = await getUserId()
  await getOwned(userId, pipelineId)
  return db
    .select({ version: pipelineVersions.version, changes: pipelineVersions.changes, createdAt: pipelineVersions.createdAt })
    .from(pipelineVersions)
    .where(and(eq(pipelineVersions.pipelineId, pipelineId), eq(pipelineVersions.userId, userId)))
    .orderBy(desc(pipelineVersions.version))
}

export async function getDatasetPreview(name: string) {
  const userId = await getUserId()
  const [dataset] = await db
    .select()
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.userId, userId), eq(nexusDatasets.name, name)))
    .limit(1)
  if (!dataset) throw new Error('Dataset not found')
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

export async function savePipeline(input: z.input<typeof saveInput>) {
  const userId = await getUserId()
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
    const existing = await getOwned(userId, id)
    version = (existing.version ?? 1) + 1
    await db.update(pipelines).set({ ...common, version }).where(and(eq(pipelines.id, id), eq(pipelines.userId, userId)))
  } else {
    id = `pipe_${randomUUID()}`
    await db.insert(pipelines).values({ id, userId, ...common, version, status: 'draft' })
  }

  await db.insert(pipelineVersions).values({
    id: `pver_${randomUUID()}`,
    userId,
    pipelineId: id,
    version,
    config: { definition, schedule: data.schedule, name: data.name, description: data.description },
    changes: data.changeNote || (version === 1 ? 'Created' : 'Updated'),
    createdBy: userId,
  })
  await audit(userId, version === 1 ? 'CREATE' : 'UPDATE', id, { version })
  revalidatePath('/dashboard')
  return { id, version }
}

export async function setPipelineEnabled(id: string, enabled: boolean) {
  const userId = await getUserId()
  const existing = await getOwned(userId, id)
  const schedule = scheduleSchema.parse(existing.schedule ?? {})
  await db
    .update(pipelines)
    .set({ enabled, nextRunAt: computeNextRun(enabled, schedule), updatedAt: new Date() })
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, userId)))
  await audit(userId, enabled ? 'ENABLE' : 'DISABLE', id)
  revalidatePath('/dashboard')
}

export async function deletePipeline(id: string) {
  const userId = await getUserId()
  await getOwned(userId, id)
  const runIds = (await db.select({ id: executionLogs.id }).from(executionLogs).where(eq(executionLogs.pipelineId, id))).map((r) => r.id)
  if (runIds.length) await db.delete(pipelineRunRejects).where(inArray(pipelineRunRejects.runId, runIds))
  await db.delete(executionLogs).where(and(eq(executionLogs.pipelineId, id), eq(executionLogs.userId, userId)))
  await db.delete(pipelineVersions).where(and(eq(pipelineVersions.pipelineId, id), eq(pipelineVersions.userId, userId)))
  await db.delete(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.userId, userId)))
  // Datasets produced by the pipeline are kept; they may be used elsewhere.
  await audit(userId, 'DELETE', id)
  revalidatePath('/dashboard')
}

export async function restoreVersion(id: string, version: number) {
  const userId = await getUserId()
  const existing = await getOwned(userId, id)
  const [snapshot] = await db
    .select()
    .from(pipelineVersions)
    .where(and(eq(pipelineVersions.pipelineId, id), eq(pipelineVersions.userId, userId), eq(pipelineVersions.version, version)))
    .limit(1)
  if (!snapshot) throw new Error(`Version ${version} not found`)
  const cfg = snapshot.config as { definition: unknown; schedule: unknown; name: string; description: string }
  return savePipeline({
    id,
    name: cfg.name ?? existing.name,
    description: cfg.description ?? '',
    definition: cfg.definition,
    schedule: scheduleSchema.parse(cfg.schedule ?? {}),
    enabled: existing.enabled ?? false,
    changeNote: `Restored v${version}`,
  })
}

export async function runPipelineNow(id: string) {
  const userId = await getUserId()
  const outcome = await executePipelineRun(id, userId, 'manual')
  revalidatePath('/dashboard')
  return outcome
}

/** Test run of an unsaved definition: real source data, nothing written. */
export async function testPipeline(definition: unknown) {
  const userId = await getUserId()
  try {
    return { ok: true as const, result: await testRunDefinition(userId, definition, 25) }
  } catch (err) {
    return { ok: false as const, message: err instanceof Error ? err.message : 'Test run failed' }
  }
}
