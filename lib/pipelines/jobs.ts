import { createHash } from 'node:crypto'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { executionLogs, pipelineJobPairs, pipelineJobSeen, pipelineJobs, pipelineRunRejects, pipelines } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { MAX_STAGED_ROWS, destinationTarget, scheduleSchema, stepTitle, type AggregateStep, type ColumnType, type DedupeStep, type DestinationStep, type JoinStep, type PipelineDefinition, type PipelineNode, type SourceStep } from './definition'
import { apiChunkRows } from './body-template'
import { enrichChunkRows } from './api-calls'
import { apiRuntime } from './api-runtime'
import { checkDestination, dedupeSeenField, newRunTotals, outputColumns, totalsStatus, transformChunk, upgradeTotals, type ChunkOutput, type DestinationResult, type EngineResult, type Reject, type RunTotals } from './engine'
import { NonRetryableError, dropDatasetTable, finalizeDatasetReplace, readSourceChunk, softDeleteDataSourceMissing, softDeleteDatasetMissing, stagingTableName, writeDataset, writeToDataSource, type ReadCache, type StoredDataSource } from './io'
import { inferColumns, type TypeHints } from './columns'
import { joinKey } from './join'
import { joinPrefix, lanePlan, passNodes, replayBlocked, type LanePlan, type Pass } from './lanes'
import { aggregateGroup, aggregateKey, aggregateOutputTypes, dedupeKey, duplicateMessage, pickSurvivor } from './aggregate'
import { activeAliases, loadSchema, type StoredSchema } from '@/lib/datasets/store'
import { prepareDefinedWrite } from '@/lib/datasets/write'
import { exposedColumns } from '@/lib/datasets/schema'
import type { OutputColumn } from './columns'
import { createStageTable, dropStageTables, lookupStage, stageGroups, stageKeys, stageSize, stageTableName, writeStageChunk } from './stage'
import { checkManagers, type Row } from './transforms'
import { loadRules, loadRunContext } from './context'
import { notifyRule } from '@/lib/notifications'
import { emitEvent } from '@/lib/webhooks/deliver'
import { takeQualitySnapshot } from '@/lib/quality/snapshot'
import { alertIfNeeded, currentWatermark, currentWatermarks, datasetTable, loadSource, parseDefinition, summarize, upsertDatasetRecord, watermarkKey, type PipelineState, type RunScope } from './runner'
import { nextRunAt } from './schedule'

/**
 * Background worker (TD-5). Runs are queued in pipeline_jobs and executed in
 * chunks of CHUNK_ROWS source rows by processJobs(), which is called by the
 * scheduler tick (pg_cron, every minute) and right after "Run now" (via
 * next/server after()). Each chunk is read, transformed, written and then
 * checkpointed, so a run that outgrows one 300 s function continues in the
 * next invocation. Transient failures are retried from the last checkpoint.
 *
 * Delivery is at-least-once: if a function dies between writing a chunk and
 * checkpointing it, that chunk is written again on resume. Upsert destinations
 * are unaffected; append destinations can get duplicates in that case.
 * Dataset "replace" loads into a staging table that is swapped in at the end.
 */

export const CHUNK_ROWS = 5000
/** Time a claimed job is reserved for one worker; longer than any single chunk. */
const LEASE_MS = 5 * 60_000
/** Stop starting new chunks this close to the invocation's deadline. */
const CHUNK_HEADROOM_MS = 75_000
/** Worker time per invocation, inside the 300 s function limit. */
export const WORKER_BUDGET_MS = 240_000
/** Quarantine rows kept per run (errors, approvals and flags); counts are always complete. */
const QUARANTINE_CAP = 10_000
const MAX_LOG_LINES = 200
const DONE_JOB_RETENTION_DAYS = 30

type Attempt = { attempt: number; error?: string; at: string }
type LogLine = { at: string; level: 'info' | 'warn' | 'error'; message: string }

interface JobProgress {
  /** Pipeline config snapshot taken at enqueue, so edits during a run don't mix versions. */
  config: unknown
  version: number
  /** Incremental sync: rows after this value (fixed for the whole run). */
  watermarkAfter: string | null
  startedAt?: string
  offset: number
  exhausted: boolean
  chunks: number
  totals?: RunTotals
  rejectsKept: number
  attempts: Attempt[]
  destination?: { kind: string; target: string; rowCount?: number }
  /** The read stopped at the source's max-rows cap (rows may remain: no soft deletes). */
  capped?: boolean
  /** Run log (MN-3). */
  log?: LogLine[]
  /** Last error's stack, shown to admins only. */
  errorStack?: string
  /** Quarantine replay (DQ-3): these quarantined rows re-enter the graph at the step that held them, instead of reading the source. */
  replay?: { rejectIds: string[] }
  /** The run's passes by entry step (a Source or a blocking step it finishes); absent until the run starts. */
  passes?: Record<string, PassProgress>
  /** Column types of the rows staged for each Join or blocking step (hints for the columns they add). */
  stageTypes?: Record<string, Record<string, ColumnType>>
  /** Rows staged per Join or blocking step (capped at MAX_STAGED_ROWS). */
  stageRows?: Record<string, number>
  /** API calls made so far per Enrich / "Changes data" step (the per-run call cap). */
  apiCalls?: Record<string, number>
  /** Incremental sync per Source: rows after these values (fixed for the whole run). */
  watermarksAfter?: Record<string, string | null>
}

interface PassProgress {
  /** Source passes: rows read so far. */
  offset: number
  /** Finish passes: the last group key answered. */
  cursor: string | null
  done: boolean
  /** Rows read (source) or produced (finish), and chunks done. */
  rows: number
  chunks: number
  /** The read stopped at the source's max-rows cap. */
  capped?: boolean
}

/** Rows one replay may re-run. */
export const REPLAY_MAX_ROWS = 5000

type Job = typeof pipelineJobs.$inferSelect

export type EnqueueOutcome = { runId: string; status: 'queued' | 'skipped'; message: string }

// ── Enqueue ──────────────────────────────────────────────────────────────────

/** Queues a run of the pipeline's published version. At most one active run per pipeline. */
export async function enqueueRun(pipelineId: string, scope: RunScope, trigger: 'manual' | 'schedule' | 'replay' | 'api' | 'webhook' | 'chain', opts: { replayIds?: string[] } = {}): Promise<EnqueueOutcome> {
  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.workspaceId, scope.workspaceId)))
    .limit(1)
  if (!pipeline) throw new Error('Pipeline not found')

  let watermarkAfter: string | null = null
  let watermarksAfter: Record<string, string | null> = {}
  try {
    const def = parseDefinition(pipeline.config)
    watermarkAfter = currentWatermark(def, pipeline.state)
    watermarksAfter = currentWatermarks(def, pipeline.state)
  } catch {
    // Invalid definition: the worker fails the run with the validation message.
  }
  const runId = newId('run')
  const progress: JobProgress = { config: pipeline.config, version: pipeline.version ?? 1, watermarkAfter, watermarksAfter, offset: 0, exhausted: false, chunks: 0, rejectsKept: 0, attempts: [] }
  if (opts.replayIds) progress.replay = { rejectIds: opts.replayIds.slice(0, REPLAY_MAX_ROWS) }

  const queued = await db.transaction(async (tx) => {
    // The partial unique index (one non-done job per pipeline) makes this race-free.
    const inserted = await tx
      .insert(pipelineJobs)
      .values({ id: runId, workspaceId: scope.workspaceId, pipelineId, actorId: scope.actorId, trigger, progress })
      .onConflictDoNothing()
      .returning({ id: pipelineJobs.id })
    if (!inserted.length) return false
    await tx.insert(executionLogs).values({
      id: runId,
      userId: scope.actorId,
      workspaceId: scope.workspaceId,
      pipelineId,
      status: 'queued',
      trigger,
      pipelineVersion: pipeline.version ?? 1,
      startTime: new Date(),
    })
    return true
  })
  if (!queued) {
    const [active] = await db
      .select({ id: pipelineJobs.id })
      .from(pipelineJobs)
      .where(and(eq(pipelineJobs.pipelineId, pipelineId), inArray(pipelineJobs.status, ['queued', 'running'])))
      .limit(1)
    return { runId: active?.id ?? '', status: 'skipped', message: 'This pipeline is already queued or running.' }
  }
  return { runId, status: 'queued', message: 'Run queued. It continues in the background; this page updates as it progresses.' }
}

