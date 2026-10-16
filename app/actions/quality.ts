'use server'

import { z } from 'zod'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { dataSources, executionLogs, pipelineRunRejects, pipelines } from '@/lib/db/schema'
import { requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { definitionSchema, destinationTarget, stepTitle } from '@/lib/pipelines/definition'
import { REPLAY_MAX_ROWS, enqueueRun } from '@/lib/pipelines/jobs'
import { lanePlan, replayBlocked } from '@/lib/pipelines/lanes'
import { startWorker } from '@/lib/pipelines/worker'
import { applyMasks, masksFor } from '@/lib/governance/masking'
import type { Mask } from '@/lib/governance/definition'
import { guard } from '@/lib/server-action'

/**
 * Data Quality (PRD Layer 12): the quarantine inbox of rows that failed
 * validation, were held for approval or flagged, steward fixes (inline and
 * bulk), approvals and replays (DQ-3), and quality scores (DQ-5).
 */

/** superseded: a later full run of the pipeline quarantined the row again (TD-24); that newer copy is the one to fix. */
const STATUSES = ['open', 'fixed', 'approved', 'replayed', 'dismissed', 'superseded'] as const
const KINDS = ['invalid', 'approval', 'flag'] as const
const idsSchema = z.array(z.string().min(1).max(100)).min(1, 'Select rows first').max(REPLAY_MAX_ROWS)

/** destinations: where replayed rows end up, as people read them ("dataset employees", "KMS · employees"). */
type PipelineInfo = { name: string; steps: Map<string, string>; datasets: string[]; destinations: string[] }

async function pipelineInfo(workspaceId: string) {
  const [rows, sources] = await Promise.all([
    db.select({ id: pipelines.id, name: pipelines.name, config: pipelines.config }).from(pipelines).where(eq(pipelines.workspaceId, workspaceId)),
    db.select({ id: dataSources.id, name: dataSources.name }).from(dataSources).where(eq(dataSources.workspaceId, workspaceId)),
  ])
  const sourceName = new Map(sources.map((s) => [s.id, s.name]))
  const out = new Map<string, PipelineInfo>()
  for (const p of rows) {
    const def = definitionSchema.safeParse(p.config)
    const nodes = def.success ? def.data.nodes : []
    out.set(p.id, {
      name: p.name,
      steps: new Map(nodes.map((n) => [n.id, stepTitle(n)])),
      datasets: nodes.flatMap((n) => (n.type === 'destination' && n.kind === 'dataset' ? [n.datasetName] : [])),
      destinations: nodes.flatMap((n) =>
        n.type !== 'destination' ? [] : n.kind === 'dataset' ? [`dataset ${n.datasetName}`] : [`${sourceName.get(n.dataSourceId) ?? 'missing source'} · ${destinationTarget(n)}`]
      ),
    })
  }
  return out
}

/** Quarantined rows carry the same personal data as the datasets they were headed to: mask them like those datasets. */
async function masksForPipeline(ctx: WorkspaceContext, info: PipelineInfo | undefined): Promise<Record<string, Mask>> {
  if (!info || can(ctx.role, 'data:unmasked')) return {}
  const merged: Record<string, Mask> = {}
  for (const name of info.datasets) Object.assign(merged, await masksFor(ctx.workspaceId, name, ctx.role))
  return merged
}

const inboxInput = z.object({
  status: z.enum(STATUSES).default('open'),
  kind: z.enum(KINDS).optional(),
  pipelineId: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})

async function listQuarantineImpl(input: z.input<typeof inboxInput> = {}) {
  const ctx = await requireWorkspace('data:preview')
  const q = inboxInput.parse(input)
  const where = and(
    eq(pipelineRunRejects.workspaceId, ctx.workspaceId),
    eq(pipelineRunRejects.status, q.status),
    q.kind ? eq(pipelineRunRejects.kind, q.kind) : undefined,
    q.pipelineId ? eq(pipelineRunRejects.pipelineId, q.pipelineId) : undefined
  )
  const [rows, [{ total }], info] = await Promise.all([
    db.select().from(pipelineRunRejects).where(where).orderBy(desc(pipelineRunRejects.createdAt)).limit(q.limit).offset(q.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(pipelineRunRejects).where(where),
    pipelineInfo(ctx.workspaceId),
  ])
  const masksCache = new Map<string, Record<string, Mask>>()
  const out = []
  for (const r of rows) {
    const p = info.get(r.pipelineId)
    if (!masksCache.has(r.pipelineId)) masksCache.set(r.pipelineId, await masksForPipeline(ctx, p))
    const masks = masksCache.get(r.pipelineId)!
    const errors = r.errors as { messages?: string[] }
    out.push({
      id: r.id,
      runId: r.runId,
      pipelineId: r.pipelineId,
      pipelineName: p?.name ?? 'Deleted pipeline',
      destinations: p?.destinations ?? [],
      step: (r.nodeId && p?.steps.get(r.nodeId)) || 'Removed step',
      kind: r.kind,
      severity: r.severity,
      status: r.status,
      messages: errors.messages ?? [],
      row: applyMasks([r.row as Record<string, unknown>], masks)[0],
      fixedRow: r.fixedRow ? applyMasks([r.fixedRow as Record<string, unknown>], masks)[0] : null,
      /** Masked rows can't be edited: a fix would overwrite real values with masks. */
      editable: Object.keys(masks).length === 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      replayRunId: r.replayRunId,
    })
  }
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'quarantine', resourceId: q.pipelineId ?? 'all', changes: { status: q.status, rows: out.length } })
  return { rows: out, total }
}

