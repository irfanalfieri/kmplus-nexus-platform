'use server'

import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, pool } from '@/lib/db'
import { dashboards, nexusDatasets } from '@/lib/db/schema'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { dashboardInputSchema, widgetSchema, type Widget, type WidgetResult } from '@/lib/analytics/definition'
import { buildWidgetSql, isTimeSeries, WidgetQueryError, type DatasetColumn } from '@/lib/analytics/query'
import { masksFor } from '@/lib/governance/masking'
import { guard } from '@/lib/server-action'

const idSchema = z.string().trim().min(1).max(100)
const QUERY_TIMEOUT = '15s'

async function datasetsOf(workspaceId: string) {
  return db
    .select({ name: nexusDatasets.name, tableName: nexusDatasets.tableName, columns: nexusDatasets.columns, rowCount: nexusDatasets.rowCount, lastLoadedAt: nexusDatasets.lastLoadedAt })
    .from(nexusDatasets)
    .where(eq(nexusDatasets.workspaceId, workspaceId))
    .orderBy(nexusDatasets.name)
}

/** Datasets and their columns for the widget editor. Masked columns are flagged for roles that can't use them. */
async function getAnalyticsDatasetsImpl() {
  const ctx = await requireWorkspace()
  const datasets = await datasetsOf(ctx.workspaceId)
  return Promise.all(
    datasets.map(async (d) => {
      const masked = new Set(Object.keys(await masksFor(ctx.workspaceId, d.name, ctx.role)))
      return {
        name: d.name,
        rowCount: d.rowCount ?? 0,
        lastLoadedAt: d.lastLoadedAt,
        columns: ((d.columns as DatasetColumn[]) ?? []).map((c) => ({ name: c.name, type: c.type, masked: masked.has(c.name) })),
      }
    })
  )
}

async function listDashboardsImpl() {
  const ctx = await requireWorkspace()
  const rows = await db
    .select({ id: dashboards.id, name: dashboards.name, description: dashboards.description, widgets: dashboards.widgets, updatedAt: dashboards.updatedAt })
    .from(dashboards)
    .where(eq(dashboards.workspaceId, ctx.workspaceId))
    .orderBy(desc(dashboards.updatedAt))
  return {
    canEdit: can(ctx.role, 'dashboards:edit'),
    canView: can(ctx.role, 'data:preview'),
    dashboards: rows.map((r) => ({ id: r.id, name: r.name, description: r.description ?? '', widgets: parseWidgets(r.widgets), updatedAt: r.updatedAt })),
  }
}

function parseWidgets(raw: unknown): Widget[] {
  return (Array.isArray(raw) ? raw : []).flatMap((w) => {
    const parsed = widgetSchema.safeParse(w)
    return parsed.success ? [parsed.data] : []
  })
}

async function saveDashboardImpl(input: z.input<typeof dashboardInputSchema>) {
  const ctx = await requireWorkspace('dashboards:edit')
  const data = dashboardInputSchema.parse(input)
  const known = new Set((await datasetsOf(ctx.workspaceId)).map((d) => d.name))
  const missing = data.widgets.filter((w) => !known.has(w.dataset)).map((w) => w.dataset)
  if (missing.length) throw new Error(`Unknown dataset(s): ${[...new Set(missing)].join(', ')}`)
  const now = new Date()
  let id = data.id
  if (id) {
    const updated = await db
      .update(dashboards)
      .set({ name: data.name, description: data.description, widgets: data.widgets, updatedAt: now })
      .where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ctx.workspaceId)))
      .returning({ id: dashboards.id })
    if (!updated.length) throw new Error('Dashboard not found')
  } else {
    id = newId('dash')
    await db.insert(dashboards).values({ id, workspaceId: ctx.workspaceId, name: data.name, description: data.description, widgets: data.widgets, createdBy: ctx.userId })
  }
  await recordAudit(ctx, { action: data.id ? 'UPDATE' : 'CREATE', resource: 'dashboard', resourceId: id, changes: { name: data.name, widgets: data.widgets.length } })
  revalidatePath('/dashboard')
  return { id }
}