// ── Worker ───────────────────────────────────────────────────────────────────

/** Runnable: queued and due, running with an expired lease (abandoned), or a cancel request no worker is handling. */
const RUNNABLE_SQL = `(status = 'queued' AND "availableAt" <= now())
  OR (status = 'running' AND "leaseUntil" < now())
  OR (status = 'cancelling' AND ("leaseUntil" IS NULL OR "leaseUntil" < now()))`

/** Atomically takes the oldest runnable job. A cancel request stays "cancelling" so the worker closes it out. */
async function claimJob(): Promise<Job | null> {
  const { rows } = await pool.query<Job>(
    `UPDATE pipeline_jobs SET status = CASE WHEN status = 'cancelling' THEN 'cancelling' ELSE 'running' END,
            "leaseUntil" = now() + make_interval(secs => $1), "updatedAt" = now()
      WHERE id = (
        SELECT id FROM pipeline_jobs
         WHERE ${RUNNABLE_SQL}
         ORDER BY "createdAt"
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING *`,
    [LEASE_MS / 1000]
  )
  return rows[0] ?? null
}

/** Whether any job is waiting for a worker (used to kick one after a page poll). */
export async function hasRunnableJobs(workspaceId?: string) {
  const [row] = await db
    .select({ id: pipelineJobs.id })
    .from(pipelineJobs)
    .where(
      and(
        workspaceId ? eq(pipelineJobs.workspaceId, workspaceId) : undefined,
        sql.raw(`(${RUNNABLE_SQL})`)
      )
    )
    .limit(1)
  return Boolean(row)
}

/**
 * Cancels a queued or running run (Monitoring → Cancel). A job no worker holds
 * is closed at once; a running one stops before its next chunk. Rows already
 * written stay; a dataset "replace" keeps the previous data.
 */
export async function cancelRun(runId: string, workspaceId: string): Promise<'cancelled' | 'cancelling' | 'not_active'> {
  const { rows } = await pool.query<{ was: string; leaseUntil: Date | null }>(
    `WITH prev AS (
       SELECT id, status, "leaseUntil" FROM pipeline_jobs
        WHERE id = $1 AND "workspaceId" = $2 AND status IN ('queued', 'running') FOR UPDATE)
     UPDATE pipeline_jobs j SET status = 'cancelling', "updatedAt" = now() FROM prev WHERE j.id = prev.id
     RETURNING prev.status AS was, prev."leaseUntil" AS "leaseUntil"`,
    [runId, workspaceId]
  )
  if (!rows.length) return 'not_active'
  const held = rows[0].was === 'running' && rows[0].leaseUntil && new Date(rows[0].leaseUntil).getTime() > Date.now()
  if (held) return 'cancelling'
  const [job] = await db.select().from(pipelineJobs).where(eq(pipelineJobs.id, runId)).limit(1)
  let def: PipelineDefinition | null = null
  try {
    def = parseDefinition((job.progress as JobProgress).config)
  } catch {
    // Closing out a cancelled run doesn't need a valid definition.
  }
  await finishJob(job, job.progress as JobProgress, def, { cancelled: true })
  return 'cancelled'
}

const isCancelling = async (jobId: string) =>
  (await db.select({ status: pipelineJobs.status }).from(pipelineJobs).where(eq(pipelineJobs.id, jobId)).limit(1))[0]?.status === 'cancelling'

/** Works through runnable jobs until the time budget is used. Safe to call concurrently. */
export async function processJobs(opts: { budgetMs?: number; maxJobs?: number; /** Tests: pause each job after this many chunks. */ maxChunksPerSlice?: number } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? WORKER_BUDGET_MS)
  const results: { runId: string; state: string }[] = []
  await db.delete(pipelineJobs).where(and(eq(pipelineJobs.status, 'done'), lt(pipelineJobs.updatedAt, new Date(Date.now() - DONE_JOB_RETENTION_DAYS * 86_400_000))))
  while (Date.now() < deadline - CHUNK_HEADROOM_MS && results.length < (opts.maxJobs ?? 20)) {
    const job = await claimJob()
    if (!job) break
    results.push({ runId: job.id, state: await runJobSlice(job, deadline, opts.maxChunksPerSlice ?? Infinity) })
  }
  return results
}

/** A Set that stores SHA-256 prefixes, so "unique" values from earlier chunks can be persisted without copying data. */
class HashedSet extends Set<string> {
  added: string[] = []
  static hash(v: string) {
    return createHash('sha256').update(v).digest('base64url').slice(0, 22)
  }
  override has(v: string) {
    return super.has(HashedSet.hash(v))
  }
  override add(v: string) {
    const h = HashedSet.hash(v)
    if (!super.has(h)) this.added.push(h)
    return super.add(h)
  }
  restore(hashes: string[]) {
    for (const h of hashes) super.add(h)
    return this
  }
}

/** Seen-value sets of "unique" rules, plus written keys of destinations that mark missing rows deleted. */
async function loadSeen(jobId: string, def: PipelineDefinition) {
  const fields = new Set(def.nodes.flatMap((s) => (s.type === 'validate' ? s.rules.filter((r) => r.rule === 'unique').map((r) => r.field) : [])))
  for (const d of def.nodes) if (d.type === 'destination' && d.kind === 'datasource' && d.softDeleteMissing) fields.add(destKeyField(d.id))
  // Deduplicate keeping the first row: keys already kept in earlier chunks.
  for (const d of def.nodes) if (d.type === 'dedupe' && d.keep === 'first') fields.add(dedupeSeenField(d.id))
  const seen = new Map<string, Set<string>>()
  if (!fields.size) return { seen, sets: [] as [string, HashedSet][] }
  const rows = await db.select({ field: pipelineJobSeen.field, hash: pipelineJobSeen.hash }).from(pipelineJobSeen).where(eq(pipelineJobSeen.jobId, jobId))
  const sets: [string, HashedSet][] = []
  for (const field of fields) {
    const set = new HashedSet().restore(rows.filter((r) => r.field === field).map((r) => r.hash))
    seen.set(field, set)
    sets.push([field, set])
  }
  return { seen, sets }
}

const destKeyField = (destId: string) => `__dest:${destId}`
const keyOf = (row: Row, keys: string[]) => keys.map((k) => (row[k] === null || row[k] === undefined ? '' : String(row[k]))).join('\u0001')

function errorInfo(err: unknown) {
  return {
    message: err instanceof Error ? err.message : String(err),
    retryable: (err as { retryable?: boolean } | null)?.retryable !== false,
    stack: err instanceof Error ? err.stack?.split('\n').slice(0, 12).join('\n') : undefined,
  }
}

function log(progress: JobProgress, level: LogLine['level'], message: string) {
  progress.log ??= []
  progress.log.push({ at: new Date().toISOString(), level, message })
  if (progress.log.length > MAX_LOG_LINES) progress.log.splice(1, progress.log.length - MAX_LOG_LINES)
}

/** Whether replayed rows re-enter before a Join: then the passes that prepare its lookup run first. */
async function replayNeedsLookups(def: PipelineDefinition, plan: LanePlan, workspaceId: string, rejectIds: string[]): Promise<boolean> {
  if (!plan.joins.length || !rejectIds.length) return false
  const rows = await db
    .selectDistinct({ nodeId: pipelineRunRejects.nodeId })
    .from(pipelineRunRejects)
    .where(and(eq(pipelineRunRejects.workspaceId, workspaceId), inArray(pipelineRunRejects.id, rejectIds)))
  return rows.some((r) => r.nodeId && !replayBlocked(def, plan, r.nodeId) && plan.joins.some((j) => passNodes(def, r.nodeId!).has(j.id)))
}

