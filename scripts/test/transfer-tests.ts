/**
 * Pipeline export / import (VC-5) and promotion of API steps. Pure; run from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { definitionSchema, type PipelineDefinition } from '@/lib/pipelines/definition'
import { planPromotion, type PromotionSide } from '@/lib/pipelines/promote'
import { PIPELINE_EXPORT_FORMAT, PIPELINE_EXPORT_VERSION, exportFileName, parseExport, planImport, referencedIds, type PipelineExport } from '@/lib/pipelines/transfer'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

const at = { x: 0, y: 0 }
const rule = { when: { match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'Active' }] }, then: [], otherwise: [] }
const definition = definitionSchema.parse({
  schemaVersion: 2,
  nodes: [
    { id: 's', type: 'source', position: at, dataSourceId: 'src_hr', table: 'employees' },
    { id: 'f', type: 'filter', position: at, ruleId: 'rule_active' },
    { id: 'e', type: 'enrich', position: at, dataSourceId: 'src_api', path: '/people/{{id}}', answer: { fields: [{ path: 'grade', as: 'grade', type: 'text' }] } },
    { id: 'd', type: 'destination', position: at, kind: 'dataset', datasetName: 'people', mode: 'replace' },
  ],
  edges: [
    { id: 'e1', from: 's', to: 'f' },
    { id: 'e2', from: 'f', to: 'e' },
    { id: 'e3', from: 'e', to: 'd' },
  ],
}) as PipelineDefinition

const file = (over: Partial<PipelineExport> = {}): PipelineExport => ({
  format: PIPELINE_EXPORT_FORMAT,
  formatVersion: PIPELINE_EXPORT_VERSION,
  exportedAt: '2026-10-17T00:00:00.000Z',
  exportedVersion: 3,
  pipeline: { name: 'HR → people', description: '', definition, schedule: { type: 'after', afterPipelineId: 'pipe_orgs' } },
  references: {
    dataSources: [{ id: 'src_hr', name: 'HRIS', sourceType: 'postgres' }, { id: 'src_api', name: 'People API', sourceType: 'rest' }],
    rules: [{ id: 'rule_active', name: 'Active only', body: rule as never }],
    pipelines: [{ id: 'pipe_orgs', name: 'Orgs' }],
  },
  schemas: [],
  ...over,
})

const target = (over: Partial<PromotionSide> = {}): PromotionSide => ({
  dataSources: [{ id: 'my_hr', name: 'hris', sourceType: 'postgres' }, { id: 'my_api', name: 'Directory API', sourceType: 'rest' }],
  rules: [],
  pipelines: [],
  ...over,
})

export async function transferTests(test: Test) {
  await test('export: references are the data sources, rules and "run after" pipeline a definition names; file names are safe', () => {
    const refs = referencedIds(definition, { type: 'after', afterPipelineId: 'pipe_orgs' } as never)
    assert.deepEqual(refs, { dataSources: ['src_hr', 'src_api'], rules: ['rule_active'], pipelines: ['pipe_orgs'] })
    assert.equal(exportFileName('HR → People (v2)'), 'hr-people-v2.nexus-pipeline.json')
    assert.deepEqual(parseExport('not json'), { ok: false, error: 'The file is not JSON.' })
    assert.deepEqual(parseExport('{"format":"other"}'), { ok: false, error: 'This is not a Nexus pipeline export.' })
    assert.deepEqual(parseExport(JSON.stringify({ ...file(), formatVersion: 2 })), { ok: false, error: 'This export was made by a newer version of Nexus.' })
    const round = parseExport(JSON.stringify(file()))
    assert.ok(round.ok && round.file.references.rules[0].name === 'Active only')
  })

  await test('import: data sources match by name and type or as chosen; missing rules are created; a missing "run after" pipeline makes the schedule manual', () => {
    // HRIS matches by name (case-insensitive); the API has no same-named source: blocked until one is chosen.
    let plan = planImport(file(), definition, target())
    assert.deepEqual(plan.sources.map((s) => [s.name, s.targetId, s.byName]), [['HRIS', 'my_hr', true], ['People API', null, false]])
    assert.ok(plan.blocking.some((b) => b.includes('People API') && b.includes('choose one of the same type')))
    plan = planImport(file(), definition, target(), { src_api: 'my_api' })
    assert.deepEqual(plan.blocking, [])
    const nodes = plan.definition.nodes as { id: string; dataSourceId?: string; ruleId?: string }[]
    assert.equal(nodes.find((n) => n.id === 's')!.dataSourceId, 'my_hr')
    assert.equal(nodes.find((n) => n.id === 'e')!.dataSourceId, 'my_api', 'API steps are mapped too')
    assert.equal(nodes.find((n) => n.id === 'f')!.ruleId, 'promote:rule_active')
    assert.deepEqual(plan.rules.map((r) => [r.name, r.targetId]), [['Active only', null]])
    assert.equal(plan.schedule.type, 'manual')
    assert.equal(plan.warnings.length, 1)
    // With the rule and the pipeline present here: reused, and the chain kept.
    const here = target({ rules: [{ id: 'my_rule', name: 'active only', body: rule as never }], pipelines: [{ id: 'my_orgs', name: 'Orgs', promotionKey: null }] })
    plan = planImport(file(), definition, here, { src_api: 'my_api' })
    assert.equal((plan.definition.nodes.find((n) => n.id === 'f') as { ruleId: string }).ruleId, 'my_rule')
    assert.deepEqual(plan.rules, [])
    assert.deepEqual([plan.schedule.type, (plan.schedule as { afterPipelineId: string }).afterPipelineId], ['after', 'my_orgs'])
    assert.deepEqual(plan.warnings, [])
  })

  await test('promotion: Enrich and "Change data" steps point at the next environment’s data source', () => {
    const from: PromotionSide = { dataSources: [{ id: 'src_hr', name: 'HRIS', sourceType: 'postgres' }, { id: 'src_api', name: 'People API', sourceType: 'rest' }], rules: [{ id: 'rule_active', name: 'Active only', body: rule as never }], pipelines: [] }
    const to: PromotionSide = { dataSources: [{ id: 'prod_hr', name: 'HRIS', sourceType: 'postgres' }, { id: 'prod_api', name: 'People API', sourceType: 'rest' }], rules: [], pipelines: [] }
    const plan = planPromotion(definition, { type: 'manual' } as never, from, to, 'Production')
    assert.deepEqual(plan.blocking, [])
    assert.equal((plan.definition.nodes.find((n) => n.id === 'e') as { dataSourceId: string }).dataSourceId, 'prod_api')
  })
}