async function deleteDashboardImpl(rawId: string) {
  const ctx = await requireWorkspace('dashboards:edit')
  const id = idSchema.parse(rawId)
  await db.delete(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ctx.workspaceId)))
  await recordAudit(ctx, { action: 'DELETE', resource: 'dashboard', resourceId: id })
  revalidatePath('/dashboard')
}

async function runWidget(ctx: WorkspaceContext, widget: Widget): Promise<WidgetResult> {
  const [dataset] = await db
    .select({ tableName: nexusDatasets.tableName, columns: nexusDatasets.columns })
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, widget.dataset)))
    .limit(1)
  if (!dataset) throw new WidgetQueryError(`Dataset ${widget.dataset} no longer exists.`)
  const blockedColumns = Object.keys(await masksFor(ctx.workspaceId, widget.dataset, ctx.role))
  const table = `"nexus_data"."${dataset.tableName.replace(/"/g, '""')}"`
  const { text, params } = buildWidgetSql(widget, table, (dataset.columns as DatasetColumn[]) ?? [], { blockedColumns })
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`)
    const exists = (await client.query<{ r: string | null }>('SELECT to_regclass($1)::text AS r', [table])).rows[0].r
    const res = exists ? await client.query<{ label?: string | null; value: string | number | null }>(text, params) : { rows: [] }
    await client.query('COMMIT')
    const rows = res.rows.map((r) => ({ label: r.label ?? null, value: r.value === null ? null : Number(r.value) }))
    const truncated = Boolean(widget.dimension) && rows.length > widget.limit
    // Time series drop the oldest extra period; rankings drop the last.
    return { rows: !truncated ? rows : isTimeSeries(widget) ? rows.slice(rows.length - widget.limit) : rows.slice(0, widget.limit), truncated }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (err instanceof WidgetQueryError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new WidgetQueryError(/statement timeout/i.test(msg) ? 'The query took too long. Add a filter or group by a coarser column.' : `Query failed: ${msg}`)
  } finally {
    client.release()
  }
}

/** Runs one widget for the editor's live preview. */
async function previewWidgetImpl(rawWidget: unknown) {
  const ctx = await requireWorkspace('data:preview')
  const parsed = widgetSchema.safeParse(rawWidget)
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? 'Incomplete widget' }
  try {
    return { ok: true as const, result: await runWidget(ctx, parsed.data) }
  } catch (err) {
    return { ok: false as const, message: err instanceof Error ? err.message : 'Query failed' }
  }
}

/** Results for every widget of a dashboard; one failing widget doesn't hide the others. */
async function getDashboardDataImpl(rawId: string) {
  const ctx = await requireWorkspace('data:preview')
  const id = idSchema.parse(rawId)
  const [dash] = await db.select().from(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ctx.workspaceId))).limit(1)
  if (!dash) throw new Error('Dashboard not found')
  const widgets = parseWidgets(dash.widgets)
  const results: Record<string, { ok: true; result: WidgetResult } | { ok: false; message: string }> = {}
  for (const w of widgets) {
    try {
      results[w.id] = { ok: true, result: await runWidget(ctx, w) }
    } catch (err) {
      results[w.id] = { ok: false, message: err instanceof Error ? err.message : 'Query failed' }
    }
  }
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'dashboard', resourceId: id, changes: { what: 'dashboard', widgets: widgets.length } })
  return { generatedAt: new Date(), results }
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/analytics.ts. ──

export async function getAnalyticsDatasets(...args: Parameters<typeof getAnalyticsDatasetsImpl>) {
  return guard(() => getAnalyticsDatasetsImpl(...args))
}

export async function listDashboards(...args: Parameters<typeof listDashboardsImpl>) {
  return guard(() => listDashboardsImpl(...args))
}

export async function saveDashboard(...args: Parameters<typeof saveDashboardImpl>) {
  return guard(() => saveDashboardImpl(...args))
}

export async function deleteDashboard(...args: Parameters<typeof deleteDashboardImpl>) {
  return guard(() => deleteDashboardImpl(...args))
}

export async function previewWidget(...args: Parameters<typeof previewWidgetImpl>) {
  return guard(() => previewWidgetImpl(...args))
}

export async function getDashboardData(...args: Parameters<typeof getDashboardDataImpl>) {
  return guard(() => getDashboardDataImpl(...args))
}
