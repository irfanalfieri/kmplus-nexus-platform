/**
 * A local receiver for Nexus outbound webhooks that checks each signature
 * (test-data/README.md, scenario 12).
 *
 *   node scripts/webhook-receiver.mjs <signing-secret> [port]
 *
 * Register http://127.0.0.1:4020/hooks in Settings → Webhooks on a local dev
 * server (NEXUS_ALLOW_PRIVATE_URLS=true), copy the signing secret it shows once,
 * and pass it here. Production only delivers to public https URLs.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const secret = process.argv[2]
const port = Number(process.argv[3] ?? 4020)
if (!secret) {
  console.error('Usage: node scripts/webhook-receiver.mjs <signing-secret> [port]')
  process.exit(1)
}

/** Nexus-Signature is `t=<unix>,v1=<hex>`: HMAC-SHA256 over "<t>.<body>". */
function verify(header, body) {
  const parts = Object.fromEntries(String(header ?? '').split(',').map((p) => p.split('=')))
  if (!parts.t || !parts.v1) return 'missing signature'
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return 'timestamp older than 5 minutes'
  const expected = createHmac('sha256', secret).update(`${parts.t}.${body}`).digest()
  const given = Buffer.from(parts.v1, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected) ? null : 'signature mismatch'
}

createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const problem = verify(req.headers['nexus-signature'], body)
    const event = req.headers['nexus-event']
    let summary = ''
    try {
      const data = JSON.parse(body).data ?? {}
      const run = data.run
      summary = run
        ? `pipeline ${run.pipeline_id} · ${run.status} · read ${run.rows_read}, wrote ${run.rows_written}, quarantined ${run.rows_quarantined}${run.error ? ` · ${run.error}` : ''}`
        : data.dataset
          ? `dataset ${data.dataset} · ${data.rows_written} rows written · ${data.row_count ?? '?'} total`
          : (data.message ?? '')
    } catch {
      summary = '(body is not JSON)'
    }
    console.log(`${new Date().toISOString()}  ${event}  ${problem ? `REJECTED (${problem})` : 'signature OK'}  ${summary}`)
    res.writeHead(problem ? 401 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: !problem }))
  })
}).listen(port, '127.0.0.1', () => console.log(`Webhook receiver on http://127.0.0.1:${port}/hooks`))
