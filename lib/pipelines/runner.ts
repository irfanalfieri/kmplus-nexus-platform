import { randomUUID } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLogs, dataSources, executionLogs, nexusDatasets, pipelineRunRejects, pipelines } from '@/lib/db/schema'
import { definitionSchema, describeDefinitionError, scheduleSchema, type PipelineDefinition } from './definition'
import { runEngine, type EngineIO, type EngineResult } from './engine'
import { readSourceRows, writeDataset, writeToDataSource, type StoredDataSource } from './io'
import { nextRunAt } from './schedule'

/** A run still marked "running" after this long is treated as dead (function timeout/crash). */
const STALE_RUN_MS = 10 * 60 * 1000

export function parseDefinition(config: unknown): PipelineDefinition {
  const parsed = definitionSchema.safeParse(config)
  if (!parsed.success) throw new Error(describeDefinitionError(parsed.error))
  return parsed.data
}

async function loadSource(userId: string, dataSourceId: string): Promise<StoredDataSource> {
  const [source] = await db
    .select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType, config: dataSources.config, credentials: dataSources.credentials })
    .from(dataSources)
    .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.userId, userId)))
    .limit(1)
  if (!source) throw new Error('The data source used by this pipeline no longer exists.')
  return source
}

function buildIO(userId: string, pipelineId: string, opts: { write: boolean; maxRows?: number }): EngineIO {
  return {
    async read(step) {
      const source = await loadSource(userId, step.dataSourceId)
      return readSourceRows(source, step.table, Math.min(step.maxRows, opts.maxRows ?? step.maxRows))
    },
    write: opts.write
      ? async (step, rows, columns) => {
          if (step.kind === 'dataset') {
            const res = await writeDataset({ userId, datasetName: step.datasetName, mode: step.mode, keys: step.keys, columns, rows })
            await upsertDatasetRecord(userId, pipelineId, step.datasetName, res.tableName, columns, res.rowCount)
            return { written: res.written, target: `Dataset ${step.datasetName}`, rowCount: res.rowCount }
          }
          const source = await loadSource(userId, step.dataSourceId)
          const res = await writeToDataSource({ source, table: step.table, mode: step.mode, keys: step.keys, columns, rows })
          return { written: res.written, target: `${source.name} · ${step.table}` }
        }
      : undefined,
  }
}

async function upsertDatasetRecord(
  userId: string,
  pipelineId: string,
  name: string,
  tableName: string,
  columns: { name: string; type: string }[],
  rowCount: number
) {
  const now = new Date()
  await db
    .insert(nexusDatasets)
    .values({ id: `ds_${randomUUID()}`, userId, name, tableName, columns, pipelineId, rowCount, lastLoadedAt: now })
    .onConflictDoUpdate({
      target: nexusDatasets.tableName,
      set: { columns, pipelineId, rowCount, lastLoadedAt: now, updatedAt: now },
    })
}

/** Dry run on a small sample: reads real data, runs every step, writes nothing. */
export async function testRunDefinition(userId: string, config: unknown, sampleSize = 25): Promise<EngineResult> {
  const def = parseDefinition(config)
  return runEngine(def, buildIO(userId, 'test', { write: false, maxRows: Math.max(sampleSize, 200) }), { sampleSize })
}

export interface RunOutcome {
  runId: string
  status: EngineResult['status'] | 'skipped'
  message: string
}

/** Executes the published version of a pipeline and records the run. */
export async function executePipelineRun(pipelineId: string, userId: string, trigger: 'manual' | 'schedule'): Promise<RunOutcome> {
  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.userId, userId)))
    .limit(1)
  if (!pipeline) throw new Error('Pipeline not found')

  // No overlapping runs of the same pipeline.
  const [active] = await db
    .select({ id: executionLogs.id })
    .from(executionLogs)
    .where(
      and(
        eq(executionLogs.pipelineId, pipelineId),
        eq(executionLogs.status, 'running'),
        gt(executionLogs.startTime, new Date(Date.now() - STALE_RUN_MS))
      )
    )
    .limit(1)
  if (active) return { runId: active.id, status: 'skipped', message: 'This pipeline is already running.' }

  const runId = `run_${randomUUID()}`
  const startTime = new Date()
  await db.insert(executionLogs).values({
    id: runId,
    userId,
    pipelineId,
    status: 'running',
    trigger,
    pipelineVersion: pipeline.version ?? 1,
    startTime,
  })

  let result: EngineResult
  try {
    const def = parseDefinition(pipeline.config)
    result = await runEngine(def, buildIO(userId, pipelineId, { write: true }))
  } catch (err) {
    result = {
      status: 'failed', steps: [], rejects: [], rejectedCount: 0, rowsRead: 0, rowsWritten: 0, columns: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const endTime = new Date()
  if (result.rejects.length) {
    await db.insert(pipelineRunRejects).values(
      result.rejects.map((r) => ({
        id: `rej_${randomUUID()}`,
        runId,
        pipelineId,
        userId,
        row: JSON.parse(JSON.stringify(r.row)),
        errors: { stepId: r.stepId, messages: r.errors },
      }))
    )
  }

  await db
    .update(executionLogs)
    .set({
      status: result.status,
      recordsProcessed: result.rowsRead,
      recordsSuccess: result.rowsWritten,
      recordsError: result.rejectedCount,
      errorMessage: result.error ?? null,
      endTime,
      duration: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
      executionDetails: { steps: result.steps, destination: result.destination, columns: result.columns },
      updatedAt: endTime,
    })
    .where(eq(executionLogs.id, runId))

  const schedule = scheduleSchema.safeParse(pipeline.schedule ?? {})
  await db
    .update(pipelines)
    .set({
      lastRunAt: endTime,
      lastRunStatus: result.status,
      status: pipeline.status === 'draft' ? 'active' : pipeline.status,
      nextRunAt: pipeline.enabled && schedule.success ? nextRunAt(schedule.data) : null,
      updatedAt: endTime,
    })
    .where(eq(pipelines.id, pipelineId))

  await db.insert(auditLogs).values({
    id: `audit_${randomUUID()}`,
    userId,
    action: 'RUN',
    resource: 'pipeline',
    resourceId: pipelineId,
    changes: { runId, trigger, status: result.status, rowsRead: result.rowsRead, rowsWritten: result.rowsWritten, rejected: result.rejectedCount },
  })

  const filtered = Math.max(0, result.rowsRead - result.rowsWritten - result.rejectedCount)
  const message =
    result.status === 'failed'
      ? result.error ?? 'Run failed.'
      : `${result.rowsWritten.toLocaleString()} of ${result.rowsRead.toLocaleString()} rows written` +
        (result.rejectedCount ? `, ${result.rejectedCount.toLocaleString()} rejected` : '') +
        (filtered ? `, ${filtered.toLocaleString()} filtered out` : '') +
        '.'
  return { runId, status: result.status, message }
}
