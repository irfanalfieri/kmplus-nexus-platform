'use server'

import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, pool } from '@/lib/db'
import { dashboards, nexusDatasets } from '@/lib/db/schema'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { dashboardFilterSchema, dashboardFilterValuesSchema, dashboardInputSchema, widgetSchema, type DashboardFilter, type Widget, type WidgetResult } from '@/lib/analytics/definition'
import { type DatasetColumn } from '@/lib/analytics/query'
import { distinctValues, runWidget } from '@/lib/analytics/run'
import { accessFor, masksFor } from '@/lib/governance/masking'
import { guard } from '@/lib/server-action'

const idSchema = z.string().trim().min(1).max(100)

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
    .select({ id: dashboards.id, name: dashboards.name, description: dashboards.description, widgets: dashboards.widgets, filters: dashboards.filters, updatedAt: dashboards.updatedAt })
    .from(dashboards)
    .where(eq(dashboards.workspaceId, ctx.workspaceId))
    .orderBy(desc(dashboards.updatedAt))
  return {
    canEdit: can(ctx.role, 'dashboards:edit'),
    canView: can(ctx.role, 'data:preview'),
    dashboards: rows.map((r) => ({ id: r.id, name: r.name, description: r.description ?? '', widgets: parseWidgets(r.widgets), filters: parseFilters(r.filters), updatedAt: r.updatedAt })),
  }
}

function parseFilters(raw: unknown): DashboardFilter[] {
  return (Array.isArray(raw) ? raw : []).flatMap((f) => {
    const parsed = dashboardFilterSchema.safeParse(f)
    return parsed.success ? [parsed.data] : []
  })
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
      .set({ name: data.name, description: data.description, widgets: data.widgets, ...(data.filters ? { filters: data.filters } : {}), updatedAt: now })
      .where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ctx.workspaceId)))
      .returning({ id: dashboards.id })
    if (!updated.length) throw new Error('Dashboard not found')
  } else {
    id = newId('dash')
    await db.insert(dashboards).values({ id, workspaceId: ctx.workspaceId, name: data.name, description: data.description, widgets: data.widgets, filters: data.filters ?? [], createdBy: ctx.userId })
  }
  await recordAudit(ctx, { action: data.id ? 'UPDATE' : 'CREATE', resource: 'dashboard', resourceId: id, changes: { name: data.name, widgets: data.widgets.length, ...(data.filters ? { filters: data.filters.map((f) => f.label) } : {}) } })
  revalidatePath('/dashboard', 'layout')
  return { id }
}

async function deleteDashboardImpl(rawId: string) {
  const ctx = await requireWorkspace('dashboards:edit')
  const id = idSchema.parse(rawId)
  await db.delete(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ctx.workspaceId)))
  await recordAudit(ctx, { action: 'DELETE', resource: 'dashboard', resourceId: id })
  revalidatePath('/dashboard', 'layout')
}

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

/** Results for every widget of a dashboard, with the viewer's filter choices (DB-4); one failing widget doesn't hide the others. */
async function getDashboardDataImpl(rawId: string, rawValues: unknown = {}) {
  const ctx = await requireWorkspace('data:preview')
  const id = idSchema.parse(rawId)
  const values = dashboardFilterValuesSchema.parse(rawValues ?? {})
  const [dash] = await db.select().from(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ctx.workspaceId))).limit(1)
  if (!dash) throw new Error('Dashboard not found')
  const widgets = parseWidgets(dash.widgets)
  const filters = parseFilters(dash.filters)
  const results: Record<string, { ok: true; result: WidgetResult } | { ok: false; message: string }> = {}
  for (const w of widgets) {
    try {
      results[w.id] = { ok: true, result: await runWidget(ctx, w, { filters, values }) }
    } catch (err) {
      results[w.id] = { ok: false, message: err instanceof Error ? err.message : 'Query failed' }
    }
  }
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'dashboard', resourceId: id, changes: { what: 'dashboard', widgets: widgets.length, filtered: Object.keys(values).length || undefined } })
  return { generatedAt: new Date(), results }
}

/** DB-4: the choices of each "value" filter, from the dashboard's widget datasets that have its column. */
async function getDashboardFilterOptionsImpl(rawId: string) {
  const ctx = await requireWorkspace('data:preview')
  const id = idSchema.parse(rawId)
  const [dash] = await db.select().from(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ctx.workspaceId))).limit(1)
  if (!dash) throw new Error('Dashboard not found')
  const datasets = [...new Set(parseWidgets(dash.widgets).map((w) => w.dataset))]
  const out: Record<string, string[]> = {}
  for (const f of parseFilters(dash.filters)) {
    if (f.kind !== 'value') continue
    const all = new Set<string>()
    for (const d of datasets) for (const v of await distinctValues(ctx, d, f.column)) all.add(v)
    out[f.id] = [...all].sort((a, b) => a.localeCompare(b)).slice(0, 300)
  }
  return out
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

export async function getDashboardFilterOptions(...args: Parameters<typeof getDashboardFilterOptionsImpl>) {
  return guard(() => getDashboardFilterOptionsImpl(...args))
}
