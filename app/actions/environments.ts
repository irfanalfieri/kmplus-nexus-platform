'use server'

import { z } from 'zod'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { businessRuleVersions, businessRules, dataSources, pipelines, workspaceMembers, workspaces } from '@/lib/db/schema'
import { contextInWorkspace, newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { can, isRole } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { diffObjects } from '@/lib/audit-diff'
import { APPROVAL_POLICIES, approvalReasons } from '@/lib/pipelines/approvals'
import { scheduleSchema } from '@/lib/pipelines/definition'
import { ENVIRONMENTS, ENVIRONMENT_INFO, applyRuleIds, isEnvironment, nextEnvironment, planPromotion, type Environment, type PromotionSide } from '@/lib/pipelines/promote'
import { getOwnedPipeline, publishOrRequest, savePipelineAs, workspaceSettings } from '@/lib/pipelines/publish'
import { parseDefinition } from '@/lib/pipelines/runner'
import { ruleBodySchema } from '@/lib/rules/definition'
import { guard } from '@/lib/server-action'

/**
 * Environments (GV-7) and publish approvals policy (GV-6).
 *
 * An environment group links workspaces as Development → Staging → Production.
 * Each keeps its own members, data sources (credentials), datasets and runs;
 * pipelines move forward by promotion (lib/pipelines/promote.ts), which maps
 * data sources by name, so each environment connects to its own systems.
 * A locked environment (Production by default) only changes by promotion, and
 * its approval policy decides whether a promotion waits for a second person.
 */

const idSchema = z.string().trim().min(1).max(100)
const envSchema = z.enum(ENVIRONMENTS)
const order = (e: string | null) => (isEnvironment(e) ? ENVIRONMENTS.indexOf(e) : 99)

async function approverCount(workspaceId: string) {
  const rows = await db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId))
  return rows.filter((r) => isRole(r.role) && can(r.role, 'pipelines:approve')).length
}

async function groupOf(groupId: string | null) {
  if (!groupId) return []
  const rows = await db
    .select({ id: workspaces.id, name: workspaces.name, environment: workspaces.environment, locked: workspaces.environmentLocked, publishApproval: workspaces.publishApproval })
    .from(workspaces)
    .where(eq(workspaces.environmentGroupId, groupId))
  return rows.sort((a, b) => order(a.environment) - order(b.environment))
}

async function getEnvironmentsImpl() {
  const ctx = await requireWorkspace()
  const ws = await workspaceSettings(ctx.workspaceId)
  const group = await groupOf(ws.environmentGroupId)
  const mine = await db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role, groupId: workspaces.environmentGroupId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, ctx.userId))
  const roleIn = new Map(mine.map((m) => [m.id, m.role]))
  const present = group.map((g) => g.environment).filter(isEnvironment)
  const nextEnv = isEnvironment(ws.environment) ? nextEnvironment(ws.environment, present) : null
  const next = nextEnv ? group.find((g) => g.environment === nextEnv) : undefined
  return {
    current: {
      id: ctx.workspaceId,
      name: ws.name,
      environment: isEnvironment(ws.environment) ? ws.environment : null,
      locked: ws.environmentLocked,
      publishApproval: ws.publishApproval,
      approvers: await approverCount(ctx.workspaceId),
    },
    group: group.map((g) => ({ id: g.id, name: g.name, environment: isEnvironment(g.environment) ? g.environment : null, locked: g.locked, publishApproval: g.publishApproval, role: roleIn.get(g.id) ?? null })),
    next: next ? { id: next.id, name: next.name, environment: nextEnv!, member: roleIn.has(next.id) } : null,
    // Workspaces this user administers that could join the group.
    linkable: mine.filter((m) => m.role === 'admin' && !m.groupId && m.id !== ctx.workspaceId).map((m) => ({ id: m.id, name: m.name })),
  }
}

// ── Approval policy (GV-6) ───────────────────────────────────────────────────

