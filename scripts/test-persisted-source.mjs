/**
 * Simulates saved data source → server action path (DB read + connector runtime).
 */
import pg from 'pg'
import {
  testConnectorConnection,
  scanConnectorSchema,
  sampleConnectorTable,
} from '../lib/connectors/runtime.ts'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5433/kmplus' })

const credentials = {
  projectUrl: process.env.SUPABASE_URL ?? 'https://lasbpwjvzjjjtpqtkhog.supabase.co',
  secretKey: process.env.SB_SECRET ?? '',
  publishableKey: process.env.SB_PUBLISHABLE ?? '',
  schema: 'public',
}

if (!credentials.secretKey) {
  console.error('Set SB_SECRET')
  process.exit(1)
}

async function run() {
  const client = await pool.connect()
  try {
    const userRes = await client.query('SELECT id FROM "user" LIMIT 1')
    const userId = userRes.rows[0]?.id
    if (!userId) {
      console.log('No local user — skipping DB persist test (sign up at /sign-up first)')
      return
    }

    const sourceId = `src_test_${Date.now()}`
    await client.query(
      `INSERT INTO data_sources (id, "userId", name, type, "sourceType", config, credentials, status, "lastConnected", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())`,
      [
        sourceId,
        userId,
        'E2E Supabase Test',
        'database',
        'supabase',
        JSON.stringify({ role: 'source' }),
        JSON.stringify(credentials),
        'disconnected',
      ]
    )

    const { rows } = await client.query(
      'SELECT "sourceType", credentials FROM data_sources WHERE id = $1',
      [sourceId]
    )
    const row = rows[0]
    const stored = Object.fromEntries(
      Object.entries(row.credentials).map(([k, v]) => [k, v == null ? '' : String(v)])
    )

    console.log('Loaded persisted credentials keys:', Object.keys(stored).join(', '))

    const test = await testConnectorConnection(row.sourceType, stored)
    console.log('persisted test:', test)
    if (!test.ok) process.exit(1)

    const scan = await scanConnectorSchema(row.sourceType, stored)
    console.log('persisted scan tables:', scan.tables.length)

    const sample = await sampleConnectorTable(row.sourceType, stored, 'breeder_pig', 1)
    console.log('persisted sample row keys:', sample.rows[0] ? Object.keys(sample.rows[0]).slice(0, 4).join(', ') : 'none')

    await client.query('DELETE FROM data_sources WHERE id = $1', [sourceId])
    console.log('OK — local DB persist → runtime → live Supabase verified')
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