/** Column types of the staged sides, as hints for the joined columns (also under the clash prefix). */
function stagedHints(def: PipelineDefinition, plan: LanePlan, progress: JobProgress): TypeHints {
  const hints: TypeHints = {}
  for (const j of plan.joins) {
    const node = def.nodes.find((n): n is JoinStep => n.type === 'join' && n.id === j.id)
    const types = progress.stageTypes?.[j.id]
    if (!node || !types) continue
    const prefix = joinPrefix(def, plan, node)
    for (const [name, type] of Object.entries(types)) {
      hints[name] ??= type
      hints[`${prefix}${name}`] ??= type
    }
  }
  return hints
}

/** The key a staged row is grouped or looked up by: a Join's right key, an Aggregate's group, a Deduplicate key. */
function stageKey(node: PipelineNode | undefined, row: Row, unique: string): string | null {
  if (node?.type === 'join') return joinKey(row, node.keys.map((k) => k.right), node.normalize)
  if (node?.type === 'aggregate') return aggregateKey(row, node)
  // Rows without a key are never duplicates: each gets a group of its own.
  if (node?.type === 'dedupe') return dedupeKey(row, node) ?? `\u0002${unique}`
  return null
}

/** Groups a finish pass answers per chunk. */
const FINISH_GROUPS = 1000

