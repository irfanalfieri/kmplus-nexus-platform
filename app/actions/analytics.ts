'use server'

import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, pool } from '@/lib/db'
import { dashboardEmbeds, dashboards, nexusDatasets, workspaceMembers } from '@/lib/db/schema'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { dashboardFilterValuesSchema, dashboardInputSchema, widgetSchema } from '@/lib/analytics/definition'
import { dashboardResults, embedTokenHash, parseFilters, parseWidgets } from '@/lib/analytics/dashboards'
import { canSeeDashboard, dashboardSharingSchema, embedInputSchema, embedUsable, parseSharing } from '@/lib/analytics/sharing'
import { appUrl } from '@/lib/email'
import { type DatasetColumn } from '@/lib/analytics/query'
import { distinctValues, runWidget } from '@/lib/analytics/run'
import { diffObjects } from '@/lib/audit-diff'
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

/** A dashboard the caller may see (DB-5 sharing); others answer "not found". */
async function visibleDashboard(ctx: WorkspaceContext, id: string) {
  const [dash] = await db.select().from(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ctx.workspaceId))).limit(1)
  if (!dash || !canSeeDashboard(parseSharing(dash.sharing), ctx, dash.createdBy)) throw new Error('Dashboard not found')
  return dash
}

/** Sharing and embedding a dashboard: its creator or an admin, with the right to edit dashboards. */
const canShare = (ctx: WorkspaceContext, dash: { createdBy: string }) => can(ctx.role, 'dashboards:edit') && (ctx.role === 'admin' || dash.createdBy === ctx.userId)

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
    .select({ id: dashboards.id, name: dashboards.name, description: dashboards.description, widgets: dashboards.widgets, filters: dashboards.filters, sharing: dashboards.sharing, createdBy: dashboards.createdBy, updatedAt: dashboards.updatedAt })
    .from(dashboards)
    .where(eq(dashboards.workspaceId, ctx.workspaceId))
    .orderBy(desc(dashboards.updatedAt))
  return {
    canEdit: can(ctx.role, 'dashboards:edit'),
    canView: can(ctx.role, 'data:preview'),
    canEmbed: can(ctx.role, 'workspace:manage'),
    dashboards: rows
      .map((r) => ({ ...r, sharing: parseSharing(r.sharing) }))
      .filter((r) => canSeeDashboard(r.sharing, ctx, r.createdBy))
      .map((r) => ({ id: r.id, name: r.name, description: r.description ?? '', widgets: parseWidgets(r.widgets), filters: parseFilters(r.filters), sharing: r.sharing, canShare: canShare(ctx, r), updatedAt: r.updatedAt })),
  }
}

async function saveDashboardImpl(input: z.input<typeof dashboardInputSchema>) {
  const ctx = await requireWorkspace('dashboards:edit')
  const data = dashboardInputSchema.parse(input)
  const known = new Set((await datasetsOf(ctx.workspaceId)).map((d) => d.name))
  const missing = data.widgets.flatMap((w) => [w.dataset, ...(w.join ? [w.join.dataset] : [])]).filter((name) => !known.has(name))
  if (missing.length) throw new Error(`Unknown dataset(s): ${[...new Set(missing)].join(', ')}`)
  const now = new Date()
  let id = data.id
  if (id) {
    await visibleDashboard(ctx, id)
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
  await visibleDashboard(ctx, id)
  await db.delete(dashboards).where(and(eq(dashboards.id, id), eq(dashboards.workspaceId, ctx.workspaceId)))
  // Its embed links stop working with it.
  await db.update(dashboardEmbeds).set({ revokedAt: new Date() }).where(and(eq(dashboardEmbeds.dashboardId, id), eq(dashboardEmbeds.workspaceId, ctx.workspaceId)))
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
  const dash = await visibleDashboard(ctx, id)
  const widgets = parseWidgets(dash.widgets)
  const results = await dashboardResults(ctx, widgets, parseFilters(dash.filters), values)
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'dashboard', resourceId: id, changes: { what: 'dashboard', widgets: widgets.length, filtered: Object.keys(values).length || undefined } })
  return { generatedAt: new Date(), results }
}

