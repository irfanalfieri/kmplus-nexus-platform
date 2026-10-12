'use server'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { headers } from 'next/headers'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit, type AuditAction } from '@/lib/audit'
import { db } from '@/lib/db'
import { businessRules, dataSources, executionLogs, mappingTemplates, nexusDatasets, pipelineApprovals, pipelineRunRejects, pipelineVersions, pipelines } from '@/lib/db/schema'
import { definitionSchema, scheduleSchema, type MapStep } from '@/lib/pipelines/definition'
import { currentWatermark, testRunDefinition } from '@/lib/pipelines/runner'
import { assertPipelinesEditable, computeNextRun, getOwnedPipeline, publishOrRequest, savePipelineAs, type saveInput } from '@/lib/pipelines/publish'
import { cancelRun, enqueueRun } from '@/lib/pipelines/jobs'
import { nudgeWorker, startWorker } from '@/lib/pipelines/worker'
import { readDatasetSample } from '@/lib/pipelines/io'
import { applyMasks, accessFor } from '@/lib/governance/masking'
import type { SchemaScanResult } from '@/lib/connectors/types'
import { guard } from '@/lib/server-action'

const idSchema = z.string().trim().min(1).max(100)

async function audit(ctx: WorkspaceContext, action: AuditAction, resourceId: string, changes?: Record<string, unknown>, resource = 'pipeline', diff?: Record<string, unknown>) {
  await recordAudit(ctx, { action, resource, resourceId, changes, diff })
}

const getOwned = getOwnedPipeline

const scope = (ctx: WorkspaceContext) => ({ workspaceId: ctx.workspaceId, actorId: ctx.userId })

// ── Queries ──────────────────────────────────────────────────────────────────

async function listPipelinesImpl() {
  const ctx = await requireWorkspace()
  // Versions waiting for a second person (GV-6).
  const [approvals, heldRows, lastRuns] = await Promise.all([
    db.select({ pipelineId: pipelineApprovals.pipelineId, id: pipelineApprovals.id, version: pipelineApprovals.version, kind: pipelineApprovals.kind }).from(pipelineApprovals).where(and(eq(pipelineApprovals.workspaceId, ctx.workspaceId), eq(pipelineApprovals.status, 'pending'))),
    // Rows held back in the quarantine, per pipeline (counts only). Flags were written, so they don't count.
    db
      .select({ pipelineId: pipelineRunRejects.pipelineId, n: sql<number>`count(*)::int` })
      .from(pipelineRunRejects)
      .where(and(eq(pipelineRunRejects.workspaceId, ctx.workspaceId), eq(pipelineRunRejects.status, 'open'), inArray(pipelineRunRejects.kind, ['invalid', 'approval'])))
      .groupBy(pipelineRunRejects.pipelineId),
    // The latest finished run of each pipeline: rows read / written / rejected and how long it took.
    db
      .selectDistinctOn([executionLogs.pipelineId], {
        pipelineId: executionLogs.pipelineId,
        read: executionLogs.recordsProcessed,
        written: executionLogs.recordsSuccess,
        rejected: executionLogs.recordsError,
        duration: executionLogs.duration,
      })
      .from(executionLogs)
      .where(and(eq(executionLogs.workspaceId, ctx.workspaceId), inArray(executionLogs.status, ['success', 'partial', 'failed'])))
      .orderBy(executionLogs.pipelineId, desc(executionLogs.createdAt)),
  ])
  const pending = new Map(approvals.map((a) => [a.pipelineId, a]))
  const held = new Map(heldRows.map((h) => [h.pipelineId, h.n]))
  const last = new Map(lastRuns.map(({ pipelineId, ...r }) => [pipelineId, r]))
  return db
    .select({
      id: pipelines.id,
      name: pipelines.name,
      description: pipelines.description,
      status: pipelines.status,
      enabled: pipelines.enabled,
      version: pipelines.version,
      config: pipelines.config,
      draftConfig: pipelines.draftConfig,
      draftVersion: pipelines.draftVersion,
      schedule: pipelines.schedule,
      lastRunAt: pipelines.lastRunAt,
      lastRunStatus: pipelines.lastRunStatus,
      nextRunAt: pipelines.nextRunAt,
      state: pipelines.state,
      updatedAt: pipelines.updatedAt,
      webhookTrigger: sql<boolean>`${pipelines.triggerTokenHash} IS NOT NULL`,
    })
    .from(pipelines)
    .where(eq(pipelines.workspaceId, ctx.workspaceId))
    .orderBy(desc(pipelines.updatedAt))
    .then((rows) =>
      rows.map(({ state, ...row }) => {
        const def = definitionSchema.safeParse(row.config)
        const approval = pending.get(row.id)
        return {
          ...row,
          syncPosition: def.success ? currentWatermark(def.data, state) : null,
          pendingApproval: approval ? { id: approval.id, version: approval.version, kind: approval.kind } : null,
          heldRows: held.get(row.id) ?? 0,
          lastRun: last.get(row.id) ?? null,
        }
      })
    )
}