/** Runs chunks of one job until it finishes, fails, or the invocation runs out of time. */
async function runJobSlice(job: Job, deadline: number, maxChunks: number): Promise<string> {
  const scope: RunScope = { workspaceId: job.workspaceId, actorId: job.actorId }
  const progress = job.progress as JobProgress
  let def: PipelineDefinition | null = null
  try {
    def = parseDefinition(progress.config)
  } catch (err) {
    return finishJob(job, progress, null, job.status === 'cancelling' ? { cancelled: true } : { error: errorInfo(err).message })
  }
  if (job.status === 'cancelling') return finishJob(job, progress, def, { cancelled: true })

  const plan = lanePlan(def)
  const nodeOf = (id: string) => def!.nodes.find((n) => n.id === id)
  const sourceStep = (id: string) => def!.nodes.find((n): n is SourceStep => n.type === 'source' && n.id === id)!
  const destinations = def.nodes.filter((n): n is DestinationStep => n.type === 'destination')
  // Runs queued before several sources read one Source with one watermark.
  progress.watermarksAfter ??= plan.driver ? { [plan.driver]: progress.watermarkAfter ?? null } : {}

  if (!progress.startedAt) {
    progress.startedAt = new Date().toISOString()
    log(progress, 'info', `Run started (v${progress.version}, ${job.trigger})`)
    await db.update(executionLogs).set({ status: 'running', startTime: new Date(progress.startedAt), updatedAt: new Date() }).where(eq(executionLogs.id, job.id))
  } else {
    log(progress, 'info', `Resumed at row ${progress.offset.toLocaleString()}`)
  }
  const totals = upgradeTotals(progress.totals ?? newRunTotals(def))
  progress.totals = totals
  // An API destination sets the pace: its chunk must finish well inside one invocation (apiChunkRows).
  const chunkRows = Math.min(
    def.settings.batchSize ?? CHUNK_ROWS,
    ...destinations.flatMap((d) => (d.kind === 'api' ? [apiChunkRows(d)] : [])),
    // API calls inside a lane set the pace too.
    ...def.nodes.flatMap((n) => (n.type === 'enrich' ? [enrichChunkRows(n)] : n.type === 'apicall' ? [Math.max(20, Math.floor(n.maxRequestsPerSecond * 40))] : []))
  )

  try {
    // The run's passes (lib/pipelines/lanes.ts planPasses): lookups first, then the driver,
    // Union partners and the finish passes of blocking steps. A replay only prepares lookups.
    if (!progress.passes) {
      const prepare = progress.replay ? await replayNeedsLookups(def, plan, scope.workspaceId, progress.replay.rejectIds) : true
      progress.passes = {}
      for (const p of plan.passes) {
        if (progress.replay && !(prepare && p.staged)) continue
        progress.passes[p.id] = { offset: 0, cursor: null, done: false, rows: 0, chunks: 0 }
      }
      // A run queued before passes existed may already have read part of its only source.
      if (!progress.replay && plan.driver && progress.offset > 0 && progress.passes[plan.driver]) {
        Object.assign(progress.passes[plan.driver], { offset: progress.offset, done: progress.exhausted, chunks: progress.chunks })
      }
    }

    const loaded = new Map<string, StoredDataSource>()
    const dataSource = async (id: string) => {
      if (!loaded.has(id)) loaded.set(id, await loadSource(scope.workspaceId, id))
      return loaded.get(id)!
    }
    // Destination targets: dataset table (+ staging for replace) or data source.
    const targets = new Map<string, { node: DestinationStep; table?: string; staging?: string | null; ds?: StoredDataSource }>()
    const wroteAny = Object.entries(progress.passes).some(([id, p]) => p.chunks > 0 && !plan.passes.find((x) => x.id === id)?.staged)
    for (const d of destinations) {
      if (d.kind === 'dataset') {
        const table = await datasetTable(scope.workspaceId, d.datasetName)
        // A replay adds rows to the live table; only a full run stages and swaps.
        const staging = d.mode === 'replace' && !progress.replay ? stagingTableName(table, `${job.id}:${d.id}`) : null
        // A replace run that starts over (nothing written yet) discards what an earlier attempt staged.
        if (staging && !wroteAny) await dropDatasetTable(staging)
        targets.set(d.id, { node: d, table, staging })
      } else {
        targets.set(d.id, { node: d, ds: await dataSource(d.dataSourceId) })
      }
    }

    const ctx = await loadRunContext(scope.workspaceId, def)
    const { seen, sets } = await loadSeen(job.id, def)
    ctx.seen = seen
    ctx.api = apiRuntime({ workspaceId: scope.workspaceId, pipelineId: job.pipelineId, mode: 'run', loadSource: dataSource, counters: (progress.apiCalls ??= {}), deadline: deadline - 20_000 })
    ctx.joinPartners = async (join, keys) => ({
      partners: await lookupStage(stageTableName(job.id, join.id), keys),
      columns: Object.keys(progress.stageTypes?.[join.id] ?? {}),
    })
    const cache: ReadCache = new Map()
    const watermarkFor = (s: SourceStep) => (s.mode === 'incremental' ? { column: s.watermarkColumn, after: progress.watermarksAfter?.[s.id] ?? null } : undefined)
    const timeoutAt = new Date(progress.startedAt!).getTime() + def.settings.timeoutMinutes * 60_000

    let destRejects: Reject[] = []
    // Defined datasets (lib/datasets): their schema, loaded once per slice (an automatic addition refreshes it).
    const schemas = new Map<string, StoredSchema | null>()
    const schemaOf = async (name: string) => {
      if (!schemas.has(name)) schemas.set(name, await loadSchema(scope.workspaceId, name))
      return schemas.get(name)!
    }
    const aliases = new Map<string, { oldName: string; newName: string }[]>()
    const aliasesOf = async (name: string) => {
      if (!aliases.has(name)) aliases.set(name, await activeAliases(scope.workspaceId, name))
      return aliases.get(name)!
    }
    const extrasLogged = new Set<string>()
    const writeOutputs = async (out: ChunkOutput) => {
      for (const [destId, target] of targets) {
        const rows = out.byDestination.get(destId) ?? []
        if (!rows.length) continue
        const dest = target.node
        const columns = totals.columnsByDest[destId] ?? []
        const stored = dest.kind === 'dataset' ? await schemaOf(dest.datasetName) : null
        if (!stored) checkDestination(def!, columns, dest)
        const writeStarted = Date.now()
        let written = 0
        if (dest.kind === 'dataset') {
          let write = { rows, columns, keys: dest.keys, tableColumns: undefined as OutputColumn[] | undefined }
          if (stored) {
            // Target-first mapping, checked against the schema; only mapped columns are written (column ownership).
            const prep = await prepareDefinedWrite({ workspaceId: scope.workspaceId, userId: job.actorId }, stored, dest, rows, Object.fromEntries(columns.map((c) => [c.name, c.type])), await aliasesOf(dest.datasetName))
            schemas.set(dest.datasetName, prep.stored)
            if (prep.added.length) log(progress, 'info', `${dest.datasetName}: new column(s) ${prep.added.join(', ')} added to the schema for review`)
            if (prep.dropped.length && !extrasLogged.has(destId)) {
              extrasLogged.add(destId)
              log(progress, 'warn', `${dest.datasetName}: column(s) not in the schema were not written: ${prep.dropped.slice(0, 20).join(', ')}`)
            }
            for (const r of prep.rejects) {
              destRejects.push({ stepId: destId, row: r.row, errors: r.errors, severity: 'error', kind: 'invalid' })
              totals.rejectedCount++
              const st = totals.steps.find((x) => x.id === destId)
              if (st) st.rejected++
            }
            write = { rows: prep.rows, columns: prep.columns, keys: prep.keys, tableColumns: prep.tableColumns }
          }
          const res = await writeDataset({
            workspaceId: scope.workspaceId,
            existingTableName: target.staging ?? target.table!,
            datasetName: dest.datasetName,
            mode: target.staging || (progress.replay && dest.mode === 'replace') ? 'append' : dest.mode,
            keys: write.keys,
            columns: write.columns,
            tableColumns: write.tableColumns,
            rows: write.rows,
            runId: job.id,
            // The chunk being written: progress.chunks counts completed (checkpointed) chunks.
            chunk: progress.chunks,
            // A replay into a replace dataset replaces rows with the same key instead of adding a second copy (TD-24).
            replaceKeys: progress.replay && dest.mode === 'replace' ? write.keys : undefined,
          })
          written = res.written
        } else {
          const res = await writeToDataSource({
            source: target.ds!,
            table: destinationTarget(dest),
            mode: dest.mode,
            keys: dest.keys,
            columns,
            rows,
            runId: job.id,
            chunk: progress.chunks,
            api: dest.kind === 'api' ? dest : undefined,
            // A REST API answers at its own pace: stop in time for the checkpoint instead of being cut off.
            deadline: deadline - 20_000,
          })
          written = res.written
          // Rows the destination refused (a KMPlus product's validation, an API's 4xx) go to the quarantine, replayable from this step.
          for (const r of res.rejected ?? []) {
            destRejects.push({ stepId: destId, row: r.row, errors: (r.errors ?? [r.error]).map((e) => `${destinationTarget(dest)}: ${e}`), severity: 'error', kind: 'invalid' })
            totals.rejectedCount++
            const st = totals.steps.find((x) => x.id === destId)
            if (st) st.rejected++
          }
          if (dest.softDeleteMissing && !progress.replay) {
            const set = seen.get(destKeyField(destId))!
            for (const r of rows) set.add(keyOf(r, dest.keys))
          }
        }
        totals.rowsWritten += written
        totals.writtenByDest[destId] = (totals.writtenByDest[destId] ?? 0) + written
        const stat = totals.steps.find((s) => s.id === destId)
        if (stat) {
          stat.rowsOut += written
          stat.durationMs += Date.now() - writeStarted
        }
      }
    }

    /** Rows that reached a Join's right side or a blocking step: into that step's staging table (exactly once per pass and chunk). */
    const created = new Set<string>()
    const stageOutputs = async (pass: Pass, chunk: number, out: ChunkOutput, types?: TypeHints) => {
      for (const [sink, rows] of out.toStage) {
        const node = nodeOf(sink)
        if (!created.has(sink)) (await createStageTable({ workspaceId: scope.workspaceId, runId: job.id, nodeId: sink }), created.add(sink))
        const known = (progress.stageTypes ??= {})[sink] ?? {}
        for (const c of inferColumns(rows, types)) known[c.name] ??= c.type
        progress.stageTypes[sink] = known
        await writeStageChunk(stageTableName(job.id, sink), pass.id, chunk, rows.map((row, i) => ({ key: stageKey(node, row, `${pass.id}:${chunk}:${i}`), row })))
        const total = ((progress.stageRows ??= {})[sink] ?? 0) + rows.length
        progress.stageRows[sink] = total
        if (total > MAX_STAGED_ROWS) {
          throw new NonRetryableError(`"${node ? stepTitle(node) : sink}" has more than ${MAX_STAGED_ROWS.toLocaleString('en-US')} rows to hold. Filter that lane, or make it the driver.`)
        }
      }
    }

    /** One chunk of a Source pass: read, run the lane, write Destinations, stage what stops at a Join or blocking step. */
    const sourceChunk = async (pass: Pass, state: PassProgress) => {
      const started = Date.now()
      const src = sourceStep(pass.id)
      const limit = pass.staged ? (def!.settings.batchSize ?? CHUNK_ROWS) : chunkRows
      const read = await readSourceChunk(await dataSource(src.dataSourceId), src.table, { offset: state.offset, limit, maxRows: src.maxRows, watermark: watermarkFor(src), cache })
      const readMs = Date.now() - started
      const out = await transformChunk(def!, read.rows, totals, ctx, { ...stagedHints(def!, plan, progress), ...read.types }, { entry: pass.id, stage: pass.staged })
      const srcStat = totals.steps.find((s) => s.id === src.id)
      if (srcStat) srcStat.durationMs += readMs
      await writeOutputs(out)
      await stageOutputs(pass, state.chunks, out, read.types)
      state.offset += read.rows.length
      state.rows += read.rows.length
      state.chunks++
      state.done = read.exhausted
      progress.offset = state.offset
      if (read.exhausted && state.offset >= src.maxRows) {
        state.capped = true
        if (pass.staged) log(progress, 'warn', `${src.table}: read stopped at the ${src.maxRows.toLocaleString('en-US')}-row cap; rows past it have no partner`)
        else progress.capped = true
      }
      progress.chunks++
      log(progress, 'info', `${pass.staged ? 'Staging' : 'Chunk'} ${progress.chunks}: read ${read.rows.length.toLocaleString('en-US')} rows of ${src.table} in ${readMs} ms; ${out.rejects.length} quarantined, ${out.flags.length} flagged`)
      await checkpoint(job, progress, scope, [...out.rejects, ...out.flags, ...destRejects], sets, out.managerPairs, Date.now() - started)
      destRejects = []
    }

    /** One chunk of a finish pass: answer the next groups of a blocking step and send the result on. */
    const finishChunk = async (pass: Pass, state: PassProgress) => {
      const started = Date.now()
      const node = nodeOf(pass.id) as AggregateStep | DedupeStep
      const table = stageTableName(job.id, pass.id)
      if (!state.chunks && node.type === 'aggregate') {
        // Rows held back earlier in this lane aren't in the aggregate; a re-run counts them once fixed.
        const upstream = [...(plan.lanes.get(node.id) ?? [])].flatMap((s) => [...passNodes(def!, s, { blocking: true })]).filter((id) => id !== node.id)
        const held = totals.steps.filter((s) => upstream.includes(s.id)).reduce((n, s) => n + s.rejected, 0)
        if (held) log(progress, 'warn', `${stepTitle(node)}: ${held.toLocaleString('en-US')} rows held back earlier are not counted`)
      }
      const keys = await stageKeys(table, state.cursor, FINISH_GROUPS)
      const groups = await stageGroups(table, keys)
      const rows: Row[] = []
      const removed: Reject[] = []
      const stat = totals.steps.find((s) => s.id === node.id)
      for (const group of groups.values()) {
        if (!group.length) continue
        if (node.type === 'aggregate') rows.push(aggregateGroup(node, group))
        else {
          const { kept, removed: gone } = pickSurvivor(node, group)
          rows.push(kept)
          if (node.flagRemoved) for (const r of gone) removed.push({ stepId: node.id, row: r, errors: [duplicateMessage(node, r, kept)], severity: 'info', kind: 'flag' })
        }
      }
      if (removed.length) {
        totals.flaggedCount += removed.length
        if (stat) stat.flagged = (stat.flagged ?? 0) + removed.length
      }
      const hints = node.type === 'aggregate' ? aggregateOutputTypes(node, progress.stageTypes?.[node.id]) : { ...(progress.stageTypes?.[node.id] ?? {}) }
      const out = await transformChunk(def!, rows, totals, ctx, { ...stagedHints(def!, plan, progress), ...hints }, { startNodeId: node.id, finish: true })
      await writeOutputs(out)
      await stageOutputs(pass, state.chunks, out, hints)
      state.cursor = keys.length ? keys[keys.length - 1] : state.cursor
      state.rows += rows.length
      state.chunks++
      state.done = keys.length < FINISH_GROUPS
      progress.chunks++
      log(progress, 'info', `${stepTitle(node)}: ${keys.length.toLocaleString('en-US')} groups answered${removed.length ? `, ${removed.length.toLocaleString('en-US')} duplicates removed` : ''}`)
      await checkpoint(job, progress, scope, [...removed, ...out.rejects, ...out.flags, ...destRejects], sets, out.managerPairs, Date.now() - started)
      destRejects = []
    }

    /** Quarantine replay (DQ-3): the held rows re-enter the graph at the step that held them. */
    const replayRows = async () => {
      const started = Date.now()
      const held = await db
        .select()
        .from(pipelineRunRejects)
        .where(and(eq(pipelineRunRejects.workspaceId, scope.workspaceId), eq(pipelineRunRejects.pipelineId, job.pipelineId), inArray(pipelineRunRejects.id, progress.replay!.rejectIds)))
      const groups = new Map<string, typeof held>()
      for (const r of held) {
        const key = `${r.nodeId ?? ''}|${r.kind}`
        groups.set(key, [...(groups.get(key) ?? []), r])
      }
      const quarantine: Reject[] = []
      const pairs: ChunkPairs = []
      const replayed: string[] = []
      for (const [key, rows] of groups) {
        const [nodeId, kind] = key.split('|')
        if (!def!.nodes.some((n) => n.id === nodeId)) {
          log(progress, 'warn', `${rows.length} row(s) skipped: the step that held them no longer exists in the published pipeline`)
          continue
        }
        if (replayBlocked(def!, plan, nodeId)) {
          // A finished Join lookup or Aggregate can't take one more row: only a new run brings them in.
          log(progress, 'warn', `${rows.length} row(s) skipped: they were held before a Join's looked-up side or an Aggregate / Deduplicate step; run the pipeline again to include them`)
          continue
        }
        // Approved rows pass require_approval; corrected rows are checked again from the same step.
        const out = await transformChunk(def!, rows.map((r) => (r.fixedRow ?? r.row) as Row), totals, { ...ctx, approved: kind === 'approval' }, stagedHints(def!, plan, progress), { startNodeId: nodeId })
        totals.rowsRead += rows.length
        await writeOutputs(out)
        quarantine.push(...out.rejects, ...out.flags)
        pairs.push(...out.managerPairs)
        replayed.push(...rows.map((r) => r.id))
      }
      if (replayed.length) {
        await db
          .update(pipelineRunRejects)
          .set({ status: 'replayed', replayRunId: job.id, updatedAt: new Date() })
          .where(and(eq(pipelineRunRejects.workspaceId, scope.workspaceId), inArray(pipelineRunRejects.id, replayed)))
      }
      progress.exhausted = true
      progress.chunks++
      log(progress, 'info', `Replayed ${replayed.length.toLocaleString('en-US')} quarantined row(s); ${quarantine.filter((r) => r.kind !== 'flag').length} quarantined again`)
      await checkpoint(job, progress, scope, [...quarantine, ...destRejects], sets, pairs, Date.now() - started)
      destRejects = []
    }

    let sliceChunks = 0
    // A slow chunk (e.g. a slow API) means the next one needs as much time.
    let lastChunkMs = 0
    let lookupsReady = Object.entries(progress.passes).every(([id, p]) => p.done || !plan.passes.find((x) => x.id === id)?.staged)
    for (;;) {
      const next = plan.passes.find((p) => progress.passes![p.id] && !progress.passes![p.id].done)
      if (!next && (progress.exhausted || !progress.replay)) {
        progress.exhausted = true
        break
      }
      if (await isCancelling(job.id)) return finishJob(job, progress, def, { cancelled: true })
      if (Date.now() > timeoutAt) throw Object.assign(new Error(`The run passed its ${def.settings.timeoutMinutes}-minute timeout.`), { retryable: false })
      // Every slice makes progress (one chunk at least), then stops near the deadline.
      if (sliceChunks >= maxChunks || (sliceChunks > 0 && Date.now() > deadline - Math.max(CHUNK_HEADROOM_MS, lastChunkMs * 1.25))) {
        // Out of time: release the job; the next tick (or page poll) resumes it. Never overwrite a cancel request.
        log(progress, 'info', `Paused${next ? ` in ${stepTitle(nodeOf(next.id)!)}` : ''} (function time limit); continues in the next invocation`)
        const released = await db
          .update(pipelineJobs)
          .set({ status: 'queued', leaseUntil: null, availableAt: new Date(), progress, updatedAt: new Date() })
          .where(and(eq(pipelineJobs.id, job.id), eq(pipelineJobs.status, 'running')))
          .returning({ id: pipelineJobs.id })
        return released.length ? 'paused' : finishJob(job, progress, def, { cancelled: true })
      }
      const started = Date.now()
      if (next) {
        const state = progress.passes[next.id]
        if (next.kind === 'source') await sourceChunk(next, state)
        else await finishChunk(next, state)
      } else await replayRows()
      sliceChunks++
      lastChunkMs = Date.now() - started
      if (!lookupsReady && Object.entries(progress.passes).every(([id, p]) => p.done || !plan.passes.find((x) => x.id === id)?.staged)) {
        lookupsReady = true
        const bytes = await stageSize(job.id).catch(() => 0)
        if (bytes) log(progress, 'info', `Staging done: ${(totals.stagedRows ?? 0).toLocaleString('en-US')} rows, ${(bytes / 1_048_576).toFixed(1)} MB`)
      }

      // PD-10: error-rate threshold.
      const maxPct = def.settings.maxErrorPercent
      if (!next?.staged && maxPct !== null && maxPct !== undefined && totals.rowsRead >= 100) {
        const pct = (totals.rejectedCount / totals.rowsRead) * 100
        if (pct > maxPct) throw Object.assign(new Error(`${pct.toFixed(1)}% of rows were quarantined, above this pipeline's ${maxPct}% limit.`), { retryable: false })
      }
    }
  } catch (err) {
    const info = errorInfo(err)
    progress.attempts.push({ attempt: progress.attempts.length + 1, error: info.message, at: new Date().toISOString() })
    progress.errorStack = info.stack
    log(progress, 'error', info.message)
    if (await isCancelling(job.id)) return finishJob(job, progress, def, { cancelled: true })
    const failures = job.attempts + 1
    if (info.retryable && failures <= def.settings.retries) {
      const delaySec = Math.min(300, def.settings.retryDelaySeconds * 2 ** (failures - 1))
      log(progress, 'warn', `Attempt ${failures} failed; retrying from the last checkpoint in ${delaySec}s`)
      const requeued = await db
        .update(pipelineJobs)
        .set({ status: 'queued', attempts: failures, availableAt: new Date(Date.now() + delaySec * 1000), leaseUntil: null, progress, updatedAt: new Date() })
        .where(and(eq(pipelineJobs.id, job.id), eq(pipelineJobs.status, 'running')))
        .returning({ id: pipelineJobs.id })
      if (!requeued.length) return finishJob(job, progress, def, { cancelled: true })
      await db.update(executionLogs).set({ errorMessage: `Attempt ${failures} failed, retrying in ${delaySec}s: ${info.message}`, updatedAt: new Date() }).where(eq(executionLogs.id, job.id))
      return 'retrying'
    }
    return finishJob(job, progress, def, { error: info.message })
  }
  return finishJob(job, progress, def, (await isCancelling(job.id)) ? { cancelled: true } : {})
}

