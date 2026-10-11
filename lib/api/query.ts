import { rowFilterSql, type RowFilter } from '@/lib/governance/row-filters'

/**
 * Data API reads (API-2/API-3). Pure; covered by scripts/engine-tests.ts.
 *
 *   GET /api/v1/datasets/employees?fields=employee_code,full_name
 *       &filter[department]=Finance&filter[hire_date][gte]=2024-01-01
 *       &updated_since=2026-10-01T00:00:00Z&limit=100&cursor=…
 *
 * Rows come in a stable order (the dataset's _nexus_id); `next_cursor` points
 * after the last row. Identifiers are only checked column names; every value
 * is a bind parameter.
 */

export const API_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const
export type ApiOperator = (typeof API_OPERATORS)[number]

export interface ApiQuery {
  fields: string[] | null
  filters: { column: string; op: ApiOperator; value: string }[]
  updatedSince: string | null
  limit: number
  afterId: number | null
}

export class ApiQueryError extends Error {
  readonly status = 400
}

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 1000

export const encodeCursor = (id: number | string) => Buffer.from(`id:${id}`).toString('base64url')

export function decodeCursor(cursor: string): number {
  const text = Buffer.from(cursor, 'base64url').toString('utf8')
  const m = /^id:(\d{1,18})$/.exec(text)
  if (!m) throw new ApiQueryError('Invalid cursor. Use the next_cursor value from the previous page.')
  return Number(m[1])
}

/** Parses query parameters against the columns a caller may use (canonical names for domain entities). */
export function parseApiQuery(params: URLSearchParams, columns: string[]): ApiQuery {
  const known = new Set(columns)
  const check = (name: string) => {
    if (!known.has(name)) throw new ApiQueryError(`Unknown field "${name}". Available: ${columns.join(', ')}`)
    return name
  }
  const fieldsParam = params.get('fields')
  const fields = fieldsParam ? [...new Set(fieldsParam.split(',').map((f) => f.trim()).filter(Boolean))].map(check) : null

  const filters: ApiQuery['filters'] = []
  for (const [key, value] of params) {
    const m = /^filter\[([^\]]+)\](?:\[([a-z]+)\])?$/.exec(key)
    if (!m) {
      if (key.startsWith('filter')) throw new ApiQueryError(`Write filters as filter[field]=value or filter[field][op]=value (op: ${API_OPERATORS.join(', ')}).`)
      continue
    }
    const op = (m[2] ?? 'eq') as ApiOperator
    if (!(API_OPERATORS as readonly string[]).includes(op)) throw new ApiQueryError(`Unknown operator "${m[2]}". Use one of: ${API_OPERATORS.join(', ')}.`)
    filters.push({ column: check(m[1]), op, value: value.slice(0, 1000) })
  }
  if (filters.length > 20) throw new ApiQueryError('At most 20 filters per request.')

  const updatedSince = params.get('updated_since')
  if (updatedSince && Number.isNaN(Date.parse(updatedSince))) throw new ApiQueryError('updated_since must be an ISO date or timestamp, e.g. 2026-10-01T00:00:00Z.')

  const rawLimit = params.get('limit')
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new ApiQueryError(`limit must be between 1 and ${MAX_LIMIT}.`)

  const cursor = params.get('cursor')
  return { fields, filters, updatedSince, limit, afterId: cursor ? decodeCursor(cursor) : null }
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`

/**
 * SELECT for one page. `columnMap` maps the names callers use to dataset
 * columns (identity for datasets, canonical → column for domain entities).
 * One extra row is read to know whether there is a next page.
 */
export function buildApiSql(
  table: string,
  columnMap: Record<string, string>,
  query: ApiQuery,
  opts: { rowFilters?: RowFilter[]; datasetColumns: string[] }
): { text: string; params: unknown[] } {
  const params: unknown[] = []
  const bind = (v: unknown) => (params.push(v), `$${params.length}`)
  const exposed = query.fields ?? Object.keys(columnMap)
  const select = exposed.map((name) => `${q(columnMap[name])} AS ${q(name)}`)
  const where = ['"_nexus_deleted_at" IS NULL', ...rowFilterSql(opts.rowFilters ?? [], new Set(opts.datasetColumns), bind)]
  for (const f of query.filters) {
    const ref = `${q(columnMap[f.column])}::text`
    switch (f.op) {
      case 'eq':
        where.push(`${ref} = ${bind(f.value)}`)
        break
      case 'neq':
        where.push(`(${q(columnMap[f.column])} IS NULL OR ${ref} <> ${bind(f.value)})`)
        break
      case 'in':
        where.push(`${ref} = ANY(${bind(f.value.split(',').map((v) => v.trim()))}::text[])`)
        break
      case 'contains':
        where.push(`${ref} ILIKE '%' || ${bind(f.value)} || '%'`)
        break
      default: {
        // Numbers compare as numbers, everything else as text (ISO dates sort correctly as text).
        const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op]
        const numeric = /^-?\d+(\.\d+)?$/.test(f.value.trim())
        where.push(numeric ? `(CASE WHEN ${ref} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${ref}::numeric END) ${op} ${bind(f.value.trim())}::numeric` : `${ref} ${op} ${bind(f.value)}`)
      }
    }
  }
  if (query.updatedSince) where.push(`"_nexus_loaded_at" >= ${bind(query.updatedSince)}::timestamptz`)
  if (query.afterId !== null) where.push(`"_nexus_id" > ${bind(query.afterId)}`)
  return {
    text: `SELECT "_nexus_id" AS "__cursor", ${select.join(', ')} FROM ${table} WHERE ${where.join(' AND ')} ORDER BY "_nexus_id" LIMIT ${bind(query.limit + 1)}`,
    params,
  }
}

/** Splits the extra row off and builds the response page. */
export function toPage(rows: Record<string, unknown>[], limit: number) {
  const more = rows.length > limit
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    data: page.map(({ __cursor, ...r }) => r),
    next_cursor: more && last ? encodeCursor(String(last.__cursor)) : null,
  }
}
