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
import { agentTasks as agentTaskTable, agents as agentTable, apiCallCache, apiCallLedger, apiKeys, apiRateLimits, auditLogs, businessRuleVersions, businessRules, catalogEntries, connectorInstalls, dashboards, dataSources, datasetPolicies, datasetQualitySnapshots, domainMappings, mappingTemplates, notifications, pipelineApprovals, scimGroups, scimTokens, scimUsers, ssoProvider, webhookDeliveries, webhooks, workspaceSso, executionLogs, nexusDatasets, pipelineJobs, pipelineRunRejects, pipelines, pipelineStageTables, pipelineVersions, session, user, verification, workspaceInvites, workspaceMembers, workspaces, datasetColumnAliases, datasetSchemaVersions, datasetSchemas, upgradeNoticeDismissals, sourceHealthChecks, pipelineAlerts, alertChannels, maintenanceWindows, dashboardEmbeds, pipelineTriggerEvents } from '@/lib/db/schema'
import { acceptInvite, changeMemberRole, createAccountFromInvite, createInvite, describeInvite, getWorkspaceContext, listMembers, resetMemberTwoFactor, switchWorkspace } from '@/lib/actions/workspaces'
import { installConnector } from '@/lib/actions/connectors'
import { createDataSource, deleteDataSource, getDataSources, getEditableCredentials, listSecretManagers, listSecretNames, renameDataSource, setDataSourceRole, testConnection, updateDataSourceCredentials, getSourceHealth, setHealthCheckInterval, reviewSchemaDrift, setDataSourceOwnership, getSourceEnvironments, copyDataSourceToEnvironment } from '@/lib/actions/data-sources'
import { checkSourceHealth, runDueHealthChecks } from '@/lib/connectors/health'
import { pruneWorkspaceLogs } from '@/lib/monitoring/log-retention'
import { startInfraMock } from './test/infra-mock'
import { startSftpMock } from './test/sftp-mock'
import { writeDataset } from '@/lib/pipelines/io'
import { startKmplusMock } from './test/kmplus-mock'
import { startRestWriteMock } from './test/rest-write-mock'
import { autoBindBody, bodyLeaves, parseBodySample, setRowsArray, updateBodyNode } from '@/lib/pipelines/body-template'
import { getTriggerConfig, saveTriggerConfig, cancelPipelineRun, createWebhookTrigger, discardDraft, getBuilderOptions, getDatasetPreview, getRunStatus, listPipelines, listRuns, publishPipeline, retryPipelineRun, runPipelineNow, savePipeline, sendApiTestRequest, testPipeline, clearStepCache } from '@/lib/actions/pipelines'
import { createSamlProvider, createSsoProvider, deleteSsoProvider, listSsoProviders, setSamlIdp, updateSsoProvider, verifySsoDomain } from '@/lib/actions/sso'
import { approveRequest, cancelRequest, listApprovals, rejectRequest } from '@/lib/actions/approvals'
import { listPromotionStatus, previewPromotion, promotePipeline, setApprovalPolicy, setupEnvironments, unlinkEnvironment } from '@/lib/actions/environments'
import { createScimToken, revokeScimToken, setScimGroupRole } from '@/lib/actions/scim'
import { DELETE as scimDelete, GET as scimGet, PATCH as scimPatch, POST as scimPost } from '@/app/api/scim/v2/[[...path]]/route'
import { readFileSync } from 'node:fs'
import { addAgentDataSource, createAgent, listAgents, revokeAgent } from '@/lib/actions/agents'
import { getDataSourceTableSample, previewRestConnection } from '@/lib/actions/connector-source'
import { parseConfig, runAgent } from '../agent/nexus-agent'
import { applyDiagnosisFix, askData, diagnoseRun, draftPipeline, draftRule, getAiSettings, setAiProvider, suggestConnector, suggestMapping } from '@/lib/actions/ai'
import { cookies } from 'next/headers'
import { acceptTerms } from '@/lib/actions/legal'
import { TERMS_VERSION } from '@/lib/legal/terms'
import { hasAcceptedCurrentTerms, recordTermsAcceptance } from '@/lib/legal/acceptance'
import { startLlmMock } from './test/llm-mock'
import { startIntranetApi } from './test/intranet-api-mock'
import { decryptCredentials, encryptCredentials } from '@/lib/security/credentials'
import { POST as agentHello } from '@/app/api/agent/v1/hello/route'
import { GET as agentTasks } from '@/app/api/agent/v1/tasks/route'
import { POST as agentResult } from '@/app/api/agent/v1/tasks/[id]/result/route'
import { emailAllowedForProvider, enforcedProviderFor, provisionSsoUser } from '@/lib/auth/sso'
import { SsoConfigPlugin } from '@/lib/auth/sso-config-plugin'
import { upgradeSsoSecrets } from '@/lib/security/upgrade'
import { Kysely, PostgresDialect } from 'kysely'
import { createWebhook, deleteWebhook, listWebhooks, testWebhook } from '@/lib/actions/webhooks'
import { deleteMappingTemplate, saveMappingTemplate } from '@/lib/actions/templates'
import { OPTIONS as optionsHook, POST as postHook } from '@/app/api/hooks/pipelines/[id]/[token]/route'
import { POST as postRuns } from '@/app/api/v1/pipelines/[id]/runs/route'
import { GET as getRun } from '@/app/api/v1/runs/[id]/route'
import { deleteRule, listRuleVersions, listRules, saveRule, testRule } from '@/lib/actions/rules'
import { approveRows, dismissRows, fixRow, getQualityOverview, listQuarantine, replayRows, restoreRows } from '@/lib/actions/quality'
import { getCatalogSample, getLineage, getQualityHistory, listCatalog, saveCatalogEntry, saveDomainMapping, askCatalog } from '@/lib/actions/catalog'
import { createApiKey, revokeApiKey } from '@/lib/actions/api-keys'
import { getLogRetention, setLogRetention } from '@/lib/actions/monitoring'
import { exportPipeline, importPipeline, previewImport } from '@/lib/actions/pipeline-transfer'
import { changeDatasetSchema, defineDatasetSchema, defineFromCurrentColumns, dismissUpgradeNotice, getDatasetSchema, getUpgradeNotices, listInferredDatasets, previewSchemaChange } from '@/lib/actions/schemas'
import { changeSchema, loadSchema } from '@/lib/datasets/store'
import { uploadFilePart } from '@/lib/actions/files'
import { GET as getDataset } from '@/app/api/v1/datasets/[name]/route'
import { GET as getDomain } from '@/app/api/v1/domains/[entity]/route'
import { eraseRecords, findErasureMatches, getGovernanceOverview, saveDatasetPolicy } from '@/lib/actions/governance'
import { createDashboardEmbed, deleteDashboard, getDashboardData, getDashboardFilterOptions, listDashboardEmbeds, listDashboards, previewWidget, revokeDashboardEmbed, saveDashboard, setDashboardSharing } from '@/lib/actions/analytics'
import { dashboardResults, loadEmbed } from '@/lib/analytics/dashboards'
import { proxy } from '../proxy'
import { NextRequest } from 'next/server'
import { listAuditLogs } from '@/lib/actions/audit'
import { listFinderRecords } from '@/lib/actions/finder'
import { processJobs, CHUNK_ROWS } from '@/lib/pipelines/jobs'
import { deleteMaintenanceWindow, listMaintenanceWindows, saveMaintenanceWindow } from '@/lib/actions/maintenance'
import { holdDuePipeline } from '@/lib/pipelines/maintenance-store'
import { wibToDate } from '@/lib/pipelines/maintenance'
import { nextRunAt } from '@/lib/pipelines/schedule'
import { scheduleSchema } from '@/lib/pipelines/definition'
import { createAlertChannel, deleteAlertChannel, getPipelineAlerts, listAlertChannels, savePipelineAlerts, setPipelineSubscription, testAlertChannel } from '@/lib/actions/alerts'
import { checkAlertSlas } from '@/lib/alerts/send'
import { alertIfNeeded } from '@/lib/pipelines/runner'
import { signPayload } from '@/lib/webhooks/deliver'
import { createServer } from 'node:http'
import { createStageTable, sweepStageTables } from '@/lib/pipelines/stage'
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
    // Assertion diffs span many lines: show them, then where it failed.
    const lines = err instanceof Error ? (err.stack ?? err.message).split('\n') : [String(err)]
    const at = lines.findIndex((l) => l.trim().startsWith('at '))
    console.log(`FAIL  ${name}\n      ${[...lines.slice(0, at > 0 ? Math.min(at, 40) : 3), ...(at > 0 ? lines.slice(at, at + 2) : [])].join('\n      ')}`)
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
  for (const u of [admin, viewer, outsider]) await recordTermsAcceptance({ userId: u.id, method: 'sign_up' })

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

    await test('Terms and Conditions: actions need the current version accepted; acceptance is recorded once', async () => {
      const newcomer = newUser('newcomer')
      await db.insert(user).values({ id: newcomer.id, email: newcomer.email, name: newcomer.name, emailVerified: true, twoFactorEnabled: true })
      setTestUser(newcomer)
      await rejectsWith(() => getWorkspaceContext(), /Terms and Conditions/)
      await rejectsWith(() => acceptTerms('2000-01-01'), /updated while this page was open/)
      await acceptTerms(TERMS_VERSION)
      await acceptTerms(TERMS_VERSION)
      assert.equal(await hasAcceptedCurrentTerms(newcomer.id), true)
      const { rows } = await pool.query('select "method", "version" from terms_acceptances where "userId" = $1', [newcomer.id])
      assert.deepEqual(rows, [{ method: 'prompt', version: TERMS_VERSION }])
      assert.equal((await getWorkspaceContext()).role, 'admin')
      // A stand-in user id (sign-up for an email already taken) records nothing.
      await recordTermsAcceptance({ userId: `${RUN}_does_not_exist`, method: 'sign_up' })
      assert.equal((await pool.query('select 1 from terms_acceptances where "userId" = $1', [`${RUN}_does_not_exist`])).rows.length, 0)
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

    await test('invite for someone without an account: the page offers sign-up; guard rails on creating it', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const newcomerEmail = `${RUN}-invitee@nexus.test`
      const fresh = (await createInvite(newcomerEmail, 'analyst')).path.split('/').pop()!
      const existing = (await createInvite(outsider.email, 'viewer')).path.split('/').pop()!
      setTestUser(null)
      const d = await describeInvite(fresh)
      assert.equal(d?.hasAccount, false)
      assert.equal(d?.ssoProvider, null)
      assert.equal((await describeInvite(existing))?.hasAccount, true)
      await rejectsWith(() => createAccountFromInvite({ token: fresh, name: 'New', password: 'Str0ng-pass-1', acceptedTerms: '2000-01-01' }), /Accept the Terms and Conditions/)
      await rejectsWith(() => createAccountFromInvite({ token: 'x'.repeat(32), name: 'New', password: 'Str0ng-pass-1', acceptedTerms: TERMS_VERSION }), /invalid, expired, revoked or already used/)
      await rejectsWith(() => createAccountFromInvite({ token: existing, name: 'Out', password: 'Str0ng-pass-1', acceptedTerms: TERMS_VERSION }), /already exists/)
      await rejectsWith(() => createAccountFromInvite({ token: fresh, name: 'New', password: 'short', acceptedTerms: TERMS_VERSION }), /at least 8 characters/)
      setTestUser(admin)
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

    await test('MP-8 relate: a run resolves references through a dataset and quarantines the ones it cannot find', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      // Codes of rows 1000 and 2000 never reached the dataset (invalid emails): those references are missing.
      const saved = await savePipeline({
        publish: true,
        name: `${RUN} relate`,
        definition: {
          steps: [
            { id: 's', type: 'source', dataSourceId: sourceId, table: 'employees', maxRows: 2000 },
            {
              id: 'm',
              type: 'map',
              fields: [
                { from: 'code', to: 'employee_code', type: 'text' },
                { from: 'code', to: 'record.employee_id', type: 'integer', transforms: [{ fn: 'lowercase', args: [] }, { fn: 'relate', args: [`${RUN}_employees`, 'code', 'id', 'quarantine', 'loose'] }] },
              ],
            },
            { id: 'd', type: 'destination', kind: 'dataset', datasetName: `${RUN}_related`, mode: 'replace' },
          ],
          settings: { retries: 0 },
        },
        schedule: { type: 'manual' } as never,
      })
      const run = await runPipelineNow(saved.id)
      takeAfterCallbacks()
      await processJobs({})
      const done = await getRunStatus(run.runId)
      assert.equal(done.status, 'partial', done.errorMessage ?? '')
      assert.equal(done.recordsError, 2)
      const rejects = await db.select({ errors: pipelineRunRejects.errors }).from(pipelineRunRejects).where(eq(pipelineRunRejects.runId, run.runId))
      assert.ok(rejects.every((r) => /has no match in/.test(JSON.stringify(r.errors))), JSON.stringify(rejects[0]?.errors))
      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_related`)))
      assert.deepEqual((ds.columns as { name: string; type: string }[]).map((c) => `${c.name}:${c.type}`), ['employee_code:text', 'record:json'], 'a dotted target is one json column')
      const { rows } = await pool.query<{ code: string; record: { employee_id: number } }>(`SELECT employee_code AS code, record FROM "nexus_data"."${ds.tableName}" WHERE employee_code = 'E00042'`)
      assert.deepEqual(rows, [{ code: 'E00042', record: { employee_id: 42 } }])
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

    await test('data quality: dismiss can be undone; rows say where a replay writes', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const open = await listQuarantine({ pipelineId, status: 'open' })
      const row = open.rows[0]
      assert.ok(row, 'an open row to dismiss')
      assert.ok(row.destinations.includes(`dataset ${DATASET}`), 'destinations name the dataset')
      assert.equal((await dismissRows([row.id])).dismissed, 1)
      assert.ok(!(await listQuarantine({ pipelineId, status: 'open' })).rows.some((r) => r.id === row.id))
      assert.equal((await restoreRows([row.id])).restored, 1)
      const back = await listQuarantine({ pipelineId, status: row.fixedRow ? 'fixed' : 'open' })
      assert.ok(back.rows.some((r) => r.id === row.id), 'undo puts the row back in the inbox')
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
      // TD-25: the client secret is sealed at rest; Better Auth's reads (through the Kysely plugin) see it in plain.
      const storedConfig = async () => (await db.select({ c: ssoProvider.oidcConfig }).from(ssoProvider).where(eq(ssoProvider.providerId, providerId)))[0].c!
      assert.doesNotMatch(await storedConfig(), /client-secret|clientSecret/, 'no plaintext secret in the database')
      const authDb = new Kysely<Record<string, Record<string, unknown>>>({ dialect: new PostgresDialect({ pool }), plugins: [new SsoConfigPlugin()] })
      const readAsAuth = async () => JSON.parse(String((await authDb.selectFrom('ssoProvider').selectAll().where('providerId', '=', providerId).executeTakeFirstOrThrow()).oidcConfig))
      assert.equal((await readAsAuth()).clientSecret, 'client-secret')
      assert.equal((await readAsAuth()).clientId, 'client-id')
      await updateSsoProvider({ providerId, clientSecret: 'rotated-secret' })
      assert.doesNotMatch(await storedConfig(), /rotated-secret/)
      assert.equal((await readAsAuth()).clientSecret, 'rotated-secret', 'rotation re-seals the new secret')
      // A provider stored in plaintext (before TD-25) is sealed by the cron tick.
      const plainConfig = JSON.stringify({ ...(await readAsAuth()), clientSecret: 'legacy-secret' })
      await db.update(ssoProvider).set({ oidcConfig: plainConfig }).where(eq(ssoProvider.providerId, providerId))
      assert.ok((await upgradeSsoSecrets()).upgraded >= 1)
      assert.doesNotMatch(await storedConfig(), /legacy-secret/)
      assert.equal((await readAsAuth()).clientSecret, 'legacy-secret')
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
      // Fixed one-minute windows: if one resets mid-loop, the next still runs out within 25 calls.
      let last = 0
      for (let i = 0; i < 25 && last !== 429; i++) last = (await getRun(authed(`/runs/${apiRun}`), { params: Promise.resolve({ id: apiRun }) })).status
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
        assert.deepEqual(scanned.schemaScan.tables.map((t) => t.name), ['employee', 'organization', 'org_headcount'])
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


    await test('REST API destination: one request per row; refused rows quarantined, fixed and replayed; 401 stops the run', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      process.env.NEXUS_ALLOW_PRIVATE_URLS = 'true'
      const api = await startRestWriteMock('hr-token')
      try {
        await installConnector('rest')
        const destId = await createDataSource({ name: `${RUN} HR API`, type: 'rest', sourceType: 'rest', config: { role: 'destination' }, credentials: { baseUrl: api.baseUrl, authMethod: 'bearer', bearerToken: api.token } })
        const options = await getBuilderOptions()
        assert.equal(options.dataSources.find((d) => d.id === destId)?.role, 'destination', 'listed for the Destination step')
        const template = autoBindBody(parseBodySample('json', '{"employee":{"code":"E1","email":"a@b.id","source":"x"}}'), ['code', 'email']).template
        const body = { format: 'json', sample: '', template: updateBodyNode(template, bodyLeaves(template).find((l) => l.path === 'employee.source')!.addr, (n) => (n.t === 'value' ? { ...n, binding: { kind: 'constant', value: 'nexus' } } : n)) }
        const definition = (dataSourceId: string, retries = 0) => ({
          schemaVersion: 2,
          nodes: [
            { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'employees', maxRows: 10 },
            { id: 'm', type: 'map', position: { x: 1, y: 0 }, keepUnmapped: false, fields: [
              { from: 'code', to: 'code', type: 'text', transforms: [] },
              // Employee 5 has no email: the API answers 422 for it.
              { from: 'email', to: 'email', type: 'text', transforms: [{ fn: 'conditional', args: ['ends_with', '5@kmplus.test', '', '{value}'] }] },
            ] },
            { id: 'd', type: 'destination', position: { x: 2, y: 0 }, kind: 'api', dataSourceId, method: 'POST', path: '/employees', body },
          ],
          edges: [{ id: 'e1', from: 's', to: 'm' }, { id: 'e2', from: 'm', to: 'd' }],
          settings: { retries },
        })
        const saved = await savePipeline({ publish: true, name: `${RUN} to HR API`, definition: definition(destId), schedule: { type: 'manual' } as never })
        const run = await runPipelineNow(saved.id)
        takeAfterCallbacks()
        await processJobs({})
        const done = await getRunStatus(run.runId)
        assert.equal(done.status, 'partial', done.errorMessage ?? '')
        assert.equal(done.recordsSuccess, 9)
        assert.equal(done.recordsError, 1)
        assert.equal(api.employees.size, 9)
        const posts = api.received.filter((r) => r.path === '/employees')
        assert.equal(posts.length, 10, 'one request per row')
        assert.deepEqual(JSON.parse(posts[0].body), { employee: { code: 'E00001', email: 'emp1@kmplus.test', source: 'nexus' } })
        assert.ok(posts.every((r) => r.contentType === 'application/json' && r.idempotencyKey === null))
        const inbox = await listQuarantine({ pipelineId: saved.id })
        assert.equal(inbox.total, 1)
        assert.equal(inbox.rows[0].messages[0], 'POST /employees: The API refused the request (HTTP 422): email is required (employee E00005, contact [email])', 'short, redacted reason')
        // Fix the row and replay it to the API.
        await fixRow({ id: inbox.rows[0].id, row: { ...inbox.rows[0].row, email: 'fixed5@kmplus.test' } })
        const [replay] = await replayRows([inbox.rows[0].id])
        takeAfterCallbacks()
        await processJobs({})
        assert.equal((await getRunStatus(replay.runId)).recordsSuccess, 1)
        assert.equal(api.employees.get('E00005')?.email, 'fixed5@kmplus.test')

        // The editor's test request: sign-in masked in what comes back, audited without values.
        const tested = await sendApiTestRequest({ pipelineId: saved.id, step: definition(destId).nodes[2] as never, row: { code: 'T1', email: 't1@kmplus.test' } })
        assert.equal(tested.outcome, 'written')
        assert.equal(tested.response?.status, 201)
        assert.equal(tested.request.headers.Authorization, 'Bearer ••••')
        assert.ok(!JSON.stringify(tested).includes('hr-token'), 'the token never reaches the browser')
        const refused = await sendApiTestRequest({ pipelineId: saved.id, step: definition(destId).nodes[2] as never, row: { code: 'T2', email: '' } })
        assert.equal(refused.outcome, 'rejected')
        assert.match(refused.message, /HTTP 422/)
        const { rows: audits } = await listAuditLogs({ action: 'TEST_REQUEST' })
        assert.ok(audits.length >= 2 && !JSON.stringify(audits).includes('t1@kmplus.test'), 'audited without body values')

        // A wrong token stops the run at the first request: no retries, nothing quarantined.
        const badId = await createDataSource({ name: `${RUN} HR API bad token`, type: 'rest', sourceType: 'rest', config: { role: 'destination' }, credentials: { baseUrl: api.baseUrl, authMethod: 'bearer', bearerToken: 'wrong' } })
        const bad = await savePipeline({ publish: true, name: `${RUN} to HR API (bad token)`, definition: definition(badId, 2), schedule: { type: 'manual' } as never })
        const before = api.received.length
        const badRun = await runPipelineNow(bad.id)
        takeAfterCallbacks()
        await processJobs({})
        const failed = await getRunStatus(badRun.runId)
        assert.equal(failed.status, 'failed')
        assert.match(failed.errorMessage ?? '', /refused Nexus's sign-in \(HTTP 401\)/)
        assert.equal(api.received.length - before, 1, 'stopped at the first request, not retried')
        // A REST data source added as a source is never written to.
        const srcRest = await createDataSource({ name: `${RUN} HR API as source`, type: 'rest', sourceType: 'rest', config: { role: 'source' }, credentials: { baseUrl: api.baseUrl, authMethod: 'bearer', bearerToken: api.token } })
        const asSource = await savePipeline({ publish: true, name: `${RUN} to a source`, definition: definition(srcRest), schedule: { type: 'manual' } as never })
        const srcRun = await runPipelineNow(asSource.id)
        takeAfterCallbacks()
        await processJobs({})
        assert.match((await getRunStatus(srcRun.runId)).errorMessage ?? '', /was added as a source/)
      } finally {
        await api.stop()
      }
    })

    await test('REST API destination: batch mode, refused items by index, 5xx retried with Retry-After, idempotency keys stable when a chunk is retried', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      process.env.NEXUS_ALLOW_PRIVATE_URLS = 'true'
      const api = await startRestWriteMock('batch-token')
      try {
        const destId = await createDataSource({ name: `${RUN} HR batch API`, type: 'rest', sourceType: 'rest', config: { role: 'destination' }, credentials: { baseUrl: api.baseUrl, authMethod: 'bearer', bearerToken: api.token } })
        let template = setRowsArray(parseBodySample('json', '{"batch_id":"x","records":[{"code":"E1","email":"a@b.id"}]}'), [1])
        template = autoBindBody(template, ['code', 'email']).template
        template = updateBodyNode(template, [0], (n) => (n.t === 'value' ? { ...n, binding: { kind: 'meta', name: 'batch_id' } } : n))
        const saved = await savePipeline({
          publish: true,
          name: `${RUN} to HR batch API`,
          definition: {
            schemaVersion: 2,
            nodes: [
              { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'employees', maxRows: 10 },
              { id: 'm', type: 'map', position: { x: 1, y: 0 }, keepUnmapped: false, fields: [
                { from: 'code', to: 'code', type: 'text', transforms: [] },
                { from: 'email', to: 'email', type: 'text', transforms: [{ fn: 'conditional', args: ['ends_with', '5@kmplus.test', '', '{value}'] }] },
              ] },
              {
                id: 'd', type: 'destination', position: { x: 2, y: 0 }, kind: 'api', dataSourceId: destId, method: 'POST', path: '/employees/batch',
                body: { format: 'json', template }, batchSize: 4, idempotencyKey: true,
                response: { rejectedPath: 'errors', indexField: 'index', messageField: 'message' },
              },
            ],
            edges: [{ id: 'e1', from: 's', to: 'm' }, { id: 'e2', from: 'm', to: 'd' }],
            settings: { retries: 1, retryDelaySeconds: 5 },
          },
          schedule: { type: 'manual' } as never,
        })
        // The first batch meets two 503s (Retry-After: 0) before it goes through.
        api.failNext(2, 503, '0')
        const run = await runPipelineNow(saved.id)
        takeAfterCallbacks()
        await processJobs({})
        const done = await getRunStatus(run.runId)
        assert.equal(done.status, 'partial', done.errorMessage ?? '')
        assert.equal(done.recordsSuccess, 9)
        const batches = api.received.filter((r) => r.path === '/employees/batch')
        assert.equal(batches.length, 5, '3 batches (4 + 4 + 2 rows) + 2 retries')
        assert.deepEqual(batches.map((b) => b.idempotencyKey), [`${run.runId}:0:0`, `${run.runId}:0:0`, `${run.runId}:0:0`, `${run.runId}:0:1`, `${run.runId}:0:2`], 'a retried request keeps its key')
        assert.deepEqual(JSON.parse(batches[2].body).records.map((r: { code: string }) => r.code), ['E00001', 'E00002', 'E00003', 'E00004'])
        assert.equal(JSON.parse(batches[2].body).batch_id, `${run.runId}:0:0`)
        const inbox = await listQuarantine({ pipelineId: saved.id })
        assert.equal(inbox.total, 1)
        assert.equal(inbox.rows[0].messages[0], 'POST /employees/batch: The API rejected this item: email is required for E00005')
        await fixRow({ id: inbox.rows[0].id, row: { ...inbox.rows[0].row, email: 'fixed5@kmplus.test' } })
        const [replay] = await replayRows([inbox.rows[0].id])
        takeAfterCallbacks()
        await processJobs({})
        assert.equal((await getRunStatus(replay.runId)).recordsSuccess, 1)
        assert.equal(api.employees.size, 10)

        // A chunk that keeps failing is retried from its checkpoint: the batches sent before the failure go again with the same keys.
        api.reset()
        api.failNext(4, 500, '0', 1)
        const second = await runPipelineNow(saved.id)
        takeAfterCallbacks()
        await processJobs({})
        const [waiting] = await db.select().from(pipelineJobs).where(eq(pipelineJobs.id, second.runId))
        assert.equal(waiting.status, 'queued', 'the run waits to retry')
        assert.match(JSON.stringify(waiting.progress), /The API answered HTTP 500 after 4 attempts/)
        await db.update(pipelineJobs).set({ availableAt: new Date() }).where(eq(pipelineJobs.id, second.runId))
        await processJobs({})
        const retried = await getRunStatus(second.runId)
        assert.equal(retried.status, 'partial', retried.errorMessage ?? '')
        const keys = api.received.map((r) => r.idempotencyKey)
        const k = (b: number) => `${second.runId}:0:${b}`
        assert.deepEqual(keys, [k(0), k(1), k(1), k(1), k(1), k(0), k(1), k(2)], 'batch 0 is sent again with the same key after the retry')
        assert.equal(api.employees.size, 9)
      } finally {
        await api.stop()
      }
    })

    await test('several sources: HRIS ⋈ payroll API ∪ second HRIS ⋈ org table; resumes mid-stage after a forced stop; a no-match row replays once its partner exists', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const prevFlag = process.env.NEXUS_ALLOW_PRIVATE_URLS
      process.env.NEXUS_ALLOW_PRIVATE_URLS = 'true'
      const api = await startRestWriteMock()
      try {
        const S = `"${FIXTURE_SCHEMA}"`
        // HRIS: 1,200 employees; E0007 belongs to a unit the org table doesn't have yet.
        await pool.query(`CREATE TABLE ${S}.lane_hris (employee_code text PRIMARY KEY, full_name text, org_code text)`)
        await pool.query(`INSERT INTO ${S}.lane_hris SELECT 'E' || lpad(g::text, 4, '0'), 'Employee ' || g, CASE WHEN g = 7 THEN 'ORG_NEW' ELSE 'ORG' || (g % 100) END FROM generate_series(1, 1200) g`)
        // A second HRIS (contractors), unioned after the first.
        await pool.query(`CREATE TABLE ${S}.lane_hris2 (employee_code text PRIMARY KEY, full_name text, org_code text)`)
        await pool.query(`INSERT INTO ${S}.lane_hris2 SELECT 'C' || lpad(g::text, 3, '0'), 'Contractor ' || g, 'ORG1' FROM generate_series(1, 30) g`)
        // Org table: 100 units plus filler, so staging it takes three chunks of 500.
        await pool.query(`CREATE TABLE ${S}.lane_orgs (org_code text PRIMARY KEY, org_name text)`)
        await pool.query(`INSERT INTO ${S}.lane_orgs SELECT 'ORG' || g, 'Unit ' || g FROM generate_series(0, 99) g UNION ALL SELECT 'ZZ' || g, 'Old unit ' || g FROM generate_series(1, 1000) g`)
        // Payroll API: lower-case codes (keys compared ignoring case), E0002 paid twice, nobody after E1000.
        api.payroll.push(...Array.from({ length: 1000 }, (_, i) => ({ employee_code: `e${String(i + 1).padStart(4, '0')}`, salary: 1000 + i, full_name: `PAYROLL ${i + 1}` })), { employee_code: 'e0002', salary: 5, full_name: 'BONUS' })
        await installConnector('rest')
        const payrollId = await createDataSource({ name: `${RUN} payroll API`, type: 'rest', sourceType: 'rest', config: { role: 'source' }, credentials: { baseUrl: api.baseUrl, resourcePath: '/payroll', dataPath: 'items', authMethod: 'bearer', bearerToken: api.token } })

        const dataset = `${RUN}_lanes`
        const definition = {
          schemaVersion: 2,
          nodes: [
            { id: 'hris', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'lane_hris', maxRows: 100_000, driver: true },
            { id: 'pay', type: 'source', position: { x: 0, y: 200 }, dataSourceId: payrollId, table: 'payroll', maxRows: 100_000 },
            { id: 'hris2', type: 'source', position: { x: 0, y: 400 }, dataSourceId: sourceId, table: 'lane_hris2' },
            { id: 'org', type: 'source', position: { x: 0, y: 600 }, dataSourceId: sourceId, table: 'lane_orgs', maxRows: 100_000 },
            { id: 'j_pay', type: 'join', position: { x: 300, y: 0 }, keys: [{ left: 'employee_code', right: 'employee_code' }] },
            { id: 'u', type: 'union', position: { x: 600, y: 0 } },
            { id: 'j_org', type: 'join', position: { x: 900, y: 0 }, keys: [{ left: 'org_code', right: 'org_code' }], onNoMatch: 'quarantine' },
            { id: 'dst', type: 'destination', position: { x: 1200, y: 0 }, kind: 'dataset', datasetName: dataset, mode: 'replace', keys: ['employee_code'] },
          ],
          edges: [
            { id: 'e1', from: 'hris', to: 'j_pay', port: 'left' },
            { id: 'e2', from: 'pay', to: 'j_pay', port: 'right' },
            { id: 'e3', from: 'j_pay', to: 'u' },
            { id: 'e4', from: 'hris2', to: 'u' },
            { id: 'e5', from: 'u', to: 'j_org', port: 'left' },
            { id: 'e6', from: 'org', to: 'j_org', port: 'right' },
            { id: 'e7', from: 'j_org', to: 'dst' },
          ],
          settings: { batchSize: 500, retries: 2, retryDelaySeconds: 5 },
        }

        // Test on sample: the org lane is read by the sample's keys, the API lane in full (up to 5,000).
        const sample = await testPipeline(definition)
        assert.ok(sample.ok, sample.ok ? '' : sample.message)
        const sampleStat = (id: string) => sample.ok ? sample.result.steps.find((s) => s.id === id)! : null!
        assert.equal(sampleStat('j_pay').rowsIn, 200)
        assert.equal(sampleStat('j_pay').matched, 200, 'every sampled employee has payroll')
        assert.equal(sampleStat('j_pay').multiplied, 1)
        assert.equal(sampleStat('j_org').matched, sampleStat('j_org').rowsIn - 1, 'only E0007 has no unit')
        assert.ok(sampleStat('org').rowsOut < 200, 'the org table was filtered by the sample keys, not read whole')

        const saved = await savePipeline({ publish: true, name: `${RUN} lanes`, definition, schedule: { type: 'manual' } as never })
        const run = await runPipelineNow(saved.id)
        takeAfterCallbacks()
        const job = async () => (await db.select().from(pipelineJobs).where(eq(pipelineJobs.id, run.runId)))[0]
        type Progress = { passes?: Record<string, { offset: number; done: boolean; rows: number; chunks: number }> }
        // One chunk per invocation until the org table is half staged.
        for (let i = 0; i < 10; i++) {
          await processJobs({ maxChunksPerSlice: 1, maxJobs: 1 })
          if (((await job()).progress as Progress).passes?.org?.offset) break
        }
        const mid = (await job()).progress as Progress
        assert.deepEqual(mid.passes?.pay, { offset: 1001, cursor: null, done: true, rows: 1001, chunks: 3 }, 'the payroll lane is staged first')
        assert.equal(mid.passes?.org?.offset, 500)
        assert.equal(mid.passes?.hris?.chunks, 0, 'the driver waits until its lookups are staged')
        const [registered] = await db.select().from(pipelineStageTables).where(eq(pipelineStageTables.runId, run.runId)).limit(1)
        assert.ok(registered, 'staging tables are registered for cleanup')

        // Forced stop: the org table disappears mid-stage; the attempt fails and retries from its checkpoint.
        await pool.query(`ALTER TABLE ${S}.lane_orgs RENAME TO lane_orgs_gone`)
        await processJobs({ maxJobs: 1 })
        const failed = await job()
        assert.equal(failed.status, 'queued', 'retrying')
        assert.equal(failed.attempts, 1)
        assert.equal((failed.progress as Progress).passes?.org?.offset, 500, 'resumes mid-stage, not from the start')
        await pool.query(`ALTER TABLE ${S}.lane_orgs_gone RENAME TO lane_orgs`)
        await db.update(pipelineJobs).set({ availableAt: new Date() }).where(eq(pipelineJobs.id, run.runId))
        for (let i = 0; i < 10 && (await job()).status !== 'done'; i++) await processJobs({})
        const done = await getRunStatus(run.runId)
        assert.equal(done.status, 'partial', done.errorMessage ?? '')
        const details = (await db.select({ d: executionLogs.executionDetails }).from(executionLogs).where(eq(executionLogs.id, run.runId)))[0].d as { stagedRows: number; steps: { id: string; matched?: number; multiplied?: number; rowsIn: number; rejected: number }[]; log: { message: string }[] }
        assert.equal(details.stagedRows, 1001 + 1100, 'the resumed chunk replaced its earlier copy: nothing staged twice')
        assert.equal(done.recordsProcessed, 1200 + 30)
        const jOrg = details.steps.find((s) => s.id === 'j_org')!
        assert.deepEqual([jOrg.rowsIn, jOrg.matched, jOrg.rejected], [1231, 1230, 1])
        assert.equal(details.steps.find((s) => s.id === 'j_pay')!.multiplied, 1)
        assert.ok(details.log.some((l) => /rows multiplied: 1/.test(l.message)), 'the run log names multiplied rows')
        assert.ok(details.log.some((l) => /Staging done: 2,101 rows/.test(l.message)))
        assert.equal((await db.select().from(pipelineStageTables).where(eq(pipelineStageTables.runId, run.runId))).length, 0, 'staging dropped at the end')
        assert.equal((await pool.query(`SELECT 1 FROM pg_tables WHERE schemaname = 'nexus_stage' AND tablename = $1`, [registered.tableName])).rowCount, 0)

        const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, dataset)))
        assert.equal(ds.rowCount, 1200 + 1 - 1 + 30, 'E0002 twice (one row per match), E0007 held, contractors added')
        const rel = `"nexus_data"."${ds.tableName}"`
        const one = async (code: string) => (await pool.query(`SELECT * FROM ${rel} WHERE employee_code = $1 ORDER BY salary`, [code])).rows
        const e1 = (await one('E0001'))[0]
        assert.deepEqual([e1.full_name, Number(e1.salary), e1.payroll_full_name, e1.org_name, e1._source], ['Employee 1', 1000, 'PAYROLL 1', 'Unit 1', 'lane_hris'])
        assert.deepEqual((await one('E0002')).map((r) => Number(r.salary)), [5, 1001])
        const late = (await one('E1100'))[0]
        assert.equal(late.salary, null, 'no payroll record: kept with empty values')
        const c1 = (await one('C001'))[0]
        assert.deepEqual([c1._source, c1.org_name], ['lane_hris2', 'Unit 1'])
        assert.equal((await one('E0007')).length, 0)

        // The unit now exists: the held row replays from the Join (staging is rebuilt for the replay).
        const [held] = (await listQuarantine({ pipelineId: saved.id, kind: 'invalid' })).rows.filter((r) => r.row.employee_code === 'E0007')
        assert.ok(held, 'the no-match row is in the quarantine')
        assert.match(held.messages.join(' '), /No match in lane_orgs for org_code "ORG_NEW"/)
        await pool.query(`INSERT INTO ${S}.lane_orgs VALUES ('ORG_NEW', 'New unit')`)
        await fixRow({ id: held.id, row: held.row })
        const [outcome] = await replayRows([held.id])
        assert.equal(outcome.status, 'queued', outcome.message)
        takeAfterCallbacks()
        await processJobs({})
        const replay = await getRunStatus(outcome.runId)
        assert.equal(replay.status, 'success', replay.errorMessage ?? '')
        assert.equal(replay.recordsSuccess, 1)
        const e7 = (await one('E0007'))[0]
        assert.deepEqual([e7?.org_name, Number(e7?.salary)], ['New unit', 1006])
        assert.equal((await db.select().from(pipelineStageTables).where(eq(pipelineStageTables.runId, outcome.runId))).length, 0)

        // The sweep drops staging left behind by a run that never finished.
        const stale = await createStageTable({ workspaceId: adminWs, runId: `${RUN}_stale`, nodeId: 'j' })
        await db.update(pipelineStageTables).set({ createdAt: new Date(Date.now() - 49 * 3_600_000) }).where(eq(pipelineStageTables.tableName, stale))
        assert.ok((await sweepStageTables()) >= 1)
        assert.equal((await pool.query(`SELECT to_regclass($1) AS r`, [`nexus_stage.${stale}`])).rows[0].r, null)
      } finally {
        await api.stop()
        if (prevFlag === undefined) delete process.env.NEXUS_ALLOW_PRIVATE_URLS
        else process.env.NEXUS_ALLOW_PRIVATE_URLS = prevFlag
      }
    })

    await test('blocking steps: headcount per org per month to a dataset and a KMPlus product; dedupe keeps the latest record and flags the rest; aggregates refuse incremental reads', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const prevFlag = process.env.NEXUS_ALLOW_PRIVATE_URLS
      process.env.NEXUS_ALLOW_PRIVATE_URLS = 'true'
      const mock = await startKmplusMock()
      try {
        const S = `"${FIXTURE_SCHEMA}"`
        // 600 HR records for 500 people: E001–E100 appear twice; the later record moves them to another unit.
        await pool.query(`CREATE TABLE ${S}.hr_records (id int PRIMARY KEY, employee_code text, org_code text, status text, hired date, updated_at timestamptz)`)
        await pool.query(
          `INSERT INTO ${S}.hr_records
           SELECT g, CASE WHEN g > 500 THEN lower('E' || lpad((g - 500)::text, 3, '0')) ELSE 'E' || lpad(g::text, 3, '0') END,
                  'ORG' || (CASE WHEN g > 500 THEN g + 1 ELSE g END % 5),
                  CASE WHEN g % 4 = 0 THEN 'Inactive' ELSE 'Active' END,
                  date '2026-01-01' + ((g % 180) * interval '1 day'),
                  timestamptz '2026-10-01' + g * interval '1 minute'
           FROM generate_series(1, 600) g`
        )
        const kmplusId = await createDataSource({ name: `${RUN} PMS`, type: 'kmplus', sourceType: 'kmplus', config: { role: 'destination' }, credentials: { product: 'PMS', baseUrl: mock.baseUrl, apiToken: mock.token } })
        const definition = (mode: 'full' | 'incremental') => ({
          schemaVersion: 2,
          nodes: [
            { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'hr_records', maxRows: 100_000, mode, watermarkColumn: mode === 'incremental' ? 'updated_at' : '' },
            { id: 'dd', type: 'dedupe', position: { x: 300, y: 0 }, keys: ['employee_code'], keep: 'most_recent', recentBy: 'updated_at' },
            { id: 'agg', type: 'aggregate', position: { x: 600, y: 0 }, groupBy: ['org_code'], timeGrain: { column: 'hired', grain: 'month', as: 'month' }, measures: [
              { name: 'headcount', fn: 'count' },
              { name: 'active_headcount', fn: 'count', condition: { match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'Active' }] } },
            ] },
            { id: 'ds', type: 'destination', position: { x: 900, y: 0 }, kind: 'dataset', datasetName: `${RUN}_headcount`, mode: 'replace', keys: [] },
            { id: 'm', type: 'map', position: { x: 900, y: 200 }, keepUnmapped: true, fields: [{ from: 'org_code', to: 'org_month', type: 'text', transforms: [{ fn: 'concat', args: ['{org_code}-{month}'] }] }] },
            { id: 'pms', type: 'destination', position: { x: 1200, y: 200 }, kind: 'datasource', dataSourceId: kmplusId, table: 'org_headcount', mode: 'upsert', keys: ['org_month'] },
          ],
          edges: [{ id: 'e1', from: 's', to: 'dd' }, { id: 'e2', from: 'dd', to: 'agg' }, { id: 'e3', from: 'agg', to: 'ds' }, { id: 'e4', from: 'agg', to: 'm' }, { id: 'e5', from: 'm', to: 'pms' }],
          settings: { batchSize: 500, retries: 0 },
        })
        await rejectsWith(() => savePipeline({ publish: true, name: `${RUN} headcount (incremental)`, definition: definition('incremental'), schedule: { type: 'manual' } as never }), /needs a full read/)

        const saved = await savePipeline({ publish: true, name: `${RUN} headcount`, definition: definition('full'), schedule: { type: 'manual' } as never })
        const run = await runPipelineNow(saved.id)
        takeAfterCallbacks()
        // One chunk per invocation: two source chunks, then the finish passes of Deduplicate and Aggregate.
        for (let i = 0; i < 20; i++) {
          const [job] = await db.select({ status: pipelineJobs.status }).from(pipelineJobs).where(eq(pipelineJobs.id, run.runId))
          if (job.status === 'done') break
          await processJobs({ maxChunksPerSlice: 1, maxJobs: 1 })
        }
        const done = await getRunStatus(run.runId)
        assert.equal(done.status, 'success', done.errorMessage ?? '')
        assert.equal(done.recordsProcessed, 600)

        const { rows: expected } = await pool.query<{ org_code: string; month: string; headcount: number; active_headcount: number }>(
          `WITH latest AS (SELECT DISTINCT ON (lower(btrim(employee_code))) * FROM ${S}.hr_records ORDER BY lower(btrim(employee_code)), updated_at DESC)
           SELECT org_code, to_char(date_trunc('month', hired), 'YYYY-MM-DD') AS month, count(*)::int AS headcount, (count(*) FILTER (WHERE status = 'Active'))::int AS active_headcount
             FROM latest GROUP BY 1, 2 ORDER BY 1, 2`
        )
        const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_headcount`)))
        assert.deepEqual((ds.columns as { name: string; type: string }[]).map((c) => `${c.name}:${c.type}`), ['org_code:text', 'month:date', 'headcount:integer', 'active_headcount:integer'])
        const { rows: written } = await pool.query(`SELECT org_code, to_char(month, 'YYYY-MM-DD') AS month, headcount::int, active_headcount::int FROM "nexus_data"."${ds.tableName}" ORDER BY 1, 2`)
        assert.deepEqual(written, expected, 'headcount per org per month, counted over the latest record of each person')
        assert.equal(expected.reduce((n, r) => n + r.headcount, 0), 500)
        const product = mock.store.get('org_headcount')!
        assert.equal(product.size, expected.length, 'every group sent to the KMPlus product')
        assert.deepEqual(product.get(`${expected[0].org_code}-${expected[0].month}`)?.headcount, expected[0].headcount)

        // 100 removed duplicates are listed as flags (nothing held), each naming the record kept.
        const flags = await listQuarantine({ pipelineId: saved.id, kind: 'flag' })
        assert.equal(flags.total, 100)
        const e001 = flags.rows.find((r) => r.row.employee_code === 'E001')!
        assert.match(e001.messages[0], /^Duplicate of employee_code "E001" removed; kept the one with updated_at /)
        assert.equal(done.recordsError, 0, 'flags are not errors')
        const details = (await db.select({ d: executionLogs.executionDetails }).from(executionLogs).where(eq(executionLogs.id, run.runId)))[0].d as { steps: { id: string; rowsIn: number; rowsOut: number; flagged?: number }[] }
        const dd = details.steps.find((s) => s.id === 'dd')!
        assert.deepEqual([dd.rowsIn, dd.rowsOut, dd.flagged], [600, 500, 100])
        assert.equal(details.steps.find((s) => s.id === 'agg')!.rowsOut, expected.length)
        assert.equal((await db.select().from(pipelineStageTables).where(eq(pipelineStageTables.runId, run.runId))).length, 0, 'staging dropped')

        // Test on sample: aggregated over the sample only.
        const sample = await testPipeline(definition('full'))
        assert.ok(sample.ok && sample.result.steps.find((s) => s.id === 'agg')!.rowsOut > 0)
      } finally {
        await mock.stop()
        if (prevFlag === undefined) delete process.env.NEXUS_ALLOW_PRIVATE_URLS
        else process.env.NEXUS_ALLOW_PRIVATE_URLS = prevFlag
      }
    })

    await test('API calls: Enrich of 5,000 rows uses the cache on the second run; create-then-continue survives a forced retry and a replay without a duplicate', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const prevFlag = process.env.NEXUS_ALLOW_PRIVATE_URLS
      process.env.NEXUS_ALLOW_PRIVATE_URLS = 'true'
      const api = await startRestWriteMock()
      try {
        const S = `"${FIXTURE_SCHEMA}"`
        await pool.query(`CREATE TABLE ${S}.staff (id int PRIMARY KEY, code text)`)
        await pool.query(`INSERT INTO ${S}.staff SELECT g, 'E' || lpad(g::text, 4, '0') FROM generate_series(1, 5000) g`)
        // The HR API knows every employee except the last 40.
        for (let g = 1; g <= 4960; g++) api.details.set(`E${String(g).padStart(4, '0')}`, { grade: `G${g % 9}`, allowance: g * 1000 })
        const apiSource = await createDataSource({ name: `${RUN} HR details API`, type: 'rest', sourceType: 'rest', config: { role: 'source' }, credentials: { baseUrl: api.baseUrl, authMethod: 'bearer', bearerToken: api.token } })

        const enrichDef = {
          schemaVersion: 2,
          nodes: [
            { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'staff', maxRows: 100_000 },
            { id: 'en', type: 'enrich', position: { x: 300, y: 0 }, dataSourceId: apiSource, method: 'GET', path: '/details', mode: 'query', keyColumn: 'code', queryParam: 'codes', matchField: 'code', batchSize: 100, maxRequestsPerSecond: 50, concurrency: 4,
              answer: { listPath: 'items', fields: [{ path: 'grade', as: 'grade', type: 'text' }, { path: 'allowance', as: 'allowance', type: 'numeric' }] } },
            { id: 'd', type: 'destination', position: { x: 600, y: 0 }, kind: 'dataset', datasetName: `${RUN}_staff_details`, mode: 'replace' },
          ],
          edges: [{ id: 'e1', from: 's', to: 'en' }, { id: 'e2', from: 'en', to: 'd' }],
          settings: { retries: 0 },
        }
        const enrich = await savePipeline({ publish: true, name: `${RUN} enrich`, definition: enrichDef, schedule: { type: 'manual' } as never })
        const runOnce = async (id: string) => {
          const run = await runPipelineNow(id)
          takeAfterCallbacks()
          for (let i = 0; i < 10; i++) {
            const [job] = await db.select({ status: pipelineJobs.status }).from(pipelineJobs).where(eq(pipelineJobs.id, run.runId))
            if (job.status === 'done') break
            await processJobs({})
          }
          const status = await getRunStatus(run.runId)
          const details = (await db.select({ d: executionLogs.executionDetails }).from(executionLogs).where(eq(executionLogs.id, run.runId)))[0].d as { steps: { id: string; calls?: number; cached?: number }[]; log: { message: string }[] }
          return { status, details, runId: run.runId }
        }
        const calls = () => api.received.filter((r) => r.path.startsWith('/details')).length
        const first = await runOnce(enrich.id)
        assert.equal(first.status.status, 'success', first.status.errorMessage ?? '')
        assert.equal(calls(), 50, '5,000 keys in batches of 100')
        assert.deepEqual([first.details.steps.find((s) => s.id === 'en')!.calls, first.details.steps.find((s) => s.id === 'en')!.cached], [50, 0])
        const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_staff_details`)))
        const { rows: sample } = await pool.query(`SELECT code, grade, allowance::numeric AS allowance FROM "nexus_data"."${ds.tableName}" WHERE code IN ('E0010', 'E4999') ORDER BY code`)
        assert.deepEqual(sample.map((r) => [r.code, r.grade, Number(r.allowance) || null]), [['E0010', 'G1', 10000], ['E4999', null, null]], 'unknown employees kept with empty values')
        const [cachedRow] = await db.select().from(apiCallCache).where(eq(apiCallCache.pipelineId, enrich.id)).limit(1)
        assert.equal((cachedRow.value as { __enc?: string }).__enc, 'v2', 'cached answers are sealed')
        assert.ok(!JSON.stringify(cachedRow.value).includes('allowance'), 'no plain values in the cache')

        const second = await runOnce(enrich.id)
        assert.equal(second.status.status, 'success')
        assert.equal(calls(), 50, 'the second run asks the API nothing')
        assert.deepEqual([second.details.steps.find((s) => s.id === 'en')!.calls, second.details.steps.find((s) => s.id === 'en')!.cached], [0, 5000])
        assert.ok(second.details.log.some((l) => /5,000 of 5,000 from cache · 0 calls/.test(l.message)), 'the run log says how much came from the cache')
        assert.equal((await clearStepCache(enrich.id, 'en')).removed, 5000)

        // "Changes data": create each new hire's account, keep the returned id.
        await pool.query(`CREATE TABLE ${S}.new_hires (id int PRIMARY KEY, email text, name text)`)
        await pool.query(`INSERT INTO ${S}.new_hires SELECT g, 'hire' || g || '@kmplus.test', CASE WHEN g = 13 THEN '' ELSE 'Hire ' || g END FROM generate_series(1, 30) g`)
        const usersApi = await createDataSource({ name: `${RUN} accounts API`, type: 'rest', sourceType: 'rest', config: { role: 'destination' }, credentials: { baseUrl: api.baseUrl, authMethod: 'bearer', bearerToken: api.token } })
        const body = { format: 'json', template: { t: 'object', fields: [{ key: 'email', node: { t: 'value', binding: { kind: 'column', column: 'email' } } }, { key: 'name', node: { t: 'value', binding: { kind: 'column', column: 'name' } } }] } }
        const callDef = (update: boolean) => ({
          schemaVersion: 2,
          nodes: [
            { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'new_hires' },
            { id: 'ac', type: 'apicall', position: { x: 300, y: 0 }, dataSourceId: usersApi, keys: ['email'], create: { method: 'POST', path: '/users', body }, ...(update ? { update: { method: 'PUT', path: '/users/{{user_id}}', body } } : {}),
              answer: { fields: [{ path: 'user.id', as: 'user_id', type: 'text' }] }, maxRequestsPerSecond: 50 },
            { id: 'd', type: 'destination', position: { x: 600, y: 0 }, kind: 'dataset', datasetName: `${RUN}_accounts`, mode: 'upsert', keys: ['email'] },
          ],
          edges: [{ id: 'e1', from: 's', to: 'ac' }, { id: 'e2', from: 'ac', to: 'd' }],
          settings: { retries: 2, retryDelaySeconds: 5 },
        })
        const accounts = await savePipeline({ publish: true, name: `${RUN} accounts`, definition: callDef(false), schedule: { type: 'manual' } as never })
        // Forced stop: after 10 accounts the API is down long enough for the chunk to fail.
        api.failNext(4, 503, undefined, 10)
        const run = await runPipelineNow(accounts.id)
        takeAfterCallbacks()
        await processJobs({ maxJobs: 1 })
        const [job] = await db.select().from(pipelineJobs).where(eq(pipelineJobs.id, run.runId))
        assert.equal(job.status, 'queued', 'the chunk failed and the run waits to retry from its checkpoint')
        assert.equal(api.users.size, 10)
        assert.equal((await db.select().from(apiCallLedger).where(eq(apiCallLedger.pipelineId, accounts.id))).length, 10, 'calls that went through are in the ledger')
        await db.update(pipelineJobs).set({ availableAt: new Date() }).where(eq(pipelineJobs.id, run.runId))
        for (let i = 0; i < 5; i++) {
          const [j] = await db.select({ status: pipelineJobs.status }).from(pipelineJobs).where(eq(pipelineJobs.id, run.runId))
          if (j.status === 'done') break
          await processJobs({})
        }
        const done = await getRunStatus(run.runId)
        assert.equal(done.status, 'partial', done.errorMessage ?? '')
        assert.equal(api.users.size, 29, 'every account but the one without a name')
        assert.ok([...api.created.values()].every((n) => n === 1), 'no account was created twice')
        const idempotency = api.received.filter((r) => r.path === '/users').map((r) => r.idempotencyKey)
        assert.ok(idempotency.every((k) => k && k.startsWith(`${accounts.id}:ac:`)), 'every call carries a stable idempotency key')
        const { rows: written } = await pool.query(`SELECT email, user_id FROM "nexus_data"."${(await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_accounts`))))[0].tableName}" ORDER BY email`)
        assert.equal(written.length, 29)
        assert.ok(written.every((r) => /^U\d{4}$/.test(r.user_id)), 'the returned id continues to the dataset')

        // The refused row (no name) is fixed and replayed: one more account, still no duplicates.
        const [held] = (await listQuarantine({ pipelineId: accounts.id, kind: 'invalid' })).rows
        assert.match(held.messages[0], /^POST \/users: The API refused the request \(HTTP 422\): name is required/)
        await fixRow({ id: held.id, row: { ...held.row, name: 'Hire 13' } })
        const [replay] = await replayRows([held.id])
        takeAfterCallbacks()
        await processJobs({})
        assert.equal((await getRunStatus(replay.runId)).recordsSuccess, 1)
        assert.equal(api.users.size, 30)
        // A full run again: every record is known and unchanged, nothing is sent.
        const before = api.received.length
        await pool.query(`UPDATE ${S}.new_hires SET name = 'Hire 13' WHERE id = 13`)
        const again = await runOnce(accounts.id)
        assert.equal(again.status.status, 'success', again.status.errorMessage ?? '')
        assert.equal(api.received.length, before, 'known records without an update request are skipped')
        // With an update request, a changed name is sent once as PUT /users/<id from the create answer>.
        await savePipeline({ id: accounts.id, publish: true, name: `${RUN} accounts`, definition: callDef(true), schedule: { type: 'manual' } as never })
        await pool.query(`UPDATE ${S}.new_hires SET name = 'Renamed' WHERE id = 1`)
        await runOnce(accounts.id)
        const puts = api.received.slice(before).filter((r) => r.method === 'PUT')
        assert.equal(puts.length, 1)
        assert.ok([...api.users.values()].some((u) => u.name === 'Renamed'))
        assert.ok([...api.created.values()].every((n) => n === 1), 'still no duplicates')
      } finally {
        await api.stop()
        if (prevFlag === undefined) delete process.env.NEXUS_ALLOW_PRIVATE_URLS
        else process.env.NEXUS_ALLOW_PRIVATE_URLS = prevFlag
      }
    })

    await test('Phase D: two pipelines fill one defined dataset column by column; a rename keeps Data API clients working; the banner defines inferred datasets in place', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const S = `"${FIXTURE_SCHEMA}"`
      await pool.query(`CREATE TABLE ${S}.hris_people (id text PRIMARY KEY, nama text, hired date, shoe int)`)
      await pool.query(`INSERT INTO ${S}.hris_people VALUES ('E1', 'Ani', '2024-01-15', 38), ('E2', 'Budi', '2023-06-01', 42), ('E3', 'Citra', '2022-03-10', 37), ('E4', '', '2025-02-01', 40)`)
      await pool.query(`CREATE TABLE ${S}.lms_hours (emp text PRIMARY KEY, hours numeric)`)
      await pool.query(`INSERT INTO ${S}.lms_hours VALUES ('E1', 12.5), ('E2', 3), ('E3', 40)`)
      const name = `${RUN}_profile`
      await defineDatasetSchema({
        datasetName: name,
        from: 'schema',
        schema: { columns: [{ name: 'employee_code', type: 'text', required: true }, { name: 'full_name', type: 'text', required: true }, { name: 'hire_date', type: 'date' }, { name: 'training_hours', type: 'numeric' }], keys: ['employee_code'] },
      })
      const col = (column: string) => ({ kind: 'column', column })
      const pipe = (label: string, table: string, columnMap: { target: string; binding: unknown }[], extra: object = {}) =>
        savePipeline({
          publish: true,
          name: `${RUN} ${label}`,
          definition: {
            schemaVersion: 2,
            nodes: [
              { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table },
              { id: 'd', type: 'destination', position: { x: 300, y: 0 }, kind: 'dataset', datasetName: name, mode: 'upsert', keys: ['employee_code'], columnMap, ...extra },
            ],
            edges: [{ id: 'e', from: 's', to: 'd' }],
            settings: { retries: 0 },
          },
          schedule: { type: 'manual' } as never,
        })
      const hris = await pipe('hris profile', 'hris_people', [{ target: 'employee_code', binding: col('id') }, { target: 'full_name', binding: col('nama') }, { target: 'hire_date', binding: col('hired') }], { dropExtra: true })
      const lms = await pipe('lms hours', 'lms_hours', [{ target: 'employee_code', binding: col('emp') }, { target: 'training_hours', binding: col('hours') }])
      const runOnce = async (id: string) => {
        const r = await runPipelineNow(id)
        takeAfterCallbacks()
        for (let i = 0; i < 5; i++) {
          const [job] = await db.select({ status: pipelineJobs.status }).from(pipelineJobs).where(eq(pipelineJobs.id, r.runId))
          if (job.status === 'done') break
          await processJobs({})
        }
        return getRunStatus(r.runId)
      }
      const first = await runOnce(hris.id)
      assert.equal(first.status, 'partial', 'E4 has no name: held by the schema')
      const [held] = (await listQuarantine({ pipelineId: hris.id, kind: 'invalid' })).rows
      assert.deepEqual(held.messages, ['full_name is required by the dataset schema'])
      assert.equal((await runOnce(lms.id)).status, 'success')
      // HRIS again: its upsert leaves the LMS column alone.
      await runOnce(hris.id)
      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, name)))
      assert.ok(ds.defined)
      const read = async () => (await pool.query(`SELECT * FROM "nexus_data"."${ds.tableName}" WHERE "_nexus_deleted_at" IS NULL ORDER BY employee_code`)).rows
      const rows = await read()
      assert.deepEqual(rows.map((r) => [r.employee_code, r.full_name, Number(r.training_hours)]), [['E1', 'Ani', 12.5], ['E2', 'Budi', 3], ['E3', 'Citra', 40]])
      assert.ok(!('shoe' in rows[0]), 'extra columns are not written')
      const page = await getDatasetSchema(name)
      assert.deepEqual(page.owners.byColumn, { employee_code: [`${RUN} hris profile`, `${RUN} lms hours`], full_name: [`${RUN} hris profile`], hire_date: [`${RUN} hris profile`], training_hours: [`${RUN} lms hours`] })

      // A Data API client reading training_hours keeps working after the rename, told about the new name.
      const { key } = await createApiKey({ name: `${RUN} schema reader`, role: 'steward', scopes: ['datasets:read'] })
      const get = async (path: string) => {
        const res = await (getDataset as never as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>)(new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ name }) })
        return { res, body: (await res.json()) as { data: Record<string, unknown>[]; meta: Record<string, unknown>; error?: { message: string } } }
      }
      const preview = await previewSchemaChange({ datasetName: name, ops: [{ kind: 'rename', from: 'training_hours', to: 'learning_hours' }] })
      assert.ok(preview.destructive)
      assert.deepEqual(preview.usage!.pipelines.sort(), [`${RUN} hris profile`, `${RUN} lms hours`])
      const changed = await changeDatasetSchema({ datasetName: name, ops: [{ kind: 'rename', from: 'training_hours', to: 'learning_hours' }] })
      assert.equal(changed.version, 2)
      assert.ok(changed.moved.pipelines.includes(`${RUN} lms hours`), 'the LMS mapping moves to the new name (as a draft)')
      const old = await get(`/api/v1/datasets/${name}?fields=employee_code,training_hours&limit=10`)
      assert.equal(old.res.status, 200, old.body.error?.message)
      assert.deepEqual(old.body.data.map((r) => [r.employee_code, Number(r.training_hours)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), [['E1', 12.5], ['E2', 3], ['E3', 40]])
      assert.equal(old.res.headers.get('Deprecation'), 'true')
      assert.equal(old.res.headers.get('X-Nexus-Renamed-Fields'), 'training_hours=learning_hours')
      const sunset = new Date(old.res.headers.get('Sunset')!).getTime()
      assert.ok(Math.abs(sunset - (Date.now() + 30 * 86_400_000)) < 120_000, 'the alias lasts 30 days')
      assert.equal((await get(`/api/v1/datasets/${name}?fields=learning_hours&limit=1`)).res.status, 200)
      // The published LMS version still maps training_hours: its next run follows the rename.
      await pool.query(`UPDATE ${S}.lms_hours SET hours = 13 WHERE emp = 'E1'`)
      assert.equal((await runOnce(lms.id)).status, 'success')
      assert.equal(Number((await read())[0].learning_hours), 13)
      // After 30 days the old name is gone.
      await db.update(datasetColumnAliases).set({ expiresAt: new Date(Date.now() - 1000) }).where(and(eq(datasetColumnAliases.workspaceId, adminWs), eq(datasetColumnAliases.datasetName, name)))
      assert.equal((await get(`/api/v1/datasets/${name}?fields=training_hours`)).res.status, 400)
      const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, adminWs), eq(auditLogs.action, 'SCHEMA_CHANGE'), eq(auditLogs.resourceId, name)))
      assert.equal(audits.length, 2)

      // The upgrade banner: an inferred dataset becomes defined from its current columns, rows untouched.
      const inferred = `${RUN}_employees`
      const notices = await getUpgradeNotices()
      assert.ok(notices.some((n) => n.id === 'defined-schemas' && n.count > 0))
      const list = await listInferredDatasets()
      assert.ok(list.some((d) => d.name === inferred) && !list.some((d) => d.name === name))
      const [before] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, inferred)))
      const idsBefore = (await pool.query(`SELECT "_nexus_id", "_nexus_loaded_at" FROM "nexus_data"."${before.tableName}" ORDER BY 1`)).rows
      assert.equal((await defineFromCurrentColumns([inferred])).defined, 1)
      const idsAfter = (await pool.query(`SELECT "_nexus_id", "_nexus_loaded_at" FROM "nexus_data"."${before.tableName}" ORDER BY 1`)).rows
      assert.deepEqual(idsAfter, idsBefore, 'nothing was reloaded')
      const defined = await getDatasetSchema(inferred)
      assert.ok(defined.defined)
      assert.deepEqual(defined.schema!.columns.map((c) => c.name), (before.columns as { name: string }[]).map((c) => c.name))
      await dismissUpgradeNotice('defined-schemas')
      assert.ok(!(await getUpgradeNotices()).some((n) => n.id === 'defined-schemas'), 'dismissed for this person')
      await db.delete(upgradeNoticeDismissals).where(eq(upgradeNoticeDismissals.workspaceId, adminWs))
      // A viewer can read a schema but not change it.
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      assert.equal((await getDatasetSchema(name)).canEdit, false)
      await rejectsWith(() => changeDatasetSchema({ datasetName: name, ops: [{ kind: 'autoAdd', on: true }] }), /permission|not allowed|role/i)
      setTestUser(admin)
      await switchWorkspace(adminWs)
    })

    await test('DS-7 / DS-8: health checks keep a history and alert on failure and recovery; a re-scan flags a removed column a pipeline reads', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const S = `"${FIXTURE_SCHEMA}"`
      await pool.query(`CREATE TABLE ${S}.drift_probe (id int PRIMARY KEY, code text, legacy_grade text)`)
      await pool.query(`INSERT INTO ${S}.drift_probe VALUES (1, 'E1', 'A'), (2, 'E2', 'B')`)
      // A fresh scan that includes the new table, then a pipeline that names its column.
      const first = await testConnection(sourceId)
      assert.ok(first.tables > 0)
      // Earlier tests changed the fixture schema; start from a reviewed state.
      await reviewSchemaDrift(sourceId)
      const probe = await savePipeline({
        publish: true,
        name: `${RUN} drift probe`,
        definition: {
          steps: [
            { id: 's', type: 'source', dataSourceId: sourceId, table: 'drift_probe' },
            { id: 'm', type: 'map', fields: [{ from: 'code', to: 'code', transforms: [] }, { from: 'legacy_grade', to: 'grade', transforms: [] }] },
            { id: 'd', type: 'destination', kind: 'dataset', datasetName: `${RUN}_drift`, mode: 'replace' },
          ],
        },
        schedule: { type: 'manual' } as never,
      })
      let health = await getSourceHealth(sourceId)
      assert.equal(health.status, 'connected')
      assert.ok(health.checks.length >= 1 && health.checks[0].ok && health.checks[0].trigger === 'manual' && health.checks[0].scanned)
      assert.equal(health.drift, null)
      assert.equal(health.intervalMinutes, 15)

      // The column goes away in the source: the next scan finds it and names the pipeline.
      await pool.query(`ALTER TABLE ${S}.drift_probe DROP COLUMN legacy_grade`)
      const second = await testConnection(sourceId)
      assert.equal(second.drift, 1)
      health = await getSourceHealth(sourceId)
      assert.deepEqual(health.drift!.changes, [{ kind: 'column_removed', table: 'drift_probe', column: 'legacy_grade' }])
      assert.deepEqual(health.drift!.affected, [{ pipelineId: probe.id, name: `${RUN} drift probe`, changes: ['drift_probe.legacy_grade removed'] }])
      assert.ok((await db.select().from(notifications).where(and(eq(notifications.userId, admin.id), eq(notifications.workspaceId, adminWs)))).some((n) => n.title === `Schema changed in ${RUN} fixture`))
      assert.ok((await getDataSources()).find((s) => s.id === sourceId)!.schemaDrift, 'the list marks the source')
      await reviewSchemaDrift(sourceId)
      assert.equal((await getSourceHealth(sourceId)).drift, null)

      // Interval: one of the listed values; off clears the next check.
      await rejectsWith(() => setHealthCheckInterval(sourceId, 7), /listed intervals/)
      await setHealthCheckInterval(sourceId, 0)
      assert.equal((await getSourceHealth(sourceId)).nextCheckAt, null)
      await setHealthCheckInterval(sourceId, 5)

      // The scheduler checks due sources; a failure marks the source and alerts once, a pass clears it.
      const [row] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId))
      await db.update(dataSources).set({ nextHealthCheckAt: new Date(Date.now() - 1000), credentials: encryptCredentials(sourceId, { connectionString: 'postgres://nobody:wrong@127.0.0.1:1/none', schema: FIXTURE_SCHEMA }, adminWs) }).where(eq(dataSources.id, sourceId))
      assert.equal(await runDueHealthChecks({ workspaceId: adminWs }), 1)
      let [after] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId))
      assert.equal(after.status, 'error')
      assert.equal(after.healthFailures, 1)
      assert.ok(after.nextHealthCheckAt! > new Date(), 'the next check is scheduled')
      const failing = await checkSourceHealth(after, { trigger: 'schedule' })
      assert.equal(failing.ok, false)
      const alerts = (await db.select().from(notifications).where(and(eq(notifications.userId, admin.id), eq(notifications.workspaceId, adminWs)))).filter((n) => n.title === `${RUN} fixture is not reachable`)
      assert.equal(alerts.length, 1, 'one alert for a run of failures')
      await db.update(dataSources).set({ credentials: row.credentials }).where(eq(dataSources.id, sourceId))
      ;[after] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId))
      assert.equal((await checkSourceHealth(after, { trigger: 'schedule' })).ok, true)
      ;[after] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId))
      assert.equal(after.status, 'connected')
      assert.equal(after.healthFailures, 0)
      assert.ok((await db.select().from(notifications).where(and(eq(notifications.userId, admin.id), eq(notifications.workspaceId, adminWs)))).some((n) => n.title === `${RUN} fixture is reachable again`))
      health = await getSourceHealth(sourceId)
      assert.ok(health.checks.filter((c) => c.trigger === 'schedule').length >= 3)
      assert.ok(health.day.checks >= 5 && health.day.percent! < 100)
      // A viewer reads health but can't change it.
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      assert.ok((await getSourceHealth(sourceId)).checks.length)
      await rejectsWith(() => reviewSchemaDrift(sourceId), /permission|role/i)
      setTestUser(admin)
      await switchWorkspace(adminWs)
    })

    await test('MN-7: run logs lose their detail after the detail period and are removed after the summary period, unless rows still wait in Data quality', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await rejectsWith(() => setLogRetention({ logDetailDays: 90, runSummaryDays: 90 + 1 }), /listed periods/)
      const [{ id: anyPipeline }] = await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.workspaceId, adminWs)).limit(1)
      const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000)
      const run = async (id: string, age: number) =>
        db.insert(executionLogs).values({ id: `${RUN}_${id}`, userId: admin.id, workspaceId: adminWs, pipelineId: anyPipeline, status: 'failed', trigger: 'manual', errorMessage: 'boom', startTime: daysAgo(age), endTime: daysAgo(age), createdAt: daysAgo(age), executionDetails: { steps: [{ id: 's', rowsIn: 5 }], log: [{ at: 'x', level: 'error', message: 'boom' }], errorStack: 'Error: boom' } })
      await run('fresh', 2)
      await run('month', 40)
      await run('ancient', 400)
      await run('held', 400)
      await db.insert(pipelineRunRejects).values({ id: `${RUN}_rej`, workspaceId: adminWs, pipelineId: anyPipeline, runId: `${RUN}_held`, userId: admin.id, row: { id: 1 }, errors: ['x'], status: 'open' })
      await setLogRetention({ logDetailDays: 30, runSummaryDays: 365 })
      const result = await pruneWorkspaceLogs(adminWs, 30, 365)
      assert.ok(result.trimmed >= 1 && result.deleted >= 1)
      const rows = await db.select().from(executionLogs).where(inArray(executionLogs.id, [`${RUN}_fresh`, `${RUN}_month`, `${RUN}_ancient`, `${RUN}_held`]))
      const byId = new Map(rows.map((r) => [r.id.replace(`${RUN}_`, ''), r.executionDetails as Record<string, unknown>]))
      assert.ok(Array.isArray(byId.get('fresh')!.log) && byId.get('fresh')!.errorStack, 'a recent run keeps its detail')
      assert.ok(!byId.get('month')!.log && !byId.get('month')!.errorStack && byId.get('month')!.detailsPrunedAt, 'an older run keeps only its summary')
      assert.deepEqual(byId.get('month')!.steps, [{ id: 's', rowsIn: 5 }], 'step totals stay')
      assert.ok(!byId.has('ancient'), 'past the summary period the run is gone')
      assert.ok(byId.has('held'), 'a run with rows still open in Data quality is kept')
      await db.delete(pipelineRunRejects).where(eq(pipelineRunRejects.id, `${RUN}_rej`))
      assert.deepEqual(await getLogRetention().then((r) => [r.logDetailDays, r.runSummaryDays]), [30, 365])
    })

    await test('VC-5: a pipeline exports as JSON (no credentials) and imports as an unpublished draft with its references mapped', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const original = (await listPipelines()).find((p) => p.name === `${RUN} lms hours`)!
      const { fileName, json } = await exportPipeline(original.id)
      assert.equal(fileName, `${RUN}-lms-hours.nexus-pipeline.json`)
      const file = JSON.parse(json)
      assert.equal(file.format, 'kmplus-nexus/pipeline')
      assert.deepEqual(file.references.dataSources.map((d: { name: string }) => d.name), [`${RUN} fixture`])
      assert.ok(!json.includes(process.env.DATABASE_URL!.split('@')[0]), 'no credentials in the file')
      assert.deepEqual(file.schemas.map((s: { datasetName: string }) => s.datasetName), [`${RUN}_profile`])

      const preview = await previewImport({ json })
      assert.equal(preview.name, `${RUN} lms hours (imported)`)
      assert.deepEqual(preview.blocking, [])
      assert.deepEqual(preview.sources.map((s) => [s.name, s.targetId]), [[`${RUN} fixture`, sourceId]])
      assert.deepEqual(preview.schemas, [{ datasetName: `${RUN}_profile`, status: 'same' }])
      await rejectsWith(() => importPipeline({ json, name: `${RUN} lms hours` }), /already exists here/)
      await rejectsWith(() => previewImport({ json: '{"format":"x"}' }), /not a Nexus pipeline export/)

      const imported = await importPipeline({ json })
      const [row] = await db.select().from(pipelines).where(eq(pipelines.id, imported.id))
      assert.equal(row.version, 0, 'not published')
      assert.equal(row.enabled, false)
      assert.equal(row.workspaceId, adminWs)
      const src = (row.draftConfig as { nodes: { type: string; dataSourceId?: string }[] }).nodes.find((n) => n.type === 'source')!
      assert.equal(src.dataSourceId, sourceId)
      const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, adminWs), inArray(auditLogs.action, ['EXPORT', 'IMPORT'])))
      assert.deepEqual(audits.map((a) => a.action).sort(), ['EXPORT', 'IMPORT'])
      // Viewers can export (read) but not import.
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      assert.ok((await exportPipeline(original.id)).json.length > 100)
      await rejectsWith(() => importPipeline({ json }), /permission|role/i)
      setTestUser(admin)
      await switchWorkspace(adminWs)
    })

    await test('DB-4: dashboard filters apply to every widget that has the column; value choices come from the data; saving widgets keeps the filters', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const ds = `${RUN}_profile`
      const kpi = { id: 'w1', title: 'People', type: 'kpi' as const, dataset: ds, measure: { agg: 'count' as const, column: '' } }
      const filters = [
        { id: 'p', label: 'Hired', kind: 'date' as const, column: 'hire_date' },
        { id: 'c', label: 'Code', kind: 'value' as const, column: 'employee_code' },
        { id: 'x', label: 'Other', kind: 'value' as const, column: 'not_here' },
      ]
      const { id } = await saveDashboard({ name: `${RUN} filtered`, widgets: [kpi], filters })
      assert.deepEqual((await getDashboardFilterOptions(id)).c, ['E1', 'E2', 'E3'])
      const count = async (values: Record<string, unknown>) => {
        const r = (await getDashboardData(id, values)).results.w1
        assert.ok(r.ok, r.ok ? '' : r.message)
        return r.ok ? r.result : null
      }
      assert.equal((await count({}))!.rows[0].value, 3)
      const since2023 = await count({ p: { preset: 'custom', from: '2023-01-01' } })
      assert.equal(since2023!.rows[0].value, 2)
      assert.deepEqual(since2023!.filtersApplied, ['p'])
      assert.equal((await count({ c: { value: 'E1' }, p: { preset: 'custom', from: '2023-01-01' } }))!.rows[0].value, 1)
      const missing = await count({ x: { value: 'y' } })
      assert.equal(missing!.rows[0].value, 3)
      assert.deepEqual(missing!.filtersSkipped, [{ id: 'x', reason: 'missing' }])
      // Saving widgets alone keeps the filters.
      await saveDashboard({ id, name: `${RUN} filtered`, widgets: [kpi, { ...kpi, id: 'w2' }] })
      assert.equal((await listDashboards()).dashboards.find((d) => d.id === id)!.filters.length, 3)
    })

    await test('MN-4: a failed run continues from its last checkpoint with its staging kept; the log downloads; a second continue is refused', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const S = `"${FIXTURE_SCHEMA}"`
      await pool.query(`CREATE TABLE ${S}.resume_people (id int PRIMARY KEY, org text)`)
      await pool.query(`INSERT INTO ${S}.resume_people SELECT g, 'O' || (g % 3) FROM generate_series(1, 1200) g`)
      await pool.query(`CREATE TABLE ${S}.resume_orgs (org text PRIMARY KEY, org_name text)`)
      await pool.query(`INSERT INTO ${S}.resume_orgs VALUES ('O0', 'Zero'), ('O1', 'One'), ('O2', 'Two')`)
      const dataset = `${RUN}_resumed`
      const saved = await savePipeline({
        publish: true,
        name: `${RUN} resumable`,
        definition: {
          schemaVersion: 2,
          nodes: [
            { id: 'p', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'resume_people', driver: true },
            { id: 'o', type: 'source', position: { x: 0, y: 200 }, dataSourceId: sourceId, table: 'resume_orgs' },
            { id: 'j', type: 'join', position: { x: 300, y: 0 }, keys: [{ left: 'org', right: 'org' }] },
            { id: 'd', type: 'destination', position: { x: 600, y: 0 }, kind: 'dataset', datasetName: dataset, mode: 'replace' },
          ],
          edges: [
            { id: 'e1', from: 'p', to: 'j', port: 'left' },
            { id: 'e2', from: 'o', to: 'j', port: 'right' },
            { id: 'e3', from: 'j', to: 'd' },
          ],
          settings: { batchSize: 500, retries: 0 },
        },
        schedule: { type: 'manual' } as never,
      })
      const run = await runPipelineNow(saved.id)
      takeAfterCallbacks()
      // The org lane is staged and the first chunk of people written; then the people table disappears.
      for (let i = 0; i < 4; i++) {
        await processJobs({ maxChunksPerSlice: 1, maxJobs: 1 })
        const [j] = await db.select().from(pipelineJobs).where(eq(pipelineJobs.id, run.runId))
        if (((j.progress as { passes?: Record<string, { chunks: number }> }).passes?.p?.chunks ?? 0) >= 1) break
      }
      await pool.query(`ALTER TABLE ${S}.resume_people RENAME TO resume_people_gone`)
      await processJobs({ maxJobs: 1 })
      let status = await getRunStatus(run.runId)
      assert.equal(status.status, 'failed')
      const [failedRun] = (await listRuns(saved.id, 5)).filter((r) => r.id === run.runId)
      const details = failedRun.executionDetails as { resumableUntil?: string; log?: unknown[] }
      assert.ok(details.resumableUntil && Date.parse(details.resumableUntil) > Date.now() + 47 * 3_600_000, 'resumable for 48 hours')
      assert.ok((await db.select().from(pipelineStageTables).where(eq(pipelineStageTables.runId, run.runId))).length > 0, 'the Join staging is kept')
      // The table is back: the run continues where it stopped and finishes with every row once.
      await pool.query(`ALTER TABLE ${S}.resume_people_gone RENAME TO resume_people`)
      const resumed = await retryPipelineRun(run.runId, 'resume')
      assert.equal(resumed.runId, run.runId, 'the same run continues')
      takeAfterCallbacks()
      for (let i = 0; i < 6; i++) {
        status = await getRunStatus(run.runId)
        if (status.status !== 'running' && status.status !== 'queued') break
        await processJobs({})
      }
      assert.equal(status.status, 'success', status.errorMessage ?? '')
      const [ds] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, dataset)))
      const { rows } = await pool.query(`SELECT count(*)::int AS n, count(DISTINCT id)::int AS ids, count(org_name)::int AS named FROM "nexus_data"."${ds.tableName}" WHERE "_nexus_deleted_at" IS NULL`)
      assert.deepEqual(rows[0], { n: 1200, ids: 1200, named: 1200 }, 'every row once, every row joined')
      assert.equal((await db.select().from(pipelineStageTables).where(eq(pipelineStageTables.runId, run.runId))).length, 0, 'staging dropped when the run finished')
      const [done] = (await listRuns(saved.id, 5)).filter((r) => r.id === run.runId)
      assert.equal((done.executionDetails as { resumes?: number }).resumes, 1)
      await rejectsWith(() => retryPipelineRun(run.runId, 'resume'), /no longer continue/)
      // Restart still queues a new run.
      const again = await retryPipelineRun(run.runId, 'restart')
      assert.notEqual(again.runId, run.runId)
      takeAfterCallbacks()
      await processJobs({})
    })

    await test('SC-4: maintenance windows are saved per workspace and hold scheduled runs (defer to the end, or skip to the next time)', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const [p] = await db.select().from(pipelines).where(eq(pipelines.workspaceId, adminWs)).limit(1)
      const wibLocal = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16)
      const start = wibLocal(Date.now() - 3_600_000)
      const end = wibLocal(Date.now() + 2 * 3_600_000)
      const saved = await saveMaintenanceWindow({ window: { name: `${RUN} patch`, kind: 'once', startsAt: start, endsAt: end, pipelineIds: [p.id, 'not-a-pipeline'] } })
      const listed = await listMaintenanceWindows()
      const mine = listed.windows.find((w) => w.id === saved.id)!
      assert.deepEqual(mine.pipelineIds, [p.id], 'unknown pipelines are dropped')
      assert.ok(listed.pipelines.some((x) => x.id === p.id))
      assert.ok((await db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, saved.id), eq(auditLogs.action, 'CREATE')))).length)
      await rejectsWith(() => saveMaintenanceWindow({ window: { name: 'x', kind: 'once', startsAt: end, endsAt: start } }), /must end after it starts/)

      const schedule = { type: 'daily', time: '06:00' }
      const due = { id: p.id, workspaceId: adminWs, schedule, nextRunAt: new Date(Date.now() - 60_000) }
      await db.update(pipelines).set({ nextRunAt: due.nextRunAt }).where(eq(pipelines.id, p.id))
      const held = await holdDuePipeline(due, new Date(), new Map())
      assert.match(held ?? '', /held by/)
      const [deferred] = await db.select({ nextRunAt: pipelines.nextRunAt }).from(pipelines).where(eq(pipelines.id, p.id))
      assert.equal(deferred.nextRunAt?.toISOString(), wibToDate(end).toISOString(), 'deferred to the end of the window')

      // Skip: the next scheduled time after the window; other pipelines are not held.
      await saveMaintenanceWindow({ id: saved.id, window: { ...mine, action: 'skip' } })
      await db.update(pipelines).set({ nextRunAt: due.nextRunAt }).where(eq(pipelines.id, p.id))
      assert.ok(await holdDuePipeline(due, new Date(), new Map()))
      const [skipped] = await db.select({ nextRunAt: pipelines.nextRunAt }).from(pipelines).where(eq(pipelines.id, p.id))
      assert.ok(skipped.nextRunAt! > wibToDate(end), 'skipped past the window')
      assert.equal(skipped.nextRunAt!.toISOString(), nextRunAt(scheduleSchema.parse(schedule), wibToDate(end))!.toISOString())
      assert.equal(await holdDuePipeline({ ...due, id: 'other-pipeline' }, new Date(), new Map()), null)

      setTestUser(viewer)
      await switchWorkspace(adminWs)
      assert.ok((await listMaintenanceWindows()).windows.some((w) => w.id === saved.id), 'everyone sees the windows')
      await rejectsWith(() => deleteMaintenanceWindow(saved.id), /Your role/)
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await deleteMaintenanceWindow(saved.id)
      await rejectsWith(() => deleteMaintenanceWindow(saved.id), /Maintenance window not found/)
      await db.update(pipelines).set({ nextRunAt: null }).where(eq(pipelines.id, p.id))
    })

    await test('MN-5: alert channels (signed webhook), per-pipeline subscribers and channels, error-rate and stale alerts sent once', async () => {
      const prevFlag = process.env.NEXUS_ALLOW_PRIVATE_URLS
      process.env.NEXUS_ALLOW_PRIVATE_URLS = 'true'
      const received: { body: Record<string, unknown>; raw: string; signature: string }[] = []
      const server = createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          received.push({ body: JSON.parse(raw), raw, signature: String(req.headers['nexus-signature'] ?? '') })
          res.writeHead(202).end()
        })
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/alerts`
      try {
        setTestUser(viewer)
        await switchWorkspace(adminWs)
        await rejectsWith(() => createAlertChannel({ name: 'x', kind: 'webhook', url }), /Your role/)
        setTestUser(admin)
        await switchWorkspace(adminWs)
        await rejectsWith(() => createAlertChannel({ name: 'Slack', kind: 'slack', url: 'https://example.com/hook' }), /hooks\.slack\.com/)
        const channel = await createAlertChannel({ name: `${RUN} on-call`, kind: 'webhook', url })
        assert.match(channel.signingSecret ?? '', /^whsec_/)
        const listed = (await listAlertChannels()).find((c) => c.id === channel.id)!
        assert.equal(listed.host, new URL(url).host)
        assert.ok(!JSON.stringify(listed).includes('/alerts'), 'the URL path is never sent back')
        const test = await testAlertChannel(channel.id)
        assert.equal(test.ok, true, test.error ?? '')
        assert.equal(received[0].body.kind, 'test')
        const ts = Number(received[0].signature.match(/t=(\d+)/)![1])
        assert.equal(received[0].signature, signPayload(channel.signingSecret!, received[0].raw, ts), 'signed with the channel secret')

        // A pipeline that picks the channel, with a subscriber and an error-rate limit.
        const saved = await savePipeline({
          name: `${RUN} alerting`,
          definition: {
            schemaVersion: 2,
            nodes: [
              { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'resume_orgs' },
              { id: 'd', type: 'destination', position: { x: 300, y: 0 }, kind: 'dataset', datasetName: `${RUN}_alerting`, mode: 'replace' },
            ],
            edges: [{ id: 'e1', from: 's', to: 'd' }],
          },
          schedule: { type: 'manual' } as never,
        })
        const config = await savePipelineAlerts(saved.id, { subscribers: [viewer.id, 'not-a-member'], channelIds: [channel.id, 'not-a-channel'], errorRatePercent: 5 })
        assert.deepEqual(config.subscribers, [viewer.id])
        assert.deepEqual(config.channelIds, [channel.id])
        const base = { def: null, pipelineName: `${RUN} alerting`, pipelineId: saved.id, scope: { workspaceId: adminWs, actorId: admin.id }, trigger: 'schedule', attempts: 1 }
        const result = (status: 'success' | 'failed', rowsRead: number, rejectedCount: number) => ({ status, rowsRead, rejectedCount, rowsWritten: rowsRead - rejectedCount, steps: [], rejects: [], columns: [] }) as never
        received.length = 0
        await alertIfNeeded({ ...base, runId: `${RUN}_r1`, result: result('failed', 0, 0), message: 'connect ETIMEDOUT' })
        await alertIfNeeded({ ...base, runId: `${RUN}_r2`, result: result('success', 1000, 30), message: 'ok' })
        await alertIfNeeded({ ...base, runId: `${RUN}_r3`, result: result('success', 1000, 80), message: '80 rows held' })
        assert.deepEqual(received.map((r) => r.body.kind), ['failed', 'errorRate'], 'failure and 8% held alert; 3% does not')
        assert.equal((received[1].body.pipeline as { id: string }).id, saved.id)
        const viewerBell = await db.select().from(notifications).where(and(eq(notifications.userId, viewer.id), eq(notifications.pipelineId, saved.id)))
        assert.equal(viewerBell.length, 2, 'the subscriber gets both in their bell')

        // Stale: no successful run for 1 hour since the alerts were set up, sent once.
        await savePipelineAlerts(saved.id, { ...config, staleHours: 1 })
        await db.update(pipelineAlerts).set({ createdAt: new Date(Date.now() - 2 * 3_600_000), nextCheckAt: new Date(Date.now() - 1000) }).where(eq(pipelineAlerts.pipelineId, saved.id))
        received.length = 0
        await checkAlertSlas()
        assert.deepEqual(received.map((r) => r.body.kind), ['stale'])
        await db.update(pipelineAlerts).set({ nextCheckAt: new Date(Date.now() - 1000) }).where(eq(pipelineAlerts.pipelineId, saved.id))
        await checkAlertSlas()
        assert.equal(received.length, 1, 'sent once')

        // Anyone can subscribe themselves.
        setTestUser(viewer)
        await switchWorkspace(adminWs)
        await setPipelineSubscription(saved.id, false)
        assert.equal((await getPipelineAlerts(saved.id)).subscribed, false)
        await rejectsWith(() => savePipelineAlerts(saved.id, { staleHours: 2 }), /Your role/)
        setTestUser(admin)
        await switchWorkspace(adminWs)
        await deleteAlertChannel(channel.id)
        await rejectsWith(() => testAlertChannel(channel.id), /Alert channel not found/)
      } finally {
        server.close()
        if (prevFlag === undefined) delete process.env.NEXUS_ALLOW_PRIVATE_URLS
        else process.env.NEXUS_ALLOW_PRIVATE_URLS = prevFlag
      }
    })

    await test('SC-6: event triggers answer SAP Event Mesh / Graph handshakes, filter by type, drop repeats and run again for events during a run', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const saved = await savePipeline({
        publish: true,
        name: `${RUN} event triggered`,
        definition: {
          schemaVersion: 2,
          nodes: [
            { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: sourceId, table: 'resume_orgs' },
            { id: 'd', type: 'destination', position: { x: 300, y: 0 }, kind: 'dataset', datasetName: `${RUN}_events`, mode: 'replace' },
          ],
          edges: [{ id: 'e1', from: 's', to: 'd' }],
        },
        schedule: { type: 'manual' } as never,
      })
      const { url } = await createWebhookTrigger(saved.id)
      const token = url.split('/').pop()!
      const params = { params: Promise.resolve({ id: saved.id, token }) }
      await saveTriggerConfig(saved.id, { format: 'auto', eventTypes: ['sap.s4.beh.businesspartner.v1.*'], clientState: 'graph-secret-1' })
      const cfg = await getTriggerConfig(saved.id)
      assert.deepEqual(cfg, { format: 'auto', eventTypes: ['sap.s4.beh.businesspartner.v1.*'], hasClientState: true })
      const [row] = await db.select({ triggerConfig: pipelines.triggerConfig }).from(pipelines).where(eq(pipelines.id, saved.id))
      assert.ok(!JSON.stringify(row.triggerConfig).includes('graph-secret-1'), 'only a hash of the clientState is stored')

      // Handshakes.
      const opt = await optionsHook(new Request(url, { method: 'OPTIONS', headers: { 'WebHook-Request-Origin': 'eventmesh.example' } }), params)
      assert.equal(opt.status, 200)
      assert.equal(opt.headers.get('WebHook-Allowed-Origin'), 'eventmesh.example')
      const graphValidation = await postHook(new Request(`${url}?validationToken=abc%20123`, { method: 'POST' }), params)
      assert.equal(await graphValidation.text(), 'abc 123')

      const ce = (id: string, type = 'sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1') =>
        postHook(new Request(url, { method: 'POST', headers: { 'content-type': 'application/cloudevents+json' }, body: JSON.stringify({ specversion: '1.0', id, type, source: '/default/sap.s4.beh/S4H' }) }), params)
      const ignored = await ce('x1', 'sap.s4.beh.salesorder.v1.SalesOrder.Created.v1')
      assert.deepEqual(await ignored.json(), { status: 'ignored', reason: 'No event matches the event types this pipeline runs on.' })
      const first = await ce('bp-1')
      assert.equal(first.status, 202)
      const { run_id } = (await first.json()) as { run_id: string }
      assert.deepEqual(await (await ce('bp-1')).json(), { status: 'duplicate' }, 'a retried event is dropped')
      const whileQueued = await ce('bp-2')
      assert.equal(whileQueued.status, 202)
      assert.equal(((await whileQueued.json()) as { status: string }).status, 'pending')
      const [notPending] = await db.select({ at: pipelines.eventPendingAt }).from(pipelines).where(eq(pipelines.id, saved.id))
      assert.equal(notPending.at, null, 'the queued run will read that change anyway')
      takeAfterCallbacks()
      // An event during the run: one more run follows.
      await db.update(pipelines).set({ eventPendingAt: new Date() }).where(eq(pipelines.id, saved.id))
      await processJobs({})
      const runs = await db.select().from(executionLogs).where(eq(executionLogs.pipelineId, saved.id))
      const firstRun = runs.find((r) => r.id === run_id)!
      assert.equal(firstRun.status, 'success', firstRun.errorMessage ?? '')
      assert.ok(JSON.stringify(firstRun.executionDetails).includes('CloudEvents: sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1'), 'the run log names the event')
      assert.equal(runs.length, 2, 'the follow-up run was queued')
      await processJobs({})

      // Graph notifications must carry the clientState.
      const graph = (clientState: string) => postHook(new Request(url, { method: 'POST', body: JSON.stringify({ value: [{ subscriptionId: 's1', changeType: 'updated', resource: 'users/1', clientState }] }) }), params)
      assert.equal((await graph('wrong')).status, 401)
      assert.equal(((await (await graph('graph-secret-1')).json()) as { status: string }).status, 'ignored', 'right secret, but graph.updated is not in the filter')

      setTestUser(viewer)
      await switchWorkspace(adminWs)
      await rejectsWith(() => saveTriggerConfig(saved.id, { format: 'plain', eventTypes: [] }), /Your role/)
      setTestUser(admin)
      await switchWorkspace(adminWs)
    })

    await test('DB-3: a widget joins a second dataset on a key; the joined side never multiplies rows', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      // From the MN-4 and SC-6 tests: 1,200 people with an org code, and the 3 orgs. Load the orgs twice so the key repeats.
      const [orgs] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_events`)))
      await pool.query(`INSERT INTO "nexus_data"."${orgs.tableName}" (org, org_name, "_nexus_loaded_at") SELECT org, org_name || ' (old)', now() - interval '1 day' FROM "nexus_data"."${orgs.tableName}"`)
      const widget = {
        id: 'j',
        title: '',
        type: 'bar' as const,
        dataset: `${RUN}_resumed`,
        join: { dataset: `${RUN}_events`, left: 'org', right: 'org', kind: 'left' as const },
        measure: { agg: 'count' as const, column: '' },
        dimension: { column: 'join:org_name', grain: 'none' as const },
        filters: [],
        sort: 'label_asc' as const,
        limit: 10,
        size: 'small' as const,
      }
      const res = await previewWidget(widget)
      assert.ok(res.ok, res.ok ? '' : res.message)
      if (res.ok) assert.deepEqual(res.result.rows, [{ label: 'One', value: 400 }, { label: 'Two', value: 400 }, { label: 'Zero', value: 400 }], 'the latest org row per key, each person once')
      const kpi = await previewWidget({ ...widget, type: 'kpi', dimension: null, filters: [{ column: 'join:org_name', op: 'eq', value: 'Zero' }] })
      assert.ok(kpi.ok && kpi.result.rows[0].value === 400)
      const missing = await previewWidget({ ...widget, join: { ...widget.join, dataset: `${RUN}_nope` } })
      assert.ok(!missing.ok && /no longer exists/.test(missing.message))
    })

    await test('DB-5: restricted dashboards are hidden from others; embed links render as their role inside allowed sites until revoked', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const widget = { id: 'k', title: 'People', type: 'kpi' as const, dataset: `${RUN}_resumed`, join: null, measure: { agg: 'count' as const, column: '' }, dimension: null, filters: [], sort: 'value_desc' as const, limit: 5, size: 'small' as const }
      const { id } = await saveDashboard({ name: `${RUN} shared`, widgets: [widget] })
      await setDashboardSharing(id, { mode: 'restricted', roles: ['steward'], userIds: [] })
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      assert.ok(!(await listDashboards()).dashboards.some((d) => d.id === id), 'a viewer does not see it')
      await rejectsWith(() => getDashboardData(id), /Dashboard not found/)
      await rejectsWith(() => createDashboardEmbed(id, { allowedOrigins: ['https://kms.kmplus.co.id'] }), /Your role|not found/)
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await setDashboardSharing(id, { mode: 'restricted', roles: [], userIds: [viewer.id] })
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      assert.ok((await listDashboards()).dashboards.some((d) => d.id === id), 'now shared with them by name')
      setTestUser(admin)
      await switchWorkspace(adminWs)

      const created = await createDashboardEmbed(id, { label: 'KMS', role: 'viewer', allowedOrigins: ['https://kms.kmplus.co.id', 'https://*.kmplus.co.id'], expiresInDays: 30 })
      const token = created.url.split('/').pop()!
      assert.match(token, /^nxe_/)
      const [stored] = await db.select().from(dashboardEmbeds).where(eq(dashboardEmbeds.id, created.id))
      assert.ok(!JSON.stringify(stored).includes(token), 'only a hash of the token is stored')
      const found = await loadEmbed(token)
      assert.ok(found && found.embed.role === 'viewer' && found.dashboard.id === id)
      const results = await dashboardResults({ userId: `embed:${created.id}`, email: '', name: 'KMS', workspaceId: adminWs, workspaceName: '', role: 'viewer' }, [widget], [], {})
      assert.deepEqual(results.k, { ok: true, result: { rows: [{ label: null, value: 1200 }], truncated: false, lastLoadedAt: (results.k as { result: { lastLoadedAt: unknown } }).result.lastLoadedAt, filtersApplied: [], filtersSkipped: [] } })
      const res = await proxy(new NextRequest(`http://localhost:3000/embed/dashboards/${token}`))
      assert.equal(res.headers.get('Content-Security-Policy'), 'frame-ancestors https://kms.kmplus.co.id https://*.kmplus.co.id')
      assert.equal((await proxy(new NextRequest('http://localhost:3000/embed/dashboards/nxe_unknown_token_value_123456'))).headers.get('Content-Security-Policy'), "frame-ancestors 'none'")
      const list = await listDashboardEmbeds(id)
      assert.equal(list.length, 1)
      assert.ok(!('tokenHash' in list[0]))
      await revokeDashboardEmbed(created.id)
      assert.equal(await loadEmbed(token), null, 'a revoked link stops working')
      await deleteDashboard(id)
    })

    await test('DS-9: SFTP, SharePoint, Google Sheets / Drive, GraphQL and SOAP sources load datasets through pipelines', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const prevFlag = process.env.NEXUS_ALLOW_PRIVATE_URLS
      process.env.NEXUS_ALLOW_PRIVATE_URLS = 'true'
      const infra = await startInfraMock()
      const sftp = await startSftpMock()
      try {
        const sources: [string, string, Record<string, string>, string, number][] = [
          ['sftp', 'file transfer', sftp.credentials, 'daily/*.csv', 3],
          ['sharepoint', 'productivity', infra.credentials.sharepoint, 'lists/Employees', 3],
          ['googlesheets', 'productivity', infra.credentials.googlesheets, 'Employees', 3],
          ['googledrive', 'productivity', infra.credentials.googledrive, 'monthly/*.csv', 3],
          ['graphql', 'api', infra.credentials.graphql, 'employees', 3],
          ['soap', 'api', infra.credentials.soap, 'employees', 3],
        ]
        for (const [slug, type, credentials, table, expected] of sources) {
          await installConnector(slug)
          const id = await createDataSource({ name: `${RUN} ${slug}`, type, sourceType: slug, config: { role: 'source' }, credentials })
          const tested = await testConnection(id)
          assert.ok(tested.tables > 0, `${slug}: no tables scanned`)
          const saved = await savePipeline({
            publish: true,
            name: `${RUN} from ${slug}`,
            definition: {
              schemaVersion: 2,
              nodes: [
                { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: id, table },
                { id: 'd', type: 'destination', position: { x: 300, y: 0 }, kind: 'dataset', datasetName: `${RUN}_${slug}`, mode: 'replace' },
              ],
              edges: [{ id: 'e1', from: 's', to: 'd' }],
              settings: { retries: 0 },
            },
            schedule: { type: 'manual' } as never,
          })
          const run = await runPipelineNow(saved.id)
          takeAfterCallbacks()
          await processJobs({})
          const st = await getRunStatus(run.runId)
          assert.equal(st.status, 'success', `${slug}: ${st.errorMessage ?? ''}`)
          assert.equal(st.recordsProcessed, expected, `${slug} rows`)
        }
        // Credentials stay sealed; a wrong host key is refused.
        const [row] = await db.select({ credentials: dataSources.credentials }).from(dataSources).where(and(eq(dataSources.workspaceId, adminWs), eq(dataSources.name, `${RUN} sftp`)))
        assert.ok(!JSON.stringify(row.credentials).includes(sftp.credentials.password))
        const pinned = await createDataSource({ name: `${RUN} sftp pinned`, type: 'file transfer', sourceType: 'sftp', config: { role: 'source' }, credentials: { ...sftp.credentials, hostKeyFingerprint: `SHA256:${'A'.repeat(43)}` } })
        await rejectsWith(() => testConnection(pinned), /does not match the fingerprint/)
      } finally {
        await infra.stop()
        await sftp.stop()
        if (prevFlag === undefined) delete process.env.NEXUS_ALLOW_PRIVATE_URLS
        else process.env.NEXUS_ALLOW_PRIVATE_URLS = prevFlag
      }
    })

    await test('TD-24: a full run supersedes older quarantine (fixes carry over); replays into a replace dataset replace by key', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await pool.query(`CREATE TABLE "${FIXTURE_SCHEMA}".people (id int PRIMARY KEY, email text)`)
      await pool.query(`INSERT INTO "${FIXTURE_SCHEMA}".people VALUES (1, 'one@kmplus.test'), (2, 'broken-2'), (3, 'broken-3')`)
      const ds = `${RUN}_people`
      const { id } = await savePipeline({
        publish: true,
        name: `${RUN} people`,
        definition: {
          steps: [
            { id: 's', type: 'source', dataSourceId: sourceId, table: 'people' },
            { id: 'v', type: 'validate', rules: [{ field: 'email', rule: 'email' }] },
            { id: 'd', type: 'destination', kind: 'dataset', datasetName: ds, mode: 'replace', keys: ['id'] },
          ],
          settings: { retries: 0 },
        },
        schedule: { type: 'manual' } as never,
      })
      const runOnce = async () => {
        const r = await runPipelineNow(id)
        takeAfterCallbacks()
        await processJobs({})
        return r.runId
      }
      const first = await runOnce()
      const firstRejects = await db.select().from(pipelineRunRejects).where(eq(pipelineRunRejects.runId, first))
      assert.equal(firstRejects.length, 2)
      const two = firstRejects.find((r) => (r.row as { id: number }).id === 2)!
      await fixRow({ id: two.id, row: { id: 2, email: 'two@kmplus.test' } })
      const second = await runOnce()
      const old = await db.select().from(pipelineRunRejects).where(eq(pipelineRunRejects.runId, first))
      assert.ok(old.every((r) => r.status === 'superseded'), 'older quarantine superseded by the new full run')
      const fresh = await db.select().from(pipelineRunRejects).where(eq(pipelineRunRejects.runId, second))
      const carried = fresh.find((r) => (r.row as { id: number }).id === 2)!
      assert.equal(carried.status, 'fixed', "the steward's fix carries over to the new copy")
      assert.equal((carried.fixedRow as { email: string }).email, 'two@kmplus.test')
      await rejectsWith(() => fixRow({ id: two.id, row: { id: 2, email: 'x@kmplus.test' } }), /later run quarantined this row again/)
      // A stale copy of id 2 (as an earlier replay would have left) is replaced, not duplicated.
      const [table] = await db.select({ t: nexusDatasets.tableName }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, ds)))
      await pool.query(`INSERT INTO "nexus_data"."${table.t}" (id, email) VALUES (2, 'stale@kmplus.test')`)
      const [outcome] = await replayRows([carried.id])
      takeAfterCallbacks()
      await processJobs({})
      assert.equal((await getRunStatus(outcome.runId)).recordsSuccess, 1)
      const { rows } = await pool.query(`SELECT email FROM "nexus_data"."${table.t}" WHERE id = 2 AND "_nexus_deleted_at" IS NULL`)
      assert.deepEqual(rows.map((r) => r.email), ['two@kmplus.test'])
    })

    const approver = newUser('approver')
    await test('GV-6: publishing waits for a second person; requesters cannot approve their own', async () => {
      await db.insert(user).values({ id: approver.id, email: approver.email, name: approver.name, emailVerified: true, twoFactorEnabled: true })
      await recordTermsAcceptance({ userId: approver.id, method: 'sign_up' })
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const others = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, adminWs), inArray(workspaceMembers.role, ['admin', 'steward'])))
      if (others.length < 2) await rejectsWith(() => setApprovalPolicy('always'), /at least two people/)
      await db.insert(workspaceMembers).values({ workspaceId: adminWs, userId: approver.id, role: 'steward' })
      await setApprovalPolicy('always')
      const def = { steps: [{ id: 's', type: 'source', dataSourceId: sourceId, table: 'people' }, { id: 'd', type: 'destination', kind: 'dataset', datasetName: `${RUN}_approved`, mode: 'upsert', keys: ['id'] }] }
      const saved = await savePipeline({ publish: true, name: `${RUN} approved`, definition: def, schedule: { type: 'manual' } as never })
      assert.equal(saved.published, false)
      assert.ok(saved.approvalId)
      const listed = (await listPipelines()).find((x) => x.id === saved.id)!
      assert.equal(listed.version, 0, 'nothing runs until approved')
      assert.equal(listed.pendingApproval?.version, saved.version)
      await rejectsWith(() => approveRequest({ id: saved.approvalId! }), /Someone else/)
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      await rejectsWith(() => approveRequest({ id: saved.approvalId! }), /Your role/)
      setTestUser(approver)
      await switchWorkspace(adminWs)
      const pending = await listApprovals('pending')
      const mine = pending.find((r) => r.id === saved.approvalId)!
      assert.ok(mine.canDecide && mine.reasons[0].startsWith('Every publish'))
      await rejectsWith(() => rejectRequest({ id: mine.id }), /Say why/)
      await rejectRequest({ id: mine.id, note: 'use replace instead' })
      assert.ok((await db.select().from(notifications).where(and(eq(notifications.userId, admin.id), eq(notifications.workspaceId, adminWs)))).some((n) => /rejected/.test(n.title)))
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const again = await publishPipeline(saved.id, saved.version)
      assert.equal(again.published, false)
      setTestUser(approver)
      await switchWorkspace(adminWs)
      assert.equal((await approveRequest({ id: again.approvalId!, note: 'ok' })).version, saved.version)
      const [p] = await db.select({ version: pipelines.version }).from(pipelines).where(eq(pipelines.id, saved.id))
      assert.equal(p.version, saved.version, 'approval published the requested version')
      await rejectsWith(() => approveRequest({ id: again.approvalId! }), /already approved/)
      // "destructive": upserts publish right away, replace datasets wait.
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await setApprovalPolicy('destructive')
      assert.equal((await savePipeline({ id: saved.id, publish: true, name: `${RUN} approved`, definition: def, schedule: { type: 'manual' } as never })).published, true)
      const replaceDef = { steps: [def.steps[0], { ...def.steps[1], mode: 'replace', keys: [] }] }
      assert.equal((await savePipeline({ id: saved.id, publish: true, name: `${RUN} approved`, definition: replaceDef, schedule: { type: 'manual' } as never })).published, false)

      // Schema changes follow the same policy: a rename waits, an added column applies at once.
      const ds = `${RUN}_profile`
      const before = (await getDatasetSchema(ds)).version
      const asked = await changeDatasetSchema({ datasetName: ds, ops: [{ kind: 'rename', from: 'hire_date', to: 'start_date' }], note: 'clearer name' })
      assert.ok(asked.pending, 'the rename waits for a second person')
      assert.deepEqual(asked.reasons, [`${ds}: Renamed hire_date to start_date`])
      const page = await getDatasetSchema(ds)
      assert.equal(page.version, before, 'nothing changed yet')
      assert.ok(page.pending?.mine && page.pending.changes[0] === 'Renamed hire_date to start_date')
      await rejectsWith(() => changeDatasetSchema({ datasetName: ds, ops: [{ kind: 'remove', name: 'full_name' }] }), /already waiting for approval/)
      const team = { name: 'team', type: 'text' as const, required: false, description: '', classification: 'internal' as const, default: null, autoAdded: false, reviewed: true }
      const added = await changeDatasetSchema({ datasetName: ds, ops: [{ kind: 'add', column: team }] })
      assert.equal(added.pending, null)
      assert.equal(added.version, before + 1)
      await rejectsWith(() => approveRequest({ id: asked.pending! }), /Someone else/)
      setTestUser(approver)
      await switchWorkspace(adminWs)
      const request = (await listApprovals('pending')).find((r) => r.id === asked.pending)!
      assert.equal(request.subject, 'schema')
      assert.deepEqual(request.schema!.lines, ['Renamed hire_date to start_date'])
      assert.ok(request.schema!.usage!.pipelines.includes(`${RUN} hris profile`), 'the approver sees who reads the dataset')
      assert.ok(request.canDecide)
      // Applied as asked, even though a column was added in between.
      assert.equal((await approveRequest({ id: request.id, note: 'ok' })).version, before + 2)
      const after = await getDatasetSchema(ds)
      assert.ok(after.schema!.columns.some((c) => c.name === 'start_date') && !after.pending)
      assert.ok(after.aliases.some((a) => a.oldName === 'hire_date' && a.newName === 'start_date'), 'the old name stays readable for 30 days')
      const changedBy = await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, adminWs), eq(auditLogs.action, 'SCHEMA_CHANGE'), eq(auditLogs.resourceId, ds)))
      assert.ok(changedBy.some((a) => a.userId === admin.id && JSON.stringify(a.changes).includes('start_date')), 'recorded as the requester’s change')
      assert.ok((await db.select().from(notifications).where(and(eq(notifications.userId, admin.id), eq(notifications.workspaceId, adminWs)))).some((n) => /Schema change to .* approved/.test(n.title)))
      // A request the schema has moved past is superseded instead of applied.
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const stale = await changeDatasetSchema({ datasetName: ds, ops: [{ kind: 'remove', name: 'team' }] })
      await changeSchema({ workspaceId: adminWs, userId: admin.id }, ds, [{ kind: 'rename', from: 'team', to: 'squad' }])
      setTestUser(approver)
      await switchWorkspace(adminWs)
      await rejectsWith(() => approveRequest({ id: stale.pending! }), /no longer applies/)
      const [superseded] = await db.select().from(pipelineApprovals).where(eq(pipelineApprovals.id, stale.pending!))
      assert.equal(superseded.status, 'superseded')
      assert.ok((await getDatasetSchema(ds)).schema!.columns.some((c) => c.name === 'squad'), 'the column stays')
      // The requester (not a viewer) can cancel a waiting change.
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const cancelled = await changeDatasetSchema({ datasetName: ds, ops: [{ kind: 'type', name: 'squad', type: 'integer' }] })
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      await rejectsWith(() => cancelRequest(cancelled.pending!), /requester or an admin/)
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await cancelRequest(cancelled.pending!)
      assert.equal((await getDatasetSchema(ds)).pending, null)
      // Policy off: the same kind of change applies at once.
      await setApprovalPolicy('off')
      assert.equal((await changeDatasetSchema({ datasetName: ds, ops: [{ kind: 'remove', name: 'squad' }] })).pending, null)
      const { rows: approved } = await listAuditLogs({ action: 'APPROVE' })
      assert.ok(approved.length >= 1)
    })

    let prodWs = ''
    await test('GV-7: environments; promotion maps data sources by name and keeps Production locked', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const { created } = await setupEnvironments({ environment: 'dev', create: ['prod'] })
      prodWs = created[0].id
      const [prod] = await db.select().from(workspaces).where(eq(workspaces.id, prodWs))
      assert.equal(prod.environment, 'prod')
      assert.equal(prod.environmentLocked, true)
      const devPipeline = (await listPipelines()).find((x) => x.name === `${RUN} people`)!
      const preview = await previewPromotion(devPipeline.id)
      assert.ok(preview.blocking.some((b) => /Add the data source/.test(b)), 'prod needs its own data source first')
      // Production gets its own data source with the same name (its own credentials).
      await switchWorkspace(prodWs)
      await installConnector('postgres')
      const prodSource = await createDataSource({ name: `${RUN} fixture`, type: 'database', sourceType: 'postgres', config: { role: 'source' }, credentials: { connectionString: process.env.DATABASE_URL!, schema: FIXTURE_SCHEMA } })
      await rejectsWith(() => savePipeline({ name: 'direct edit', definition: { steps: [] }, schedule: { type: 'manual' } as never }), /change only by promotion/)
      await switchWorkspace(adminWs)
      // The dataset it writes has a defined schema: promotion creates it in Production first.
      const written = `${RUN}_people`
      await defineDatasetSchema({ datasetName: written, from: 'columns' })
      const withSchema = await previewPromotion(devPipeline.id)
      assert.deepEqual(withSchema.items.filter((i) => i.kind === 'dataset schema').map((i) => [i.name, i.status]), [[written, 'create']])
      const res = await promotePipeline({ pipelineId: devPipeline.id, note: 'first release' })
      assert.deepEqual((await loadSchema(prodWs, written))?.schema, (await loadSchema(adminWs, written))!.schema)
      assert.equal(res.published, true)
      assert.equal(res.target.id, prodWs)
      const [promoted] = await db.select().from(pipelines).where(eq(pipelines.id, res.pipelineId))
      assert.equal(promoted.workspaceId, prodWs)
      assert.equal(promoted.promotionKey, devPipeline.id)
      assert.equal(promoted.enabled, false, 'new pipelines start with the schedule off')
      const src = (promoted.config as { nodes: { type: string; dataSourceId?: string }[] }).nodes.find((n) => n.type === 'source')!
      assert.equal(src.dataSourceId, prodSource, 'uses the Production data source')
      // An added column goes along with the next promotion; a removed one would block it.
      await changeDatasetSchema({ datasetName: written, ops: [{ kind: 'add', column: { name: 'team', type: 'text', required: false, description: '', classification: 'internal', default: null, autoAdded: false, reviewed: true } }] })
      assert.deepEqual((await previewPromotion(devPipeline.id)).items.filter((i) => i.kind === 'dataset schema').map((i) => i.status), ['update'])
      // A second promotion updates the same pipeline.
      const again = await promotePipeline({ pipelineId: devPipeline.id })
      assert.ok((await loadSchema(prodWs, written))!.schema.columns.some((c) => c.name === 'team'))
      await changeDatasetSchema({ datasetName: written, ops: [{ kind: 'remove', name: 'team' }] })
      const blocked = await previewPromotion(devPipeline.id)
      assert.ok(blocked.blocking.some((b) => /schema of dataset/.test(b)), 'removing a column in the next environment is not done by promotion')
      assert.equal(again.pipelineId, res.pipelineId)
      assert.ok(again.version > res.version)
      const status = await listPromotionStatus()
      assert.deepEqual(status.find((x) => x.pipelineId === devPipeline.id)?.deployed, [{ environment: 'prod', version: again.version }])
      const { rows: promotions } = await listAuditLogs({ action: 'PROMOTE' })
      assert.equal(promotions.length, 2)
      await unlinkEnvironment(prodWs)
      const [devAfter] = await db.select().from(workspaces).where(eq(workspaces.id, adminWs))
      assert.equal(devAfter.environmentGroupId, null, 'a group of one is dissolved')
    })

    await test('DS-11: owner and tags; the source in each environment; adding it to another environment copies no credentials', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      assert.equal((await getDataSources()).find((s) => s.id === sourceId)?.ownerId, admin.id, 'whoever adds a source owns it')
      const res = await setDataSourceOwnership(sourceId, { ownerId: viewer.id, tags: ['HR', 'pii', 'hr '] })
      assert.deepEqual(res.tags, ['hr', 'pii'])
      await rejectsWith(() => setDataSourceOwnership(sourceId, { ownerId: outsider.id, tags: [] }), /must be a member/)
      const [stored] = await db.select({ ownerId: dataSources.ownerId, tags: dataSources.tags }).from(dataSources).where(eq(dataSources.id, sourceId))
      assert.deepEqual(stored, { ownerId: viewer.id, tags: ['hr', 'pii'] })
      const { rows: updates } = await listAuditLogs({ action: 'UPDATE' })
      assert.ok(updates.some((u) => u.resourceId === sourceId && JSON.stringify(u.changes).includes('pii')))
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      // This member is an analyst by now: only roles with sources:manage change owners and tags.
      await rejectsWith(() => setDataSourceOwnership(sourceId, { ownerId: null, tags: [] }), /Your role \(Analyst\) can't do this/)
      assert.deepEqual((await getSourceEnvironments()).environments, [], 'no group, no environments')

      setTestUser(admin)
      await switchWorkspace(adminWs)
      const { created } = await setupEnvironments({ environment: 'dev', create: ['staging'] })
      const stagingWs = created[0].id
      const envs = await getSourceEnvironments()
      assert.deepEqual(envs.environments.map((e) => [e.environment, e.canManage]), [['staging', true]])
      assert.equal(envs.sources[sourceId][0].state, 'missing')
      const copy = await copyDataSourceToEnvironment({ sourceId, workspaceId: stagingWs })
      assert.equal(copy.workspaceId, stagingWs)
      const [there] = await db.select().from(dataSources).where(eq(dataSources.id, copy.id))
      assert.equal(there.workspaceId, stagingWs)
      assert.equal(there.name, `${RUN} fixture`)
      assert.equal(there.sourceType, 'postgres')
      assert.equal(there.status, 'disconnected')
      assert.equal(there.nextHealthCheckAt, null, 'no health checks until its own credentials are saved')
      assert.equal(there.ownerId, admin.id, 'the owner is not a member there, so whoever added it owns it')
      assert.deepEqual(there.tags, ['hr', 'pii'])
      assert.deepEqual(decryptCredentials(there.id, there.credentials), {}, 'no credentials are copied')
      assert.deepEqual(there.config, { role: 'source' }, 'no scan, files or agent link')
      const after = await getSourceEnvironments()
      assert.equal(after.sources[sourceId][0].state, 'present')
      assert.equal(after.sources[sourceId][0].health, 'idle')
      await rejectsWith(() => copyDataSourceToEnvironment({ sourceId, workspaceId: stagingWs }), /already has a data source named/)
      await rejectsWith(() => copyDataSourceToEnvironment({ sourceId, workspaceId: adminWs }), /not another environment/)
      const { rows: exports } = await listAuditLogs({ action: 'EXPORT' })
      assert.ok(exports.some((e) => e.resourceId === sourceId))
      await unlinkEnvironment(stagingWs)
    })

    await test('Go to finder: record names of this workspace only, and only dashboards shared with the caller', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const { id: hidden } = await saveDashboard({ name: `${RUN} finder private`, description: '', widgets: [] })
      await setDashboardSharing(hidden, { mode: 'restricted', roles: [], userIds: [] })
      const mine = await listFinderRecords()
      assert.ok(mine.pipelines.some((p) => p.name === `${RUN} employees`))
      assert.ok(mine.sources.some((s) => s.id === sourceId && s.name === `${RUN} fixture`))
      assert.ok(mine.datasets.includes(`${RUN}_employees`))
      assert.ok(mine.dashboards.some((d) => d.id === hidden), 'admins see restricted dashboards')
      setTestUser(viewer)
      await switchWorkspace(adminWs)
      assert.ok(!(await listFinderRecords()).dashboards.some((d) => d.id === hidden), 'a restricted dashboard stays hidden from others')
      setTestUser(outsider)
      const theirs = await listFinderRecords()
      assert.ok(!theirs.pipelines.some((p) => p.name.startsWith(RUN)) && !theirs.datasets.some((d) => d.startsWith(RUN)), 'another workspace sees none of these names')
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await deleteDashboard(hidden)
    })

    await test('SCIM: provision, group roles, deactivate (signed out, no SSO rejoin), delete; tokens are workspace-scoped', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const domain = `${RUN}.scim.test`
      const providerId = `sso-${RUN}`
      await db.insert(ssoProvider).values({ id: `ssop_${RUN}`, issuer: 'https://idp.example', providerId, domain, domainVerified: true, userId: admin.id })
      await db.insert(workspaceSso).values({ id: `wsso_${RUN}`, workspaceId: adminWs, providerId, label: 'Test IdP', preset: 'oidc', domain, defaultRole: 'viewer', verificationToken: 'x', createdBy: admin.id })
      const { token } = await createScimToken('Entra provisioning')
      const call = async (handler: typeof scimGet, method: string, path: string[], body?: unknown, auth = token) => {
        const res = await handler(new Request(`https://nexus.example/api/scim/v2/${path.join('/')}`, { method, headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/scim+json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve({ path }) })
        return { status: res.status, body: res.status === 204 ? null : await res.json() }
      }
      assert.equal((await call(scimGet, 'GET', ['Users'], undefined, 'nxs_wrong')).status, 401)
      const entraUser = { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `ani@${domain}`, externalId: 'aad-1', active: true, displayName: 'Ani Wijaya', emails: [{ primary: true, type: 'work', value: `ani@${domain}` }] }
      const created = await call(scimPost, 'POST', ['Users'], entraUser)
      assert.equal(created.status, 201, JSON.stringify(created.body))
      const scimId = created.body.id as string
      const [link] = await db.select().from(scimUsers).where(eq(scimUsers.id, scimId))
      const [member] = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, adminWs), eq(workspaceMembers.userId, link.userId)))
      assert.equal(member.role, 'viewer', 'joins with the SSO default role')
      assert.equal((await call(scimPost, 'POST', ['Users'], entraUser)).status, 409)
      assert.equal((await call(scimPost, 'POST', ['Users'], { ...entraUser, userName: 'x@other.example', emails: [] })).body.scimType, 'invalidValue')
      const found = await call(scimGet, 'GET', ['Users'], undefined)
      assert.ok(found.body.totalResults >= 1)
      const filtered = await scimGet(new Request(`https://nexus.example/api/scim/v2/Users?filter=${encodeURIComponent(`userName eq "ANI@${domain}"`)}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ path: ['Users'] }) })
      assert.equal((await filtered.json()).totalResults, 1, 'userName lookups ignore case')
      // Groups carry roles.
      const group = await call(scimPost, 'POST', ['Groups'], { displayName: `${RUN} Stewards`, members: [{ value: scimId }, { value: 'unknown-id' }] })
      assert.equal(group.status, 201)
      assert.equal(group.body.members.length, 1, 'unknown members are ignored')
      await setScimGroupRole({ groupId: group.body.id, role: 'steward' })
      const roleOf = async () => (await db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, adminWs), eq(workspaceMembers.userId, link.userId))))[0]?.role
      assert.equal(await roleOf(), 'steward')
      await call(scimPatch, 'PATCH', ['Groups', group.body.id], { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Remove', path: 'members', value: [{ value: scimId }] }] })
      assert.equal(await roleOf(), 'viewer', 'leaving the group falls back to the default role')
      // Deactivate (Entra sends "False"): access removed, sessions revoked, SSO can't add them back.
      await db.insert(session).values({ id: `${RUN}_scim_sess`, userId: link.userId, token: `${RUN}_scim_tok`, expiresAt: new Date(Date.now() + 86_400_000) })
      const off = await call(scimPatch, 'PATCH', ['Users', scimId], { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] })
      assert.equal(off.body.active, false)
      assert.equal(await roleOf(), undefined, 'membership removed')
      assert.equal((await db.select().from(session).where(eq(session.userId, link.userId))).length, 0, 'signed out everywhere')
      await provisionSsoUser(providerId, { id: link.userId, email: `ani@${domain}` })
      assert.equal(await roleOf(), undefined, 'a deactivated person does not rejoin through SSO')
      await call(scimPatch, 'PATCH', ['Users', scimId], { Operations: [{ op: 'replace', value: { active: true } }] })
      assert.equal(await roleOf(), 'viewer', 'reactivated')
      // JIT off: only provisioned people join on SSO sign-in.
      await db.update(workspaceSso).set({ jitProvisioning: false }).where(eq(workspaceSso.providerId, providerId))
      const stranger = newUser('stranger')
      await db.insert(user).values({ id: stranger.id, email: `stranger@${domain}`, name: 'x', emailVerified: true, twoFactorEnabled: false })
      await provisionSsoUser(providerId, { id: stranger.id, email: `stranger@${domain}` })
      assert.equal((await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, stranger.id))).length, 0)
      assert.equal((await call(scimDelete, 'DELETE', ['Users', scimId])).status, 204)
      assert.equal((await call(scimGet, 'GET', ['Users', scimId])).status, 404)
      assert.equal(await roleOf(), undefined)
      const { rows: deprov } = await listAuditLogs({ action: 'DEPROVISION' })
      assert.ok(deprov.length >= 2)
      const tokenId = (await db.select({ id: scimTokens.id }).from(scimTokens).where(eq(scimTokens.workspaceId, adminWs)))[0].id
      await revokeScimToken(tokenId)
      assert.equal((await call(scimGet, 'GET', ['Users'])).status, 401, 'revoked tokens stop working')
      await db.delete(user).where(like(user.email, `%@${domain}`))
    })

    await test('SAML: providers store the IdP metadata; the SP values are shown to the admin', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const cert = readFileSync('scripts/test/fixtures/saml-idp-cert.pem', 'utf8').replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, '')
      const metadata = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.${RUN}.example/saml"><IDPSSODescriptor><KeyDescriptor use="signing"><KeyInfo><X509Data><X509Certificate>${cert}</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.${RUN}.example/sso"/></IDPSSODescriptor></EntityDescriptor>`
      await rejectsWith(() => createSamlProvider({ label: 'x', preset: 'saml', domain: `${RUN}.saml.test`, metadata: 'http://127.0.0.1/metadata' }), /https|private|Could not download/)
      const created = await createSamlProvider({ label: 'Okta', preset: 'okta', domain: `${RUN}.saml.test`, defaultRole: 'analyst' })
      let listed = (await listSsoProviders()).find((x) => x.providerId === created.providerId)!
      assert.equal(listed.protocol, 'saml')
      assert.equal(listed.saml?.idpConfigured, false, 'metadata can come after the app is created')
      assert.match(listed.saml!.acsUrl, new RegExp(`/api/auth/sso/saml2/sp/acs/${created.providerId}$`))
      await setSamlIdp({ providerId: created.providerId, metadata })
      listed = (await listSsoProviders()).find((x) => x.providerId === created.providerId)!
      assert.equal(listed.saml?.idpConfigured, true)
      assert.equal(listed.issuer, `https://idp.${RUN}.example/saml`)
      const [row] = await db.select().from(ssoProvider).where(eq(ssoProvider.providerId, created.providerId))
      const cfg = JSON.parse(row.samlConfig!)
      assert.equal(cfg.entryPoint, `https://idp.${RUN}.example/sso`)
      assert.equal(cfg.cert, cert)
      assert.equal(cfg.audience, listed.saml!.entityId)
      assert.equal(row.oidcConfig, null)
      await rejectsWith(() => setSamlIdp({ providerId: created.providerId, metadata: '<foo/>' }), /not SAML metadata/)
      await deleteSsoProvider(created.providerId)
    })



    await test('database destinations: rows missing from the source are marked deleted (boolean and timestamp markers)', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      await pool.query(`CREATE TABLE "${FIXTURE_SCHEMA}".direct_out (id int PRIMARY KEY, email text, is_deleted boolean NOT NULL DEFAULT false)`)
      await pool.query(`INSERT INTO "${FIXTURE_SCHEMA}".direct_out (id, email) VALUES (7, 'old@kmplus.test'), (8, 'old2@kmplus.test')`)
      const destId = await createDataSource({ name: `${RUN} direct dest`, type: 'database', sourceType: 'postgres', config: { role: 'destination' }, credentials: { connectionString: process.env.DATABASE_URL!, schema: FIXTURE_SCHEMA } })
      const saved = await savePipeline({
        publish: true,
        name: `${RUN} direct soft delete`,
        definition: {
          steps: [
            { id: 's', type: 'source', dataSourceId: sourceId, table: 'people' },
            { id: 'w', type: 'destination', kind: 'datasource', dataSourceId: destId, table: 'direct_out', mode: 'upsert', keys: ['id'], softDeleteMissing: true, softDeleteColumn: 'is_deleted' },
          ],
          settings: { retries: 0 },
        },
        schedule: { type: 'manual' } as never,
      })
      const run = await runPipelineNow(saved.id)
      takeAfterCallbacks()
      await processJobs({})
      assert.equal((await getRunStatus(run.runId)).status, 'success')
      const { rows } = await pool.query(`SELECT id, is_deleted FROM "${FIXTURE_SCHEMA}".direct_out ORDER BY id`)
      assert.deepEqual(rows.map((r) => [r.id, r.is_deleted]), [[1, false], [2, false], [3, false], [7, true], [8, true]])
    })

    await test('AI assistant on an open-source model: mapping suggestions, rules from text, questions as charts; personal values never sent', async () => {
      const llm = await startLlmMock()
      process.env.NEXUS_AI_BASE_URL = llm.baseUrl
      process.env.NEXUS_AI_MODEL = 'qwen2.5:7b-instruct'
      try {
        setTestUser(admin)
        await switchWorkspace(adminWs)
        const status = await getAiSettings()
        assert.equal(status.ready, true, status.message)
        assert.equal(status.model, 'qwen2.5:7b-instruct')
        assert.equal(status.paid, false)

        // The paid setup sits next to the open-source one; the type decides which answers.
        process.env.NEXUS_AI_MODEL_TYPE = 'paid'
        const noKey = await getAiSettings()
        assert.ok(!noKey.ready && noKey.paid, 'paid without a key is not ready')
        await rejectsWith(() => suggestMapping({ columns: [{ name: 'id', type: 'integer' }], dataSourceId: sourceId, table: 'people', entity: 'employee' }), /NEXUS_AI_PAID_API_KEY is not set/)
        process.env.NEXUS_AI_PAID_API_KEY = 'sk-test-not-used'
        const paid = await getAiSettings()
        assert.ok(paid.ready && paid.paid && paid.model === 'claude-opus-5-5' && paid.where === 'Anthropic (paid API)', JSON.stringify(paid))
        delete process.env.NEXUS_AI_PAID_API_KEY
        process.env.NEXUS_AI_MODEL_TYPE = 'opensource'
        assert.equal((await getAiSettings()).model, 'qwen2.5:7b-instruct', 'switching back uses the open-source settings again')
        delete process.env.NEXUS_AI_MODEL_TYPE

        const mapping = await suggestMapping({ columns: [{ name: 'id', type: 'integer' }, { name: 'email', type: 'text' }], dataSourceId: sourceId, table: 'people', entity: 'employee' })
        assert.deepEqual(mapping.suggestions.map((m) => [m.from, m.to]), [['id', 'employee_code'], ['email', 'email']], 'invented columns and bad names are dropped')
        assert.deepEqual(mapping.suggestions[1].transforms.map((t) => t.fn), ['lowercase'], 'unknown transforms are dropped')
        const sent = JSON.stringify(llm.requests[0].messages)
        const shared = (JSON.parse(llm.requests[0].messages[1].content) as { sourceColumns: { name: string; samples: string[] }[] }).sourceColumns
        assert.deepEqual(shared.find((c) => c.name === 'id')?.samples.slice().sort(), ['1', '2', '3'], 'example values of non-personal columns are shared')
        assert.deepEqual(shared.find((c) => c.name === 'email')?.samples, [], 'personal columns share no examples')
        assert.doesNotMatch(sent, /@kmplus\.test/, 'emails (personal) are never sent to the model')
        assert.deepEqual(llm.requests[0].response_format, { type: 'json_object' })

        const rule = await draftRule({ text: 'Only keep people whose email is a kmplus.test address', dataset: `${RUN}_people` })
        assert.equal(rule.body.when.conditions[0].field, 'email', 'an unknown field is sent back to the model and corrected')
        assert.equal(rule.body.otherwise[0].type, 'exclude')
        const ruleRequests = llm.requests.filter((r) => r.messages[0].content.startsWith('You turn a business rule'))
        assert.equal(ruleRequests.length, 2)
        assert.match(ruleRequests[1].messages.at(-1)!.content, /Unknown field\(s\) in conditions: salary/)

        const answer = await askData({ question: 'How many people are there?', dataset: `${RUN}_people` })
        const [ds] = await db.select({ t: nexusDatasets.tableName }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, adminWs), eq(nexusDatasets.name, `${RUN}_people`)))
        const { rows: count } = await pool.query(`SELECT count(*)::int AS n FROM "nexus_data"."${ds.t}" WHERE "_nexus_deleted_at" IS NULL`)
        assert.equal(answer.widget.type, 'kpi')
        assert.equal(answer.result.rows[0].value, count[0].n, 'the question runs as a governed Analytics query')
        assert.ok(!JSON.stringify(llm.requests.at(-1)!.messages).includes('@kmplus.test'), 'questions send the schema, not rows')

        const { rows: audits } = await listAuditLogs({ action: 'AI_ASSIST' })
        assert.equal(audits.length, 3)
        assert.ok(!JSON.stringify(audits).includes('kmplus.test address'), 'the audit records the feature and model, not the prompt')

        // AI-2: a description becomes a checked draft built from the real source table (nothing saved).
        const pipelinesBefore = (await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.workspaceId, adminWs))).length
        const draft = await draftPipeline({ text: 'Copy the people table into a dataset every day at 2am' })
        assert.equal(draft.schedule.type, 'daily')
        assert.equal(draft.schedule.time, '02:00')
        assert.ok(draft.definition.nodes.some((n) => n.type === 'filter'), 'the filter sits after the source')
        assert.ok(draft.definition.nodes.some((n) => n.type === 'destination' && n.kind === 'dataset' && n.datasetName === 'people_copy'))
        assert.equal((await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.workspaceId, adminWs))).length, pipelinesBefore, 'a draft is not saved')
        assert.ok(!JSON.stringify(llm.requests.at(-1)!.messages).includes('@kmplus.test'), 'pipeline drafts send the schema, not rows')

        // AI-2 into a REST API added as a destination: named by host only; the Destination step is that API; nothing sent or saved.
        const payrollId = await createDataSource({ name: `${RUN} Payroll API`, type: 'rest', sourceType: 'rest', config: { role: 'destination' }, credentials: { baseUrl: 'https://api.payroll.test/v2', authMethod: 'bearer', bearerToken: 'payroll-secret-token' } })
        const apiDraft = await draftPipeline({ text: `Copy the people table into the ${RUN} Payroll API every day at 2am` })
        const apiDest = apiDraft.definition.nodes.find((n) => n.type === 'destination')
        assert.ok(apiDest?.type === 'destination' && apiDest.kind === 'api' && apiDest.dataSourceId === payrollId && apiDest.method === 'POST' && apiDest.path === '/employees', JSON.stringify(apiDest))
        assert.ok(bodyLeaves(apiDest.body.template).some((l) => l.node.binding.kind === 'column'), 'the body is built from the example and bound to source columns')
        const draftPrompt = llm.requests.at(-1)!.messages[0].content
        assert.ok(draftPrompt.includes(`id "${payrollId}": ${RUN} Payroll API (REST API at api.payroll.test)`), 'the REST destination is listed with its host')
        assert.ok(!draftPrompt.includes('payroll-secret-token') && !draftPrompt.includes('/v2'), 'never its credentials or the rest of its URL')
        assert.equal((await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.workspaceId, adminWs))).length, pipelinesBefore, 'an API draft is not saved either')
        await deleteDataSource(payrollId)

        // AI-3: a run that held rows back is explained; personal values are hidden from the model; the fix is saved as a draft.
        const [partialRun] = await db.select({ id: executionLogs.id }).from(executionLogs).where(and(eq(executionLogs.workspaceId, adminWs), eq(executionLogs.status, 'partial'))).limit(1)
        assert.ok(partialRun, 'a run that held rows back')
        const diagnosis = await diagnoseRun({ runId: partialRun.id })
        assert.match(diagnosis.summary, /email check/)
        assert.ok(!JSON.stringify(llm.requests.at(-1)!.messages).includes('@kmplus.test'), 'held-row values are hidden from the model')
        if (diagnosis.fix.kind !== 'none') {
          const [before] = await db.select({ version: pipelines.version }).from(pipelines).where(eq(pipelines.id, diagnosis.pipelineId))
          const saved = await applyDiagnosisFix({ pipelineId: diagnosis.pipelineId, fix: diagnosis.fix })
          const [after] = await db.select({ version: pipelines.version, draftVersion: pipelines.draftVersion }).from(pipelines).where(eq(pipelines.id, diagnosis.pipelineId))
          assert.equal(after.version, before.version, 'the fix does not publish')
          assert.equal(after.draftVersion, saved.version, 'the fix is a new draft version')
        }
        await rejectsWith(() => diagnoseRun({ runId: 'run_not_here' }), /Run not found/)

        // AI-4: rules answer known signatures without the model; the model only fills in.
        const before4 = llm.requests.length
        const oracle = await suggestConnector({ text: 'ORA-12541: TNS:no listener at db01:1521' })
        assert.equal(oracle.via, 'rules')
        assert.equal(oracle.suggestions[0].slug, 'oracle')
        assert.equal(llm.requests.length, before4, 'rules need no model call')
        const vague = await suggestConnector({ text: 'our vendor gives us a JSON feed every night' })
        assert.equal(vague.via, 'ai')
        assert.equal(vague.suggestions[0].slug, 'rest')
        assert.deepEqual((await suggestConnector({ text: 'nothing matches here', rulesOnly: true })).suggestions, [], 'rules only never asks the model')
        const secret = await suggestConnector({ text: 'postgres://nexus:TopSecret99@db.internal:5432/hr' })
        assert.equal(secret.suggestions[0].slug, 'postgres')
        assert.ok(!JSON.stringify(llm.requests).includes('TopSecret99'), 'pasted passwords never reach the model')

        // AI-5: the model re-ranks catalog items; invented columns are dropped; no rows are sent.
        const answerAi = await askCatalog({ question: 'where are the people?' })
        assert.equal(answerAi.via, 'ai')
        assert.ok(answerAi.results.length === 1 && !answerAi.results[0].columns.includes('not_a_column'))
        assert.ok(!JSON.stringify(llm.requests.at(-1)!.messages).includes('@kmplus.test'), 'catalog search sends names, not rows')

        setTestUser(viewer)
        await switchWorkspace(adminWs)
        await rejectsWith(() => suggestMapping({ columns: [{ name: 'id', type: 'integer' }] }), /Your role/)
        setTestUser(admin)
        await switchWorkspace(adminWs)
        await setAiProvider({ provider: 'off' })
        const answerKeywords = await askCatalog({ question: `${RUN} people` })
        assert.equal(answerKeywords.via, 'keywords')
        assert.ok(answerKeywords.results.some((r) => r.name === `${RUN}_people`), 'synonym ranking finds the dataset without a model')
        ;(await cookies()).set('nexus_lang', 'id')
        await rejectsWith(() => askData({ question: 'How many?' }), /dimatikan|nonaktif/i)
        ;(await cookies()).delete('nexus_lang')
        await rejectsWith(() => askData({ question: 'How many?' }), /turned off/)
        await rejectsWith(() => setAiProvider({ provider: 'agent', agentId: 'nope' }), /Agent not found/)
        await setAiProvider({ provider: 'server' })
      } finally {
        delete process.env.NEXUS_AI_BASE_URL
        delete process.env.NEXUS_AI_MODEL
        await llm.stop()
      }
    })

    await test('Nexus Agent: sources behind a firewall are tested, sampled, read and written through the agent', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      const { token } = await createAgent('Office agent')
      // The agent talks to the real route handlers, in-process.
      const agentFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        const path = url.pathname.replace('/api/agent/v1', '')
        const req = new Request(url, init)
        if (path === '/hello') return agentHello(req)
        if (path === '/tasks') return agentTasks(req)
        const m = /^\/tasks\/([^/]+)\/result$/.exec(path)
        if (m) return agentResult(req, { params: Promise.resolve({ id: decodeURIComponent(m[1]) }) })
        return new Response('not found', { status: 404 })
      }) as typeof fetch
      await pool.query(`CREATE TABLE "${FIXTURE_SCHEMA}".agent_out (id int PRIMARY KEY, email text, deleted_at timestamptz)`)
      // A row the source no longer has: the run must mark it deleted through the agent.
      await pool.query(`INSERT INTO "${FIXTURE_SCHEMA}".agent_out (id, email) VALUES (99, 'gone@kmplus.test')`)
      const agentLlm = await startLlmMock()
      const intranet = await startIntranetApi('intranet-token')
      const hrOut = await startRestWriteMock('intranet-write-token')
      const config = parseConfig({
        url: 'http://localhost:3000',
        token,
        pollWaitSeconds: 1,
        connections: [
          { name: 'HR', type: 'postgres', writable: true, credentials: { connectionString: '${AGENT_TEST_DB}', schema: FIXTURE_SCHEMA } },
          // An intranet API: the agent's config holds the address and the token; Nexus designs the request.
          { name: 'HR API', type: 'rest', credentials: { baseUrl: `${intranet.baseUrl}/hr`, authMethod: 'bearer', bearerToken: '${INTRANET_TOKEN}' } },
          // An intranet API pipelines write to: rows are rendered and sent by the agent, with its own token.
          { name: 'HR API out', type: 'rest', writable: true, credentials: { baseUrl: hrOut.baseUrl, authMethod: 'bearer', bearerToken: '${INTRANET_WRITE_TOKEN}' } },
        ],
        ai: { baseUrl: agentLlm.baseUrl, model: 'llama3.1:8b' },
      }, { AGENT_TEST_DB: process.env.DATABASE_URL, INTRANET_TOKEN: 'intranet-token', INTRANET_WRITE_TOKEN: 'intranet-write-token' })
      const stop = new AbortController()
      const logs: string[] = []
      const running = runAgent(config, { fetchImpl: agentFetch, signal: stop.signal, log: (l) => logs.push(l) })
      // Observed from the start: the agent stopping early fails the test instead of crashing the process.
      const outcome = running.then(() => null, (e: Error) => e)
      let ended: Error | null | undefined
      void outcome.then((e) => (ended = e ?? new Error('ended')))
      const alive = (stage: string) => {
        if (ended) throw new Error(`The agent stopped during ${stage}: ${ended.message}. Agent log: ${logs.join(' | ')}`)
      }
      try {
        for (let i = 0; i < 50 && !(await listAgents()).agents.find((a) => a.name === 'Office agent')?.online; i++) await new Promise((r) => setTimeout(r, 100))
        const listed = (await listAgents()).agents.find((a) => a.name === 'Office agent')!
        assert.equal(listed.online, true)
        assert.deepEqual(listed.connections.map((c) => [c.name, c.type, c.writable]), [['HR', 'postgres', true], ['HR API', 'rest', false], ['HR API out', 'rest', true]])
        assert.equal(listed.connections[1].endpoint, `${intranet.baseUrl}/hr`, 'the agent shows where the API is, without credentials')
        const [stored] = await db.select().from(agentTable).where(eq(agentTable.id, listed.id))
        assert.ok(!JSON.stringify(stored.connections).includes('postgres://'), 'Nexus never receives the credentials')
        assert.ok(!JSON.stringify(stored.connections).includes('intranet-token'))

        // DS-12: an intranet API through the agent. The request is designed in Nexus; the
        // base URL and token stay on the agent and win over anything Nexus sends.
        await installConnector('rest')
        const api = await addAgentDataSource({ agentId: listed.id, connection: 'HR API', role: 'source' })
        const editable = await getEditableCredentials(api.id)
        assert.ok(editable.supported && editable.custom === 'rest' && 'agent' in editable && editable.agent?.endpoint === `${intranet.baseUrl}/hr`)
        const savedApi = await updateDataSourceCredentials(api.id, { resourcePath: '/employees', dataPath: 'items', baseUrl: 'https://evil.example', bearerToken: 'stolen', authMethod: 'none' })
        assert.equal(savedApi.ok, true, savedApi.message)
        const [apiRow] = await db.select().from(dataSources).where(eq(dataSources.id, api.id))
        const apiStored = decryptCredentials(api.id, apiRow.credentials) as Record<string, string>
        assert.equal(apiStored.resourcePath, '/employees')
        assert.ok(!('baseUrl' in apiStored) && !('bearerToken' in apiStored), 'only the request is stored in Nexus')
        const apiSample = await getDataSourceTableSample(api.id, 'employees', 5)
        assert.deepEqual(apiSample.rows.map((r) => r.employee_code), ['E1', 'E2'])
        const { readSourceRows } = await import('@/lib/pipelines/io')
        assert.equal((await readSourceRows(apiRow, 'employees', 100)).length, 2, 'pipelines read the intranet API through the agent')
        assert.ok(intranet.seen.length > 0 && intranet.seen.every((r) => r.authorization === 'Bearer intranet-token' && r.path.startsWith('/hr/')), 'the agent always signs in with its own token')
        const escape = await previewRestConnection({ resourcePath: '/../admin' }, api.id)
        assert.equal(escape.ok, false)
        assert.match(escape.message, /leaves the API's base URL/)
        assert.ok(!intranet.seen.some((r) => r.path === '/admin'), 'requests never leave the base URL')
        // From the cloud the same API is refused, with a pointer to the agent.
        const devFlag = process.env.NEXUS_ALLOW_PRIVATE_URLS
        delete process.env.NEXUS_ALLOW_PRIVATE_URLS
        try {
          const direct = await createDataSource({ name: `${RUN} direct intranet`, type: 'rest', sourceType: 'rest', credentials: { baseUrl: `${intranet.baseUrl}/hr`, resourcePath: '/employees', authMethod: 'bearer', bearerToken: 'intranet-token' } })
          await rejectsWith(() => testConnection(direct), /private network.*Nexus Agent/)
          await deleteDataSource(direct)
        } finally {
          if (devFlag !== undefined) process.env.NEXUS_ALLOW_PRIVATE_URLS = devFlag
        }
        alive('the intranet API')

        const src = await addAgentDataSource({ agentId: listed.id, connection: 'HR', role: 'source' })
        await testConnection(src.id)
        const [row] = await db.select().from(dataSources).where(eq(dataSources.id, src.id))
        assert.ok(((row.config as { schemaScan?: { tables: { name: string }[] } }).schemaScan?.tables ?? []).some((t) => t.name === 'people'), 'scanned through the agent')
        const sample = await getDataSourceTableSample(src.id, 'people', 5)
        assert.equal(sample.rows.length, 3)

        const dest = await addAgentDataSource({ agentId: listed.id, connection: 'HR', role: 'destination', name: 'HR out' })
        const saved = await savePipeline({
          publish: true,
          name: `${RUN} via agent`,
          definition: {
            schemaVersion: 2,
            nodes: [
              { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: src.id, table: 'people' },
              { id: 'd', type: 'destination', position: { x: 300, y: 0 }, kind: 'dataset', datasetName: `${RUN}_agent_people`, mode: 'replace' },
              { id: 'w', type: 'destination', position: { x: 300, y: 150 }, kind: 'datasource', dataSourceId: dest.id, table: 'agent_out', mode: 'upsert', keys: ['id'], softDeleteMissing: true, softDeleteColumn: 'deleted_at' },
            ],
            edges: [{ id: 'e1', from: 's', to: 'd' }, { id: 'e2', from: 's', to: 'w' }],
            settings: { retries: 0 },
          },
          schedule: { type: 'manual' } as never,
        })
        const run = await runPipelineNow(saved.id)
        takeAfterCallbacks()
        await processJobs({})
        const status = await getRunStatus(run.runId)
        alive('the pipeline run')
        assert.equal(status.status, 'success', status.errorMessage ?? '')
        assert.equal(status.recordsProcessed, 3)
        const { rows: written } = await pool.query(`SELECT id, deleted_at IS NOT NULL AS deleted FROM "${FIXTURE_SCHEMA}".agent_out ORDER BY id`)
        assert.deepEqual(written.map((r) => [r.id, r.deleted]), [[1, false], [2, false], [3, false], [99, true]], 'written through the agent; the row missing from the source is marked deleted')
        assert.ok(logs.some((l) => /^activeKeys HR/.test(l)) && logs.some((l) => /^markDeleted HR/.test(l)))
        assert.ok(logs.some((l) => /^readChunk HR \d+ ms ok/.test(l)) && logs.some((l) => /^write HR/.test(l)), 'the agent logs operations')
        assert.ok(!logs.join('\n').includes('@kmplus.test'), 'the agent never logs data')
        assert.equal((await db.select().from(agentTaskTable).where(eq(agentTaskTable.agentId, listed.id))).length, 0, 'results are not kept')

        // An intranet REST API as a destination: the agent renders and sends the requests (agent 1.3.0+).
        const apiOut = await addAgentDataSource({ agentId: listed.id, connection: 'HR API out', role: 'destination', name: 'HR API out' })
        const outTemplate = autoBindBody(parseBodySample('json', '{"employee":{"email":"a@b.id"}}'), ['email']).template
        const apiStep = { id: 'a', type: 'destination', position: { x: 300, y: 300 }, kind: 'api', dataSourceId: apiOut.id, method: 'PUT', path: '/employees/{{id}}', body: { format: 'json', template: outTemplate }, idempotencyKey: true }
        const toApi = await savePipeline({
          publish: true,
          name: `${RUN} to intranet API`,
          definition: { schemaVersion: 2, nodes: [{ id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: src.id, table: 'people' }, apiStep], edges: [{ id: 'e1', from: 's', to: 'a' }], settings: { retries: 0 } },
          schedule: { type: 'manual' } as never,
        })
        const apiRun = await runPipelineNow(toApi.id)
        takeAfterCallbacks()
        await processJobs({})
        const apiStatus = await getRunStatus(apiRun.runId)
        alive('the API destination run')
        assert.equal(apiStatus.status, 'success', apiStatus.errorMessage ?? '')
        assert.deepEqual(hrOut.received.map((r) => `${r.method} ${r.path} ${r.idempotencyKey}`), [1, 2, 3].map((id, i) => `PUT /employees/${id} ${apiRun.runId}:0:${i}`))
        assert.equal(hrOut.employees.size, 3)
        assert.ok(logs.some((l) => /^apiWrite HR API out/.test(l)), 'the agent sent the rows')
        const viaAgentTest = await sendApiTestRequest({ pipelineId: toApi.id, step: apiStep as never, row: { id: 7, email: 'seven@kmplus.test' } })
        assert.equal(viaAgentTest.outcome, 'written')
        assert.equal(viaAgentTest.request.headers.Authorization, 'Bearer ••••', 'the agent masks its own token too')
        assert.ok(!JSON.stringify(viaAgentTest).includes('intranet-write-token'))
        // An agent older than 1.3.0 is refused before anything is queued.
        await db.update(agentTable).set({ version: '1.2.0' }).where(eq(agentTable.id, listed.id))
        await rejectsWith(() => sendApiTestRequest({ pipelineId: toApi.id, step: apiStep as never, row: { id: 8, email: 'x@kmplus.test' } }), /needs version 1\.3\.0 or later/)
        await db.update(agentTable).set({ version: '1.3.0' }).where(eq(agentTable.id, listed.id))
        alive('the API destination')

        // The AI assistant can use the model next to the agent: prompts stay in the customer's network.
        await setAiProvider({ provider: 'agent', agentId: listed.id })
        const viaAgent = await getAiSettings()
        assert.equal(viaAgent.ready, true, viaAgent.message)
        assert.equal(viaAgent.model, 'llama3.1:8b')
        await askData({ question: 'How many people?', dataset: `${RUN}_agent_people` })
        assert.equal(agentLlm.requests.length, 1, 'answered by the agent-side model')
        assert.ok(logs.some((l) => /^ai \d+ ms ok/.test(l)))
        await setAiProvider({ provider: 'server' })
        alive('the AI question')

        // A client can't point a data source at an agent itself.
        const sneaky = await createDataSource({ name: 'sneaky', type: 'database', sourceType: 'postgres', config: { role: 'source', agent: { agentId: listed.id, connection: 'HR' } } as never, credentials: {} })
        const [sneakyRow] = await db.select().from(dataSources).where(eq(dataSources.id, sneaky))
        assert.equal((sneakyRow.config as { agent?: unknown }).agent, undefined)
        await rejectsWith(() => addAgentDataSource({ agentId: listed.id, connection: 'nope' }), /doesn't offer a connection/)

        // Revoked: the agent stops, and sources using it fail without retrying.
        await revokeAgent(listed.id)
        assert.match((await outcome)?.message ?? '', /rejected the agent token/)
        await rejectsWith(() => testConnection(src.id), /removed/)
      } finally {
        stop.abort()
        await outcome
        await agentLlm.stop()
        await hrOut.stop()
        await intranet.stop()
      }
      // An agent that stopped polling is reported offline.
      const { token: t2 } = await createAgent('Sleepy agent')
      const sleepy = (await listAgents()).agents.find((a) => a.name === 'Sleepy agent')!
      await db.update(agentTable).set({ lastSeenAt: new Date(Date.now() - 10 * 60_000), connections: [{ name: 'HR', type: 'postgres', writable: false }] }).where(eq(agentTable.id, sleepy.id))
      const offline = await addAgentDataSource({ agentId: sleepy.id, connection: 'HR' })
      await rejectsWith(() => testConnection(offline.id), /offline \(last seen/)
      assert.ok(t2.startsWith('nxa_'))
    })

    await test('Secrets managers supply credentials (never data); infrastructure sources: S3 files and Elasticsearch logs into datasets', async () => {
      setTestUser(admin)
      await switchWorkspace(adminWs)
      process.env.NEXUS_ALLOW_PRIVATE_URLS = 'true'
      const infra = await startInfraMock()
      try {
        // The database URL lives only in Vault; the Postgres source holds a reference to it.
        infra.vaultSecrets['hr/db'].url = process.env.DATABASE_URL!
        for (const slug of ['vault', 'postgres', 's3', 'elasticsearch']) await installConnector(slug)
        const vaultName = `${RUN} Vault`
        const vaultId = await createDataSource({ name: vaultName, type: 'secrets manager', sourceType: 'vault', config: { role: 'source' }, credentials: infra.credentials.vault })
        await testConnection(vaultId)
        assert.deepEqual((await listSecretNames(vaultId)).sort(), ['hr/api', 'hr/db'], 'names only')
        assert.ok((await listSecretManagers()).some((m) => m.id === vaultId))

        const ref = `{{secret:${vaultName}:hr/db#url}}`
        const pgId = await createDataSource({ name: `${RUN} pg via vault`, type: 'database', sourceType: 'postgres', config: { role: 'source' }, credentials: { connectionString: ref, schema: FIXTURE_SCHEMA } })
        await testConnection(pgId)
        const [pgRow] = await db.select().from(dataSources).where(eq(dataSources.id, pgId))
        const storedCreds = decryptCredentials(pgId, pgRow.credentials) as Record<string, string>
        assert.equal(storedCreds.connectionString, ref, 'only the reference is stored')
        assert.ok(!JSON.stringify(pgRow).includes(process.env.DATABASE_URL!.split('@')[1] ?? '\u0000'), 'the resolved URL is never saved')
        const editable = await getEditableCredentials(pgId)
        assert.ok(editable.supported && !editable.custom && editable.values.connectionString === ref, 'the edit form shows the reference (not a secret)')
        assert.equal((await getDataSourceTableSample(pgId, 'employees', 5)).rows.length > 0, true)

        // A pipeline run resolves the reference when it loads the source.
        const viaVault = await savePipeline({
          publish: true,
          name: `${RUN} via vault`,
          definition: {
            schemaVersion: 2,
            nodes: [
              { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: pgId, table: 'employees' },
              { id: 'd', type: 'destination', position: { x: 300, y: 0 }, kind: 'dataset', datasetName: `${RUN}_via_vault`, mode: 'replace' },
            ],
            edges: [{ id: 'e1', from: 's', to: 'd' }],
            settings: { retries: 0 },
          },
          schedule: { type: 'manual' } as never,
        })
        const run1 = await runPipelineNow(viaVault.id)
        takeAfterCallbacks()
        await processJobs({})
        const st1 = await getRunStatus(run1.runId)
        assert.equal(st1.status, 'success', st1.errorMessage ?? '')

        // A wrong reference fails clearly, without retrying.
        await updateDataSourceCredentials(pgId, { connectionString: `{{secret:${vaultName}:hr/missing#url}}` }).then(
          (r) => assert.equal(r.ok, false),
          (e: Error) => assert.match(e.message, /not found/)
        )
        await rejectsWith(() => createDataSource({ name: `${RUN} bad ref`, type: 'database', sourceType: 'postgres', config: { role: 'source' }, credentials: { connectionString: '{{secret:Nope:hr/db#url}}' } }).then((id) => testConnection(id)), /No secrets manager named "Nope"/)

        // Secrets managers never appear as pipeline sources/destinations or catalog items, and can't be sampled.
        const options = await getBuilderOptions()
        assert.ok(!options.dataSources.some((d) => d.id === vaultId), 'not offered in the pipeline editor')
        assert.ok(!(await listCatalog()).items.some((i) => i.sourceName === vaultName), 'not in the catalog')
        await rejectsWith(() => getDataSourceTableSample(vaultId, 'hr/db', 5), /never read as data/)

        // S3: a folder of daily CSV exports is one table; rows carry their file.
        const s3Id = await createDataSource({ name: `${RUN} exports`, type: 'cloud storage', sourceType: 's3', config: { role: 'source' }, credentials: infra.credentials.s3 })
        await testConnection(s3Id)
        const [s3Row] = await db.select().from(dataSources).where(eq(dataSources.id, s3Id))
        const s3Tables = ((s3Row.config as { schemaScan?: { tables: { name: string }[] } }).schemaScan?.tables ?? []).map((t) => t.name)
        assert.ok(s3Tables.includes('daily/*.csv') && s3Tables.includes('reference/orgs.ndjson') && !s3Tables.includes('readme.txt'), s3Tables.join(', '))
        const files = await savePipeline({
          publish: true,
          name: `${RUN} s3 daily`,
          definition: {
            schemaVersion: 2,
            nodes: [
              { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: s3Id, table: 'daily/*.csv' },
              { id: 'd', type: 'destination', position: { x: 300, y: 0 }, kind: 'dataset', datasetName: `${RUN}_s3_daily`, mode: 'replace' },
            ],
            edges: [{ id: 'e1', from: 's', to: 'd' }],
            settings: { retries: 0 },
          },
          schedule: { type: 'manual' } as never,
        })
        const run2 = await runPipelineNow(files.id)
        takeAfterCallbacks()
        await processJobs({})
        const st2 = await getRunStatus(run2.runId)
        assert.equal(st2.status, 'success', st2.errorMessage ?? '')
        assert.equal(st2.recordsProcessed, 3, 'two files, three rows')
        const daily = await getDatasetPreview(`${RUN}_s3_daily`)
        assert.ok(daily.rows.every((r) => String(r._source_file).startsWith('daily/')))
        assert.deepEqual(daily.rows.map((r) => Number(r.salary)).sort(), [1000, 2000, 3000])

        // Elasticsearch: incremental sync pushes the watermark into the query.
        const esId = await createDataSource({ name: `${RUN} logs`, type: 'observability', sourceType: 'elasticsearch', config: { role: 'source' }, credentials: infra.credentials.elasticsearch })
        await testConnection(esId)
        const logs = await savePipeline({
          publish: true,
          name: `${RUN} es logs`,
          definition: {
            schemaVersion: 2,
            nodes: [
              { id: 's', type: 'source', position: { x: 0, y: 0 }, dataSourceId: esId, table: 'logs-hr', mode: 'incremental', watermarkColumn: '@timestamp' },
              { id: 'd', type: 'destination', position: { x: 300, y: 0 }, kind: 'dataset', datasetName: `${RUN}_es_logs`, mode: 'append' },
            ],
            edges: [{ id: 'e1', from: 's', to: 'd' }],
            settings: { retries: 0 },
          },
          schedule: { type: 'manual' } as never,
        })
        const run3 = await runPipelineNow(logs.id)
        takeAfterCallbacks()
        await processJobs({})
        const st3 = await getRunStatus(run3.runId)
        assert.equal(st3.status, 'success', st3.errorMessage ?? '')
        assert.equal(st3.recordsProcessed, 5)
        const run4 = await runPipelineNow(logs.id)
        takeAfterCallbacks()
        await processJobs({})
        assert.equal((await getRunStatus(run4.runId)).recordsProcessed, 0, 'the second run reads only newer documents')
        assert.ok(infra.seen.some((r) => r.service === 'es' && r.path === '/_search/scroll'), 'scroll cleared')
      } finally {
        await infra.stop()
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
    await cleanup([admin, viewer, outsider].map((u) => u.id).concat(await db.select({ id: user.id }).from(user).where(like(user.id, `${RUN}_%`)).then((r) => r.map((x) => x.id))))
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exitCode = failed ? 1 : 0
  await pool.end()
}

async function cleanup(userIds: string[]) {
  const wsIds = (await db.select({ id: workspaceMembers.workspaceId }).from(workspaceMembers).where(inArray(workspaceMembers.userId, userIds))).map((r) => r.id)
  // Environment workspaces created by the tests.
  const created = (await db.select({ id: workspaces.id }).from(workspaces).where(inArray(workspaces.createdBy, userIds))).map((r) => r.id)
  wsIds.push(...created)
  const ws = [...new Set([...wsIds, ...userIds.map((id) => `ws_${id}`)])]
  const datasets = await db.select({ tableName: nexusDatasets.tableName }).from(nexusDatasets).where(inArray(nexusDatasets.workspaceId, ws))
  for (const d of datasets) await pool.query(`DROP TABLE IF EXISTS "nexus_data"."${d.tableName}"`)
  const staged = await db.select({ tableName: pipelineStageTables.tableName }).from(pipelineStageTables).where(inArray(pipelineStageTables.workspaceId, ws))
  for (const t of staged) await pool.query(`DROP TABLE IF EXISTS "nexus_stage"."${t.tableName}"`)
  await db.delete(session).where(inArray(session.userId, userIds))
  await db.delete(verification).where(inArray(verification.value, userIds))
  const keyIds = (await db.select({ id: apiKeys.id }).from(apiKeys).where(inArray(apiKeys.workspaceId, ws))).map((k) => `key:${k.id}`)
  if (keyIds.length) await db.delete(apiRateLimits).where(inArray(apiRateLimits.bucket, keyIds))
  const pipeIds = (await db.select({ id: pipelines.id }).from(pipelines).where(inArray(pipelines.workspaceId, ws))).map((x) => `hook:${x.id}`)
  if (pipeIds.length) await db.delete(apiRateLimits).where(inArray(apiRateLimits.bucket, pipeIds))
  const sso = await db.select({ providerId: workspaceSso.providerId }).from(workspaceSso).where(inArray(workspaceSso.workspaceId, ws))
  if (sso.length) await db.delete(ssoProvider).where(inArray(ssoProvider.providerId, sso.map((x) => x.providerId)))
  for (const t of [dashboardEmbeds, pipelineTriggerEvents, pipelineAlerts, alertChannels, maintenanceWindows, agentTaskTable, agentTable, pipelineApprovals, scimTokens, scimUsers, scimGroups, notifications, workspaceSso, webhookDeliveries, webhooks, mappingTemplates, datasetQualitySnapshots, apiKeys, catalogEntries, domainMappings, businessRuleVersions, businessRules, datasetPolicies, dashboards, sourceHealthChecks, datasetColumnAliases, datasetSchemaVersions, datasetSchemas, upgradeNoticeDismissals, nexusDatasets, pipelineRunRejects, executionLogs, pipelineStageTables, apiCallCache, apiCallLedger, pipelineJobs, pipelineVersions, pipelines, dataSources, connectorInstalls, workspaceInvites, auditLogs, workspaceMembers]) {
    await db.delete(t).where(inArray(t.workspaceId, ws))
  }
  await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds))
  await db.delete(workspaces).where(inArray(workspaces.id, ws))
  await pool.query('delete from terms_acceptances where "userId" like $1', [`${RUN}_%`])
  await db.delete(user).where(like(user.id, `${RUN}_%`))
  await pool.query(`DROP SCHEMA IF EXISTS "${FIXTURE_SCHEMA}" CASCADE`)
}

main().catch(async (err) => {
  console.error(err)
  process.exitCode = 1
  await pool.end().catch(() => undefined)
})
