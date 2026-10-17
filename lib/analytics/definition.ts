import { z } from 'zod'

/**
 * Analytics dashboards (PRD Layer 10, DB-1/DB-2). Client-safe: the widget
 * editor and the query builder (lib/analytics/query.ts) share this schema.
 * A widget is a no-SQL query: one measure, optionally grouped by a dimension,
 * over one workspace dataset, with filters.
 */

export const WIDGET_TYPES = ['kpi', 'bar', 'line', 'table'] as const
export const AGGREGATIONS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const
export const GRAINS = ['none', 'day', 'week', 'month', 'quarter', 'year'] as const
export const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'not_empty'] as const
export const SORTS = ['value_desc', 'value_asc', 'label_asc', 'label_desc'] as const

export type WidgetType = (typeof WIDGET_TYPES)[number]
export type Aggregation = (typeof AGGREGATIONS)[number]

export const WIDGET_TYPE_INFO: Record<WidgetType, string> = { kpi: 'Single number', bar: 'Bar chart', line: 'Line chart (over time)', table: 'Table' }
export const AGG_INFO: Record<Aggregation, string> = { count: 'Count rows', count_distinct: 'Count distinct', sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' }
export const FILTER_OP_INFO: Record<(typeof FILTER_OPS)[number], string> = {
  eq: 'is', neq: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: 'contains', empty: 'is empty', not_empty: 'is not empty',
}
export const SORT_INFO: Record<(typeof SORTS)[number], string> = { value_desc: 'Largest first', value_asc: 'Smallest first', label_asc: 'Label A→Z', label_desc: 'Label Z→A' }

/** Column types (from the pipeline's output columns) that numeric aggregations accept. */
export const NUMERIC_TYPES = ['integer', 'numeric'] as const
export const TIME_TYPES = ['date', 'timestamp'] as const

export const filterSchema = z.object({
  column: z.string().min(1).max(128),
  op: z.enum(FILTER_OPS),
  value: z.string().max(200).default(''),
})

export const widgetSchema = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().trim().max(120).default(''),
    type: z.enum(WIDGET_TYPES),
    dataset: z.string().trim().min(1, 'Choose a dataset').max(63),
    measure: z.object({ agg: z.enum(AGGREGATIONS), column: z.string().max(128).default('') }),
    dimension: z.object({ column: z.string().min(1).max(128), grain: z.enum(GRAINS).default('none') }).nullable().default(null),
    filters: z.array(filterSchema).max(10).default([]),
    sort: z.enum(SORTS).default('value_desc'),
    limit: z.number().int().min(1).max(100).default(12),
    size: z.enum(['small', 'wide']).default('small'),
  })
  .superRefine((w, ctx) => {
    if (w.measure.agg !== 'count' && !w.measure.column) ctx.addIssue({ code: 'custom', path: ['measure', 'column'], message: 'Choose the column to aggregate' })
    if (w.type === 'kpi' && w.dimension) ctx.addIssue({ code: 'custom', path: ['dimension'], message: 'A single number has no "group by"' })
    if (w.type !== 'kpi' && !w.dimension) ctx.addIssue({ code: 'custom', path: ['dimension'], message: 'Choose a column to group by' })
  })
export type Widget = z.infer<typeof widgetSchema>

/** A date range or one value (e.g. an org unit), applied to every widget whose dataset has the column. */
export const DASHBOARD_FILTER_KINDS = ['date', 'value'] as const
export const dashboardFilterSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1, 'Name the filter').max(60),
  kind: z.enum(DASHBOARD_FILTER_KINDS),
  column: z.string().min(1).max(128),
})
export type DashboardFilter = z.infer<typeof dashboardFilterSchema>

export const dashboardInputSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).default(''),
  widgets: z.array(widgetSchema).max(24, 'A dashboard holds up to 24 widgets').default([]),
  /** DB-4: filters shown above the widgets and applied to all of them. */
  /** Omitted = keep the saved filters. */
  filters: z.array(dashboardFilterSchema).max(4, 'A dashboard has up to 4 filters').optional(),
})