/** Counts, top problems and per-pipeline quality scores (DQ-5). Numbers only, no row contents. */
async function getQualityOverviewImpl() {
  const ctx = await requireWorkspace()
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [counts, top, runs, info] = await Promise.all([
    db
      .select({ status: pipelineRunRejects.status, kind: pipelineRunRejects.kind, n: sql<number>`count(*)::int` })
      .from(pipelineRunRejects)
      .where(eq(pipelineRunRejects.workspaceId, ctx.workspaceId))
      .groupBy(pipelineRunRejects.status, pipelineRunRejects.kind),
    db
      .select({ pipelineId: pipelineRunRejects.pipelineId, message: sql<string>`${pipelineRunRejects.errors}->'messages'->>0`, n: sql<number>`count(*)::int` })
      .from(pipelineRunRejects)
      .where(and(eq(pipelineRunRejects.workspaceId, ctx.workspaceId), eq(pipelineRunRejects.status, 'open')))
      .groupBy(pipelineRunRejects.pipelineId, sql`${pipelineRunRejects.errors}->'messages'->>0`)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    db
      .select({
        pipelineId: executionLogs.pipelineId,
        runs: sql<number>`count(*)::int`,
        read: sql<number>`coalesce(sum(${executionLogs.recordsProcessed}), 0)::int`,
        written: sql<number>`coalesce(sum(${executionLogs.recordsSuccess}), 0)::int`,
        quarantined: sql<number>`coalesce(sum(${executionLogs.recordsError}), 0)::int`,
        flagged: sql<number>`coalesce(sum((${executionLogs.executionDetails}->>'flagged')::int), 0)::int`,
        failed: sql<number>`count(*) filter (where ${executionLogs.status} = 'failed')::int`,
      })
      .from(executionLogs)
      .where(and(eq(executionLogs.workspaceId, ctx.workspaceId), gte(executionLogs.createdAt, since), inArray(executionLogs.status, ['success', 'partial', 'failed'])))
      .groupBy(executionLogs.pipelineId),
    pipelineInfo(ctx.workspaceId),
  ])
  const open = (kind?: string) => counts.filter((c) => c.status === 'open' && (!kind || c.kind === kind)).reduce((n, c) => n + c.n, 0)
  return {
    open: { total: open(), invalid: open('invalid'), approval: open('approval'), flag: open('flag') },
    fixed: counts.filter((c) => c.status === 'fixed' || c.status === 'approved').reduce((n, c) => n + c.n, 0),
    replayed: counts.filter((c) => c.status === 'replayed').reduce((n, c) => n + c.n, 0),
    topProblems: top.map((t) => ({ ...t, pipelineName: info.get(t.pipelineId)?.name ?? 'Deleted pipeline' })),
    pipelines: runs
      .map((r) => ({
        ...r,
        name: info.get(r.pipelineId)?.name ?? 'Deleted pipeline',
        datasets: info.get(r.pipelineId)?.datasets ?? [],
        // Share of rows read that passed every check without being quarantined or flagged.
        score: r.read ? Math.max(0, Math.round(((r.read - r.quarantined - r.flagged) / r.read) * 1000) / 10) : null,
      }))
      .sort((a, b) => (a.score ?? 101) - (b.score ?? 101)),
  }
}

async function ownedRows(ctx: WorkspaceContext, ids: string[]) {
  const rows = await db.select().from(pipelineRunRejects).where(and(eq(pipelineRunRejects.workspaceId, ctx.workspaceId), inArray(pipelineRunRejects.id, ids)))
  if (rows.length !== new Set(ids).size) throw new Error('Some rows no longer exist. Refresh and try again.')
  return rows
}

async function assertUnmasked(ctx: WorkspaceContext) {
  if (!can(ctx.role, 'data:unmasked')) throw new Error('Your role sees masked values, so it cannot edit rows.')
}

