'use server'

import { z } from 'zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { pipelineApprovals, pipelines, workspaces } from '@/lib/db/schema'
import { requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { notify } from '@/lib/notifications'
import { APPROVAL_STATUSES } from '@/lib/pipelines/approvals'
import { describeOp } from '@/lib/datasets/schema'
import { getOwnedPipeline, pipelineDiff, publishVersion, userNames, versionDefinition } from '@/lib/pipelines/publish'
import { guard } from '@/lib/server-action'
import { applySchemaRequest, schemaPayload, schemaRequestImpact } from '@/lib/datasets/approval'

/**
 * Approvals (GV-6): pipeline versions waiting for a second person before they
 * run, and changes to defined dataset schemas (subject "schema",
 * lib/datasets/approval.ts). Requesters see their own requests; admins and
 * data stewards (pipelines:approve) approve or reject other people's.
 * Approving publishes exactly the requested version, or applies exactly the
 * requested schema change.
 */

const idSchema = z.string().trim().min(1).max(100)

async function ownedRequest(ctx: WorkspaceContext, id: string) {
  const [row] = await db.select().from(pipelineApprovals).where(and(eq(pipelineApprovals.id, id), eq(pipelineApprovals.workspaceId, ctx.workspaceId))).limit(1)
  if (!row) throw new Error('Approval request not found')
  return row
}

async function listApprovalsImpl(rawStatus: string = 'pending') {
  const ctx = await requireWorkspace()
  const status = z.enum(APPROVAL_STATUSES).or(z.literal('all')).parse(rawStatus)
  const rows = await db
    .select({ a: pipelineApprovals, pipelineName: pipelines.name, publishedVersion: pipelines.version, published: pipelines.config, schedule: pipelines.schedule, description: pipelines.description })
    .from(pipelineApprovals)
    .leftJoin(pipelines, eq(pipelines.id, pipelineApprovals.pipelineId))
    .where(and(eq(pipelineApprovals.workspaceId, ctx.workspaceId), ...(status === 'all' ? [] : [eq(pipelineApprovals.status, status)])))
    .orderBy(desc(pipelineApprovals.createdAt))
    .limit(100)
  const names = await userNames(rows.flatMap((r) => [r.a.requestedBy, r.a.decidedBy ?? '']))
  const fromIds = [...new Set(rows.map((r) => r.a.fromWorkspaceId).filter((x): x is string => Boolean(x)))]
  const fromNames = fromIds.length ? new Map((await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(inArray(workspaces.id, fromIds))).map((w) => [w.id, w.name])) : new Map<string, string>()
  const canApprove = can(ctx.role, 'pipelines:approve')
  return Promise.all(
    rows.map(async ({ a, pipelineName, publishedVersion, published, schedule, description }) => {
      const payload = a.subject === 'schema' ? schemaPayload(a.payload) : null
      // Schema changes: the operations, rows they touch and who reads the dataset.
      const schema = payload
        ? { datasetName: payload.datasetName, baseVersion: payload.baseVersion, ...(a.status === 'pending' ? await schemaRequestImpact(ctx.workspaceId, payload) : { lines: payload.ops.map(describeOp), rows: [], usage: null, currentVersion: 0 }) }
        : null
      // What approving would change, compared with the version that runs today.
      let changes: Record<string, unknown> = {}
      if (a.pipelineId && pipelineName !== null) {
        try {
          const { definition } = await versionDefinition(ctx, a.pipelineId, a.version)
          changes = pipelineDiff(publishedVersion ? { definition: published } : null, { name: pipelineName, description, schedule, definition })
          for (const k of ['name', 'description', 'schedule']) delete changes[k]
        } catch {
          changes = {}
        }
      }
      return {
        id: a.id,
        subject: (a.subject === 'schema' ? 'schema' : 'pipeline') as 'pipeline' | 'schema',
        pipelineId: a.pipelineId,
        pipelineName: pipelineName ?? payload?.datasetName ?? '',
        version: a.version,
        publishedVersion: publishedVersion ?? 0,
        kind: a.kind as 'publish' | 'promote' | 'schema',
        schema,
        status: a.status as (typeof APPROVAL_STATUSES)[number],
        reasons: (a.reasons as string[]) ?? [],
        requestNote: a.requestNote,
        requestedBy: names.get(a.requestedBy) ?? a.requestedBy,
        mine: a.requestedBy === ctx.userId,
        fromWorkspace: a.fromWorkspaceId ? (fromNames.get(a.fromWorkspaceId) ?? null) : null,
        decidedBy: a.decidedBy ? (names.get(a.decidedBy) ?? a.decidedBy) : null,
        decisionNote: a.decisionNote,
        decidedAt: a.decidedAt,
        createdAt: a.createdAt,
        changes,
        canDecide: canApprove && a.requestedBy !== ctx.userId && a.status === 'pending',
      }
    })
  )
}

const decisionInput = z.object({ id: idSchema, note: z.string().trim().max(500).default('') })

async function tellRequester(ctx: WorkspaceContext, request: typeof pipelineApprovals.$inferSelect, approved: boolean, note: string) {
  const verb = approved ? 'approved' : 'rejected'
  const payload = request.subject === 'schema' ? schemaPayload(request.payload) : null
  if (payload) {
    try {
      await notify({
        userId: request.requestedBy,
        workspaceId: ctx.workspaceId,
        level: approved ? 'info' : 'warning',
        title: `Schema change to ${payload.datasetName} ${verb}`,
        lines: [`${ctx.name || ctx.email} ${verb} your change to the schema of "${payload.datasetName}" in ${ctx.workspaceName}.`, ...(approved ? ['It is applied.'] : []), ...(note ? [`Note: ${note}`] : [])],
        email: { to: [] },
      })
    } catch (err) {
      console.error('[approvals] notification failed:', err instanceof Error ? err.message : err)
    }
    return
  }
  const [p] = request.pipelineId ? await db.select({ name: pipelines.name }).from(pipelines).where(eq(pipelines.id, request.pipelineId)).limit(1) : []
  try {
    await notify({
      userId: request.requestedBy,
      workspaceId: ctx.workspaceId,
      level: approved ? 'info' : 'warning',
      title: `${p?.name ?? 'Pipeline'} v${request.version} ${verb}`,
      lines: [`${ctx.name || ctx.email} ${verb} version ${request.version} of "${p?.name ?? 'the pipeline'}" in ${ctx.workspaceName}.`, ...(approved ? ['It is published: scheduled and manual runs use it now.'] : []), ...(note ? [`Note: ${note}`] : [])],
      pipelineId: request.pipelineId ?? undefined,
      email: { to: [] },
    })
  } catch (err) {
    console.error('[approvals] notification failed:', err instanceof Error ? err.message : err)
  }
}

async function approveRequestImpl(input: z.input<typeof decisionInput>) {
  const ctx = await requireWorkspace('pipelines:approve')
  const data = decisionInput.parse(input)
  const request = await ownedRequest(ctx, data.id)
  if (request.status !== 'pending') throw new Error(`This request was already ${request.status}.`)
  if (request.requestedBy === ctx.userId) throw new Error('Someone else has to approve your own request.')
  if (request.subject === 'schema') return approveSchemaRequest(ctx, request, data.note)
  if (!request.pipelineId) throw new Error('Approval request not found')
  const pipeline = await getOwnedPipeline(ctx, request.pipelineId)
  if ((pipeline.version ?? 0) >= request.version) {
    await db.update(pipelineApprovals).set({ status: 'superseded', decidedAt: new Date() }).where(eq(pipelineApprovals.id, request.id))
    throw new Error(`Version ${pipeline.version} is already published, newer than the requested v${request.version}.`)
  }
  // Claim the request first so two approvers can't both publish it.
  const claimed = await db
    .update(pipelineApprovals)
    .set({ status: 'approved', decidedBy: ctx.userId, decisionNote: data.note || null, decidedAt: new Date() })
    .where(and(eq(pipelineApprovals.id, request.id), eq(pipelineApprovals.status, 'pending')))
    .returning({ id: pipelineApprovals.id })
  if (!claimed.length) throw new Error('This request was decided a moment ago.')
  try {
    await publishVersion(ctx, request.pipelineId, request.version, request.enabled, { approvalId: request.id, requestedBy: request.requestedBy, kind: request.kind })
  } catch (err) {
    await db.update(pipelineApprovals).set({ status: 'pending', decidedBy: null, decisionNote: null, decidedAt: null }).where(eq(pipelineApprovals.id, request.id))
    throw err
  }
  await recordAudit(ctx, { action: 'APPROVE', resource: 'pipeline', resourceId: request.pipelineId, changes: { approvalId: request.id, version: request.version, note: data.note || undefined } })
  await tellRequester(ctx, request, true, data.note)
  revalidatePath('/dashboard', 'layout')
  return { version: request.version }
}

/** Applies a schema change as the requester asked it; a change that no longer applies is superseded. */
async function approveSchemaRequest(ctx: WorkspaceContext, request: typeof pipelineApprovals.$inferSelect, note: string) {
  const claimed = await db
    .update(pipelineApprovals)
    .set({ status: 'approved', decidedBy: ctx.userId, decisionNote: note || null, decidedAt: new Date() })
    .where(and(eq(pipelineApprovals.id, request.id), eq(pipelineApprovals.status, 'pending')))
    .returning({ id: pipelineApprovals.id })
  if (!claimed.length) throw new Error('This request was decided a moment ago.')
  const payload = schemaPayload(request.payload)
  let outcome: Awaited<ReturnType<typeof applySchemaRequest>>
  try {
    outcome = await applySchemaRequest(ctx.workspaceId, request)
  } catch (err) {
    await db.update(pipelineApprovals).set({ status: 'pending', decidedBy: null, decisionNote: null, decidedAt: null }).where(eq(pipelineApprovals.id, request.id))
    throw err
  }
  if ('stale' in outcome) {
    await db.update(pipelineApprovals).set({ status: 'superseded', decisionNote: outcome.stale }).where(eq(pipelineApprovals.id, request.id))
    revalidatePath('/dashboard', 'layout')
    throw new Error(`The schema changed since this request, so it no longer applies: ${outcome.stale} Ask for the change again.`)
  }
  await recordAudit(ctx, { action: 'APPROVE', resource: 'dataset', resourceId: payload?.datasetName ?? '', changes: { approvalId: request.id, schemaVersion: outcome.result.version, note: note || undefined } })
  await tellRequester(ctx, request, true, note)
  revalidatePath('/dashboard', 'layout')
  return { version: outcome.result.version }
}

async function rejectRequestImpl(input: z.input<typeof decisionInput>) {
  const ctx = await requireWorkspace('pipelines:approve')
  const data = decisionInput.parse(input)
  if (!data.note) throw new Error('Say why, so the requester knows what to change.')
  const request = await ownedRequest(ctx, data.id)
  if (request.status !== 'pending') throw new Error(`This request was already ${request.status}.`)
  if (request.requestedBy === ctx.userId) throw new Error('Cancel your own request instead.')
  await db.update(pipelineApprovals).set({ status: 'rejected', decidedBy: ctx.userId, decisionNote: data.note, decidedAt: new Date() }).where(and(eq(pipelineApprovals.id, request.id), eq(pipelineApprovals.status, 'pending')))
  const schema = request.subject === 'schema' ? schemaPayload(request.payload) : null
  await recordAudit(ctx, { action: 'REJECT', resource: schema ? 'dataset' : 'pipeline', resourceId: schema?.datasetName ?? request.pipelineId ?? '', changes: { approvalId: request.id, version: request.version, note: data.note } })
  await tellRequester(ctx, request, false, data.note)
  revalidatePath('/dashboard', 'layout')
}

async function cancelRequestImpl(rawId: string) {
  const ctx = await requireWorkspace()
  const request = await ownedRequest(ctx, idSchema.parse(rawId))
  const schema = request.subject === 'schema' ? schemaPayload(request.payload) : null
  if (!can(ctx.role, schema ? 'catalog:edit' : 'pipelines:edit')) throw new Error('Only the requester or an admin can cancel it.')
  if (request.status !== 'pending') throw new Error(`This request was already ${request.status}.`)
  if (request.requestedBy !== ctx.userId && ctx.role !== 'admin') throw new Error('Only the requester or an admin can cancel it.')
  await db.update(pipelineApprovals).set({ status: 'cancelled', decidedBy: ctx.userId, decidedAt: new Date() }).where(eq(pipelineApprovals.id, request.id))
  await recordAudit(ctx, { action: 'CANCEL', resource: schema ? 'dataset' : 'pipeline', resourceId: schema?.datasetName ?? request.pipelineId ?? '', changes: { approvalId: request.id, version: request.version } })
  revalidatePath('/dashboard', 'layout')
}

export async function listApprovals(...args: Parameters<typeof listApprovalsImpl>) {
  return guard(() => listApprovalsImpl(...args))
}

export async function approveRequest(...args: Parameters<typeof approveRequestImpl>) {
  return guard(() => approveRequestImpl(...args))
}

export async function rejectRequest(...args: Parameters<typeof rejectRequestImpl>) {
  return guard(() => rejectRequestImpl(...args))
}

export async function cancelRequest(...args: Parameters<typeof cancelRequestImpl>) {
  return guard(() => cancelRequestImpl(...args))
}