/** Everything the builder needs to populate pickers (no credentials). */
async function getBuilderOptionsImpl() {
  const ctx = await requireWorkspace()
  const [sources, datasets, rules, pipelineRows, templates] = await Promise.all([
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
    db
      .select({ id: businessRules.id, name: businessRules.name, description: businessRules.description, body: businessRules.body })
      .from(businessRules)
      .where(eq(businessRules.workspaceId, ctx.workspaceId))
      .orderBy(businessRules.name),
    db.select({ id: pipelines.id, name: pipelines.name, version: pipelines.version }).from(pipelines).where(eq(pipelines.workspaceId, ctx.workspaceId)).orderBy(pipelines.name),
    db.select().from(mappingTemplates).where(eq(mappingTemplates.workspaceId, ctx.workspaceId)).orderBy(mappingTemplates.name),
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
    pipelines: pipelineRows.map((p) => ({ id: p.id, name: p.name, published: (p.version ?? 0) > 0 })),
    mappingTemplates: templates.map((m) => ({ id: m.id, name: m.name, description: m.description ?? '', fields: m.fields as MapStep['fields'], keepUnmapped: m.keepUnmapped })),
    rules: rules.map((r) => {
      const body = (r.body ?? {}) as { then?: { type: string; field?: string }[]; otherwise?: { type: string; field?: string }[] }
      // Fields the rule writes (set_field / calculate), so the editor knows the columns after a rules step.
      const outputs = [...(body.then ?? []), ...(body.otherwise ?? [])].filter((a) => (a.type === 'set_field' || a.type === 'calculate') && a.field).map((a) => a.field as string)
      return { id: r.id, name: r.name, description: r.description ?? '', outputs: [...new Set(outputs)] }
    }),
  }
}

async function listRunsImpl(rawPipelineId: string, limit = 20) {
  const ctx = await requireWorkspace()
  const pipelineId = idSchema.parse(rawPipelineId)
  await getOwned(ctx, pipelineId)
  const runs = await db
    .select()
    .from(executionLogs)
    .where(and(eq(executionLogs.pipelineId, pipelineId), eq(executionLogs.workspaceId, ctx.workspaceId)))
    .orderBy(desc(executionLogs.createdAt))
    .limit(Math.min(limit, 100))
  // Stack traces are for admins only (MN-3).
  if (ctx.role === 'admin') return runs
  return runs.map((r) => {
    const details = (r.executionDetails ?? {}) as Record<string, unknown>
    if (!details.errorStack) return r
    const { errorStack: _hidden, ...rest } = details
    return { ...r, executionDetails: rest }
  })
}

/** Rejected rows contain source data, so they need data:preview. */
async function getRunRejectsImpl(rawRunId: string, limit = 100) {
  const ctx = await requireWorkspace('data:preview')
  const runId = idSchema.parse(rawRunId)
  return db
    .select({ id: pipelineRunRejects.id, row: pipelineRunRejects.row, errors: pipelineRunRejects.errors, severity: pipelineRunRejects.severity, kind: pipelineRunRejects.kind, status: pipelineRunRejects.status })
    .from(pipelineRunRejects)
    .where(and(eq(pipelineRunRejects.runId, runId), eq(pipelineRunRejects.workspaceId, ctx.workspaceId)))
    .limit(Math.min(limit, 500))
    .then(async (rows) => {
      await audit(ctx, 'VIEW_DATA', runId, { what: 'rejected_rows', rows: rows.length }, 'run')
      return rows
    })
}

async function listVersionsImpl(rawPipelineId: string) {
  const ctx = await requireWorkspace()
  const pipelineId = idSchema.parse(rawPipelineId)
  await getOwned(ctx, pipelineId)
  return db
    .select({ version: pipelineVersions.version, changes: pipelineVersions.changes, createdAt: pipelineVersions.createdAt, publishedAt: pipelineVersions.publishedAt })
    .from(pipelineVersions)
    .where(and(eq(pipelineVersions.pipelineId, pipelineId), eq(pipelineVersions.workspaceId, ctx.workspaceId)))
    .orderBy(desc(pipelineVersions.version))
}

async function getDatasetPreviewImpl(rawName: string) {
  const ctx = await requireWorkspace('data:preview')
  const name = z.string().trim().min(1).max(64).parse(rawName)
  const [dataset] = await db
    .select()
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, name)))
    .limit(1)
  if (!dataset) throw new Error('Dataset not found')
  // Dataset policies: masked columns for roles without data:unmasked (GV-5).
  const { masks, rowFilters } = await accessFor(ctx.workspaceId, dataset.name, ctx.role)
  const masked = Object.keys(masks)
  await audit(ctx, 'VIEW_DATA', dataset.id, { what: 'dataset_preview', dataset: dataset.name, ...(masked.length ? { masked } : {}), ...(rowFilters.length ? { rowFilters: rowFilters.length } : {}) }, 'dataset')
  const rows = applyMasks(await readDatasetSample(dataset.tableName, 50, rowFilters, ((dataset.columns as { name: string }[]) ?? []).map((c) => c.name)), masks)
  return { name: dataset.name, rowCount: dataset.rowCount, lastLoadedAt: dataset.lastLoadedAt, rows, masked }
}

