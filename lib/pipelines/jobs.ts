import { createHash } from 'node:crypto'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { executionLogs, pipelineJobSeen, pipelineJobs, pipelineRunRejects, pipelines } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { scheduleSchema, type PipelineDefinition, type SourceStep } from './definition'
import { checkDestination, newRunTotals, outputColumns, totalsStatus, transformChunk, type EngineResult, type Reject, type RunTotals } from './engine'
import { dropDatasetTable, finalizeDatasetReplace, readSourceChunk, stagingTableName, writeDataset, writeToDataSource, type ReadCache } from './io'
import { alertIfNeeded, currentWatermark, datasetTable, loadSource, parseDefinition, summarize, upsertDatasetRecord, watermarkKey, type PipelineState, type RunScope } from './runner'
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
const MAX_REJECTS_KEPT = 500
const DONE_JOB_RETENTION_DAYS = 30

type Attempt = { attempt: number; error?: string; at: string }

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
}

type Job = typeof pipelineJobs.$inferSelect

export type EnqueueOutcome = { runId: string; status: 'queued' | 'skipped'; message: string }

// ── Enqueue ──────────────────────────────────────────────────────────────────

/** Queues a run of the pipeline's published version. At most one active run per pipeline. */
export async function enqueueRun(pipelineId: string, scope: RunScope, trigger: 'manual' | 'schedule'): Promise<EnqueueOutcome> {
  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.workspaceId, scope.workspaceId)))
    .limit(1)
  if (!pipeline) throw new Error('Pipeline not found')

  let watermarkAfter: string | null = null
  try {
    watermarkAfter = currentWatermark(parseDefinition(pipeline.config), pipeline.state)
  } catch {
    // Invalid definition: the worker fails the run with the validation message.
  }
  const runId = newId('run')
  const progress: JobProgress = { config: pipeline.config, version: pipeline.version ?? 1, watermarkAfter, offset: 0, exhausted: false, chunks: 0, rejectsKept: 0, attempts: [] }

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

