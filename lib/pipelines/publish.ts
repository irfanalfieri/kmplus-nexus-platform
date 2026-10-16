import { z } from 'zod'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pipelineApprovals, pipelineVersions, pipelines, user, workspaceMembers, workspaces } from '@/lib/db/schema'
import { newId, type WorkspaceContext } from '@/lib/auth/session'
import { can, isRole } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { diffObjects, diffPipelineDefinitions } from '@/lib/audit-diff'
import { notify } from '@/lib/notifications'
import { definitionSchema, scheduleSchema, stepTitle, type PipelineDefinition, type PipelineSchedule } from './definition'
import { lanePlan } from './lanes'
import { approvalReasons, isApprovalPolicy, type ApprovalPolicy } from './approvals'
import { parseDefinition } from './runner'
import { assertValidSchedule, nextRunAt } from './schedule'

/**
 * Publishing a pipeline version (VC-2) and the approvals in front of it (GV-6).
 * Server-only helpers shared by app/actions/pipelines.ts, approvals.ts and
 * environments.ts (promotion). Callers have already checked permissions.
 */

/** What a save or publish changed: steps, settings, name, description and schedule. */
export function pipelineDiff(before: { name?: string | null; description?: string | null; schedule?: unknown; definition?: unknown } | null, after: { name: string; description?: string | null; schedule: unknown; definition: unknown }) {
  const defOf = (d: unknown) => definitionSchema.safeParse(d).data ?? null
  return {
    ...diffObjects({ name: before?.name, description: before?.description ?? '', schedule: before?.schedule ?? null }, { name: after.name, description: after.description ?? '', schedule: after.schedule }),
    ...diffPipelineDefinitions(before ? defOf(before.definition) : null, defOf(after.definition), (n) => stepTitle(n as never)),
  }
}

export async function getOwnedPipeline(ctx: { workspaceId: string }, id: string) {
  const [row] = await db.select().from(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId))).limit(1)
  if (!row) throw new Error('Pipeline not found')
  return row
}

export function computeNextRun(enabled: boolean, schedule: PipelineSchedule) {
  return enabled ? nextRunAt(schedule) : null
}

/** Data sources a definition reads from or writes to (delete guard, quick lookups). */
export function sourceRefs(definition: PipelineDefinition) {
  // The driver: the pipeline's main source (one Source is the driver implicitly).
  const driver = lanePlan(definition).driver
  const source = definition.nodes.find((n) => n.type === 'source' && n.id === driver) ?? definition.nodes.find((n) => n.type === 'source')
  const dest = definition.nodes.find((n) => n.type === 'destination' && n.kind === 'datasource')
  return {
    sourceId: source?.type === 'source' ? source.dataSourceId : null,
    destinationId: dest?.type === 'destination' && dest.kind === 'datasource' ? dest.dataSourceId : null,
  }
}

export async function versionDefinition(ctx: { workspaceId: string }, pipelineId: string, version: number) {
  const [snapshot] = await db
    .select()
    .from(pipelineVersions)
    .where(and(eq(pipelineVersions.pipelineId, pipelineId), eq(pipelineVersions.workspaceId, ctx.workspaceId), eq(pipelineVersions.version, version)))
    .limit(1)
  if (!snapshot) throw new Error(`Version ${version} not found`)
  return { snapshot, definition: parseDefinition((snapshot.config as { definition: unknown }).definition) }
}

/** Makes a version the one that runs. */
export async function publishVersion(ctx: WorkspaceContext, id: string, version: number, enabled?: boolean | null, extra: Record<string, unknown> = {}) {
  const existing = await getOwnedPipeline(ctx, id)
  const { snapshot, definition } = await versionDefinition(ctx, id, version)
  const schedule = scheduleSchema.parse(existing.schedule ?? {})
  const isEnabled = enabled ?? existing.enabled ?? false
  const now = new Date()
  await db
    .update(pipelines)
    .set({
      config: definition,
      version,
      // The draft is gone once it is the published version.
      ...(existing.draftVersion !== null && existing.draftVersion <= version ? { draftConfig: null, draftVersion: null } : {}),
      ...sourceRefs(definition),
      enabled: isEnabled,
      nextRunAt: computeNextRun(isEnabled, schedule),
      status: existing.status === 'draft' ? 'active' : existing.status,
      updatedAt: now,
    })
    .where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  await db.update(pipelineVersions).set({ publishedAt: now, publishedBy: ctx.userId }).where(eq(pipelineVersions.id, snapshot.id))
  await recordAudit(ctx, {
    action: 'PUBLISH',
    resource: 'pipeline',
    resourceId: id,
    changes: { version, previousVersion: existing.version || null, ...extra },
    diff: pipelineDiff(existing.version ? { definition: existing.config } : null, { name: existing.name, description: existing.description, schedule: existing.schedule, definition }),
  })
}