/** Persists one chunk's outcome atomically: quarantine rows, new hashes, manager pairs, counters and the cursor. */
async function checkpoint(
  job: Job,
  progress: JobProgress,
  scope: RunScope,
  quarantine: Reject[],
  sets: [string, HashedSet][],
  pairs: ChunkPairs,
  chunkMs: number
) {
  const keep = quarantine.slice(0, Math.max(0, QUARANTINE_CAP - progress.rejectsKept))
  progress.rejectsKept += keep.length
  const totals = progress.totals!
  await db.transaction(async (tx) => {
    for (let i = 0; i < keep.length; i += 1000) {
      await tx.insert(pipelineRunRejects).values(
        keep.slice(i, i + 1000).map((r) => ({
          id: newId('rej'),
          runId: job.id,
          pipelineId: job.pipelineId,
          userId: scope.actorId,
          workspaceId: scope.workspaceId,
          row: jsonSafe(r.row),
          errors: { stepId: r.stepId, messages: r.errors },
          nodeId: r.stepId,
          severity: r.severity ?? 'error',
          kind: r.kind ?? 'invalid',
        }))
      )
    }
    for (const [field, set] of sets) {
      for (let i = 0; i < set.added.length; i += 5000) {
        await tx
          .insert(pipelineJobSeen)
          .values(set.added.slice(i, i + 5000).map((hash) => ({ jobId: job.id, field, hash })))
          .onConflictDoNothing()
      }
    }
    for (let i = 0; i < pairs.length; i += 5000) {
      await tx.insert(pipelineJobPairs).values(pairs.slice(i, i + 5000).map((p) => ({ jobId: job.id, ...p })))
    }
    await tx
      .update(pipelineJobs)
      .set({ progress, leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
      .where(eq(pipelineJobs.id, job.id))
    await tx
      .update(executionLogs)
      .set({ recordsProcessed: totals.rowsRead, recordsSuccess: totals.rowsWritten, recordsError: totals.rejectedCount + totals.heldCount, updatedAt: new Date() })
      .where(eq(executionLogs.id, job.id))
  })
  for (const [, set] of sets) set.added = []
  if (chunkMs > 60_000) console.warn(`[jobs] ${job.id}: chunk took ${Math.round(chunkMs / 1000)}s`)
}

type ChunkPairs = { nodeId: string; key: string; manager: string; field: string; keyField: string }[]

const jsonSafe = (row: Row) => JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))

