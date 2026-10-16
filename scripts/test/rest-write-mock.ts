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
 *   GET  /payroll                 → 200 { items: payroll }  (a listing a pipeline reads as a source; set `payroll`)
 *   GET  /details?codes=E1,E2     → 200 { items: [{ code, grade, allowance }] } for the codes in `details` (Enrich, batch)
 *   GET  /employees/:code/details → 200 { data: { grade, allowance } }, 404 when unknown (Enrich, per row)
 *   POST /users                   { email, name } → 201 { user: { id } }; 422 without a name (Changes data; `users`, `created` per email)
 *   PUT  /users/:id               { email, name } → 200 { user: { id } }
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
  const payroll: Record<string, unknown>[] = []
  const details = new Map<string, Record<string, unknown>>()
  const users = new Map<string, { id: string; email: string; name: string }>()
  /** Creates per email: more than 1 is a duplicate. */
  const created = new Map<string, number>()
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
      if (url.pathname === '/payroll' && req.method === 'GET') return send(200, { items: payroll })
      if (url.pathname === '/details' && req.method === 'GET') {
        const codes = (url.searchParams.get('codes') ?? '').split(',').filter(Boolean)
        return send(200, { items: codes.flatMap((c) => (details.has(c) ? [{ code: c, ...details.get(c) }] : [])) })
      }
      const detail = /^\/employees\/([^/]+)\/details$/.exec(url.pathname)
      if (detail && req.method === 'GET') {
        const d = details.get(decodeURIComponent(detail[1]))
        return d ? send(200, { data: d }) : send(404, { message: 'no such employee' })
      }
      if (url.pathname === '/users' && req.method === 'POST') {
        const b = body as { email?: string; name?: string }
        if (!b.name) return send(422, { message: `name is required for ${String(b.email)}` })
        const id = `U${String(users.size + 1).padStart(4, '0')}`
        users.set(id, { id, email: String(b.email), name: b.name })
        created.set(String(b.email), (created.get(String(b.email)) ?? 0) + 1)
        return send(201, { user: { id } })
      }
      const user = /^\/users\/([^/]+)$/.exec(url.pathname)
      if (user && req.method === 'PUT') {
        const u = users.get(decodeURIComponent(user[1]))
        if (!u) return send(404, { message: 'no such user' })
        Object.assign(u, body)
        return send(200, { user: { id: u.id } })
      }
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
    payroll,
    details,
    users,
    created,
    /** After `skip` normal answers, the next `count` requests get `status`. */
    failNext(count: number, status = 503, retryAfter?: string, skip = 0) {
      failing = { skip, left: count, status, retryAfter }
    },
    reset() {
      received.length = 0
      employees.clear()
      details.clear()
      users.clear()
      created.clear()
      failing = null
    },
    stop: () => new Promise<void>((r) => server.close(() => r())),
  }
}
