'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { decryptCredentials } from '@/lib/security/credentials'
import { FILE_MAX_COLUMNS, FILE_MAX_ROWS, cleanTableName, dropFileTable, scanFileSchema, writeUploadPart } from '@/lib/connectors/drivers/file'
import { COLUMN_TYPES } from '@/lib/pipelines/definition'
import { guard } from '@/lib/server-action'

/** One uploaded sheet, as recorded on the data source (no values). */
export interface UploadedFile {
  table: string
  fileName: string
  sheet?: string
  columns: { name: string; type: (typeof COLUMN_TYPES)[number] }[]
  rowCount: number
  uploadedAt: string
  uploadedBy: string
}

const columnName = z
  .string()
  .trim()
  .min(1, 'Every column needs a name')
  .max(63, 'Column names can be at most 63 characters')
  .refine((n) => !n.startsWith('_nexus_'), 'Column names cannot start with _nexus_')

const partInput = z
  .object({
    dataSourceId: z.string().min(1).max(100),
    table: z.string().trim().min(1).max(40),
    fileName: z.string().trim().min(1).max(255),
    sheet: z.string().max(100).optional(),
    columns: z.array(z.object({ name: columnName, type: z.enum(COLUMN_TYPES) })).min(1).max(FILE_MAX_COLUMNS),
    rows: z.array(z.array(z.string().max(100_000).nullable())).max(20_000),
    part: z.number().int().min(0).max(1000),
    final: z.boolean(),
    mode: z.enum(['replace', 'append']),
    /** Rows sent so far including this part (checked against the limit). */
    sent: z.number().int().min(0),
  })
  .refine((d) => new Set(d.columns.map((c) => c.name.toLowerCase())).size === d.columns.length, 'Column names must be unique')
  .refine((d) => d.rows.every((r) => r.length <= d.columns.length), 'A row has more values than there are columns')
  .refine((d) => d.table === cleanTableName(d.table), 'Table names use lowercase letters, digits and _')

async function fileSource(ctx: WorkspaceContext, id: string) {
  const [source] = await db.select().from(dataSources).where(and(eq(dataSources.id, id), eq(dataSources.workspaceId, ctx.workspaceId))).limit(1)
  if (!source) throw new Error('Data source not found')
  if (source.sourceType !== 'file') throw new Error('Files can only be uploaded to a File Upload data source.')
  const storageKey = String(decryptCredentials(source.id, source.credentials).storageKey ?? '')
  if (!storageKey) throw new Error('This data source has no file storage.')
  return { source, storageKey }
}

/**
 * Stores one part of a parsed CSV/Excel sheet (the browser parses the file and
 * sends rows in parts). The final part swaps the data in (replace) and records
 * the sheet on the data source.
 */
async function uploadFilePartImpl(input: z.input<typeof partInput>) {
  const ctx = await requireWorkspace('sources:manage')
  const data = partInput.parse(input)
  if (data.sent > FILE_MAX_ROWS) throw new Error(`Files can have at most ${FILE_MAX_ROWS.toLocaleString()} rows. Split the file and append the parts.`)
  const { source, storageKey } = await fileSource(ctx, data.dataSourceId)
  const { rowCount } = await writeUploadPart({ storageKey, table: data.table, columns: data.columns.map((c) => c.name), rows: data.rows, part: data.part, final: data.final, mode: data.mode })
  if (!data.final) return { rowCount: null }

  const config = (source.config ?? {}) as { files?: UploadedFile[]; schemaScan?: unknown }
  const previous = (config.files ?? []).find((f) => f.table === data.table)
  // Appending keeps earlier columns' detected types unless the new file disagrees.
  const columns = data.mode === 'append' && previous ? [...previous.columns.filter((c) => !data.columns.some((n) => n.name === c.name)), ...data.columns] : data.columns
  const entry: UploadedFile = { table: data.table, fileName: data.fileName, sheet: data.sheet, columns, rowCount: rowCount ?? 0, uploadedAt: new Date().toISOString(), uploadedBy: ctx.email }
  const scan = await scanFileSchema({ storageKey })
  // Pipelines see the detected types (values stay text in nexus_raw).
  const files = [...(config.files ?? []).filter((f) => f.table !== data.table), entry]
  for (const t of scan.tables) {
    const f = files.find((x) => x.table === t.name)
    if (f) t.columns = t.columns.map((c) => ({ ...c, type: f.columns.find((x) => x.name === c.name)?.type ?? 'text' }))
  }
  await db
    .update(dataSources)
    .set({ config: { ...config, files, schemaScan: scan }, status: 'connected', lastConnected: new Date(), updatedAt: new Date() })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await recordAudit(ctx, {
    action: 'UPLOAD',
    resource: 'data_source',
    resourceId: source.id,
    changes: { table: data.table, fileName: data.fileName, sheet: data.sheet, mode: data.mode, rows: rowCount, columns: data.columns.length },
  })
  revalidatePath('/dashboard', 'layout')
  return { rowCount }
}

async function deleteFileTableImpl(rawId: string, rawTable: string) {
  const ctx = await requireWorkspace('sources:manage')
  const table = z.string().trim().min(1).max(40).parse(rawTable)
  const { source, storageKey } = await fileSource(ctx, z.string().min(1).max(100).parse(rawId))
  await dropFileTable(storageKey, table)
  const config = (source.config ?? {}) as { files?: UploadedFile[] }
  const scan = await scanFileSchema({ storageKey })
  await db
    .update(dataSources)
    .set({ config: { ...config, files: (config.files ?? []).filter((f) => f.table !== table), schemaScan: scan }, updatedAt: new Date() })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await recordAudit(ctx, { action: 'DELETE', resource: 'data_source', resourceId: source.id, changes: { table } })
  revalidatePath('/dashboard', 'layout')
}

export async function uploadFilePart(...args: Parameters<typeof uploadFilePartImpl>) {
  return guard(() => uploadFilePartImpl(...args))
}

export async function deleteFileTable(...args: Parameters<typeof deleteFileTableImpl>) {
  return guard(() => deleteFileTableImpl(...args))
}
