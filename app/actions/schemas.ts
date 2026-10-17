'use server'

import { z } from 'zod'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { apiKeys, auditLogs, dashboards, nexusDatasets, pipelines, upgradeNoticeDismissals } from '@/lib/db/schema'
import { requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { guard } from '@/lib/server-action'
import { DOMAIN_BY_NAME } from '@/lib/domain/model'
import { definitionSchema, type PipelineDefinition } from '@/lib/pipelines/definition'
import { published, usageOf } from '@/lib/datasets/usage'
import { columnOwners, datasetSchemaSpec, describeOp, isDestructiveOp, schemaFromColumns, schemaFromEntity, schemaFromExample, schemaOpSchema, unsafeNames, type SchemaOp } from '@/lib/datasets/schema'
import { activeAliases, changePreview, changeSchema, defineSchema, loadSchema, loadSchemas, schemaVersions } from '@/lib/datasets/store'
import { UPGRADE_NOTICES } from '@/lib/upgrades/notices'
import { schemaApprovalReasons } from '@/lib/pipelines/approvals'
import { userNames, workspaceSettings } from '@/lib/pipelines/publish'
import { pendingSchemaRequest, requestSchemaApproval, schemaPayload } from '@/lib/datasets/approval'

/**
 * Defined dataset schemas (lanes design §3): define, change with impact
 * previews, ownership, aliases, and the upgrade notice that offers them.
 * Stewards and admins edit (`catalog:edit`); everyone with access reads.
 */

const datasetName = z.string().trim().min(1).max(48).regex(/^[a-z][a-z0-9_]*$/, 'Lowercase letters, numbers and underscores; start with a letter')

type Column = { name: string; type: string }

async function datasetRow(ctx: WorkspaceContext, name: string) {
  const [d] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, name))).limit(1)
  return d ?? null
}

/** The schema page: the schema (or the dataset's current columns), versions, which pipeline fills which column, aliases, usage. */
async function getDatasetSchemaImpl(rawName: string) {
  const ctx = await requireWorkspace()
  const name = datasetName.parse(rawName)
  const d = await datasetRow(ctx, name)
  const stored = await loadSchema(ctx.workspaceId, name)
  const pipes = await published(ctx)
  return {
    datasetName: name,
    defined: Boolean(stored),
    version: stored?.version ?? 0,
    schema: stored?.schema ?? null,
    currentColumns: ((d?.columns ?? []) as Column[]).map((c) => ({ name: c.name, type: c.type })),
    versions: stored ? (await schemaVersions(ctx.workspaceId, stored.id)).sort((a, b) => b.version - a.version).slice(0, 50).map((v) => ({ version: v.version, change: ((v.change ?? []) as { summary?: string }[]).map((c) => c.summary ?? ''), changedBy: v.changedBy, createdAt: v.createdAt })) : [],
    owners: columnOwners(name, pipes),
    aliases: (await activeAliases(ctx.workspaceId, name)).map((a) => ({ oldName: a.oldName, newName: a.newName, expiresAt: a.expiresAt })),
    usage: (await usageOf(ctx, [name]))[name],
    canEdit: can(ctx.role, 'catalog:edit'),
    pending: await pendingOf(ctx, name),
  }
}

/** A change to this dataset's schema waiting for approval (shown on the schema page). */
async function pendingOf(ctx: WorkspaceContext, name: string) {
  const row = await pendingSchemaRequest(ctx.workspaceId, name)
  const payload = row ? schemaPayload(row.payload) : null
  if (!row || !payload) return null
  const names = await userNames([row.requestedBy])
  return { id: row.id, changes: payload.ops.map(describeOp), requestedBy: names.get(row.requestedBy) ?? row.requestedBy, mine: row.requestedBy === ctx.userId, createdAt: row.createdAt, canCancel: row.requestedBy === ctx.userId || ctx.role === 'admin' }
}

const defineInput = z.object({
  datasetName,
  from: z.enum(['columns', 'entity', 'example', 'schema']),
  entity: z.string().max(60).optional(),
  example: z.string().max(100_000).optional(),
  schema: z.unknown().optional(),
})