/** DB-4: the choices of each "value" filter, from the dashboard's widget datasets that have its column. */
async function getDashboardFilterOptionsImpl(rawId: string) {
  const ctx = await requireWorkspace('data:preview')
  const id = idSchema.parse(rawId)
  const dash = await visibleDashboard(ctx, id)
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

/** DB-5: who sees a dashboard (the whole workspace, or chosen roles and people). */
async function setDashboardSharingImpl(rawId: string, input: z.input<typeof dashboardSharingSchema>) {
  const ctx = await requireWorkspace('dashboards:edit')
  const dash = await visibleDashboard(ctx, idSchema.parse(rawId))
  if (!canShare(ctx, dash)) throw new Error('Only the dashboard’s creator or an admin can change who sees it')
  const sharing = dashboardSharingSchema.parse(input)
  const members = sharing.userIds.length
    ? new Set((await db.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), inArray(workspaceMembers.userId, sharing.userIds)))).map((m) => m.id))
    : new Set<string>()
  const next = { ...sharing, userIds: sharing.userIds.filter((u) => members.has(u)) }
  const before = parseSharing(dash.sharing)
  await db.update(dashboards).set({ sharing: next, updatedAt: new Date() }).where(eq(dashboards.id, dash.id))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'dashboard', resourceId: dash.id, changes: { name: dash.name, sharing: next.mode }, diff: diffObjects(before, next) })
  revalidatePath('/dashboard', 'layout')
  return next
}

/** DB-5: a dashboard's embed links (never their tokens). */
async function listDashboardEmbedsImpl(rawId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const dash = await visibleDashboard(ctx, idSchema.parse(rawId))
  const rows = await db
    .select()
    .from(dashboardEmbeds)
    .where(and(eq(dashboardEmbeds.dashboardId, dash.id), eq(dashboardEmbeds.workspaceId, ctx.workspaceId)))
    .orderBy(desc(dashboardEmbeds.createdAt))
  return rows.map(({ tokenHash: _hash, ...e }) => ({ ...e, allowedOrigins: (e.allowedOrigins as string[]) ?? [], usable: embedUsable(e) }))
}

/** DB-5: a secret link that shows the dashboard read-only inside the allowed sites. The URL is returned once. */
async function createDashboardEmbedImpl(rawId: string, input: z.input<typeof embedInputSchema>) {
  const ctx = await requireWorkspace('workspace:manage')
  const dash = await visibleDashboard(ctx, idSchema.parse(rawId))
  const data = embedInputSchema.parse(input)
  const id = newId('emb')
  const token = `nxe_${randomBytes(24).toString('base64url')}`
  const expiresAt = data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null
  await db.insert(dashboardEmbeds).values({
    id,
    workspaceId: ctx.workspaceId,
    dashboardId: dash.id,
    tokenHash: embedTokenHash(token),
    label: data.label,
    role: data.role,
    allowedOrigins: Array.from(new Set(data.allowedOrigins)),
    expiresAt,
    createdBy: ctx.userId,
  })
  await recordAudit(ctx, { action: 'CREATE', resource: 'dashboard_embed', resourceId: id, changes: { dashboard: dash.name, role: data.role, allowedOrigins: data.allowedOrigins, expiresAt: expiresAt?.toISOString() ?? null } })
  revalidatePath('/dashboard', 'layout')
  return { id, url: `${appUrl()}/embed/dashboards/${token}` }
}

async function revokeDashboardEmbedImpl(rawEmbedId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const id = idSchema.parse(rawEmbedId)
  const updated = await db
    .update(dashboardEmbeds)
    .set({ revokedAt: new Date() })
    .where(and(eq(dashboardEmbeds.id, id), eq(dashboardEmbeds.workspaceId, ctx.workspaceId)))
    .returning({ dashboardId: dashboardEmbeds.dashboardId })
  if (!updated.length) throw new Error('Embed link not found')
  await recordAudit(ctx, { action: 'DELETE', resource: 'dashboard_embed', resourceId: id, changes: { dashboardId: updated[0].dashboardId } })
  revalidatePath('/dashboard', 'layout')
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

export async function setDashboardSharing(...args: Parameters<typeof setDashboardSharingImpl>) {
  return guard(() => setDashboardSharingImpl(...args))
}

export async function listDashboardEmbeds(...args: Parameters<typeof listDashboardEmbedsImpl>) {
  return guard(() => listDashboardEmbedsImpl(...args))
}

export async function createDashboardEmbed(...args: Parameters<typeof createDashboardEmbedImpl>) {
  return guard(() => createDashboardEmbedImpl(...args))
}

export async function revokeDashboardEmbed(...args: Parameters<typeof revokeDashboardEmbedImpl>) {
  return guard(() => revokeDashboardEmbedImpl(...args))
}