export async function workspaceSettings(workspaceId: string) {
  const [ws] = await db
    .select({ name: workspaces.name, publishApproval: workspaces.publishApproval, environment: workspaces.environment, environmentGroupId: workspaces.environmentGroupId, environmentLocked: workspaces.environmentLocked })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
  if (!ws) throw new Error('Workspace not found')
  return { ...ws, publishApproval: (isApprovalPolicy(ws.publishApproval) ? ws.publishApproval : 'off') as ApprovalPolicy }
}

const ENV_LABEL: Record<string, string> = { dev: 'Development', staging: 'Staging', prod: 'Production' }
export const environmentLabel = (env: string | null | undefined) => (env ? (ENV_LABEL[env] ?? env) : '')

/** Locked environments (usually Production) only change through promotion. */
export async function assertPipelinesEditable(ctx: { workspaceId: string }) {
  const ws = await workspaceSettings(ctx.workspaceId)
  if (ws.environmentLocked) {
    throw new Error(`Pipelines in ${environmentLabel(ws.environment) || ws.name} change only by promotion from the previous environment. An admin can unlock it in Settings → Environments.`)
  }
}

/** Members who may approve, other than the requester. */
async function approvers(workspaceId: string, exceptUserId: string) {
  const rows = await db
    .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), ne(workspaceMembers.userId, exceptUserId)))
  return rows.filter((r) => isRole(r.role) && can(r.role, 'pipelines:approve')).map((r) => r.userId)
}

/**
 * Opens an approval request for a saved version (and supersedes older pending
 * requests for the same pipeline). Approvers get a bell notification and email.
 */
export async function requestApproval(
  ctx: WorkspaceContext,
  opts: { pipelineId: string; version: number; reasons: string[]; kind?: 'publish' | 'promote'; enabled?: boolean | null; note?: string; fromWorkspaceId?: string }
) {
  const pipeline = await getOwnedPipeline(ctx, opts.pipelineId)
  const others = await approvers(ctx.workspaceId, ctx.userId)
  if (!others.length) throw new Error('Publishing here needs approval, but nobody else can approve (admins and data stewards). Invite one, or ask an admin to change the approval setting.')
  await db
    .update(pipelineApprovals)
    .set({ status: 'superseded', decidedAt: new Date() })
    .where(and(eq(pipelineApprovals.workspaceId, ctx.workspaceId), eq(pipelineApprovals.pipelineId, opts.pipelineId), eq(pipelineApprovals.status, 'pending')))
  const id = newId('appr')
  await db.insert(pipelineApprovals).values({
    id,
    workspaceId: ctx.workspaceId,
    pipelineId: opts.pipelineId,
    version: opts.version,
    kind: opts.kind ?? 'publish',
    reasons: opts.reasons,
    enabled: opts.enabled ?? null,
    requestNote: opts.note || null,
    requestedBy: ctx.userId,
    fromWorkspaceId: opts.fromWorkspaceId ?? null,
  })
  await recordAudit(ctx, { action: 'REQUEST_APPROVAL', resource: 'pipeline', resourceId: opts.pipelineId, changes: { approvalId: id, version: opts.version, kind: opts.kind ?? 'publish', reasons: opts.reasons } })
  const title = `Approval requested: ${pipeline.name} v${opts.version}`
  const lines = [`${ctx.name || ctx.email} asks to ${opts.kind === 'promote' ? 'promote' : 'publish'} "${pipeline.name}" (version ${opts.version}) in ${ctx.workspaceName}.`, ...opts.reasons.map((r) => `• ${r}`), ...(opts.note ? [`Note: ${opts.note}`] : []), 'Review it in Pipelines → Approvals.']
  for (const userId of others) {
    try {
      await notify({ userId, workspaceId: ctx.workspaceId, level: 'info', title, lines, pipelineId: opts.pipelineId, email: { to: [] } })
    } catch (err) {
      console.error('[approvals] notification failed:', err instanceof Error ? err.message : err)
    }
  }
  return id
}

/** Publishes now, or opens an approval request when the workspace's policy asks for one. */
export async function publishOrRequest(
  ctx: WorkspaceContext,
  pipelineId: string,
  version: number,
  opts: { enabled?: boolean | null; note?: string; kind?: 'publish' | 'promote'; promotedFrom?: string; fromWorkspaceId?: string } = {}
): Promise<{ published: boolean; approvalId?: string; reasons?: string[] }> {
  const ws = await workspaceSettings(ctx.workspaceId)
  const { definition } = await versionDefinition(ctx, pipelineId, version)
  const reasons = approvalReasons(ws.publishApproval, definition, { promotedFrom: opts.promotedFrom })
  if (!reasons.length) {
    await publishVersion(ctx, pipelineId, version, opts.enabled, opts.kind === 'promote' ? { promotedFrom: opts.promotedFrom } : {})
    return { published: true }
  }
  const approvalId = await requestApproval(ctx, { pipelineId, version, reasons, kind: opts.kind, enabled: opts.enabled, note: opts.note, fromWorkspaceId: opts.fromWorkspaceId })
  return { published: false, approvalId, reasons }
}

