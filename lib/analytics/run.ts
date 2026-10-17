import { and, eq } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { nexusDatasets } from '@/lib/db/schema'
import type { WorkspaceContext } from '@/lib/auth/session'
import { applyDashboardFilters, type DashboardFilter, type DashboardFilterValues, type Widget, type WidgetResult } from './definition'
import { buildWidgetSql, isTimeSeries, WidgetQueryError, type DatasetColumn } from './query'
import { rowFilterSql } from '@/lib/governance/row-filters'
import { accessFor } from '@/lib/governance/masking'

const QUERY_TIMEOUT = '15s'

/**
 * Runs one widget as the caller's role: masked columns blocked, row filters applied, read-only, 15 s timeout.
 * Dashboard filters (DB-4) are added where the widget's dataset has their column.
 */
export async function runWidget(ctx: WorkspaceContext, input: Widget, dashboard?: { filters: DashboardFilter[]; values: DashboardFilterValues }): Promise<WidgetResult> {
  const [dataset] = await db
    .select({ tableName: nexusDatasets.tableName, columns: nexusDatasets.columns, lastLoadedAt: nexusDatasets.lastLoadedAt })
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, input.dataset)))
    .limit(1)
  if (!dataset) throw new WidgetQueryError(`Dataset ${input.dataset} no longer exists.`)
  const access = await accessFor(ctx.workspaceId, input.dataset, ctx.role)
  const columns = (dataset.columns as DatasetColumn[]) ?? []
  const scoped = dashboard ? applyDashboardFilters(input, dashboard.filters, dashboard.values, columns, new Set(Object.keys(access.masks))) : { widget: input, applied: [], skipped: [] }
  const widget = scoped.widget
  const table = `"nexus_data"."${dataset.tableName.replace(/"/g, '""')}"`
  const { text, params } = buildWidgetSql(widget, table, columns, { blockedColumns: Object.keys(access.masks), rowFilters: access.rowFilters })
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
    return { rows: !truncated ? rows : isTimeSeries(widget) ? rows.slice(rows.length - widget.limit) : rows.slice(0, widget.limit), truncated, lastLoadedAt: dataset.lastLoadedAt, filtersApplied: scoped.applied, filtersSkipped: scoped.skipped }
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

/**
 * DB-4: the values a "value" dashboard filter can take in one dataset, as the
 * caller may see them (row filters applied; a masked column offers nothing).
 */
export async function distinctValues(ctx: WorkspaceContext, datasetName: string, column: string, limit = 200): Promise<string[]> {
  const [dataset] = await db
    .select({ tableName: nexusDatasets.tableName, columns: nexusDatasets.columns })
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, datasetName)))
    .limit(1)
  const columns = ((dataset?.columns as DatasetColumn[]) ?? []).map((c) => c.name)
  if (!dataset || !columns.includes(column)) return []
  const access = await accessFor(ctx.workspaceId, datasetName, ctx.role)
  if (access.masks[column]) return []
  const params: unknown[] = []
  const bind = (v: unknown) => (params.push(v), `$${params.length}`)
  const where = ['"_nexus_deleted_at" IS NULL', `"${column.replace(/"/g, '""')}" IS NOT NULL`, ...rowFilterSql(access.rowFilters, new Set(columns), bind)]
  const table = `"nexus_data"."${dataset.tableName.replace(/"/g, '""')}"`
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`)
    const exists = (await client.query<{ r: string | null }>('SELECT to_regclass($1)::text AS r', [table])).rows[0].r
    const res = exists ? await client.query<{ v: string }>(`SELECT DISTINCT "${column.replace(/"/g, '""')}"::text AS v FROM ${table} WHERE ${where.join(' AND ')} ORDER BY 1 LIMIT ${Math.min(limit, 500)}`, params) : { rows: [] }
    await client.query('COMMIT')
    return res.rows.map((r) => r.v)
  } catch {
    await client.query('ROLLBACK').catch(() => undefined)
    return []
  } finally {
    client.release()
  }
}
