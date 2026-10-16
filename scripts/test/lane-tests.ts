/**
 * Several sources (lanes, phase A): lane planning,
 * Join and Union, staged lookups in chunks, sample tests by key, lineage,
 * flow lines and promotion. Pure; run from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { definitionSchema, type JoinStep, type PipelineDefinition, type SourceStep } from '@/lib/pipelines/definition'
import { emptyContext, newRunTotals, pushdownColumn, runEngine, transformChunk, type EngineIO, type StagedPartners } from '@/lib/pipelines/engine'
import { isStagedStep, joinPrefix, lanePlan, passNodes, planLanes } from '@/lib/pipelines/lanes'
import { joinKey, joinOutputColumns, joinRows, normalizeKeyPart, pickFirst } from '@/lib/pipelines/join'
import { localizeCheck } from '@/lib/pipelines/check-messages'
import { localizeStepTitle } from '@/components/pipelines/step-title'
import { createTranslator } from '@/lib/i18n/translate'
import { buildLineage } from '@/lib/catalog/lineage'
import { planPromotion } from '@/lib/pipelines/promote'
import { ends } from '@/components/pipelines/line-state'
import { DEFAULT_SCHEDULE } from '@/lib/pipelines/definition'
import type { Row } from '@/lib/pipelines/transforms'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

const hris: Row[] = [
  { employee_code: 'E001', name: 'Amira', org_code: 'HR' },
  { employee_code: ' e002 ', name: 'Daniel', org_code: 'FIN' },
  { employee_code: 'E003', name: 'Sofia', org_code: 'XX' },
  { employee_code: 'E004', name: 'Budi', org_code: 'HR' },
]
const payroll: Row[] = [
  { employee_code: 'E001', salary: 100, name: 'AMIRA R' },
  { employee_code: 'E002', salary: 90, name: 'DANIEL L' },
  { employee_code: 'E002', salary: 95, name: 'DANIEL L' },
]
const orgs: Row[] = [
  { org_code: 'HR', org_name: 'Human Resources' },
  { org_code: 'FIN', org_name: 'Finance' },
]
const contractors: Row[] = [{ employee_code: 'C100', name: 'Cahya', org_code: 'FIN' }]

const src = (id: string, table: string, extra: object = {}) => ({ id, type: 'source', dataSourceId: `ds_${id}`, table, ...extra })
const join = (id: string, extra: object = {}) => ({ id, type: 'join', keys: [{ left: 'employee_code', right: 'employee_code' }], ...extra })

/** HRIS (driver) ⋈ payroll API, ∪ contractors, ⋈ org table (no partner → quarantine) → dataset. */
function threeSources(over: { pay?: object; org?: object } = {}) {
  return definitionSchema.parse({
    nodes: [
      src('hris', 'hris', { driver: true }),
      src('pay', 'payroll'),
      src('contract', 'contractors'),
      src('org', 'orgs'),
      join('j_pay', over.pay),
      { id: 'u', type: 'union' },
      join('j_org', { keys: [{ left: 'org_code', right: 'org_code' }], onNoMatch: 'quarantine', ...over.org }),
      { id: 'dst', type: 'destination', kind: 'dataset', datasetName: 'people', mode: 'append' },
    ],
    edges: [
      { id: 'e1', from: 'hris', to: 'j_pay', port: 'left' },
      { id: 'e2', from: 'pay', to: 'j_pay', port: 'right' },
      { id: 'e3', from: 'j_pay', to: 'u' },
      { id: 'e4', from: 'contract', to: 'u' },
      { id: 'e5', from: 'u', to: 'j_org', port: 'left' },
      { id: 'e6', from: 'org', to: 'j_org', port: 'right' },
      { id: 'e7', from: 'j_org', to: 'dst' },
    ],
  })
}

const tables: Record<string, Row[]> = { hris, payroll, orgs, contractors }
const memoryIO = (writes: Record<string, Row[]> = {}): EngineIO => ({
  read: async (step) => tables[step.table].map((r) => ({ ...r })),
  write: async (step, rows) => ((writes[step.id] = rows), { written: rows.length, target: step.id }),
})

