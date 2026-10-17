import { and, eq, inArray } from 'drizzle-orm'
import { deliverAlert, loadPipelineAlerts, pipelineLink } from '@/lib/alerts/send'
import { errorRate, errorRateBreached, type AlertKind } from '@/lib/alerts/rules'
import { rootCause } from '@/lib/monitoring/root-cause'
import { hints as hintsEn } from '@/lib/i18n/messages/en/hints'
import { withResolvedSecrets } from '@/lib/secrets/resolve'
import { db } from '@/lib/db'
import { dataSources, nexusDatasets, workspaceMembers } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'
import { notify } from '@/lib/notifications'
import { definitionSchema, describeDefinitionError, type PipelineDefinition, type SourceStep } from './definition'
import { runEngine, type EngineIO, type EngineResult } from './engine'
import { NonRetryableError, datasetTableName, readRowsByKeys, readSourceRows, type StoredDataSource } from './io'
import { loadRunContext } from './context'
import { lanePlan } from './lanes'
import { apiRuntime } from './api-runtime'

/** Who a run belongs to: the workspace, and the user who triggered or owns it. */
export interface RunScope {
  workspaceId: string
  actorId: string
}

export interface PipelineState {
  /** The driver's position (kept for pipelines saved before several sources). */
  watermark?: { column: string; value: string | null; sourceKey: string }
  /** Every incremental Source's position, by step id. */
  watermarks?: Record<string, { column: string; value: string | null; sourceKey: string }>
}

/** Rows a sample test reads from a staged lane when the source can't filter by key. */
export const STAGED_SAMPLE_ROWS = 5000

export function parseDefinition(config: unknown): PipelineDefinition {
  const parsed = definitionSchema.safeParse(config)
  if (!parsed.success) throw new Error(describeDefinitionError(parsed.error))
  return parsed.data
}

/** Identifies what the watermark belongs to; changing the source, table or column restarts the sync. */
export function watermarkKey(step: SourceStep) {
  return `${step.dataSourceId}|${step.table}|${step.watermarkColumn}`
}

/** Stored positions of every incremental Source that still match it (source, table, column); null = read from the start. */
export function currentWatermarks(def: PipelineDefinition, state: unknown): Record<string, string | null> {
  const st = (state as PipelineState | null) ?? {}
  const driver = lanePlan(def).driver
  const out: Record<string, string | null> = {}
  for (const n of def.nodes) {
    if (n.type !== 'source' || n.mode !== 'incremental') continue
    const wm = st.watermarks?.[n.id] ?? (n.id === driver ? st.watermark : undefined)
    out[n.id] = wm && wm.sourceKey === watermarkKey(n) ? wm.value : null
  }
  return out
}

/** The driver's stored watermark if it still matches its source, else null (full read). */
export function currentWatermark(def: PipelineDefinition, state: unknown): string | null {
  const driver = lanePlan(def).driver
  return driver ? (currentWatermarks(def, state)[driver] ?? null) : null
}

export async function loadSource(workspaceId: string, dataSourceId: string): Promise<StoredDataSource> {
  const [source] = await db
    .select({ id: dataSources.id, workspaceId: dataSources.workspaceId, name: dataSources.name, sourceType: dataSources.sourceType, config: dataSources.config, credentials: dataSources.credentials })
    .from(dataSources)
    .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.workspaceId, workspaceId)))
    .limit(1)
  if (!source) throw new NonRetryableError('The data source used by this pipeline no longer exists.')
  // Secret references ({{secret:…}}) are resolved here, once per load, and only kept in memory.
  return withResolvedSecrets(source)
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

/**
 * Dry run on a small sample: reads real data, runs every step, writes nothing.
 * Streamed sources read a sample; a Join's staged side reads only the rows of
 * the sample's keys where the source can filter, else up to 5,000 rows. Enrich
 * calls the API for its first 5 requests; "Changes data" sends nothing.
 */
