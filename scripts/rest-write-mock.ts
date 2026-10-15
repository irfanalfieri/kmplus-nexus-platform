/**
 * Runs a local REST API that records what pipelines send to it (API
 * destination steps), on a fixed port, for trying REST destinations end to end.
 *
 *   node scripts/run-ts.mjs scripts/rest-write-mock.ts [port] [token]
 *
 * Add it in Nexus with Data sources → Add destination → REST API, base URL
 * http://127.0.0.1:4030, sign-in Bearer token with the token below. The Nexus
 * server needs NEXUS_ALLOW_PRIVATE_URLS=true (development) or
 * NEXUS_PRIVATE_NETWORK_ACCESS=true (local production build) to reach it.
 * Routes: POST /employees, PUT /employees/:code, POST /employees/batch, POST /echo
 * (scripts/test/rest-write-mock.ts). Port + 1 serves /_received (what arrived) and /_employees.
 */
import { createServer } from 'node:http'
import { startRestWriteMock } from './test/rest-write-mock'

const port = Number(process.argv[2] ?? 4030)
const token = process.argv[3] ?? 'local-rest-token'

const mock = await startRestWriteMock(token, port)
// A second port with the record of requests, so a check script can read it.
const inspect = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(req.url?.startsWith('/_employees') ? Object.fromEntries(mock.employees) : mock.received))
})
inspect.listen(port + 1, '127.0.0.1')
console.log(`REST write mock listening on ${mock.baseUrl} (token: ${token})`)
console.log(`What it received: http://127.0.0.1:${port + 1}/_received  ·  stored employees: http://127.0.0.1:${port + 1}/_employees`)

let seen = 0
setInterval(() => {
  if (mock.received.length === seen) return
  for (const r of mock.received.slice(seen)) console.log(`${new Date(r.at).toISOString()}  ${r.method} ${r.path}  ${r.contentType}  ${r.body.length} bytes${r.idempotencyKey ? `  key ${r.idempotencyKey}` : ''}`)
  seen = mock.received.length
}, 500)

process.on('SIGINT', async () => {
  inspect.close()
  await mock.stop()
  process.exit(0)
})
