/**
 * Defined dataset schemas (lanes, phase D): building, changing, mapping
 * pipelines onto a schema, renames carried everywhere, promotion. Pure; run
 * from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { definitionSchema, type DestinationStep, type PipelineDefinition } from '@/lib/pipelines/definition'
import {
  applySchemaOps,
  autoMapSchema,
  columnOwners,
  conformRows,
  datasetSchemaSpec,
  exposedColumns,
  followRenames,
  isDestructiveOp,
  mappingIssues,
  renameInDefinition,
  renameInPolicy,
  renameInWidgets,
  resolveMapping,
  safeName,
  schemaDiff,
  schemaFromColumns,
  schemaFromEntity,
  schemaFromExample,
  schemaPromotion,
  unsafeNames,
  type DatasetSchema,
} from '@/lib/datasets/schema'
import { DOMAIN_BY_NAME } from '@/lib/domain/model'
import { localizeCheck } from '@/lib/pipelines/check-messages'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>
type DatasetDest = Extract<DestinationStep, { kind: 'dataset' }>

const profile: DatasetSchema = datasetSchemaSpec.parse({
  columns: [
    { name: 'employee_code', type: 'text', required: true },
    { name: 'full_name', type: 'text', required: true, classification: 'personal' },
    { name: 'hire_date', type: 'date' },
    { name: 'grade', type: 'integer' },
    { name: 'status', type: 'text', default: 'Active' },
    { name: 'training_hours', type: 'numeric' },
  ],
  keys: ['employee_code'],
})
const dest = (patch: Partial<DatasetDest> = {}): DatasetDest => ({ id: 'dst', type: 'destination', position: { x: 0, y: 0 }, kind: 'dataset', datasetName: 'employee_profile', mode: 'upsert', keys: [], softDeleteMissing: false, ...patch })

export async function schemaTests(test: Test) {
  await test('schemas: from current columns (unsafe names renamed), an entity, a JSON or CSV example', () => {
    const s = schemaFromColumns([{ name: 'NIK', type: 'text' }, { name: 'Full Name', type: 'text' }, { name: 'joined', type: 'date' }, { name: '_nexus_id', type: 'integer' }, { name: 'odd', type: 'weird' }], ['NIK'])
    assert.deepEqual(s.columns.map((c) => [c.name, c.type, c.required]), [['nik', 'text', true], ['full_name', 'text', false], ['joined', 'date', false], ['odd', 'text', false]])
    assert.deepEqual(s.keys, ['nik'])
    assert.equal(s.columns.find((c) => c.name === 'full_name')!.classification, 'personal')
    assert.deepEqual(unsafeNames([{ name: 'NIK' }, { name: 'full_name' }, { name: 'Full Name' }, { name: '_nexus_id' }]), [{ from: 'NIK', to: 'nik' }, { from: 'Full Name', to: 'full_name' }])
    assert.deepEqual(['2nd shift', 'Gaji (IDR)', '__x__', '!!'].map(safeName), ['c_2nd_shift', 'gaji_idr', 'x', ''])

    const e = schemaFromEntity(DOMAIN_BY_NAME.get('employee')!)
    assert.deepEqual(e.keys, ['employee_code'])
    assert.equal(e.columns.find((c) => c.name === 'employee_code')!.required, true)
    assert.equal(e.columns.find((c) => c.name === 'national_id')!.classification, 'personal')

    const j = schemaFromExample('[{"Employee Code": "E1", "grade": 7, "active": true, "hired": "2024-01-15"}]')
    // Types as a run would infer them from JSON values (dates arrive as text).
    assert.deepEqual(j.columns.map((c) => [c.name, c.type]), [['employee_code', 'text'], ['grade', 'numeric'], ['active', 'boolean'], ['hired', 'text']])
    assert.deepEqual(schemaFromExample('NIK;Nama;Tgl Masuk\n1;a;b').columns.map((c) => c.name), ['nik', 'nama', 'tgl_masuk'])
    assert.throws(() => schemaFromExample('[]'), /no fields/)

    assert.equal(datasetSchemaSpec.safeParse({ columns: [{ name: 'a' }, { name: 'a' }] }).success, false)
    assert.equal(datasetSchemaSpec.safeParse({ columns: [{ name: '_nexus_x' }] }).success, false)
    assert.equal(datasetSchemaSpec.safeParse({ columns: [{ name: 'a' }], keys: ['b'] }).success, false)
  })

  await test('schema changes: add, rename (keys follow), type, require, keys, review; destructive ones and errors', () => {
    const r = applySchemaOps(profile, [
      { kind: 'rename', from: 'employee_code', to: 'emp_id' },
      { kind: 'add', column: { name: 'cost_center', type: 'text', required: false, description: '', classification: 'internal', default: null, autoAdded: true, reviewed: false } },
      { kind: 'type', name: 'grade', type: 'text' },
      { kind: 'require', name: 'hire_date', required: true },
      { kind: 'keys', keys: ['emp_id', 'hire_date'] },
    ])
    assert.ok('schema' in r)
    const s = (r as { schema: DatasetSchema }).schema
    assert.deepEqual(s.keys, ['emp_id', 'hire_date'])
    assert.equal(s.columns.find((c) => c.name === 'grade')!.type, 'text')
    assert.ok(s.columns.find((c) => c.name === 'hire_date')!.required)
    // An auto-added column stays out of the Data API until a steward reviews it.
    assert.ok(!exposedColumns(s).some((c) => c.name === 'cost_center'))
    const reviewed = applySchemaOps(s, [{ kind: 'review', name: 'cost_center' }]) as { schema: DatasetSchema }
    assert.ok(exposedColumns(reviewed.schema).some((c) => c.name === 'cost_center'))

    assert.deepEqual(applySchemaOps(profile, [{ kind: 'remove', name: 'employee_code' }]), { error: '"employee_code" is a key column. Change the keys first.' })
    assert.deepEqual(applySchemaOps(profile, [{ kind: 'rename', from: 'grade', to: 'status' }]), { error: 'The column "status" already exists.' })
    assert.deepEqual(applySchemaOps(profile, [{ kind: 'type', name: 'nope', type: 'text' }]), { error: 'The schema has no column "nope".' })
    assert.ok(isDestructiveOp({ kind: 'rename', from: 'a', to: 'b' }) && isDestructiveOp({ kind: 'remove', name: 'a' }) && !isDestructiveOp({ kind: 'require', name: 'a', required: true }))
  })

  await test('target-first mapping: by name (incl. "NIK" → nik), auto-match synonyms, issues, extras', () => {
    const input = [{ name: 'EMPLOYEE_CODE', type: 'text' }, { name: 'nama', type: 'text' }, { name: 'tglmasuk', type: 'date' }, { name: 'grade', type: 'date' }, { name: 'shoe_size', type: 'integer' }]
    // Matched by name: only names equal to a schema column (or normalized to one).
    const byName = resolveMapping(profile, dest(), input.map((c) => c.name))
    assert.ok(byName.byName)
    assert.deepEqual(byName.map.map((m) => m.target), ['employee_code', 'grade'])
    // Auto-match also uses the HR synonyms.
    const auto = autoMapSchema(profile, input.map((c) => c.name))
    assert.deepEqual(auto.map((m) => [m.target, m.binding.kind === 'column' ? m.binding.column : '']), [['employee_code', 'EMPLOYEE_CODE'], ['full_name', 'nama'], ['hire_date', 'tglmasuk'], ['grade', 'grade']])
    const issues = mappingIssues(profile, dest({ columnMap: auto }), input)
    assert.deepEqual(issues.unmappedRequired, [])
    assert.deepEqual(issues.impossible, [{ target: 'grade', from: 'date', to: 'integer' }])
    assert.deepEqual(issues.extras, ['shoe_size'])
    // A partial mapping writes only its columns; a required one left out is reported.
    const partial = mappingIssues(profile, dest({ columnMap: [{ target: 'employee_code', binding: { kind: 'column', column: 'EMPLOYEE_CODE' } }, { target: 'full_name', binding: { kind: 'none' } }] }), input)
    assert.deepEqual(partial.unmappedRequired, ['full_name'])
    assert.deepEqual(partial.mapped, ['employee_code'])
    // The definition accepts the mapping and dropExtra.
    const parsed = definitionSchema.safeParse({ schemaVersion: 2, nodes: [{ id: 'src', type: 'source', position: { x: 0, y: 0 }, dataSourceId: 'ds', table: 't' }, dest({ columnMap: auto, dropExtra: true, keys: ['employee_code'] })], edges: [{ id: 'e', from: 'src', to: 'dst' }] })
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues[0]))
  })

  await test('conform: bindings, defaults, types; a missing required value or a bad value holds the row', () => {
    const map = [
      { target: 'employee_code', binding: { kind: 'column' as const, column: 'code' } },
      { target: 'full_name', binding: { kind: 'column' as const, column: 'name' } },
      { target: 'grade', binding: { kind: 'column' as const, column: 'grade' } },
      { target: 'status', binding: { kind: 'column' as const, column: 'status' } },
      { target: 'training_hours', binding: { kind: 'constant' as const, value: '12.5' } },
    ]
    const res = conformRows(profile, map, [
      { code: 'E1', name: 'Ani', grade: '7', status: '', other: 'x' },
      { code: 'E2', name: '', grade: '3', status: 'Inactive' },
      { code: 'E3', name: 'Budi', grade: 'seven', status: null },
    ])
    assert.deepEqual(res.rows, [{ employee_code: 'E1', full_name: 'Ani', grade: 7, status: 'Active', training_hours: 12.5 }])
    assert.deepEqual(res.rejects.map((r) => r.index), [1, 2])
    assert.deepEqual(res.rejects[0].errors, ['full_name is required by the dataset schema'])
    assert.equal(localizeCheck(res.rejects[0].errors[0], 'id'), 'full_name wajib diisi menurut skema dataset')
    assert.match(res.rejects[1].errors[0], /^grade: /)
  })

  await test('ownership: which pipeline fills which column; renames reach pipelines, dashboards and policies', () => {
    const def = (columnMap?: DatasetDest['columnMap']): PipelineDefinition =>
      ({
        schemaVersion: 2,
        nodes: [
          dest({ columnMap, keys: ['employee_code'] }),
          { id: 'map', type: 'map', position: { x: 0, y: 0 }, fields: [{ from: 'x', to: 'org', transforms: [{ fn: 'lookup', args: ['employee_profile', 'employee_code', 'grade'] }] }] },
          { id: 'val', type: 'validate', position: { x: 0, y: 0 }, rules: [{ field: 'code', rule: 'exists_in', value: 'employee_profile.employee_code' }] },
        ],
        edges: [],
        settings: {},
      }) as unknown as PipelineDefinition
    const hr = def([{ target: 'employee_code', binding: { kind: 'column', column: 'id' } }, { target: 'full_name', binding: { kind: 'column', column: 'n' } }])
    const lms = def([{ target: 'employee_code', binding: { kind: 'column', column: 'id' } }, { target: 'training_hours', binding: { kind: 'column', column: 'h' } }, { target: 'grade', binding: { kind: 'none' } }])
    const owners = columnOwners('employee_profile', [{ id: 'p1', name: 'HRIS', definition: hr }, { id: 'p2', name: 'LMS', definition: lms }, { id: 'p3', name: 'Old', definition: def() }])
    assert.deepEqual(owners.byColumn, { employee_code: ['HRIS', 'LMS'], full_name: ['HRIS'], training_hours: ['LMS'] })
    assert.deepEqual(owners.byName, ['Old'])

    const renamed = renameInDefinition(hr, 'employee_profile', 'employee_code', 'emp_id')
    assert.ok(renamed.changed)
    const nodes = renamed.definition.nodes
    const d = nodes.find((n) => n.id === 'dst') as DatasetDest
    assert.deepEqual(d.columnMap!.map((m) => m.target), ['emp_id', 'full_name'])
    assert.deepEqual(d.keys, ['emp_id'])
    assert.deepEqual((nodes.find((n) => n.id === 'map') as { fields: { transforms: { args: string[] }[] }[] }).fields[0].transforms[0].args, ['employee_profile', 'emp_id', 'grade'])
    assert.equal((nodes.find((n) => n.id === 'val') as { rules: { value: string }[] }).rules[0].value, 'employee_profile.emp_id')
    assert.equal(renameInDefinition(hr, 'other', 'employee_code', 'x').changed, false)

    const w = renameInWidgets([{ dataset: 'employee_profile', measure: { column: 'employee_code' }, dimension: { column: 'grade' }, filters: [{ column: 'employee_code' }] }], 'employee_profile', 'employee_code', 'emp_id')
    assert.deepEqual(w.widgets[0], { dataset: 'employee_profile', measure: { column: 'emp_id' }, dimension: { column: 'grade' }, filters: [{ column: 'emp_id' }] })
    // A published pipeline follows a rename until it is republished: mapping targets, keys, and names matched by name.
    const alias = [{ oldName: 'employee_code', newName: 'emp_id' }]
    const mapped = followRenames(dest({ keys: ['employee_code'], columnMap: [{ target: 'employee_code', binding: { kind: 'column', column: 'id' } }] }), [{ id: 'E1' }], alias)
    assert.deepEqual([mapped.dest.keys, mapped.dest.columnMap![0].target, mapped.rows], [['emp_id'], 'emp_id', [{ id: 'E1' }]])
    assert.deepEqual(followRenames(dest({ keys: [] }), [{ employee_code: 'E1', x: 1 }, { emp_id: 'E2', employee_code: 'old' }], alias).rows, [{ emp_id: 'E1', x: 1 }, { emp_id: 'E2', employee_code: 'old' }])
    // A masked column stays masked under its new name.
    const p = renameInPolicy({ full_name: { mask: 'partial' } }, [{ column: 'full_name', op: 'equals' }], 'full_name', 'name')
    assert.deepEqual(p, { columns: { name: { mask: 'partial' } }, rowFilters: [{ column: 'name', op: 'equals' }] })
  })

  await test('promotion: a new schema is created, additive changes become operations, others block', () => {
    assert.equal(schemaPromotion(profile, null).status, 'create')
    assert.deepEqual(schemaPromotion(profile, profile), { status: 'same', lines: [], ops: [] })
    const older = datasetSchemaSpec.parse({ columns: profile.columns.filter((c) => c.name !== 'training_hours').map((c) => (c.name === 'hire_date' ? { ...c, description: 'old' } : c)), keys: ['employee_code'] })
    const up = schemaPromotion(profile, older)
    assert.equal(up.status, 'update')
    assert.deepEqual(up.ops.map((o) => o.kind), ['describe', 'add'])
    assert.deepEqual((applySchemaOps(older, up.ops) as { schema: DatasetSchema }).schema, profile)
    const retyped = datasetSchemaSpec.parse({ ...profile, columns: profile.columns.map((c) => (c.name === 'grade' ? { ...c, type: 'text' } : c)) })
    assert.equal(schemaPromotion(profile, retyped).status, 'blocked')
    assert.ok(schemaDiff(profile, retyped).lines.includes('grade: text → integer'))
    const extra = datasetSchemaSpec.parse({ ...profile, columns: [...profile.columns, { name: 'legacy' }] })
    assert.equal(schemaPromotion(profile, extra).status, 'blocked')
  })
}
