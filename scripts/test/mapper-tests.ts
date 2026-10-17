/**
 * The two-pane mapper (MP-1). Pure; run from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { addColumn, addTargets, assign, fieldName, fieldsFromRows, rowsFromStep, usage } from '@/lib/pipelines/mapper'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

export async function mapperTests(test: Test) {
  await test('two-pane mapper: drop on a target fills it, drop on "New field" adds one (HR synonyms), targets from an entity auto-match', () => {
    const input = [{ name: 'PERNR', type: 'text' }, { name: 'ENAME', type: 'text' }, { name: 'GBDAT', type: 'date' }, { name: 'Org Unit', type: 'text' }]
    let rows = rowsFromStep({ fields: [{ from: 'PERNR', to: 'employee_code', type: 'text', transforms: [{ fn: 'trim', args: [] }] }] })
    // New field from a column: its canonical name, its type.
    rows = addColumn(rows, input[2])
    assert.deepEqual(rows[1], { to: 'birth_date', type: 'date', from: 'GBDAT', transforms: [] })
    rows = addColumn(rows, input[3])
    assert.equal(rows[2].to, 'org_code', 'HR synonyms: Org Unit → org_code')
    rows = addColumn(rows, input[3])
    assert.equal(rows[3].to, 'org_code_2', 'a second copy gets a free name')
    // Targets from an entity: names that exist are kept, the rest auto-match or wait for a column.
    rows = addTargets(rows, [{ name: 'employee_code', type: 'text' }, { name: 'full_name', type: 'text' }, { name: 'hire_date', type: 'date' }], input)
    assert.deepEqual(rows.slice(4).map((r) => [r.to, r.from]), [['full_name', 'ENAME'], ['hire_date', '']])
    // A drop fills the empty target; a target without its own type takes the column's.
    rows = assign(rows, 'hire_date', { name: 'GBDAT', type: 'date' })
    assert.equal(rows.find((r) => r.to === 'hire_date')!.from, 'GBDAT')
    assert.equal(usage(rows).get('GBDAT'), 2)
    // Applying keeps transforms and leaves out targets without a column.
    rows = addTargets(rows, [{ name: 'email', type: 'text' }], input)
    const fields = fieldsFromRows(rows)
    assert.equal(fields.length, rows.length - 1)
    assert.deepEqual(fields[0].transforms, [{ fn: 'trim', args: [] }])
    assert.deepEqual(['9 lives', 'a-b c', '__'].map(fieldName), ['f_9_lives', 'a_b_c', ''])
  })
}
