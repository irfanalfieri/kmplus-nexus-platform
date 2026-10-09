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

export const dashboardInputSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).default(''),
  widgets: z.array(widgetSchema).max(24, 'A dashboard holds up to 24 widgets').default([]),
})

/** Query result: one row per group (KPI: one row with label null). */
export interface WidgetResult {
  rows: { label: string | null; value: number | null }[]
  /** True when more groups exist than the limit. */
  truncated: boolean
}

export function describeMeasure(w: Pick<Widget, 'measure'>) {
  return w.measure.agg === 'count' ? 'Rows' : `${AGG_INFO[w.measure.agg]} of ${w.measure.column}`
}

export function defaultTitle(w: Pick<Widget, 'measure' | 'dimension' | 'dataset'>) {
  const measure = describeMeasure(w)
  return w.dimension ? `${measure} by ${w.dimension.column}${w.dimension.grain !== 'none' ? ` (${w.dimension.grain})` : ''}` : `${measure} · ${w.dataset}`
}