async function setApprovalPolicyImpl(rawPolicy: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const policy = z.enum(APPROVAL_POLICIES).parse(rawPolicy)
  const ws = await workspaceSettings(ctx.workspaceId)
  if (policy !== 'off' && (await approverCount(ctx.workspaceId)) < 2) {
    throw new Error('Approvals need at least two people who can approve (admins or data stewards), so nobody approves their own change. Invite one first.')
  }
  await db.update(workspaces).set({ publishApproval: policy, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId))
  await recordAudit(ctx, { action: 'UPDATE_POLICY', resource: 'workspace', resourceId: ctx.workspaceId, changes: { publishApproval: policy }, diff: diffObjects({ publishApproval: ws.publishApproval }, { publishApproval: policy }) })
  revalidatePath('/dashboard', 'layout')
}

// ── Environment group ────────────────────────────────────────────────────────

const setupInput = z.object({
  /** This workspace's stage. */
  environment: envSchema,
  /** Stages to create as new workspaces (you become their admin). */
  create: z.array(envSchema).max(2).default([]),
})

async function setupEnvironmentsImpl(input: z.input<typeof setupInput>) {
  const ctx = await requireWorkspace('workspace:manage')
  const data = setupInput.parse(input)
  const ws = await workspaceSettings(ctx.workspaceId)
  if (ws.environmentGroupId) throw new Error('This workspace already belongs to an environment group.')
  const create = [...new Set(data.create)].filter((e) => e !== data.environment)
  const groupId = newId('envg')
  const now = new Date()
  await db.update(workspaces).set({ environment: data.environment, environmentGroupId: groupId, environmentLocked: data.environment === 'prod', updatedAt: now }).where(eq(workspaces.id, ctx.workspaceId))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'workspace', resourceId: ctx.workspaceId, changes: { environment: data.environment, environmentGroupId: groupId } })
  const created: { id: string; name: string; environment: Environment }[] = []
  for (const env of create) {
    const id = newId('ws')
    const name = `${ctx.workspaceName} (${ENVIRONMENT_INFO[env].label})`.slice(0, 80)
    // Production starts locked: its pipelines change only by promotion.
    await db.insert(workspaces).values({ id, name, createdBy: ctx.userId, environment: env, environmentGroupId: groupId, environmentLocked: env === 'prod' })
    await db.insert(workspaceMembers).values({ workspaceId: id, userId: ctx.userId, role: 'admin' })
    await recordAudit({ userId: ctx.userId, workspaceId: id }, { action: 'CREATE', resource: 'workspace', resourceId: id, changes: { name, environment: env, environmentGroupId: groupId, from: ctx.workspaceId } })
    created.push({ id, name, environment: env })
  }
  revalidatePath('/dashboard', 'layout')
  return { groupId, created }
}

const linkInput = z.object({ workspaceId: idSchema, environment: envSchema })

async function linkEnvironmentImpl(input: z.input<typeof linkInput>) {
  const ctx = await requireWorkspace('workspace:manage')
  const data = linkInput.parse(input)
  const ws = await workspaceSettings(ctx.workspaceId)
  if (!ws.environmentGroupId) throw new Error('Set up environments for this workspace first.')
  const tctx = await contextInWorkspace(ctx, data.workspaceId, 'workspace:manage')
  const target = await workspaceSettings(tctx.workspaceId)
  if (target.environmentGroupId) throw new Error(`${target.name} already belongs to an environment group.`)
  const group = await groupOf(ws.environmentGroupId)
  if (group.some((g) => g.environment === data.environment)) throw new Error(`The group already has a ${ENVIRONMENT_INFO[data.environment].label} workspace.`)
  await db.update(workspaces).set({ environment: data.environment, environmentGroupId: ws.environmentGroupId, environmentLocked: data.environment === 'prod', updatedAt: new Date() }).where(eq(workspaces.id, tctx.workspaceId))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'workspace', resourceId: tctx.workspaceId, changes: { linked: tctx.workspaceName, environment: data.environment } })
  await recordAudit(tctx, { action: 'UPDATE', resource: 'workspace', resourceId: tctx.workspaceId, changes: { environment: data.environment, environmentGroupId: ws.environmentGroupId, linkedFrom: ctx.workspaceId } })
  revalidatePath('/dashboard', 'layout')
}

