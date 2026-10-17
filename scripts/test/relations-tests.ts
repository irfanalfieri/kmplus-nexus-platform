/**
 * Nested JSON (MP-7: Map paths, nested outputs, Split list) and relationship
 * mapping (MP-8: the relate transform), data source ownership and environments
 * (DS-11). Pure; run from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { definitionSchema, lookupRefs, type MapStep, type PipelineDefinition, type SplitStep } from '@/lib/pipelines/definition'
import { emptyContext, newRunTotals, outputColumns, transformChunk } from '@/lib/pipelines/engine'
import {
  collectPaths,
  flattenFields,
  flattenName,
  listCandidates,
  mapOutputColumns,
  outputPathIssues,
  readPath,
  setPath,
  splitOutputColumns,
  splitRow,
  withPaths,
} from '@/lib/pipelines/nested'
import { applyMap, applyTransform, relateKey, relateTable } from '@/lib/pipelines/transforms'
import { renderRequests } from '@/lib/pipelines/body-template'
import { localizeCheck } from '@/lib/pipelines/check-messages'
import { localizeStepTitle } from '@/components/pipelines/step-title'
import { createTranslator } from '@/lib/i18n/translate'
import { diffScans } from '@/lib/connectors/drift'
import { MAX_TAGS, copyableConfig, counterpart, counterpartHealth, matchesSourceFilter, normalizeTags, tagCounts, tagsOf, type SourceFilter } from '@/lib/connectors/ownership'
import { planPromotion } from '@/lib/pipelines/promote'
import { DEFAULT_SCHEDULE } from '@/lib/pipelines/definition'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

const at = { x: 0, y: 0 }
const def = (nodes: unknown[], edges: unknown[]) => definitionSchema.parse({ schemaVersion: 2, nodes, edges }) as PipelineDefinition
const chain = (ids: string[]) => ids.slice(1).map((to, i) => ({ id: `e${i}`, from: ids[i], to }))

/** A nested HRIS record (fictional). */
const employee = {
  nik: 'E001',
  name: { first: 'Budi', last: 'Santoso' },
  address: { city: 'Jakarta', geo: { lat: -6.2 } },
  phones: [{ type: 'mobile', number: '0812' }, { type: 'home', number: '021' }],
  tags: ['hr', 'remote'],
  employment: { assignments: [{ org: 'FIN', unit: { name: 'Treasury' } }, { org: 'HR', unit: { name: 'People' } }] },
  extra: '{"badge":"B-7","floors":[3,4]}',
  'labels.job': 'flat',
}

