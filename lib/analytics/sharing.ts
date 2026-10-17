import { z } from 'zod'
import { ROLES, type Role } from '@/lib/auth/permissions'
import { DATE_PRESETS, type DashboardFilter, type DashboardFilterValues } from './definition'

/**
 * Dashboard sharing and embedding (DB-5). Pure and client-safe; covered by
 * scripts/engine-tests.ts.
 *
 * - Sharing: a dashboard is seen by the whole workspace (default) or only by
 *   chosen roles and people (its creator and admins always see it).
 * - Embedding: a secret link renders the dashboard read-only inside a KMPlus
 *   app, queried as a role without unmasked access (viewer or analyst), only
 *   inside the allowed sites (CSP frame-ancestors), until it expires.
 */

export const SHARING_MODES = ['workspace', 'restricted'] as const
export const dashboardSharingSchema = z.object({
  mode: z.enum(SHARING_MODES).default('workspace'),
  roles: z.array(z.enum(ROLES)).max(ROLES.length).default([]),
  userIds: z.array(z.string().min(1).max(100)).max(100).default([]),
})
export type DashboardSharing = z.infer<typeof dashboardSharingSchema>
export const WORKSPACE_SHARING: DashboardSharing = dashboardSharingSchema.parse({})

export function parseSharing(raw: unknown): DashboardSharing {
  const parsed = dashboardSharingSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : WORKSPACE_SHARING
}

/** Who sees a dashboard: everyone, or its creator, admins, and the chosen roles and people. */
export function canSeeDashboard(sharing: DashboardSharing, viewer: { userId: string; role: Role }, createdBy: string) {
  if (sharing.mode === 'workspace') return true
  return viewer.role === 'admin' || viewer.userId === createdBy || sharing.roles.includes(viewer.role) || sharing.userIds.includes(viewer.userId)
}

/** Embeds query as a role that never sees unmasked data. */
export const EMBED_ROLES = ['viewer', 'analyst'] as const satisfies readonly Role[]

const ORIGIN = /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/

export const embedInputSchema = z.object({
  role: z.enum(EMBED_ROLES).default('viewer'),
  /** Sites allowed to show the dashboard in a frame, e.g. https://kms.kmplus.co.id or https://*.kmplus.co.id. */
  allowedOrigins: z
    .array(z.string().trim().toLowerCase().max(200).refine((o) => ORIGIN.test(o) || LOCAL_ORIGIN.test(o), 'Enter sites as https://host (a leading *. allows subdomains)'))
    .min(1, 'Add at least one site that may show the dashboard')
    .max(10),
  /** Days until the link stops working; null = until revoked. */
  expiresInDays: z.number().int().min(1).max(365).nullable().default(90),
  label: z.string().trim().max(80).default(''),
})
export type EmbedInput = z.infer<typeof embedInputSchema>

/** The Content-Security-Policy for an embed page. */
export function embedCsp(origins: string[]) {
  const ancestors = origins.filter((o) => ORIGIN.test(o) || LOCAL_ORIGIN.test(o))
  return `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`
}

/**
 * Filter choices passed by the host app in the embed URL:
 * `?f.<filterId>=<value>` for a value filter, `?f.<filterId>=30d` (a preset)
 * or `?f.<filterId>.from=2026-01-01&f.<filterId>.to=2026-03-31` for a date filter.
 */
export function embedFilterValues(filters: DashboardFilter[], params: Record<string, string | string[] | undefined>): DashboardFilterValues {
  const one = (key: string) => {
    const v = params[key]
    return (Array.isArray(v) ? v[0] : v)?.slice(0, 200)
  }
  const ymd = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const out: DashboardFilterValues = {}
  for (const f of filters) {
    if (f.kind === 'value') {
      const value = one(`f.${f.id}`)
      if (value) out[f.id] = { value }
      continue
    }
    const preset = one(`f.${f.id}`)
    const from = ymd(one(`f.${f.id}.from`))
    const to = ymd(one(`f.${f.id}.to`))
    if (from || to) out[f.id] = { preset: 'custom', from, to }
    else if (preset && (DATE_PRESETS as readonly string[]).includes(preset)) out[f.id] = { preset: preset as (typeof DATE_PRESETS)[number] }
  }
  return out
}

/** Whether an embed link can still be used. */
export function embedUsable(embed: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()) {
  return !embed.revokedAt && (!embed.expiresAt || embed.expiresAt > now)
}
