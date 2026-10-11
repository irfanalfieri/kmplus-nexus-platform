import { z } from 'zod'
import { ROLES, type Role } from '@/lib/auth/permissions'

/**
 * Row-level access (DB-6 / GV-9): a dataset policy can limit which rows some
 * roles see, e.g. "analysts only see company_code = KMP". Filters for the
 * viewer's role are ANDed. Pure and client-safe; the SQL only references
 * checked column names and binds every value.
 */

export const ROW_FILTER_OPERATORS = ['equals', 'not_equals', 'in_list'] as const

export const rowFilterSchema = z.object({
  roles: z.array(z.enum(ROLES)).min(1, 'Choose at least one role'),
  column: z.string().trim().min(1, 'Choose a column').max(128),
  operator: z.enum(ROW_FILTER_OPERATORS).default('equals'),
  value: z.string().trim().max(1000).default(''),
})
export type RowFilter = z.infer<typeof rowFilterSchema>
export const rowFiltersSchema = z.array(rowFilterSchema).max(20)

/** Filters that apply to this role. */
export function filtersFor(filters: RowFilter[] | null | undefined, role: Role): RowFilter[] {
  return (filters ?? []).filter((f) => f.roles.includes(role))
}

const listOf = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)

/** True when a row passes every filter (for rows already in memory). */
export function rowAllowed(row: Record<string, unknown>, filters: RowFilter[]): boolean {
  return filters.every((f) => {
    const v = row[f.column] === null || row[f.column] === undefined ? null : String(row[f.column])
    if (f.operator === 'equals') return v === f.value
    if (f.operator === 'not_equals') return v !== f.value
    return v !== null && listOf(f.value).includes(v)
  })
}

/**
 * SQL conditions for the filters. `bind` adds a parameter and returns its
 * placeholder. Throws when a filter names a column the dataset doesn't have,
 * so a renamed column fails closed instead of exposing every row.
 */
export function rowFilterSql(filters: RowFilter[], columns: Set<string>, bind: (v: unknown) => string): string[] {
  const q = (name: string) => `"${name.replace(/"/g, '""')}"`
  return filters.map((f) => {
    if (!columns.has(f.column)) throw new Error(`A row-level policy uses column "${f.column}", which this dataset no longer has. Ask a steward to fix the policy.`)
    const ref = `${q(f.column)}::text`
    if (f.operator === 'equals') return `${ref} = ${bind(f.value)}`
    if (f.operator === 'not_equals') return `(${q(f.column)} IS NULL OR ${ref} <> ${bind(f.value)})`
    return `${ref} = ANY(${bind(listOf(f.value))}::text[])`
  })
}