export async function relationsTests(test: Test) {
  await test('MP-7 readPath: object fields, list positions, every item, JSON text, literal dotted columns', () => {
    assert.equal(readPath(employee, 'nik'), 'E001')
    assert.equal(readPath(employee, 'address.city'), 'Jakarta')
    assert.equal(readPath(employee, 'address.geo.lat'), -6.2)
    assert.equal(readPath(employee, 'phones.1.number'), '021')
    assert.equal(readPath(employee, 'phones[0].type'), 'mobile')
    assert.deepEqual(readPath(employee, 'phones[].number'), ['0812', '021'])
    assert.deepEqual(readPath(employee, 'employment.assignments[].unit.name'), ['Treasury', 'People'])
    assert.equal(readPath(employee, 'extra.badge'), 'B-7', 'JSON text is read as its value')
    assert.equal(readPath(employee, 'extra.floors.1'), 4)
    assert.equal(readPath(employee, 'labels.job'), 'flat', 'a column literally named with a dot wins')
    assert.equal(readPath(employee, 'address.zip'), null)
    assert.equal(readPath(employee, 'phones.9.number'), null)
    assert.equal(readPath(employee, 'nik.x'), null, 'a path into a plain value is empty')
    assert.equal(readPath({}, 'missing'), undefined, 'a plain missing column stays undefined (as before)')
  })

  await test('MP-7 nested outputs: setPath builds objects without touching the input; clashes are reported', () => {
    const input = { address: { city: 'Bandung' } }
    const out: Record<string, unknown> = { ...input }
    setPath(out, 'address.zip', '40111')
    setPath(out, 'contact.email.work', 'b@x.id')
    assert.deepEqual(out, { address: { city: 'Bandung', zip: '40111' }, contact: { email: { work: 'b@x.id' } } })
    assert.deepEqual(input, { address: { city: 'Bandung' } }, 'the input object is copied, not changed')
    assert.deepEqual(outputPathIssues(['address', 'address.city', 'name']), ['"address" is both a value and a group (address.city).'])
    assert.deepEqual(outputPathIssues(['a.b', 'a.c', 'd']), [])
    assert.deepEqual(mapOutputColumns([{ to: 'nik', type: 'text' }, { to: 'address.city', type: 'text' }, { to: 'address.zip', type: 'integer' }]), [
      { name: 'nik', type: 'text' },
      { name: 'address', type: 'json', paths: [{ path: 'address.city', type: 'text' }, { path: 'address.zip', type: 'integer' }] },
    ])
  })

  await test('MP-7 Map step: reads paths, builds nested objects, and the definition checks output names', () => {
    const step: MapStep = {
      id: 'm', type: 'map', position: at, keepUnmapped: false,
      fields: [
        { from: 'nik', to: 'employee_code', type: 'text', transforms: [] },
        { from: 'name.first', to: 'person.first_name', type: 'text', transforms: [{ fn: 'uppercase', args: [] }] },
        { from: 'address.city', to: 'person.city', type: 'text', transforms: [] },
        { from: 'phones.0.number', to: 'mobile', type: 'text', transforms: [] },
        { from: 'tags', to: 'tags', type: 'json', transforms: [] },
      ],
    }
    const { row, errors } = applyMap(employee, step)
    assert.deepEqual(errors, [])
    assert.deepEqual(row, { employee_code: 'E001', person: { first_name: 'BUDI', city: 'Jakarta' }, mobile: '0812', tags: ['hr', 'remote'] })
    const ok = def(
      [{ id: 's', type: 'source', position: at, dataSourceId: 'd', table: 't' }, step, { id: 'd', type: 'destination', position: at, kind: 'dataset', datasetName: 'people' }],
      chain(['s', 'm', 'd'])
    )
    assert.deepEqual(outputColumns(ok, [row], {}, 'd').map((c) => `${c.name}:${c.type}`), ['employee_code:text', 'person:json', 'mobile:text', 'tags:json'])
    const clash = definitionSchema.safeParse({ schemaVersion: 2, nodes: [ok.nodes[0], { ...step, fields: [...step.fields, { from: 'nik', to: 'person', type: 'text', transforms: [] }] }, ok.nodes[2]], edges: ok.edges })
    assert.equal(clash.success, false)
    assert.match(clash.error!.issues.map((i) => i.message).join(' '), /"person" is both a value and a group/)
    const bad = definitionSchema.safeParse({ schemaVersion: 2, nodes: [ok.nodes[0], { ...step, fields: [{ from: 'nik', to: 'a..b', type: 'text', transforms: [] }] }, ok.nodes[2]], edges: ok.edges })
    assert.equal(bad.success, false)
  })

  await test('MP-7 paths found in sample rows: Flatten fields, list candidates, editor columns', () => {
    const paths = collectPaths([employee])
    const addr = paths.get('address')!.map((p) => `${p.path}:${p.type}`)
    assert.deepEqual(addr, ['address.city:text', 'address.geo.lat:numeric'])
    assert.ok(paths.get('employment')!.some((p) => p.path === 'employment.assignments' && p.type === 'json'))
    assert.ok(paths.get('employment')!.some((p) => p.path === 'employment.assignments[].unit.name'))
    assert.ok(paths.get('phones')!.some((p) => p.path === 'phones[].number'))
    assert.ok(paths.get('extra')!.some((p) => p.path === 'extra.badge'), 'JSON text columns have paths too')
    assert.equal(paths.has('nik'), false)
    const cols = withPaths([{ name: 'nik', type: 'text' }, { name: 'address', type: 'json' }, { name: 'phones', type: 'json' }, { name: 'employment', type: 'json' }], [employee])
    const flat = flattenFields(cols, new Set(['address_city']))
    assert.deepEqual(flat.map((f) => `${f.from}→${f.to}`), ['address.city→address_city_2', 'address.geo.lat→address_geo_lat', 'employment.assignments→employment_assignments'])
    assert.deepEqual(listCandidates(cols), ['address', 'phones', 'employment', 'employment.assignments'])
    assert.equal(flattenName('assignments[].unit.name'), 'assignments_unit_name')
    assert.equal(flattenName('2fa.code'), 'f_2fa_code')
  })

  await test('MP-7 Split list: one row per item, item fields as columns, position, empty lists, limits', () => {
    const spec: SplitStep = { id: 'sp', type: 'split', position: at, path: 'employment.assignments', as: '', flattenItems: true, indexColumn: 'assignment_no', onEmpty: 'keep', dropList: true, maxItems: 1000 }
    const { rows, truncated } = splitRow({ nik: 'E001', employment: employee.employment }, spec)
    assert.equal(truncated, 0)
    assert.deepEqual(rows, [
      { nik: 'E001', employment: employee.employment, assignments_org: 'FIN', assignments_unit_name: 'Treasury', assignment_no: 1 },
      { nik: 'E001', employment: employee.employment, assignments_org: 'HR', assignments_unit_name: 'People', assignment_no: 2 },
    ], 'a nested list leaves its parent column in place')
    const top = { ...spec, path: 'phones', as: 'phone', indexColumn: '' }
    assert.deepEqual(splitRow({ nik: 'E1', phones: employee.phones }, top).rows, [
      { nik: 'E1', phone_type: 'mobile', phone_number: '0812' },
      { nik: 'E1', phone_type: 'home', phone_number: '021' },
    ], 'a top-level list column is dropped')
    assert.deepEqual(splitRow({ nik: 'E1', tags: '["a","b"]' }, { ...top, path: 'tags', as: '' }).rows, [{ nik: 'E1', tags: 'a' }, { nik: 'E1', tags: 'b' }], 'JSON text lists; scalar items keep the list name')
    assert.deepEqual(splitRow({ nik: 'E2', phones: [] }, top).rows, [{ nik: 'E2' }], 'empty: kept once')
    assert.deepEqual(splitRow({ nik: 'E2', phones: null }, { ...top, onEmpty: 'drop' }).rows, [], 'empty: dropped')
    assert.deepEqual(splitRow({ nik: 'E3', phones: { type: 'x', number: '1' } }, top).rows, [{ nik: 'E3', phone_type: 'x', phone_number: '1' }], 'a single object is a list of one')
    assert.deepEqual(splitRow({ nik: 'E1', phones: employee.phones }, { ...top, flattenItems: false }).rows.map((r) => r.phone), employee.phones)
    const capped = splitRow({ phones: [1, 2, 3] }, { ...top, maxItems: 2 })
    assert.equal(capped.rows.length, 2)
    assert.equal(capped.truncated, 1)
    const cols = withPaths([{ name: 'nik', type: 'text' }, { name: 'phones', type: 'json' }], [employee])
    assert.deepEqual(splitOutputColumns(cols, top).map((c) => c.name), ['nik', 'phone_type', 'phone_number'])
    assert.deepEqual(splitOutputColumns(cols, { ...top, flattenItems: false, indexColumn: 'n' }).map((c) => `${c.name}:${c.type}`), ['nik:text', 'phone:json', 'n:integer'])
  })

  await test('MP-7 Split list in a run: rows multiply, the cap flags the row, the title localizes', async () => {
    const p = def(
      [
        { id: 's', type: 'source', position: at, dataSourceId: 'd', table: 'employees' },
        { id: 'sp', type: 'split', position: at, path: 'phones', as: 'phone', maxItems: 1 },
        { id: 'd', type: 'destination', position: at, kind: 'dataset', datasetName: 'phones' },
      ],
      chain(['s', 'sp', 'd'])
    )
    const totals = newRunTotals(p)
    const out = await transformChunk(p, [{ nik: 'E1', phones: employee.phones }, { nik: 'E2', phones: [] }], totals, emptyContext())
    assert.deepEqual(out.byDestination.get('d'), [{ nik: 'E1', phone_type: 'mobile', phone_number: '0812' }, { nik: 'E2' }])
    assert.equal(out.flags.length, 1)
    assert.equal(out.flags[0].errors[0], 'The list phones has 2 items; only the first 1 were kept')
    assert.notEqual(localizeCheck(out.flags[0].errors[0], 'id'), out.flags[0].errors[0])
    assert.deepEqual(outputColumns(p, out.byDestination.get('d')!, {}, 'd').map((c) => c.name), ['nik', 'phone_type', 'phone_number'], 'a Split after no Map infers its columns')
    const t = createTranslator('id')
    assert.equal(localizeStepTitle('Split list phones', t), 'Pecah daftar phones')
  })

  await test('MP-7 bodies and defined schemas read paths from nested rows', () => {
    const res = renderRequests(
      { path: '/people', batchSize: 100, body: { format: 'json', sample: '', template: { t: 'object', fields: [{ key: 'city', node: { t: 'value', type: 'auto', binding: { kind: 'column', column: 'address.city' }, required: false, empty: 'null' } }] } } },
      [employee],
      { runId: 'r', chunk: 0 }
    )
    assert.equal(res.requests[0].body, '{"city":"Jakarta"}')
  })

  await test('MP-7 drift: a REST column now reported as JSON (was TEXT) is not a breaking change', () => {
    const prev = { scannedAt: '', method: 'rest', tables: [{ schema: 'api', name: 'people', rowCount: 1, columns: [{ name: 'address', type: 'TEXT', nullable: true }] }] }
    const next = { scannedAt: '', method: 'rest', tables: [{ schema: 'api', name: 'people', rowCount: 1, columns: [{ name: 'address', type: 'JSON', nullable: true }] }] }
    assert.deepEqual(diffScans(prev, next), [])
    assert.equal(diffScans(next, prev).length, 1, 'JSON → TEXT still counts')
  })

  await test('MP-8 relate: references resolve through a dataset; normalization; missing → quarantine / flag / empty / keep', () => {
    assert.equal(relateKey(' e001 ', 'loose'), 'e001')
    assert.equal(relateKey('000123', 'loose_zeros'), '123')
    assert.equal(relateKey('E001', 'exact'), 'E001')
    assert.equal(relateKey('  ', 'loose'), null)
    const pairs = new Map<string, unknown>([['E001', 'u-1'], ['00042', 'u-42'], ['e001', 'u-dup']])
    const loose = relateTable(pairs, 'loose')
    assert.equal(loose.get('e001'), 'u-1', 'the first record wins when two normalize alike')
    const tables = new Map([
      ['employees|nik|id|loose', loose],
      ['employees|nik|id|loose_zeros', relateTable(pairs, 'loose_zeros')],
    ])
    const relate = (v: unknown, missing = 'quarantine', match = 'loose', notes?: string[]) => applyTransform(v, { fn: 'relate', args: ['employees', 'nik', 'id', missing, match] }, {}, tables, notes)
    assert.equal(relate('e001'), 'u-1')
    assert.equal(relate('42', 'quarantine', 'loose_zeros'), 'u-42')
    assert.equal(relate(''), null, 'no reference is not a missing one')
    assert.throws(() => relate('E999'), /"E999" has no match in employees\.nik/)
    const notes: string[] = []
    assert.equal(relate('E999', 'flag', 'loose', notes), null)
    assert.deepEqual(notes, ['"E999" has no match in employees.nik'])
    assert.equal(relate('E999', 'empty'), null)
    assert.equal(relate('E999', 'keep'), 'E999')
    assert.throws(() => applyTransform('x', { fn: 'relate', args: ['other', 'a', 'b'] }, {}, tables), /not loaded/)
    assert.notEqual(localizeCheck('manager_id: "E999" has no match in employees.nik', 'id'), 'manager_id: "E999" has no match in employees.nik')
  })

  await test('MP-8 relate in a Map step and a run: quarantined or flagged rows; lookupRefs loads one table per match', async () => {
    const map = (missing: string): MapStep => ({
      id: 'm', type: 'map', position: at, keepUnmapped: false,
      fields: [
        { from: 'NIK', to: 'employee_code', type: 'text', transforms: [] },
        { from: 'MANAGER_NIK', to: 'manager_id', type: 'text', transforms: [{ fn: 'relate', args: ['employees', 'nik', 'id', missing, 'loose'] }] },
      ],
    })
    const p = (missing: string) => def(
      [{ id: 's', type: 'source', position: at, dataSourceId: 'd', table: 'hris' }, map(missing), { id: 'd', type: 'destination', position: at, kind: 'dataset', datasetName: 'people' }],
      chain(['s', 'm', 'd'])
    )
    assert.deepEqual(lookupRefs(p('flag')), [{ key: 'employees|nik|id|loose', dataset: 'employees', keyColumn: 'nik', valueColumn: 'id', match: 'loose' }])
    const ctx = { ...emptyContext(), lookupTables: new Map([['employees|nik|id|loose', new Map<string, unknown>([['e001', 'u-1']])]]) }
    const rows = [{ NIK: 'E002', MANAGER_NIK: 'E001' }, { NIK: 'E003', MANAGER_NIK: 'E404' }, { NIK: 'E001', MANAGER_NIK: null }]
    const q = await transformChunk(p('quarantine'), rows, newRunTotals(p('quarantine')), ctx)
    assert.deepEqual(q.byDestination.get('d'), [{ employee_code: 'E002', manager_id: 'u-1' }, { employee_code: 'E001', manager_id: null }])
    assert.equal(q.rejects.length, 1)
    assert.deepEqual(q.rejects[0].errors, ['manager_id: "E404" has no match in employees.nik'])
    const totals = newRunTotals(p('flag'))
    const f = await transformChunk(p('flag'), rows, totals, ctx)
    assert.equal(f.byDestination.get('d')!.length, 3)
    assert.equal(f.flags.length, 1)
    assert.equal(f.flags[0].severity, 'warning')
    assert.equal(totals.flaggedCount, 1)
    assert.equal(totals.rejectedCount, 0)
  })
}

