/**
 * API calls inside a lane (lanes phase C): Enrich and "Changes data". Pure;
 * run from scripts/engine-tests.ts. The engine gets a fake `ctx.api`.
 */
import assert from 'node:assert/strict'
import { definitionSchema, type ApiCallStep, type EnrichStep } from '@/lib/pipelines/definition'
import { runEngine, type EngineContext } from '@/lib/pipelines/engine'
import { answerItems, answerTree, answerValue, applyEnrich, contentHash, decideCall, enrichChunkRows, getPath, idempotencyKey, ledgerKey, mapAnswer, mappingFingerprint, matchBatchAnswer, planEnrich, renderApiCall } from '@/lib/pipelines/api-calls'
import { destructiveWrites } from '@/lib/pipelines/approvals'
import { localizeCheck } from '@/lib/pipelines/check-messages'
import { localizeStepTitle } from '@/components/pipelines/step-title'
import { createTranslator } from '@/lib/i18n/translate'
import { payloadSchemas, MIN_AGENT_VERSION_FOR_OP } from '@/lib/agent/protocol'
import type { Row } from '@/lib/pipelines/transforms'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

const rows: Row[] = [
  { code: 'E1', name: 'Amira', email: 'amira@x.test' },
  { code: ' e2 ', name: 'Daniel', email: 'daniel@x.test' },
  { code: 'E3', name: 'Sofia', email: 'sofia@x.test' },
  { code: 'E1', name: 'Amira again', email: 'amira@x.test' },
  { code: '', name: 'No code', email: 'none@x.test' },
]
const field = (path: string, as: string, type = 'text') => ({ path, as, type })
const graph = (step: object) =>
  definitionSchema.parse({
    nodes: [{ id: 's', type: 'source', dataSourceId: 'x', table: 'hris' }, step, { id: 'd', type: 'destination', kind: 'dataset', datasetName: 'out', mode: 'append' }],
    edges: [{ id: '1', from: 's', to: (step as { id: string }).id }, { id: '2', from: (step as { id: string }).id, to: 'd' }],
  })
const enrichStep = (extra: object = {}) => graph({ id: 'en', type: 'enrich', dataSourceId: 'api', path: '/employees/{{code}}/details', answer: { fields: [field('data.grade', 'grade'), field('data.allowance', 'allowance', 'numeric')] }, ...extra }).nodes.find((n): n is EnrichStep => n.id === 'en')!
const callStep = (extra: object = {}) =>
  graph({
    id: 'ac', type: 'apicall', dataSourceId: 'api', keys: ['email'],
    create: { method: 'POST', path: '/users', body: { template: { t: 'object', fields: [{ key: 'email', node: { t: 'value', binding: { kind: 'column', column: 'email' } } }, { key: 'name', node: { t: 'value', binding: { kind: 'column', column: 'name' } } }] } } },
    answer: { fields: [field('user.id', 'user_id')] },
    ...extra,
  }).nodes.find((n): n is ApiCallStep => n.id === 'ac')!

