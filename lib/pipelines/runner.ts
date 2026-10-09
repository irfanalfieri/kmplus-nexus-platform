import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dataSources, nexusDatasets, workspaceMembers } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'
import { notify } from '@/lib/notifications'
import { definitionSchema, describeDefinitionError, type PipelineDefinition, type SourceStep } from './definition'
import { runEngine, type EngineIO, type EngineResult } from './engine'
import { NonRetryableError, datasetTableName, readSourceRows, type StoredDataSource } from './io'

/** Who a run belongs to: the workspace, and the user who triggered or owns it. */
export interface RunScope {
  workspaceId: string
  actorId: string
}

export interface PipelineState {
  watermark?: { column: string; value: string | null; sourceKey: string }
}

export function parseDefinition(config: unknown): PipelineDefinition {
  const parsed = definitionSchema.safeParse(config)
  if (!parsed.success) throw new Error(describeDefinitionError(parsed.error))
  return parsed.data
}

/** Identifies what the watermark belongs to; changing the source, table or column restarts the sync. */
export function watermarkKey(step: SourceStep) {
  return `${step.dataSourceId}|${step.table}|${step.watermarkColumn}`
}

/** The stored watermark if it still matches the pipeline's source, else null (full read). */
export function currentWatermark(def: PipelineDefinition, state: unknown): string | null {
  const source = def.steps[0]
  if (source.type !== 'source' || source.mode !== 'incremental') return null
  const wm = (state as PipelineState | null)?.watermark
  return wm && wm.sourceKey === watermarkKey(source) ? wm.value : null
}

export async function loadSource(workspaceId: string, dataSourceId: string): Promise<StoredDataSource> {
  const [source] = await db
    .select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType, config: dataSources.config, credentials: dataSources.credentials })
    .from(dataSources)
    .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.workspaceId, workspaceId)))
    .limit(1)
  if (!source) throw new NonRetryableError('The data source used by this pipeline no longer exists.')
  return source
}

/** Physical table of a workspace dataset: the existing one, else the derived name. */
export async function datasetTable(workspaceId: string, datasetName: string) {
  const [existing] = await db
    .select({ tableName: nexusDatasets.tableName })
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, workspaceId), eq(nexusDatasets.name, datasetName)))
    .limit(1)
  return existing?.tableName ?? datasetTableName(workspaceId, datasetName)
}

export async function upsertDatasetRecord(
  scope: RunScope,
  pipelineId: string,
  name: string,
  tableName: string,
  columns: { name: string; type: string }[],
  rowCount: number
) {
  const now = new Date()
  await db
    .insert(nexusDatasets)
    .values({ id: newId('ds'), userId: scope.actorId, workspaceId: scope.workspaceId, name, tableName, columns, pipelineId, rowCount, lastLoadedAt: now })
    .onConflictDoUpdate({
      target: nexusDatasets.tableName,
      set: { columns, pipelineId, rowCount, lastLoadedAt: now, updatedAt: now },
    })
}

/** Dry run on a small sample: reads real data, runs every step, writes nothing. */
export async function testRunDefinition(scope: RunScope, config: unknown, sampleSize = 25, state?: unknown): Promise<EngineResult> {
  const def = parseDefinition(config)
  const watermarkAfter = currentWatermark(def, state)
  const io: EngineIO = {
    async read(step) {
      const source = await loadSource(scope.workspaceId, step.dataSourceId)
      const watermark = step.mode === 'incremental' ? { column: step.watermarkColumn, after: watermarkAfter } : undefined
      return readSourceRows(source, step.table, Math.min(step.maxRows, Math.max(sampleSize, 200)), { watermark })
    },
  }
  return runEngine(def, io, { sampleSize })
}

export function summarize(result: EngineResult) {
  if (result.status === 'failed') return result.error ?? 'Run failed.'
  const filtered = Math.max(0, result.rowsRead - result.rowsWritten - result.rejectedCount)
  return (
    `${result.rowsWritten.toLocaleString()} of ${result.rowsRead.toLocaleString()} rows written` +
    (result.rejectedCount ? `, ${result.rejectedCount.toLocaleString()} rejected` : '') +
    (filtered ? `, ${filtered.toLocaleString()} filtered out` : '') +
    '.'
  )
}

/** Alerts for a finished run: bell for admins/stewards/operators and the actor, email once. */
export async function alertIfNeeded(opts: {
  def: PipelineDefinition | null
  pipelineName: string
  pipelineId: string
  scope: RunScope
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
    // Everyone who can act on a failure gets it in their bell; email is sent once (configured list or owner).
    const recipients = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, opts.scope.workspaceId), inArray(workspaceMembers.role, ['admin', 'steward', 'operator'])))
    const ids = Array.from(new Set([...recipients.map((r) => r.userId), opts.scope.actorId]))
    for (const [i, userId] of ids.entries()) {
      await notify({
        userId,
        workspaceId: opts.scope.workspaceId,
        level: failed ? 'error' : 'warning',
        title,
        lines,
        pipelineId: opts.pipelineId,
        runId: opts.runId,
        email: alertOn === 'never' || i > 0 ? undefined : { to: settings?.alertEmails ?? [] },
      })
    }
  } catch (err) {
    // Alerts must never turn a finished run into an error.
    console.error('[runner] alert failed:', err instanceof Error ? err.message : err)
  }
}