/** Query result: one row per group (KPI: one row with label null). */
export interface WidgetResult {
  rows: { label: string | null; value: number | null }[]
  /** True when more groups exist than the limit. */
  truncated: boolean
  /** When the dataset was last loaded (DV-4). */
  lastLoadedAt?: Date | string | null
  /** DB-4: dashboard filters applied to this widget, and those its dataset can't take. */
  filtersApplied?: string[]
  filtersSkipped?: { id: string; reason: 'missing' | 'masked' | 'type' }[]
}

export function describeMeasure(w: Pick<Widget, 'measure'>) {
  return w.measure.agg === 'count' ? 'Rows' : `${AGG_INFO[w.measure.agg]} of ${w.measure.column}`
}

export function defaultTitle(w: Pick<Widget, 'measure' | 'dimension' | 'dataset'>) {
  const measure = describeMeasure(w)
  return w.dimension ? `${measure} by ${w.dimension.column}${w.dimension.grain !== 'none' ? ` (${w.dimension.grain})` : ''}` : `${measure} · ${w.dataset}`
}

// ── Dashboard-wide filters (DB-4) ────────────────────────────────────────────


export const DATE_PRESETS = ['all', '7d', '30d', '90d', '365d', 'ytd', 'custom'] as const
export type DatePreset = (typeof DATE_PRESETS)[number]

/** What a viewer picked for each filter (not saved with the dashboard). */
export const dashboardFilterValuesSchema = z
  .record(
    z.string().max(64),
    z.object({
      preset: z.enum(DATE_PRESETS).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      value: z.string().max(200).optional(),
    })
  )
  .default({})
export type DashboardFilterValues = z.infer<typeof dashboardFilterValuesSchema>

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** The days a date filter covers ([from, to], both inclusive), or null for all time. */
export function dateRange(v: DashboardFilterValues[string] | undefined, now = new Date()): { from: string | null; to: string | null } | null {
  const preset = v?.preset ?? 'all'
  if (preset === 'all') return null
  if (preset === 'custom') return v?.from || v?.to ? { from: v.from ?? null, to: v.to ?? null } : null
  if (preset === 'ytd') return { from: `${now.getUTCFullYear()}-01-01`, to: ymd(now) }
  const days = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }[preset]
  return { from: ymd(new Date(now.getTime() - (days - 1) * 86_400_000)), to: ymd(now) }
}

/**
 * A widget with the dashboard's filters added as its own conditions, where its
 * dataset has the column (and the viewer may use it). Skipped filters say why.
 */
export function applyDashboardFilters(
  widget: Widget,
  filters: DashboardFilter[],
  values: DashboardFilterValues,
  columns: { name: string; type: string }[],
  blocked: ReadonlySet<string> = new Set(),
  now = new Date()
): { widget: Widget; applied: string[]; skipped: { id: string; reason: 'missing' | 'masked' | 'type' }[] } {
  const extra: Widget['filters'] = []
  const applied: string[] = []
  const skipped: { id: string; reason: 'missing' | 'masked' | 'type' }[] = []
  for (const f of filters) {
    const v = values[f.id]
    const active = f.kind === 'date' ? dateRange(v, now) : v?.value ? { value: v.value } : null
    if (!active) continue
    const col = columns.find((c) => c.name === f.column)
    if (!col) {
      skipped.push({ id: f.id, reason: 'missing' })
      continue
    }
    if (blocked.has(f.column)) {
      skipped.push({ id: f.id, reason: 'masked' })
      continue
    }
    if (f.kind === 'date') {
      if (!(TIME_TYPES as readonly string[]).includes(col.type)) {
        skipped.push({ id: f.id, reason: 'type' })
        continue
      }
      const range = active as { from: string | null; to: string | null }
      if (range.from) extra.push({ column: f.column, op: 'gte', value: range.from })
      // "to" is a whole day: before the next one.
      if (range.to) extra.push({ column: f.column, op: 'lt', value: ymd(new Date(Date.parse(`${range.to}T00:00:00Z`) + 86_400_000)) })
    } else {
      extra.push({ column: f.column, op: 'eq', value: (active as { value: string }).value })
    }
    applied.push(f.id)
  }
  return { widget: extra.length ? { ...widget, filters: [...widget.filters, ...extra] } : widget, applied, skipped }
}
