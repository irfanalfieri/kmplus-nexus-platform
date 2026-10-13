import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A stand-in for an API inside a company network (DS-12), on 127.0.0.1:
 * GET /hr/employees answers { items: [...] } only with the expected bearer
 * token. Records every request (path and Authorization header) for assertions.
 */
export async function startIntranetApi(token: string) {
  const seen: { path: string; authorization: string }[] = []
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const authorization = req.headers.authorization ?? ''
    seen.push({ path, authorization })
    res.setHeader('content-type', 'application/json')
    if (authorization !== `Bearer ${token}`) {
      res.statusCode = 401
      return res.end(JSON.stringify({ error: 'unauthorized' }))
    }
    if (path === '/hr/employees') {
      return res.end(JSON.stringify({ items: [{ employee_code: 'E1', full_name: 'Ana' }, { employee_code: 'E2', full_name: 'Budi' }] }))
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    seen,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
