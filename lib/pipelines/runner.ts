import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLogs, dataSources, executionLogs, nexusDatasets, pipelineRunRejects, pipelines } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'
import { notify } from '@/lib/notifications'
import { definitionSchema, describeDefinitionError, scheduleSchema, type PipelineDefinition, type SourceStep } from './definition'
import { runEngine, type EngineIO, type EngineResult } from './engine'
import { NonRetryableError, readSourceRows, writeDataset, writeToDataSource, type StoredDataSource } from './io'
import { nextRunAt } from './schedule'

/** A run still marked "running" after this long is treated as dead (function timeout/crash). */
const STALE_RUN_MS = 10 * 60 * 1000
/** Retries stop once a run has used this much of the 300 s function budget. */
const RETRY_BUDGET_MS = 180_000

export interface PipelineState {
  watermark?: { column: string; value: string | null; sourceKey: string }
}

export function parseDefinition(config: unknown): PipelineDefinition {
  const parsed = definitionSchema.safeParse(config)
  if (!parsed.success) throw new Error(describeDefinitionError(parsed.error))
  return parsed.data
}

/** Identifies what the watermark belongs to; changing the source, table or column restarts the sync. */
function watermarkKey(step: SourceStep) {
  return `${step.dataSourceId}|${step.table}|${step.watermarkColumn}`
}

/** The stored watermark if it still matches the pipeline's source, else null (full read). */
export function currentWatermark(def: PipelineDefinition, state: unknown): string | null {
  const source = def.steps[0]
  if (source.type !== 'source' || source.mode !== 'incremental') return null
  const wm = (state as PipelineState | null)?.watermark
  return wm && wm.sourceKey === watermarkKey(source) ? wm.value : null
}

async function loadSource(userId: string, dataSourceId: string): Promise<StoredDataSource> {
  const [source] = await db
    .select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType, config: dataSources.config, credentials: dataSources.credentials })
    .from(dataSources)
    .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.userId, userId)))
    .limit(1)
  if (!source) throw new NonRetryableError('The data source used by this pipeline no longer exists.')
  return source
}