async function unlinkEnvironmentImpl(rawWorkspaceId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const workspaceId = idSchema.parse(rawWorkspaceId)
  const ws = await workspaceSettings(ctx.workspaceId)
  const group = await groupOf(ws.environmentGroupId)
  if (!group.some((g) => g.id === workspaceId)) throw new Error('That workspace is not in this environment group.')
  const tctx = workspaceId === ctx.workspaceId ? ctx : await contextInWorkspace(ctx, workspaceId, 'workspace:manage')
  const clear = { environment: null, environmentGroupId: null, environmentLocked: false, updatedAt: new Date() }
  await db.update(workspaces).set(clear).where(eq(workspaces.id, workspaceId))
  // A group of one is no group.
  const rest = group.filter((g) => g.id !== workspaceId)
  if (rest.length === 1) await db.update(workspaces).set(clear).where(eq(workspaces.id, rest[0].id))
  await recordAudit(tctx, { action: 'UPDATE', resource: 'workspace', resourceId: workspaceId, changes: { unlinkedFromEnvironmentGroup: ws.environmentGroupId } })
  revalidatePath('/dashboard', 'layout')
}

async function setEnvironmentLockImpl(rawLocked: boolean) {
  const ctx = await requireWorkspace('workspace:manage')
  const locked = z.boolean().parse(rawLocked)
  const ws = await workspaceSettings(ctx.workspaceId)
  if (!ws.environmentGroupId) throw new Error('Only workspaces in an environment group can be locked.')
  await db.update(workspaces).set({ environmentLocked: locked, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId))
  await recordAudit(ctx, { action: 'UPDATE_POLICY', resource: 'workspace', resourceId: ctx.workspaceId, changes: { environmentLocked: locked }, diff: diffObjects({ environmentLocked: ws.environmentLocked }, { environmentLocked: locked }) })
  revalidatePath('/dashboard', 'layout')
}

// ── Promotion ────────────────────────────────────────────────────────────────

async function sideOf(workspaceId: string): Promise<PromotionSide> {
  const [ds, rules, pipes] = await Promise.all([
    db.select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType }).from(dataSources).where(eq(dataSources.workspaceId, workspaceId)),
    db.select({ id: businessRules.id, name: businessRules.name, body: businessRules.body }).from(businessRules).where(eq(businessRules.workspaceId, workspaceId)),
    db.select({ id: pipelines.id, name: pipelines.name, promotionKey: pipelines.promotionKey }).from(pipelines).where(eq(pipelines.workspaceId, workspaceId)),
  ])
  return { dataSources: ds, rules: rules.map((r) => ({ ...r, body: ruleBodySchema.parse(r.body) })), pipelines: pipes }
}

async function buildPromotion(ctx: WorkspaceContext, pipelineId: string) {
  const ws = await workspaceSettings(ctx.workspaceId)
  if (!ws.environmentGroupId || !isEnvironment(ws.environment)) throw new Error('This workspace is not part of an environment group. Set one up in Settings → Environments.')
  const group = await groupOf(ws.environmentGroupId)
  const nextEnv = nextEnvironment(ws.environment, group.map((g) => g.environment).filter(isEnvironment))
  if (!nextEnv) throw new Error(`${ENVIRONMENT_INFO[ws.environment].label} is the last environment; there is nothing to promote to.`)
  const target = group.find((g) => g.environment === nextEnv)!
  const pipeline = await getOwnedPipeline(ctx, pipelineId)
  if (!pipeline.version) throw new Error('Publish the pipeline here first: promotion copies the published version.')
  const definition = parseDefinition(pipeline.config)
  const schedule = scheduleSchema.parse(pipeline.schedule ?? {})
  const fromLabel = ENVIRONMENT_INFO[ws.environment].label
  const targetLabel = ENVIRONMENT_INFO[nextEnv].label
  const plan = planPromotion(definition, schedule, await sideOf(ctx.workspaceId), await sideOf(target.id), targetLabel)
  const key = pipeline.promotionKey ?? pipeline.id
  const [existing] = await db
    .select({ id: pipelines.id, name: pipelines.name, version: pipelines.version, enabled: pipelines.enabled })
    .from(pipelines)
    .where(and(eq(pipelines.workspaceId, target.id), eq(pipelines.promotionKey, key)))
    .limit(1)
  return { ws, target, nextEnv, fromLabel, targetLabel, pipeline, plan, key, existing: existing ?? null }
}

