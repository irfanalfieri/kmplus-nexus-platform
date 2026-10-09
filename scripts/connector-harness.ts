/**
 * Connector test harness: runs test → scan → sample for every connector via
 * lib/connectors/runtime (the same code path the app uses).
 * Run with: node scripts/run-ts.mjs scripts/connector-harness.ts
 *
 * Public demo endpoints are used where they exist. Connectors that need a real
 * account run only when their env vars are set, otherwise they are SKIPPED.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CONNECTOR_CATALOG } from '@/lib/connectors/catalog'
import { REST_DEFAULTS } from '@/lib/connectors/rest-client'
import { sampleConnectorTable, scanConnectorSchema, testConnectorConnection } from '@/lib/connectors/runtime'
import type { ConnectorCredentials, ConnectorSlug } from '@/lib/connectors/types'

type Case = { slug: ConnectorSlug; label: string; publicEndpoint?: boolean; credentials?: ConnectorCredentials; sampleTable?: string; skip?: string; setup?: () => Promise<() => void | Promise<void>> }
type Outcome = { label: string; slug: string; status: 'PASS' | 'FAIL' | 'SKIP' | 'UNREACHABLE'; detail: string; ms: number }

const env = process.env
const restDefaults = Object.fromEntries(Object.entries(REST_DEFAULTS).map(([k, v]) => [k, String(v)]))

// ── Talenta mock: a local Mekari gateway that verifies the HMAC signature ────
const TALENTA_ID = 'harness-client'
const TALENTA_SECRET = 'harness-secret'
let talentaBase = ''
async function startTalentaMock() {
  const employees = Array.from({ length: 7 }, (_, i) => ({
    user_id: 1000 + i,
    personal: { first_name: `Employee${i}`, email: `e${i}@example.co.id` },
    employment: { employee_id: `EMP-${i}`, branch: 'Jakarta', status: i % 3 ? 'Active' : 'Inactive' },
  }))
  const server = createServer((req, res) => {
    const date = req.headers['date'] ?? ''
    const expected = createHmac('sha256', TALENTA_SECRET).update(`date: ${date}\n${req.method} ${req.url} HTTP/1.1`).digest('base64')
    const auth = String(req.headers['authorization'] ?? '')
    const ok = auth === `hmac username="${TALENTA_ID}", algorithm="hmac-sha256", headers="date request-line", signature="${expected}"`
    const skew = Math.abs(Date.now() - new Date(String(date)).getTime())
    if (!ok || !(skew < 300_000)) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'HMAC signature does not match' }))
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname !== '/v2/talenta/v2/employee') return void res.writeHead(404).end('{}')
    const limit = Number(url.searchParams.get('limit')) || 10
    const page = Number(url.searchParams.get('page')) || 1
    const slice = employees.slice((page - 1) * limit, page * limit)
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'success', data: { employees: slice, pagination: { current_page: page } } }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  talentaBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return () => {
    server.close()
  }
}

// ── Postgres fixture: throwaway schema + login role that can only read it ────
let postgresFixtureUrl = ''
async function startPostgresFixture() {
  const { default: pg } = await import('pg')
  const admin = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await admin.connect()
  const suffix = randomBytes(4).toString('hex')
  const schema = `nexus_harness_${suffix}`
  const role = `nexus_harness_${suffix}`
  const password = randomBytes(18).toString('base64url')
  await admin.query(`CREATE SCHEMA ${schema}`)
  await admin.query(`CREATE TABLE ${schema}.employees (employee_code text PRIMARY KEY, full_name text, hire_date date, salary numeric)`)
  await admin.query(`INSERT INTO ${schema}.employees VALUES ('E1','Amira','2021-03-15',12500000.5),('E2','Budi','2022-01-10',9000000)`)
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`)
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`)
  await admin.query(`GRANT SELECT ON ${schema}.employees TO ${role}`)
  const url = new URL(env.DATABASE_URL!)
  const user = url.username.includes('.') ? `${role}.${url.username.split('.')[1]}` : role // Supabase pooler: role.project_ref
  postgresFixtureUrl = `postgresql://${user}:${password}@${url.host}${url.pathname}`
  fixtureSchema = schema
  await new Promise((r) => setTimeout(r, 2500)) // let the pooler see the new role
  return async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined)
    await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined)
    await admin.end()
  }
}
let fixtureSchema = ''

const cases: Case[] = [
  {
    slug: 'rest',
    label: 'REST (JSONPlaceholder /users)',
    publicEndpoint: true,
    credentials: { ...restDefaults, baseUrl: 'https://jsonplaceholder.typicode.com', resourcePath: '/users' },
    sampleTable: 'users',
  },
  {
    slug: 'sap',
    label: 'SAP OData (public Northwind V2 demo)',
    publicEndpoint: true,
    credentials: { host: 'https://services.odata.org/V2/Northwind/Northwind.svc', username: 'anonymous', password: '' },
    sampleTable: 'Employees',
  },
  env.MYSQL_TEST_HOST
    ? {
        slug: 'mysql',
        label: 'MySQL (MYSQL_TEST_*)',
        credentials: { host: env.MYSQL_TEST_HOST, port: env.MYSQL_TEST_PORT ?? '3306', username: env.MYSQL_TEST_USER ?? '', password: env.MYSQL_TEST_PASSWORD ?? '', database: env.MYSQL_TEST_DATABASE ?? '' },
        sampleTable: env.MYSQL_TEST_TABLE,
      }
    : {
        slug: 'mysql',
        label: 'MySQL (public Rfam database, EMBL-EBI)',
        publicEndpoint: true,
        credentials: { host: 'mysql-rfam-public.ebi.ac.uk', port: '4497', username: 'rfamro', password: '', database: 'Rfam' },
        sampleTable: 'family',
      },
  env.POSTGRES_TEST_URL
    ? { slug: 'postgres', label: 'PostgreSQL (POSTGRES_TEST_URL)', credentials: { connectionString: env.POSTGRES_TEST_URL, schema: env.POSTGRES_TEST_SCHEMA ?? 'public' }, sampleTable: env.POSTGRES_TEST_TABLE }
    : env.DATABASE_URL
      ? { slug: 'postgres', label: 'PostgreSQL (temporary fixture via restricted role)', setup: startPostgresFixture, sampleTable: 'employees' }
      : { slug: 'postgres', label: 'PostgreSQL', skip: 'set POSTGRES_TEST_URL, or run with --env-file=.env.local to use a temporary fixture' },
  {
    slug: 'ldap',
    label: 'LDAP (public Forum Systems test directory)',
    publicEndpoint: true,
    credentials: { url: 'ldap://ldap.forumsys.com:389', bindDN: 'cn=read-only-admin,dc=example,dc=com', password: 'password', baseDN: 'dc=example,dc=com' },
    sampleTable: 'users',
  },
  {
    slug: 'talenta',
    label: 'Talenta (local Mekari mock, verifies HMAC)',
    setup: startTalentaMock,
    sampleTable: 'employee',
  },
  env.SUPABASE_TEST_URL && (env.SUPABASE_TEST_SECRET_KEY || env.SUPABASE_TEST_PUBLISHABLE_KEY)
    ? {
        slug: 'supabase',
        label: 'Supabase (SUPABASE_TEST_*)',
        credentials: { projectUrl: env.SUPABASE_TEST_URL, secretKey: env.SUPABASE_TEST_SECRET_KEY ?? '', publishableKey: env.SUPABASE_TEST_PUBLISHABLE_KEY ?? '', databaseUrl: env.SUPABASE_TEST_DATABASE_URL ?? '', schema: env.SUPABASE_TEST_SCHEMA ?? 'public' },
        sampleTable: env.SUPABASE_TEST_TABLE,
      }
    : { slug: 'supabase', label: 'Supabase', skip: 'set SUPABASE_TEST_URL + SUPABASE_TEST_SECRET_KEY (and optionally SUPABASE_TEST_TABLE)' },
  env.ORACLE_TEST_CONNECTION
    ? { slug: 'oracle', label: 'Oracle (ORACLE_TEST_CONNECTION)', credentials: { connectionString: env.ORACLE_TEST_CONNECTION, schema: env.ORACLE_TEST_SCHEMA ?? '' }, sampleTable: env.ORACLE_TEST_TABLE }
    : { slug: 'oracle', label: 'Oracle', skip: 'no public Oracle server; set ORACLE_TEST_CONNECTION=oracle://user:pass@host:1521/service' },
  env.SNOWFLAKE_TEST_ACCOUNT
    ? {
        slug: 'snowflake',
        label: 'Snowflake (SNOWFLAKE_TEST_*)',
        credentials: { account: env.SNOWFLAKE_TEST_ACCOUNT, username: env.SNOWFLAKE_TEST_USER ?? '', password: env.SNOWFLAKE_TEST_PASSWORD ?? '', warehouse: env.SNOWFLAKE_TEST_WAREHOUSE ?? '', database: env.SNOWFLAKE_TEST_DATABASE ?? '', schema: env.SNOWFLAKE_TEST_SCHEMA ?? 'PUBLIC' },
        sampleTable: env.SNOWFLAKE_TEST_TABLE,
      }
    : { slug: 'snowflake', label: 'Snowflake', skip: 'needs a Snowflake account; set SNOWFLAKE_TEST_ACCOUNT/USER/PASSWORD/WAREHOUSE/DATABASE' },
  { slug: 'salesforce', label: 'Salesforce', skip: 'OAuth login needs a browser; test from Data Sources → Add Source with a Salesforce org' },
]

async function runCase(c: Case): Promise<Outcome> {
  const started = Date.now()
  const done = (status: Outcome['status'], detail: string): Outcome => ({ label: c.label, slug: c.slug, status, detail, ms: Date.now() - started })
  if (c.skip) return done('SKIP', c.skip)
  let teardown: (() => void | Promise<void>) | undefined
  try {
    if (c.setup) teardown = await c.setup()
    const credentials =
      c.slug === 'talenta' ? { clientId: TALENTA_ID, clientSecret: TALENTA_SECRET, baseUrl: talentaBase, pageSize: '3' }
      : c.slug === 'postgres' && !c.credentials ? { connectionString: postgresFixtureUrl, schema: fixtureSchema }
      : c.credentials!
    const test = await testConnectorConnection(c.slug, credentials)
    if (!test.ok && c.publicEndpoint && NETWORK_ERROR.test(test.message)) {
      return done('UNREACHABLE', `third-party demo endpoint down or blocked (${test.message}); not a connector failure. Re-run later or set private test credentials.`)
    }
    if (!test.ok) return done('FAIL', `test: ${test.message}`)
    const scan = await scanConnectorSchema(c.slug, credentials)
    if (!scan.tables.length) return done('FAIL', 'scan returned no tables/objects')
    const table = c.sampleTable ?? scan.tables[0].name
    const scanned = scan.tables.find((t) => t.name === table)
    const sample = await sampleConnectorTable(c.slug, credentials, table, 5)
    if (!sample.rows.length) return done('FAIL', `sample of "${table}" returned 0 rows`)
    const extra = c.slug === 'talenta'
      ? ` · paging read ${(await sampleConnectorTable(c.slug, credentials, table, 100)).rows.length}/7 rows · flattened keys: ${Object.keys(sample.rows[0]).slice(0, 3).join(', ')}`
      : ''
    return done('PASS', `${scan.tables.length} objects via ${scan.method} · "${table}" ${scanned ? `${scanned.columns.length} cols` : ''} · sample ${sample.rows.length} rows${extra}`)
  } catch (error) {
    return done('FAIL', error instanceof Error ? error.message : String(error))
  } finally {
    await teardown?.()
  }
}

async function negativeChecks() {
  const results: string[] = []
  const bad = await testConnectorConnection('ldap', { url: 'ldap://ldap.forumsys.com:389', bindDN: 'cn=read-only-admin,dc=example,dc=com', password: 'wrong', baseDN: 'dc=example,dc=com' })
  results.push(`LDAP wrong password → ${bad.ok ? 'UNEXPECTED OK' : `rejected ("${bad.message}")`}`)
  const stop = await startTalentaMock()
  const badT = await testConnectorConnection('talenta', { clientId: TALENTA_ID, clientSecret: 'wrong-secret', baseUrl: talentaBase })
  stop()
  results.push(`Talenta wrong secret → ${badT.ok ? 'UNEXPECTED OK' : `rejected ("${badT.message.slice(0, 80)}")`}`)
  const badM = await testConnectorConnection('mysql', { host: 'mysql-rfam-public.ebi.ac.uk', port: '4497', username: 'rfamro', password: 'nope', database: 'Rfam' })
  results.push(`MySQL wrong password → ${badM.ok ? 'UNEXPECTED OK' : NETWORK_ERROR.test(badM.message) ? 'endpoint unreachable (not checked)' : `rejected ("${badM.message.slice(0, 70)}")`}`)
  return results
}

const NETWORK_ERROR = /ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|unreachable|timed? ?out|fetch failed/i

const covered = new Set(cases.map((c) => c.slug))
const missing = CONNECTOR_CATALOG.filter((c) => !covered.has(c.slug)).map((c) => c.slug)

async function main() {
const outcomes: Outcome[] = []
for (const c of cases) {
  const o = await runCase(c)
  outcomes.push(o)
  console.log(`${o.status.padEnd(11)}  ${o.label.padEnd(52)} ${String(o.ms).padStart(6)} ms  ${o.detail}`)
}
console.log('\nNegative checks:')
for (const line of await negativeChecks()) console.log(`  ${line}`)
if (missing.length) console.log(`\nWARNING: catalog connectors without a test case: ${missing.join(', ')}`)
const failed = outcomes.filter((o) => o.status === 'FAIL').length
console.log(`\n${outcomes.filter((o) => o.status === 'PASS').length} passed, ${failed} failed, ${outcomes.filter((o) => o.status === 'UNREACHABLE').length} unreachable, ${outcomes.filter((o) => o.status === 'SKIP').length} skipped`)
process.exit(failed ? 1 : 0)
}

void main()