function buildIO(userId: string, pipelineId: string, opts: { write: boolean; maxRows?: number; watermarkAfter?: string | null }): EngineIO {
  return {
    async read(step) {
      const source = await loadSource(userId, step.dataSourceId)
      const watermark = step.mode === 'incremental' ? { column: step.watermarkColumn, after: opts.watermarkAfter ?? null } : undefined
      return readSourceRows(source, step.table, Math.min(step.maxRows, opts.maxRows ?? step.maxRows), { watermark })
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
    .values({ id: newId('ds'), userId, name, tableName, columns, pipelineId, rowCount, lastLoadedAt: now })
    .onConflictDoUpdate({
      target: nexusDatasets.tableName,
      set: { columns, pipelineId, rowCount, lastLoadedAt: now, updatedAt: now },
    })
}

/** Dry run on a small sample: reads real data, runs every step, writes nothing. */
export async function testRunDefinition(userId: string, config: unknown, sampleSize = 25, state?: unknown): Promise<EngineResult> {
  const def = parseDefinition(config)
  const io = buildIO(userId, 'test', { write: false, maxRows: Math.max(sampleSize, 200), watermarkAfter: currentWatermark(def, state) })
  return runEngine(def, io, { sampleSize })
}

export interface RunOutcome {
  runId: string
  status: EngineResult['status'] | 'skipped'
  message: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function summarize(result: EngineResult) {
  if (result.status === 'failed') return result.error ?? 'Run failed.'
  const filtered = Math.max(0, result.rowsRead - result.rowsWritten - result.rejectedCount)
  return (
    `${result.rowsWritten.toLocaleString()} of ${result.rowsRead.toLocaleString()} rows written` +
    (result.rejectedCount ? `, ${result.rejectedCount.toLocaleString()} rejected` : '') +
    (filtered ? `, ${filtered.toLocaleString()} filtered out` : '') +
    '.'
  )
}

/** Executes the published version of a pipeline, retrying transient failures, and records the run. */
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

  const runId = newId('run')
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

  let def: PipelineDefinition | null = null
  let result: EngineResult
  const attempts: { attempt: number; error?: string; at: string }[] = []
  try {
    def = parseDefinition(pipeline.config)
    const io = buildIO(userId, pipelineId, { write: true, watermarkAfter: currentWatermark(def, pipeline.state) })
    for (let attempt = 1; ; attempt++) {
      result = await runEngine(def, io)
      attempts.push({ attempt, error: result.error, at: new Date().toISOString() })
      const canRetry =
        result.status === 'failed' &&
        result.retryable !== false &&
        attempt <= def.settings.retries &&
        Date.now() - startTime.getTime() < RETRY_BUDGET_MS
      if (!canRetry) break
      await sleep(Math.min(60, def.settings.retryDelaySeconds * 2 ** (attempt - 1)) * 1000)
    }
  } catch (err) {
    result = {
      status: 'failed', steps: [], rejects: [], rejectedCount: 0, rowsRead: 0, rowsWritten: 0, columns: [],
      error: err instanceof Error ? err.message : String(err), retryable: false,
    }
    attempts.push({ attempt: 1, error: result.error, at: new Date().toISOString() })
  }

  const endTime = new Date()
  if (result.rejects.length) {
    await db.insert(pipelineRunRejects).values(
      result.rejects.map((r) => ({
        id: newId('rej'),
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
      executionDetails: { steps: result.steps, destination: result.destination, columns: result.columns, attempts, watermark: result.watermark },
      updatedAt: endTime,
    })
    .where(eq(executionLogs.id, runId))

  // Advance the incremental watermark only after rows were written successfully.
  let state = pipeline.state as PipelineState | null
  const source = def?.steps[0]
  if (result.status !== 'failed' && result.watermark?.value && source?.type === 'source' && source.mode === 'incremental') {
    state = { ...(state ?? {}), watermark: { column: result.watermark.column, value: result.watermark.value, sourceKey: watermarkKey(source) } }
  }

  const schedule = scheduleSchema.safeParse(pipeline.schedule ?? {})
  await db
    .update(pipelines)
    .set({
      lastRunAt: endTime,
      lastRunStatus: result.status,
      status: pipeline.status === 'draft' ? 'active' : pipeline.status,
      nextRunAt: pipeline.enabled && schedule.success ? nextRunAt(schedule.data) : null,
      state,
      updatedAt: endTime,
    })
    .where(eq(pipelines.id, pipelineId))

  await db.insert(auditLogs).values({
    id: newId('audit'),
    userId,
    action: 'RUN',
    resource: 'pipeline',
    resourceId: pipelineId,
    changes: { runId, trigger, status: result.status, attempts: attempts.length, rowsRead: result.rowsRead, rowsWritten: result.rowsWritten, rejected: result.rejectedCount },
  })

  const message = summarize(result)
  await alertIfNeeded({ def, pipelineName: pipeline.name, pipelineId, userId, runId, trigger, result, attempts: attempts.length, message })
  return { runId, status: result.status, message }
}

async function alertIfNeeded(opts: {
  def: PipelineDefinition | null
  pipelineName: string
  pipelineId: string
  userId: string
  runId: string
  trigger: string
  result: EngineResult
  attempts: number
  message: string
}) {
  const settings = opts.def?.settings
  const alertOn = settings?.alertOn ?? 'failure'
  const failed = opts.result.status === 'failed'
  const rejected = opts.result.status === 'partial'
  if (!failed && !(rejected && alertOn === 'failure_or_rejects')) return
  const title = failed ? `${opts.pipelineName} failed` : `${opts.pipelineName} rejected ${opts.result.rejectedCount} rows`
  const lines = [
    `Pipeline: ${opts.pipelineName}`,
    `Result: ${opts.message}`,
    `Trigger: ${opts.trigger}${opts.attempts > 1 ? ` · ${opts.attempts} attempts` : ''}`,
    `Time: ${new Date().toISOString()}`,
  ]
  try {
    await notify({
      userId: opts.userId,
      level: failed ? 'error' : 'warning',
      title,
      lines,
      pipelineId: opts.pipelineId,
      runId: opts.runId,
      email: alertOn === 'never' ? undefined : { to: settings?.alertEmails ?? [] },
    })
  } catch (err) {
    // Alerts must never turn a finished run into an error.
    console.error('[runner] alert failed:', err instanceof Error ? err.message : err)
  }
}