async function previewPromotionImpl(rawPipelineId: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  const b = await buildPromotion(ctx, idSchema.parse(rawPipelineId))
  const targetWs = await workspaceSettings(b.target.id)
  const memberRole = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, b.target.id), eq(workspaceMembers.userId, ctx.userId)))
    .limit(1)
  const role = memberRole[0]?.role
  const canEdit = isRole(role) && can(role, 'pipelines:edit')
  return {
    pipeline: { id: b.pipeline.id, name: b.pipeline.name, version: b.pipeline.version ?? 0 },
    from: { name: ctx.workspaceName, environment: b.ws.environment as Environment },
    target: { id: b.target.id, name: b.target.name, environment: b.nextEnv, locked: targetWs.environmentLocked },
    existing: b.existing ? { id: b.existing.id, publishedVersion: b.existing.version ?? 0 } : null,
    items: b.plan.items,
    blocking: canEdit ? b.plan.blocking : [`You need an editor role (admin or data steward) in ${b.target.name}.`, ...b.plan.blocking],
    approvalReasons: approvalReasons(targetWs.publishApproval, b.plan.definition, { promotedFrom: b.fromLabel }),
  }
}

const promoteInput = z.object({ pipelineId: idSchema, note: z.string().trim().max(300).default('') })

async function promotePipelineImpl(input: z.input<typeof promoteInput>) {
  const ctx = await requireWorkspace('pipelines:edit')
  const data = promoteInput.parse(input)
  const b = await buildPromotion(ctx, data.pipelineId)
  if (b.plan.blocking.length) throw new Error(b.plan.blocking.join(' '))
  const tctx = await contextInWorkspace(ctx, b.target.id, 'pipelines:edit')
  const changeNote = `Promoted from ${b.fromLabel} v${b.pipeline.version}`

  // Business rules first, so the pipeline can reference them.
  const ruleIds = new Map<string, string>()
  for (const r of b.plan.rules) {
    const now = new Date()
    let id = r.targetId
    let version = 1
    if (id) {
      const [existing] = await db.select({ version: businessRules.version, body: businessRules.body }).from(businessRules).where(and(eq(businessRules.id, id), eq(businessRules.workspaceId, tctx.workspaceId))).limit(1)
      version = (existing?.version ?? 0) + 1
      await db.update(businessRules).set({ body: r.body, version, updatedBy: ctx.userId, updatedAt: now }).where(and(eq(businessRules.id, id), eq(businessRules.workspaceId, tctx.workspaceId)))
      await recordAudit(tctx, { action: 'UPDATE', resource: 'business_rule', resourceId: id, changes: { name: r.name, version, promotedFrom: ctx.workspaceId }, diff: diffObjects({ body: existing?.body }, { body: r.body }) })
    } else {
      id = newId('rule')
      await db.insert(businessRules).values({ id, workspaceId: tctx.workspaceId, name: r.name, description: `${changeNote}`, body: r.body, version, createdBy: ctx.userId, updatedBy: ctx.userId, updatedAt: now })
      await recordAudit(tctx, { action: 'CREATE', resource: 'business_rule', resourceId: id, changes: { name: r.name, version, promotedFrom: ctx.workspaceId } })
    }
    await db.insert(businessRuleVersions).values({ id: newId('rver'), ruleId: id, workspaceId: tctx.workspaceId, version, name: r.name, body: r.body, changes: `Promoted from ${b.fromLabel}`, createdBy: ctx.userId })
    ruleIds.set(r.sourceId, id)
  }

  const saved = await savePipelineAs(
    tctx,
    {
      id: b.existing?.id,
      name: b.pipeline.name,
      description: b.pipeline.description ?? '',
      definition: applyRuleIds(b.plan.definition, ruleIds),
      schedule: b.plan.schedule,
      // A new pipeline starts with its schedule off in the next environment; an existing one keeps its state.
      enabled: b.existing ? Boolean(b.existing.enabled) : false,
      changeNote,
      publish: false,
    },
    { promotionKey: b.key, auditExtra: { promotedFrom: ctx.workspaceId, sourcePipelineId: b.pipeline.id, sourceVersion: b.pipeline.version } }
  )
  const outcome = await publishOrRequest(tctx, saved.id, saved.version, {
    kind: 'promote',
    promotedFrom: `${b.fromLabel} (${ctx.workspaceName})`,
    fromWorkspaceId: ctx.workspaceId,
    note: data.note,
    enabled: b.existing ? Boolean(b.existing.enabled) : false,
  })
  // Later promotions find the same pipeline even if it's renamed.
  if (!b.pipeline.promotionKey) await db.update(pipelines).set({ promotionKey: b.key }).where(and(eq(pipelines.id, b.pipeline.id), eq(pipelines.workspaceId, ctx.workspaceId), isNull(pipelines.promotionKey)))
  await recordAudit(ctx, {
    action: 'PROMOTE',
    resource: 'pipeline',
    resourceId: b.pipeline.id,
    changes: { version: b.pipeline.version, to: b.target.id, toEnvironment: b.nextEnv, targetPipelineId: saved.id, targetVersion: saved.version, published: outcome.published, approvalId: outcome.approvalId, rules: b.plan.rules.map((r) => r.name) },
  })
  revalidatePath('/dashboard', 'layout')
  return { target: { id: b.target.id, name: b.target.name, environment: b.nextEnv }, pipelineId: saved.id, version: saved.version, published: outcome.published, approvalId: outcome.approvalId ?? null }
}

