/**
 * Pure tests for the pipeline engine, transforms, watermarks and schedules.
 * No database or network. Run: node scripts/run-ts.mjs scripts/engine-tests.ts
 */
import assert from 'node:assert/strict'
import { compareWatermarks, inferColumns, maxWatermark } from '@/lib/pipelines/columns'
import { definitionSchema, scheduleSchema, settingsSchema } from '@/lib/pipelines/definition'
import { checkDestination, emptyContext, newRunTotals, runEngine, transformChunk } from '@/lib/pipelines/engine'
import type { BusinessRule } from '@/lib/rules/definition'
import { describeSchedule, nextRunTimes } from '@/lib/pipelines/schedule'
import { applyTransform, checkManagers, formatDate, parseDate } from '@/lib/pipelines/transforms'
import { widgetSchema } from '@/lib/analytics/definition'
import { buildWidgetSql, WidgetQueryError } from '@/lib/analytics/query'
import { suggestColumnPolicy } from '@/lib/governance/definition'
import { applyMasks, maskValue } from '@/lib/governance/masking'
import { cellText, cleanTableName, columnNames, detectType, toSheet, uploadParts } from '@/lib/files/parse'
import { rowAllowed, rowFilterSql, type RowFilter } from '@/lib/governance/row-filters'
import { ApiQueryError, buildApiSql, decodeCursor, encodeCursor, parseApiQuery, toPage } from '@/lib/api/query'
import { freshness, matchesSearch, parseKey } from '@/lib/catalog/definition'
import { applyRules, describeRule } from '@/lib/rules/evaluate'
import { refreshSchedule } from '@/lib/catalog/refresh'
import { createHmac, randomBytes } from 'node:crypto'
import { diffObjects, diffPipelineDefinitions } from '@/lib/audit-diff'
import { DOMAIN_ENTITIES, suggestCanonicalField } from '@/lib/domain/model'
import { BUILTIN_MAPPING_TEMPLATES, PIPELINE_TEMPLATES, applyMappingTemplate, buildPipelineTemplate, mapToEntity } from '@/lib/pipelines/templates'
import { buildLineage } from '@/lib/catalog/lineage'
import { signPayload } from '@/lib/webhooks/deliver'
import { isPrivateAddress } from '@/lib/net/safe-url'
import { issuerFor, PUBLIC_EMAIL_DOMAINS, DOMAIN_RE } from '@/lib/auth/sso-presets'
import { rateLimitHeaders } from '@/lib/api/rate-limit'
import { openApiSpec } from '@/lib/api/openapi'

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
    assert.deepEqual(def.settings, { retries: 2, retryDelaySeconds: 15, alertOn: 'failure', alertEmails: [], timeoutMinutes: 120, batchSize: 5000, maxErrorPercent: null })
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
    assert.equal(formatDate(parseDate(20210315)!), '2021-03-15', 'yyyyMMdd read from a numeric column')
    assert.equal(parseDate(1_700_000_000_000)!.toISOString(), '2023-11-14T22:13:20.000Z', 'other numbers stay epoch ms')
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
    assert.equal(kpi.text, `SELECT count(*) AS value FROM ${T} WHERE "_nexus_deleted_at" IS NULL`)
    const bar = buildWidgetSql(
      widgetSchema.parse({ ...base, type: 'bar', measure: { agg: 'avg', column: 'salary' }, dimension: { column: 'department' }, filters: [{ column: 'email', op: 'contains', value: "x'; DROP TABLE t; --" }] }),
      T,
      cols
    )
    assert.match(bar.text, /^SELECT "department"::text AS label, avg\("salary"::numeric\) AS value FROM .* WHERE "_nexus_deleted_at" IS NULL AND "email"::text ILIKE '%' \|\| \$1 \|\| '%' GROUP BY 1 ORDER BY value DESC NULLS LAST, label ASC LIMIT 6$/)
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

  await test('graph: v1 step lists convert; cycles, orphans and branchless router edges are rejected', () => {
    const v2 = definitionSchema.parse(base)
    assert.equal(v2.schemaVersion, 2)
    assert.equal(v2.edges.length, base.steps.length - 1)
    const src = { id: 'a', type: 'source', dataSourceId: 'x', table: 't' }
    const dst = { id: 'z', type: 'destination', kind: 'dataset', datasetName: 'out', mode: 'append' }
    const map = { id: 'm', type: 'map', fields: [{ from: 'a', to: 'a' }] }
    const flt = { id: 'f', type: 'filter', conditions: [{ field: 'a', operator: 'is_not_empty' }] }
    const ok = (d: object) => definitionSchema.safeParse(d).success
    assert.equal(ok({ nodes: [src, dst], edges: [{ id: '1', from: 'a', to: 'z' }] }), true)
    assert.equal(ok({ nodes: [src, map, flt, dst], edges: [{ id: '1', from: 'a', to: 'm' }, { id: '2', from: 'm', to: 'f' }, { id: '3', from: 'f', to: 'm' }, { id: '4', from: 'f', to: 'z' }] }), false, 'cycle')
    assert.equal(ok({ nodes: [src, map, dst], edges: [{ id: '1', from: 'a', to: 'z' }] }), false, 'orphan')
    const router = { id: 'r', type: 'router', branches: [{ id: 'b1', label: 'Finance', condition: { match: 'all', conditions: [{ field: 'a', operator: 'equals', value: 'x' }] } }] }
    assert.equal(ok({ nodes: [src, router, dst], edges: [{ id: '1', from: 'a', to: 'r' }, { id: '2', from: 'r', to: 'z' }] }), false, 'router edge needs a branch')
    assert.equal(ok({ nodes: [src, dst, { ...dst, id: 'z2', datasetName: 'other', mode: 'upsert' }], edges: [{ id: '1', from: 'a', to: 'z' }, { id: '2', from: 'a', to: 'z2' }] }), false, 'upsert needs keys')
  })

  await test('graph: router branches, fan-out to two destinations, per-destination columns', async () => {
    const def = definitionSchema.parse({
      nodes: [
        { id: 'src', type: 'source', dataSourceId: 'x', table: 'PA0001' },
        { id: 'r', type: 'router', branches: [{ id: 'act', label: 'Active', condition: { match: 'all', conditions: [{ field: 'STAT', operator: 'equals', value: 'Active' }] } }] },
        { id: 'm', type: 'map', fields: [{ from: 'PERNR', to: 'code', transforms: [{ fn: 'trim' }] }] },
        { id: 'active', type: 'destination', kind: 'dataset', datasetName: 'active_emp', mode: 'append' },
        { id: 'others', type: 'destination', kind: 'dataset', datasetName: 'other_emp', mode: 'append' },
        { id: 'all', type: 'destination', kind: 'dataset', datasetName: 'all_emp', mode: 'append' },
      ],
      edges: [
        { id: '1', from: 'src', to: 'r' },
        { id: '2', from: 'r', to: 'm', branch: 'act' },
        { id: '3', from: 'm', to: 'active' },
        { id: '4', from: 'r', to: 'others', branch: 'otherwise' },
        { id: '5', from: 'src', to: 'all' },
      ],
    })
    const written: Record<string, Record<string, unknown>[]> = {}
    const res = await runEngine(def, { read: async () => hr, write: async (s, rows) => ((written[s.id] = rows), { written: rows.length, target: s.id }) })
    assert.equal(res.status, 'success')
    assert.equal(written.active.length, 4)
    assert.deepEqual(Object.keys(written.active[0]), ['code'], 'map-declared columns for the mapped branch')
    assert.equal(written.others.length, 1)
    assert.equal(written.all.length, hr.length, 'fan-out: every row reaches the unconditional destination')
    assert.equal(res.rowsWritten, 4 + 1 + hr.length)
    assert.equal(res.destinations?.length, 3)
  })

  await test('business rules node: exclude, set, calculate, route, approval holds, hit counts', () => {
    const rules = new Map<string, BusinessRule>([
      ['inactive', { id: 'inactive', name: 'Drop inactive', version: 1, when: { match: 'all', conditions: [{ field: 'STAT', operator: 'equals', value: 'Inactive', valueField: '' }], groups: [] }, then: [{ type: 'exclude' }], otherwise: [] }],
      ['label', { id: 'label', name: 'Label', version: 1, when: { match: 'all', conditions: [], groups: [] }, then: [{ type: 'set_field', field: 'source', value: 'SAP-{PERNR}' }, { type: 'calculate', field: 'salary_k', expr: { kind: 'op', op: '/', left: { kind: 'fn', fn: 'coalesce', args: [{ kind: 'field', name: 'SAL' }, { kind: 'value', value: '0' }] }, right: { kind: 'value', value: '1000' } } }], otherwise: [] }],
      ['big', { id: 'big', name: 'Big salary', version: 1, when: { match: 'all', conditions: [{ field: 'SAL', operator: 'greater_than', value: '5000000', valueField: '' }], groups: [] }, then: [{ type: 'require_approval', reason: 'over 5M' }, { type: 'notify', message: 'Check', emails: [] }], otherwise: [{ type: 'route', branch: 'Normal' }] }],
    ])
    const def = definitionSchema.parse({
      nodes: [
        { id: 'src', type: 'source', dataSourceId: 'x', table: 't' },
        { id: 'rules', type: 'rules', ruleIds: ['inactive', 'label', 'big'] },
        { id: 'r', type: 'router', branches: [{ id: 'n', label: 'Normal' }] },
        { id: 'normal', type: 'destination', kind: 'dataset', datasetName: 'normal', mode: 'append' },
        { id: 'other', type: 'destination', kind: 'dataset', datasetName: 'other', mode: 'append' },
      ],
      edges: [{ id: '1', from: 'src', to: 'rules' }, { id: '2', from: 'rules', to: 'r' }, { id: '3', from: 'r', to: 'normal', branch: 'n' }, { id: '4', from: 'r', to: 'other', branch: 'otherwise' }],
    })
    const rows = [
      { PERNR: '1', STAT: 'Active', SAL: '3000000' },
      { PERNR: '2', STAT: 'Inactive', SAL: '1' },
      { PERNR: '3', STAT: 'Active', SAL: '9000000' },
    ]
    const totals = newRunTotals(def)
    const out = transformChunk(def, rows, totals, { ...emptyContext(), rules })
    const normal = out.byDestination.get('normal')!
    assert.equal(normal.length, 1)
    assert.deepEqual(normal[0], { PERNR: '1', STAT: 'Active', SAL: '3000000', source: 'SAP-1', salary_k: 3000 }, '_nexus_route is stripped before writing')
    assert.equal(out.byDestination.get('other')!.length, 0)
    assert.equal(out.rejects.length, 1)
    assert.equal(out.rejects[0].kind, 'approval')
    assert.equal(totals.heldCount, 1)
    assert.equal(totals.ruleHits['big:then'], 1, 'notify/trigger counts per branch')
    const replay = transformChunk(def, [rows[2]], newRunTotals(def), { ...emptyContext(), rules, approved: true }, {}, { startNodeId: 'rules' })
    assert.equal(replay.byDestination.get('other')!.length, 1, 'an approved row continues downstream')
  })

  await test('data quality: new rule types and severities (warnings are written and flagged)', () => {
    const def = definitionSchema.parse({
      nodes: [
        { id: 'src', type: 'source', dataSourceId: 'x', table: 't' },
        {
          id: 'v',
          type: 'validate',
          rules: [
            { field: 'nik', rule: 'nik' },
            { field: 'npwp', rule: 'npwp', severity: 'warning' },
            { field: 'phone', rule: 'phone', severity: 'warning' },
            { field: 'end', rule: 'compare', otherField: 'start', operator: 'greater_or_equal' },
            { field: 'org', rule: 'exists_in', value: 'organization.org_code' },
            { field: 'start', rule: 'not_future', severity: 'info' },
          ],
        },
        { id: 'd', type: 'destination', kind: 'dataset', datasetName: 'emp', mode: 'append' },
      ],
      edges: [{ id: '1', from: 'src', to: 'v' }, { id: '2', from: 'v', to: 'd' }],
    })
    const ctx = { ...emptyContext(), lookups: new Map([['organization.org_code', new Set(['HR', 'FIN'])]]) }
    const good = { nik: '3174094512900001', npwp: '01.234.567.8-901.000', phone: '0812-3456-7890', start: '2020-01-01', end: '2021-01-01', org: 'HR' }
    const rows = [
      good,
      { ...good, nik: '317409', org: 'XX' },
      { ...good, end: '2019-01-01' },
      { ...good, npwp: '123', phone: '12', start: '2999-01-01', end: '2999-02-01' },
    ]
    const totals = newRunTotals(def)
    const out = transformChunk(def, rows, totals, ctx)
    assert.equal(out.byDestination.get('d')!.length, 2, 'good row + warning-only row are written')
    assert.equal(out.rejects.length, 2)
    assert.deepEqual(out.rejects[0].errors.map((e) => e.split(' ')[0]), ['nik', 'org'])
    assert.match(out.rejects[1].errors[0], /end .* must be greater or equal start/)
    assert.equal(out.flags.length, 1)
    assert.equal(out.flags[0].severity, 'warning')
    assert.equal(out.flags[0].errors.length, 3)
  })

  await test('HR pack: manager checks find unknown managers and reporting cycles', () => {
    const issues = checkManagers([
      { key: 'A', manager: 'B' },
      { key: 'B', manager: 'C' },
      { key: 'C', manager: 'A' },
      { key: 'D', manager: 'A' },
      { key: 'E', manager: 'Z' },
      { key: 'F', manager: 'F' },
    ])
    const by = (k: string) => issues.filter((i) => i.key === k).map((i) => i.message)
    assert.ok(by('A').some((m) => /circular/.test(m)) && by('B').length && by('C').length, 'A→B→C→A flagged')
    assert.equal(by('D').length, 0, 'reporting into a cycle is not itself a cycle')
    assert.match(by('E')[0], /not an employee/)
    // The top of the hierarchy has no manager; reporting to them is fine.
    assert.deepEqual(checkManagers([{ key: 'CEO', manager: '' }, { key: 'X', manager: 'CEO' }, { key: 'Y', manager: 'X' }]), [])
    assert.match(by('F')[0], /own manager/)
  })

  await test('transforms: concat, split, regex extract, hash, number format, conditional, coalesce, timezone', () => {
    const row = { first: 'Budi', last: 'Santoso', alt: 'b@x.io', email: '' }
    const t = (fn: string, value: unknown, ...args: string[]) => applyTransform(value, { fn: fn as never, args }, row)
    assert.equal(t('concat', 'x', '{first} {last}'), 'Budi Santoso')
    assert.equal(t('split', 'a;b;c', ';', '-1'), 'c')
    assert.equal(t('regex_extract', 'EMP-00123/HR', '(\\d+)'), '00123')
    assert.equal(t('hash', 'abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    assert.equal(t('number_format', 1234567.5, '2', 'id-ID'), '1.234.567,50')
    assert.equal(t('conditional', 'A', 'equals', 'A', 'Active', 'Inactive'), 'Active')
    assert.equal(t('conditional', 'X', 'equals', 'A', 'Active', '{value}'), 'X')
    assert.equal(t('coalesce', '', 'email', 'alt'), 'b@x.io')
    assert.equal(t('format_date', '2026-10-08T20:30:00Z', 'yyyy-MM-dd HH:mm', '', 'Asia/Jakarta'), '2026-10-09 03:30')
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

  await test('file upload: headers, detected types, cells and request parts', () => {
    assert.deepEqual(columnNames(['Employee ID', 'Name', 'name', '', '_nexus_x']), ['Employee ID', 'Name', 'name_2', 'column_4', 'nexus_x'])
    assert.equal(detectType(['1', '42', null]), 'integer')
    assert.equal(detectType(['007', '12']), 'text', 'leading zeros stay text (employee numbers, NIK)')
    assert.equal(detectType(['1.5', '2']), 'numeric')
    assert.equal(detectType(['2024-01-31', null]), 'date')
    assert.equal(detectType(['2024-01-31T08:00:00Z', '2024-02-01']), 'timestamp')
    assert.equal(detectType(['true', 'FALSE']), 'boolean')
    assert.equal(detectType(['Finance', '12']), 'text')
    assert.equal(cellText(new Date(Date.UTC(2024, 0, 31))), '2024-01-31')
    assert.equal(cellText('  '), null)
    assert.equal(cellText(12.5), '12.5')
    const sheet = toSheet([['Code', 'Joined'], ['E1', new Date(Date.UTC(2023, 4, 2))], [null, null], ['E2', '2024-01-01']])
    assert.deepEqual(sheet.rows, [['E1', '2023-05-02'], ['E2', '2024-01-01']], 'blank rows dropped')
    assert.deepEqual(sheet.columns.map((c) => c.type), ['text', 'date'])
    const parts = uploadParts(Array.from({ length: 25 }, (_, i) => [String(i)]), 1_000_000, 10)
    assert.deepEqual(parts.map((x) => x.length), [10, 10, 5])
    assert.equal(cleanTableName('Org Chart 2026.xlsx'), 'org_chart_2026')
    assert.equal(cleanTableName('2026 export.csv'), 't_2026_export')
  })

  await test('row-level policies: SQL binds values, checks columns, fails closed', () => {
    const filters: RowFilter[] = [
      { roles: ['analyst'], column: 'company_code', operator: 'equals', value: "KMP'; DROP" },
      { roles: ['analyst'], column: 'grade', operator: 'in_list', value: 'A, B' },
    ]
    const params: unknown[] = []
    const sql = rowFilterSql(filters, new Set(['company_code', 'grade']), (v) => (params.push(v), `$${params.length}`))
    assert.deepEqual(sql, ['"company_code"::text = $1', '"grade"::text = ANY($2::text[])'])
    assert.deepEqual(params, ["KMP'; DROP", ['A', 'B']])
    assert.throws(() => rowFilterSql(filters, new Set(['grade']), () => '$1'), /no longer has/)
    assert.equal(rowAllowed({ company_code: "KMP'; DROP", grade: 'B' }, filters), true)
    assert.equal(rowAllowed({ company_code: 'KMI', grade: 'B' }, filters), false)
    const T = '"nexus_data"."t"'
    const cols = [{ name: 'company_code', type: 'text' }, { name: 'grade', type: 'text' }]
    const w = buildWidgetSql(widgetSchema.parse({ id: 'w', title: 't', dataset: 'd', type: 'kpi', measure: { agg: 'count' } }), T, cols, { rowFilters: [filters[0]] })
    assert.equal(w.text, `SELECT count(*) AS value FROM ${T} WHERE "_nexus_deleted_at" IS NULL AND "company_code"::text = $1`)
  })

  await test('Data API: query parsing, SQL, cursors and pages', () => {
    const cols = ['employee_code', 'department', 'salary']
    const q = parseApiQuery(new URLSearchParams('fields=employee_code&filter[department]=Finance&filter[salary][gte]=100&updated_since=2026-10-01&limit=2&cursor=' + encodeCursor(41)), cols)
    assert.deepEqual(q.fields, ['employee_code'])
    assert.equal(q.afterId, 41)
    const { text, params } = buildApiSql('"nexus_data"."t"', Object.fromEntries(cols.map((c) => [c, c])), q, { datasetColumns: cols })
    assert.match(text, /^SELECT "_nexus_id" AS "__cursor", "employee_code" AS "employee_code" FROM "nexus_data"\."t" WHERE "_nexus_deleted_at" IS NULL AND "department"::text = \$1 AND .* >= \$2::numeric AND "_nexus_loaded_at" >= \$3::timestamptz AND "_nexus_id" > \$4 ORDER BY "_nexus_id" LIMIT \$5$/)
    assert.deepEqual(params, ['Finance', '100', '2026-10-01', 41, 3])
    const domain = buildApiSql('"t"', { employee_code: 'PERNR' }, parseApiQuery(new URLSearchParams('filter[employee_code]=E1'), ['employee_code']), { datasetColumns: ['PERNR'] })
    assert.match(domain.text, /"PERNR" AS "employee_code"/, 'domain entities expose canonical names')
    const bad = (qs: string, re: RegExp) => assert.throws(() => parseApiQuery(new URLSearchParams(qs), cols), (e: Error) => e instanceof ApiQueryError && re.test(e.message))
    bad('fields=password', /Unknown field/)
    bad('filter[x" OR 1 --]=1', /Unknown field/)
    bad('filter[salary][like]=1', /Unknown operator/)
    bad('limit=5000', /limit must be/)
    bad('cursor=abc', /Invalid cursor/)
    bad('updated_since=yesterday', /updated_since/)
    assert.equal(decodeCursor(encodeCursor(7)), 7)
    const page = toPage([{ __cursor: '5', a: 1 }, { __cursor: '6', a: 2 }, { __cursor: '7', a: 3 }], 2)
    assert.deepEqual(page.data, [{ a: 1 }, { a: 2 }])
    assert.equal(decodeCursor(page.next_cursor!), 6)
    assert.equal(toPage([{ __cursor: '5', a: 1 }], 2).next_cursor, null)
  })

  await test('catalog: keys, search and freshness; cache refresh schedules', () => {
    assert.deepEqual(parseKey('source:src_1:hr.employees'), { kind: 'source_table', dataSourceId: 'src_1', tableName: 'hr.employees' })
    assert.deepEqual(parseKey('dataset:employees'), { kind: 'dataset', datasetName: 'employees' })
    assert.equal(parseKey('nope'), null)
    const item = { name: 'employees', description: 'Active staff from SAP', columns: [{ name: 'nik', doc: 'National ID' }], tags: ['hr'], owner: 'budi@kmplus.co.id', sourceName: 'SAP' }
    assert.equal(matchesSearch(item, 'national #hr'), true)
    assert.equal(matchesSearch(item, 'budi sap'), true)
    assert.equal(matchesSearch(item, 'payroll'), false)
    const now = Date.parse('2026-10-11T10:00:00Z')
    assert.equal(freshness('2026-10-11T09:48:00Z', now), '12 min ago')
    assert.equal(freshness(null, now), 'never loaded')
    assert.equal(refreshSchedule('15m').cron, '*/15 * * * *')
    assert.equal(refreshSchedule('after_pipeline').type, 'manual')
  })

  await test('business rules: shared evaluation and readable summary', () => {
    const rule: BusinessRule = {
      id: 'r1',
      name: 'Finance hires',
      version: 1,
      when: { match: 'all', conditions: [{ field: 'department', operator: 'equals', value: 'Finance', valueField: '' }], groups: [] },
      then: [{ type: 'set_field', field: 'label', value: '{name} (fin)' }, { type: 'require_approval', reason: 'payroll' }],
      otherwise: [{ type: 'exclude' }],
    }
    const hit = applyRules([rule], { name: 'Ana', department: 'Finance' })
    assert.equal(hit.row.label, 'Ana (fin)')
    assert.equal(hit.hold, 'Finance hires: payroll')
    assert.deepEqual(hit.hits, ['r1:then'])
    assert.equal(applyRules([rule], { name: 'Ana', department: 'Finance' }, { approved: true }).hold, null)
    assert.equal(applyRules([rule], { department: 'IT' }).keep, false)
    assert.equal(describeRule(rule), 'IF department equals "Finance" THEN set label = "{name} (fin)", hold for approval (payroll) ELSE drop the row')
  })

  await test('credentials: per-workspace keys, bound to source and workspace', async () => {
    process.env.NEXUS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    const { decryptCredentials, encryptCredentials, needsReencryption } = await import('@/lib/security/credentials')
    const sealed = encryptCredentials('src_1', { password: 's3cret' }, 'ws_a')
    assert.equal(sealed.__enc, 'v2')
    assert.equal(sealed.ws, 'ws_a')
    assert.deepEqual(decryptCredentials('src_1', sealed), { password: 's3cret' })
    assert.throws(() => decryptCredentials('src_2', sealed), /could not be decrypted/, 'bound to the data source')
    assert.throws(() => decryptCredentials('src_1', { ...sealed, ws: 'ws_b' }), /could not be decrypted/, 'bound to the workspace')
    assert.throws(() => decryptCredentials('src_1', sealed, 'ws_b'), /another workspace/)
    assert.equal(needsReencryption(sealed), false)
    assert.equal(needsReencryption({ password: 'plain' }), true)
  })

  await test('audit diffs: changed fields only, secrets never recorded, pipeline steps summarized', () => {
    const d = diffObjects({ name: 'A', settings: { retries: 1, batchSize: 5000 }, password: 'old', same: 1 }, { name: 'B', settings: { retries: 2, batchSize: 5000 }, password: 'new', same: 1 })
    assert.deepEqual(d, { name: { from: 'A', to: 'B' }, 'settings.retries': { from: 1, to: 2 }, password: { changed: true } })
    assert.ok(!JSON.stringify(d).includes('new'), 'secret values never appear')
    const before = { nodes: [{ id: 's', type: 'source', table: 'a', position: { x: 0, y: 0 } }, { id: 'f', type: 'filter' }], settings: { retries: 1 } }
    const after = { nodes: [{ id: 's', type: 'source', table: 'b', position: { x: 9, y: 9 } }, { id: 'm', type: 'map' }], settings: { retries: 1 } }
    assert.deepEqual(diffPipelineDefinitions(before, after, (n) => n.type), { stepsAdded: ['map'], stepsRemoved: ['filter'], stepsChanged: ['source'] })
    assert.deepEqual(diffPipelineDefinitions(before, { ...before, nodes: before.nodes.map((n) => ({ ...n, position: { x: 5, y: 5 } })) }, (n) => n.type), {}, 'moving steps is not a change')
  })

  await test('domain synonyms are normalized so every one can match', () => {
    for (const e of DOMAIN_ENTITIES) for (const f of e.fields) for (const syn of f.synonyms) assert.match(syn, /^[a-z0-9]+$/, `${e.name}.${f.name}: ${syn}`)
    assert.equal(suggestCanonicalField('USRID_LONG'), 'email')
    assert.equal(suggestCanonicalField('Tgl Masuk'), 'hire_date')
  })

  await test('lookup transform translates codes through a loaded dataset table', () => {
    const tables = new Map([['orgs|org_code|org_name', new Map<string, unknown>([['FIN', 'Finance'], ['HR', 'Human Resources']])]])
    const lookup = (v: unknown, otherwise = '') => applyTransform(v, { fn: 'lookup', args: ['orgs', 'org_code', 'org_name', otherwise] }, {}, tables)
    assert.equal(lookup(' FIN '), 'Finance')
    assert.equal(lookup('IT'), null, 'not found → null')
    assert.equal(lookup('IT', '{value}'), 'IT', '{value} keeps the input')
    assert.equal(lookup('IT', 'Unknown'), 'Unknown')
    assert.throws(() => applyTransform('FIN', { fn: 'lookup', args: ['nope', 'a', 'b'] }, {}, tables), /not loaded/)
  })

  await test('templates: SAP/AD mapping templates, entity auto-map, every pipeline template is a valid definition', () => {
    const sap = applyMappingTemplate(BUILTIN_MAPPING_TEMPLATES[0], [{ name: 'pernr', type: 'text' }, { name: 'ENAME', type: 'text' }, { name: 'BEGDA', type: 'text' }])
    assert.deepEqual(sap.fields.map((f) => [f.from, f.to]), [['pernr', 'employee_code'], ['ENAME', 'full_name'], ['BEGDA', 'hire_date']])
    assert.ok(sap.missing.includes('ORGEH'))
    assert.equal(applyTransform('20240131', sap.fields[2].transforms[0]), '2024-01-31')
    const begdaEnd = BUILTIN_MAPPING_TEMPLATES[0].fields.find((f) => f.from === 'ENDDA')!
    let v: unknown = '99991231'
    for (const t of begdaEnd.transforms) v = applyTransform(v, t)
    assert.ok(v === '' || v === null, 'SAP open-ended 9999-12-31 means no termination date')
    const ad = BUILTIN_MAPPING_TEMPLATES.find((t) => t.id === 'builtin:ad-users')!
    const mgr = ad.fields.find((f) => f.from === 'manager')!
    assert.equal(applyTransform('CN=Budi Santoso,OU=Staff,DC=kmplus,DC=co,DC=id', mgr.transforms[0]), 'Budi Santoso')
    const uac = ad.fields.find((f) => f.from === 'userAccountControl')!
    assert.equal(applyTransform('514', uac.transforms[0]), 'Disabled')
    assert.equal(applyTransform('512', uac.transforms[0]), 'Enabled')
    assert.deepEqual(mapToEntity([{ name: 'NIP', type: 'varchar' }, { name: 'TGL_MASUK', type: 'date' }, { name: 'random', type: 'text' }], 'employee').map((f) => [f.to, f.type]), [['employee_code', 'text'], ['hire_date', 'date']])
    const cols = [{ name: 'PERNR', type: 'text' }, { name: 'ENAME', type: 'text' }, { name: 'USRID_LONG', type: 'text' }, { name: 'sAMAccountName', type: 'text' }, { name: 'mail', type: 'text' }, { name: 'Join Date', type: 'date' }]
    for (const t of PIPELINE_TEMPLATES) {
      for (const sourceType of ['sap', 'talenta', 'postgres', 'ldap', 'file']) {
        const built = buildPipelineTemplate(t.id, { dataSourceId: 'src_1', sourceType, table: 'Org Chart', columns: cols, datasets: [] })
        const parsed = definitionSchema.safeParse({ schemaVersion: 2, nodes: built.nodes, edges: built.edges, settings: {} })
        assert.ok(parsed.success, `${t.id}/${sourceType}: ${parsed.success ? '' : parsed.error.issues[0]?.message}`)
      }
    }
    const hris = buildPipelineTemplate('hris-employee', { dataSourceId: 's', sourceType: 'sap', table: 'PA0001', columns: cols, datasets: [] })
    const dest = hris.nodes.find((n) => n.type === 'destination')!
    assert.ok(dest.type === 'destination' && dest.kind === 'dataset' && dest.mode === 'upsert' && dest.keys[0] === 'employee_code' && dest.softDeleteMissing)
    assert.ok(hris.nodes.some((n) => n.type === 'validate' && n.rules.some((r) => r.rule === 'unique')), 'HR rule pack added')
    const csv = buildPipelineTemplate('csv-dataset', { dataSourceId: 's', sourceType: 'file', table: 'org_chart_2026', columns: cols, datasets: [] })
    assert.ok(csv.nodes.some((n) => n.type === 'map' && n.fields.some((f) => f.to === 'join_date' && f.type === 'date')))
  })

  await test('lineage: sources → pipelines → datasets → dashboards / entities, with chains', () => {
    const def = (src: string, table: string, ds: string) => definitionSchema.parse({ schemaVersion: 2, nodes: [{ id: 's', type: 'source', dataSourceId: src, table }, { id: 'd', type: 'destination', kind: 'dataset', datasetName: ds }], edges: [{ id: 'e', from: 's', to: 'd' }] })
    const g = buildLineage('dataset:employees', {
      sources: [{ id: 'src_sap', name: 'SAP' }],
      pipelines: [
        { id: 'p1', name: 'Employee sync', definition: def('src_sap', 'PA0001', 'employees'), after: null },
        { id: 'p2', name: 'Org sync', definition: def('src_sap', 'HRP1000', 'orgs'), after: 'p1' },
      ],
      dashboards: [{ id: 'd1', name: 'Headcount', datasets: ['employees'] }],
      entities: [{ entity: 'employee', datasetName: 'employees' }],
    })
    const depth = (id: string) => g.nodes.find((n) => n.id === id)?.depth
    assert.equal(depth('dataset:employees'), 0)
    assert.equal(depth('pipeline:p1'), -1)
    assert.equal(depth('source:src_sap:PA0001'), -2)
    assert.equal(depth('dashboard:d1'), 1)
    assert.equal(depth('entity:employee'), 1)
    assert.equal(depth('pipeline:p2'), undefined, 'a pipeline chained after the producer is not downstream of the dataset')
    const fromSource = buildLineage('source:src_sap:PA0001', { sources: [{ id: 'src_sap', name: 'SAP' }], pipelines: [{ id: 'p1', name: 'x', definition: def('src_sap', 'PA0001', 'employees'), after: null }, { id: 'p2', name: 'y', definition: def('src_sap', 'HRP1000', 'orgs'), after: 'p1' }], dashboards: [], entities: [] })
    assert.equal(fromSource.nodes.find((n) => n.id === 'pipeline:p2')?.depth, 2, 'chained pipelines are downstream of the first one')
    assert.deepEqual(buildLineage('dataset:nope', { sources: [], pipelines: [], dashboards: [], entities: [] }).nodes, [])
  })

  await test('webhooks, SSRF guard, SSO presets, rate-limit headers, OpenAPI, "after" schedules', () => {
    const sig = signPayload('whsec_x', '{"a":1}', 1700000000)
    assert.equal(sig, `t=1700000000,v1=${createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex')}`)
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1', '0.0.0.0']) assert.ok(isPrivateAddress(ip), ip)
    for (const ip of ['8.8.8.8', '20.190.128.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip)
    assert.equal(issuerFor('azure', ' 72f988bf-86f1-41af-91ab-2d7cd011db47 '), 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0')
    assert.equal(issuerFor('okta', 'https://kmplus.okta.com/'), 'https://kmplus.okta.com')
    assert.equal(issuerFor('google', 'ignored'), 'https://accounts.google.com')
    assert.ok(PUBLIC_EMAIL_DOMAINS.has('gmail.com') && DOMAIN_RE.test('kmplus.co.id') && !DOMAIN_RE.test('kmplus') && !DOMAIN_RE.test('-x.com'))
    const blocked = rateLimitHeaders({ allowed: false, limit: 120, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + 30 })
    assert.equal(blocked['X-RateLimit-Remaining'], '0')
    assert.ok(Number(blocked['Retry-After']) >= 1 && Number(blocked['Retry-After']) <= 30)
    assert.equal(rateLimitHeaders({ allowed: true, limit: 120, remaining: 5, resetAt: 0 })['Retry-After'], undefined)
    const spec = openApiSpec('https://nexus.example') as { openapi: string; paths: Record<string, unknown>; webhooks: Record<string, unknown> }
    assert.equal(spec.openapi, '3.1.0')
    for (const path of ['/datasets/{name}', '/domains/{entity}', '/pipelines/{id}/runs', '/runs/{id}']) assert.ok(spec.paths[path], path)
    assert.deepEqual(Object.keys(spec.webhooks).sort(), ['dataset.updated', 'run.failed', 'run.succeeded'])
    const after = scheduleSchema.parse({ type: 'after', afterPipelineId: 'p1', afterOn: 'success_or_partial' })
    assert.deepEqual(nextRunTimes(after, 3), [])
    assert.match(describeSchedule(after), /After another pipeline succeeds \(also partially\)/)
  })

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`)
}

void main()
