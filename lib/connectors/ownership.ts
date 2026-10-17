/**
 * Data source ownership, tags and environments (DS-11). Pure and client-safe;
 * covered by scripts/engine-tests.ts.
 *
 * Environments are linked workspaces (GV-7, lib/pipelines/promote.ts), each
 * with its own data sources and credentials. A source's counterpart in another
 * environment is the one promotion maps it to: same name (any case) and the
 * same connector.
 */

export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 30

/** One tag as stored: lower case, words joined with "-", letters, digits, "-", "_" and "." only. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, MAX_TAG_LENGTH)
}

/** Tags typed as a list or comma-separated text: normalized, empty and repeated ones dropped, at most MAX_TAGS. */
export function normalizeTags(raw: string | string[]): string[] {
  const parts = (Array.isArray(raw) ? raw : raw.split(',')).flatMap((t) => t.split(','))
  return [...new Set(parts.map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS)
}

/** Stored tags (jsonb) read safely. */
export function tagsOf(value: unknown): string[] {
  return Array.isArray(value) ? normalizeTags(value.filter((t): t is string => typeof t === 'string')) : []
}

export interface SourceFilter {
  /** Only sources with this tag ('' = any). */
  tag: string
  /** Only sources owned by this user id; 'none' = sources without an owner; '' = anyone. */
  owner: string
  /** Name, connector or tag contains this text. */
  text: string
}

export function matchesSourceFilter(s: { name: string; sourceType: string; tags: string[]; ownerId: string | null }, f: SourceFilter): boolean {
  if (f.tag && !s.tags.includes(f.tag)) return false
  if (f.owner === 'none' ? Boolean(s.ownerId) : f.owner && s.ownerId !== f.owner) return false
  const q = f.text.trim().toLowerCase()
  return !q || s.name.toLowerCase().includes(q) || s.sourceType.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q))
}

/** Every tag in use with how many sources carry it, most used first. */
export function tagCounts(sources: { tags: string[] }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const s of sources) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// ── Environments ──

export interface EnvSource {
  id: string
  name: string
  sourceType: string
  status: string | null
  lastConnected: string | Date | null
  healthFailures: number
  ownerId: string | null
}

/**
 * How a source stands in another environment:
 *   present  the same name and connector (what promotion maps to)
 *   conflict a source there has the name but another connector (promotion blocks)
 *   missing  nothing there yet
 */
export type CounterpartState = 'present' | 'conflict' | 'missing'

export function counterpart(source: { name: string; sourceType: string }, others: EnvSource[]): { state: CounterpartState; source: EnvSource | null } {
  const sameName = others.filter((o) => o.name.toLowerCase() === source.name.toLowerCase())
  const hit = sameName.find((o) => o.sourceType === source.sourceType)
  if (hit) return { state: 'present', source: hit }
  return sameName.length ? { state: 'conflict', source: sameName[0] } : { state: 'missing', source: null }
}

/** Health of a counterpart as one word: connected, failing (checks failing in a row), not connected. */
export function counterpartHealth(s: Pick<EnvSource, 'status' | 'healthFailures'>): 'live' | 'failing' | 'idle' {
  if (s.healthFailures > 0 || s.status === 'error') return 'failing'
  return s.status === 'connected' ? 'live' : 'idle'
}

/**
 * What a copy into another environment keeps of a source's configuration:
 * its role and limits, never its credentials, agent link, scan or files
 * (the other environment connects to its own system).
 */
export function copyableConfig(config: unknown): Record<string, unknown> {
  const c = (config ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = { role: c.role === 'destination' ? 'destination' : 'source' }
  if (typeof c.maxCallsPerRun === 'number') out.maxCallsPerRun = c.maxCallsPerRun
  return out
}
