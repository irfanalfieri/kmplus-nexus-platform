import { z } from 'zod'
import { CACHE_REFRESH_OPTIONS } from './refresh'

/**
 * Data Catalog (PRD Layer 8) and Virtualization (Layer 9). Client-safe.
 *
 * Every Nexus dataset and every table of every data source appears in the
 * catalog automatically (DC-1). Documenting one (description, owner, tags…)
 * stores a catalog_entries row under its key.
 */

export const CATALOG_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'pii'] as const
export type CatalogClassification = (typeof CATALOG_CLASSIFICATIONS)[number]
export const CATALOG_CLASSIFICATION_INFO: Record<CatalogClassification, string> = {
  public: 'Public',
  internal: 'Internal',
  confidential: 'Confidential',
  pii: 'Personal data (PII)',
}

export const datasetKey = (name: string) => `dataset:${name}`
export const sourceKey = (dataSourceId: string, table: string) => `source:${dataSourceId}:${table}`

export function parseKey(key: string): { kind: 'dataset'; datasetName: string } | { kind: 'source_table'; dataSourceId: string; tableName: string } | null {
  if (key.startsWith('dataset:')) return { kind: 'dataset', datasetName: key.slice(8) }
  const m = /^source:([^:]+):(.+)$/.exec(key)
  return m ? { kind: 'source_table', dataSourceId: m[1], tableName: m[2] } : null
}

/** Published names follow dataset naming, since a cached table becomes a dataset of that name. */
export const aliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, 'Published names use lowercase letters, numbers and underscores, starting with a letter')

export const catalogInputSchema = z
  .object({
    key: z.string().min(1).max(400),
    description: z.string().trim().max(2000).default(''),
    ownerId: z.string().max(100).nullable().default(null),
    stewardId: z.string().max(100).nullable().default(null),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    classification: z.enum(CATALOG_CLASSIFICATIONS).default('internal'),
    columnDocs: z.record(z.string().max(128), z.string().trim().max(500)).default({}),
    // Source tables only (DV-1..3).
    accessMode: z.enum(['live', 'cached']).default('live'),
    alias: aliasSchema.nullable().default(null),
    refresh: z.enum(CACHE_REFRESH_OPTIONS).default('daily'),
    refreshAfterPipelineId: z.string().max(100).nullable().default(null),
    liveRowLimit: z.number().int().min(10).max(10_000).default(1000),
    liveTimeoutSeconds: z.number().int().min(5).max(120).default(30),
  })
  // Access settings only apply to source tables; datasets ignore them.
  .refine((d) => !d.key.startsWith('source:') || d.accessMode !== 'cached' || d.alias, { message: 'A cached table needs a published name (it becomes a dataset of that name).', path: ['alias'] })
  .refine((d) => !d.key.startsWith('source:') || d.accessMode !== 'cached' || d.refresh !== 'after_pipeline' || d.refreshAfterPipelineId, { message: 'Choose the pipeline that triggers the refresh.', path: ['refreshAfterPipelineId'] })
export type CatalogInput = z.infer<typeof catalogInputSchema>

/** "12 min ago" style freshness (DV-4). */
export function freshness(at: Date | string | null | undefined, now = Date.now()): string {
  if (!at) return 'never loaded'
  const ms = now - new Date(at).getTime()
  if (ms < 60_000) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.floor(h / 24)} days ago`
}

/** Case-insensitive search across name, description, columns, tags, owner and source (DC-2). */
export function matchesSearch(
  item: { name: string; description: string; columns: { name: string; doc?: string }[]; tags: string[]; owner?: string | null; steward?: string | null; sourceName?: string | null },
  query: string
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const hay = [item.name, item.description, ...item.columns.flatMap((c) => [c.name, c.doc ?? '']), ...item.tags.map((t) => `#${t} ${t}`), item.owner ?? '', item.steward ?? '', item.sourceName ?? '']
    .join(' ')
    .toLowerCase()
  return terms.every((t) => hay.includes(t))
}