/** Completes a run: manager checks, dataset swaps/soft deletes, run log, pipeline state, rule actions, audit, alerts. */
async function finishJob(job: Job, progress: JobProgress, def: PipelineDefinition | null, outcome: { error?: string; cancelled?: boolean }): Promise<string> {
  const cancelled = Boolean(outcome.cancelled)
  const scope: RunScope = { workspaceId: job.workspaceId, actorId: job.actorId }
  const totals = upgradeTotals(progress.totals ?? (def ? newRunTotals(def) : ({ steps: [], rowsRead: 0, rowsWritten: 0, rejectedCount: 0, columns: [] } as unknown as RunTotals)))
  let error = outcome.error
  const destinations = def ? def.nodes.filter((n): n is DestinationStep => n.type === 'destination') : []
  const results: DestinationResult[] = []
  const replay = Boolean(progress.replay)

  // Manager checks need every row of the run: unknown managers and reporting cycles become warnings.
  if (!error && !cancelled && def) {
    const pairs = await db.select().from(pipelineJobPairs).where(eq(pipelineJobPairs.jobId, job.id))
    const byNode = new Map<string, typeof pairs>()
    for (const p of pairs) byNode.set(`${p.nodeId}|${p.field}|${p.keyField}`, [...(byNode.get(`${p.nodeId}|${p.field}|${p.keyField}`) ?? []), p])
    const flags: Reject[] = []
    for (const group of byNode.values()) {
      for (const f of checkManagers(group)) {
        flags.push({ stepId: group[0].nodeId, row: { [group[0].keyField]: f.key, [group[0].field]: f.manager }, errors: [f.message], severity: 'warning', kind: 'flag' })
      }
    }
    if (flags.length) {
      totals.flaggedCount += flags.length
      log(progress, 'warn', `${flags.length} manager issue(s): unknown managers or circular reporting lines`)
      await checkpoint(job, progress, scope, flags, [], [], 0)
    }
  }

  for (const dest of destinations) {
    try {
      if (dest.kind === 'dataset') {
        const tableName = await datasetTable(scope.workspaceId, dest.datasetName)
        const staging = stagingTableName(tableName, `${job.id}:${dest.id}`)
        // A defined dataset keeps its schema's columns whatever this run mapped.
        const defined = await loadSchema(scope.workspaceId, dest.datasetName).catch(() => null)
        const columns = defined ? exposedColumns(defined.schema).map((c) => ({ name: c.name, type: c.type })) : totals.columnsByDest[dest.id]?.length ? totals.columnsByDest[dest.id] : outputColumns(def!, [], {}, dest.id)
        if (error || cancelled) {
          if (dest.mode === 'replace' && !replay) await dropDatasetTable(staging).catch(() => undefined)
          continue
        }
        let rowCount: number | undefined
        if (dest.mode === 'replace' && !replay) {
          // No rows at all: still create the (empty) dataset with the declared columns.
          if (!totals.writtenByDest[dest.id] && columns.length) {
            await writeDataset({ workspaceId: scope.workspaceId, existingTableName: staging, datasetName: dest.datasetName, mode: 'append', keys: [], columns, tableColumns: defined?.schema.columns.map((c) => ({ name: c.name, type: c.type })), rows: [] })
          }
          rowCount = await finalizeDatasetReplace(tableName, staging)
        } else {
          const res = await writeDataset({ workspaceId: scope.workspaceId, existingTableName: tableName, datasetName: dest.datasetName, mode: dest.mode === 'replace' ? 'append' : dest.mode, keys: dest.keys, columns, rows: [] })
          rowCount = res.rowCount
          if (dest.softDeleteMissing && !replay) {
            if (progress.capped) log(progress, 'warn', `${dest.datasetName}: missing rows not marked deleted, the read stopped at the ${progress.offset.toLocaleString()}-row cap`)
            else {
              const marked = await softDeleteDatasetMissing(tableName, job.id)
              if (marked) log(progress, 'info', `${dest.datasetName}: ${marked.toLocaleString()} row(s) no longer in the source marked deleted`)
              rowCount = (await writeDataset({ workspaceId: scope.workspaceId, existingTableName: tableName, datasetName: dest.datasetName, mode: 'append', keys: [], columns, rows: [] })).rowCount
            }
          }
        }
        if (columns.length) await upsertDatasetRecord(scope, job.pipelineId, dest.datasetName, tableName, columns, rowCount ?? 0)
        results.push({ id: dest.id, kind: 'dataset', target: `Dataset ${dest.datasetName}`, rowCount, written: totals.writtenByDest[dest.id] ?? 0 })
      } else if (dest.kind === 'api') {
        results.push({ id: dest.id, kind: 'datasource', target: destinationTarget(dest), written: totals.writtenByDest[dest.id] ?? 0 })
      } else {
        if (!error && !cancelled && dest.softDeleteMissing && !replay) {
          if (progress.capped) log(progress, 'warn', `${dest.table}: missing rows not marked deleted, the read stopped at the row cap`)
          else {
            const { seen } = await loadSeen(job.id, def!)
            const set = seen.get(destKeyField(dest.id))!
            const ds = await loadSource(scope.workspaceId, dest.dataSourceId)
            const marked = await softDeleteDataSourceMissing({ source: ds, table: dest.table, keys: dest.keys, column: dest.softDeleteColumn, isSeen: (k) => set.has(k) })
            if (marked) log(progress, 'info', `${dest.table}: ${marked.toLocaleString()} row(s) no longer in the source marked deleted`)
          }
        }
        results.push({ id: dest.id, kind: 'datasource', target: dest.table, written: totals.writtenByDest[dest.id] ?? 0 })
      }
    } catch (err) {
      error = `Finishing ${dest.kind === 'dataset' ? `dataset ${dest.datasetName}` : destinationTarget(dest)} failed: ${errorInfo(err).message}`
      progress.errorStack = errorInfo(err).stack
    }
  }

  // Several sources: what each Join did, and the run's staging is dropped (kept only while the run can still resume).
  for (const st of totals.steps) {
    if (st.type === 'enrich' && st.rowsIn) log(progress, 'info', `${st.label}: ${(st.cached ?? 0).toLocaleString('en-US')} of ${st.rowsIn.toLocaleString('en-US')} from cache · ${(st.calls ?? 0).toLocaleString('en-US')} calls${st.multiplied ? `; rows multiplied: ${st.multiplied.toLocaleString('en-US')}` : ''}`)
    if (st.type === 'apicall' && st.rowsIn) log(progress, 'info', `${st.label}: ${(st.calls ?? 0).toLocaleString('en-US')} calls changed data; ${(st.rowsIn - (st.calls ?? 0) - st.rejected).toLocaleString('en-US')} rows already up to date`)
    if (st.type !== 'join' || !st.rowsIn) continue
    log(progress, 'info', `${st.label}: ${(st.matched ?? 0).toLocaleString('en-US')} of ${st.rowsIn.toLocaleString('en-US')} rows matched${st.multiplied ? `; rows multiplied: ${st.multiplied.toLocaleString('en-US')}` : ''}${st.rejected ? `; ${st.rejected.toLocaleString('en-US')} without a partner quarantined` : ''}`)
  }
  await dropStageTables(job.id).catch((err) => console.error(`[jobs] ${job.id}: dropping staging failed:`, errorInfo(err).message))

  const status: EngineResult['status'] = error ? 'failed' : totalsStatus(totals)
  const runStatus = cancelled ? 'cancelled' : status
  if (error && !progress.attempts.some((a) => a.error === error)) progress.attempts.push({ attempt: progress.attempts.length + 1, error, at: new Date().toISOString() })
  if (!progress.attempts.length) progress.attempts.push({ attempt: 1, at: new Date().toISOString() })
  log(progress, error ? 'error' : 'info', cancelled ? 'Cancelled' : error ? `Failed: ${error}` : `Finished: ${totals.rowsWritten.toLocaleString()} of ${totals.rowsRead.toLocaleString()} rows written`)
  const result: EngineResult = {
    status,
    steps: totals.steps,
    rejects: [],
    rejectedCount: totals.rejectedCount,
    flaggedCount: totals.flaggedCount,
    heldCount: totals.heldCount,
    rowsRead: totals.rowsRead,
    rowsWritten: totals.rowsWritten,
    columns: totals.columns,
    error,
    destination: results[0],
    destinations: results,
    watermark: totals.watermark,
  }

  const endTime = new Date()
  const startTime = progress.startedAt ? new Date(progress.startedAt) : job.createdAt
  await db
    .update(executionLogs)
    .set({
      status: runStatus,
      recordsProcessed: totals.rowsRead,
      recordsSuccess: totals.rowsWritten,
      recordsError: totals.rejectedCount + totals.heldCount,
      errorMessage: cancelled ? 'Cancelled by a user.' : (error ?? null),
      endTime,
      duration: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
      executionDetails: {
        steps: totals.steps,
        destination: results[0],
        destinations: results,
        columns: totals.columns,
        attempts: progress.attempts,
        watermark: totals.watermark,
        watermarks: totals.watermarks,
        stagedRows: totals.stagedRows,
        chunks: progress.chunks,
        flagged: totals.flaggedCount,
        held: totals.heldCount,
        log: progress.log ?? [],
        errorStack: error ? progress.errorStack : undefined,
      },
      updatedAt: endTime,
    })
    .where(eq(executionLogs.id, job.id))

  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, job.pipelineId)).limit(1)
  if (pipeline) {
    // Advance the incremental watermarks only after the whole run succeeded (a replay reads no source).
    let state = pipeline.state as PipelineState | null
    if (def && !cancelled && !replay && status !== 'failed') {
      const driver = lanePlan(def).driver
      for (const n of def.nodes) {
        if (n.type !== 'source' || n.mode !== 'incremental') continue
        // Runs queued before several sources kept only the driver's watermark.
        const wm = totals.watermarks?.[n.id] ?? (n.id === driver ? totals.watermark : undefined)
        if (!wm?.value) continue
        const entry = { column: wm.column, value: wm.value, sourceKey: watermarkKey(n) }
        state = { ...(state ?? {}), watermarks: { ...(state?.watermarks ?? {}), [n.id]: entry } }
        if (n.id === driver) state.watermark = entry
      }
    }
    const schedule = scheduleSchema.safeParse(pipeline.schedule ?? {})
    await db
      .update(pipelines)
      .set({
        lastRunAt: endTime,
        // A cancelled run doesn't change the pipeline's health.
        lastRunStatus: cancelled ? pipeline.lastRunStatus : status,
        status: pipeline.status === 'draft' ? 'active' : pipeline.status,
        // A schedule that came due during a long run fires at its next slot instead of immediately.
        nextRunAt: pipeline.enabled && schedule.success ? nextRunAt(schedule.data) : null,
        state,
        updatedAt: endTime,
      })
      .where(eq(pipelines.id, job.pipelineId))
  }

  await db.delete(pipelineJobSeen).where(eq(pipelineJobSeen.jobId, job.id))
  await db.delete(pipelineJobPairs).where(eq(pipelineJobPairs.jobId, job.id))
  await db.update(pipelineJobs).set({ status: 'done', leaseUntil: null, progress, updatedAt: endTime }).where(eq(pipelineJobs.id, job.id))

  await recordAudit({ userId: scope.actorId, workspaceId: scope.workspaceId }, {
    action: 'RUN',
    resource: 'pipeline',
    resourceId: job.pipelineId,
    changes: { runId: job.id, trigger: job.trigger, status: runStatus, attempts: progress.attempts.length, chunks: progress.chunks, rowsRead: totals.rowsRead, rowsWritten: totals.rowsWritten, rejected: totals.rejectedCount, flagged: totals.flaggedCount, held: totals.heldCount },
  })
  if (cancelled) return runStatus
  if (def && status !== 'failed' && !replay && !progress.capped) await supersedeOlderQuarantine(def, job, scope)
  if (def && status !== 'failed') await ruleSideEffects(def, totals, scope, pipeline?.name ?? 'Pipeline', job)
  await runDependents(scope, job.pipelineId, status)
  if (def && status !== 'failed') await snapshotQuality(scope, def, totals, results)
  await emitRunEvents(scope.workspaceId, job, runStatus, totals, results, error)
  const message = summarize(result)
  await alertIfNeeded({ def, pipelineName: pipeline?.name ?? 'Pipeline', pipelineId: job.pipelineId, scope, runId: job.id, trigger: job.trigger, result, attempts: progress.attempts.length, message })
  return runStatus
}

