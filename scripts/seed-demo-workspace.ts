/**
 * Seeds a demo workspace on the dev database from test-data/ through the real
 * server actions (uploads, pipelines, runs, quarantine, a rule, a dashboard),
 * and writes a local session cookie so the UI can be reviewed signed in.
 *
 *   node --env-file=.env.local scripts/run-ts.mjs --stubs scripts/seed-demo-workspace.ts [--reset]
 *
 * Dev databases only (nexus_dev / nexus_test). The cookie goes to
 * node_modules/.cache/demo-session-cookie.txt (gitignored), never to the console.
 */
import { createHmac, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import Papa from 'papaparse'
import readXlsxFile from 'read-excel-file/node'
import { eq, inArray } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { nexusDatasets, session, user, workspaceMembers } from '@/lib/db/schema'
import { getWorkspaceContext, renameWorkspace } from '@/lib/actions/workspaces'
import { installConnector } from '@/lib/actions/connectors'
import { createDataSource } from '@/lib/actions/data-sources'
import { uploadFilePart } from '@/lib/actions/files'
import { getBuilderOptions, runPipelineNow, savePipeline } from '@/lib/actions/pipelines'
import { saveRule } from '@/lib/actions/rules'
import { saveDashboard } from '@/lib/actions/analytics'
import { getEnvironments, setupEnvironments } from '@/lib/actions/environments'
import { processJobs } from '@/lib/pipelines/jobs'
import { buildPipelineTemplate, type PipelineTemplateId } from '@/lib/pipelines/templates'
import { cleanTableName, toSheet, uploadParts, type Cell } from '@/lib/files/parse'
import { setTestUser, takeAfterCallbacks } from './test/stubs'

const DEMO = { id: 'demo_user_nexus', email: 'dewi.lestari@kmplus-demo.co.id', name: 'Dewi Lestari', twoFactorEnabled: true }

async function main() {
  const { rows } = await pool.query<{ db: string }>('select current_database() as db')
  if (!['nexus_dev', 'nexus_test'].includes(rows[0].db)) throw new Error(`Refusing to seed database "${rows[0].db}".`)

  if (process.argv.includes('--reset')) await reset()
  await db.insert(user).values({ id: DEMO.id, email: DEMO.email, name: DEMO.name, emailVerified: true, twoFactorEnabled: true }).onConflictDoNothing()
  setTestUser(DEMO)
  const ctx = await getWorkspaceContext()
  await renameWorkspace('PT KMPlus Indonesia')
  console.log(`Workspace ${ctx.workspace.id}`)

  const existing = await db.select({ name: nexusDatasets.name }).from(nexusDatasets).where(eq(nexusDatasets.workspaceId, ctx.workspace.id))
  if (!existing.length) await seed()
  else console.log('Already seeded (pass --reset to start over).')

  // Environments (GV-7): this workspace is Development; Staging and Production are created
  // next to it (Production locked), so promotion can be shown.
  if (!(await getEnvironments()).group.length) {
    const { created } = await setupEnvironments({ environment: 'dev', create: ['staging', 'prod'] })
    console.log(`Environments: ${created.map((c) => c.name).join(', ')}`)
  }

  // A local session for the browser (signed like Better Auth's own cookie).
  const token = randomUUID().replace(/-/g, '')
  await db.insert(session).values({ id: `demo_${token.slice(0, 12)}`, userId: DEMO.id, token, expiresAt: new Date(Date.now() + 7 * 86_400_000), authMethod: 'sso' })
  const sig = createHmac('sha256', process.env.BETTER_AUTH_SECRET ?? '').update(token).digest('base64')
  mkdirSync('node_modules/.cache', { recursive: true })
  writeFileSync('node_modules/.cache/demo-session-cookie.txt', `better-auth.session_token=${encodeURIComponent(`${token}.${sig}`)}`)
  console.log('Session cookie written to node_modules/.cache/demo-session-cookie.txt')
  await pool.end()
}

async function upload(sourceId: string, path: string, opts: { sheet?: string } = {}) {
  let data: Cell[][]
  if (path.endsWith('.xlsx')) {
    const sheets = (await readXlsxFile(path)) as unknown as { sheet: string; data: Cell[][] }[]
    data = (sheets.find((s) => s.sheet === opts.sheet) ?? sheets[0]).data
  } else {
    data = Papa.parse<string[]>(readFileSync(path, 'utf8'), { skipEmptyLines: true }).data as Cell[][]
  }
  const sheet = toSheet(data)
  const table = cleanTableName(path.split('/').pop()!)
  const parts = uploadParts(sheet.rows)
  let sent = 0
  for (let i = 0; i < parts.length; i++) {
    sent += parts[i].length
    await uploadFilePart({ dataSourceId: sourceId, table, fileName: path.split('/').pop()!, sheet: opts.sheet, columns: sheet.columns, rows: parts[i], part: i, final: i === parts.length - 1, mode: 'replace', sent })
  }
  console.log(`Uploaded ${table}: ${sheet.rows.length} rows`)
  return table
}

async function runAll(ids: string[]) {
  for (const id of ids) await runPipelineNow(id)
  takeAfterCallbacks()
  for (let i = 0; i < 20; i++) {
    const res = await processJobs({})
    if (!res.length) break
  }
}

async function pipeline(template: PipelineTemplateId, sourceId: string, table: string, datasetName: string, name: string) {
  const options = await getBuilderOptions()
  const src = options.dataSources.find((d) => d.id === sourceId)!
  const columns = src.tables.find((t) => t.name === table)?.columns ?? []
  const built = buildPipelineTemplate(template, { dataSourceId: sourceId, sourceType: src.sourceType, table, columns, datasetName, datasets: options.datasets })
  const saved = await savePipeline({ name, description: built.description, definition: { schemaVersion: 2, nodes: built.nodes, edges: built.edges }, schedule: { type: 'manual' } as never, publish: true })
  return saved.id
}

async function seed() {
  await installConnector('file')
  const sourceId = await createDataSource({ name: 'HR exports (uploads)', type: 'file', sourceType: 'file', config: { role: 'source' } })
  const orgs = await upload(sourceId, 'test-data/reference/organizations.csv')
  const positions = await upload(sourceId, 'test-data/reference/positions.csv')
  const sap = await upload(sourceId, 'test-data/hris/employees_sap_pa0001.csv')
  const training = await upload(sourceId, 'test-data/learning/training_history.csv')
  const ad = await upload(sourceId, 'test-data/identity/ad_users.csv')
  const kmi = await upload(sourceId, 'test-data/hris/karyawan_kmi.xlsx', { sheet: 'Karyawan' })

  await runAll([await pipeline('csv-dataset', sourceId, orgs, 'organizations', 'Organizations'), await pipeline('csv-dataset', sourceId, positions, 'positions', 'Positions')])
  await runAll([
    await pipeline('hris-employee', sourceId, sap, 'employees', 'SAP employees → Employee'),
    await pipeline('hris-employee', sourceId, kmi, 'employees_kmi', 'KMI local HRIS → Employee'),
    await pipeline('ad-users', sourceId, ad, 'ad_users', 'Active Directory users'),
    await pipeline('csv-dataset', sourceId, training, 'training_history', 'Training history'),
  ])

  await saveRule({
    name: 'Contract staff need HR approval',
    description: 'Hold contract employees until HR confirms them.',
    body: { when: { match: 'all', conditions: [{ field: 'employment_type', operator: 'equals', value: 'Kontrak', valueField: '' }], groups: [] }, then: [{ type: 'require_approval', reason: 'Contract employee' }], otherwise: [] },
  })
  await saveDashboard({
    name: 'Workforce overview',
    description: 'Headcount and hiring from the SAP export.',
    widgets: [
      { id: 'w1', title: 'Employees', type: 'kpi', dataset: 'employees', measure: { agg: 'count', column: '' }, dimension: null, filters: [], sort: 'value_desc', limit: 12, size: 'small' },
      { id: 'w2', title: 'Headcount by organization', type: 'bar', dataset: 'employees', measure: { agg: 'count', column: '' }, dimension: { column: 'org_code', grain: 'none' }, filters: [], sort: 'value_desc', limit: 12, size: 'wide' },
      { id: 'w3', title: 'Hires per year', type: 'line', dataset: 'employees', measure: { agg: 'count', column: '' }, dimension: { column: 'hire_date', grain: 'year' }, filters: [], sort: 'label_asc', limit: 20, size: 'wide' },
    ],
  })
  console.log('Seeded pipelines, runs, quarantine, a rule and a dashboard.')
}

async function reset() {
  const ws = (await db.select({ id: workspaceMembers.workspaceId }).from(workspaceMembers).where(eq(workspaceMembers.userId, DEMO.id))).map((r) => r.id)
  if (!ws.length) return
  const tables = await db.select({ t: nexusDatasets.tableName }).from(nexusDatasets).where(inArray(nexusDatasets.workspaceId, ws))
  for (const { t } of tables) await pool.query(`DROP TABLE IF EXISTS "nexus_data"."${t.replace(/"/g, '""')}"`)
  for (const t of ['audit_logs', 'notifications', 'dashboards', 'business_rule_versions', 'business_rules', 'pipeline_run_rejects', 'pipeline_jobs', 'execution_logs', 'pipeline_versions', 'pipeline_approvals', 'pipelines', 'nexus_datasets', 'dataset_quality_snapshots', 'dataset_policies', 'catalog_entries', 'data_sources', 'connector_installs', 'workspace_members']) {
    await pool.query(`DELETE FROM ${t} WHERE "workspaceId" = ANY($1)`, [ws])
  }
  await pool.query(`DROP SCHEMA IF EXISTS nexus_raw_unused CASCADE`)
  await pool.query('DELETE FROM workspaces WHERE id = ANY($1)', [ws])
  await db.delete(session).where(eq(session.userId, DEMO.id))
  console.log('Reset the demo workspace.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
