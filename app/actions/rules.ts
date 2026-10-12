'use server'

import { z } from 'zod'
import { and, desc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { businessRuleVersions, businessRules, nexusDatasets, pipelines } from '@/lib/db/schema'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { diffObjects } from '@/lib/audit-diff'
import { ruleBodySchema, ruleInputSchema, type BusinessRule } from '@/lib/rules/definition'
import { applyRules } from '@/lib/rules/evaluate'
import { evalGroup } from '@/lib/pipelines/conditions'
import { readDatasetSample } from '@/lib/pipelines/io'
import { accessFor, applyMasks } from '@/lib/governance/masking'
import { guard } from '@/lib/server-action'

const idSchema = z.string().min(1).max(100)

async function getOwned(ctx: WorkspaceContext, id: string) {
  const [rule] = await db.select().from(businessRules).where(and(eq(businessRules.id, id), eq(businessRules.workspaceId, ctx.workspaceId))).limit(1)
  if (!rule) throw new Error('Rule not found')
  return rule
}

/** Pipelines (published or draft) that reference each rule id (BR-3 reuse). */
async function usage(workspaceId: string) {
  const rows = await db.select({ id: pipelines.id, name: pipelines.name, config: pipelines.config, draftConfig: pipelines.draftConfig }).from(pipelines).where(eq(pipelines.workspaceId, workspaceId))
  return (ruleId: string) => {
    const needle = JSON.stringify(ruleId)
    return rows.filter((p) => JSON.stringify(p.config ?? {}).includes(needle) || JSON.stringify(p.draftConfig ?? {}).includes(needle)).map((p) => ({ id: p.id, name: p.name }))
  }
}

async function listRulesImpl() {
  const ctx = await requireWorkspace()
  const [rows, usedBy] = await Promise.all([
    db.select().from(businessRules).where(eq(businessRules.workspaceId, ctx.workspaceId)).orderBy(businessRules.name),
    usage(ctx.workspaceId),
  ])
  return rows.map((r) => {
    const body = ruleBodySchema.safeParse(r.body)
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      version: r.version,
      body: body.success ? body.data : null,
      updatedAt: r.updatedAt,
      usedBy: usedBy(r.id),
    }
  })
}

async function listRuleVersionsImpl(rawId: string) {
  const ctx = await requireWorkspace()
  const id = idSchema.parse(rawId)
  await getOwned(ctx, id)
  return db
    .select({ version: businessRuleVersions.version, name: businessRuleVersions.name, body: businessRuleVersions.body, changes: businessRuleVersions.changes, createdAt: businessRuleVersions.createdAt })
    .from(businessRuleVersions)
    .where(and(eq(businessRuleVersions.ruleId, id), eq(businessRuleVersions.workspaceId, ctx.workspaceId)))
    .orderBy(desc(businessRuleVersions.version))
}

/**
 * Creates or updates a rule. Every save is a new immutable version; pipelines
 * always use the rule's latest version, from their next run.
 */
async function saveRuleImpl(input: z.input<typeof ruleInputSchema>) {
  const ctx = await requireWorkspace('rules:edit')
  const data = ruleInputSchema.parse(input)
  const now = new Date()
  const duplicate = await db
    .select({ id: businessRules.id })
    .from(businessRules)
    .where(and(eq(businessRules.workspaceId, ctx.workspaceId), sql`lower(${businessRules.name}) = lower(${data.name})`))
    .limit(1)
  if (duplicate[0] && duplicate[0].id !== data.id) throw new Error(`A rule named "${data.name}" already exists.`)

  let id = data.id
  let version = 1
  let before: Record<string, unknown> | null = null
  if (id) {
    const existing = await getOwned(ctx, id)
    before = { name: existing.name, description: existing.description ?? '', body: existing.body }
    version = existing.version + 1
    await db
      .update(businessRules)
      .set({ name: data.name, description: data.description, body: data.body, version, updatedBy: ctx.userId, updatedAt: now })
      .where(and(eq(businessRules.id, id), eq(businessRules.workspaceId, ctx.workspaceId)))
  } else {
    id = newId('rule')
    await db.insert(businessRules).values({ id, workspaceId: ctx.workspaceId, name: data.name, description: data.description, body: data.body, version, createdBy: ctx.userId, updatedBy: ctx.userId, updatedAt: now })
  }
  await db.insert(businessRuleVersions).values({
    id: newId('rver'),
    ruleId: id,
    workspaceId: ctx.workspaceId,
    version,
    name: data.name,
    body: data.body,
    changes: data.changeNote || (version === 1 ? 'Created' : 'Updated'),
    createdBy: ctx.userId,
  })
  await recordAudit(ctx, { action: version === 1 ? 'CREATE' : 'UPDATE', resource: 'business_rule', resourceId: id, changes: { name: data.name, version }, diff: before ? diffObjects(before, { name: data.name, description: data.description, body: data.body }) : undefined })
  revalidatePath('/dashboard', 'layout')
  return { id, version }
}