// ── Mutations ────────────────────────────────────────────────────────────────

async function savePipelineImpl(input: z.input<typeof saveInput>) {
  const ctx = await requireWorkspace('pipelines:edit')
  await assertPipelinesEditable(ctx)
  const result = await savePipelineAs(ctx, input)
  revalidatePath('/dashboard', 'layout')
  return result
}

/** Publishes the pipeline's draft (or a given version). */
async function publishPipelineImpl(rawId: string, rawVersion?: number) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = idSchema.parse(rawId)
  const existing = await getOwned(ctx, id)
  const version = rawVersion !== undefined ? z.number().int().min(1).parse(rawVersion) : existing.draftVersion
  if (!version) throw new Error('There is no draft to publish.')
  await assertPipelinesEditable(ctx)
  const outcome = await publishOrRequest(ctx, id, version)
  revalidatePath('/dashboard', 'layout')
  return { version, published: outcome.published, approvalId: outcome.approvalId ?? null }
}

/** Drops unpublished edits; the draft versions stay in history. */
async function discardDraftImpl(rawId: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = idSchema.parse(rawId)
  const existing = await getOwned(ctx, id)
  if (!existing.version) throw new Error('This pipeline was never published; delete it instead.')
  await assertPipelinesEditable(ctx)
  await db.update(pipelines).set({ draftConfig: null, draftVersion: null, updatedAt: new Date() }).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'UPDATE', id, { discardedDraft: existing.draftVersion })
  revalidatePath('/dashboard', 'layout')
}

/**
 * Inbound webhook trigger (SC-1): a secret URL that queues a run when called
 * (POST /api/hooks/pipelines/<id>/<token>). Only a SHA-256 hash of the token is
 * stored; the URL is shown once. Creating a new URL invalidates the old one.
 */
async function createWebhookTriggerImpl(rawId: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = idSchema.parse(rawId)
  await getOwned(ctx, id)
  const token = randomBytes(24).toString('base64url')
  await db.update(pipelines).set({ triggerTokenHash: createHash('sha256').update(token).digest('hex'), updatedAt: new Date() }).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'UPDATE', id, { webhookTrigger: 'created' })
  const h = await headers()
  const origin = process.env.BETTER_AUTH_URL ?? `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`
  revalidatePath('/dashboard', 'layout')
  return { url: `${origin.replace(/\/+$/, '')}/api/hooks/pipelines/${id}/${token}` }
}

async function disableWebhookTriggerImpl(rawId: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = idSchema.parse(rawId)
  await getOwned(ctx, id)
  await db.update(pipelines).set({ triggerTokenHash: null, updatedAt: new Date() }).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'UPDATE', id, { webhookTrigger: 'disabled' })
  revalidatePath('/dashboard', 'layout')
}

async function setPipelineEnabledImpl(rawId: string, rawEnabled: boolean) {
  const ctx = await requireWorkspace('pipelines:run')
  const id = idSchema.parse(rawId)
  const enabled = z.boolean().parse(rawEnabled)
  const existing = await getOwned(ctx, id)
  if (enabled && !existing.version) throw new Error('Publish the pipeline before turning its schedule on.')
  const schedule = scheduleSchema.parse(existing.schedule ?? {})
  await db
    .update(pipelines)
    .set({ enabled, nextRunAt: computeNextRun(enabled, schedule), updatedAt: new Date() })
    .where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  await audit(ctx, enabled ? 'ENABLE' : 'DISABLE', id)
  revalidatePath('/dashboard', 'layout')
}

