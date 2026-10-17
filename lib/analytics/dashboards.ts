import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dashboardEmbeds, dashboards } from '@/lib/db/schema'
import type { WorkspaceContext } from '@/lib/auth/session'
import { dashboardFilterSchema, widgetSchema, type DashboardFilter, type DashboardFilterValues, type Widget, type WidgetResult } from './definition'
import { runWidget } from './run'
import { embedUsable, EMBED_ROLES } from './sharing'

/** Dashboard loading shared by the Analytics actions and the embed page. Server only. */

export function parseFilters(raw: unknown): DashboardFilter[] {
  return (Array.isArray(raw) ? raw : []).flatMap((f) => {
    const parsed = dashboardFilterSchema.safeParse(f)
    return parsed.success ? [parsed.data] : []
  })
}

export function parseWidgets(raw: unknown): Widget[] {
  return (Array.isArray(raw) ? raw : []).flatMap((w) => {
    const parsed = widgetSchema.safeParse(w)
    return parsed.success ? [parsed.data] : []
  })
}

export type WidgetOutcome = { ok: true; result: WidgetResult } | { ok: false; message: string }

/** Every widget's result as `ctx` (its role's masks and row filters); one failing widget doesn't hide the others. */
export async function dashboardResults(ctx: WorkspaceContext, widgets: Widget[], filters: DashboardFilter[], values: DashboardFilterValues) {
  const results: Record<string, WidgetOutcome> = {}
  for (const w of widgets) {
    try {
      results[w.id] = { ok: true, result: await runWidget(ctx, w, { filters, values }) }
    } catch (err) {
      results[w.id] = { ok: false, message: err instanceof Error ? err.message : 'Query failed' }
    }
  }
  return results
}

export const embedTokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** The embed behind a token, with its dashboard, or null when unknown, revoked or expired. */
export async function loadEmbed(token: string) {
  if (!/^nxe_[A-Za-z0-9_-]{20,80}$/.test(token)) return null
  const [embed] = await db.select().from(dashboardEmbeds).where(eq(dashboardEmbeds.tokenHash, embedTokenHash(token))).limit(1)
  if (!embed || !embedUsable(embed)) return null
  const [dash] = await db.select().from(dashboards).where(and(eq(dashboards.id, embed.dashboardId), eq(dashboards.workspaceId, embed.workspaceId))).limit(1)
  if (!dash) return null
  const role = (EMBED_ROLES as readonly string[]).includes(embed.role) ? (embed.role as (typeof EMBED_ROLES)[number]) : 'viewer'
  return { embed: { ...embed, role, allowedOrigins: (embed.allowedOrigins as string[]) ?? [] }, dashboard: dash }
}

export async function countEmbedView(id: string) {
  await db.update(dashboardEmbeds).set({ views: sql`${dashboardEmbeds.views} + 1`, lastUsedAt: new Date() }).where(eq(dashboardEmbeds.id, id))
}