/** Defines a dataset's schema: from its current columns (nothing reloaded), a Unified Data Model entity, a pasted example, or as edited. */
async function defineDatasetSchemaImpl(input: z.input<typeof defineInput>) {
  const ctx = await requireWorkspace('catalog:edit')
  const data = defineInput.parse(input)
  const d = await datasetRow(ctx, data.datasetName)
  let schema
  let renames: { from: string; to: string }[] = []
  if (data.from === 'columns') {
    if (!d) throw new Error('Dataset not found')
    schema = schemaFromColumns((d.columns ?? []) as Column[], await upsertKeys(ctx, data.datasetName))
    renames = unsafeNames((d.columns ?? []) as Column[])
  } else if (data.from === 'entity') {
    const entity = DOMAIN_BY_NAME.get(data.entity ?? '')
    if (!entity) throw new Error('Choose a business entity.')
    schema = schemaFromEntity(entity)
  } else if (data.from === 'example') {
    schema = schemaFromExample(data.example ?? '')
  } else schema = datasetSchemaSpec.parse(data.schema)
  const res = await defineSchema({ workspaceId: ctx.workspaceId, userId: ctx.userId }, data.datasetName, schema, data.from === 'columns' ? 'current columns' : data.from === 'entity' ? `entity ${data.entity}` : data.from === 'example' ? 'an example' : 'the editor', renames)
  revalidatePath('/dashboard', 'layout')
  return res
}

/** Keys pipelines already upsert this dataset on (a defined dataset keeps them). */
async function upsertKeys(ctx: WorkspaceContext, name: string): Promise<string[]> {
  for (const p of await published(ctx)) for (const n of p.definition.nodes) if (n.type === 'destination' && n.kind === 'dataset' && n.datasetName === name && n.mode === 'upsert' && n.keys.length) return n.keys
  return []
}

/** "Define from current columns" for several datasets at once (the upgrade notice's review list). */
async function defineFromCurrentColumnsImpl(rawNames: string[]) {
  const ctx = await requireWorkspace('catalog:edit')
  const names = z.array(datasetName).min(1).max(200).parse(rawNames)
  const existing = await loadSchemas(ctx.workspaceId)
  let defined = 0
  for (const name of names) {
    if (existing.has(name)) continue
    const d = await datasetRow(ctx, name)
    if (!d || !((d.columns ?? []) as Column[]).length) continue
    const cols = (d.columns ?? []) as Column[]
    await defineSchema({ workspaceId: ctx.workspaceId, userId: ctx.userId }, name, schemaFromColumns(cols, await upsertKeys(ctx, name)), 'current columns', unsafeNames(cols))
    defined++
  }
  revalidatePath('/dashboard', 'layout')
  return { defined }
}

const changeInput = z.object({ datasetName, ops: z.array(schemaOpSchema).min(1).max(50), note: z.string().trim().max(300).optional() })

/** Why this change waits for a second person under the workspace's approval policy (empty = applied at once). */
async function approvalFor(ctx: WorkspaceContext, name: string, ops: SchemaOp[]) {
  const ws = await workspaceSettings(ctx.workspaceId)
  return schemaApprovalReasons(ws.publishApproval, name, ops)
}

/** What a change would do before it is confirmed: rows touched, and who reads the columns it renames, retypes or removes. */
async function previewSchemaChangeImpl(input: z.input<typeof changeInput>) {
  const ctx = await requireWorkspace('catalog:edit')
  const data = changeInput.parse(input)
  const stored = await loadSchema(ctx.workspaceId, data.datasetName)
  if (!stored) throw new Error(`Dataset ${data.datasetName} has no defined schema.`)
  const d = await datasetRow(ctx, data.datasetName)
  const rows = d ? await changePreview(d.tableName, stored.schema, data.ops as SchemaOp[]) : []
  const destructive = (data.ops as SchemaOp[]).some(isDestructiveOp)
  return { destructive, rows, usage: destructive ? (await usageOf(ctx, [data.datasetName]))[data.datasetName] : null, approval: await approvalFor(ctx, data.datasetName, data.ops as SchemaOp[]) }
}