/** Display names for user ids (approvals list). */
export async function userNames(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map<string, string>()
  const rows = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, unique))
  return new Map(rows.map((r) => [r.id, r.name || r.email]))
}

// ── Saving versions ──────────────────────────────────────────────────────────

export const saveInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).default(''),
  definition: z.unknown(),
  schedule: scheduleSchema,
  enabled: z.boolean().default(false),
  changeNote: z.string().trim().max(200).optional(),
  /** Publish this version right away (it becomes what runs). */
  publish: z.boolean().default(false),
})

/** "Run after" must name a pipeline of this workspace, and chains can't loop (A after B after A). */
async function assertChainValid(ctx: WorkspaceContext, selfId: string | null, afterId: string) {
  const all = await db.select({ id: pipelines.id, name: pipelines.name, schedule: pipelines.schedule }).from(pipelines).where(eq(pipelines.workspaceId, ctx.workspaceId))
  if (!all.some((p) => p.id === afterId)) throw new Error('The pipeline to run after no longer exists.')
  if (selfId && afterId === selfId) throw new Error("A pipeline can't run after itself.")
  const after = new Map(all.map((p) => [p.id, scheduleSchema.safeParse(p.schedule ?? {}).data]))
  let cur: string | undefined = afterId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    if (cur === selfId) throw new Error('This would create a loop of pipelines running after each other.')
    seen.add(cur)
    const s = after.get(cur)
    cur = s?.type === 'after' ? s.afterPipelineId : undefined
  }
}

/**
 * Saves the definition as a new immutable version (VC-1). The version is a
 * draft until published (VC-2): scheduled and manual runs keep executing the
 * published one. Name, description and schedule apply immediately.
 * With publish, the version is published, or sent for approval when the
 * workspace requires it (GV-6).
 */
export async function savePipelineAs(ctx: WorkspaceContext, input: z.input<typeof saveInput>, opts: { promotionKey?: string; auditExtra?: Record<string, unknown> } = {}) {
  const data = saveInput.parse(input)
  const definition = parseDefinition(data.definition)
  assertValidSchedule(data.schedule)
  if (data.schedule.type === 'after') await assertChainValid(ctx, data.id ?? null, data.schedule.afterPipelineId)
  const now = new Date()

  let id = data.id
  let version = 1
  let published = 0
  let before: Parameters<typeof pipelineDiff>[0] = null
  if (id) {
    const existing = await getOwnedPipeline(ctx, id)
    before = { name: existing.name, description: existing.description, schedule: existing.schedule, definition: existing.draftConfig ?? existing.config }
    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${pipelineVersions.version}), 0)::int` })
      .from(pipelineVersions)
      .where(eq(pipelineVersions.pipelineId, id))
    version = Math.max(max, existing.version ?? 0, existing.draftVersion ?? 0) + 1
    published = existing.version ?? 0
    await db
      .update(pipelines)
      .set({
        name: data.name,
        description: data.description,
        schedule: data.schedule,
        enabled: published > 0 ? data.enabled : false,
        nextRunAt: published > 0 ? computeNextRun(data.enabled, data.schedule) : null,
        draftConfig: definition,
        draftVersion: version,
        updatedAt: now,
      })
      .where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId)))
  } else {
    id = newId('pipe')
    // Never published yet (version 0): the definition is stored as the first draft.
    await db.insert(pipelines).values({
      id,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      name: data.name,
      description: data.description,
      config: definition,
      schedule: data.schedule,
      enabled: false,
      version: 0,
      draftConfig: definition,
      draftVersion: version,
      status: 'draft',
      ...sourceRefs(definition),
      promotionKey: opts.promotionKey ?? null,
      updatedAt: now,
    })
  }

  await db.insert(pipelineVersions).values({
    id: newId('pver'),
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    pipelineId: id,
    version,
    config: { definition, schedule: data.schedule, name: data.name, description: data.description },
    changes: data.changeNote || (version === 1 ? 'Created' : 'Updated'),
    createdBy: ctx.userId,
  })
  await recordAudit(ctx, { action: version === 1 ? 'CREATE' : 'UPDATE', resource: 'pipeline', resourceId: id, changes: { version, draft: true, ...opts.auditExtra }, diff: pipelineDiff(before, { name: data.name, description: data.description, schedule: data.schedule, definition }) })
  const outcome = data.publish ? await publishOrRequest(ctx, id, version, { enabled: data.enabled, note: data.changeNote }) : null
  return { id, version, published: outcome?.published ?? false, approvalId: outcome?.approvalId ?? null }
}
