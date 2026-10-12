/**
 * Runs the reference KMPlus product (Nexus Ingest Contract v1) on a fixed port
 * so a local Nexus can send employees to it (test-data/README.md, scenario 9).
 *
 *   node scripts/run-ts.mjs scripts/mock-kmplus.ts [port] [token]
 *
 * Add it in Nexus as a "KMPlus Products" destination with Base URL
 * http://127.0.0.1:4010 and the token below. The dev server needs
 * NEXUS_ALLOW_PRIVATE_URLS=true in .env.local to reach a local http address.
 * Every upsert batch is printed; records are kept in memory until you stop it.
 */
import { startKmplusMock } from './test/kmplus-mock'

const port = Number(process.argv[2] ?? 4010)
const token = process.argv[3] ?? 'local-kmplus-token'

const mock = await startKmplusMock(token, port)
console.log(`Mock KMPlus LMS listening on ${mock.baseUrl}`)
console.log(`API token: ${token}`)
console.log('Entities: employee (key employee_code; employee_code + email required), organization (key org_code)')

let seenBatches = 0
setInterval(() => {
  if (mock.batches.size === seenBatches) return
  seenBatches = mock.batches.size
  const counts = [...mock.store].map(([entity, rows]) => `${entity}: ${rows.size}`).join(', ')
  console.log(`${new Date().toISOString()}  ${seenBatches} batch(es) received · stored ${counts || 'nothing yet'}`)
}, 1000)

process.on('SIGINT', async () => {
  await mock.stop()
  process.exit(0)
})
