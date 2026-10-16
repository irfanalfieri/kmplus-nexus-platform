/**
 * Blocking steps (lanes, phase B): Aggregate and Deduplicate, the pass planner
 * and the finish phase. Pure; run from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { definitionSchema, type AggregateStep, type DedupeStep, type PipelineDefinition, type SourceStep } from '@/lib/pipelines/definition'
import { emptyContext, finishInMemory, newRunTotals, runEngine, transformChunk, type EngineIO } from '@/lib/pipelines/engine'
import { aggregateGroup, aggregateKey, aggregateOutputTypes, aggregateRows, dedupeRows, measure, pickSurvivor, recencyColumn, timeBucket } from '@/lib/pipelines/aggregate'
import { lanePlan, planLanes, replayBlocked } from '@/lib/pipelines/lanes'
import { localizeCheck } from '@/lib/pipelines/check-messages'
import { localizeStepTitle } from '@/components/pipelines/step-title'
import { createTranslator } from '@/lib/i18n/translate'
import type { Row } from '@/lib/pipelines/transforms'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

const people: Row[] = [
  { code: 'E1', org: 'HR', status: 'Active', hired: '2026-01-15', salary: 100, updated_at: '2026-10-01 08:00:00' },
  { code: 'E2', org: 'HR', status: 'Inactive', hired: '2026-01-31', salary: 0.1, updated_at: '2026-10-02 08:00:00' },
  { code: 'E3', org: 'FIN', status: 'Active', hired: '2026-02-01', salary: 0.2, updated_at: '2026-10-03 08:00:00' },
  { code: ' e1 ', org: 'HR', status: 'Active', hired: '2026-03-10', salary: 120, updated_at: '2026-10-05 08:00:00' },
  { code: 'E3', org: 'FIN', status: 'Active', hired: '2026-02-01', salary: 0.3, updated_at: '' },
]
const dst = (id = 'dst', name = 'out') => ({ id, type: 'destination', kind: 'dataset', datasetName: name, mode: 'append' })
const src = (id: string, table: string, extra: object = {}) => ({ id, type: 'source', dataSourceId: `ds_${id}`, table, ...extra })
const headcount = { id: 'agg', type: 'aggregate', groupBy: ['org'], timeGrain: { column: 'hired', grain: 'month' }, measures: [{ name: 'headcount', fn: 'count' }, { name: 'active_headcount', fn: 'count', condition: { match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'Active' }] } }, { name: 'payroll', fn: 'sum', column: 'salary' }] }

export async function blockingTests(test: Test) {
  await test('Aggregate: time buckets, measures (incl. conditional), groups and output types', () => {
    assert.deepEqual(['day', 'week', 'month', 'quarter', 'year'].map((g) => timeBucket('2026-08-13 23:30:00', g as never)), ['2026-08-13', '2026-08-10', '2026-08-01', '2026-07-01', '2026-01-01'])
    assert.equal(timeBucket(new Date('2026-12-31T23:59:00Z'), 'month'), '2026-12-01', 'timestamps are bucketed in UTC')
    assert.equal(timeBucket('2026-03-01T01:00:00+07:00', 'month'), '2026-02-01', 'zoned values are converted to UTC first')
    assert.equal(timeBucket('not a date', 'day'), null)
    const m = (fn: string, extra: object = {}) => measure({ name: 'x', fn: fn as never, column: 'salary', sortBy: '', separator: ', ', ...extra }, people)
    assert.equal(m('count', { column: '' }), 5)
    assert.equal(m('count', { column: 'updated_at' }), 4, 'a column counts only rows where it has a value')
    assert.equal(m('count', { column: '', condition: { match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'active' }], groups: [] } }), 4, 'conditions match like Filter (case-insensitive equals)')
    assert.equal(m('count_distinct', { column: 'org' }), 2)
    assert.equal(measure({ name: 'x', fn: 'sum', column: 'salary', sortBy: '', separator: '' }, people.slice(1, 3)), 0.3, '0.1 + 0.2 = 0.3')
    assert.equal(m('avg'), 44.12)
    assert.equal(m('min', { column: 'hired' }), '2026-01-15')
    assert.equal(m('max', { column: 'hired' }), '2026-03-10')
    assert.equal(m('first', { column: 'code', sortBy: 'hired' }), 'E1')
    assert.equal(m('last', { column: 'code', sortBy: 'updated_at' }), ' e1 ', 'empty sort values are skipped')
    assert.equal(m('last', { column: 'code' }), 'E3', 'no sort column: the last one read')
    assert.equal(m('join', { column: 'org', separator: ' / ' }), 'HR / FIN', 'distinct values in first-seen order')
    assert.deepEqual(m('list', { column: 'org' }), ['HR', 'HR', 'FIN', 'HR', 'FIN'])
    assert.equal(measure({ name: 'x', fn: 'avg', column: 'nothing', sortBy: '', separator: '' }, people), null, 'no values: empty, not 0')

    const node = definitionSchema.parse({ nodes: [src('a', 't'), headcount, dst()], edges: [{ id: '1', from: 'a', to: 'agg' }, { id: '2', from: 'agg', to: 'dst' }] }).nodes.find((n): n is AggregateStep => n.id === 'agg')!
    assert.equal(aggregateKey(people[0], node), '["HR","2026-01-01"]')
    assert.deepEqual(aggregateRows(node, people), [
      { org: 'HR', hired_month: '2026-01-01', headcount: 2, active_headcount: 1, payroll: 100.1 },
      { org: 'FIN', hired_month: '2026-02-01', headcount: 2, active_headcount: 2, payroll: 0.5 },
      { org: 'HR', hired_month: '2026-03-01', headcount: 1, active_headcount: 1, payroll: 120 },
    ])
    assert.deepEqual(aggregateOutputTypes(node, { org: 'text', salary: 'numeric' }), { org: 'text', hired_month: 'date', headcount: 'integer', active_headcount: 'integer', payroll: 'numeric' })
    assert.deepEqual(aggregateGroup({ ...node, groupBy: [], timeGrain: undefined }, people), { headcount: 5, active_headcount: 4, payroll: 220.6 }, 'no group: one row for all')
  })

  await test('Deduplicate: most recent (empty dates lose, ties keep the later), first, last; removed rows become flags', () => {
    const node = (keep: string, recentBy = '') => definitionSchema.parse({ nodes: [src('a', 't'), { id: 'dd', type: 'dedupe', keys: ['code'], keep, recentBy }, dst()], edges: [{ id: '1', from: 'a', to: 'dd' }, { id: '2', from: 'dd', to: 'dst' }] }).nodes.find((n): n is DedupeStep => n.id === 'dd')!
    const recent = node('most_recent', 'updated_at')
    assert.equal(pickSurvivor(recent, [people[0], people[3]]).kept, people[3])
    assert.equal(pickSurvivor(recent, [people[2], people[4]]).kept, people[2], 'a row without a date never wins over one with')
    assert.equal(pickSurvivor(recent, [{ code: 'x', updated_at: '2026-01-01' }, { code: 'y', updated_at: '2026-01-01' }]).kept.code, 'y')
    const { rows, removed } = dedupeRows(recent, people)
    assert.deepEqual(rows.map((r) => r.code), ['E2', 'E3', ' e1 '], 'one per normalized key; " e1 " = "E1"')
    assert.deepEqual(removed.map((r) => r.message), ['Duplicate of code "E1" removed; kept the one with updated_at 2026-10-05 08:00:00', 'Duplicate of code "E3" removed; kept the one with updated_at 2026-10-03 08:00:00'])
    assert.equal(localizeCheck(removed[0].message, 'id'), 'Duplikat code "E1" dihapus; yang dipertahankan memiliki updated_at 2026-10-05 08:00:00')
    assert.deepEqual(dedupeRows(node('first'), people).rows.map((r) => r.code), ['E1', 'E2', 'E3'])
    assert.deepEqual(dedupeRows(node('last'), people).rows.map((r) => r.code), ['E2', ' e1 ', 'E3'])
    assert.deepEqual(dedupeRows(node('first'), [{ code: '' }, { code: null }]).rows.length, 2, 'rows without a key are never duplicates')
    assert.equal(localizeCheck(dedupeRows(node('last'), people).removed[0].message, 'id'), 'Duplikat code "E1" dihapus; yang dipertahankan adalah yang terakhir dibaca')
    assert.equal(recencyColumn([{ name: 'birth_date', type: 'date' }, { name: 'hire_date', type: 'date' }, { name: 'last_modified', type: 'text' }])?.name, 'last_modified')
    assert.equal(recencyColumn([{ name: 'birth_date', type: 'date' }, { name: 'created_at', type: 'timestamp' }]), undefined, 'birth or creation dates never decide "most recent"')
    assert.equal(recencyColumn([{ name: 'synced_at', type: 'timestamp' }])?.name, 'synced_at')
    const t = createTranslator('id')
    assert.equal(localizeStepTitle('Deduplicate on code', t), 'Hapus duplikat berdasarkan code')
    assert.equal(localizeStepTitle('Aggregate by org, hired (month)', t), 'Agregasi per org, hired (month)')
  })

  await test('passes: lookups (incl. an aggregate in a staged lane) first, then the driver, then finish passes; replays stop before blocking steps', () => {
    // Allowances summed per employee in the looked-up lane, then joined; headcount per org at the end.
    const def = definitionSchema.parse({
      nodes: [
        src('hris', 'hris', { driver: true }),
        src('allow', 'allowances'),
        { id: 'sum', type: 'aggregate', groupBy: ['code'], measures: [{ name: 'allowances', fn: 'sum', column: 'amount' }] },
        { id: 'j', type: 'join', keys: [{ left: 'code', right: 'code' }] },
        { id: 'v', type: 'validate', rules: [{ field: 'code', rule: 'required' }] },
        { id: 'dd', type: 'dedupe', keys: ['code'], keep: 'most_recent', recentBy: 'updated_at' },
        { id: 'agg', type: 'aggregate', groupBy: ['org'], measures: [{ name: 'headcount', fn: 'count' }, { name: 'allowances', fn: 'sum', column: 'allowances' }] },
        dst('dst', 'per_org'),
      ],
      edges: [
        { id: '1', from: 'allow', to: 'sum' },
        { id: '2', from: 'sum', to: 'j', port: 'right' },
        { id: '3', from: 'hris', to: 'v' },
        { id: '4', from: 'v', to: 'j', port: 'left' },
        { id: '5', from: 'j', to: 'dd' },
        { id: '6', from: 'dd', to: 'agg' },
        { id: '7', from: 'agg', to: 'dst' },
      ],
    })
    const plan = planLanes(def)
    assert.deepEqual(plan.issues, [])
    assert.deepEqual(plan.passes.map((p) => [p.id, p.kind, p.staged, p.sinks, p.needs]), [
      ['allow', 'source', true, ['sum'], []],
      ['sum', 'finish', true, ['j'], ['sum']],
      ['hris', 'source', false, ['dd'], ['j']],
      ['dd', 'finish', false, ['agg'], ['dd']],
      ['agg', 'finish', false, [], ['agg']],
    ])
    assert.equal(replayBlocked(def, plan, 'v'), true, 'a row held before a blocking step needs a re-run')
    const after = definitionSchema.parse({ ...def, nodes: def.nodes.map((n) => (n.id === 'dd' ? { ...n, keep: 'first' } : n)) })
    assert.equal(replayBlocked(after, lanePlan(after), 'v'), true, 'still: the Aggregate comes later')
    assert.equal(lanePlan(after).passes.some((p) => p.id === 'dd'), false, 'keeping the first row streams: no finish pass')
  })

  await test('validation: an Aggregate refuses incremental reads of its lanes; measures need columns and unique names', () => {
    const issues = (d: object) => {
      const r = definitionSchema.safeParse(d)
      return r.success ? [] : r.error.issues.map((i) => i.message)
    }
    const graph = (source: object, agg: object) => ({ nodes: [src('a', 'hris', source), { ...headcount, ...agg }, dst()], edges: [{ id: '1', from: 'a', to: 'agg' }, { id: '2', from: 'agg', to: 'dst' }] })
    assert.deepEqual(issues(graph({}, {})), [])
    assert.ok(issues(graph({ mode: 'incremental', watermarkColumn: 'updated_at' }, {})).some((m) => /needs a full read: set "Read hris" to Full/.test(m)))
    assert.ok(issues(graph({}, { measures: [{ name: 'total', fn: 'sum' }] })).some((m) => /"total" needs a column/.test(m)))
    assert.ok(issues(graph({}, { measures: [{ name: 'org', fn: 'count' }] })).some((m) => /"org" appears twice/.test(m)))
    assert.ok(issues(graph({}, { measures: [] })).some((m) => /at least one measure/.test(m)))
    const dd = { nodes: [src('a', 't'), { id: 'dd', type: 'dedupe', keys: ['code'], keep: 'most_recent' }, dst()], edges: [{ id: '1', from: 'a', to: 'dd' }, { id: '2', from: 'dd', to: 'dst' }] }
    assert.ok(issues(dd).some((m) => /date or timestamp column/.test(m)))
  })

  await test('engine: headcount per org per month, dedupe keeps the latest record with flags, aggregate in a looked-up lane', async () => {
    const def = definitionSchema.parse({
      nodes: [src('hris', 'hris'), { id: 'dd', type: 'dedupe', keys: ['code'], keep: 'most_recent', recentBy: 'updated_at' }, headcount, dst('dst', 'headcount')],
      edges: [{ id: '1', from: 'hris', to: 'dd' }, { id: '2', from: 'dd', to: 'agg' }, { id: '3', from: 'agg', to: 'dst' }],
    })
    const writes: Record<string, Row[]> = {}
    const io: EngineIO = { read: async () => people.map((r) => ({ ...r })), write: async (s, rows, columns) => ((writes[s.id] = rows), (writes[`${s.id}:columns`] = columns as never), { written: rows.length, target: s.id }) }
    const res = await runEngine(def, io)
    assert.equal(res.status, 'success', res.error)
    assert.deepEqual(writes.dst, [
      { org: 'HR', hired_month: '2026-01-01', headcount: 1, active_headcount: 0, payroll: 0.1 },
      { org: 'FIN', hired_month: '2026-02-01', headcount: 1, active_headcount: 1, payroll: 0.2 },
      { org: 'HR', hired_month: '2026-03-01', headcount: 1, active_headcount: 1, payroll: 120 },
    ])
    assert.deepEqual((writes['dst:columns'] as unknown as { name: string; type: string }[]).map((c) => `${c.name}:${c.type}`), ['org:text', 'hired_month:date', 'headcount:integer', 'active_headcount:integer', 'payroll:numeric'])
    assert.equal(res.flaggedCount, 2)
    assert.deepEqual(res.rejects.map((r) => [r.stepId, r.kind, r.row.code]), [['dd', 'flag', 'E1'], ['dd', 'flag', 'E3']])
    assert.deepEqual([res.steps.find((s) => s.id === 'dd')!.rowsIn, res.steps.find((s) => s.id === 'agg')!.rowsOut], [5, 3])

    // Allowances per employee (aggregated in the looked-up lane), then joined to each employee.
    const allowances = [{ code: 'E1', amount: 10 }, { code: 'E1', amount: 5 }, { code: 'E3', amount: 7 }]
    const joined = definitionSchema.parse({
      nodes: [src('hris', 'hris', { driver: true }), src('allow', 'allowances'), { id: 'sum', type: 'aggregate', groupBy: ['code'], measures: [{ name: 'allowances', fn: 'sum', column: 'amount' }] }, { id: 'j', type: 'join', keys: [{ left: 'code', right: 'code' }] }, dst()],
      edges: [{ id: '1', from: 'allow', to: 'sum' }, { id: '2', from: 'sum', to: 'j', port: 'right' }, { id: '3', from: 'hris', to: 'j', port: 'left' }, { id: '4', from: 'j', to: 'dst' }],
    })
    const out: Record<string, Row[]> = {}
    const data: Record<string, Row[]> = { hris: people.slice(0, 3), allowances }
    // readByKeys exists, but the Aggregate on the way means the lane is read and aggregated in full.
    const asked: string[] = []
    await runEngine(joined, { read: async (s) => data[s.table], readByKeys: async (s) => (asked.push(s.table), null), write: async (s, rows) => ((out[s.id] = rows), { written: rows.length, target: s.id }) })
    assert.deepEqual(asked, [])
    assert.deepEqual(out.dst.map((r) => [r.code, r.allowances ?? null]), [['E1', 15], ['E2', null], ['E3', 7]])
  })

  await test('engine: Deduplicate "first" streams across chunks; a finish pass over staged groups matches one pass', async () => {
    const def = definitionSchema.parse({
      nodes: [src('hris', 'hris'), { id: 'dd', type: 'dedupe', keys: ['code'], keep: 'first' }, dst()],
      edges: [{ id: '1', from: 'hris', to: 'dd' }, { id: '2', from: 'dd', to: 'dst' }],
    })
    const writes: Record<string, Row[]> = {}
    const whole = await runEngine(def, { read: async () => people, write: async (s, rows) => ((writes[s.id] = rows), { written: rows.length, target: s.id }) })
    for (const size of [1, 2]) {
      const totals = newRunTotals(def)
      const ctx = emptyContext()
      const written: Row[] = []
      let flags = 0
      for (let i = 0; i < people.length; i += size) {
        const o = await transformChunk(def, people.slice(i, i + size), totals, ctx)
        written.push(...(o.byDestination.get('dst') ?? []))
        flags += o.flags.length
      }
      assert.deepEqual(written, writes.dst, `chunk size ${size}`)
      assert.equal(flags, whole.flaggedCount)
    }

    // The worker's finish phase in memory: stage in chunks, answer groups, continue from the step.
    const agg = definitionSchema.parse({ nodes: [src('hris', 'hris'), headcount, dst()], edges: [{ id: '1', from: 'hris', to: 'agg' }, { id: '2', from: 'agg', to: 'dst' }] }) as PipelineDefinition
    const node = agg.nodes.find((n): n is AggregateStep => n.id === 'agg')!
    const one: Record<string, Row[]> = {}
    await runEngine(agg, { read: async () => people, write: async (s, rows) => ((one[s.id] = rows), { written: rows.length, target: s.id }) })
    const totals = newRunTotals(agg)
    const staged: Row[] = []
    for (let i = 0; i < people.length; i += 2) {
      const o = await transformChunk(agg, people.slice(i, i + 2), totals, emptyContext(), {}, { entry: 'hris' })
      assert.equal(o.byDestination.get('dst')?.length ?? 0, 0, 'nothing passes a blocking step before its finish pass')
      staged.push(...(o.toStage.get('agg') ?? []))
    }
    const groups = new Map<string, Row[]>()
    for (const r of staged) groups.set(aggregateKey(r, node), [...(groups.get(aggregateKey(r, node)) ?? []), r])
    const keys = [...groups.keys()].sort()
    const answered = keys.map((k) => aggregateGroup(node, groups.get(k)!))
    const fin = await transformChunk(agg, answered, totals, emptyContext(), aggregateOutputTypes(node), { startNodeId: 'agg', finish: true })
    const byKey = (rows: Row[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    assert.deepEqual(byKey(fin.byDestination.get('dst')!), byKey(one.dst), 'same groups in key order as one pass')
    assert.equal(totals.steps.find((s) => s.id === 'agg')!.rowsOut, 3)
    assert.equal(finishInMemory(node, [], newRunTotals(agg)).rows.length, 0)
    void (agg.nodes.find((n) => n.type === 'source') as SourceStep)
  })
}