const fixInput = z.object({ id: z.string().min(1).max(100), row: z.record(z.string(), z.unknown()) })

/** Saves a steward's corrected row (inline edit). The row is replayed later. */
async function fixRowImpl(input: z.input<typeof fixInput>) {
  const ctx = await requireWorkspace('quality:manage')
  await assertUnmasked(ctx)
  const data = fixInput.parse(input)
  const [row] = await ownedRows(ctx, [data.id])
  if (row.kind === 'flag') throw new Error('Flagged rows were already written; fix the source instead and acknowledge the flag.')
  if (row.status === 'superseded') throw new Error('A later run quarantined this row again. Fix the newer copy.')
  if (row.status === 'replayed' || row.status === 'dismissed') throw new Error(`This row was already ${row.status}.`)
  await db
    .update(pipelineRunRejects)
    .set({ fixedRow: data.row, status: 'fixed', updatedBy: ctx.userId, updatedAt: new Date() })
    .where(and(eq(pipelineRunRejects.id, data.id), eq(pipelineRunRejects.workspaceId, ctx.workspaceId)))
  const before = row.row as Record<string, unknown>
  const changed = Object.keys(data.row).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(data.row[k]))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'quarantine', resourceId: data.id, changes: { fields: changed } })
  revalidatePath('/dashboard', 'layout')
}

const bulkInput = z.object({ ids: idsSchema, field: z.string().trim().min(1).max(128), value: z.string().max(2000) })

/** Sets one field to the same value on many quarantined rows ("fill department with UNKNOWN"). */
async function bulkFixImpl(input: z.input<typeof bulkInput>) {
  const ctx = await requireWorkspace('quality:manage')
  await assertUnmasked(ctx)
  const data = bulkInput.parse(input)
  const rows = (await ownedRows(ctx, data.ids)).filter((r) => r.kind !== 'flag' && (r.status === 'open' || r.status === 'fixed'))
  const now = new Date()
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const next = { ...((r.fixedRow ?? r.row) as Record<string, unknown>), [data.field]: data.value === '' ? null : data.value }
      await tx.update(pipelineRunRejects).set({ fixedRow: next, status: 'fixed', updatedBy: ctx.userId, updatedAt: now }).where(eq(pipelineRunRejects.id, r.id))
    }
  })
  await recordAudit(ctx, { action: 'UPDATE', resource: 'quarantine', resourceId: 'bulk', changes: { rows: rows.length, field: data.field } })
  revalidatePath('/dashboard', 'layout')
  return { updated: rows.length }
}

/** Approves rows held by a "require approval" rule. Approved rows are written by the next replay. */
async function approveRowsImpl(rawIds: string[]) {
  const ctx = await requireWorkspace('quality:manage')
  const ids = idsSchema.parse(rawIds)
  const rows = (await ownedRows(ctx, ids)).filter((r) => r.kind === 'approval' && r.status === 'open')
  if (!rows.length) throw new Error('None of the selected rows are waiting for approval.')
  await db
    .update(pipelineRunRejects)
    .set({ status: 'approved', updatedBy: ctx.userId, updatedAt: new Date() })
    .where(and(eq(pipelineRunRejects.workspaceId, ctx.workspaceId), inArray(pipelineRunRejects.id, rows.map((r) => r.id))))
  await recordAudit(ctx, { action: 'APPROVE', resource: 'quarantine', resourceId: rows.length === 1 ? rows[0].id : 'bulk', changes: { rows: rows.length } })
  revalidatePath('/dashboard', 'layout')
  return { approved: rows.length }
}

/** Closes rows without writing them (bad data that should stay out), or acknowledges flags. */
async function dismissRowsImpl(rawIds: string[]) {
  const ctx = await requireWorkspace('quality:manage')
  const ids = idsSchema.parse(rawIds)
  const rows = (await ownedRows(ctx, ids)).filter((r) => r.status !== 'replayed' && r.status !== 'dismissed' && r.status !== 'superseded')
  await db
    .update(pipelineRunRejects)
    .set({ status: 'dismissed', updatedBy: ctx.userId, updatedAt: new Date() })
    .where(and(eq(pipelineRunRejects.workspaceId, ctx.workspaceId), inArray(pipelineRunRejects.id, rows.map((r) => r.id))))
  await recordAudit(ctx, { action: 'DISMISS', resource: 'quarantine', resourceId: rows.length === 1 ? rows[0].id : 'bulk', changes: { rows: rows.length } })
  revalidatePath('/dashboard', 'layout')
  return { dismissed: rows.length }
}