/**
 * The worker's phases in memory: stage each Join's right side (passes in plan
 * order, chunked), then stream every streamed source in chunks, looking up the
 * staged rows by normalized key.
 */
async function chunkedRun(def: PipelineDefinition, size: number) {
  const plan = lanePlan(def)
  const totals = newRunTotals(def)
  const stage = new Map<string, Row[]>()
  const ctx = emptyContext()
  ctx.joinPartners = async (j: JoinStep, keys: string[]): Promise<StagedPartners> => {
    const wanted = new Set(keys)
    const partners = new Map<string, Row[]>()
    const rows = stage.get(j.id) ?? []
    for (const r of rows) {
      const k = joinKey(r, j.keys.map((x) => x.right), j.normalize)
      if (k !== null && wanted.has(k)) partners.set(k, [...(partners.get(k) ?? []), r])
    }
    return { partners, columns: [...new Set(rows.flatMap((r) => Object.keys(r)))] }
  }
  const step = (id: string) => def.nodes.find((n): n is SourceStep => n.type === 'source' && n.id === id)!
  for (const j of plan.joins) {
    for (const s of j.sources) {
      const all = tables[step(s).table]
      for (let i = 0; i < all.length; i += size) {
        const out = await transformChunk(def, all.slice(i, i + size), totals, ctx, {}, { entry: s, stage: true })
        stage.set(j.id, [...(stage.get(j.id) ?? []), ...(JSON.parse(JSON.stringify(out.toStage.get(j.id) ?? [])) as Row[])])
      }
    }
  }
  const written: Row[] = []
  let rejects = 0
  for (const s of plan.streamed) {
    const all = tables[step(s).table]
    for (let i = 0; i < all.length; i += size) {
      const out = await transformChunk(def, all.slice(i, i + size), totals, ctx, {}, { entry: s })
      written.push(...(out.byDestination.get('dst') ?? []))
      rejects += out.rejects.length
    }
  }
  return { written, rejects, totals }
}

