import { testSupabaseConnection, scanSupabaseSchema, fetchSupabaseTableSample } from '../lib/supabase/connector.ts'

const PROJECT_URL = process.env.SUPABASE_URL ?? 'https://lasbpwjvzjjjtpqtkhog.supabase.co'
const SECRET = process.env.SB_SECRET
const PUBLISHABLE = process.env.SB_PUBLISHABLE

if (!SECRET && !PUBLISHABLE) {
  console.error('Set SB_SECRET and/or SB_PUBLISHABLE env vars')
  process.exit(1)
}

async function run() {
  const credentials = {
    projectUrl: PROJECT_URL,
    apiKey: SECRET ?? PUBLISHABLE,
    publishableKey: PUBLISHABLE,
    schema: 'public',
  }

  console.log('--- Connection test ---')
  const test = await testSupabaseConnection(credentials)
  console.log(JSON.stringify(test, null, 2))
  if (!test.ok) process.exit(1)

  console.log('--- Schema scan ---')
  const scan = await scanSupabaseSchema(credentials)
  console.log('tables:', scan.tables.length)
  const withCols = scan.tables.filter((t) => t.columns.length > 0)
  console.log('tables with columns:', withCols.length)
  console.log(
    'samples:',
    withCols.slice(0, 5).map((t) => `${t.name}(${t.columns.length} cols, rows=${t.rowCount})`)
  )

  const emptyCols = scan.tables.filter((t) => t.columns.length === 0)
  if (emptyCols.length) {
    console.log('WARNING: tables without columns:', emptyCols.map((t) => t.name).join(', '))
  }

  const target = scan.tables.find((t) => t.name === 'breeder_pig') ?? withCols[0]
  if (target) {
    console.log('--- Sample data:', target.name, '---')
    const sample = await fetchSupabaseTableSample(credentials, target.name, 3)
    console.log('rows:', sample.rows.length, 'total:', sample.totalRows)
    console.log('columns:', sample.columns.slice(0, 5).join(', '))
  }
}

run().catch((error) => {
  console.error('FAILED:', error)
  process.exit(1)
})