/** DS-11: data source ownership, tags and their counterparts in other environments. */
export async function ownershipTests(test: Test) {
  await test('DS-11 tags: normalized, de-duplicated, capped; filters by tag, owner and text', () => {
    assert.deepEqual(normalizeTags(' HR, Payroll Data ,hr,, PII!, sap.hcm '), ['hr', 'payroll-data', 'pii', 'sap.hcm'])
    assert.deepEqual(normalizeTags(['Gaji', 'gaji', '--x--']), ['gaji', 'x'])
    assert.equal(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`)).length, MAX_TAGS)
    assert.equal(normalizeTags('x'.repeat(50))[0].length, 30)
    assert.deepEqual(tagsOf(['HR', 3, null, 'hr']), ['hr'])
    assert.deepEqual(tagsOf(null), [])
    const sources = [
      { name: 'SAP HCM', sourceType: 'sap', tags: ['hr', 'pii'], ownerId: 'u1' },
      { name: 'Payroll DB', sourceType: 'postgres', tags: ['payroll', 'pii'], ownerId: null },
      { name: 'Talenta', sourceType: 'talenta', tags: [], ownerId: 'u2' },
    ]
    const pick = (f: Partial<SourceFilter>) => sources.filter((s) => matchesSourceFilter(s, { tag: '', owner: '', text: '', ...f })).map((s) => s.name)
    assert.deepEqual(pick({ tag: 'pii' }), ['SAP HCM', 'Payroll DB'])
    assert.deepEqual(pick({ owner: 'u2' }), ['Talenta'])
    assert.deepEqual(pick({ owner: 'none' }), ['Payroll DB'])
    assert.deepEqual(pick({ text: 'postgres' }), ['Payroll DB'])
    assert.deepEqual(pick({ text: 'payr', tag: 'pii' }), ['Payroll DB'])
    assert.deepEqual(tagCounts(sources), [{ tag: 'pii', count: 2 }, { tag: 'hr', count: 1 }, { tag: 'payroll', count: 1 }])
  })

  await test('DS-11 environments: counterparts match promotion (name, any case, and connector); copies keep no credentials', () => {
    const there = [
      { id: 'p1', name: 'sap hcm', sourceType: 'sap', status: 'connected', lastConnected: null, healthFailures: 0, ownerId: null },
      { id: 'p2', name: 'Payroll DB', sourceType: 'mysql', status: 'connected', lastConnected: null, healthFailures: 2, ownerId: null },
    ]
    assert.deepEqual(counterpart({ name: 'SAP HCM', sourceType: 'sap' }, there), { state: 'present', source: there[0] })
    assert.equal(counterpart({ name: 'Payroll DB', sourceType: 'postgres' }, there).state, 'conflict')
    assert.equal(counterpart({ name: 'Talenta', sourceType: 'talenta' }, there).state, 'missing')
    assert.equal(counterpartHealth(there[0]), 'live')
    assert.equal(counterpartHealth(there[1]), 'failing')
    assert.equal(counterpartHealth({ status: 'disconnected', healthFailures: 0 }), 'idle')
    // The same rule as promotion: what "present" finds is what planPromotion maps to.
    const plan = planPromotion(
      def([{ id: 's', type: 'source', position: at, dataSourceId: 'd1', table: 't' }, { id: 'd', type: 'destination', position: at, kind: 'dataset', datasetName: 'x' }], chain(['s', 'd'])),
      DEFAULT_SCHEDULE,
      { dataSources: [{ id: 'd1', name: 'SAP HCM', sourceType: 'sap' }], rules: [], pipelines: [] },
      { dataSources: there.map((x) => ({ id: x.id, name: x.name, sourceType: x.sourceType })), rules: [], pipelines: [] },
      'Production'
    )
    assert.equal((plan.definition.nodes[0] as { dataSourceId: string }).dataSourceId, 'p1')
    assert.deepEqual(copyableConfig({ role: 'destination', maxCallsPerRun: 9, agent: { agentId: 'a' }, schemaScan: { tables: [] }, files: [] }), { role: 'destination', maxCallsPerRun: 9 })
    assert.deepEqual(copyableConfig(null), { role: 'source' })
  })
}
