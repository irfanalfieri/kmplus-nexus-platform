import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { apiKeys, auditLogs, dashboards, pipelines } from '@/lib/db/schema'
import { definitionSchema, type PipelineDefinition } from '@/lib/pipelines/definition'

/** Server only: what uses a workspace's datasets (impact previews, approvals, the review list). */

type Scope = { workspaceId: string }

export async function published(ctx: Scope) {
  const rows = await db.select({ id: pipelines.id, name: pipelines.name, config: pipelines.config }).from(pipelines).where(eq(pipelines.workspaceId, ctx.workspaceId))
  return rows.flatMap((p) => {
    const d = definitionSchema.safeParse(p.config)
    return d.success ? [{ id: p.id, name: p.name, definition: d.data as PipelineDefinition }] : []
  })
}

/** Pipelines, dashboards and API keys that use a dataset (impact previews, the review list). */
export async function usageOf(ctx: Scope, names: string[]) {
  const pipes = await published(ctx)
  const boards = await db.select({ name: dashboards.name, widgets: dashboards.widgets }).from(dashboards).where(eq(dashboards.workspaceId, ctx.workspaceId))
  const since = new Date(Date.now() - 30 * 86_400_000)
  const reads = await db
    .select({ userId: auditLogs.userId, dataset: sql<string>`${auditLogs.changes}->>'dataset'` })
    .from(auditLogs)
    .where(and(eq(auditLogs.workspaceId, ctx.workspaceId), eq(auditLogs.action, 'API_READ'), gte(auditLogs.createdAt, since)))
    .groupBy(auditLogs.userId, sql`${auditLogs.changes}->>'dataset'`)
  const keyIds = [...new Set(reads.map((r) => r.userId.replace(/^apikey:/, '')))]
  const keys = keyIds.length ? await db.select({ id: apiKeys.id, name: apiKeys.name }).from(apiKeys).where(and(eq(apiKeys.workspaceId, ctx.workspaceId), inArray(apiKeys.id, keyIds))) : []
  return Object.fromEntries(
    names.map((name) => {
      const usedBy = pipes.filter((p) =>
        p.definition.nodes.some(
          (n) =>
            (n.type === 'destination' && n.kind === 'dataset' && n.datasetName === name) ||
            (n.type === 'map' && n.fields.some((f) => f.transforms.some((t) => t.fn === 'lookup' && t.args[0]?.trim() === name))) ||
            (n.type === 'validate' && n.rules.some((r) => r.rule === 'exists_in' && r.value.startsWith(`${name}.`)))
        )
      )
      return [
        name,
        {
          pipelines: usedBy.map((p) => p.name),
          dashboards: boards.filter((b) => ((b.widgets ?? []) as { dataset: string }[]).some((w) => w.dataset === name)).map((b) => b.name),
          apiKeys: keys.filter((k) => reads.some((r) => r.dataset === name && r.userId === `apikey:${k.id}`)).map((k) => k.name),
        },
      ]
    })
  ) as Record<string, { pipelines: string[]; dashboards: string[]; apiKeys: string[] }>
}