/** Pipelines of this workspace with the version deployed in each other environment of the group. */
async function listPromotionStatusImpl() {
  const ctx = await requireWorkspace()
  const ws = await workspaceSettings(ctx.workspaceId)
  const group = (await groupOf(ws.environmentGroupId)).filter((g) => g.id !== ctx.workspaceId)
  if (!group.length) return []
  const mine = await db.select({ id: pipelines.id, key: pipelines.promotionKey }).from(pipelines).where(eq(pipelines.workspaceId, ctx.workspaceId))
  const keys = mine.map((p) => p.key ?? p.id)
  const others = keys.length
    ? await db
        .select({ workspaceId: pipelines.workspaceId, key: pipelines.promotionKey, version: pipelines.version })
        .from(pipelines)
        .where(and(inArray(pipelines.workspaceId, group.map((g) => g.id)), inArray(pipelines.promotionKey, keys), ne(pipelines.workspaceId, ctx.workspaceId)))
    : []
  return mine.map((p) => ({
    pipelineId: p.id,
    deployed: group.map((g) => {
      const hit = others.find((o) => o.workspaceId === g.id && o.key === (p.key ?? p.id))
      return { environment: isEnvironment(g.environment) ? g.environment : null, version: hit ? (hit.version ?? 0) : null }
    }),
  }))
}

export async function getEnvironments(...args: Parameters<typeof getEnvironmentsImpl>) {
  return guard(() => getEnvironmentsImpl(...args))
}

export async function setApprovalPolicy(...args: Parameters<typeof setApprovalPolicyImpl>) {
  return guard(() => setApprovalPolicyImpl(...args))
}

export async function setupEnvironments(...args: Parameters<typeof setupEnvironmentsImpl>) {
  return guard(() => setupEnvironmentsImpl(...args))
}

export async function linkEnvironment(...args: Parameters<typeof linkEnvironmentImpl>) {
  return guard(() => linkEnvironmentImpl(...args))
}

export async function unlinkEnvironment(...args: Parameters<typeof unlinkEnvironmentImpl>) {
  return guard(() => unlinkEnvironmentImpl(...args))
}

export async function setEnvironmentLock(...args: Parameters<typeof setEnvironmentLockImpl>) {
  return guard(() => setEnvironmentLockImpl(...args))
}

export async function previewPromotion(...args: Parameters<typeof previewPromotionImpl>) {
  return guard(() => previewPromotionImpl(...args))
}

export async function promotePipeline(...args: Parameters<typeof promotePipelineImpl>) {
  return guard(() => promotePipelineImpl(...args))
}

export async function listPromotionStatus(...args: Parameters<typeof listPromotionStatusImpl>) {
  return guard(() => listPromotionStatusImpl(...args))
}
