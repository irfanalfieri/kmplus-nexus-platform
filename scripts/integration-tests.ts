/**
 * Integration tests (TD-9): server actions, permissions, workspace isolation,
 * audit and the background worker, against a real Postgres. Server actions run
 * outside Next.js with stubbed session/cookies (scripts/test/stubs.ts).
 *
 *   node --env-file=.env.local scripts/run-ts.mjs --stubs scripts/integration-tests.ts
 *
 * Needs DATABASE_URL (migrated with scripts/db-migrate.mjs) and NEXUS_ENCRYPTION_KEY.
 * Refuses to run unless the database is nexus_dev or nexus_test. Everything it
 * creates is tagged with a run id and removed at the end.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, like } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { apiKeys, apiRateLimits, auditLogs, businessRuleVersions, businessRules, catalogEntries, connectorInstalls, dashboards, dataSources, datasetPolicies, datasetQualitySnapshots, domainMappings, mappingTemplates, ssoProvider, webhookDeliveries, webhooks, workspaceSso, executionLogs, nexusDatasets, pipelineJobs, pipelineRunRejects, pipelines, pipelineVersions, session, user, verification, workspaceInvites, workspaceMembers, workspaces } from '@/lib/db/schema'
import { acceptInvite, changeMemberRole, createInvite, getWorkspaceContext, listMembers, resetMemberTwoFactor, switchWorkspace } from '@/lib/actions/workspaces'
import { installConnector } from '@/lib/actions/connectors'
import { createDataSource, deleteDataSource, getDataSources, renameDataSource, setDataSourceRole, testConnection } from '@/lib/actions/data-sources'
import { writeDataset } from '@/lib/pipelines/io'
import { startKmplusMock } from './test/kmplus-mock'
import { cancelPipelineRun, createWebhookTrigger, discardDraft, getBuilderOptions, getDatasetPreview, getRunStatus, listPipelines, listRuns, publishPipeline, retryPipelineRun, runPipelineNow, savePipeline } from '@/lib/actions/pipelines'
import { createSsoProvider, deleteSsoProvider, listSsoProviders, updateSsoProvider, verifySsoDomain } from '@/lib/actions/sso'
import { emailAllowedForProvider, enforcedProviderFor, provisionSsoUser } from '@/lib/auth/sso'
import { createWebhook, deleteWebhook, listWebhooks, testWebhook } from '@/lib/actions/webhooks'
import { deleteMappingTemplate, saveMappingTemplate } from '@/lib/actions/templates'
import { POST as postHook } from '@/app/api/hooks/pipelines/[id]/[token]/route'
import { POST as postRuns } from '@/app/api/v1/pipelines/[id]/runs/route'
import { GET as getRun } from '@/app/api/v1/runs/[id]/route'
import { deleteRule, listRuleVersions, listRules, saveRule, testRule } from '@/lib/actions/rules'
import { approveRows, dismissRows, fixRow, getQualityOverview, listQuarantine, replayRows } from '@/lib/actions/quality'
import { getCatalogSample, getLineage, getQualityHistory, listCatalog, saveCatalogEntry, saveDomainMapping } from '@/lib/actions/catalog'
import { createApiKey, revokeApiKey } from '@/lib/actions/api-keys'
import { uploadFilePart } from '@/lib/actions/files'
import { GET as getDataset } from '@/app/api/v1/datasets/[name]/route'
import { GET as getDomain } from '@/app/api/v1/domains/[entity]/route'
import { eraseRecords, findErasureMatches, getGovernanceOverview, saveDatasetPolicy } from '@/lib/actions/governance'
import { getDashboardData, listDashboards, previewWidget, saveDashboard } from '@/lib/actions/analytics'
import { listAuditLogs } from '@/lib/actions/audit'
import { processJobs, CHUNK_ROWS } from '@/lib/pipelines/jobs'
import { setTestUser, takeAfterCallbacks, type TestUser } from './test/stubs'

const RUN = `it${Date.now().toString(36)}`
const FIXTURE_SCHEMA = `${RUN}_fixture`
const ROWS = 12_345
let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (err) {
    failed++
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? err.stack?.split('\n').slice(0, 3).join('\n      ') : err}`)
  }
}

const rejectsWith = async (fn: () => Promise<unknown>, pattern: RegExp) => {
  await assert.rejects(fn, (err: Error) => pattern.test(err.message), `expected error matching ${pattern}`)
}

function newUser(label: string): TestUser {
  return { id: `${RUN}_${label}_${randomUUID().slice(0, 8)}`, email: `${RUN}-${label}@nexus.test`, name: `${label} ${RUN}`, twoFactorEnabled: true }
}

async function main() {
  const { rows: dbRows } = await pool.query<{ db: string }>('select current_database() as db')
  if (!['nexus_dev', 'nexus_test'].includes(dbRows[0].db)) {
    throw new Error(`Refusing to run against database "${dbRows[0].db}". Use nexus_dev or nexus_test.`)
  }
  console.log(`Integration tests on ${dbRows[0].db} (run ${RUN})\n`)

  const admin = newUser('admin')
  const viewer = newUser('viewer')
  const outsider = newUser('outsider')
  await db.insert(user).values([admin, viewer, outsider].map((u) => ({ id: u.id, email: u.email, name: u.name, emailVerified: true, twoFactorEnabled: true })))

  let adminWs = ''
  let sourceId = ''
  let pipelineId = ''

  try {
    await test('new account gets a personal workspace as admin', async () => {
      setTestUser(admin)
      const ctx = await getWorkspaceContext()
      assert.equal(ctx.role, 'admin')
      assert.equal(ctx.workspace.id, `ws_${admin.id}`)
      adminWs = ctx.workspace.id
    })

    await test('accounts without 2FA are rejected by every action', async () => {
      setTestUser({ ...outsider, twoFactorEnabled: false })
      await rejectsWith(() => getWorkspaceContext(), /two-factor/)
    })

    await test('invite is bound to its email; accepted invite grants the role', async () => {
      setTestUser(admin)
      const invite = await createInvite(viewer.email, 'viewer')
      const token = invite.path.split('/').pop()!
      setTestUser(outsider)
      await rejectsWith(() => acceptInvite(token), /This invite is for/)
      setTestUser(viewer)
      await acceptInvite(token)
      await switchWorkspace(adminWs)
      const ctx = await getWorkspaceContext()
      assert.equal(ctx.workspace.id, adminWs)
      assert.equal(ctx.role, 'viewer')
      await rejectsWith(() => acceptInvite(token), /invalid, expired, revoked or already used/)
    })

    await test('fixture source table and data source (credentials never returned)', async () => {
      await pool.query(`CREATE SCHEMA "${FIXTURE_SCHEMA}"`)
      await pool.query(`CREATE TABLE "${FIXTURE_SCHEMA}".employees (id int PRIMARY KEY, code text, email text, updated_at timestamptz)`)
      // Duplicate codes straddle the chunk boundary; every 1000th email is invalid.
      await pool.query(
        `INSERT INTO "${FIXTURE_SCHEMA}".employees
         SELECT g, CASE WHEN g = $2 THEN 'E00010' ELSE 'E' || lpad(g::text, 5, '0') END,
                CASE WHEN g % 1000 = 0 THEN 'broken' ELSE 'emp' || g || '@kmplus.test' END,
                timestamptz '2026-01-01' + g * interval '1 minute'
         FROM generate_series(1, $1) g`,
        [ROWS, CHUNK_ROWS + 3]
      )
      setTestUser(admin)
      await installConnector('postgres')
      sourceId = await createDataSource({
        name: `${RUN} fixture`,
        type: 'database',
        sourceType: 'postgres',
        config: { role: 'source' },
        credentials: { connectionString: process.env.DATABASE_URL!, schema: FIXTURE_SCHEMA },
      })
      const listed = await getDataSources()
      const mine = listed.find((s) => s.id === sourceId)
      assert.ok(mine, 'source listed')
      assert.equal('credentials' in mine!, false, 'credentials are never sent to the client')
      const [stored] = await db.select({ credentials: dataSources.credentials }).from(dataSources).where(eq(dataSources.id, sourceId))
      assert.equal((stored.credentials as { __enc?: string }).__enc, 'v2', 'stored encrypted with the workspace key')
      assert.ok(!JSON.stringify(stored.credentials).includes(FIXTURE_SCHEMA), 'no plaintext in the stored envelope')
    })

    await test('viewer can read but not change anything', async () => {
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      assert.ok((await listPipelines()).length >= 0)
      await rejectsWith(() => setDataSourceRole(sourceId, 'destination'), /Your role \(Viewer\) can't do this/)
      await rejectsWith(() => savePipeline({ name: 'x', definition: {}, schedule: { type: 'manual' } as never }), /Your role \(Viewer\)/)
      await rejectsWith(() => listAuditLogs(), /Your role \(Viewer\)/)
    })

    await test('pipeline save + chunked background run resumes across invocations', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const saved = await savePipeline({
        publish: true,
        name: `${RUN} employees`,
        definition: {
          steps: [
            { id: 's', type: 'source', dataSourceId: sourceId, table: 'employees', maxRows: 100_000 },
            { id: 'v', type: 'validate', rules: [{ field: 'email', rule: 'email' }, { field: 'code', rule: 'unique' }] },
            { id: 'd', type: 'destination', kind: 'dataset', datasetName: `${RUN}_employees`, mode: 'replace' },
          ],
          settings: { retries: 0 },
        },
        schedule: { type: 'manual' } as never,
      })
      pipelineId = saved.id

      const run = await runPipelineNow(pipelineId)
      assert.equal(run.status, 'queued')
      assert.equal(takeAfterCallbacks().length, 1, 'Run now starts a worker after the response')
      const again = await runPipelineNow(pipelineId)
      assert.equal(again.status, 'skipped', 'no overlapping runs')

      // One chunk per "invocation": the job pauses and resumes from its checkpoint.
      await processJobs({ maxChunksPerSlice: 1, maxJobs: 1 })
      const [paused] = await db.select().from(pipelineJobs).where(eq(pipelineJobs.id, run.runId))
      assert.equal(paused.status, 'queued', 'released between invocations')
      assert.equal((paused.progress as { offset: number }).offset, CHUNK_ROWS)
      const mid = await getRunStatus(run.runId)
      assert.equal(mid.status, 'running')
      assert.equal(mid.recordsProcessed, CHUNK_ROWS)
      assert.equal(takeAfterCallbacks().length, 1, 'polling a waiting run restarts the worker')

      for (let i = 0; i < 10; i++) {
        const [job] = await db.select({ status: pipelineJobs.status }).from(pipelineJobs).where(eq(pipelineJobs.id, run.runId))
        if (job.status === 'done') break
        await processJobs({ maxChunksPerSlice: 1, maxJobs: 1 })
      }
      const done = await getRunStatus(run.runId)
      const invalidEmails = Math.floor(ROWS / 1000)
      assert.equal(done.status, 'partial', done.errorMessage ?? '')
      assert.equal(done.recordsProcessed, ROWS)
      assert.equal(done.recordsError, invalidEmails + 1, 'invalid emails + one duplicate code across chunks')
      assert.equal(done.recordsSuccess, ROWS - invalidEmails - 1)

      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_employees`)))
      assert.equal(ds.rowCount, ROWS - invalidEmails - 1)
      const rejects = await db.select({ id: pipelineRunRejects.id }).from(pipelineRunRejects).where(eq(pipelineRunRejects.runId, run.runId))
      assert.equal(rejects.length, invalidEmails + 1)
      const [log] = await db.select({ details: executionLogs.executionDetails }).from(executionLogs).where(eq(executionLogs.id, run.runId))
      assert.equal((log.details as { chunks: number }).chunks, Math.ceil(ROWS / CHUNK_ROWS))
    })

    await test('replace run swaps in a fresh copy (no doubling, no staging left)', async () => {
      setTestUser(admin)
      const run = await runPipelineNow(pipelineId)
      takeAfterCallbacks()
      await processJobs({})
      const done = await getRunStatus(run.runId)
      assert.equal(done.status, 'partial')
      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_employees`)))
      const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "nexus_data"."${ds.tableName}"`)
      assert.equal(rows[0].n, ROWS - Math.floor(ROWS / 1000) - 1)
      const staging = await pool.query(`SELECT 1 FROM pg_tables WHERE schemaname = 'nexus_data' AND tablename LIKE $1`, [`${ds.tableName.slice(0, 44)}__stg_%`])
      assert.equal(staging.rowCount, 0)
    })

    await test('configuration errors fail the run without retrying', async () => {
      setTestUser(admin)
      await pool.query(`ALTER TABLE "${FIXTURE_SCHEMA}".employees RENAME TO employees_gone`)
      const run = await runPipelineNow(pipelineId)
      takeAfterCallbacks()
      await processJobs({})
      const done = await getRunStatus(run.runId)
      assert.equal(done.status, 'failed')
      assert.match(done.errorMessage ?? '', /employees/)
      const [job] = await db.select().from(pipelineJobs).where(eq(pipelineJobs.id, run.runId))
      assert.equal(job.status, 'done')
      // The previous dataset is untouched by the failed replace run.
      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_employees`)))
      const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "nexus_data"."${ds.tableName}"`)
      assert.equal(rows[0].n, ROWS - Math.floor(ROWS / 1000) - 1)
    })

    await test('other workspaces cannot see this one', async () => {
      setTestUser(outsider)
      const ctx = await getWorkspaceContext()
      assert.notEqual(ctx.workspace.id, adminWs)
      await rejectsWith(() => switchWorkspace(adminWs), /not a member/)
      await rejectsWith(() => listRuns(pipelineId), /not found/i)
      assert.equal((await listPipelines()).some((p) => p.id === pipelineId), false)
      assert.equal((await getDataSources()).some((s) => s.id === sourceId), false)
    })

    await test('audit log records actions with IP and user agent', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const { rows } = await listAuditLogs()
      const actions = new Set(rows.map((r) => r.action))
      for (const a of ['INVITE', 'ACCEPT_INVITE', 'INSTALL', 'CREATE', 'RUN']) assert.ok(actions.has(a), `missing ${a}`)
      assert.ok(rows.every((r) => r.ipAddress === '203.0.113.7' || r.action === 'RUN'), 'IP captured from the request')
      const filtered = await listAuditLogs({ action: 'RUN' })
      assert.ok(filtered.rows.length >= 3 && filtered.rows.every((r) => r.action === 'RUN'))
    })

    const DATASET = `${RUN}_employees`
    const KEPT = ROWS - Math.floor(ROWS / 1000) - 1

    await test('dataset policies mask values for roles without data:unmasked', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await saveDatasetPolicy({
        datasetName: DATASET,
        columns: { email: { classification: 'personal', mask: 'partial' }, code: { classification: 'personal', mask: 'hash' }, not_a_column: { classification: 'public', mask: 'full' } },
        retentionDays: null,
      })
      await changeMemberRole(viewer.id, 'analyst')
      const adminView = await getDatasetPreview(DATASET)
      assert.ok(adminView.rows.every((r) => String(r.email).includes('@kmplus.test') || r.email === 'broken'), 'admins see real values')
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      const analystView = await getDatasetPreview(DATASET)
      assert.deepEqual(analystView.masked.sort(), ['code', 'email'])
      assert.ok(analystView.rows.every((r) => String(r.email).startsWith('••••') && !String(r.code).startsWith('E')), 'analysts see masked values')
      await rejectsWith(() => saveDatasetPolicy({ datasetName: DATASET, columns: {}, retentionDays: null }), /Your role \(Analyst\)/)
      setTestUser(admin)
      const overview = await getGovernanceOverview()
      assert.equal(overview.controls.datasetsWithPolicy, 1)
      assert.equal(overview.controls.maskedColumns, 2, 'unknown columns are dropped from the policy')
    })

    await test('analytics: dashboards run widgets; masked columns are blocked for analysts', async () => {
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      const base = { dataset: DATASET, filters: [] as { column: string; op: 'lte'; value: string }[], sort: 'value_desc' as const, limit: 5, size: 'small' as const, title: '' }
      const { id } = await saveDashboard({
        name: `${RUN} people`,
        widgets: [
          { ...base, id: 'kpi', type: 'kpi', measure: { agg: 'count', column: '' } },
          { ...base, id: 'by-email', type: 'bar', measure: { agg: 'count', column: '' }, dimension: { column: 'email', grain: 'none' } },
          { ...base, id: 'by-month', type: 'line', measure: { agg: 'count', column: '' }, dimension: { column: 'updated_at', grain: 'month' }, filters: [{ column: 'id', op: 'lte', value: '1000' }] },
        ],
      })
      const asAnalyst = await getDashboardData(id)
      const kpi = asAnalyst.results.kpi
      assert.ok(kpi.ok && kpi.result.rows[0].value === KEPT, 'KPI counts the dataset')
      const byEmail = asAnalyst.results['by-email']
      assert.ok(!byEmail.ok && /masked by a dataset policy/.test(byEmail.message), 'masked column blocked for analysts')
      const byMonth = asAnalyst.results['by-month']
      assert.ok(byMonth.ok && byMonth.result.rows.reduce((s, r) => s + (r.value ?? 0), 0) === 999, 'filtered time series (1000 rows minus the invalid email)')
      setTestUser(admin)
      const asAdmin = await getDashboardData(id)
      const adminEmail = asAdmin.results['by-email']
      assert.ok(adminEmail.ok && adminEmail.result.rows.length === 5 && adminEmail.result.truncated, 'admins can group by the column')
      const preview = await previewWidget({ ...base, id: 'p', type: 'bar', measure: { agg: 'sum', column: 'email' }, dimension: { column: 'code', grain: 'none' } })
      assert.ok(!preview.ok && /needs a number column/.test(preview.message))
      assert.equal((await listDashboards()).dashboards.some((d) => d.id === id), true)
      setTestUser(outsider)
      await rejectsWith(() => getDashboardData(id), /not found/i)
    })

    await test('right to erasure deletes one person everywhere (admins only)', async () => {
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      await rejectsWith(() => findErasureMatches({ column: 'code', value: 'E00001' }), /Your role/)
      setTestUser(admin)
      await switchWorkspace(adminWs)
      assert.deepEqual(await findErasureMatches({ column: 'code', value: 'E00001' }), [{ dataset: DATASET, matches: 1 }])
      const res = await eraseRecords({ column: 'code', value: 'E00001' })
      assert.equal(res.total, 1)
      assert.deepEqual(await findErasureMatches({ column: 'code', value: 'E00001' }), [{ dataset: DATASET, matches: 0 }])
      const [entry] = await db.select({ changes: auditLogs.changes }).from(auditLogs).where(and(eq(auditLogs.workspaceId, adminWs), eq(auditLogs.resource, 'erasure')))
      assert.ok(entry && !JSON.stringify(entry.changes).includes('E00001') && (entry.changes as { valueSha256: string }).valueSha256.length === 64, 'audit stores a hash, not the value')
    })

    await test('retention deletes rows loaded before the limit', async () => {
      setTestUser(admin)
      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, DATASET)))
      await pool.query(`UPDATE "nexus_data"."${ds.tableName}" SET "_nexus_loaded_at" = now() - interval '40 days' WHERE ctid IN (SELECT ctid FROM "nexus_data"."${ds.tableName}" LIMIT 100)`)
      const res = await saveDatasetPolicy({ datasetName: DATASET, columns: { email: { classification: 'personal', mask: 'partial' } }, retentionDays: 30 })
      assert.equal(res.retentionDeleted, 100)
      const [after] = await db.select({ rowCount: nexusDatasets.rowCount }).from(nexusDatasets).where(eq(nexusDatasets.id, ds.id))
      assert.equal(after.rowCount, (ds.rowCount ?? 0) - 100, 'row count refreshed')
    })

    await test('cancel a queued or running run, then retry it', async () => {
      await pool.query(`ALTER TABLE "${FIXTURE_SCHEMA}".employees_gone RENAME TO employees`)
      setTestUser(admin)
      const queued = await runPipelineNow(pipelineId)
      takeAfterCallbacks()
      assert.equal((await cancelPipelineRun(queued.runId)).status, 'cancelled', 'no worker holds a queued run: closed at once')
      const cancelled = await getRunStatus(queued.runId)
      assert.equal(cancelled.status, 'cancelled')
      assert.equal(cancelled.active, false)
      await rejectsWith(() => cancelPipelineRun(queued.runId), /already finished/)

      // A run a worker holds stops before its next chunk.
      const running = await runPipelineNow(pipelineId)
      takeAfterCallbacks()
      await db.update(pipelineJobs).set({ status: 'running', leaseUntil: new Date(Date.now() + 60_000) }).where(eq(pipelineJobs.id, running.runId))
      assert.equal((await cancelPipelineRun(running.runId)).status, 'cancelling')
      takeAfterCallbacks()
      await db.update(pipelineJobs).set({ leaseUntil: new Date(Date.now() - 1000) }).where(eq(pipelineJobs.id, running.runId))
      await processJobs({ maxJobs: 1 })
      assert.equal((await getRunStatus(running.runId)).status, 'cancelled')

      setTestUser(viewer)
      await switchWorkspace(adminWs)
      await rejectsWith(() => retryPipelineRun(running.runId), /Your role \(Analyst\)/)
      setTestUser(admin)
      const retry = await retryPipelineRun(running.runId)
      assert.equal(retry.status, 'queued')
      takeAfterCallbacks()
      await processJobs({})
      assert.equal((await getRunStatus(retry.runId)).status, 'partial')
    })

    await test('drafts: saving without publishing keeps the published version running', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const current = (await listPipelines()).find((p) => p.id === pipelineId)!
      const published = current.version
      await savePipeline({ id: pipelineId, name: current.name, definition: current.config as never, schedule: { type: 'manual' } as never, changeNote: 'draft only' })
      const afterDraft = (await listPipelines()).find((p) => p.id === pipelineId)!
      assert.equal(afterDraft.version, published, 'published version unchanged')
      assert.ok(afterDraft.draftVersion && afterDraft.draftVersion > published!, 'draft recorded')
      await discardDraft(pipelineId)
      assert.equal((await listPipelines()).find((p) => p.id === pipelineId)!.draftVersion, null)
      const fresh = await savePipeline({
        name: `${RUN} never published`,
        definition: { steps: [{ id: 's', type: 'source', dataSourceId: sourceId, table: 'employees', maxRows: 10 }, { id: 'd', type: 'destination', kind: 'dataset', datasetName: `${RUN}_np`, mode: 'replace' }] },
        schedule: { type: 'manual' } as never,
      })
      await rejectsWith(() => runPipelineNow(fresh.id), /Publish the pipeline/)
      await publishPipeline(fresh.id)
      const run = await runPipelineNow(fresh.id)
      assert.equal(run.status, 'queued')
      takeAfterCallbacks()
      await processJobs({})
      assert.equal((await getRunStatus(run.runId)).status, 'success')
    })

    let ruleId = ''
    let rulePipelineId = ''
    await test('business rules: versions, tester, reuse guard, approval hold → approve → replay', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const body = {
        when: { match: 'all' as const, conditions: [{ field: 'id', operator: 'less_or_equal' as const, value: '5', valueField: '' }], groups: [] },
        then: [{ type: 'require_approval' as const, reason: 'first hires' }, { type: 'set_field' as const, field: 'label', value: 'early {code}' }],
        otherwise: [{ type: 'set_field' as const, field: 'label', value: 'regular' }],
      }
      ruleId = (await saveRule({ name: `${RUN} early hires`, body })).id
      await saveRule({ id: ruleId, name: `${RUN} early hires`, body, changeNote: 'v2' })
      assert.equal((await listRuleVersions(ruleId)).length, 2)
      const tested = await testRule({ body, rows: [{ id: 3, code: 'E3' }, { id: 9, code: 'E9' }] })
      assert.deepEqual(tested.map((t) => [t.matched, t.result, t.output.label]), [[true, 'held for approval', 'early E3'], [false, 'kept', 'regular']])
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      await rejectsWith(() => saveRule({ name: 'x', body }), /Your role/)
      setTestUser(admin)
      await switchWorkspace(adminWs)

      const saved = await savePipeline({
        publish: true,
        name: `${RUN} ruled`,
        definition: {
          schemaVersion: 2,
          nodes: [
            { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'employees', maxRows: 20 },
            { id: 'r', type: 'rules', position: { x: 1, y: 0 }, ruleIds: [ruleId] },
            { id: 'd', type: 'destination', position: { x: 2, y: 0 }, kind: 'dataset', datasetName: `${RUN}_ruled`, mode: 'append' },
          ],
          edges: [{ id: 'e1', from: 's', to: 'r' }, { id: 'e2', from: 'r', to: 'd' }],
          settings: { retries: 0 },
        },
        schedule: { type: 'manual' } as never,
      })
      rulePipelineId = saved.id
      await rejectsWith(() => deleteRule(ruleId), /is used by/)
      assert.equal((await listRules()).find((r) => r.id === ruleId)?.usedBy[0]?.id, rulePipelineId)

      const run = await runPipelineNow(rulePipelineId)
      takeAfterCallbacks()
      await processJobs({})
      const done = await getRunStatus(run.runId)
      assert.equal(done.status, 'partial', 'held rows make the run partial')
      assert.equal(done.recordsSuccess, 15)
      const inbox = await listQuarantine({ pipelineId: rulePipelineId, kind: 'approval' })
      assert.equal(inbox.total, 5)
      await approveRows(inbox.rows.map((r) => r.id))
      const outcomes = await replayRows(inbox.rows.map((r) => r.id))
      assert.equal(outcomes[0].status, 'queued')
      takeAfterCallbacks()
      await processJobs({})
      const replay = await getRunStatus(outcomes[0].runId)
      assert.equal(replay.status, 'success', replay.errorMessage ?? '')
      assert.equal(replay.recordsSuccess, 5, 'approved rows are written by the replay')
      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_ruled`)))
      const { rows } = await pool.query<{ n: number; early: number }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE label LIKE 'early %')::int AS early FROM "nexus_data"."${ds.tableName}"`)
      assert.deepEqual(rows[0], { n: 20, early: 5 })
      assert.equal((await listQuarantine({ pipelineId: rulePipelineId, status: 'replayed' })).total, 5)
    })

    await test('data quality: stewards fix an invalid row and replay it; analysts cannot', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const inbox = await listQuarantine({ pipelineId, kind: 'invalid' })
      const broken = inbox.rows.find((r) => r.row.email === 'broken')!
      assert.ok(broken, 'invalid email quarantined')
      const overview = await getQualityOverview()
      assert.ok(overview.open.invalid >= 1)
      assert.ok(overview.pipelines.some((p) => p.pipelineId === pipelineId && p.score !== null && p.score < 100))
      await fixRow({ id: broken.id, row: { ...broken.row, email: `fixed-${broken.row.id}@kmplus.test` } })
      const [outcome] = await replayRows([broken.id])
      takeAfterCallbacks()
      await processJobs({})
      assert.equal((await getRunStatus(outcome.runId)).recordsSuccess, 1)
      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, DATASET)))
      const { rows } = await pool.query(`SELECT 1 FROM "nexus_data"."${ds.tableName}" WHERE email = $1`, [`fixed-${broken.row.id}@kmplus.test`])
      assert.equal(rows.length, 1, 'fixed row written to the dataset')
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      const masked = await listQuarantine({ pipelineId, kind: 'invalid' })
      assert.ok(masked.rows.every((r) => !r.editable), 'masked rows are not editable')
      await rejectsWith(() => dismissRows([masked.rows[0].id]), /Your role/)
    })

    await test('row-level access: analysts only see rows their filter allows', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await saveDatasetPolicy({ datasetName: DATASET, columns: {}, retentionDays: null, rowFilters: [{ roles: ['analyst'], column: 'id', operator: 'in_list', value: '1, 2, 3' }] })
      await rejectsWith(() => saveDatasetPolicy({ datasetName: DATASET, columns: {}, retentionDays: null, rowFilters: [{ roles: ['analyst'], column: 'nope', operator: 'equals', value: 'x' }] }), /not in dataset/)
      assert.ok((await getDatasetPreview(DATASET)).rows.length > 3, 'admins are not filtered')
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      const preview = await getDatasetPreview(DATASET)
      assert.ok(preview.rows.length <= 3 && preview.rows.every((r) => ['1', '2', '3'].includes(String(r.id))))
      const kpi = await previewWidget({ id: 'k', title: '', dataset: DATASET, type: 'kpi', measure: { agg: 'count', column: '' }, filters: [], sort: 'value_desc', limit: 5, size: 'small' })
      assert.ok(kpi.ok && (kpi.result.rows[0].value ?? 99) <= 3, 'Analytics counts only allowed rows')
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await saveDatasetPolicy({ datasetName: DATASET, columns: { email: { classification: 'personal', mask: 'partial' } }, retentionDays: null, rowFilters: [] })
    })

    await test('catalog: auto-registered items, documentation, live sample, cached copy', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      // Re-test scans the source, which is how its tables reach the catalog.
      await testConnection(sourceId)
      const cat = await listCatalog()
      const dsKey = `dataset:${DATASET}`
      const srcKey = `source:${sourceId}:employees`
      assert.ok(cat.items.some((i) => i.key === dsKey), 'datasets are listed')
      assert.ok(cat.items.some((i) => i.key === srcKey), 'source tables are listed')
      // The UI sends a dataset's own access fields (cached, no alias); they are ignored for datasets.
      await saveCatalogEntry({ key: dsKey, description: 'Employees from the fixture', ownerId: admin.id, tags: ['HR', 'hr'], classification: 'pii', columnDocs: { email: 'Work email' }, accessMode: 'cached', alias: null })
      await rejectsWith(() => saveCatalogEntry({ key: dsKey, ownerId: outsider.id }), /members of this workspace/)
      const item = (await listCatalog()).items.find((i) => i.key === dsKey)!
      assert.deepEqual([item.owner, item.tags, item.classification, item.columns.find((c) => c.name === 'email')?.doc], [admin.email, ['hr'], 'pii', 'Work email'])
      const live = await getCatalogSample(srcKey)
      assert.equal(live.mode, 'live')
      assert.ok(live.rows.length > 0 && live.rows.length <= 20)
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      const masked = await getCatalogSample(srcKey)
      assert.ok(masked.masked.includes('email') && masked.rows.every((r) => String(r.email).startsWith('••••')), 'live samples mask personal columns for analysts')
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await saveCatalogEntry({ key: srcKey, accessMode: 'cached', alias: `${RUN}_cache`, refresh: 'manual' })
      takeAfterCallbacks()
      await processJobs({})
      const cached = (await listCatalog()).items.find((i) => i.key === srcKey)!
      assert.equal(cached.accessMode, 'cached')
      assert.equal(cached.rowCount, ROWS, 'first copy made right away')
      assert.ok(cached.lastLoadedAt, 'freshness shown')
      await rejectsWith(() => saveCatalogEntry({ key: srcKey, accessMode: 'cached', alias: DATASET, refresh: 'manual' }), /written by another pipeline/)
    })

    await test('Data API: scoped keys, pages, filters, masking, entities, revocation', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const { id: keyId, key } = await createApiKey({ name: `${RUN} key`, role: 'analyst', scopes: ['datasets:read', 'domains:read'] })
      const call = async (handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, path: string, params: Record<string, string>, auth = `Bearer ${key}`) => {
        const res = await handler(new Request(`http://localhost${path}`, { headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve(params) })
        return { status: res.status, body: (await res.json()) as { data: Record<string, unknown>[]; next_cursor: string | null; meta: Record<string, unknown>; error?: { message: string } } }
      }
      const p1 = await call(getDataset as never, `/api/v1/datasets/${DATASET}?limit=2&fields=id,email`, { name: DATASET })
      assert.equal(p1.status, 200, p1.body.error?.message)
      assert.equal(p1.body.data.length, 2)
      assert.deepEqual(Object.keys(p1.body.data[0]).sort(), ['email', 'id'])
      assert.ok(p1.body.data.every((r) => String(r.email).startsWith('••••')), 'analyst keys get masked values')
      const p2 = await call(getDataset as never, `/api/v1/datasets/${DATASET}?limit=2&fields=id&cursor=${p1.body.next_cursor}`, { name: DATASET })
      assert.ok(p2.body.data.every((r) => !p1.body.data.some((x) => x.id === r.id)), 'cursor pages do not overlap')
      const one = await call(getDataset as never, `/api/v1/datasets/${DATASET}?filter[code]=E00002`, { name: DATASET })
      assert.deepEqual(one.body.data.map((r) => r.code), ['E00002'])
      assert.equal((await call(getDataset as never, `/api/v1/datasets/${DATASET}?filter[email]=x`, { name: DATASET })).status, 400, 'masked fields cannot be filtered')
      assert.equal((await call(getDataset as never, `/api/v1/datasets/nope`, { name: 'nope' })).status, 404)
      assert.equal((await call(getDataset as never, `/api/v1/datasets/${DATASET}`, { name: DATASET }, '')).status, 401)

      await saveDomainMapping({ entity: 'employee', datasetName: DATASET, fields: { employee_code: 'code', email: 'email' } })
      const people = await call(getDomain as never, `/api/v1/domains/employee?limit=3`, { entity: 'employee' })
      assert.equal(people.status, 200, people.body.error?.message)
      assert.deepEqual(Object.keys(people.body.data[0]).sort(), ['email', 'employee_code'])
      assert.deepEqual(people.body.meta.masked_fields, ['email'])

      await revokeApiKey(keyId)
      assert.equal((await call(getDataset as never, `/api/v1/datasets/${DATASET}`, { name: DATASET })).status, 401, 'revoked keys stop working')
      const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, adminWs), eq(auditLogs.action, 'API_READ')))
      assert.ok(audit.length >= 4, 'API reads are audited')
    })

    await test('file upload source: uploaded sheets become tables pipelines and the catalog read', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await installConnector('file')
      const fileSourceId = await createDataSource({ name: `${RUN} files`, type: 'files', sourceType: 'file', config: { role: 'source' }, credentials: { storageKey: 'someone-elses' } })
      const columns = [{ name: 'employee_code', type: 'text' as const }, { name: 'joined', type: 'date' as const }]
      await uploadFilePart({ dataSourceId: fileSourceId, table: 'org_chart', fileName: 'Org Chart.xlsx', columns, rows: [['E1', '2024-01-02']], part: 0, final: false, mode: 'replace', sent: 1 })
      await uploadFilePart({ dataSourceId: fileSourceId, table: 'org_chart', fileName: 'Org Chart.xlsx', columns, rows: [['E2', null]], part: 1, final: true, mode: 'replace', sent: 2 })
      const src = (await getDataSources()).find((s) => s.id === fileSourceId)!
      const config = src.config as { files: { table: string; rowCount: number }[]; schemaScan: { tables: { name: string; columns: { name: string; type: string }[] }[] } }
      assert.deepEqual(config.files.map((f) => [f.table, f.rowCount]), [['org_chart', 2]])
      assert.equal(config.schemaScan.tables[0].columns.find((c) => c.name === 'joined')?.type, 'date', 'detected types reach pipelines')
      const [stored] = await db.select({ credentials: dataSources.credentials }).from(dataSources).where(eq(dataSources.id, fileSourceId))
      const { decryptCredentials } = await import('@/lib/security/credentials')
      assert.equal(decryptCredentials(fileSourceId, stored.credentials).storageKey, fileSourceId, 'storage key is assigned by the server, not the browser')
      const sample = await getCatalogSample(`source:${fileSourceId}:org_chart`)
      assert.deepEqual(sample.rows.map((r) => r.employee_code), ['E1', 'E2'])
      await rejectsWith(() => uploadFilePart({ dataSourceId: sourceId, table: 'x', fileName: 'x.csv', columns, rows: [], part: 0, final: true, mode: 'replace', sent: 0 }), /File Upload data source/)
      await deleteDataSource(fileSourceId)
      const left = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'nexus_raw' AND table_name LIKE '%org_chart%'`)
      assert.equal(left.rowCount, 0, 'deleting the source drops its uploads')
    })

    await test('SSO: admins register an OIDC provider; sign-in needs a DNS-verified domain; users join with the default role', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await rejectsWith(() => createSsoProvider({ label: 'x', preset: 'google', domain: 'gmail.com', clientId: 'c', clientSecret: 's' }), /public email provider/)
      await rejectsWith(() => createSsoProvider({ label: 'x', preset: 'oidc', issuerValue: 'http://127.0.0.1:8080', domain: `${RUN}.example`, clientId: 'c', clientSecret: 's' }), /https|private|Could not read/)
      const domain = `${RUN}.nexus-sso.test`
      const { providerId } = await createSsoProvider({ label: 'Test Google', preset: 'google', domain, clientId: 'client-id', clientSecret: 'client-secret', defaultRole: 'analyst' })
      const [listed] = await listSsoProviders()
      assert.equal(listed.verified, false)
      assert.match(listed.redirectUri, new RegExp(`/api/auth/sso/callback/${providerId}$`))
      assert.equal(listed.dnsRecord.name, `_nexus-sso.${domain}`)
      await rejectsWith(() => verifySsoDomain(providerId), /TXT record not found/)
      await rejectsWith(() => updateSsoProvider({ providerId, enforce: true }), /Verify the domain before requiring SSO/)
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      await rejectsWith(() => listSsoProviders(), /Your role/)
      // Simulate the DNS proof, then check what the sign-in hooks rely on.
      await db.update(ssoProvider).set({ domainVerified: true }).where(eq(ssoProvider.providerId, providerId))
      assert.equal(await emailAllowedForProvider(providerId, `someone@${domain}`), true)
      assert.equal(await emailAllowedForProvider(providerId, 'someone@other.com'), false, 'SSO cannot create accounts outside the domain')
      const ssoUser = newUser('sso')
      await db.insert(user).values({ id: ssoUser.id, email: `person@${domain}`, name: 'SSO person', emailVerified: false, twoFactorEnabled: false })
      await provisionSsoUser(providerId, { id: ssoUser.id, email: `person@${domain}` })
      const [membership] = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.userId, ssoUser.id), eq(workspaceMembers.workspaceId, adminWs)))
      assert.equal(membership?.role, 'analyst')
      assert.equal((await db.select({ v: user.emailVerified }).from(user).where(eq(user.id, ssoUser.id)))[0].v, true)
      setTestUser(admin)
      await switchWorkspace(adminWs)
      assert.equal(await enforcedProviderFor(`person@${domain}`), null)
      await updateSsoProvider({ providerId, enforce: true })
      assert.equal(await enforcedProviderFor(`PERSON@${domain}`), 'Test Google', 'password sign-in is blocked for the domain')
      await deleteSsoProvider(providerId)
      assert.equal((await db.select().from(ssoProvider).where(eq(ssoProvider.providerId, providerId))).length, 0)
    })

    let chainedId = ''
    await test('chaining, inbound webhook trigger, API runs, rate limits and quality snapshots', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const lookupDef = {
        schemaVersion: 2,
        nodes: [
          { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'employees', maxRows: 30 },
          // Lookup (MP-6): code → email from the employees dataset written earlier.
          { id: 'm', type: 'map', position: { x: 1, y: 0 }, keepUnmapped: false, fields: [
            { from: 'code', to: 'code', type: 'text', transforms: [] },
            { from: 'code', to: 'email_from_lookup', type: 'text', transforms: [{ fn: 'lookup', args: [DATASET, 'code', 'email', 'missing'] }] },
          ] },
          { id: 'd', type: 'destination', position: { x: 2, y: 0 }, kind: 'dataset', datasetName: `${RUN}_chained`, mode: 'upsert', keys: ['code'] },
        ],
        edges: [{ id: 'e1', from: 's', to: 'm' }, { id: 'e2', from: 'm', to: 'd' }],
        settings: { retries: 0 },
      }
      await rejectsWith(() => savePipeline({ publish: true, name: `${RUN} loop`, definition: lookupDef, schedule: { type: 'after', afterPipelineId: 'pipe_missing' } as never }), /no longer exists/)
      const chained = await savePipeline({ publish: true, enabled: true, name: `${RUN} chained`, definition: lookupDef, schedule: { type: 'after', afterPipelineId: rulePipelineId, afterOn: 'success_or_partial' } as never })
      chainedId = chained.id
      // A loop: the rule pipeline may not run after the chained one.
      const rulePipe = (await listPipelines()).find((x) => x.id === rulePipelineId)!
      await rejectsWith(() => savePipeline({ id: rulePipelineId, name: rulePipe.name, definition: rulePipe.config as never, schedule: { type: 'after', afterPipelineId: chainedId } as never }), /loop/)

      // Inbound webhook → rule pipeline run → chained pipeline queued automatically.
      const { url } = await createWebhookTrigger(rulePipelineId)
      const token = url.split('/').pop()!
      const hook = (t: string) => postHook(new Request(url, { method: 'POST' }), { params: Promise.resolve({ id: rulePipelineId, token: t }) })
      assert.equal((await hook('wrong-token')).status, 404)
      const started = await hook(token)
      assert.equal(started.status, 202)
      const { run_id } = (await started.json()) as { run_id: string }
      takeAfterCallbacks()
      await processJobs({})
      const [hookRun] = await db.select().from(executionLogs).where(eq(executionLogs.id, run_id))
      assert.equal(hookRun.trigger, 'webhook')
      const [chainRun] = await db.select().from(executionLogs).where(and(eq(executionLogs.pipelineId, chainedId), eq(executionLogs.trigger, 'chain')))
      assert.ok(chainRun, 'the chained pipeline ran after the webhook-triggered one')
      assert.ok(['success', 'partial'].includes(chainRun.status!), chainRun.errorMessage ?? '')
      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_chained`)))
      const { rows } = await pool.query(`SELECT code, email_from_lookup FROM "nexus_data"."${ds.tableName}" ORDER BY code LIMIT 2`)
      assert.ok(rows.every((r) => r.email_from_lookup === 'missing' || String(r.email_from_lookup).includes('@')), 'lookup filled from the dataset')
      const snaps = await db.select().from(datasetQualitySnapshots).where(and(eq(datasetQualitySnapshots.workspaceId, adminWs), eq(datasetQualitySnapshots.datasetName, `${RUN}_chained`)))
      assert.equal(snaps.length, 1)
      assert.equal(Number(snaps[0].uniqueness), 100, 'upsert keys are unique')
      const history = await getQualityHistory(`${RUN}_chained`)
      assert.equal(history.days.length, 1)
      const lineage = await getLineage(`dataset:${RUN}_chained`)
      assert.ok(lineage.nodes.some((n) => n.id === `pipeline:${chainedId}`) && lineage.nodes.some((n) => n.kind === 'source_table'))

      // API: trigger + status with a pipelines:run key; a tiny rate limit returns 429.
      const { key } = await createApiKey({ name: `${RUN} runner`, role: 'analyst', scopes: ['pipelines:run', 'runs:read'], rateLimitPerMinute: 10 })
      const authed = (path: string, method = 'GET') => new Request(`http://localhost/api/v1${path}`, { method, headers: { authorization: `Bearer ${key}` } })
      const trig = await postRuns(authed(`/pipelines/${chainedId}/runs`, 'POST'), { params: Promise.resolve({ id: chainedId }) })
      assert.equal(trig.status, 202)
      assert.equal(trig.headers.get('X-RateLimit-Limit'), '10')
      const { run_id: apiRun } = (await trig.json()) as { run_id: string }
      takeAfterCallbacks()
      await processJobs({})
      const status = (await (await getRun(authed(`/runs/${apiRun}`), { params: Promise.resolve({ id: apiRun }) })).json()) as { data: { status: string; trigger: string } }
      assert.equal(status.data.trigger, 'api')
      assert.ok(['success', 'partial'].includes(status.data.status))
      assert.equal((await getDataset(authed(`/datasets/${DATASET}`), { params: Promise.resolve({ name: DATASET }) })).status, 403, 'scopes are enforced')
      let last = 0
      for (let i = 0; i < 10; i++) last = (await getRun(authed(`/runs/${apiRun}`), { params: Promise.resolve({ id: apiRun }) })).status
      assert.equal(last, 429, 'the 10-per-minute limit is enforced')
    })

    await test('outbound webhooks: SSRF guard, signed delivery attempts, retries recorded', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await rejectsWith(() => createWebhook({ url: 'http://example.com/hook', events: ['run.failed'] }), /https/)
      await rejectsWith(() => createWebhook({ url: 'https://127.0.0.1/hook', events: ['run.failed'] }), /private network/)
      await rejectsWith(() => createWebhook({ url: 'https://localhost/hook', events: ['run.failed'] }), /Internal hosts/)
      const { id, secret } = await createWebhook({ url: 'https://example.com/nexus-hook', events: ['run.succeeded', 'dataset.updated'] })
      assert.match(secret, /^whsec_/)
      const [stored] = await db.select({ secret: webhooks.secret }).from(webhooks).where(eq(webhooks.id, id))
      assert.ok(!JSON.stringify(stored.secret).includes(secret), 'the signing secret is stored encrypted')
      // example.com answers 405/404 to POSTs: the delivery is recorded as a failed attempt, queued for retry.
      const test = await testWebhook(id)
      assert.equal(test.delivered, false)
      const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id))
      assert.equal(d.status, 'pending')
      assert.equal(d.attempts, 1)
      assert.ok(d.nextAttemptAt.getTime() > Date.now(), 'retry scheduled')
      const hooks = await listWebhooks()
      assert.ok(hooks[0].deliveries.length >= 1 && !('secret' in hooks[0]))
      // A run emits events for subscribed webhooks.
      const run = await runPipelineNow(chainedId)
      takeAfterCallbacks()
      await processJobs({})
      const events = (await db.select({ event: webhookDeliveries.event, payload: webhookDeliveries.payload }).from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id))).map((e) => e.event)
      assert.ok(events.includes('run.succeeded') && events.includes('dataset.updated'), events.join(','))
      assert.ok(run.runId)
      await deleteWebhook(id)
    })

    await test('mapping templates are saved per workspace and offered in the builder', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await saveMappingTemplate({ name: `${RUN} HR export`, fields: [{ from: 'NIP', to: 'employee_code', type: 'text', transforms: [{ fn: 'trim', args: [] }] }] })
      const again = await saveMappingTemplate({ name: `${RUN} HR export`, fields: [{ from: 'NIP', to: 'employee_code', type: 'text', transforms: [] }] })
      assert.equal(again.replaced, true)
      const opts = await getBuilderOptions()
      const tpl = opts.mappingTemplates.find((x) => x.name === `${RUN} HR export`)!
      assert.equal(tpl.fields[0].transforms.length, 0)
      assert.ok(opts.pipelines.some((x) => x.id === chainedId))
      await deleteMappingTemplate(tpl.id)
    })

    await test('exactly-once appends: a resumed chunk replaces its earlier copy', async () => {
      const columns = [{ name: 'code', type: 'text' as const }]
      const rows = [{ code: 'A' }, { code: 'B' }]
      const first = await writeDataset({ workspaceId: adminWs, datasetName: `${RUN}_once`, mode: 'append', keys: [], columns, rows, runId: `${RUN}_run`, chunk: 0 })
      // The same chunk written again (crash between write and checkpoint), then the next chunk.
      await writeDataset({ workspaceId: adminWs, existingTableName: first.tableName, datasetName: `${RUN}_once`, mode: 'append', keys: [], columns, rows, runId: `${RUN}_run`, chunk: 0 })
      const third = await writeDataset({ workspaceId: adminWs, existingTableName: first.tableName, datasetName: `${RUN}_once`, mode: 'append', keys: [], columns, rows: [{ code: 'C' }], runId: `${RUN}_run`, chunk: 1 })
      assert.equal(third.rowCount, 3, 'chunk 0 counted once, chunk 1 added')
      await pool.query(`DROP TABLE IF EXISTS "nexus_data"."${first.tableName}"`)
    })

    await test('KMPlus product destination: entities scanned, records upserted, refused records quarantined', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      process.env.NEXUS_ALLOW_PRIVATE_URLS = 'true'
      const mock = await startKmplusMock()
      try {
        await installConnector('kmplus')
        const destId = await createDataSource({ name: `${RUN} LMS`, type: 'kmplus', sourceType: 'kmplus', config: { role: 'destination' }, credentials: { product: 'LMS', baseUrl: mock.baseUrl, apiToken: mock.token } })
        await testConnection(destId)
        const scanned = (await getDataSources()).find((s) => s.id === destId)!.config as { schemaScan: { tables: { name: string }[] } }
        assert.deepEqual(scanned.schemaScan.tables.map((t) => t.name), ['employee', 'organization'])
        const saved = await savePipeline({
          publish: true,
          name: `${RUN} to LMS`,
          definition: {
            schemaVersion: 2,
            nodes: [
              { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'employees', maxRows: 20 },
              { id: 'm', type: 'map', position: { x: 1, y: 0 }, keepUnmapped: false, fields: [
                { from: 'code', to: 'employee_code', type: 'text', transforms: [] },
                // Every 5th employee has no email: the product refuses those records.
                { from: 'email', to: 'email', type: 'text', transforms: [{ fn: 'conditional', args: ['ends_with', '5@kmplus.test', '', '{value}'] }] },
              ] },
              { id: 'd', type: 'destination', position: { x: 2, y: 0 }, kind: 'datasource', dataSourceId: destId, table: 'employee', mode: 'upsert', keys: ['employee_code'] },
            ],
            edges: [{ id: 'e1', from: 's', to: 'm' }, { id: 'e2', from: 'm', to: 'd' }],
            settings: { retries: 0 },
          },
          schedule: { type: 'manual' } as never,
        })
        const run = await runPipelineNow(saved.id)
        takeAfterCallbacks()
        await processJobs({})
        const done = await getRunStatus(run.runId)
        assert.equal(done.status, 'partial', done.errorMessage ?? '')
        assert.equal(mock.store.get('employee')?.size, 18, '18 of 20 accepted by the product')
        assert.equal(done.recordsError, 2, 'refused records are counted')
        const inbox = await listQuarantine({ pipelineId: saved.id })
        assert.equal(inbox.total, 2)
        assert.match(inbox.rows[0].messages[0], /employee: email is required/)
        // Fix one and replay it to the product.
        await fixRow({ id: inbox.rows[0].id, row: { ...inbox.rows[0].row, email: 'fixed@kmplus.test' } })
        const [replay] = await replayRows([inbox.rows[0].id])
        takeAfterCallbacks()
        await processJobs({})
        assert.equal((await getRunStatus(replay.runId)).recordsSuccess, 1)
        assert.equal(mock.store.get('employee')?.size, 19)
        assert.ok([...mock.batches].every((b) => b.includes(':')), 'batches carry run:chunk:index ids')
        // Audit diffs: renaming the destination records before/after.
        await renameDataSource(destId, `${RUN} LMS renamed`)
        const { rows: audit } = await listAuditLogs({ action: 'UPDATE' })
        const renamed = audit.find((a) => a.resourceId === destId && (a.changes as { diff?: unknown })?.diff)
        assert.deepEqual((renamed!.changes as { diff: Record<string, unknown> }).diff, { name: { from: `${RUN} LMS`, to: `${RUN} LMS renamed` } })
      } finally {
        await mock.stop()
      }
    })

    await test('admins reset a member\'s 2FA (lost phone); members cannot', async () => {
      await db.insert(session).values({ id: `${RUN}_sess`, userId: viewer.id, token: `${RUN}_tok`, expiresAt: new Date(Date.now() + 86_400_000) })
      await db.insert(verification).values({ id: `${RUN}_trust`, identifier: `trust-device-${RUN}`, value: viewer.id, expiresAt: new Date(Date.now() + 86_400_000) })
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      await rejectsWith(() => resetMemberTwoFactor(admin.id), /Your role/)
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await rejectsWith(() => resetMemberTwoFactor(admin.id), /your own 2FA/)
      await resetMemberTwoFactor(viewer.id)
      const [u] = await db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, viewer.id))
      assert.equal(u.twoFactorEnabled, false)
      assert.equal((await db.select().from(session).where(eq(session.userId, viewer.id))).length, 0, 'signed out everywhere')
      assert.equal((await db.select().from(verification).where(eq(verification.value, viewer.id))).length, 0, 'trusted devices forgotten')
      const members = await listMembers()
      assert.equal(members.find((m) => m.userId === viewer.id)?.twoFactorEnabled, false)
      const { rows } = await listAuditLogs({ action: 'RESET_2FA' })
      assert.equal(rows.length, 1)
    })
  } finally {
    await cleanup([admin, viewer, outsider].map((u) => u.id))
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exitCode = failed ? 1 : 0
  await pool.end()
}

async function cleanup(userIds: string[]) {
  const wsIds = (await db.select({ id: workspaceMembers.workspaceId }).from(workspaceMembers).where(inArray(workspaceMembers.userId, userIds))).map((r) => r.id)
  const ws = [...new Set([...wsIds, ...userIds.map((id) => `ws_${id}`)])]
  const datasets = await db.select({ tableName: nexusDatasets.tableName }).from(nexusDatasets).where(inArray(nexusDatasets.workspaceId, ws))
  for (const d of datasets) await pool.query(`DROP TABLE IF EXISTS "nexus_data"."${d.tableName}"`)
  await db.delete(session).where(inArray(session.userId, userIds))
  await db.delete(verification).where(inArray(verification.value, userIds))
  const keyIds = (await db.select({ id: apiKeys.id }).from(apiKeys).where(inArray(apiKeys.workspaceId, ws))).map((k) => `key:${k.id}`)
  if (keyIds.length) await db.delete(apiRateLimits).where(inArray(apiRateLimits.bucket, keyIds))
  const pipeIds = (await db.select({ id: pipelines.id }).from(pipelines).where(inArray(pipelines.workspaceId, ws))).map((x) => `hook:${x.id}`)
  if (pipeIds.length) await db.delete(apiRateLimits).where(inArray(apiRateLimits.bucket, pipeIds))
  const sso = await db.select({ providerId: workspaceSso.providerId }).from(workspaceSso).where(inArray(workspaceSso.workspaceId, ws))
  if (sso.length) await db.delete(ssoProvider).where(inArray(ssoProvider.providerId, sso.map((x) => x.providerId)))
  for (const t of [workspaceSso, webhookDeliveries, webhooks, mappingTemplates, datasetQualitySnapshots, apiKeys, catalogEntries, domainMappings, businessRuleVersions, businessRules, datasetPolicies, dashboards, nexusDatasets, pipelineRunRejects, executionLogs, pipelineJobs, pipelineVersions, pipelines, dataSources, connectorInstalls, workspaceInvites, auditLogs, workspaceMembers]) {
    await db.delete(t).where(inArray(t.workspaceId, ws))
  }
  await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
  await db.delete(workspaces).where(inArray(workspaces.id, ws))
  await db.delete(user).where(like(user.id, `${RUN}_%`))
  await pool.query(`DROP SCHEMA IF EXISTS "${FIXTURE_SCHEMA}" CASCADE`)
}

main().catch(async (err) => {
  console.error(err)
  process.exitCode = 1
  await pool.end().catch(() => undefined)
})
