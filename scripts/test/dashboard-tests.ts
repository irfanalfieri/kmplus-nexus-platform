/**
 * Dashboard-wide filters (DB-4). Pure; run from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { applyDashboardFilters, dashboardInputSchema, dateRange, widgetSchema, type DashboardFilter } from '@/lib/analytics/definition'
import { buildWidgetSql } from '@/lib/analytics/query'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

export async function dashboardTests(test: Test) {
  await test('dashboard filters: date presets, and filters added to each widget whose dataset has the column', () => {
    const now = new Date('2026-10-17T05:00:00Z')
    assert.equal(dateRange(undefined, now), null)
    assert.deepEqual(dateRange({ preset: '7d' }, now), { from: '2026-10-11', to: '2026-10-17' })
    assert.deepEqual(dateRange({ preset: 'ytd' }, now), { from: '2026-01-01', to: '2026-10-17' })
    assert.deepEqual(dateRange({ preset: 'custom', from: '2026-01-01' }, now), { from: '2026-01-01', to: null })
    assert.equal(dateRange({ preset: 'custom' }, now), null)

    const filters: DashboardFilter[] = [
      { id: 'p', label: 'Period', kind: 'date', column: 'hire_date' },
      { id: 'o', label: 'Org', kind: 'value', column: 'org_code' },
      { id: 's', label: 'Salary', kind: 'value', column: 'salary' },
    ]
    const widget = widgetSchema.parse({ id: 'w', type: 'bar', dataset: 'employees', measure: { agg: 'count' }, dimension: { column: 'org_code' }, filters: [{ column: 'status', op: 'eq', value: 'Active' }] })
    const columns = [{ name: 'hire_date', type: 'date' }, { name: 'org_code', type: 'text' }, { name: 'status', type: 'text' }, { name: 'salary', type: 'numeric' }]
    const values = { p: { preset: '30d' as const }, o: { value: 'HR' }, s: { value: '100' } }
    const r = applyDashboardFilters(widget, filters, values, columns, new Set(['salary']), now)
    assert.deepEqual(r.widget.filters, [
      { column: 'status', op: 'eq', value: 'Active' },
      { column: 'hire_date', op: 'gte', value: '2026-09-18' },
      { column: 'hire_date', op: 'lt', value: '2026-10-18' },
      { column: 'org_code', op: 'eq', value: 'HR' },
    ])
    assert.deepEqual(r.applied, ['p', 'o'])
    assert.deepEqual(r.skipped, [{ id: 's', reason: 'masked' }])
    // The widget still builds: values bound, identifiers checked.
    const sql = buildWidgetSql(r.widget, '"nexus_data"."t"', columns)
    assert.deepEqual(sql.params, ['Active', '2026-09-18', '2026-10-18', 'HR'])
    // A dataset without the column, or a text column under a date filter, is not filtered.
    const other = applyDashboardFilters(widget, [{ id: 'p', label: 'Period', kind: 'date', column: 'status' }, { id: 'x', label: 'X', kind: 'value', column: 'missing' }], { p: { preset: '7d' }, x: { value: '1' } }, columns, new Set(), now)
    assert.deepEqual(other.skipped, [{ id: 'p', reason: 'type' }, { id: 'x', reason: 'missing' }])
    assert.equal(other.widget, widget)
    // Nothing chosen: nothing changes.
    assert.equal(applyDashboardFilters(widget, filters, {}, columns).widget, widget)
    // At most 4 filters per dashboard; saving without filters keeps them.
    assert.equal(dashboardInputSchema.safeParse({ name: 'x', filters: [...filters, ...filters].map((f, i) => ({ ...f, id: `f${i}` })) }).success, false)
    assert.equal(dashboardInputSchema.parse({ name: 'x' }).filters, undefined)
  })
}
