import { and, eq } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { nexusDatasets } from '@/lib/db/schema'
import type { WorkspaceContext } from '@/lib/auth/session'
import type { Widget, WidgetResult } from './definition'
import { buildWidgetSql, isTimeSeries, WidgetQueryError, type DatasetColumn } from './query'
import { accessFor } from '@/lib/governance/masking'

const QUERY_TIMEOUT = '15s'

/** Runs one widget as the caller's role: masked columns blocked, row filters applied, read-only, 15 s timeout. */
export async function runWidget(ctx: WorkspaceContext, widget: Widget): Promise<WidgetResult> {
  const [dataset] = await db
    .select({ tableName: nexusDatasets.tableName, columns: nexusDatasets.columns, lastLoadedAt: nexusDatasets.lastLoadedAt })
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, widget.dataset)))
    .limit(1)
  if (!dataset) throw new WidgetQueryError(`Dataset ${widget.dataset} no longer exists.`)
  const access = await accessFor(ctx.workspaceId, widget.dataset, ctx.role)
  const table = `"nexus_data"."${dataset.tableName.replace(/"/g, '""')}"`
  const { text, params } = buildWidgetSql(widget, table, (dataset.columns as DatasetColumn[]) ?? [], { blockedColumns: Object.keys(access.masks), rowFilters: access.rowFilters })
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
    return { rows: !truncated ? rows : isTimeSeries(widget) ? rows.slice(rows.length - widget.limit) : rows.slice(0, widget.limit), truncated, lastLoadedAt: dataset.lastLoadedAt }
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