export async function testRunDefinition(scope: RunScope, config: unknown, sampleSize = 25, state?: unknown, pipelineId: string | null = null): Promise<EngineResult> {
  const def = parseDefinition(config)
  const plan = lanePlan(def)
  const watermarks = currentWatermarks(def, state)
  const loaded = new Map<string, Promise<StoredDataSource>>()
  const sourceFor = (id: string) => {
    if (!loaded.has(id)) loaded.set(id, loadSource(scope.workspaceId, id))
    return loaded.get(id)!
  }
  const io: EngineIO = {
    async read(step) {
      const source = await sourceFor(step.dataSourceId)
      const watermark = step.mode === 'incremental' ? { column: step.watermarkColumn, after: watermarks[step.id] ?? null } : undefined
      const limit = plan.streamed.includes(step.id) ? Math.max(sampleSize, 200) : STAGED_SAMPLE_ROWS
      return readSourceRows(source, step.table, Math.min(step.maxRows, limit), { watermark })
    },
    async readByKeys(step, column, keys, normalize) {
      // Incremental staged lanes: only rows after the position count, so read them the usual way.
      if (step.mode === 'incremental') return null
      return readRowsByKeys(await sourceFor(step.dataSourceId), step.table, column, keys, normalize, Math.min(step.maxRows, STAGED_SAMPLE_ROWS))
    },
  }
  // Same business rules and lookups as a real run, so the preview matches.
  let context: Awaited<ReturnType<typeof loadRunContext>>
  try {
    context = await loadRunContext(scope.workspaceId, def)
    // Enrich asks the API for its first few requests only; "Changes data" is a dry run (nothing sent).
    context.api = apiRuntime({ workspaceId: scope.workspaceId, pipelineId, mode: 'test', loadSource: (id) => sourceFor(id), counters: {} })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'failed', steps: [], rejects: [], rejectedCount: 0, rowsRead: 0, rowsWritten: 0, columns: [], error: message, retryable: false }
  }
  return runEngine(def, io, { sampleSize, context })
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

/**
 * Alerts for a finished run: bell for admins/stewards/operators and the actor,
 * email once; then the pipeline's subscribers and alert channels (MN-5), which
 * also hear about an error rate above the pipeline's threshold.
 */
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
  try {
    const config = await loadPipelineAlerts(opts.scope.workspaceId, opts.pipelineId)
    const held = opts.result.rejectedCount
    const highErrorRate = !failed && errorRateBreached(config, opts.result.rowsRead, held)
    const kind: AlertKind | null = failed ? 'failed' : rejected && alertOn === 'failure_or_rejects' ? 'rejects' : highErrorRate ? 'errorRate' : null
    if (!kind) return
    const title =
      kind === 'failed'
        ? `${opts.pipelineName} failed`
        : kind === 'rejects'
          ? `${opts.pipelineName} rejected ${opts.result.rejectedCount} rows`
          : `${opts.pipelineName} held ${errorRate(opts.result.rowsRead, held).toFixed(1)}% of its rows`
    const lines = [
      `Pipeline: ${opts.pipelineName}`,
      `Result: ${opts.message}`,
      `Trigger: ${opts.trigger}${opts.attempts > 1 ? ` · ${opts.attempts} attempts` : ''}`,
      `Time: ${new Date().toISOString()}`,
    ]
    if (kind === 'errorRate') lines.splice(2, 0, `Held rows: ${held} of ${opts.result.rowsRead} (alert above ${config.errorRatePercent}%)`)
    // MN-6: the likely cause and what to do (alerts are English, like other background mail).
    const cause = rootCause(opts.message)
    if (cause) lines.push(`Likely cause: ${hintsEn.causes[cause].title}`, `What to do: ${hintsEn.causes[cause].fix}`)
    const level = failed ? 'error' : 'warning'
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
        level,
        title,
        lines,
        pipelineId: opts.pipelineId,
        runId: opts.runId,
        email: alertOn === 'never' || i > 0 ? undefined : { to: settings?.alertEmails ?? [] },
      })
    }
    await deliverAlert(
      opts.scope.workspaceId,
      { kind, level, title, lines, pipelineId: opts.pipelineId, pipelineName: opts.pipelineName, runId: opts.runId, link: pipelineLink(opts.pipelineId), at: new Date().toISOString() },
      { config, notified: ids }
    )
  } catch (err) {
    // Alerts must never turn a finished run into an error.
    console.error('[runner] alert failed:', err instanceof Error ? err.message : err)
  }
}
