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
import { applyTransform, checkManagers, formatDate, parseDate, validateRow } from '@/lib/pipelines/transforms'
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
import { createTranslator, MESSAGES } from '@/lib/i18n/translate'
import { landingSection, settingsHref } from '@/lib/navigation'
import { localizeCheck, parseCheck } from '@/lib/pipelines/check-messages'
import { applyFix, checkDiagnosis, checkPipelinePlan, redactMessage } from '@/lib/ai/pipelines'
import { render } from '@/lib/email'
import { SERVER_ERRORS } from '@/lib/i18n/server-errors-table'
import { localizeServerError } from '@/lib/i18n/server-errors'
import { checkCatalogAnswer, checkConnectorAnswer, detectConnectors, rankCatalog, scrubPasted } from '@/lib/ai/discovery'
import { serverErrorTemplates } from './test/server-error-sources'
import { localizeStepTitle } from '@/components/pipelines/step-title'
import { alertEmail, inviteEmail, passwordChangedEmail, resetPasswordEmail } from '@/lib/email-templates'
import { BUILTIN_MAPPING_TEMPLATES, PIPELINE_TEMPLATES, applyMappingTemplate, buildPipelineTemplate, mapToEntity } from '@/lib/pipelines/templates'
import { buildLineage } from '@/lib/catalog/lineage'
import { signPayload } from '@/lib/webhooks/deliver'
import { assertConnectorUrl, isInternalHostName, isPrivateAddress, withPrivateNetworkAccess } from '@/lib/net/safe-url'
import { signRequest, verifyRequestSignature } from '@/lib/net/request-signing'
import { agentRestRequest, isWithinBaseUrl, mergeAgentRestRequest, publicEndpoint, restRequestDesign } from '@/lib/connectors/rest/agent-request'
import { buildRestRequest, parseRestConfig, previewRestRequest, redactRestRequest } from '@/lib/connectors/rest-client'
import { parseConnectionPaste, sanitizeRestCredentials } from '@/lib/connectors/rest/parse-connection'
import { parseKeyValueList, serializeKeyValueList } from '@/lib/connectors/rest/key-value'
import { compareVersions } from '@/lib/agent/protocol'
import { CONNECTOR_CATALOG } from '@/lib/connectors/catalog'
import { readdirSync, readFileSync as readGuideFile } from 'node:fs'
import { HELP_CONTENT } from '@/lib/help'
import { TERMS, TERMS_VERSION } from '@/lib/legal/terms'
import { HELP_SCREENS } from '@/lib/help/screens'
import { matchesQuery } from '@/lib/help/search'
import { TOUR_STAGES, TOUR_STEPS } from '@/lib/tour/steps'
import { SECTIONS, sectionHref } from '@/lib/navigation'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { CONNECTOR_GROUPS } from '@/lib/connectors/types'
import { rfc3986, signAwsRequest } from '@/lib/net/aws-sigv4'
import { SECRET_MANAGER_SLUGS, findSecretRefs, hasSecretRefs, isSecretManager, secretRef } from '@/lib/secrets/types'
import { secretField } from '@/lib/secrets/types'
import { fileTables, normalizePrefix, xmlText } from '@/lib/connectors/storage/files'
import { promResultRows } from '@/lib/connectors/drivers/prometheus'
import { mappingColumns } from '@/lib/connectors/drivers/elasticsearch'
import { flattenRow, parseNamedQueries } from '@/lib/connectors/http'
import { connectorMatches, groupConnectors, isConnectorGroup, normalizeSearch } from '@/lib/connectors/search'
import { msIdent, sqlServerChunkQuery, sqlServerColumnType, sqlServerConfig, sqlServerLiveQuery, sqlServerSchema } from '@/lib/connectors/drivers/sqlserver'
import { issuerFor, PUBLIC_EMAIL_DOMAINS, DOMAIN_RE } from '@/lib/auth/sso-presets'
import { rateLimitHeaders } from '@/lib/api/rate-limit'
import { openApiSpec } from '@/lib/api/openapi'
import { readFileSync } from 'node:fs'
import { approvalReasons, destructiveWrites } from '@/lib/pipelines/approvals'
import { applyRuleIds, nextEnvironment, planPromotion, remapRuleBody, type PromotionSide } from '@/lib/pipelines/promote'
import { ruleBodySchema } from '@/lib/rules/definition'
import { manualIdpSettings, parseIdpMetadata, samlConfigFor, spEndpoints } from '@/lib/auth/saml'
import { ScimError, applyGroupPatch, applyUserPatch, paging, parseFilter, parsePatch, userEmail } from '@/lib/scim/protocol'
import { expandEnv, parseConfig } from '../agent/nexus-agent'
import { payloadSchemas, wireRow } from '@/lib/agent/protocol'
import { extractJson, LlmError } from '@/lib/ai/llm'
import { AnswerError, checkAsk, checkMapping, checkRule, safeSamples } from '@/lib/ai/prompts'

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

  await test('approvals: policy decides which publishes wait for a second person', () => {
    const replace = definitionSchema.parse({ steps: [{ id: 's', type: 'source', dataSourceId: 'x', table: 't' }, { id: 'd', type: 'destination', kind: 'dataset', datasetName: 'employees', mode: 'replace' }] })
    const upsert = definitionSchema.parse({ steps: [{ id: 's', type: 'source', dataSourceId: 'x', table: 't' }, { id: 'd', type: 'destination', kind: 'dataset', datasetName: 'employees', mode: 'upsert', keys: ['id'] }] })
    const softDelete = definitionSchema.parse({ steps: [{ id: 's', type: 'source', dataSourceId: 'x', table: 't' }, { id: 'd', type: 'destination', kind: 'dataset', datasetName: 'employees', mode: 'upsert', keys: ['id'], softDeleteMissing: true }] })
    assert.deepEqual(approvalReasons('off', replace), [])
    assert.deepEqual(approvalReasons('destructive', replace), ['Replaces dataset employees on every run'])
    assert.deepEqual(approvalReasons('destructive', upsert), [], 'upserts are not destructive')
    assert.match(destructiveWrites(softDelete)[0], /Marks rows missing from the source as deleted in dataset employees/)
    assert.equal(approvalReasons('always', upsert)[0], 'Every publish needs approval in this workspace')
    assert.equal(approvalReasons('always', upsert, { promotedFrom: 'Staging' })[0], 'Promoted from Staging')
  })

  await test('promotion: data sources, rules and chained pipelines are mapped into the next environment', () => {
    const body = ruleBodySchema.parse({ when: { match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'x' }] }, then: [{ type: 'trigger_pipeline', pipelineId: 'dev-p2' }] })
    const def = definitionSchema.parse({
      steps: [
        { id: 's', type: 'source', dataSourceId: 'dev-hr', table: 'employees' },
        { id: 'r', type: 'rules', ruleIds: ['dev-rule'] },
        { id: 'd', type: 'destination', kind: 'datasource', dataSourceId: 'dev-lms', table: 'employee', mode: 'upsert', keys: ['id'] },
      ],
    })
    const from: PromotionSide = {
      dataSources: [{ id: 'dev-hr', name: 'HR DB', sourceType: 'postgresql' }, { id: 'dev-lms', name: 'LMS', sourceType: 'kmplus' }],
      rules: [{ id: 'dev-rule', name: 'Contract approval', body }],
      pipelines: [{ id: 'dev-p1', name: 'Employees', promotionKey: null }, { id: 'dev-p2', name: 'Training', promotionKey: null }],
    }
    const to: PromotionSide = {
      dataSources: [{ id: 'stg-hr', name: 'hr db', sourceType: 'postgresql' }, { id: 'stg-lms', name: 'LMS', sourceType: 'kmplus' }],
      rules: [],
      pipelines: [{ id: 'stg-p2', name: 'Training (renamed)', promotionKey: 'dev-p2' }],
    }
    const schedule = scheduleSchema.parse({ type: 'after', afterPipelineId: 'dev-p2' })
    const plan = planPromotion(def, schedule, from, to, 'Staging')
    assert.deepEqual(plan.blocking, [])
    const src = plan.definition.nodes.find((n) => n.type === 'source')!
    assert.equal(src.type === 'source' && src.dataSourceId, 'stg-hr', 'data sources match by name (any case) and connector type')
    const dest = plan.definition.nodes.find((n) => n.type === 'destination')!
    assert.equal(dest.type === 'destination' && dest.kind === 'datasource' && dest.dataSourceId, 'stg-lms')
    assert.equal(plan.schedule.type === 'after' && plan.schedule.afterPipelineId, 'stg-p2', '"run after" follows the promotion key, not the name')
    assert.equal(plan.rules.length, 1)
    assert.equal(plan.rules[0].targetId, null, 'missing rule is created')
    assert.equal(plan.rules[0].body.then[0].type === 'trigger_pipeline' && plan.rules[0].body.then[0].pipelineId, 'stg-p2')
    const fixed = applyRuleIds(plan.definition, new Map([['dev-rule', 'stg-rule']]))
    const rulesNode = fixed.nodes.find((n) => n.type === 'rules')!
    assert.deepEqual(rulesNode.type === 'rules' && rulesNode.ruleIds, ['stg-rule'])
    // Same rule already there: nothing to write.
    const again = planPromotion(def, schedule, from, { ...to, rules: [{ id: 'stg-rule', name: 'CONTRACT APPROVAL', body: remapRuleBody(body, () => 'stg-p2') }] }, 'Staging')
    assert.equal(again.rules.length, 0)
    assert.equal(again.items.find((i) => i.kind === 'business rule')?.status, 'same')
    // Missing data source and unpromoted chained pipeline block it.
    const blocked = planPromotion(def, schedule, from, { dataSources: [], rules: [], pipelines: [] }, 'Production')
    assert.ok(blocked.blocking.some((b) => /Add the data source "HR DB" \(postgresql\) in Production/.test(b)))
    assert.ok(blocked.blocking.some((b) => /promote that one to Production first/.test(b)))
    assert.equal(nextEnvironment('dev', ['dev', 'prod']), 'prod', 'skips a missing staging')
    assert.equal(nextEnvironment('prod', ['dev', 'staging', 'prod']), null)
  })

  await test('SAML: IdP metadata gives entity ID, sign-in URL and signing certificate; bad metadata is refused', () => {
    const pem = readFileSync('scripts/test/fixtures/saml-idp-cert.pem', 'utf8')
    const b64 = pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, '')
    const metadata = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://sts.windows.net/tenant-1/">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="encryption"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>not-a-cert</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>
      ${b64}
    </ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://login.example.com/saml/post"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://login.example.com/saml?a=1&amp;b=2"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`
    const idp = parseIdpMetadata(metadata)
    assert.equal(idp.entityId, 'https://sts.windows.net/tenant-1/')
    assert.equal(idp.ssoUrl, 'https://login.example.com/saml?a=1&b=2', 'prefers HTTP-Redirect and decodes entities')
    assert.deepEqual(idp.certificates, [b64], 'encryption keys are ignored')
    assert.throws(() => parseIdpMetadata('<!DOCTYPE x [<!ENTITY e "x">]>' + metadata), /DOCTYPE/)
    assert.throws(() => parseIdpMetadata('<md:EntityDescriptor entityID="sp"><md:SPSSODescriptor/></md:EntityDescriptor>'), /no identity provider/)
    assert.throws(() => parseIdpMetadata(metadata, new Date('2100-01-01')), /expired/)
    assert.throws(() => manualIdpSettings({ entityId: 'x', ssoUrl: 'http://insecure.example.com', certificate: pem }), /https/)
    assert.equal(manualIdpSettings({ entityId: 'urn:x', ssoUrl: 'https://idp.example.com/sso', certificate: pem }).certificates[0], b64, 'PEM headers are stripped')
    const sp = spEndpoints('https://nexus.example/', 'sso-abc')
    assert.equal(sp.acsUrl, 'https://nexus.example/api/auth/sso/saml2/sp/acs/sso-abc')
    const cfg = samlConfigFor({ preset: 'azure', sp, idp })
    assert.equal(cfg.audience, sp.entityId)
    assert.equal(cfg.entryPoint, idp.ssoUrl)
    assert.match(cfg.mapping.email, /claims\/emailaddress$/)
    assert.ok(!JSON.stringify(cfg).includes('privateKey'), 'no SP private key is stored')
  })

  await test('SCIM: filters, Entra/Okta PATCH shapes and group membership changes', () => {
    assert.deepEqual(parseFilter('userName eq "Budi@KMPlus.co.id"', ['userName', 'externalId']), { attribute: 'userName', value: 'Budi@KMPlus.co.id' })
    assert.deepEqual(parseFilter('USERNAME eq "a\\"b"', ['userName']), { attribute: 'userName', value: 'a"b' })
    assert.equal(parseFilter(null, ['userName']), null)
    assert.throws(() => parseFilter('userName sw "a"', ['userName']), ScimError)
    assert.throws(() => parseFilter('title eq "x"', ['userName']), /not supported/)
    assert.deepEqual(paging(new URLSearchParams('startIndex=0&count=5000')), { startIndex: 1, count: 200 })
    const doc = { userName: 'budi@kmplus.co.id', active: true, name: { givenName: 'Budi' }, emails: [{ type: 'work', value: 'budi@kmplus.co.id', primary: true }] }
    // Entra: path + string booleans; Okta: value object.
    const entra = applyUserPatch(doc, parsePatch({ Operations: [{ op: 'Replace', path: 'active', value: 'False' }, { op: 'Add', path: 'name.familyName', value: 'Santoso' }, { op: 'Replace', path: 'emails[type eq "work"].value', value: 'budi.s@kmplus.co.id' }] }))
    assert.equal(entra.active, false)
    assert.deepEqual(entra.name, { givenName: 'Budi', familyName: 'Santoso' })
    assert.equal(userEmail(entra), 'budi.s@kmplus.co.id')
    assert.equal(doc.active, true, 'the input is not changed')
    const okta = applyUserPatch(doc, parsePatch({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: false, displayName: 'Budi S' } }] }))
    assert.equal(okta.active, false)
    assert.equal(okta.displayName, 'Budi S')
    const ext = applyUserPatch(doc, parsePatch({ Operations: [{ op: 'add', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'Finance' }] }))
    assert.deepEqual(ext['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'], { department: 'Finance' })
    assert.throws(() => parsePatch({ Operations: [{ op: 'move', path: 'x' }] }), /Unknown PATCH op/)
    assert.equal(userEmail({ userName: 'not-an-email' }), null)
    const g = { displayName: 'Nexus Admins', externalId: null, members: ['u1'] }
    assert.deepEqual(applyGroupPatch(g, parsePatch({ Operations: [{ op: 'Add', path: 'members', value: [{ value: 'u2' }, { value: 'u1' }] }] })).members, ['u1', 'u2'])
    assert.deepEqual(applyGroupPatch({ ...g, members: ['u1', 'u2'] }, parsePatch({ Operations: [{ op: 'Remove', path: 'members', value: [{ value: 'u1' }] }] })).members, ['u2'])
    assert.deepEqual(applyGroupPatch({ ...g, members: ['u1', 'u2'] }, parsePatch({ Operations: [{ op: 'remove', path: 'members[value eq "u2"]' }] })).members, ['u1'])
    assert.equal(applyGroupPatch(g, parsePatch({ Operations: [{ op: 'replace', value: { displayName: 'Admins', id: 'ignored' } }] })).displayName, 'Admins')
    assert.throws(() => applyGroupPatch(g, parsePatch({ Operations: [{ op: 'remove', path: 'displayName' }] })), /required/)
  })

  await test('Nexus Agent: config with ${ENV} secrets, https only, unique names; wire-safe rows; payload limits', () => {
    const cfg = parseConfig({ url: 'https://nexus.example', token: 'nxa_abc', connections: [{ name: 'HR', type: 'postgres', credentials: { connectionString: '${HR_URL}', port: 5432 } }] }, { HR_URL: 'postgres://u:p@db/hr' })
    assert.equal(cfg.connections[0].credentials.connectionString, 'postgres://u:p@db/hr')
    assert.equal(cfg.connections[0].writable, false, 'read-only unless marked writable')
    assert.throws(() => parseConfig({ url: 'https://n.example', token: 'nxa_x', connections: [{ name: 'A', type: 'postgres', credentials: { x: '${MISSING}' } }] }, {}), /MISSING is not set/)
    assert.throws(() => parseConfig({ url: 'http://nexus.example', token: 'nxa_x' }, {}), /https/)
    assert.doesNotThrow(() => parseConfig({ url: 'http://localhost:3000', token: 'nxa_x' }, {}))
    assert.throws(() => parseConfig({ url: 'https://n.example', token: 'nxa_x', connections: [{ name: 'A', type: 'postgres' }, { name: 'a', type: 'mysql' }] }, {}), /Two connections/)
    assert.throws(() => parseConfig({ url: 'https://n.example', token: 'nxa_x', connections: [{ name: 'F', type: 'file' }] }, {}))
    assert.throws(() => parseConfig({ url: 'https://n.example', token: 'secret' }, {}), /nxa_/)
    assert.deepEqual(expandEnv(['${A}-${A}', { k: 1 }], { A: 'x' }), ['x-x', { k: 1 }])
    assert.deepEqual(wireRow({ d: new Date('2026-01-02T03:04:05Z'), b: BigInt(12), buf: Buffer.from('hi'), n: null, u: undefined, o: { a: 1 } }), { d: '2026-01-02T03:04:05.000Z', b: '12', buf: 'aGk=', n: null, u: null, o: { a: 1 } })
    assert.equal(payloadSchemas.write.safeParse({ connection: 'HR', table: 't', mode: 'append', keys: [], columns: [], rows: Array.from({ length: 1001 }, () => ({})) }).success, false, 'writes travel in batches of at most 1000 rows')
    assert.equal(payloadSchemas.readChunk.safeParse({ connection: 'HR', table: 't', offset: 0, limit: 5000, maxRows: 100000, cacheKey: 'k' }).success, true)
  })

  await test('AI assistant: JSON extraction and answer checks keep models to real columns, schemas and safe samples', () => {
    assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 })
    assert.deepEqual(extractJson('Here you go: {"a":{"b":2}} hope that helps'), { a: { b: 2 } })
    assert.throws(() => extractJson('no json here'), LlmError)
    assert.deepEqual(safeSamples('nik', ['3201234567890001']), [], 'personal columns share no examples')
    assert.deepEqual(safeSamples('gaji_pokok', ['9000000']), [], 'sensitive columns share no examples')
    assert.deepEqual(safeSamples('org_code', ['50000010', '', null, 'x'.repeat(60)]), ['50000010', 'x'.repeat(40)])
    const cols = [{ name: 'PERNR', type: 'text' }, { name: 'BEGDA', type: 'integer' }]
    const mapped = checkMapping({ fields: [
      { from: 'pernr', to: 'employee_code', type: 'text' },
      { from: 'BEGDA', to: 'hire_date', type: 'date', transforms: [{ fn: 'format_date', args: ['yyyy-MM-dd', 'yyyyMMdd'] }, { fn: 'rm -rf', args: [] }] },
      { from: 'BEGDA', to: 'hire_date' },
      { from: 'GHOST', to: 'full_name' },
      { from: 'PERNR', to: 'not_a_target_field' },
    ] }, { sourceColumns: cols, targetFields: [{ name: 'employee_code', type: 'text' }, { name: 'hire_date', type: 'date' }, { name: 'full_name', type: 'text' }], mapped: [] })
    assert.deepEqual(mapped.map((m) => [m.from, m.to, m.type, m.transforms.map((t) => t.fn).join()]), [['PERNR', 'employee_code', 'text', ''], ['BEGDA', 'hire_date', 'date', 'format_date']])
    assert.throws(() => checkMapping({ nope: 1 }, { sourceColumns: cols, targetFields: null, mapped: [] }), AnswerError)

    const fields = [{ name: 'status', type: 'text' }, { name: 'hire_date', type: 'date' }]
    const good = { name: 'Contract approval', body: { when: { match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'Kontrak' }] }, then: [{ type: 'require_approval', reason: 'contract' }] } }
    assert.equal(checkRule(good, { fields }).body.when.conditions[0].valueField, '', 'defaults are filled in')
    assert.throws(() => checkRule({ ...good, body: { ...good.body, when: { match: 'all', conditions: [{ field: 'salary', operator: 'greater_than', value: '1' }] } } }, { fields }), /Unknown field\(s\) in conditions: salary/)
    assert.throws(() => checkRule({ ...good, body: { ...good.body, then: [{ type: 'trigger_pipeline', pipelineId: 'p1' }] } }, { fields }), /trigger_pipeline/)
    assert.throws(() => checkRule({ ...good, body: { when: { match: 'sometimes' }, then: [] } }, { fields }), /invalid at when.match/)

    const datasets = [{ name: 'employees', rowCount: 10, columns: [{ name: 'department', type: 'text' }, { name: 'hire_date', type: 'date' }, { name: 'salary', type: 'numeric', masked: true }] }]
    const ask = checkAsk({ widget: { dataset: 'employees', type: 'bar', measure: { agg: 'count', column: '' }, dimension: { column: 'department', grain: 'none' }, filters: [], sort: 'value_desc', limit: 5 }, explanation: 'x' }, { datasets })
    assert.equal(ask.widget.dimension?.column, 'department')
    assert.equal(checkAsk({ widget: { dataset: 'employees', type: 'kpi', measure: { agg: 'count' }, dimension: {} } }, { datasets }).widget.dimension, null, 'an empty dimension on a KPI is ignored')
    assert.throws(() => checkAsk({ widget: { dataset: 'payroll', type: 'kpi', measure: { agg: 'count' } } }, { datasets }), /Unknown dataset/)
    assert.throws(() => checkAsk({ widget: { dataset: 'employees', type: 'kpi', measure: { agg: 'sum', column: 'salary' } } }, { datasets }), /masked/)
    assert.throws(() => checkAsk({ widget: { dataset: 'employees', type: 'kpi', measure: { agg: 'sum', column: 'department' } } }, { datasets }), /needs a number column/)
    assert.throws(() => checkAsk({ widget: { dataset: 'employees', type: 'line', measure: { agg: 'count' }, dimension: { column: 'department', grain: 'month' } } }, { datasets }), /needs a date column/)
    assert.throws(() => checkAsk({ widget: { dataset: 'employees', type: 'bar', measure: { agg: 'count' }, dimension: { column: 'nope' } } }, { datasets }), /not in employees/)
  })

  await test('check messages: the engine writes English; the inbox reads them back in Indonesian', () => {
    const rules = [
      { rule: 'required', field: 'email' },
      { rule: 'nik', field: 'national_id' },
      { rule: 'one_of', field: 'gender', value: 'L, P' },
      { rule: 'compare', field: 'end_date', otherField: 'start_date', operator: 'greater_or_equal' },
    ] as const
    const issues = validateRow(
      { email: '', national_id: '123', gender: 'X', end_date: '2020-01-01', start_date: '2021-01-01' },
      { id: 'v', type: 'validate', position: { x: 0, y: 0 }, onFail: 'reject', rules: rules.map((r) => ({ value: '', severity: 'error', otherField: '', operator: 'greater_or_equal', ruleId: '', ...r })) } as never,
      new Map(),
    ).map((i) => i.message)
    assert.deepEqual(issues, [
      'email is required',
      'national_id "123" is not a valid NIK (16 digits with a birth date)',
      'gender "X" is not one of L, P',
      'end_date (2020-01-01) must be greater or equal start_date (2021-01-01)',
    ], 'English text is unchanged for stored rows')
    assert.deepEqual(parseCheck(issues[1]), { code: 'nik', params: { field: 'national_id', value: '123' } })
    assert.equal(localizeCheck(issues[0], 'id'), 'email wajib diisi')
    assert.equal(localizeCheck(issues[3], 'id'), 'end_date (2020-01-01) harus lebih besar atau sama dengan start_date (2021-01-01)')
    assert.equal(localizeCheck('birth_date: "31/02/1990" is not a date', 'id'), 'birth_date: "31/02/1990" bukan tanggal', 'Map conversion errors keep their field prefix')
    assert.equal(localizeCheck('Needs approval (Contract employee)', 'id'), 'Perlu persetujuan (Contract employee)')
    assert.equal(localizeCheck('Refused by KMS: duplicate key', 'id'), 'Refused by KMS: duplicate key', 'unknown text is shown as written')
    assert.equal(localizeCheck(issues[0], 'en'), issues[0])
  })

  await test('AI-2/AI-3: plans become checked pipelines; fixes apply as drafts; personal values are hidden', () => {
    const sources = [
      { id: 'src1', name: 'HR exports', sourceType: 'file', role: 'source' as const, tables: [{ name: 'people', columns: [{ name: 'id', type: 'integer' }, { name: 'status', type: 'text' }, { name: 'email', type: 'text' }] }] },
      { id: 'kms', name: 'KMS', sourceType: 'kmplus', role: 'destination' as const, tables: [] },
    ]
    const plan = { name: 'Active people', template: 'csv-dataset', dataSourceId: 'src1', table: 'people', datasetName: 'people', filter: { match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'active' }] }, schedule: { type: 'weekly', time: '02:00', weekdays: [1, 3] } }
    const draft = checkPipelinePlan(plan, { sources, datasets: [] })
    assert.deepEqual(draft.definition.nodes.map((n) => n.type).sort(), ['destination', 'filter', 'map', 'source'])
    const filterNode = draft.definition.nodes.find((n) => n.type === 'filter')!
    const sourceNode = draft.definition.nodes.find((n) => n.type === 'source')!
    assert.ok(draft.definition.edges.some((e) => e.from === sourceNode.id && e.to === filterNode.id), 'source → filter → map')
    assert.deepEqual([draft.schedule.type, draft.schedule.weekdays, draft.schedule.timezone], ['weekly', [1, 3], 'Asia/Jakarta'])
    assert.throws(() => checkPipelinePlan({ ...plan, table: 'payroll' }, { sources, datasets: [] }), /not in HR exports/)
    assert.throws(() => checkPipelinePlan({ ...plan, filter: { match: 'all', conditions: [{ field: 'salary', operator: 'equals', value: '1' }] } }, { sources, datasets: [] }), /salary/)
    assert.throws(() => checkPipelinePlan({ ...plan, dataSourceId: 'kms' }, { sources, datasets: [] }), /Unknown data source/)
    assert.throws(() => checkPipelinePlan({ ...plan, kmplusDestinationId: 'src1' }, { sources, datasets: [] }), /not a KMPlus product/)

    const def = draft.definition
    const mapNode = def.nodes.find((n) => n.type === 'map')!
    const withTrim = applyFix(def, { kind: 'add_transform', field: 'email', transform: { fn: 'trim', args: [] } })
    const mapped = withTrim.nodes.find((n) => n.id === mapNode.id)
    assert.ok(mapped?.type === 'map' && mapped.fields.find((f) => f.to === 'email')?.transforms.some((t) => t.fn === 'trim'))
    assert.throws(() => applyFix(def, { kind: 'add_transform', field: 'nope', transform: { fn: 'trim', args: [] } }), /No Map step/)
    const withRules = definitionSchema.parse({
      ...def,
      nodes: [...def.nodes, { id: 'val', type: 'validate', position: { x: 0, y: 0 }, rules: [{ field: 'email', rule: 'email' }, { field: 'id', rule: 'required' }] }],
      edges: [...def.edges.map((e) => (e.from === mapNode.id ? { ...e, from: 'val' } : e)), { id: 'e_val', from: mapNode.id, to: 'val', branch: '' }],
    })
    const softened = applyFix(withRules, { kind: 'change_severity', stepId: 'val', field: 'email', rule: 'email', severity: 'warning' })
    assert.equal(softened.nodes.find((n) => n.id === 'val')?.type === 'validate' && (softened.nodes.find((n) => n.id === 'val') as { rules: { severity: string }[] }).rules[0].severity, 'warning')
    assert.throws(() => checkDiagnosis({ summary: 'x', fix: { kind: 'remove_rule', field: 'id', rule: 'required' } }, { definition: withRules }), /Do not remove required/)
    assert.equal(checkDiagnosis({ summary: 'Source down', fix: { kind: 'none' } }, { definition: withRules }).fix.kind, 'none')

    assert.equal(redactMessage('national_id "3171012345678901" is not a valid NIK (16 digits with a birth date)'), 'national_id "<hidden>" is not a valid NIK (16 digits with a birth date)')
    assert.equal(redactMessage('status "x" is not one of active, inactive'), 'status "x" is not one of active, inactive', 'values of public fields stay')
    assert.equal(redactMessage('Lookup failed for "Budi Santoso" 081234567890'), 'Lookup failed for "<hidden>" <hidden>')
  })

  await test('email: branded layout, escaped text, plain-text twin, both languages', () => {
    const msg = render({ to: 'x@example.com', subject: 'S', heading: 'Hello <b>', lines: ['Line & one'], details: [{ label: 'Role', value: 'Admin' }], action: { label: 'Open', url: 'https://example.com/a?b=1&c=2' }, status: { tone: 'danger', label: 'Needs attention' }, locale: 'id' })
    assert.match(msg.html, /\/brand\/kmplus-logo-on-dark\.png/)
    assert.match(msg.html, /Hello &lt;b&gt;/)
    assert.match(msg.html, /Line &amp; one/)
    assert.match(msg.html, /href="https:\/\/example\.com\/a\?b=1&amp;c=2"/)
    assert.match(msg.html, /lang="id"/)
    assert.match(msg.html, /Tombol tidak berfungsi/)
    assert.match(msg.text, /Open: https:\/\/example\.com\/a\?b=1&c=2/)
    assert.match(msg.text, /\[Needs attention\]/)
    const invite = inviteEmail({ inviter: 'Dewi', workspace: 'PT Contoh', role: 'Analyst', email: 'a@b.co', url: 'https://x/invite/1', locale: 'en' })
    assert.equal(invite.subject, 'Dewi invited you to PT Contoh on KMPlus Nexus')
    const alert = alertEmail({ title: 'SAP failed', level: 'error', locale: 'en', pipelineId: 'p', lines: ['Pipeline: SAP', 'Result: 401', 'Something odd'] })
    assert.deepEqual(alert.details?.map((d) => d.label), ['Pipeline', 'Result'])
    assert.deepEqual(alert.lines, ['Something odd'])
    assert.match(alert.action!.url, /\/dashboard\/pipelines$/)
  })

  await test('server errors: every thrown message has a translation; actions answer in the reader\'s language', () => {
    const known = new Set(SERVER_ERRORS.map((e) => e.en))
    const missing = serverErrorTemplates().filter((m) => !known.has(m.en))
    assert.deepEqual(missing, [], `add these to lib/i18n/server-errors-table.ts (with an Indonesian translation): ${missing.map((m) => `${m.en} (${m.file})`).join(' | ')}`)
    for (const e of SERVER_ERRORS) {
      const ph = (s: string) => (s.match(/\{p\d+\}/g) ?? []).sort().join(',')
      assert.equal(ph(e.id), ph(e.en), `placeholders differ: ${e.en}`)
      assert.ok(e.id.trim(), `empty translation: ${e.en}`)
    }
    assert.equal(localizeServerError('Agent not found', 'en'), 'Agent not found')
    assert.notEqual(localizeServerError('Agent not found', 'id'), 'Agent not found')
    assert.equal(localizeServerError('name: Required', 'id'), 'name: Wajib diisi', 'zod issues keep their path')
    assert.equal(localizeServerError('String must contain at most 120 character(s)', 'id'), 'Maksimal 120 karakter')
    assert.equal(localizeServerError('email is required', 'id'), 'email wajib diisi', 'check messages too')
    assert.equal(localizeServerError('Totally new message', 'id'), 'Totally new message', 'unknown text is shown as written')
  })

  await test('AI-4 / AI-5: connectors from URLs, headers and errors; catalog answers without a model', () => {
    const catalog = ['sap', 'oracle', 'mysql', 'postgres', 'rest', 'salesforce', 'snowflake', 'supabase', 'talenta', 'ldap', 'file', 'kmplus'].map((slug) => ({ slug, name: slug, category: 'x', description: '' }))
    const top = (text: string) => detectConnectors(text, catalog)[0]?.slug
    assert.equal(top('https://acme.my.salesforce.com/services/data'), 'salesforce')
    assert.equal(top('ORA-12541: TNS:no listener'), 'oracle')
    assert.equal(top('password authentication failed for user "nexus"'), 'postgres')
    assert.equal(top('PERNR;ENAME;BEGDA;ORGEH;PLANS;BUKRS'), 'sap', 'SAP PA0001 export header')
    assert.equal(top('sAMAccountName,mail,department,title'), 'ldap')
    assert.equal(top('employee_no,name,dept,join_date'), 'file', 'a plain header is an uploaded file')
    assert.equal(top('https://kms.kmplus.co.id/nexus/v1/entities'), 'kmplus')
    assert.equal(scrubPasted('postgres://nexus:S3cret!@db.example.com:5432/hr token=abc123'), 'postgres://•••@db.example.com:5432/hr token=•••')
    assert.throws(() => checkConnectorAnswer({ suggestions: [{ slug: 'sharepoint' }] }, catalog), /Unknown connector/)

    const items = [
      { key: 'dataset:training_history', kind: 'dataset' as const, name: 'training_history', sourceName: null, description: '', tags: [], domains: [], columns: [{ name: 'employee_code' }, { name: 'course_name' }, { name: 'hours' }, { name: 'org_code', doc: 'Department code' }] },
      { key: 'dataset:employees', kind: 'dataset' as const, name: 'employees', sourceName: null, description: 'Active staff from SAP', tags: ['hr'], domains: ['employee'], columns: [{ name: 'employee_code' }, { name: 'full_name' }, { name: 'org_code' }] },
      { key: 'dataset:ad_users', kind: 'dataset' as const, name: 'ad_users', sourceName: null, description: '', tags: [], domains: [], columns: [{ name: 'username' }, { name: 'mail' }] },
    ]
    const hits = rankCatalog('Where is training hours by department?', items)
    assert.equal(hits[0].key, 'dataset:training_history')
    assert.ok(hits[0].columns.includes('hours') && hits[0].columns.includes('org_code'), 'the columns that answer it')
    assert.equal(rankCatalog('di mana jam pelatihan per departemen', items)[0].key, 'dataset:training_history', 'Indonesian questions too')
    assert.equal(rankCatalog('data karyawan', items)[0].key, 'dataset:employees')
    assert.deepEqual(rankCatalog('the of where', items), [])
    assert.deepEqual(checkCatalogAnswer({ results: [{ key: 'dataset:employees', columns: ['org_code', 'salary'], reason: 'x' }] }, items)[0].columns, ['org_code'], 'invented columns are dropped')
    assert.throws(() => checkCatalogAnswer({ results: [{ key: 'dataset:payroll' }] }, items), /Unknown item/)
  })

  await test('i18n: both languages, plurals, fallbacks; landing and settings URLs', () => {
    const leaves = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [p + k] : leaves(v, `${p}${k}.`)))
    assert.deepEqual(leaves(MESSAGES.id).sort(), leaves(MESSAGES.en).sort(), 'Indonesian has every English key')
    const en = createTranslator('en')
    assert.equal(en('sources.summary', { count: 1 }), '1 source')
    assert.equal(en('sources.summary', { count: 4 }), '4 sources')
    assert.equal(en('quality.dismissTitle', { count: '1,200' }), 'Dismiss 1,200 rows?')
    assert.equal(en('pipelines.runFor', { name: 'SAP' }), 'Run SAP now')
    assert.equal(createTranslator('id')('nav.pipelines'), 'Pipeline')
    assert.equal(localizeStepTitle('Validate (16 rules)', createTranslator('en')), 'Validate (16 rules)')
    assert.notEqual(localizeStepTitle('Validate (16 rules)', createTranslator('id')), 'Validate (16 rules)', 'step titles from the server are translated')
    assert.equal(localizeStepTitle('Something else', createTranslator('id')), 'Something else')
    assert.equal(landingSection('steward'), 'quality')
    assert.equal(landingSection('admin'), 'overview')
    assert.equal(settingsHref('general'), '/dashboard/settings')
    assert.equal(settingsHref('audit'), '/dashboard/settings/audit')
  })

  await test('DS-12 intranet APIs: private addresses refused from the cloud, allowed in an agent; agent requests stay under the base URL; signed requests', async () => {
    const saved = { dev: process.env.NEXUS_ALLOW_PRIVATE_URLS, self: process.env.NEXUS_PRIVATE_NETWORK_ACCESS }
    delete process.env.NEXUS_ALLOW_PRIVATE_URLS
    delete process.env.NEXUS_PRIVATE_NETWORK_ACCESS
    try {
      for (const url of ['http://10.1.2.3/api', 'http://192.168.0.5:8080/x', 'http://127.0.0.1/', 'http://169.254.169.254/latest', 'http://hr-api/', 'https://hr.corp.local/api', 'http://[::1]/']) {
        await assert.rejects(() => assertConnectorUrl(url), /private network|Nexus Agent/, url)
      }
      assert.equal((await assertConnectorUrl('http://8.8.8.8/api')).hostname, '8.8.8.8', 'public addresses are fine (http allowed for connectors)')
      await assert.rejects(() => assertConnectorUrl('ftp://8.8.8.8/x'), /http/)
      await assert.rejects(() => assertConnectorUrl('http://8.8.8.8/x', { httpsOnly: true }), /https/)
      // Inside the agent (or a self-hosted Nexus) the same addresses are reachable.
      assert.equal((await withPrivateNetworkAccess(() => assertConnectorUrl('http://10.1.2.3/api', { httpsOnly: true }))).hostname, '10.1.2.3')
      process.env.NEXUS_PRIVATE_NETWORK_ACCESS = 'true'
      assert.equal((await assertConnectorUrl('http://hr-api/')).hostname, 'hr-api')
      delete process.env.NEXUS_PRIVATE_NETWORK_ACCESS
      // The REST client refuses before sending anything.
      const preview = await previewRestRequest(parseRestConfig({ baseUrl: 'http://10.0.0.8', resourcePath: '/employees' }))
      assert.equal(preview.ok, false)
      assert.match(preview.message, /private network/)
    } finally {
      if (saved.dev === undefined) delete process.env.NEXUS_ALLOW_PRIVATE_URLS
      else process.env.NEXUS_ALLOW_PRIVATE_URLS = saved.dev
      if (saved.self === undefined) delete process.env.NEXUS_PRIVATE_NETWORK_ACCESS
      else process.env.NEXUS_PRIVATE_NETWORK_ACCESS = saved.self
    }
    assert.ok(isInternalHostName('hr-api') && isInternalHostName('erp.corp') && isInternalHostName('x.internal') && !isInternalHostName('api.kmplus.co.id'))
    assert.ok(isPrivateAddress('10.0.0.1') && isPrivateAddress('fd00::1') && !isPrivateAddress('203.0.113.9'))

    // Agent: Nexus designs the request; the agent's base URL and sign-in always win.
    const local = { baseUrl: 'http://hr-api.corp:8080/hr', authMethod: 'bearer', bearerToken: 'local-secret', resourcePath: '/employees' }
    const design = restRequestDesign({ baseUrl: 'https://evil.example', bearerToken: 'x', resourcePath: '/org', dataPath: 'items', paramsKv: '[]', clientKey: 'k', signingSecret: 's', variablesJson: '{}' })
    assert.deepEqual(design, { resourcePath: '/org', dataPath: 'items', paramsKv: '[]' }, 'never base URL, sign-in, certificates or variables')
    assert.equal(agentRestRequest('postgres', { resourcePath: '/x' }), undefined)
    assert.equal(agentRestRequest('rest', {}), undefined, 'nothing designed: the agent uses its own config')
    const merged = mergeAgentRestRequest(local, { ...design, baseUrl: 'https://evil.example', authMethod: 'none' })
    assert.equal(merged.baseUrl, 'http://hr-api.corp:8080/hr')
    assert.equal(merged.bearerToken, 'local-secret')
    assert.equal(merged.authMethod, 'bearer')
    assert.equal(merged.resourcePath, '/org')
    assert.equal(merged.followRedirects, 'false')
    assert.equal(merged.restrictToBaseUrl, 'http://hr-api.corp:8080/hr')
    assert.deepEqual(mergeAgentRestRequest(local, undefined), local, 'older setups keep working')
    assert.ok(isWithinBaseUrl('http://hr-api.corp:8080/hr/employees?x=1', 'http://hr-api.corp:8080/hr'))
    assert.ok(isWithinBaseUrl('http://hr-api.corp:8080/hr', 'http://hr-api.corp:8080/hr/'))
    for (const bad of ['http://hr-api.corp:8080/hrx', 'http://hr-api.corp:8080/other', 'http://hr-api.corp:9090/hr/a', 'http://evil.example/hr/a', 'http://hr-api.corp:8080/hr/../admin', 'http://u:p@hr-api.corp:8080/hr/a']) {
      assert.ok(!isWithinBaseUrl(new URL(bad).toString(), 'http://hr-api.corp:8080/hr'), bad)
    }
    await withPrivateNetworkAccess(async () => {
      const escaped = await buildRestRequest(parseRestConfig(mergeAgentRestRequest(local, { resourcePath: '/employees/../../admin' }))).then(
        () => 'sent',
        (e: Error) => e.message
      )
      assert.match(escaped, /leaves the API's base URL/)
      const built = await buildRestRequest(parseRestConfig(mergeAgentRestRequest(local, { resourcePath: '/employees' })))
      assert.equal(built.url, 'http://hr-api.corp:8080/hr/employees')
      assert.equal(built.headers.Authorization, 'Bearer local-secret')
    })
    assert.equal(publicEndpoint({ baseUrl: 'https://user:pw@hr.corp/api/v1/?token=abc' }), 'https://hr.corp/api/v1')
    assert.equal(publicEndpoint({ connectionString: 'postgres://x' }), undefined)
    assert.ok(compareVersions('1.1.0', '1.2.0') < 0 && compareVersions('1.10.0', '1.2.0') > 0 && compareVersions('1.2', '1.2.0') === 0)

    // Manual publishing: signed requests a gateway can verify.
    const now = Date.UTC(2026, 9, 13, 3, 0, 0)
    const headers = signRequest('shared-secret', 'POST', 'https://gw.kmplus.test/hr/employees?page=2', '{"a":1}', now)
    const ok = { secret: 'shared-secret', method: 'POST', url: 'https://gw.kmplus.test/hr/employees?page=2', body: '{"a":1}', timestamp: headers['X-Nexus-Timestamp'], signature: headers['X-Nexus-Signature'], now }
    assert.equal(verifyRequestSignature(ok), true)
    assert.equal(verifyRequestSignature({ ...ok, body: '{"a":2}' }), false, 'body changed')
    assert.equal(verifyRequestSignature({ ...ok, url: 'https://gw.kmplus.test/hr/employees?page=3' }), false, 'query changed')
    assert.equal(verifyRequestSignature({ ...ok, secret: 'other' }), false)
    assert.equal(verifyRequestSignature({ ...ok, now: now + 6 * 60_000 }), false, 'older than 5 minutes')
    assert.equal(verifyRequestSignature({ ...ok, signature: null }), false)
  })

  await test('Connectors screen: every connector has a category; search by name, system, format and Indonesian words; SQL Server queries quote and bind', () => {
    for (const c of CONNECTOR_CATALOG) assert.ok((CONNECTOR_GROUPS as readonly string[]).includes(c.group), `${c.slug} has a category`)
    const find = (q: string, extra: (c: (typeof CONNECTOR_CATALOG)[number]) => string[] = () => []) => CONNECTOR_CATALOG.filter((c) => connectorMatches(c, q, extra(c))).map((c) => c.slug)
    assert.deepEqual(find('hris'), ['talenta'])
    assert.deepEqual(find('Mekari'), ['talenta'])
    assert.deepEqual(find('excel'), ['file', 's3', 'azureblob', 'gcs'], 'uploads and cloud storage files')
    assert.deepEqual(find('apm'), ['prometheus', 'elasticsearch', 'datadog', 'newrelic'])
    assert.deepEqual(find('minio'), ['s3'])
    assert.deepEqual(find('vault'), ['vault', 'azurekeyvault'])
    assert.deepEqual(find('rahasia').sort(), ['awssecrets', 'azurekeyvault', 'doppler', 'gcpsecrets', 'vault'])
    assert.deepEqual(find('active dir'), ['ldap'])
    assert.deepEqual(find('sql server'), ['sqlserver'])
    assert.deepEqual(find('mssql'), ['sqlserver'])
    assert.deepEqual(find('azure sql'), ['sqlserver'])
    assert.deepEqual(find('erp'), ['sap'])
    assert.deepEqual(find('crm'), ['salesforce'])
    assert.deepEqual(find('lms'), ['kmplus'])
    assert.deepEqual(find('Oracle Connector'), ['oracle'], 'the AI suggestion links here with the connector name')
    assert.deepEqual(find('zzz'), [])
    assert.equal(find('').length, CONNECTOR_CATALOG.length)
    assert.ok(!find('ad').includes('file'), 'word starts, not substrings ("upload" does not match "ad")')
    const databases = CONNECTOR_CATALOG.filter((c) => c.group === 'databases').map((c) => c.slug).sort()
    assert.deepEqual(find('basis data').sort(), databases, 'Indonesian keywords')
    assert.deepEqual(find('Database'), find('database'))
    assert.ok(find('pangkalan', () => ['Pangkalan data']).length === CONNECTOR_CATALOG.length, 'translated text passed by the screen is searched too')
    assert.equal(normalizeSearch('  Ëxcel / CSV! '), 'excel / csv')
    const grouped = groupConnectors(CONNECTOR_CATALOG)
    assert.deepEqual(grouped.map((g) => g.group), ['applications', 'kmplus', 'databases', 'apis', 'files', 'infrastructure', 'identity', 'secrets'])
    assert.equal(grouped.reduce((n, g) => n + g.items.length, 0), CONNECTOR_CATALOG.length)
    assert.ok(isConnectorGroup('databases') && !isConnectorGroup('nope'))

    // SQL Server: identifiers bracket-quoted, values bound, stable order for chunked reads.
    assert.equal(msIdent('Employees'), '[Employees]')
    assert.equal(msIdent('a]b; DROP TABLE x--'), '[a]]b; DROP TABLE x--]')
    assert.equal(
      sqlServerChunkQuery({ schema: 'hr', table: 'Employees', orderBy: ['EmpID'], afterWatermark: false }),
      'SELECT * FROM [hr].[Employees] ORDER BY [EmpID] OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY'
    )
    assert.equal(
      sqlServerChunkQuery({ schema: 'dbo', table: 'Emp', orderBy: ['EmpID', 'UpdatedAt'], watermarkColumn: 'UpdatedAt', afterWatermark: true }),
      'SELECT * FROM [dbo].[Emp] WHERE [UpdatedAt] > @after ORDER BY [UpdatedAt], [EmpID] OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY'
    )
    assert.match(sqlServerChunkQuery({ schema: 'dbo', table: 'v_people', orderBy: [], afterWatermark: false }), /ORDER BY \(SELECT NULL\)/, 'views and heaps have no key')
    assert.equal(sqlServerLiveQuery({ schema: 'dbo', table: 'Emp', filterColumns: ['Dept', 'Status'] }), 'SELECT TOP (@take) * FROM [dbo].[Emp] WHERE CAST([Dept] AS nvarchar(max)) = @f0 AND CAST([Status] AS nvarchar(max)) = @f1')
    assert.equal(sqlServerColumnType('datetime2'), 'timestamp')
    assert.equal(sqlServerColumnType('BIGINT'), 'integer')
    assert.equal(sqlServerColumnType('money'), 'numeric')
    assert.equal(sqlServerColumnType('bit'), 'boolean')
    assert.equal(sqlServerColumnType('date'), 'date')
    assert.equal(sqlServerColumnType('nvarchar'), null)
    const cfg = sqlServerConfig({ host: 'sql01', database: 'HRIS', username: 'nexus', password: 'x' })
    assert.equal(cfg.port, 1433)
    assert.equal(cfg.options?.encrypt, true, 'encrypted by default')
    assert.equal(cfg.options?.trustServerCertificate, false, 'certificates verified by default')
    const named = sqlServerConfig({ host: 'sql01', database: 'HRIS', username: 'nexus', instance: 'SQLEXPRESS', encrypt: 'false', trustServerCertificate: 'true' })
    assert.equal(named.port, undefined, 'a named instance is found through SQL Browser')
    assert.equal(named.options?.instanceName, 'SQLEXPRESS')
    assert.equal(named.options?.encrypt, false)
    assert.throws(() => sqlServerConfig({ host: 'sql01' }), /host, database and username/)
    assert.equal(sqlServerSchema({}), 'dbo')
    assert.equal(detectConnectors('Login failed for user \'nexus\'. (Microsoft SQL Server, Error: 18456)', CONNECTOR_CATALOG.map((c) => ({ slug: c.slug, name: c.name, category: c.category, description: c.description })))[0]?.slug, 'sqlserver')
  })

  await test('Infrastructure & secrets: Signature V4 matches AWS, secret references, file tables, PromQL rows, named queries', () => {
    // AWS's published Signature Version 4 example (IAM ListUsers, 2015-08-30).
    const signed = signAwsRequest({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      region: 'us-east-1',
      service: 'iam',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      now: new Date('2015-08-30T12:36:00Z'),
    })
    assert.match(signed.Authorization, /Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7$/)
    assert.equal(rfc3986("a b!*'()~"), 'a%20b%21%2A%27%28%29~')

    // Secret references: whole values or parts of one; never matched across braces.
    const refs = findSecretRefs('postgres://nexus:{{secret:Vault prod:hr/db#password}}@db.corp:5432/hr?x={{ secret: AWS : prod/api }}')
    assert.deepEqual(refs.map((r) => [r.source, r.path, r.field]), [['Vault prod', 'hr/db', 'password'], ['AWS', 'prod/api', undefined]])
    assert.equal(secretRef('Vault prod', 'hr/db', 'password'), '{{secret:Vault prod:hr/db#password}}')
    assert.ok(hasSecretRefs({ a: 'x', b: '{{secret:V:p}}' }) && !hasSecretRefs({ a: '{{name}}' }))
    assert.equal(secretField('plain', undefined, 'x'), 'plain')
    assert.equal(secretField('{"password":"p"}', 'password', 'x'), 'p')
    assert.equal(secretField({ password: 'p' }, undefined, 'x'), 'p', 'a single field needs no #field')
    assert.throws(() => secretField({ user: 'u', password: 'p' }, undefined, 'x'), /several fields/)
    assert.throws(() => secretField({ password: 'p' }, 'token', 'x'), /no field "token"/)
    assert.ok(isSecretManager('vault') && !isSecretManager('s3'))
    assert.deepEqual(CONNECTOR_CATALOG.filter((c) => c.group === 'secrets').map((c) => c.slug).sort(), [...SECRET_MANAGER_SLUGS].sort(), 'every secrets manager is in the Secrets managers category')

    // Cloud storage: files and folders of one format become tables.
    const objects = [
      { key: 'exports/daily/e_1.csv', size: 10, modified: '2026-10-01' },
      { key: 'exports/daily/e_2.csv', size: 10, modified: '2026-10-02' },
      { key: 'exports/orgs.xlsx', size: 10, modified: null },
      { key: 'exports/notes.txt', size: 10, modified: null },
      { key: 'exports/daily/', size: 0, modified: null },
    ]
    const tables = fileTables(objects, 'exports/')
    assert.deepEqual(tables.map((x) => x.name), ['daily/*.csv', 'daily/e_1.csv', 'daily/e_2.csv', 'orgs.xlsx'])
    assert.deepEqual(tables[0].keys, ['exports/daily/e_1.csv', 'exports/daily/e_2.csv'])
    assert.equal(tables[0].modified, '2026-10-02')
    assert.equal(normalizePrefix('/exports'), 'exports/')
    assert.equal(xmlText('<a><Key>x &amp; y</Key></a>', 'Key'), 'x & y')

    // Observability: PromQL results as rows; "name = query" lists.
    assert.deepEqual(promResultRows({ resultType: 'vector', result: [{ metric: { job: 'hr' }, value: [1791900000, '0.5'] }] }), [{ job: 'hr', value: 0.5, timestamp: '2026-10-13T14:00:00.000Z' }])
    assert.equal(promResultRows({ resultType: 'matrix', result: [{ metric: { job: 'hr' }, values: [[1, '1'], [2, '2']] }] }).length, 2)
    assert.deepEqual(parseNamedQueries('Api Latency = histogram_quantile(0.95, x) ;; errors=sum(rate(e[5m]))\nbad line'), [
      { name: 'api_latency', query: 'histogram_quantile(0.95, x)' },
      { name: 'errors', query: 'sum(rate(e[5m]))' },
    ])
    assert.deepEqual(mappingColumns({ properties: { '@timestamp': { type: 'date' }, http: { properties: { status: { type: 'long' } } } } }).map((c) => c.name), ['@timestamp', 'http.status'])
    assert.deepEqual(flattenRow({ labels: { job: 'hr' }, tags: ['a', 'b'] }), { 'labels.job': 'hr', tags: 'a, b' })
  })

  await test('Guide me + Help: tour steps open real screens with real markers; EN and ID guides match; screenshots exist', () => {
    // Tour: unique ids, every route is a screen, stages in workflow order, every marker present in the UI code.
    assert.equal(new Set(TOUR_STEPS.map((s) => s.id)).size, TOUR_STEPS.length)
    const routes = new Set(SECTIONS.map(sectionHref))
    const stageOrder = TOUR_STEPS.map((s) => TOUR_STAGES.indexOf(s.stage))
    assert.deepEqual(stageOrder, [...stageOrder].sort((a, b) => a - b), 'tour stages go forward')
    const ui = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? ui(`${dir}/${e.name}`) : e.name.endsWith('.tsx') ? [readGuideFile(`${dir}/${e.name}`, 'utf8')] : []))
    const code = ui('components').join('\n')
    const en = HELP_CONTENT.en
    for (const step of TOUR_STEPS) {
      assert.ok(routes.has(step.route), `tour route ${step.route}`)
      if (step.target) assert.ok(code.includes(`data-tour="${step.target}"`), `marker ${step.target}`)
      assert.ok(step.doc === 'faq' || en.chapters.some((c) => c.id === step.doc), `tour doc ${step.doc}`)
      for (const locale of ['en', 'id'] as const) {
        const t = createTranslator(locale)
        for (const k of ['title', 'body'] as const) {
          const key = `tour.steps.${step.id}.${k}` as Parameters<typeof t>[0]
          assert.notEqual(t(key), key, `${locale} ${key}`)
        }
      }
    }

    // The two guides have the same chapters, sections, blocks, FAQs and diagram labels.
    const shape = (c: typeof en) => ({
      chapters: c.chapters.map((ch) => ({ id: ch.id, screen: ch.screen, sections: ch.sections.map((s) => ({ id: s.id, blocks: s.blocks.map((b) => (b.kind === 'shot' ? `shot:${b.screen}` : b.kind === 'diagram' ? `diagram:${b.diagram}` : b.kind === 'table' ? `table:${b.rows.length}x${b.head.length}` : 'items' in b ? `${b.kind}:${b.items.length}` : b.kind)) })) })),
      faqs: c.faqs.map((f) => `${f.group}/${f.id}`),
      groups: c.faqGroups.map((g) => g.id),
      steps: c.diagrams.pipeline.steps.length,
      stages: c.diagrams.workflow.stages.length,
      envStages: c.diagrams.environments.stages.length,
      permissions: Object.keys(c.diagrams.roles.permissions).sort(),
    })
    assert.deepEqual(shape(HELP_CONTENT.id), shape(en))
    assert.deepEqual(Object.keys(en.diagrams.roles.permissions).sort(), [...PERMISSIONS].sort())
    const ids = en.chapters.flatMap((c) => [c.id, ...c.sections.map((s) => `${c.id}-${s.id}`)])
    assert.equal(new Set(ids).size, ids.length, 'unique anchors')
    for (const f of en.faqs) assert.ok(en.faqGroups.some((g) => g.id === f.group), `faq group ${f.group}`)

    // Every screenshot the guide shows exists for both languages and themes.
    for (const c of Object.values(HELP_CONTENT))
      for (const b of c.chapters.flatMap((ch) => ch.sections.flatMap((s) => s.blocks))) if (b.kind === 'shot') assert.ok(b.screen in HELP_SCREENS)
    for (const screen of Object.keys(HELP_SCREENS))
      for (const lang of ['en', 'id'])
        for (const suffix of ['', '-dark']) readGuideFile(`public/help/screens/${lang}/${screen}${suffix}.webp`)

    // Search: every word, any order, case and accents ignored, markup ignored.
    assert.ok(matchesQuery('Install a **Nexus Agent** on a server', 'agent nexus'))
    assert.ok(matchesQuery('Pengelola rahasia', 'RAHASIA'))
    assert.ok(!matchesQuery('Data sources', 'sources agent'))
  })

  await test('REST form: blank rows, URLs containing "auth", header case, masked previews', async () => {
    // Stored key/value lists leave blank rows out (the editor keeps them on screen).
    assert.equal(serializeKeyValueList([{ key: 'Accept', value: 'application/json', enabled: true }, { key: '', value: '', enabled: true }]), '[{"key":"Accept","value":"application/json","enabled":true}]')
    assert.deepEqual(parseKeyValueList(serializeKeyValueList([])).map(({ key, value, enabled }) => ({ key, value, enabled })), [{ key: '', value: '', enabled: true }])

    // A clean base URL that contains "auth" keeps its resource path (and the answer doesn't alternate).
    const clean = { baseUrl: 'https://auth-api.example.com', resourcePath: '/v1/people', authMethod: 'bearer', bearerToken: 'tok' }
    for (let i = 0; i < 3; i++) assert.deepEqual(sanitizeRestCredentials(clean), clean)
    assert.equal(parseRestConfig(clean).resourcePath, '/v1/people')
    // A token stuck in an old saved base URL is still moved out.
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl'
    const fixed = sanitizeRestCredentials({ baseUrl: `https://hr.example.com/v2/people auth: ${jwt}`, resourcePath: '/' })
    assert.equal(fixed.baseUrl, 'https://hr.example.com')
    assert.equal(fixed.resourcePath, '/v2/people')
    assert.equal(fixed.bearerToken, jwt)
    // A pasted bare URL has no token, so the form keeps the sign-in already set.
    assert.equal(parseConnectionPaste('https://api.example.com/v1/people')?.bearerToken, '')

    // Headers are case-insensitive: the sign-in header replaces a typed one; a typed Content-Type wins.
    const built = await buildRestRequest(parseRestConfig({
      baseUrl: 'https://api.example.com',
      resourcePath: '/people',
      httpMethod: 'POST',
      authMethod: 'bearer',
      bearerToken: 'secret-token',
      bodyType: 'json',
      requestBody: '{"a":1}',
      headersKv: JSON.stringify([{ key: 'authorization', value: 'old', enabled: true }, { key: 'content-type', value: 'application/vnd.api+json', enabled: true }]),
    }))
    assert.deepEqual(Object.keys(built.headers).filter((k) => k.toLowerCase() === 'authorization'), ['Authorization'])
    assert.equal(built.headers.Authorization, 'Bearer secret-token')
    assert.deepEqual(Object.entries(built.headers).filter(([k]) => k.toLowerCase() === 'content-type'), [['content-type', 'application/vnd.api+json']])

    // Previews shown in the browser never carry sign-in values.
    const masked = redactRestRequest(
      { method: 'GET', url: 'https://api.example.com/people?key=abc123&unit=retail', headers: { Authorization: 'Bearer secret-token', 'X-Tenant': 'acme', Cookie: 'sid=1' } },
      { authMethod: 'api_key', apiKeyHeader: 'key', apiKeyLocation: 'query', customHeaderName: '' },
    )
    assert.equal(masked.headers.Authorization, 'Bearer ••••')
    assert.equal(masked.headers.Cookie, '••••')
    assert.equal(masked.headers['X-Tenant'], 'acme')
    assert.equal(masked.url, 'https://api.example.com/people?key=••••&unit=retail')
    assert.equal(redactRestRequest({ method: 'GET', url: 'https://x.example.com/', headers: { auth: 'eyJ.token' } }, { authMethod: 'custom_header', apiKeyHeader: '', apiKeyLocation: 'header', customHeaderName: 'auth' }).headers.auth, '••••')
    const failed = await previewRestRequest(parseRestConfig({ baseUrl: '', resourcePath: '/' }))
    assert.equal(failed.ok, false)
  })

  await test('Terms and Conditions: both languages have the same numbered sections; the version is a date', () => {
    assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(!Number.isNaN(Date.parse(TERMS_VERSION)))
    const shape = (d: (typeof TERMS)['en']) => d.sections.map((s) => `${s.id}:${s.body.length}:${s.items?.length ?? 0}:${s.title.split('.')[0]}`)
    assert.deepEqual(shape(TERMS.id), shape(TERMS.en))
    assert.equal(new Set(TERMS.en.sections.map((s) => s.id)).size, TERMS.en.sections.length)
    TERMS.en.sections.forEach((s, i) => assert.ok(s.title.startsWith(`${i + 1}. `), s.title))
    for (const d of Object.values(TERMS)) for (const s of d.sections) for (const text of [...s.body, ...(s.items ?? [])]) assert.equal((text.match(/\*\*/g) ?? []).length % 2, 0, `unbalanced ** in ${s.id}`)
  })

  await test('password reset emails: one-time link, 2FA reminder, change notice in WIB, both languages', () => {
    const url = 'https://nexus.example.com/api/auth/reset-password/abc123?callbackURL=%2Freset-password'
    for (const locale of ['en', 'id'] as const) {
      const reset = render({ to: 'a@b.test', ...resetPasswordEmail({ name: 'Dewi', url, locale }) })
      assert.ok(reset.html.includes(url.replace(/&/g, '&amp;')) && reset.text.includes(url), `${locale}: link in both parts`)
      assert.ok(reset.text.includes(locale === 'en' ? 'authenticator code' : 'kode autentikator'))
      assert.ok(reset.text.includes(locale === 'en' ? '1 hour' : '1 jam'))
      const changed = passwordChangedEmail({ name: 'Dewi', changedAt: new Date('2026-10-15T03:30:00Z'), locale })
      const out = render({ to: 'a@b.test', ...changed })
      assert.match(out.text, /10[:.]30/, `${locale}: time shown in WIB`)
      assert.ok(out.text.includes('/forgot-password'))
      assert.notEqual(changed.subject, resetPasswordEmail({ name: 'x', url, locale }).subject)
    }
  })

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`)
}

void main()