/** Undo for dismiss: dismissed rows go back to the inbox (fixed if they carry a fix, else open). */
async function restoreRowsImpl(rawIds: string[]) {
  const ctx = await requireWorkspace('quality:manage')
  const ids = idsSchema.parse(rawIds)
  const rows = (await ownedRows(ctx, ids)).filter((r) => r.status === 'dismissed')
  const now = new Date()
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.update(pipelineRunRejects).set({ status: r.fixedRow ? 'fixed' : 'open', updatedBy: ctx.userId, updatedAt: now }).where(eq(pipelineRunRejects.id, r.id))
    }
  })
  await recordAudit(ctx, { action: 'RESTORE', resource: 'quarantine', resourceId: rows.length === 1 ? rows[0].id : 'bulk', changes: { rows: rows.length } })
  revalidatePath('/dashboard', 'layout')
  return { restored: rows.length }
}

/**
 * Re-runs fixed and approved rows through their pipeline's published version,
 * starting at the step that held them (one background run per pipeline).
 * Rows that fail again are quarantined again by that run.
 */
async function replayRowsImpl(rawIds: string[]) {
  const ctx = await requireWorkspace('quality:manage')
  const ids = idsSchema.parse(rawIds)
  const rows = (await ownedRows(ctx, ids)).filter((r) => r.status === 'fixed' || r.status === 'approved')
  if (!rows.length) throw new Error('Replay needs fixed or approved rows. Fix or approve rows first.')
  const byPipeline = new Map<string, string[]>()
  for (const r of rows) byPipeline.set(r.pipelineId, [...(byPipeline.get(r.pipelineId) ?? []), r.id])
  const outcomes: { pipelineId: string; runId: string; status: string; message: string; rows: number }[] = []
  for (const [pipelineId, heldIds] of byPipeline) {
    let rejectIds = heldIds
    const [pipeline] = await db.select({ version: pipelines.version, config: pipelines.config }).from(pipelines).where(and(eq(pipelines.id, pipelineId), eq(pipelines.workspaceId, ctx.workspaceId))).limit(1)
    if (!pipeline) {
      outcomes.push({ pipelineId, runId: '', status: 'skipped', message: 'The pipeline was deleted.', rows: rejectIds.length })
      continue
    }
    if (!pipeline.version) {
      outcomes.push({ pipelineId, runId: '', status: 'skipped', message: 'The pipeline has no published version.', rows: rejectIds.length })
      continue
    }
    // Rows held before a Join's looked-up side or an Aggregate / Deduplicate step were used by a finished run: a new run brings them in.
    const def = definitionSchema.safeParse(pipeline.config)
    if (def.success) {
      const plan = lanePlan(def.data)
      const staged = rows.filter((r) => r.pipelineId === pipelineId && r.nodeId && replayBlocked(def.data, plan, r.nodeId)).map((r) => r.id)
      if (staged.length) {
        outcomes.push({ pipelineId, runId: '', status: 'skipped', message: "These rows were held before a Join's looked-up side or an Aggregate / Deduplicate step. Run the pipeline again to include them.", rows: staged.length })
        rejectIds = rejectIds.filter((id) => !staged.includes(id))
        if (!rejectIds.length) continue
      }
    }
    const outcome = await enqueueRun(pipelineId, { workspaceId: ctx.workspaceId, actorId: ctx.userId }, 'replay', { replayIds: rejectIds })
    outcomes.push({ pipelineId, ...outcome, rows: rejectIds.length })
    if (outcome.status === 'queued') await recordAudit(ctx, { action: 'REPLAY', resource: 'pipeline', resourceId: pipelineId, changes: { runId: outcome.runId, rows: rejectIds.length } })
  }
  if (outcomes.some((o) => o.status === 'queued')) startWorker()
  revalidatePath('/dashboard', 'layout')
  return outcomes
}

export async function listQuarantine(...args: Parameters<typeof listQuarantineImpl>) {
  return guard(() => listQuarantineImpl(...args))
}

export async function getQualityOverview(...args: Parameters<typeof getQualityOverviewImpl>) {
  return guard(() => getQualityOverviewImpl(...args))
}

export async function fixRow(...args: Parameters<typeof fixRowImpl>) {
  return guard(() => fixRowImpl(...args))
}

export async function bulkFix(...args: Parameters<typeof bulkFixImpl>) {
  return guard(() => bulkFixImpl(...args))
}

export async function approveRows(...args: Parameters<typeof approveRowsImpl>) {
  return guard(() => approveRowsImpl(...args))
}

export async function dismissRows(...args: Parameters<typeof dismissRowsImpl>) {
  return guard(() => dismissRowsImpl(...args))
}

export async function restoreRows(...args: Parameters<typeof restoreRowsImpl>) {
  return guard(() => restoreRowsImpl(...args))
}

export async function replayRows(...args: Parameters<typeof replayRowsImpl>) {
  return guard(() => replayRowsImpl(...args))
}
