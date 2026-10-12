import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A minimal KMPlus product implementing the Nexus Ingest Contract v1, for the
 * connector harness and integration tests. Records are kept in memory, upserted
 * by the entity key; records without an email are rejected (to exercise the
 * quarantine path).
 */
export async function startKmplusMock(token = 'mock-token', port = 0) {
  const store = new Map<string, Map<string, Record<string, unknown>>>()
  const batches = new Set<string>()
  const entities = [
    { name: 'employee', key: 'employee_code', fields: [{ name: 'employee_code', type: 'text', required: true }, { name: 'full_name', type: 'text' }, { name: 'email', type: 'text', required: true }, { name: 'org_code', type: 'text' }] },
    { name: 'organization', key: 'org_code', fields: [{ name: 'org_code', type: 'text', required: true }, { name: 'name', type: 'text' }] },
  ]
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'bad token' })
    const url = new URL(req.url ?? '/', 'http://x')
    const m = /^\/nexus\/v1\/entities\/([^/]+)(\/upsert)?$/.exec(url.pathname)
    if (url.pathname === '/nexus/v1/health') return send(200, { product: 'LMS (mock)', version: '1.0' })
    if (url.pathname === '/nexus/v1/entities') return send(200, { entities })
    if (m && req.method === 'GET') return send(200, { records: [...(store.get(m[1])?.values() ?? [])].slice(0, Number(url.searchParams.get('limit') ?? 25)) })
    if (m && m[2] && req.method === 'POST') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const entity = entities.find((e) => e.name === m[1])
        if (!entity) return send(404, { error: 'unknown entity' })
        const body = JSON.parse(raw) as { batch_id: string; records: Record<string, unknown>[] }
        const table = store.get(entity.name) ?? new Map()
        store.set(entity.name, table)
        const rejected: { index: number; error: string }[] = []
        body.records.forEach((r, index) => {
          const missing = entity.fields.filter((f) => f.required && (r[f.name] === null || r[f.name] === undefined || r[f.name] === ''))
          if (missing.length) return rejected.push({ index, error: `${missing.map((f) => f.name).join(', ')} is required` })
          table.set(String(r[entity.key]), r)
        })
        batches.add(body.batch_id)
        send(200, { accepted: body.records.length - rejected.length, rejected })
      })
      return
    }
    send(404, { error: 'not found' })
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const bound = (server.address() as AddressInfo).port
  return { baseUrl: `http://127.0.0.1:${bound}`, token, store, batches, stop: () => new Promise<void>((r) => server.close(() => r())) }
}
