/**
 * Pure tests for the pipeline engine, transforms, watermarks and schedules.
 * No database or network. Run: node scripts/run-ts.mjs scripts/engine-tests.ts
 */
import assert from 'node:assert/strict'
import { compareWatermarks, inferColumns, maxWatermark } from '@/lib/pipelines/columns'
import { definitionSchema, scheduleSchema, settingsSchema } from '@/lib/pipelines/definition'
import { checkDestination, newRunTotals, runEngine, transformChunk } from '@/lib/pipelines/engine'
import { describeSchedule, nextRunTimes } from '@/lib/pipelines/schedule'
import { formatDate, parseDate } from '@/lib/pipelines/transforms'
import { widgetSchema } from '@/lib/analytics/definition'
import { buildWidgetSql, WidgetQueryError } from '@/lib/analytics/query'
import { suggestColumnPolicy } from '@/lib/governance/definition'
import { applyMasks, maskValue } from '@/lib/governance/masking'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  }
}

const hr = [
  { PERNR: ' 00001 ', ENAME: 'AMIRA rahman', EMAIL: 'amira@kmplus.co.id', BEGDA: '20210315', SALARY: '12.500.000,50', STAT: 'Active', UPDATED: '2026-10-01 08:00:00' },
  { PERNR: '00002', ENAME: 'daniel lee', EMAIL: 'not-an-email', BEGDA: '20190101', SALARY: '9.000.000', STAT: 'Active', UPDATED: '2026-10-03 09:30:00' },
  { PERNR: '00003', ENAME: 'sofia chen', EMAIL: 'sofia@kmplus.co.id', BEGDA: '31/12/2020', SALARY: '15000000', STAT: 'Inactive', UPDATED: '2026-10-02 10:00:00' },
  { PERNR: '00004', ENAME: 'budi santoso', EMAIL: 'budi@kmplus.co.id', BEGDA: 'bad-date', SALARY: '1', STAT: 'Active', UPDATED: '2026-09-30 23:59:59' },
  { PERNR: '00001', ENAME: 'dup amira', EMAIL: 'dup@kmplus.co.id', BEGDA: '20220101', SALARY: '1', STAT: 'Active', UPDATED: '2026-10-04 07:00:00' },
]

const base = {
  steps: [
    { id: 'src', type: 'source', dataSourceId: 'x', table: 'PA0001' },
    { id: 'flt', type: 'filter', conditions: [{ field: 'STAT', operator: 'equals', value: 'active' }] },
    {
      id: 'map',
      type: 'map',
      fields: [
        { from: 'PERNR', to: 'employee_code', transforms: [{ fn: 'trim' }] },
        { from: 'ENAME', to: 'full_name', transforms: [{ fn: 'titlecase' }] },
        { from: 'EMAIL', to: 'email', transforms: [{ fn: 'lowercase' }] },
        { from: 'BEGDA', to: 'hire_date', type: 'date' },
        { from: 'SALARY', to: 'salary', type: 'numeric', transforms: [{ fn: 'to_number' }] },
      ],
    },
    { id: 'val', type: 'validate', rules: [{ field: 'email', rule: 'email' }, { field: 'employee_code', rule: 'unique' }] },
    { id: 'dst', type: 'destination', kind: 'dataset', datasetName: 'employee_master', mode: 'upsert', keys: ['employee_code'] },
  ],
}