export async function apiCallTests(test: Test) {
  await test('API answers: paths, types, lists as rows / first / JSON, and the picker tree', () => {
    const answer = { data: { grade: 'G7', allowance: '1500000.50', tags: ['a', 'b'] }, items: [{ id: 1, kind: 'x' }, { id: 2, kind: 'y' }] }
    assert.equal(getPath(answer, 'data.grade'), 'G7')
    assert.equal(getPath(answer, 'items.1.kind'), 'y')
    assert.equal(getPath(answer, 'nope.deeper'), undefined)
    assert.equal(answerValue('1500000.50', 'numeric'), 1500000.5)
    assert.equal(answerValue('12.9', 'integer'), 12)
    assert.equal(answerValue({ a: 1 }, 'text'), '{"a":1}')
    assert.equal(answerValue('', 'text'), null)
    assert.equal(answerValue('yes', 'boolean'), true)
    const fields = [field('id', 'item_id', 'integer'), field('kind', 'kind')]
    assert.deepEqual(mapAnswer(answer, { listPath: 'items', listMode: 'rows', fields: fields as never, sample: '' }), [{ item_id: 1, kind: 'x' }, { item_id: 2, kind: 'y' }])
    assert.deepEqual(mapAnswer(answer, { listPath: 'items', listMode: 'first', fields: fields as never, sample: '' }), [{ item_id: 1, kind: 'x' }])
    assert.deepEqual(mapAnswer(answer, { listPath: 'items', listMode: 'json', fields: fields as never, sample: '' }), [{ item_id: [1, 2], kind: ['x', 'y'] }])
    assert.deepEqual(mapAnswer(answer, { listPath: '', listMode: 'rows', fields: [field('data.grade', 'grade')] as never, sample: '' }), [{ grade: 'G7' }])
    assert.deepEqual(answerItems([{ a: 1 }, { a: 2 }], { listPath: '' }), [{ a: 1 }, { a: 2 }], 'a top-level list is the items')
    assert.deepEqual(mapAnswer({ items: [] }, { listPath: 'items', listMode: 'rows', fields: fields as never, sample: '' }), [], 'an empty list is no answer')
    const tree = answerTree(JSON.stringify(answer))!
    assert.deepEqual(tree.lists, ['data.tags', 'items'])
    assert.deepEqual(tree.leaves('').map((l) => l.path), ['data.grade', 'data.allowance', 'data.tags', 'items'], 'lists can be taken whole, as JSON')
    assert.deepEqual(tree.leaves('items').map((l) => `${l.path}=${l.example}`), ['id=1', 'kind=x'])
    assert.equal(answerTree('not json'), null)
  })

  await test('Enrich requests: one per distinct row request, batches of distinct normalized keys, cache keys independent of batch shape', () => {
    const perRow = planEnrich(enrichStep(), rows, 'api')
    assert.deepEqual(perRow.requests.map((r) => [r.call.path, r.rowIndexes]), [['/employees/E1/details', [0, 3]], ['/employees/%20e2%20/details', [1]], ['/employees/E3/details', [2]]], 'identical requests are sent once')
    assert.deepEqual(perRow.rejects.map((r) => r.rowIndex), [4], 'a path value that is missing can not be sent')
    assert.equal(perRow.cacheKeys.get(0), perRow.cacheKeys.get(3))
    const batch = enrichStep({ mode: 'query', path: '/details', keyColumn: 'code', queryParam: 'codes', matchField: 'code', batchSize: 2, answer: { listPath: 'items', fields: [field('grade', 'grade')] } })
    const planned = planEnrich(batch, rows, 'api')
    assert.deepEqual(planned.requests.map((r) => r.call.path), ['/details?codes=E1,e2', '/details?codes=E3'], 'trimmed raw values are sent; " e2 " and "E1" twice count once')
    assert.deepEqual(planned.noKey, [4])
    const again = planEnrich(batch, [rows[2], rows[0]], 'api')
    assert.equal(again.cacheKeys.get('e3'), planned.cacheKeys.get('e3'), 'a key caches the same in any batch')
    assert.notEqual(mappingFingerprint(batch), mappingFingerprint({ ...batch, answer: { ...batch.answer, fields: [field('allowance', 'allowance')] } as never }), 'a changed mapping asks again')
    assert.equal(mappingFingerprint(batch), mappingFingerprint({ ...batch, answer: { ...batch.answer, sample: 'other example' } }), 'the example answer is not part of it')
    const items = matchBatchAnswer(batch, { items: [{ code: 'E1', grade: 'G5' }, { code: 'e2 ', grade: 'G6' }, { code: 'E1', grade: 'G5b' }] })
    assert.deepEqual([...items], [['e1', [{ grade: 'G5' }, { grade: 'G5b' }]], ['e2', [{ grade: 'G6' }]]])
    const body = enrichStep({ mode: 'body', method: 'POST', path: '/lookup', keyColumn: 'code', matchField: 'code', answer: { listPath: 'items', fields: [field('grade', 'grade')] }, body: { template: { t: 'object', fields: [{ key: 'codes', node: { t: 'array', items: 'rows', item: { t: 'value', binding: { kind: 'column', column: 'code' } } } }] } } })
    assert.deepEqual(planEnrich(body, rows.slice(0, 3), 'api').requests.map((r) => r.call.body), ['{"codes":["E1"," e2 ","E3"]}'])
    assert.equal(enrichChunkRows({ mode: 'row', batchSize: 50, maxRequestsPerSecond: 10 }), 400)
  })

  await test('Enrich merge: one row per item, keep / drop / quarantine without an answer, refusals, untested rows kept', () => {
    const step = enrichStep()
    const out = applyEnrich(step, rows.slice(0, 4), [{ kind: 'items', items: [{ grade: 'G7' }, { grade: 'G8' }] }, { kind: 'none' }, { kind: 'refused', message: 'HTTP 422' }, { kind: 'skipped' }])
    assert.deepEqual(out.rows.map((r) => [r.code, r.grade ?? null]), [['E1', 'G7'], ['E1', 'G8'], [' e2 ', null], ['E1', null]])
    assert.deepEqual([out.matched, out.multiplied, out.refused.length, out.unmatched.length], [1, 1, 1, 0])
    assert.equal(applyEnrich({ ...step, onNoMatch: 'drop' }, [rows[1]], [{ kind: 'none' }]).rows.length, 0)
    assert.equal(applyEnrich({ ...step, onNoMatch: 'quarantine' }, [rows[1]], [{ kind: 'none' }]).unmatched.length, 1)
  })

  await test('Enrich validation: batch modes need a key column, a match field and the answer list; POST bodies are checked', () => {
    const issues = (extra: object) => {
      const r = definitionSchema.safeParse({ nodes: [{ id: 's', type: 'source', dataSourceId: 'x', table: 't' }, { id: 'en', type: 'enrich', dataSourceId: 'api', path: '/x', answer: { fields: [field('a', 'a')] }, ...extra }, { id: 'd', type: 'destination', kind: 'dataset', datasetName: 'o', mode: 'append' }], edges: [{ id: '1', from: 's', to: 'en' }, { id: '2', from: 'en', to: 'd' }] })
      return r.success ? [] : r.error.issues.map((i) => i.message)
    }
    assert.deepEqual(issues({}), [])
    assert.ok(issues({ answer: { fields: [] } }).some((m) => /at least one value from the answer/.test(m)))
    const q = issues({ mode: 'query' })
    assert.ok(q.some((m) => /column whose values are sent/.test(m)) && q.some((m) => /names each item's key/.test(m)) && q.some((m) => /list in the answer/.test(m)))
    assert.ok(issues({ mode: 'query', path: '/x/{{code}}', keyColumn: 'code', matchField: 'code', answer: { listPath: 'items', fields: [field('a', 'a')] } }).some((m) => /one row/.test(m)))
    assert.ok(issues({ mode: 'body', keyColumn: 'code', matchField: 'code', answer: { listPath: 'items', fields: [field('a', 'a')] } }).some((m) => /needs POST/.test(m)))
  })

  await test('"Changes data": ledger keys, content hashes, create / update / skip, idempotency keys; always destructive for approvals', () => {
    const step = callStep()
    assert.equal(ledgerKey(step, rows[0]), ledgerKey(step, rows[3]), 'same email, same record')
    assert.equal(ledgerKey(step, { email: '' }), null)
    const h0 = contentHash(step, rows[0])!
    assert.notEqual(h0, contentHash(step, rows[3]), 'a different name is a change')
    assert.equal(decideCall(step, h0, undefined), 'create')
    assert.equal(decideCall(step, h0, { contentHash: 'old', answer: {} }), 'skip', 'without an update request a known record is skipped')
    const withUpdate = callStep({ update: { method: 'PUT', path: '/users/{{user_id}}', body: step.create.body } })
    assert.equal(decideCall(withUpdate, h0, { contentHash: 'old', answer: {} }), 'update')
    assert.equal(decideCall(withUpdate, h0, { contentHash: h0, answer: {} }), 'skip', 'unchanged data: nothing sent')
    const r = renderApiCall(withUpdate.update!, { ...rows[0], user_id: 'U0007' })
    assert.ok('call' in r && r.call.path === '/users/U0007' && r.call.method === 'PUT', 'the update path uses the answer the create returned')
    assert.equal(idempotencyKey('p1', 'ac', 'abcdef0123456789xyz', '0123456789abcdefzz'), 'p1:ac:abcdef0123456789:0123456789abcdef')
    const def = graph({ id: 'ac', type: 'apicall', dataSourceId: 'api', keys: ['email'], create: step.create })
    assert.deepEqual(destructiveWrites(def).filter((d) => /Changes data/.test(d)), ['Changes data through POST /users'])
    assert.ok(!definitionSchema.safeParse({ ...def, nodes: def.nodes.map((n) => (n.type === 'apicall' ? { ...n, create: { ...n.create, body: { template: { t: 'object', fields: [{ key: 'all', node: { t: 'array', items: 'rows', item: { t: 'value', binding: { kind: 'column', column: 'email' } } } }] } } } } : n)) }).success, 'each call sends one row')
    assert.equal(MIN_AGENT_VERSION_FOR_OP.apiCall, '1.4.0')
    assert.ok(payloadSchemas.apiCall.safeParse({ connection: 'HR', calls: [{ method: 'GET', path: '/x' }], options: { maxRequestsPerSecond: 5, concurrency: 1, timeoutSeconds: 30 } }).success)
    assert.ok(!payloadSchemas.apiCall.safeParse({ connection: 'HR', calls: [{ method: 'DELETE', path: '/x' }], options: { maxRequestsPerSecond: 5, concurrency: 1, timeoutSeconds: 30 } }).success, 'no DELETE (decided)')
  })

  await test('engine: Enrich merges answers and quarantines refusals; "Changes data" continues with the answer, refusals held for replay', async () => {
    const def = definitionSchema.parse({
      nodes: [
        { id: 's', type: 'source', dataSourceId: 'x', table: 'hris' },
        { id: 'en', type: 'enrich', dataSourceId: 'api', path: '/employees/{{code}}/details', onNoMatch: 'quarantine', answer: { fields: [field('data.grade', 'grade')] } },
        { id: 'ac', type: 'apicall', dataSourceId: 'api2', keys: ['email'], create: callStep().create, answer: { fields: [field('user.id', 'user_id')] } },
        { id: 'd', type: 'destination', kind: 'dataset', datasetName: 'out', mode: 'append' },
      ],
      edges: [{ id: '1', from: 's', to: 'en' }, { id: '2', from: 'en', to: 'ac' }, { id: '3', from: 'ac', to: 'd' }],
    })
    const api: NonNullable<EngineContext['api']> = {
      enrich: async (_s, rs) => ({ outcomes: rs.map((r) => (r.code === 'E3' ? { kind: 'none' } : { kind: 'items', items: [{ grade: `G-${String(r.code).trim()}` }] })), calls: rs.length, cached: 0 }),
      call: async (_s, rs) => ({ outcomes: rs.map((r, i) => (r.name === 'Daniel' ? { kind: 'refused', message: 'The API refused the request (HTTP 422): name taken' } : { kind: 'ok', answer: { user_id: `U${i}` }, sent: true })), calls: rs.length }),
    }
    const writes: Record<string, Row[]> = {}
    const res = await runEngine(def, { read: async () => rows.slice(0, 3), write: async (s, out) => ((writes[s.id] = out), { written: out.length, target: s.id }) }, { context: { api } })
    assert.deepEqual(writes.d.map((r) => [r.code, r.grade, r.user_id]), [['E1', 'G-E1', 'U0']])
    assert.deepEqual(res.rejects.map((r) => [r.stepId, r.errors[0]]), [
      ['en', 'The API had no answer for this row (GET /employees/{{code}}/details)'],
      ['ac', 'POST /users: The API refused the request (HTTP 422): name taken'],
    ])
    assert.equal(localizeCheck(res.rejects[0].errors[0], 'id'), 'API tidak memberi jawaban untuk baris ini (GET /employees/{{code}}/details)')
    assert.equal(localizeCheck(res.rejects[1].errors[0], 'id'), 'POST /users: API menolak permintaan (HTTP 422): name taken')
    assert.deepEqual([res.steps.find((s) => s.id === 'en')!.calls, res.steps.find((s) => s.id === 'ac')!.calls], [3, 2])
    assert.equal(localizeStepTitle('Call POST /users', createTranslator('id')), 'Panggil POST /users')
    // Without API access (a context that has none), the steps refuse instead of passing rows through unchanged.
    const none = await runEngine(def, { read: async () => rows.slice(0, 1) })
    assert.match(none.error ?? '', /API calls are not available here/)
  })
}
