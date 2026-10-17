import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { nexusDatasets, pipelineApprovals } from '@/lib/db/schema'
import { newId, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { notify } from '@/lib/notifications'
import { approvers } from '@/lib/pipelines/publish'
import { applySchemaOps, describeOp, schemaOpSchema, type SchemaOp } from './schema'
import { changePreview, changeSchema, loadSchema, type SchemaChangeResult } from './store'
import { usageOf } from './usage'

/**
 * Schema changes waiting for a second person (GV-6 applied to defined
 * datasets). Stored in pipeline_approvals with subject "schema" and the
 * operations in `payload`, so they share the Approvals inbox with pipeline
 * versions. Server only.
 */

export interface SchemaRequestPayload {
  datasetName: string
  ops: SchemaOp[]
  /** The schema version the change was asked against (shown; the change is re-checked on approval). */
  baseVersion: number
}

export function schemaPayload(raw: unknown): SchemaRequestPayload | null {
  const p = raw as Partial<SchemaRequestPayload> | null
  if (!p || typeof p.datasetName !== 'string' || !Array.isArray(p.ops)) return null
  const ops = p.ops.flatMap((o) => {
    const parsed = schemaOpSchema.safeParse(o)
    return parsed.success ? [parsed.data] : []
  })
  return { datasetName: p.datasetName, ops, baseVersion: Number(p.baseVersion) || 0 }
}

/** The pending request for a dataset's schema, if any. */
export async function pendingSchemaRequest(workspaceId: string, datasetName: string) {
  const [row] = await db
    .select()
    .from(pipelineApprovals)
    .where(and(eq(pipelineApprovals.workspaceId, workspaceId), eq(pipelineApprovals.subject, 'schema'), eq(pipelineApprovals.status, 'pending'), sql`${pipelineApprovals.payload}->>'datasetName' = ${datasetName}`))
    .orderBy(desc(pipelineApprovals.createdAt))
    .limit(1)
  return row ?? null
}

/** Opens a request instead of applying the change; approvers get a bell notification and email. */
export async function requestSchemaApproval(ctx: WorkspaceContext, datasetName: string, ops: SchemaOp[], reasons: string[], note?: string) {
  const stored = await loadSchema(ctx.workspaceId, datasetName)
  if (!stored) throw new Error(`Dataset ${datasetName} has no defined schema.`)
  // Refused now rather than at approval time.
  const applied = applySchemaOps(stored.schema, ops)
  if ('error' in applied) throw new Error(applied.error)
  if (await pendingSchemaRequest(ctx.workspaceId, datasetName)) throw new Error(`A change to the schema of ${datasetName} is already waiting for approval. Wait for it, or cancel it first.`)
  const others = await approvers(ctx.workspaceId, ctx.userId)
  if (!others.length) throw new Error('This change needs approval, but nobody else can approve (admins and data stewards). Invite one, or ask an admin to change the approval setting.')
  const id = newId('appr')
  const payload: SchemaRequestPayload = { datasetName, ops, baseVersion: stored.version }
  await db.insert(pipelineApprovals).values({
    id,
    workspaceId: ctx.workspaceId,
    subject: 'schema',
    pipelineId: null,
    version: stored.version + 1,
    payload,
    kind: 'schema',
    reasons,
    requestNote: note || null,
    requestedBy: ctx.userId,
  })
  await recordAudit(ctx, { action: 'REQUEST_APPROVAL', resource: 'dataset', resourceId: datasetName, changes: { approvalId: id, schemaVersion: stored.version, changes: ops.map(describeOp) } })
  const title = `Approval requested: schema of ${datasetName}`
  const lines = [`${ctx.name || ctx.email} asks to change the schema of dataset "${datasetName}" in ${ctx.workspaceName}.`, ...ops.map((o) => `• ${describeOp(o)}`), ...(note ? [`Note: ${note}`] : []), 'Review it in Pipelines → Approvals.']
  for (const userId of others) {
    try {
      await notify({ userId, workspaceId: ctx.workspaceId, level: 'info', title, lines, email: { to: [] } })
    } catch (err) {
      console.error('[approvals] notification failed:', err instanceof Error ? err.message : err)
    }
  }
  return id
}

/**
 * Applies an approved request as the requester's change. If the schema moved
 * on so that the change no longer applies (a column renamed or removed in the
 * meantime), the request is superseded instead.
 */
export async function applySchemaRequest(workspaceId: string, request: { id: string; requestedBy: string; payload: unknown }): Promise<{ result: SchemaChangeResult } | { stale: string }> {
  const payload = schemaPayload(request.payload)
  if (!payload) return { stale: 'The request is incomplete.' }
  const stored = await loadSchema(workspaceId, payload.datasetName)
  if (!stored) return { stale: `Dataset ${payload.datasetName} has no defined schema any more.` }
  const applied = applySchemaOps(stored.schema, payload.ops)
  if ('error' in applied) return { stale: applied.error }
  return { result: await changeSchema({ workspaceId, userId: request.requestedBy }, payload.datasetName, payload.ops) }
}

/** What an approver sees: the change, rows it touches and who uses the dataset. */
export async function schemaRequestImpact(workspaceId: string, payload: SchemaRequestPayload) {
  const [d] = await db.select({ tableName: nexusDatasets.tableName }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, workspaceId), eq(nexusDatasets.name, payload.datasetName))).limit(1)
  const stored = await loadSchema(workspaceId, payload.datasetName)
  const rows = d && stored ? await changePreview(d.tableName, stored.schema, payload.ops).catch(() => []) : []
  const usage = (await usageOf({ workspaceId }, [payload.datasetName]))[payload.datasetName]
  return { lines: payload.ops.map(describeOp), rows, usage, currentVersion: stored?.version ?? 0 }
}
