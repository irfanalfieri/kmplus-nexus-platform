/**
 * End-to-end connector runtime test — same path as FE server actions (no auth).
 * Usage:
 *   SB_SECRET=... SB_PUBLISHABLE=... SUPABASE_URL=... npx tsx scripts/test-connector-e2e.mjs
 */
import {
  testConnectorConnection,
  scanConnectorSchema,
  sampleConnectorTable,
} from '../lib/connectors/runtime.ts'

const credentials = {
  projectUrl: process.env.SUPABASE_URL ?? 'https://lasbpwjvzjjjtpqtkhog.supabase.co',
  secretKey: process.env.SB_SECRET ?? '',
  publishableKey: process.env.SB_PUBLISHABLE ?? '',
  schema: 'public',
}

if (!credentials.secretKey) {
  console.error('Set SB_SECRET (and optionally SB_PUBLISHABLE, SUPABASE_URL)')
  process.exit(1)
}

async function run() {
  console.log('=== Connector runtime (supabase slug) — FE credential field names ===')

  const test = await testConnectorConnection('supabase', credentials)
  console.log('test:', test)
  if (!test.ok) process.exit(1)

  const scan = await scanConnectorSchema('supabase', credentials)
  console.log('scan: tables=', scan.tables.length, 'method=', scan.method)
  const withCols = scan.tables.filter((t) => t.columns.length > 0)
  console.log('tables with columns:', withCols.length)
  if (withCols.length === 0) process.exit(1)

  const table = scan.tables.find((t) => t.name === 'breeder_pig') ?? withCols[0]
  const sample = await sampleConnectorTable('supabase', credentials, table.name, 2)
  console.log('sample:', table.name, 'rows=', sample.rows.length, 'total=', sample.totalRows)

  if (process.env.SB_PUBLISHABLE) {
    console.log('\n=== Publishable-only connection probe (official apikey header) ===')
    const pubOnly = {
      projectUrl: credentials.projectUrl,
      secretKey: process.env.SB_PUBLISHABLE,
      publishableKey: process.env.SB_PUBLISHABLE,
    }
    const pubTest = await testConnectorConnection('supabase', pubOnly)
    console.log('publishable test:', pubTest)
  }

  console.log('\nOK — FE catalog fields → runtime → live Supabase verified')
}

run().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