/**
 * A finished full read re-checked every source row, so its quarantine replaces
 * the older runs' (TD-24): replaying an old copy as well as the new one would
 * write the same row twice. A steward's fix or approval on an old row carries
 * over to the identical row this run quarantined at the same step; the old rows
 * become "superseded". Incremental runs only see changed rows and keep the rest.
 */
async function supersedeOlderQuarantine(def: PipelineDefinition, job: Job, scope: RunScope) {
  if (def.nodes.some((n) => n.type === 'source' && n.mode !== 'full')) return
  try {
    await pool.query(
      `UPDATE pipeline_run_rejects n
          SET "fixedRow" = o."fixedRow", status = o.status, "updatedBy" = o."updatedBy", "updatedAt" = now()
         FROM pipeline_run_rejects o
        WHERE n."runId" = $1 AND n."workspaceId" = $2 AND n.status = 'open'
          AND o."workspaceId" = $2 AND o."pipelineId" = $3 AND o."runId" <> $1
          AND o.status IN ('fixed', 'approved') AND o.kind = n.kind
          AND o."nodeId" IS NOT DISTINCT FROM n."nodeId" AND o."row" = n."row"`,
      [job.id, scope.workspaceId, job.pipelineId]
    )
    const res = await pool.query(
      `UPDATE pipeline_run_rejects SET status = 'superseded', "updatedAt" = now()
        WHERE "workspaceId" = $1 AND "pipelineId" = $2 AND "runId" <> $3 AND status IN ('open', 'fixed', 'approved')`,
      [scope.workspaceId, job.pipelineId, job.id]
    )
    if (res.rowCount) console.info(`[jobs] run ${job.id}: ${res.rowCount} older quarantined row(s) superseded`)
  } catch (err) {
    // Housekeeping: never fails the run.
    console.error('[jobs] superseding older quarantine failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Pipeline chaining (SC-5): published, enabled pipelines scheduled "after"
 * this one run when it finishes with an outcome they accept. Catalog caches
 * that refresh after a pipeline use the same schedule type.
 */
async function runDependents(scope: RunScope, pipelineId: string, status: EngineResult['status']) {
  try {
    const dependents = await db
      .select({ id: pipelines.id, userId: pipelines.userId, schedule: pipelines.schedule, version: pipelines.version })
      .from(pipelines)
      .where(and(eq(pipelines.workspaceId, scope.workspaceId), eq(pipelines.enabled, true), sql`${pipelines.schedule}->>'type' = 'after'`, sql`${pipelines.schedule}->>'afterPipelineId' = ${pipelineId}`))
    for (const d of dependents) {
      const schedule = scheduleSchema.safeParse(d.schedule ?? {})
      if (!schedule.success || !d.version || d.id === pipelineId) continue
      const on = schedule.data.afterOn
      const ok = on === 'any' || status === 'success' || (on === 'success_or_partial' && status === 'partial')
      if (ok) await enqueueRun(d.id, { workspaceId: scope.workspaceId, actorId: d.userId }, 'chain')
    }
  } catch (err) {
    // Chained runs must never fail a finished run.
    console.error('[jobs] chained runs failed to queue:', errorInfo(err).message)
  }
}

/** Daily quality snapshot of each dataset the run wrote (DQ-4). */
async function snapshotQuality(scope: RunScope, def: PipelineDefinition, totals: RunTotals, results: DestinationResult[]) {
  const validity = totals.rowsRead ? Math.max(0, Math.round(((totals.rowsRead - totals.rejectedCount - totals.heldCount - totals.flaggedCount) / totals.rowsRead) * 1000) / 10) : null
  for (const dest of def.nodes) {
    if (dest.type !== 'destination' || dest.kind !== 'dataset' || !results.some((r) => r.id === dest.id)) continue
    const tableName = await datasetTable(scope.workspaceId, dest.datasetName).catch(() => null)
    if (!tableName) continue
    // A defined dataset is measured against its schema: every column it owns, its keys.
    const defined = await loadSchema(scope.workspaceId, dest.datasetName).catch(() => null)
    const columns = defined ? exposedColumns(defined.schema).map((c) => c.name) : (totals.columnsByDest[dest.id] ?? []).map((c) => c.name)
    const keys = defined?.schema.keys.length ? defined.schema.keys : dest.mode === 'upsert' ? dest.keys : []
    await takeQualitySnapshot({ workspaceId: scope.workspaceId, datasetName: dest.datasetName, tableName, columns, keys, validity })
  }
}

/** Outbound webhooks (API-5): run.succeeded / run.failed, and dataset.updated per dataset written. */
async function emitRunEvents(workspaceId: string, job: Job, runStatus: string, totals: RunTotals, results: DestinationResult[], error?: string) {
  const run = {
    id: job.id,
    pipeline_id: job.pipelineId,
    status: runStatus,
    trigger: job.trigger,
    rows_read: totals.rowsRead,
    rows_written: totals.rowsWritten,
    rows_quarantined: totals.rejectedCount + totals.heldCount,
    error: error ?? null,
  }
  await emitEvent(workspaceId, runStatus === 'failed' ? 'run.failed' : 'run.succeeded', { run })
  if (runStatus === 'failed') return
  for (const r of results) {
    if (r.kind !== 'dataset') continue
    await emitEvent(workspaceId, 'dataset.updated', { dataset: r.target.replace(/^Dataset /, ''), row_count: r.rowCount ?? null, rows_written: r.written ?? 0, run_id: job.id, pipeline_id: job.pipelineId })
  }
}

/** Business rule "notify" and "trigger pipeline" actions: once per run, for rules whose branch matched rows. */
async function ruleSideEffects(def: PipelineDefinition, totals: RunTotals, scope: RunScope, pipelineName: string, job: Job) {
  const hits = Object.entries(totals.ruleHits).filter(([, n]) => n > 0)
  if (!hits.length) return
  try {
    const rules = await loadRules(scope.workspaceId, [...new Set(hits.map(([k]) => k.split(':')[0]))])
    const triggered = new Set<string>()
    for (const [key, count] of hits) {
      const [ruleId, branch] = key.split(':')
      const rule = rules.get(ruleId)
      if (!rule) continue
      for (const a of branch === 'then' ? rule.then : rule.otherwise) {
        if (a.type === 'notify') {
          await notifyRule({ scope, pipelineId: job.pipelineId, runId: job.id, title: `${rule.name}: ${count.toLocaleString()} row${count === 1 ? '' : 's'} in ${pipelineName}`, message: a.message, emails: a.emails })
        } else if (a.type === 'trigger_pipeline' && !triggered.has(a.pipelineId) && a.pipelineId !== job.pipelineId) {
          triggered.add(a.pipelineId)
          const res = await enqueueRun(a.pipelineId, scope, 'manual').catch((err) => ({ status: 'error', message: errorInfo(err).message }))
          console.info(`[rules] ${rule.name} → pipeline ${a.pipelineId}: ${res.status}`)
        }
      }
    }
  } catch (err) {
    // Rule side effects must never fail a finished run.
    console.error('[rules] side effects failed:', errorInfo(err).message)
  }
}

/** Queued/running jobs of a workspace, for the Monitoring view. */
export async function activeJobs(workspaceId: string) {
  return db
    .select({
      id: pipelineJobs.id,
      pipelineId: pipelineJobs.pipelineId,
      status: pipelineJobs.status,
      trigger: pipelineJobs.trigger,
      attempts: pipelineJobs.attempts,
      availableAt: pipelineJobs.availableAt,
      leaseUntil: pipelineJobs.leaseUntil,
      createdAt: pipelineJobs.createdAt,
      updatedAt: pipelineJobs.updatedAt,
      rowsRead: sql<number>`coalesce((${pipelineJobs.progress}->'totals'->>'rowsRead')::int, 0)`,
      rowsWritten: sql<number>`coalesce((${pipelineJobs.progress}->'totals'->>'rowsWritten')::int, 0)`,
      chunks: sql<number>`coalesce((${pipelineJobs.progress}->>'chunks')::int, 0)`,
    })
    .from(pipelineJobs)
    .where(and(eq(pipelineJobs.workspaceId, workspaceId), inArray(pipelineJobs.status, ['queued', 'running', 'cancelling'])))
    .orderBy(pipelineJobs.createdAt)
}