async function deletePipelineImpl(rawId: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = idSchema.parse(rawId)
  await getOwned(ctx, id)
  await assertPipelinesEditable(ctx)
  const runIds = (await db.select({ id: executionLogs.id }).from(executionLogs).where(and(eq(executionLogs.pipelineId, id), eq(executionLogs.workspaceId, ctx.workspaceId)))).map((r) => r.id)
  if (runIds.length) await db.delete(pipelineRunRejects).where(and(inArray(pipelineRunRejects.runId, runIds), eq(pipelineRunRejects.workspaceId, ctx.workspaceId)))
  await db.delete(executionLogs).where(and(eq(executionLogs.pipelineId, id), eq(executionLogs.workspaceId, ctx.workspaceId)))
  await db.delete(pipelineVersions).where(and(eq(pipelineVersions.pipelineId, id), eq(pipelineVersions.workspaceId, ctx.workspaceId)))
  await db.delete(pipelineApprovals).where(and(eq(pipelineApprovals.pipelineId, id), eq(pipelineApprovals.workspaceId, ctx.workspaceId)))
  await db.delete(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  // Datasets produced by the pipeline are kept; they may be used elsewhere.
  await audit(ctx, 'DELETE', id)
  revalidatePath('/dashboard', 'layout')
}

/** Rollback (VC-4): an older version becomes a new version and is published; history is never rewritten. */
async function restoreVersionImpl(rawId: string, rawVersion: number) {
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
  await assertPipelinesEditable(ctx)
  const cfg = snapshot.config as { definition: unknown; schedule: unknown; name: string; description: string }
  const result = await savePipelineAs(ctx, {
    id,
    name: cfg.name ?? existing.name,
    description: cfg.description ?? '',
    definition: cfg.definition,
    schedule: scheduleSchema.parse(cfg.schedule ?? {}),
    enabled: existing.enabled ?? false,
    changeNote: `Restored v${version}`,
    publish: true,
  })
  revalidatePath('/dashboard', 'layout')
  return result
}

/** Queues a run and starts a background worker for it; returns immediately. */
async function runPipelineNowImpl(rawId: string) {
  const ctx = await requireWorkspace('pipelines:run')
  const id = idSchema.parse(rawId)
  const existing = await getOwned(ctx, id)
  if (!existing.version) throw new Error('Publish the pipeline before running it. Test runs work on the draft.')
  const outcome = await enqueueRun(id, scope(ctx), 'manual')
  if (outcome.status === 'queued') startWorker()
  revalidatePath('/dashboard', 'layout')
  return outcome
}

/** Cancels a queued or running run. Rows already written stay; a dataset "replace" keeps its previous data. */
async function cancelPipelineRunImpl(rawRunId: string) {
  const ctx = await requireWorkspace('pipelines:run')
  const runId = idSchema.parse(rawRunId)
  const result = await cancelRun(runId, ctx.workspaceId)
  if (result === 'not_active') throw new Error('This run has already finished.')
  await audit(ctx, 'CANCEL', runId, { result }, 'run')
  if (result === 'cancelling') await nudgeWorker(ctx.workspaceId)
  revalidatePath('/dashboard', 'layout')
  return {
    status: result,
    message: result === 'cancelled' ? 'Run cancelled.' : 'Cancelling: the run stops after the chunk it is writing now.',
  }
}

/** Runs a finished run's pipeline again (Monitoring → Retry). Uses the current published version. */
async function retryPipelineRunImpl(rawRunId: string) {
  const ctx = await requireWorkspace('pipelines:run')
  const runId = idSchema.parse(rawRunId)
  const [run] = await db
    .select({ pipelineId: executionLogs.pipelineId, status: executionLogs.status, trigger: executionLogs.trigger })
    .from(executionLogs)
    .where(and(eq(executionLogs.id, runId), eq(executionLogs.workspaceId, ctx.workspaceId)))
    .limit(1)
  if (!run) throw new Error('Run not found')
  if (run.status === 'queued' || run.status === 'running') throw new Error('This run is still in progress.')
  if (run.trigger === 'replay') throw new Error('This was a quarantine replay. Replay the rows again from Data Quality.')
  const outcome = await enqueueRun(run.pipelineId, scope(ctx), 'manual')
  if (outcome.status === 'queued') startWorker()
  await audit(ctx, 'RETRY', run.pipelineId, { previousRunId: runId, runId: outcome.runId })
  revalidatePath('/dashboard', 'layout')
  return outcome
}

/**
 * Status of a run for live progress. Also restarts the worker when a job is
 * waiting (paused between invocations, or due for a retry), so runs progress
 * even where no scheduler runs (development and preview).
 */
async function getRunStatusImpl(rawRunId: string) {
  const ctx = await requireWorkspace()
  const runId = idSchema.parse(rawRunId)
  const [run] = await db
    .select({ id: executionLogs.id, pipelineId: executionLogs.pipelineId, status: executionLogs.status, recordsProcessed: executionLogs.recordsProcessed, recordsSuccess: executionLogs.recordsSuccess, recordsError: executionLogs.recordsError, errorMessage: executionLogs.errorMessage, duration: executionLogs.duration })
    .from(executionLogs)
    .where(and(eq(executionLogs.id, runId), eq(executionLogs.workspaceId, ctx.workspaceId)))
    .limit(1)
  if (!run) throw new Error('Run not found')
  const active = run.status === 'queued' || run.status === 'running' || run.status === 'cancelling'
  if (active) await nudgeWorker(ctx.workspaceId)
  return { ...run, active }
}

/** Test run of an unsaved definition: real source data, nothing written. Uses the saved sync position when editing. */
async function testPipelineImpl(definition: unknown, rawPipelineId?: string) {
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
async function resetSyncPositionImpl(rawId: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = idSchema.parse(rawId)
  const existing = await getOwned(ctx, id)
  const state = { ...((existing.state as Record<string, unknown> | null) ?? {}) }
  delete state.watermark
  await db.update(pipelines).set({ state, updatedAt: new Date() }).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'RESET_SYNC', id)
  revalidatePath('/dashboard', 'layout')
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/pipelines.ts. ──

export async function listPipelines(...args: Parameters<typeof listPipelinesImpl>) {
  return guard(() => listPipelinesImpl(...args))
}

export async function getBuilderOptions(...args: Parameters<typeof getBuilderOptionsImpl>) {
  return guard(() => getBuilderOptionsImpl(...args))
}

export async function listRuns(...args: Parameters<typeof listRunsImpl>) {
  return guard(() => listRunsImpl(...args))
}

export async function getRunRejects(...args: Parameters<typeof getRunRejectsImpl>) {
  return guard(() => getRunRejectsImpl(...args))
}

export async function listVersions(...args: Parameters<typeof listVersionsImpl>) {
  return guard(() => listVersionsImpl(...args))
}

export async function getDatasetPreview(...args: Parameters<typeof getDatasetPreviewImpl>) {
  return guard(() => getDatasetPreviewImpl(...args))
}

export async function savePipeline(...args: Parameters<typeof savePipelineImpl>) {
  return guard(() => savePipelineImpl(...args))
}

export async function setPipelineEnabled(...args: Parameters<typeof setPipelineEnabledImpl>) {
  return guard(() => setPipelineEnabledImpl(...args))
}

export async function deletePipeline(...args: Parameters<typeof deletePipelineImpl>) {
  return guard(() => deletePipelineImpl(...args))
}

export async function restoreVersion(...args: Parameters<typeof restoreVersionImpl>) {
  return guard(() => restoreVersionImpl(...args))
}

export async function runPipelineNow(...args: Parameters<typeof runPipelineNowImpl>) {
  return guard(() => runPipelineNowImpl(...args))
}

export async function cancelPipelineRun(...args: Parameters<typeof cancelPipelineRunImpl>) {
  return guard(() => cancelPipelineRunImpl(...args))
}

export async function retryPipelineRun(...args: Parameters<typeof retryPipelineRunImpl>) {
  return guard(() => retryPipelineRunImpl(...args))
}

export async function getRunStatus(...args: Parameters<typeof getRunStatusImpl>) {
  return guard(() => getRunStatusImpl(...args))
}

export async function testPipeline(...args: Parameters<typeof testPipelineImpl>) {
  return guard(() => testPipelineImpl(...args))
}

export async function resetSyncPosition(...args: Parameters<typeof resetSyncPositionImpl>) {
  return guard(() => resetSyncPositionImpl(...args))
}

export async function publishPipeline(...args: Parameters<typeof publishPipelineImpl>) {
  return guard(() => publishPipelineImpl(...args))
}

export async function createWebhookTrigger(...args: Parameters<typeof createWebhookTriggerImpl>) {
  return guard(() => createWebhookTriggerImpl(...args))
}

export async function disableWebhookTrigger(...args: Parameters<typeof disableWebhookTriggerImpl>) {
  return guard(() => disableWebhookTriggerImpl(...args))
}

export async function discardDraft(...args: Parameters<typeof discardDraftImpl>) {
  return guard(() => discardDraftImpl(...args))
}
