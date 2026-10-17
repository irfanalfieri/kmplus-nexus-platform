import { JOIN_PREFIX, NUMERIC_TYPES, TIME_TYPES, isJoinedColumn, type Widget } from './definition'
import { rowFilterSql, type RowFilter } from '@/lib/governance/row-filters'

/**
 * Builds the SQL for one widget (pure; covered by scripts/engine-tests.ts).
 * Identifiers are only ever dataset column names checked against the
 * dataset's column list and quoted; every user value is a bind parameter.
 */

export interface DatasetColumn {
  name: string
  type: string
}

export class WidgetQueryError extends Error {}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`

export function buildWidgetSql(
  widget: Widget,
  table: string,
  columns: DatasetColumn[],
  opts: {
    blockedColumns?: string[]
    /** Row-level policy filters for the viewer's role. */
    rowFilters?: RowFilter[]
    /** DB-3: the joined dataset, with the viewer's masks and row filters for it. */
    join?: { table: string; columns: DatasetColumn[]; blockedColumns?: string[]; rowFilters?: RowFilter[] }
  } = {}
): { text: string; params: unknown[] } {
  const byName = new Map(columns.map((c) => [c.name, c]))
  const blocked = new Set(opts.blockedColumns ?? [])
  if (widget.join && !opts.join) throw new WidgetQueryError(`Dataset ${widget.join.dataset} no longer exists.`)
  const joined = widget.join && opts.join ? { spec: widget.join, ...opts.join, byName: new Map(opts.join.columns.map((c) => [c.name, c])), blocked: new Set(opts.join.blockedColumns ?? []) } : null
  /** Column refs are qualified (b. / j.) only when the widget joins a second dataset. */
  const refs = new Map<DatasetColumn, string>()
  const col = (name: string) => {
    if (joined && isJoinedColumn(name) && !byName.has(name)) {
      const bare = name.slice(JOIN_PREFIX.length)
      const c = joined.byName.get(bare)
      if (!c) throw new WidgetQueryError(`Column "${bare}" is not in dataset ${joined.spec.dataset}.`)
      if (joined.blocked.has(bare)) throw new WidgetQueryError(`Column "${bare}" is masked by a dataset policy, so it can't be used in Analytics with your role.`)
      const out = { ...c }
      refs.set(out, `j.${q(c.name)}`)
      return out
    }
    const c = byName.get(name)
    if (!c) throw new WidgetQueryError(`Column "${name}" is not in dataset ${widget.dataset}.`)
    if (blocked.has(name)) throw new WidgetQueryError(`Column "${name}" is masked by a dataset policy, so it can't be used in Analytics with your role.`)
    const out = { ...c }
    refs.set(out, joined ? `b.${q(c.name)}` : q(c.name))
    return out
  }
  const ref = (c: DatasetColumn) => refs.get(c) ?? q(c.name)
  const isNumeric = (c: DatasetColumn) => (NUMERIC_TYPES as readonly string[]).includes(c.type)
  const isTime = (c: DatasetColumn) => (TIME_TYPES as readonly string[]).includes(c.type)
  const params: unknown[] = []
  const bind = (v: unknown) => {
    params.push(v)
    return `$${params.length}`
  }

  // Measure
  const { agg, column } = widget.measure
  let measure: string
  if (agg === 'count') measure = 'count(*)'
  else {
    const c = col(column)
    if ((agg === 'sum' || agg === 'avg') && !isNumeric(c)) throw new WidgetQueryError(`${agg === 'sum' ? 'Sum' : 'Average'} needs a number column; "${c.name}" is ${c.type}.`)
    if ((agg === 'min' || agg === 'max') && !isNumeric(c) && !isTime(c)) throw new WidgetQueryError(`Minimum/maximum needs a number or date column; "${c.name}" is ${c.type}.`)
    // Explicit casts: datasets created before type hints may store numbers and dates as text.
    const typed = isNumeric(c) ? `${ref(c)}::numeric` : isTime(c) ? `${ref(c)}::timestamptz` : ref(c)
    measure = agg === 'count_distinct' ? `count(DISTINCT ${ref(c)})` : `${agg}(${typed})`
  }

  // Soft-deleted rows (PD-6) are never counted; row-level policies come first.
  const baseWhere = ['"_nexus_deleted_at" IS NULL', ...rowFilterSql(opts.rowFilters ?? [], new Set(columns.map((c) => c.name)), bind)]
  let from = table
  const where: string[] = joined ? [] : baseWhere
  if (joined) {
    // Each side keeps its own soft-delete rule and the viewer's row filters; the joined side gives one row per key.
    const left = col(joined.spec.left)
    const right = col(joinedColumnName(joined.spec.right))
    const jWhere = ['"_nexus_deleted_at" IS NULL', ...rowFilterSql(joined.rowFilters ?? [], new Set(joined.columns.map((c) => c.name)), bind)]
    const rk = `${q(right.name)}::text`
    from =
      `(SELECT * FROM ${table} WHERE ${baseWhere.join(' AND ')}) b ` +
      `${joined.spec.kind === 'inner' ? 'JOIN' : 'LEFT JOIN'} (SELECT DISTINCT ON (${rk}) * FROM ${joined.table} WHERE ${jWhere.join(' AND ')} ORDER BY ${rk}, "_nexus_loaded_at" DESC NULLS LAST) j ` +
      `ON ${ref(left)}::text = ${ref(right)}::text`
  }
  for (const f of widget.filters) {
    const c = col(f.column)
    const ref = refs.get(c) ?? q(c.name)
    const typed = (v: string) => (isNumeric(c) ? `${bind(v)}::numeric` : isTime(c) ? `${bind(v)}::timestamptz` : bind(v))
    const lhs = isNumeric(c) ? `${ref}::numeric` : isTime(c) ? `${ref}::timestamptz` : `${ref}::text`
    switch (f.op) {
      case 'eq':
        where.push(`${ref}::text = ${bind(f.value)}`)
        break
      case 'neq':
        where.push(`(${ref} IS NULL OR ${ref}::text <> ${bind(f.value)})`)
        break
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        if ((isNumeric(c) && !/^-?\d+(\.\d+)?$/.test(f.value.trim())) || (isTime(c) && Number.isNaN(Date.parse(f.value)))) {
          throw new WidgetQueryError(`Filter on "${c.name}" needs a ${isNumeric(c) ? 'number' : 'date'}.`)
        }
        const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op]
        where.push(`${lhs} ${op} ${typed(f.value.trim())}`)
        break
      }
      case 'contains':
        where.push(`${ref}::text ILIKE '%' || ${bind(f.value)} || '%'`)
        break
      case 'empty':
        where.push(`(${ref} IS NULL OR ${ref}::text = '')`)
        break
      case 'not_empty':
        where.push(`(${ref} IS NOT NULL AND ${ref}::text <> '')`)
        break
    }
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''

  if (!widget.dimension) {
    return { text: `SELECT ${measure} AS value FROM ${from}${whereSql}`, params }
  }

  // Dimension (group by), optionally truncated to a time grain
  const d = col(widget.dimension.column)
  const grain = widget.dimension.grain
  if (grain !== 'none' && !isTime(d)) throw new WidgetQueryError(`Grouping by ${grain} needs a date column; "${d.name}" is ${d.type}.`)
  const FORMATS = { day: 'YYYY-MM-DD', week: 'YYYY-MM-DD', month: 'YYYY-MM', quarter: 'YYYY-"Q"Q', year: 'YYYY' } as const
  const label = grain === 'none' ? `${ref(d)}::text` : `to_char(date_trunc('${grain}', ${ref(d)}::timestamptz), '${FORMATS[grain]}')`
  // One extra row tells the caller the result was cut off.
  const grouped = `SELECT ${label} AS label, ${measure} AS value FROM ${from}${whereSql} GROUP BY 1`
  if (isTimeSeries(widget)) {
    // The latest periods, read left to right (oldest first). The extra row is the oldest.
    return { text: `SELECT * FROM (${grouped} ORDER BY label DESC NULLS LAST LIMIT ${widget.limit + 1}) latest ORDER BY label ASC NULLS LAST`, params }
  }
  const order = { value_desc: 'value DESC NULLS LAST, label ASC', value_asc: 'value ASC NULLS LAST, label ASC', label_asc: 'label ASC NULLS LAST', label_desc: 'label DESC NULLS LAST' }[widget.sort]
  return { text: `${grouped} ORDER BY ${order} LIMIT ${widget.limit + 1}`, params }
}

const joinedColumnName = (name: string) => `${JOIN_PREFIX}${name}`

/** Line charts and date grains are time series: they keep the latest periods, oldest first. */
export function isTimeSeries(widget: Pick<Widget, 'type' | 'dimension'>) {
  return widget.type === 'line' || (widget.dimension?.grain ?? 'none') !== 'none'
}