async function main() {
  await test('end-to-end transform, filter, validate, write', async () => {
    const def = definitionSchema.parse(base)
    let written: Record<string, unknown>[] = []
    const res = await runEngine(def, { read: async () => hr, write: async (_s, rows) => ((written = rows), { written: rows.length, target: 't' }) })
    assert.equal(res.status, 'partial')
    assert.equal(res.rejectedCount, 3)
    assert.deepEqual(written[0], { employee_code: '00001', full_name: 'Amira Rahman', email: 'amira@kmplus.co.id', hire_date: '2021-03-15', salary: 12500000.5 })
    assert.equal(res.watermark, undefined, 'full mode reports no watermark')
  })

  await test('settings default and validate', () => {
    const def = definitionSchema.parse(base)
    assert.deepEqual(def.settings, { retries: 2, retryDelaySeconds: 15, alertOn: 'failure', alertEmails: [] })
    assert.equal(settingsSchema.safeParse({ alertEmails: ['not-an-email'] }).success, false)
    assert.equal(settingsSchema.safeParse({ retries: 9 }).success, false)
  })

  await test('incremental requires a watermark column', () => {
    const steps = structuredClone(base.steps) as Record<string, unknown>[]
    steps[0] = { ...steps[0], mode: 'incremental' }
    assert.equal(definitionSchema.safeParse({ steps }).success, false)
    steps[0] = { ...steps[0], watermarkColumn: 'UPDATED' }
    assert.equal(definitionSchema.safeParse({ steps }).success, true)
  })

  await test('incremental run reports the highest watermark read', async () => {
    const steps = structuredClone(base.steps) as Record<string, unknown>[]
    steps[0] = { ...steps[0], mode: 'incremental', watermarkColumn: 'UPDATED' }
    const def = definitionSchema.parse({ steps })
    const res = await runEngine(def, { read: async () => hr, write: async (_s, rows) => ({ written: rows.length, target: 't' }) })
    assert.deepEqual(res.watermark, { column: 'UPDATED', value: '2026-10-04 07:00:00' })
    const empty = await runEngine(def, { read: async () => [], write: async () => ({ written: 0, target: 't' }) })
    assert.deepEqual(empty.watermark, { column: 'UPDATED', value: null })
  })

  await test('missing watermark column fails and is not retryable', async () => {
    const steps = structuredClone(base.steps) as Record<string, unknown>[]
    steps[0] = { ...steps[0], mode: 'incremental', watermarkColumn: 'NOPE' }
    const res = await runEngine(definitionSchema.parse({ steps }), { read: async () => hr, write: async () => ({ written: 0, target: 't' }) })
    assert.equal(res.status, 'failed')
    assert.equal(res.retryable, false)
  })

  await test('I/O failures are retryable, config and validation failures are not', async () => {
    const def = definitionSchema.parse(base)
    const network = await runEngine(def, { read: async () => { throw new Error('ECONNRESET') } })
    assert.equal(network.retryable, true)
    const config = await runEngine(def, { read: async () => { throw Object.assign(new Error('Table missing'), { retryable: false }) } })
    assert.equal(config.retryable, false)
    const writeFail = await runEngine(def, { read: async () => hr, write: async () => { throw new Error('deadlock detected') } })
    assert.equal(writeFail.retryable, true)
    const abortSteps = structuredClone(base.steps) as Record<string, unknown>[]
    abortSteps[3] = { ...abortSteps[3], onFail: 'abort' }
    const abort = await runEngine(definitionSchema.parse({ steps: abortSteps }), { read: async () => hr, write: async () => ({ written: 0, target: 't' }) })
    assert.equal(abort.status, 'failed')
    assert.equal(abort.retryable, false)
  })

  await test('watermark ordering: numbers, timestamps, mixed formats', () => {
    assert.ok(compareWatermarks('10', '9') > 0, 'numeric strings compare numerically')
    assert.ok(compareWatermarks(10, '9') > 0)
    assert.ok(compareWatermarks('2026-10-04 07:00:00', '2026-10-03T23:00:00Z') > 0)
    assert.ok(compareWatermarks(new Date('2026-10-04T00:00:00Z'), '2026-10-03 23:59:59') > 0)
    assert.equal(maxWatermark([{ id: 2 }, { id: 11 }, { id: null }, { id: 7 }], 'id'), '11')
    assert.equal(maxWatermark([{ id: null }], 'id'), null)
  })

  await test('zone-less timestamps are UTC regardless of server timezone', () => {
    const d = parseDate('2026-10-08 16:14:00')!
    assert.equal(d.toISOString(), '2026-10-08T16:14:00.000Z')
    assert.equal(parseDate('2026-10-08 16:14:00.250')!.toISOString(), '2026-10-08T16:14:00.250Z')
    assert.equal(formatDate(parseDate('20210315')!), '2021-03-15')
    assert.equal(parseDate('31/02/2021'), null, 'impossible dates are rejected')
  })

  await test('schedules in WIB', () => {
    const s = scheduleSchema.parse({ type: 'weekly', time: '01:00', weekdays: [1, 2, 3, 4, 5] })
    assert.equal(describeSchedule(s), 'Weekdays at 01:00 WIB')
    assert.deepEqual(nextRunTimes(s, 2, new Date('2026-10-08T10:00:00Z')).map((d) => d.toISOString()), ['2026-10-08T18:00:00.000Z', '2026-10-11T18:00:00.000Z'])
  })

  await test('chunked run matches a single-pass run (background worker)', async () => {
    const def = definitionSchema.parse({ ...base, steps: [{ ...base.steps[0], mode: 'incremental', watermarkColumn: 'UPDATED' }, ...base.steps.slice(1)] })
    let single: Record<string, unknown>[] = []
    const whole = await runEngine(def, { read: async () => hr, write: async (_s, rows) => ((single = rows), { written: rows.length, target: 't' }) })
    for (const size of [1, 2, 3]) {
      const totals = newRunTotals(def)
      const seen = new Map<string, Set<string>>()
      const out: Record<string, unknown>[] = []
      let rejects = 0
      for (let i = 0; i < hr.length; i += size) {
        const chunk = transformChunk(def, hr.slice(i, i + size), totals, seen)
        out.push(...chunk.rows)
        rejects += chunk.rejects.length
      }
      assert.deepEqual(out, single, `chunk size ${size}: same rows`)
      assert.equal(totals.rejectedCount, whole.rejectedCount, `chunk size ${size}: same rejects (unique works across chunks)`)
      assert.equal(rejects, whole.rejectedCount)
      assert.equal(totals.rowsRead, hr.length)
      assert.deepEqual(totals.watermark, whole.watermark, `chunk size ${size}: same watermark`)
      assert.deepEqual(totals.columns.map((c) => c.name), whole.columns.map((c) => c.name))
      const val = totals.steps.find((s) => s.id === 'val')!
      assert.equal(val.rejected, whole.steps.find((s) => s.id === 'val')!.rejected)
      assert.doesNotThrow(() => checkDestination(def, totals.columns))
    }
  })

  await test('chunked run: abort validation and missing upsert key are not retryable', () => {
    const abortDef = definitionSchema.parse({ steps: [base.steps[0], { id: 'v', type: 'validate', onFail: 'abort', rules: [{ field: 'EMAIL', rule: 'email' }] }, base.steps[4]] })
    assert.throws(() => transformChunk(abortDef, hr, newRunTotals(abortDef), new Map()), (e: { retryable?: boolean }) => e.retryable === false)
    const noKey = definitionSchema.parse({ steps: [base.steps[0], base.steps[4]] })
    assert.throws(() => checkDestination(noKey, [{ name: 'PERNR', type: 'text' }]), (e: { retryable?: boolean }) => e.retryable === false)
  })

  await test('analytics: widget SQL is built only from known columns, values are bound', () => {
    const cols = [
      { name: 'department', type: 'text' },
      { name: 'salary', type: 'numeric' },
      { name: 'hire_date', type: 'date' },
      { name: 'email', type: 'text' },
    ]
    const T = '"nexus_data"."ds_x"'
    const base = { id: 'w', title: '', dataset: 'emp', filters: [], sort: 'value_desc', limit: 5, size: 'small' } as const
    const kpi = buildWidgetSql(widgetSchema.parse({ ...base, type: 'kpi', measure: { agg: 'count' } }), T, cols)
    assert.equal(kpi.text, `SELECT count(*) AS value FROM ${T}`)
    const bar = buildWidgetSql(
      widgetSchema.parse({ ...base, type: 'bar', measure: { agg: 'avg', column: 'salary' }, dimension: { column: 'department' }, filters: [{ column: 'email', op: 'contains', value: "x'; DROP TABLE t; --" }] }),
      T,
      cols
    )
    assert.match(bar.text, /^SELECT "department"::text AS label, avg\("salary"::numeric\) AS value FROM .* WHERE "email"::text ILIKE '%' \|\| \$1 \|\| '%' GROUP BY 1 ORDER BY value DESC NULLS LAST, label ASC LIMIT 6$/)
    assert.deepEqual(bar.params, ["x'; DROP TABLE t; --"], 'user values are parameters, never SQL')
    const line = buildWidgetSql(widgetSchema.parse({ ...base, type: 'line', measure: { agg: 'count' }, dimension: { column: 'hire_date', grain: 'month' }, filters: [{ column: 'salary', op: 'gte', value: '1000' }] }), T, cols)
    assert.match(line.text, /to_char\(date_trunc\('month', "hire_date"::timestamptz\), 'YYYY-MM'\) AS label/)
    assert.match(line.text, /"salary"::numeric >= \$1::numeric/)
    assert.match(line.text, /ORDER BY label ASC/)
    const bad = (w: object, re: RegExp, blocked: string[] = []) =>
      assert.throws(() => buildWidgetSql(widgetSchema.parse({ ...base, ...w }), T, cols, { blockedColumns: blocked }), (e: Error) => e instanceof WidgetQueryError && re.test(e.message))
    bad({ type: 'bar', measure: { agg: 'count' }, dimension: { column: 'x" FROM pg_user; --' } }, /not in dataset/)
    bad({ type: 'kpi', measure: { agg: 'sum', column: 'department' } }, /needs a number column/)
    bad({ type: 'bar', measure: { agg: 'count' }, dimension: { column: 'department', grain: 'month' } }, /needs a date column/)
    bad({ type: 'bar', measure: { agg: 'count' }, dimension: { column: 'email' } }, /masked by a dataset policy/, ['email'])
    bad({ type: 'kpi', measure: { agg: 'count' }, filters: [{ column: 'email', op: 'eq', value: 'a' }] }, /masked/, ['email'])
    bad({ type: 'kpi', measure: { agg: 'count' }, filters: [{ column: 'salary', op: 'gt', value: '1; DROP' }] }, /needs a number/)
    assert.equal(widgetSchema.safeParse({ ...base, type: 'bar', measure: { agg: 'count' } }).success, false, 'charts need a group-by')
  })

  await test('column types: database hints beat string guesses; codes with leading zeros stay text', () => {
    const rows = [{ code: '00123', salary: '8037919.50', hired: '2021-03-15', name: 'Budi' }]
    assert.deepEqual(inferColumns(rows).map((c) => c.type), ['text', 'text', 'text', 'text'], 'without hints, strings stay text')
    assert.deepEqual(
      inferColumns(rows, { salary: 'numeric', hired: 'date' }).map((c) => [c.name, c.type]),
      [['code', 'text'], ['salary', 'numeric'], ['hired', 'date'], ['name', 'text']]
    )
    assert.deepEqual(inferColumns([{ a: null }], { a: 'integer' }), [{ name: 'a', type: 'integer' }], 'all-null column takes the hint')
  })

  await test('governance: masks and suggestions', () => {
    assert.equal(maskValue('budi@kmplus.co.id', 'partial'), '••••o.id')
    assert.equal(maskValue('12345678', 'full'), '••••••')
    assert.equal(maskValue('E00123', 'hash'), maskValue('E00123', 'hash'), 'hash is a stable pseudonym')
    assert.notEqual(maskValue('E00123', 'hash'), 'E00123')
    assert.equal(maskValue(null, 'full'), null)
    assert.deepEqual(applyMasks([{ a: 'x', email: 'someone@x.io' }], { email: 'partial' }), [{ a: 'x', email: '••••x.io' }])
    assert.equal(suggestColumnPolicy('work_email').mask, 'partial')
    assert.equal(suggestColumnPolicy('base_salary').classification, 'sensitive')
    assert.equal(suggestColumnPolicy('nik').classification, 'personal')
    assert.equal(suggestColumnPolicy('department').mask, 'none')
  })

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`)
}

void main()
