import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A REST API that pipelines write to (API destination steps), for the
 * integration tests, the connector harness and local end-to-end checks
 * (scripts/rest-write-mock.ts). It records exactly what it receives.
 *
 *   POST /employees               { employee: { code, name, email } }  → 201; 422 without an email
 *   PUT  /employees/:code         same body                            → 200 (upsert by code); 404 for code "missing"
 *   POST /employees/batch         { batch_id, records: [{ code, email }] } → 200 { errors: [{ index, message }] } for records without email
 *   POST /echo                    anything (JSON, form, XML)           → 200 { received: <bytes> }
 *
 * Every route needs `Authorization: Bearer <token>` (401 otherwise).
 * `failNext(n, status, retryAfter, skip)` answers n requests (after `skip` normal ones) with `status`.
 */
export interface ReceivedRequest {
  method: string
  path: string
  contentType: string
  idempotencyKey: string | null
  body: string
  at: number
}

export async function startRestWriteMock(token = 'rest-token', port = 0) {
  const received: ReceivedRequest[] = []
  const employees = new Map<string, Record<string, unknown>>()
  let failing: { skip: number; left: number; status: number; retryAfter?: string } | null = null

  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers })
        res.end(JSON.stringify(body))
      }
      const h: IncomingHttpHeaders = req.headers
      const url = new URL(req.url ?? '/', 'http://x')
      received.push({ method: req.method ?? '', path: url.pathname + url.search, contentType: String(h['content-type'] ?? ''), idempotencyKey: (h['idempotency-key'] as string | undefined) ?? null, body: raw, at: Date.now() })
      if (h.authorization !== `Bearer ${token}`) return send(401, { error: 'invalid token' })
      if (failing && failing.skip > 0) failing.skip--
      else if (failing && failing.left > 0) {
        failing.left--
        return send(failing.status, { error: 'temporarily unavailable' }, failing.retryAfter ? { 'retry-after': failing.retryAfter } : {})
      }
      let body: Record<string, unknown> = {}
      if (String(h['content-type'] ?? '').includes('json')) {
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          return send(400, { error: 'body is not JSON' })
        }
      }
      if (url.pathname === '/echo' && req.method === 'POST') return send(200, { received: raw.length })
      if (url.pathname === '/employees/batch' && req.method === 'POST') {
        const records = (body.records as Record<string, unknown>[] | undefined) ?? []
        const errors: { index: number; message: string }[] = []
        records.forEach((r, index) => {
          if (!r.email) return errors.push({ index, message: `email is required for ${String(r.code)}` })
          employees.set(String(r.code), r)
        })
        return send(200, { batch_id: body.batch_id, accepted: records.length - errors.length, errors })
      }
      if (url.pathname === '/employees' && req.method === 'POST') {
        const e = (body.employee ?? {}) as Record<string, unknown>
        if (!e.email) return send(422, { message: `email is required (employee ${String(e.code)}, contact budi@example.com)` })
        employees.set(String(e.code), e)
        return send(201, { id: e.code })
      }
      const one = /^\/employees\/([^/]+)$/.exec(url.pathname)
      if (one && (req.method === 'PUT' || req.method === 'PATCH')) {
        const code = decodeURIComponent(one[1])
        if (code === 'missing') return send(404, { message: 'no such employee' })
        employees.set(code, { ...(employees.get(code) ?? {}), ...((body.employee as object) ?? body), code })
        return send(200, { id: code })
      }
      send(404, { message: 'not found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const bound = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${bound}`,
    token,
    received,
    employees,
    /** After `skip` normal answers, the next `count` requests get `status`. */
    failNext(count: number, status = 503, retryAfter?: string, skip = 0) {
      failing = { skip, left: count, status, retryAfter }
    },
    reset() {
      received.length = 0
      employees.clear()
      failing = null
    },
    stop: () => new Promise<void>((r) => server.close(() => r())),
  }
}