export async function laneTests(test: Test) {
  await test('lanes: driver streams, Join right sides are staged in dependency order, Union partners stream after the driver', () => {
    const def = threeSources()
    const plan = planLanes(def)
    assert.deepEqual(plan.issues, [])
    assert.equal(plan.driver, 'hris')
    assert.deepEqual(plan.streamed, ['hris', 'contract'], 'Union partners stream one after another')
    assert.deepEqual(plan.joins.map((j) => [j.id, j.sources]), [['j_pay', ['pay']], ['j_org', ['org']]])
    assert.deepEqual([...plan.lanes.get('j_pay')!], ['hris'], 'a Join passes on its left lane only')
    assert.deepEqual([...plan.lanes.get('u')!].sort(), ['contract', 'hris'])
    assert.ok(isStagedStep(plan, 'pay') && !isStagedStep(plan, 'hris') && !isStagedStep(plan, 'j_pay'))
    const draft = { nodes: [...def.nodes, definitionSchema.parse({ steps: [src('x', 't'), { id: 'z', type: 'destination', kind: 'dataset', datasetName: 'z', mode: 'append' }] }).nodes[0]], edges: def.edges }
    assert.equal(isStagedStep(planLanes(draft), 'x'), false, 'a Source not connected yet is not "looked up"')
    assert.deepEqual([...passNodes(def, 'pay')].sort(), ['j_pay', 'pay'], 'a stage pass stops at the right side')
    assert.equal(joinPrefix(def, plan, def.nodes.find((n): n is JoinStep => n.id === 'j_pay')!), 'payroll_', 'clashing right columns get the right table as prefix')

    // A single Source is the driver implicitly: existing pipelines stay valid.
    const single = definitionSchema.parse({ steps: [src('a', 't'), { id: 'z', type: 'destination', kind: 'dataset', datasetName: 'out', mode: 'append' }] })
    assert.equal(planLanes(single).driver, 'a')

    // A staged lane may join another staged lane: the inner Join is staged first.
    const nested = definitionSchema.parse({
      nodes: [src('hris', 'hris', { driver: true }), src('pay', 'payroll'), src('bank', 'banks'), join('j_bank'), join('j_pay'), { id: 'dst', type: 'destination', kind: 'dataset', datasetName: 'x', mode: 'append' }],
      edges: [
        { id: '1', from: 'pay', to: 'j_bank', port: 'left' },
        { id: '2', from: 'bank', to: 'j_bank', port: 'right' },
        { id: '3', from: 'hris', to: 'j_pay', port: 'left' },
        { id: '4', from: 'j_bank', to: 'j_pay', port: 'right' },
        { id: '5', from: 'j_pay', to: 'dst' },
      ],
    })
    assert.deepEqual(lanePlan(nested).joins.map((j) => [j.id, j.sources]), [['j_bank', ['bank']], ['j_pay', ['pay']]])
  })

  await test('lanes: the editor refuses no driver, two drivers, a lane feeding two places, a same-lane Join and missing sides', () => {
    const issues = (d: object) => {
      const r = definitionSchema.safeParse(d)
      return r.success ? [] : r.error.issues.map((i) => i.message)
    }
    const dst = { id: 'dst', type: 'destination', kind: 'dataset', datasetName: 'x', mode: 'append' }
    const twoSources = (a: object, b: object) => ({
      nodes: [src('a', 'ta', a), src('b', 'tb', b), join('j'), dst],
      edges: [{ id: '1', from: 'a', to: 'j', port: 'left' }, { id: '2', from: 'b', to: 'j', port: 'right' }, { id: '3', from: 'j', to: 'dst' }],
    })
    assert.deepEqual(issues(twoSources({ driver: true }, {})), [])
    assert.ok(issues(twoSources({}, {})).some((m) => /Mark one Source as the driver/.test(m)))
    assert.ok(issues(twoSources({ driver: true }, { driver: true })).some((m) => /Only one Source can be the driver/.test(m)))
    assert.ok(issues(twoSources({}, { driver: true })).some((m) => /driver Source must lead to a Destination/.test(m)), 'the driver cannot be the looked-up side')
    const fanOut = { nodes: [src('a', 'ta', { driver: true }), src('b', 'tb'), join('j'), dst, { ...dst, id: 'dst2', datasetName: 'y' }], edges: [{ id: '1', from: 'a', to: 'j', port: 'left' }, { id: '2', from: 'b', to: 'j', port: 'right' }, { id: '3', from: 'j', to: 'dst' }, { id: '4', from: 'b', to: 'dst2' }] }
    assert.ok(issues(fanOut).some((m) => /feeds more than one place/.test(m)))
    const sameLane = { nodes: [src('a', 'ta'), { id: 'f', type: 'filter', conditions: [{ field: 'x', operator: 'is_not_empty' }] }, join('j'), dst], edges: [{ id: '1', from: 'a', to: 'f' }, { id: '2', from: 'f', to: 'j', port: 'left' }, { id: '3', from: 'a', to: 'j', port: 'right' }, { id: '4', from: 'j', to: 'dst' }] }
    assert.ok(issues(sameLane).some((m) => /same Source/.test(m)))
    const oneSide = { nodes: [src('a', 'ta'), join('j'), dst], edges: [{ id: '1', from: 'a', to: 'j', port: 'left' }, { id: '3', from: 'j', to: 'dst' }] }
    assert.ok(issues(oneSide).some((m) => /exactly one input to each side/.test(m)))
    const noPort = { nodes: [src('a', 'ta', { driver: true }), src('b', 'tb'), join('j'), dst], edges: [{ id: '1', from: 'a', to: 'j' }, { id: '2', from: 'b', to: 'j', port: 'right' }, { id: '3', from: 'j', to: 'dst' }] }
    assert.ok(issues(noPort).some((m) => /left \(driving\) or right/.test(m)))
    assert.ok(issues({ nodes: [src('a', 'ta'), dst], edges: [{ id: '1', from: 'a', to: 'dst', port: 'left' }] }).some((m) => /Only connections into a Join/.test(m)))
    const lonelyUnion = { nodes: [src('a', 'ta'), { id: 'u', type: 'union' }, dst], edges: [{ id: '1', from: 'a', to: 'u' }, { id: '2', from: 'u', to: 'dst' }] }
    assert.ok(issues(lonelyUnion).some((m) => /at least two inputs/.test(m)))
    const elevenSources = { nodes: [...Array.from({ length: 11 }, (_, i) => src(`s${i}`, `t${i}`, { driver: i === 0 })), dst], edges: Array.from({ length: 11 }, (_, i) => ({ id: `e${i}`, from: `s${i}`, to: 'dst' })) }
    assert.ok(issues(elevenSources).some((m) => /at most 10 sources/.test(m)))
  })

  await test('Join: key normalization, one row per match, first match, keep / drop / quarantine, no match, prefixes', () => {
    const n = { trim: true, ignoreCase: true, leadingZeros: true }
    assert.equal(normalizeKeyPart(' E00123 ', n), 'e00123')
    assert.equal(normalizeKeyPart('00123', n), '123')
    assert.equal(normalizeKeyPart('000', n), '0')
    assert.equal(normalizeKeyPart('  ', n), null, 'empty keys never match')
    assert.equal(normalizeKeyPart(null, n), null)
    assert.equal(normalizeKeyPart(' A ', { trim: false, ignoreCase: false, leadingZeros: false }), ' A ')
    assert.equal(joinKey({ a: '1', b: 'X' }, ['a', 'b'], n), '1\u0001x')
    assert.equal(joinKey({ a: '1', b: '' }, ['a', 'b'], n), null)

    const node = (extra: object) => definitionSchema.parse({ nodes: [src('a', 't', { driver: true }), { ...join('j'), ...extra }, src('b', 'payroll', {}), { id: 'd', type: 'destination', kind: 'dataset', datasetName: 'x', mode: 'append' }], edges: [{ id: '1', from: 'a', to: 'j', port: 'left' }, { id: '2', from: 'b', to: 'j', port: 'right' }, { id: '3', from: 'j', to: 'd' }] }).nodes.find((x): x is JoinStep => x.id === 'j')!
    const index = (j: JoinStep) => {
      const m = new Map<string, Row[]>()
      for (const r of payroll) m.set(joinKey(r, ['employee_code'], j.normalize)!, [...(m.get(joinKey(r, ['employee_code'], j.normalize)!) ?? []), r])
      return m
    }
    const opts = { prefix: 'payroll_', rightColumns: ['employee_code', 'salary', 'name'] }
    const left = node({})
    assert.deepEqual([left.joinType, left.onMany, left.onNoMatch, left.normalize], ['left', 'all', 'keep', { trim: true, ignoreCase: true, leadingZeros: false }], 'decided defaults')
    const res = joinRows(left, hris, index(left), opts)
    assert.equal(res.matched, 2)
    assert.equal(res.multiplied, 1, 'E002 has two payroll records')
    assert.deepEqual(res.rows.map((r) => [r.employee_code, r.salary, r.payroll_name ?? null]), [['E001', 100, 'AMIRA R'], [' e002 ', 90, 'DANIEL L'], [' e002 ', 95, 'DANIEL L'], ['E003', null, null], ['E004', null, null]])
    assert.ok(!('payroll_employee_code' in res.rows[0]), 'a key with the same name on both sides is kept once')
    assert.equal(res.rows[0].name, 'Amira', 'the left value keeps its name; the right one is prefixed')

    const inner = joinRows(node({ joinType: 'inner', onNoMatch: 'drop' }), hris, index(left), opts)
    assert.deepEqual(inner.rows.map((r) => r.employee_code), ['E001', ' e002 ', ' e002 '])
    const held = joinRows(node({ onNoMatch: 'quarantine' }), hris, index(left), opts)
    assert.deepEqual(held.unmatched.map((r) => r.employee_code), ['E003', 'E004'])
    assert.equal(joinRows(node({ onNoMatch: 'drop' }), hris, index(left), opts).rows.length, 3)
    const anti = joinRows(node({ joinType: 'no_match' }), hris, index(left), opts)
    assert.deepEqual(anti.rows, [hris[2], hris[3]], 'no match: left rows without a partner, unchanged')
    const first = joinRows(node({ onMany: 'first', firstBy: { column: 'salary', direction: 'desc' } }), hris, index(left), opts)
    assert.deepEqual(first.rows.map((r) => r.salary), [100, 95, null, null])
    assert.equal(first.multiplied, 0)
    assert.equal(pickFirst([{ d: '' }, { d: '2026-01-02' }, { d: '2026-03-01' }], { column: 'd', direction: 'asc' }).d, '2026-01-02', 'empty values sort last')
    assert.equal(pickFirst([{ x: 1 }, { x: 2 }], { column: '', direction: 'desc' }).x, 1, 'no sort column: the first staged')
    const strict = node({ normalize: { trim: false, ignoreCase: false, leadingZeros: false } })
    assert.equal(joinRows(strict, hris, index(strict), opts).matched, 1, 'without normalization " e002 " finds no partner')
    assert.deepEqual(
      joinOutputColumns(left, [{ name: 'employee_code' }, { name: 'name' }], [{ name: 'employee_code' }, { name: 'name' }, { name: 'salary' }, { name: '_stage_row' }], 'payroll_').map((c) => c.name),
      ['employee_code', 'name', 'payroll_name', 'salary']
    )
  })

  await test('engine: a 3-source pipeline joins payroll, unions contractors, joins orgs; no-match rows quarantined with a readable reason', async () => {
    const def = threeSources()
    const writes: Record<string, Row[]> = {}
    const res = await runEngine(def, memoryIO(writes))
    assert.equal(res.status, 'partial', res.error)
    assert.deepEqual(
      writes.dst.map((r) => [r.employee_code, r.salary ?? null, r.org_name, r._source]),
      [['E001', 100, 'Human Resources', 'hris'], [' e002 ', 90, 'Finance', 'hris'], [' e002 ', 95, 'Finance', 'hris'], ['E004', null, 'Human Resources', 'hris'], ['C100', null, 'Finance', 'contractors']]
    )
    assert.equal(res.rowsRead, hris.length + contractors.length, 'staged rows are not "read" rows')
    assert.equal(res.stagedRows, payroll.length + orgs.length)
    const stat = (id: string) => res.steps.find((s) => s.id === id)!
    assert.deepEqual([stat('j_pay').rowsIn, stat('j_pay').matched, stat('j_pay').multiplied, stat('j_pay').staged], [4, 2, 1, 3])
    assert.deepEqual([stat('j_org').rowsIn, stat('j_org').matched, stat('j_org').rejected], [6, 5, 1])
    assert.equal(res.rejects.length, 1)
    assert.equal(res.rejects[0].stepId, 'j_org')
    assert.equal(res.rejects[0].errors[0], 'No match in orgs for org_code "XX"')
    assert.equal(localizeCheck(res.rejects[0].errors[0], 'id'), 'Tidak ada pasangan di orgs untuk org_code "XX"')
    assert.ok(res.columns.some((c) => c.name === 'org_name') && res.columns.some((c) => c.name === 'payroll_name'), 'columns past a Join are inferred, not taken from a Map before it')
    const t = createTranslator('en')
    assert.equal(localizeStepTitle(stat('j_pay').label, createTranslator('id')), 'Gabung berdasarkan employee_code')
    assert.equal(localizeStepTitle('Union', t), 'Union')
  })

  await test('engine: chunked stage + stream (any chunk size) writes the same rows as one pass; a replay re-enters at the Join', async () => {
    const def = threeSources()
    const writes: Record<string, Row[]> = {}
    const whole = await runEngine(def, memoryIO(writes))
    for (const size of [1, 2, 3]) {
      const { written, rejects, totals } = await chunkedRun(def, size)
      assert.deepEqual(written, writes.dst, `chunk size ${size}: same rows`)
      assert.equal(rejects, whole.rejectedCount, `chunk size ${size}: same quarantine`)
      assert.equal(totals.steps.find((s) => s.id === 'j_pay')!.multiplied, 1)
    }
    // The held row replays from the Join once its partner exists.
    const ctx = emptyContext()
    ctx.joinPartners = async () => ({ partners: new Map([['xx', [{ org_code: 'XX', org_name: 'New unit' }]]]), columns: ['org_code', 'org_name'] })
    const replay = await transformChunk(def, [whole.rejects[0].row], newRunTotals(def), ctx, {}, { startNodeId: 'j_org' })
    assert.deepEqual(replay.byDestination.get('dst')!.map((r) => [r.employee_code, r.org_name]), [['E003', 'New unit']])
    assert.equal(replay.rejects.length, 0)
    // Without staged rows a Join refuses to run instead of silently dropping its right side.
    await assert.rejects(() => transformChunk(def, hris, newRunTotals(def), emptyContext()), /right side was not staged/)
  })

  await test('sample tests: a Join reads only the sample keys from a lane that keeps its key; whole lanes otherwise', async () => {
    const def = threeSources()
    const asked: { table: string; column: string; keys: string[] }[] = []
    const read: string[] = []
    const io: EngineIO = {
      read: async (step) => (read.push(step.table), tables[step.table].map((r) => ({ ...r }))),
      readByKeys: async (step, column, keys, normalize) => {
        asked.push({ table: step.table, column, keys })
        return tables[step.table].filter((r) => keys.includes(normalizeKeyPart(r[column], normalize) ?? ''))
      },
    }
    const res = await runEngine(def, io, { sampleSize: 25 })
    // Each streamed source looks up its own keys: contractors arrive after the driver, at the org Join only.
    assert.deepEqual(asked.map((a) => [a.table, a.column, a.keys]), [['payroll', 'employee_code', ['e001', 'e002', 'e003', 'e004']], ['orgs', 'org_code', ['hr', 'fin', 'xx']], ['orgs', 'org_code', ['fin']]])
    assert.deepEqual(read.sort(), ['contractors', 'hris'], 'only streamed sources are read whole')
    assert.equal(res.steps.find((s) => s.id === 'j_pay')!.matched, 2, '"2 of 4 matched", not "0 of 4"')
    assert.ok(res.steps.find((s) => s.id === 'j_pay')!.sample?.length, 'the Join shows its joined rows')

    // A Map on the right lane may rename the key: the sample reads the lane and filters.
    const mapped = definitionSchema.parse({
      nodes: [src('hris', 'hris', { driver: true }), src('pay', 'payroll'), { id: 'm', type: 'map', keepUnmapped: true, fields: [{ from: 'employee_code', to: 'code' }] }, join('j', { keys: [{ left: 'employee_code', right: 'code' }] }), { id: 'dst', type: 'destination', kind: 'dataset', datasetName: 'x', mode: 'append' }],
      edges: [{ id: '1', from: 'hris', to: 'j', port: 'left' }, { id: '2', from: 'pay', to: 'm' }, { id: '3', from: 'm', to: 'j', port: 'right' }, { id: '4', from: 'j', to: 'dst' }],
    })
    const j = mapped.nodes.find((x): x is JoinStep => x.id === 'j')!
    assert.equal(pushdownColumn(mapped, j, 'pay'), null)
    asked.length = 0
    read.length = 0
    const res2 = await runEngine(mapped, io, { sampleSize: 25 })
    assert.equal(asked.length, 0)
    assert.deepEqual(read.sort(), ['hris', 'payroll'])
    assert.equal(res2.steps.find((s) => s.id === 'j')!.matched, 2)
  })

  await test('incremental: every source keeps its own watermark; the driver\'s is the pipeline\'s position', async () => {
    const withTimes = (rows: Row[], start: number) => rows.map((r, i) => ({ ...r, updated_at: `2026-10-${String(start + i).padStart(2, '0')}` }))
    const def = definitionSchema.parse({
      nodes: [src('hris', 'hris', { driver: true, mode: 'incremental', watermarkColumn: 'updated_at' }), src('pay', 'payroll', { mode: 'incremental', watermarkColumn: 'updated_at' }), join('j'), { id: 'dst', type: 'destination', kind: 'dataset', datasetName: 'x', mode: 'append' }],
      edges: [{ id: '1', from: 'hris', to: 'j', port: 'left' }, { id: '2', from: 'pay', to: 'j', port: 'right' }, { id: '3', from: 'j', to: 'dst' }],
    })
    const data: Record<string, Row[]> = { hris: withTimes(hris, 1), payroll: withTimes(payroll, 10) }
    const res = await runEngine(def, { read: async (s) => data[s.table], write: async (_s, rows) => ({ written: rows.length, target: 't' }) })
    assert.deepEqual(res.watermarks, { pay: { column: 'updated_at', value: '2026-10-12' }, hris: { column: 'updated_at', value: '2026-10-04' } })
    assert.deepEqual(res.watermark, { column: 'updated_at', value: '2026-10-04' })
    // Soft deletes need full reads of the streamed sources only.
    const softDelete = (mode: string) =>
      definitionSchema.safeParse({ ...def, nodes: def.nodes.map((n) => (n.type === 'destination' ? { ...n, mode: 'upsert', keys: ['employee_code'], softDeleteMissing: true } : n.id === 'hris' ? { ...n, mode, watermarkColumn: 'updated_at' } : n)) }).success
    assert.equal(softDelete('full'), true, 'an incremental looked-up source does not block soft deletes')
    assert.equal(softDelete('incremental'), false)
  })

  await test('lineage, flow lines and promotion cover every source of a pipeline', () => {
    const def = threeSources()
    const g = buildLineage('dataset:people', { sources: def.nodes.flatMap((n) => (n.type === 'source' ? [{ id: n.dataSourceId, name: n.table.toUpperCase() }] : [])), pipelines: [{ id: 'p', name: 'People', definition: def, after: null }], dashboards: [], entities: [] })
    assert.deepEqual(g.nodes.filter((n) => n.kind === 'source_table').map((n) => n.label).sort(), ['contractors', 'hris', 'orgs', 'payroll'])
    const t = createTranslator('en')
    assert.deepEqual(ends(def, (id) => id.replace('ds_', '').toUpperCase(), t), { from: 'HRIS + 3 more', table: 'hris', to: 'people' })
    assert.equal(createTranslator('id')('pipelines.moreSources', { name: 'HRIS', count: 3 }), 'HRIS + 3 lainnya')
    const side = (prefix: string) => ({ dataSources: ['hris', 'pay', 'contract', 'org'].map((id) => ({ id: `${prefix}${id}`, name: id, sourceType: 'postgres' })), rules: [], pipelines: [] })
    const from = { ...side('ds_') }
    const plan = planPromotion(def, DEFAULT_SCHEDULE, from, side('stg_'), 'Staging')
    assert.deepEqual(plan.blocking, [])
    assert.deepEqual(plan.definition.nodes.flatMap((n) => (n.type === 'source' ? [n.dataSourceId] : [])), ['stg_hris', 'stg_pay', 'stg_contract', 'stg_org'])
    assert.deepEqual(plan.definition.edges.filter((e) => e.port).map((e) => e.port), ['left', 'right', 'left', 'right'], 'ports survive promotion')
    const missing = planPromotion(def, DEFAULT_SCHEDULE, from, { ...side('stg_'), dataSources: side('stg_').dataSources.slice(0, 3) }, 'Staging')
    assert.ok(missing.blocking.some((b) => /"org"/.test(b)), 'a missing looked-up source blocks the promotion')
  })
}