async function deleteRuleImpl(rawId: string) {
  const ctx = await requireWorkspace('rules:edit')
  const id = idSchema.parse(rawId)
  const rule = await getOwned(ctx, id)
  const users = (await usage(ctx.workspaceId))(id)
  if (users.length) throw new Error(`"${rule.name}" is used by ${users.map((p) => p.name).join(', ')}. Remove it from those pipelines first.`)
  await db.delete(businessRuleVersions).where(and(eq(businessRuleVersions.ruleId, id), eq(businessRuleVersions.workspaceId, ctx.workspaceId)))
  await db.delete(businessRules).where(and(eq(businessRules.id, id), eq(businessRules.workspaceId, ctx.workspaceId)))
  await recordAudit(ctx, { action: 'DELETE', resource: 'business_rule', resourceId: id, changes: { name: rule.name } })
  revalidatePath('/dashboard', 'layout')
}

const testInput = z.object({
  name: z.string().trim().max(120).default('Rule'),
  body: ruleBodySchema,
  /** Rows typed by the user (JSON), or… */
  rows: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
  /** …the latest rows of a dataset (masked for the user's role). */
  datasetName: z.string().trim().min(1).max(63).optional(),
})

/** Runs an unsaved rule against sample rows and shows, per row, the branch taken and the result. Writes nothing. */
async function testRuleImpl(input: z.input<typeof testInput>) {
  const data = testInput.parse(input)
  const ctx = await requireWorkspace(data.datasetName ? 'data:preview' : undefined)
  let rows: Record<string, unknown>[] = data.rows ?? []
  if (data.datasetName) {
    const [dataset] = await db
      .select({ id: nexusDatasets.id, tableName: nexusDatasets.tableName, columns: nexusDatasets.columns })
      .from(nexusDatasets)
      .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, data.datasetName)))
      .limit(1)
    if (!dataset) throw new Error('Dataset not found')
    const { masks, rowFilters } = await accessFor(ctx.workspaceId, data.datasetName, ctx.role)
    const sample = (await readDatasetSample(dataset.tableName, 20, rowFilters, ((dataset.columns as { name: string }[]) ?? []).map((c) => c.name))).map(({ _nexus_loaded_at, ...r }) => r)
    rows = applyMasks(sample, masks)
    await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'dataset', resourceId: dataset.id, changes: { what: 'rule_test', dataset: data.datasetName, rows: rows.length } })
  }
  const rule: BusinessRule = { id: 'test', name: data.name, version: 0, ...data.body }
  return rows.map((input) => {
    const matched = evalGroup(input, rule.when)
    const outcome = applyRules([rule], input, {})
    const { _nexus_route: route, ...output } = outcome.row
    return {
      input,
      matched,
      output,
      route: typeof route === 'string' ? route : null,
      result: outcome.failure ? 'quarantined' : !outcome.keep ? 'dropped' : outcome.hold ? 'held for approval' : 'kept',
      detail: outcome.failure ?? outcome.hold ?? null,
    }
  })
}

export async function listRules(...args: Parameters<typeof listRulesImpl>) {
  return guard(() => listRulesImpl(...args))
}

export async function listRuleVersions(...args: Parameters<typeof listRuleVersionsImpl>) {
  return guard(() => listRuleVersionsImpl(...args))
}

export async function saveRule(...args: Parameters<typeof saveRuleImpl>) {
  return guard(() => saveRuleImpl(...args))
}

export async function deleteRule(...args: Parameters<typeof deleteRuleImpl>) {
  return guard(() => deleteRuleImpl(...args))
}

export async function testRule(...args: Parameters<typeof testRuleImpl>) {
  return guard(() => testRuleImpl(...args))
}
