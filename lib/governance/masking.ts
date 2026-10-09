import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { datasetPolicies } from '@/lib/db/schema'
import { can, type Role } from '@/lib/auth/permissions'
import { columnPolicySchema, type ColumnPolicy, type Mask } from './definition'

/**
 * Applies dataset policies (GV-5). Server-only. Roles with data:unmasked
 * (admin, steward) see real values; everyone else gets masked values in
 * dataset previews, and masked columns are unavailable in Analytics.
 */

export function maskValue(value: unknown, mask: Mask): unknown {
  if (mask === 'none' || value === null || value === undefined || value === '') return value
  const s = value instanceof Date ? value.toISOString() : String(value)
  switch (mask) {
    case 'full':
      return '••••••'
    case 'partial':
      return s.length > 4 ? `••••${s.slice(-4)}` : '••••'
    case 'hash':
      // Stable pseudonym: the same value always gives the same token, so joins and counts still line up.
      return createHash('sha256').update(s).digest('hex').slice(0, 12)
  }
}

export async function loadPolicy(workspaceId: string, datasetName: string) {
  const [row] = await db
    .select()
    .from(datasetPolicies)
    .where(and(eq(datasetPolicies.workspaceId, workspaceId), eq(datasetPolicies.datasetName, datasetName)))
    .limit(1)
  if (!row) return null
  const columns: Record<string, ColumnPolicy> = {}
  for (const [name, raw] of Object.entries((row.columns ?? {}) as Record<string, unknown>)) {
    const parsed = columnPolicySchema.safeParse(raw)
    if (parsed.success) columns[name] = parsed.data
  }
  return { ...row, columns }
}

/** Masks for this role: column → mask, empty when the role may see real values. */
export async function masksFor(workspaceId: string, datasetName: string, role: Role): Promise<Record<string, Mask>> {
  if (can(role, 'data:unmasked')) return {}
  const policy = await loadPolicy(workspaceId, datasetName)
  const masks: Record<string, Mask> = {}
  for (const [name, p] of Object.entries(policy?.columns ?? {})) if (p.mask !== 'none') masks[name] = p.mask
  return masks
}

export function applyMasks<T extends Record<string, unknown>>(rows: T[], masks: Record<string, Mask>): T[] {
  const cols = Object.keys(masks)
  if (!cols.length) return rows
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row }
    for (const c of cols) if (c in out) out[c] = maskValue(out[c], masks[c])
    return out as T
  })
}
