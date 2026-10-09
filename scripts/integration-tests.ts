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
import { auditLogs, connectorInstalls, dashboards, dataSources, datasetPolicies, executionLogs, nexusDatasets, pipelineJobs, pipelineRunRejects, pipelines, pipelineVersions, session, user, verification, workspaceInvites, workspaceMembers, workspaces } from '@/lib/db/schema'
import { acceptInvite, changeMemberRole, createInvite, getWorkspaceContext, listMembers, resetMemberTwoFactor, switchWorkspace } from '@/lib/actions/workspaces'
import { installConnector } from '@/lib/actions/connectors'
import { createDataSource, getDataSources, setDataSourceRole } from '@/lib/actions/data-sources'
import { cancelPipelineRun, getDatasetPreview, getRunStatus, listPipelines, listRuns, retryPipelineRun, runPipelineNow, savePipeline } from '@/lib/actions/pipelines'
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
      assert.equal((stored.credentials as { __enc?: string }).__enc, 'v1', 'stored encrypted')
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
  for (const t of [datasetPolicies, dashboards, nexusDatasets, pipelineRunRejects, executionLogs, pipelineJobs, pipelineVersions, pipelines, dataSources, connectorInstalls, workspaceInvites, auditLogs, workspaceMembers]) {
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