async function loadSeen(jobId: string, def: PipelineDefinition) {
  const fields = new Set(def.steps.flatMap((s) => (s.type === 'validate' ? s.rules.filter((r) => r.rule === 'unique').map((r) => r.field) : [])))
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

function errorInfo(err: unknown) {
  return { message: err instanceof Error ? err.message : String(err), retryable: (err as { retryable?: boolean } | null)?.retryable !== false }
}

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

  const source = def.steps[0] as SourceStep
  const dest = def.steps[def.steps.length - 1]
  if (dest.type !== 'destination') return finishJob(job, progress, def, { error: 'The last step must be a destination.' })

  if (!progress.startedAt) {
    progress.startedAt = new Date().toISOString()
    await db.update(executionLogs).set({ status: 'running', startTime: new Date(progress.startedAt), updatedAt: new Date() }).where(eq(executionLogs.id, job.id))
  }
  const totals = progress.totals ?? newRunTotals(def)
  progress.totals = totals

  try {
    const sourceDs = await loadSource(scope.workspaceId, source.dataSourceId)
    const destTable = dest.kind === 'dataset' ? await datasetTable(scope.workspaceId, dest.datasetName) : null
    const destDs = dest.kind === 'datasource' ? await loadSource(scope.workspaceId, dest.dataSourceId) : null
    const staging = dest.kind === 'dataset' && dest.mode === 'replace' ? stagingTableName(destTable!, job.id) : null
    // A replace run that starts over (offset 0) discards what an earlier attempt staged.
    if (staging && progress.offset === 0) await dropDatasetTable(staging)

    const { seen, sets } = await loadSeen(job.id, def)
    const cache: ReadCache = new Map()
    const watermark = source.mode === 'incremental' ? { column: source.watermarkColumn, after: progress.watermarkAfter } : undefined

    let sliceChunks = 0
    while (!progress.exhausted) {
      // Every slice makes progress (one chunk at least), then stops near the deadline.
      if (await isCancelling(job.id)) return finishJob(job, progress, def, { cancelled: true })
      if (sliceChunks >= maxChunks || (sliceChunks > 0 && Date.now() > deadline - CHUNK_HEADROOM_MS)) {
        // Out of time: release the job; the next tick (or page poll) resumes it. Never overwrite a cancel request.
        const released = await db
          .update(pipelineJobs)
          .set({ status: 'queued', leaseUntil: null, availableAt: new Date(), progress, updatedAt: new Date() })
          .where(and(eq(pipelineJobs.id, job.id), eq(pipelineJobs.status, 'running')))
          .returning({ id: pipelineJobs.id })
        return released.length ? 'paused' : finishJob(job, progress, def, { cancelled: true })
      }
      const started = Date.now()
      const read = await readSourceChunk(sourceDs, source.table, { offset: progress.offset, limit: CHUNK_ROWS, maxRows: source.maxRows, watermark, cache })
      const readMs = Date.now() - started
      const out = transformChunk(def, read.rows, totals, seen, read.types)
      totals.steps[0].durationMs += readMs
      const destStat = totals.steps[totals.steps.length - 1]

      if (out.rows.length) {
        checkDestination(def, totals.columns)
        const writeStarted = Date.now()
        if (dest.kind === 'dataset') {
          const res = await writeDataset({
            workspaceId: scope.workspaceId,
            existingTableName: staging ?? destTable!,
            datasetName: dest.datasetName,
            mode: staging ? 'append' : dest.mode,
            keys: dest.keys,
            columns: totals.columns,
            rows: out.rows,
          })
          totals.rowsWritten += res.written
          destStat.rowsOut += res.written
          progress.destination = { kind: 'dataset', target: `Dataset ${dest.datasetName}`, rowCount: staging ? undefined : res.rowCount }
        } else {
          const res = await writeToDataSource({ source: destDs!, table: dest.table, mode: dest.mode, keys: dest.keys, columns: totals.columns, rows: out.rows })
          totals.rowsWritten += res.written
          destStat.rowsOut += res.written
          progress.destination = { kind: 'datasource', target: `${destDs!.name} · ${dest.table}` }
        }
        destStat.durationMs += Date.now() - writeStarted
      }

      progress.offset += read.rows.length
      progress.exhausted = read.exhausted
      progress.chunks++
      sliceChunks++
      await checkpoint(job, progress, scope, out.rejects, sets, Date.now() - started)
    }
  } catch (err) {
    const info = errorInfo(err)
    progress.attempts.push({ attempt: progress.attempts.length + 1, error: info.message, at: new Date().toISOString() })
    const failures = job.attempts + 1
    if (await isCancelling(job.id)) return finishJob(job, progress, def, { cancelled: true })
    if (info.retryable && failures <= def.settings.retries) {
      const delaySec = Math.min(300, def.settings.retryDelaySeconds * 2 ** (failures - 1))
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

/** Persists one chunk's outcome atomically: rejects, new "unique" hashes, counters and the cursor. */
async function checkpoint(job: Job, progress: JobProgress, scope: RunScope, rejects: Reject[], sets: [string, HashedSet][], chunkMs: number) {
  const keep = rejects.slice(0, Math.max(0, MAX_REJECTS_KEPT - progress.rejectsKept))
  progress.rejectsKept += keep.length
  const totals = progress.totals!
  await db.transaction(async (tx) => {
    if (keep.length) {
      await tx.insert(pipelineRunRejects).values(
        keep.map((r) => ({
          id: newId('rej'),
          runId: job.id,
          pipelineId: job.pipelineId,
          userId: scope.actorId,
          workspaceId: scope.workspaceId,
          row: JSON.parse(JSON.stringify(r.row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
          errors: { stepId: r.stepId, messages: r.errors },
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
    await tx
      .update(pipelineJobs)
      .set({ progress, leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
      .where(eq(pipelineJobs.id, job.id))
    await tx
      .update(executionLogs)
      .set({ recordsProcessed: totals.rowsRead, recordsSuccess: totals.rowsWritten, recordsError: totals.rejectedCount, updatedAt: new Date() })
      .where(eq(executionLogs.id, job.id))
  })
  for (const [, set] of sets) set.added = []
  if (chunkMs > 60_000) console.warn(`[jobs] ${job.id}: chunk took ${Math.round(chunkMs / 1000)}s`)
}

/** Completes a run: dataset swap/record, run log, pipeline state, audit, alerts. */
async function finishJob(job: Job, progress: JobProgress, def: PipelineDefinition | null, outcome: { error?: string; cancelled?: boolean }): Promise<string> {
  const cancelled = Boolean(outcome.cancelled)
  const scope: RunScope = { workspaceId: job.workspaceId, actorId: job.actorId }
  const totals = progress.totals ?? (def ? newRunTotals(def) : { steps: [], rowsRead: 0, rowsWritten: 0, rejectedCount: 0, columns: [] })
  let error = outcome.error
  const dest = def?.steps[def.steps.length - 1]

  if (!error && !cancelled && dest?.type === 'destination' && dest.kind === 'dataset') {
    try {
      const tableName = await datasetTable(scope.workspaceId, dest.datasetName)
      const columns = totals.columns.length ? totals.columns : outputColumns(def!, [])
      if (dest.mode === 'replace') {
        const staging = stagingTableName(tableName, job.id)
        // No rows at all: still create the (empty) dataset with the declared columns.
        if (!totals.rowsWritten && columns.length) {
          await writeDataset({ workspaceId: scope.workspaceId, existingTableName: staging, datasetName: dest.datasetName, mode: 'append', keys: [], columns, rows: [] })
        }
        const rowCount = await finalizeDatasetReplace(tableName, staging)
        progress.destination = { kind: 'dataset', target: `Dataset ${dest.datasetName}`, rowCount }
      } else if (!totals.rowsWritten && columns.length) {
        const res = await writeDataset({ workspaceId: scope.workspaceId, existingTableName: tableName, datasetName: dest.datasetName, mode: dest.mode, keys: dest.keys, columns, rows: [] })
        progress.destination = { kind: 'dataset', target: `Dataset ${dest.datasetName}`, rowCount: res.rowCount }
      }
      if (columns.length) await upsertDatasetRecord(scope, job.pipelineId, dest.datasetName, tableName, columns, progress.destination?.rowCount ?? 0)
    } catch (err) {
      error = `Finishing the dataset failed: ${errorInfo(err).message}`
    }
  }
  if ((error || cancelled) && dest?.type === 'destination' && dest.kind === 'dataset' && dest.mode === 'replace') {
    // Leave the live dataset untouched; drop what this run staged.
    await dropDatasetTable(stagingTableName(await datasetTable(scope.workspaceId, dest.datasetName), job.id)).catch(() => undefined)
  }

  const status: EngineResult['status'] = error ? 'failed' : totalsStatus(totals)
  const runStatus = cancelled ? 'cancelled' : status
  if (error && !progress.attempts.some((a) => a.error === error)) progress.attempts.push({ attempt: progress.attempts.length + 1, error, at: new Date().toISOString() })
  if (!progress.attempts.length) progress.attempts.push({ attempt: 1, at: new Date().toISOString() })
  const result: EngineResult = {
    status,
    steps: totals.steps,
    rejects: [],
    rejectedCount: totals.rejectedCount,
    rowsRead: totals.rowsRead,
    rowsWritten: totals.rowsWritten,
    columns: totals.columns,
    error,
    destination: progress.destination,
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
      recordsError: totals.rejectedCount,
      errorMessage: cancelled ? 'Cancelled by a user.' : (error ?? null),
      endTime,
      duration: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
      executionDetails: { steps: totals.steps, destination: progress.destination, columns: totals.columns, attempts: progress.attempts, watermark: totals.watermark, chunks: progress.chunks },
      updatedAt: endTime,
    })
    .where(eq(executionLogs.id, job.id))

  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, job.pipelineId)).limit(1)
  if (pipeline) {
    // Advance the incremental watermark only after the whole run succeeded.
    let state = pipeline.state as PipelineState | null
    const source = def?.steps[0]
    if (!cancelled && status !== 'failed' && totals.watermark?.value && source?.type === 'source' && source.mode === 'incremental') {
      state = { ...(state ?? {}), watermark: { column: totals.watermark.column, value: totals.watermark.value, sourceKey: watermarkKey(source) } }
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
  await db.update(pipelineJobs).set({ status: 'done', leaseUntil: null, progress, updatedAt: endTime }).where(eq(pipelineJobs.id, job.id))

  await recordAudit({ userId: scope.actorId, workspaceId: scope.workspaceId }, {
    action: 'RUN',
    resource: 'pipeline',
    resourceId: job.pipelineId,
    changes: { runId: job.id, trigger: job.trigger, status: runStatus, attempts: progress.attempts.length, chunks: progress.chunks, rowsRead: totals.rowsRead, rowsWritten: totals.rowsWritten, rejected: totals.rejectedCount },
  })
  if (cancelled) return runStatus
  const message = summarize(result)
  await alertIfNeeded({ def, pipelineName: pipeline?.name ?? 'Pipeline', pipelineId: job.pipelineId, scope, runId: job.id, trigger: job.trigger, result, attempts: progress.attempts.length, message })
  return runStatus
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