/** Applies a confirmed change (stewards and admins). */
async function changeDatasetSchemaImpl(input: z.input<typeof changeInput>) {
  const ctx = await requireWorkspace('catalog:edit')
  const data = changeInput.parse(input)
  const ops = data.ops as SchemaOp[]
  // Under the workspace's approval policy a destructive change waits for a second person.
  const reasons = await approvalFor(ctx, data.datasetName, ops)
  if (reasons.length) {
    const approvalId = await requestSchemaApproval(ctx, data.datasetName, ops, reasons, data.note)
    revalidatePath('/dashboard', 'layout')
    return { pending: approvalId, reasons, version: null, moved: { pipelines: [] as string[], dashboards: [] as string[] } }
  }
  const res = await changeSchema({ workspaceId: ctx.workspaceId, userId: ctx.userId }, data.datasetName, ops)
  revalidatePath('/dashboard', 'layout')
  return { pending: null, reasons: [] as string[], version: res.version, moved: res.moved }
}

/** Upgrade notices for this person (dismissed per person): currently "Datasets can now have defined schemas". */
async function getUpgradeNoticesImpl() {
  const ctx = await requireWorkspace()
  const dismissed = new Set((await db.select({ id: upgradeNoticeDismissals.noticeId }).from(upgradeNoticeDismissals).where(and(eq(upgradeNoticeDismissals.workspaceId, ctx.workspaceId), eq(upgradeNoticeDismissals.userId, ctx.userId)))).map((r) => r.id))
  const out: { id: string; count: number }[] = []
  for (const n of UPGRADE_NOTICES) {
    if (dismissed.has(n.id) || !can(ctx.role, n.permission)) continue
    if (n.id === 'defined-schemas') {
      const inferred = await db.select({ n: sql<number>`count(*)::int` }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.defined, false)))
      if (inferred[0].n > 0) out.push({ id: n.id, count: inferred[0].n })
    }
  }
  return out
}

async function dismissUpgradeNoticeImpl(rawId: string) {
  const ctx = await requireWorkspace()
  const id = z.string().min(1).max(60).parse(rawId)
  if (!UPGRADE_NOTICES.some((n) => n.id === id)) throw new Error('Unknown notice.')
  await db.insert(upgradeNoticeDismissals).values({ workspaceId: ctx.workspaceId, userId: ctx.userId, noticeId: id }).onConflictDoNothing()
  revalidatePath('/dashboard', 'layout')
}

/** The review list: inferred datasets with the pipelines, dashboards and API keys that use them. */
async function listInferredDatasetsImpl() {
  const ctx = await requireWorkspace('catalog:edit')
  const rows = await db.select({ name: nexusDatasets.name, columns: nexusDatasets.columns, rowCount: nexusDatasets.rowCount }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.defined, false))).orderBy(desc(nexusDatasets.updatedAt))
  const usage = await usageOf(ctx, rows.map((r) => r.name))
  return rows.map((r) => ({ name: r.name, columns: ((r.columns ?? []) as Column[]).length, rowCount: r.rowCount ?? 0, ...usage[r.name] }))
}

export async function getDatasetSchema(...args: Parameters<typeof getDatasetSchemaImpl>) {
  return guard(() => getDatasetSchemaImpl(...args))
}
export async function defineDatasetSchema(...args: Parameters<typeof defineDatasetSchemaImpl>) {
  return guard(() => defineDatasetSchemaImpl(...args))
}
export async function defineFromCurrentColumns(...args: Parameters<typeof defineFromCurrentColumnsImpl>) {
  return guard(() => defineFromCurrentColumnsImpl(...args))
}
export async function previewSchemaChange(...args: Parameters<typeof previewSchemaChangeImpl>) {
  return guard(() => previewSchemaChangeImpl(...args))
}
export async function changeDatasetSchema(...args: Parameters<typeof changeDatasetSchemaImpl>) {
  return guard(() => changeDatasetSchemaImpl(...args))
}
export async function getUpgradeNotices(...args: Parameters<typeof getUpgradeNoticesImpl>) {
  return guard(() => getUpgradeNoticesImpl(...args))
}
export async function dismissUpgradeNotice(...args: Parameters<typeof dismissUpgradeNoticeImpl>) {
  return guard(() => dismissUpgradeNoticeImpl(...args))
}
export async function listInferredDatasets(...args: Parameters<typeof listInferredDatasetsImpl>) {
  return guard(() => listInferredDatasetsImpl(...args))
}
