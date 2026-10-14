import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { signAwsRequest } from '@/lib/net/aws-sigv4'

/**
 * One local HTTP server standing in for the infrastructure and secrets-manager
 * services (connector harness and integration tests), on 127.0.0.1. Each
 * service lives under its own path and checks credentials the way the real one
 * does: Signature V4 is recomputed, Google JWTs are verified with the test key,
 * Vault AppRole and Entra ID client credentials are checked.
 */

export const MOCK = {
  promToken: 'prom-token',
  esApiKey: 'es-key',
  ddApi: 'dd-api',
  ddApp: 'dd-app',
  nrKey: 'NRAK-TEST',
  grafanaToken: 'glsa_test',
  aws: { accessKeyId: 'AKIDMOCK', secretAccessKey: 'mock-secret-key' },
  azureSas: 'sv=2021-08-06&sp=rl&sig=mock-sig',
  vaultToken: 'vault-root',
  vaultRole: { roleId: 'role-1', secretId: 'secret-1' },
  azure: { tenantId: 'tenant-1', clientId: 'client-1', clientSecret: 'client-secret' },
  doppler: 'dp.st.mock',
  bucket: 'hr-exports',
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const read = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let data = ''
  req.on('data', (c) => (data += c))
  req.on('end', () => resolve(data))
})

const FILES: Record<string, string> = {
  'daily/employees_2026-10-01.csv': 'employee_code,full_name,salary\nE1,Ana,1000\nE2,Budi,2000\n',
  'daily/employees_2026-10-02.csv': 'employee_code,full_name,salary\nE3,Citra,3000\n',
  'reference/orgs.ndjson': '{"org_code":"O1","name":"Finance"}\n{"org_code":"O2","name":"Sales"}\n',
  'readme.txt': 'not a table',
}

const LOGS = Array.from({ length: 5 }, (_, i) => ({ _id: `doc${i + 1}`, _source: { '@timestamp': `2026-10-14T0${i}:00:00Z`, service: { name: 'hr-api' }, message: `request ${i + 1}`, http: { status: i === 3 ? 500 : 200 } } }))

export async function startInfraMock() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const vaultSecrets: Record<string, Record<string, string>> = { 'hr/db': { url: '', password: 'p@ss' }, 'hr/api': { token: 'abc' } }
  const seen: { service: string; path: string }[] = []
  let base = ''

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const [, service, ...rest] = url.pathname.split('/')
    const path = `/${rest.join('/')}`
    seen.push({ service, path })
    const body = await read(req)
    const auth = req.headers.authorization ?? ''

    if (service === 'prom') {
      if (auth !== `Bearer ${MOCK.promToken}`) return json(res, 401, { status: 'error', error: 'unauthorized' })
      const ok = (data: unknown) => json(res, 200, { status: 'success', data })
      if (path === '/api/v1/query') {
        const q = url.searchParams.get('query')
        if (q === '1') return ok({ resultType: 'scalar', result: [1791900000, '1'] })
        return ok({ resultType: 'vector', result: [{ metric: { __name__: 'up', job: 'hr-api', instance: 'hr-api:8080' }, value: [1791900000, '1'] }, { metric: { __name__: 'up', job: 'payroll', instance: 'payroll:8080' }, value: [1791900000, '0'] }] })
      }
      if (path === '/api/v1/status/buildinfo') return ok({ version: '2.55.0' })
      if (path === '/api/v1/targets') return ok({ activeTargets: [{ scrapePool: 'hr-api', scrapeUrl: 'http://hr-api:8080/metrics', health: 'up', labels: { job: 'hr-api', instance: 'hr-api:8080' }, lastScrape: '2026-10-14T03:00:00Z', lastError: '' }] })
      if (path === '/api/v1/alerts') return ok({ alerts: [{ labels: { alertname: 'PayrollDown', severity: 'critical' }, state: 'firing', activeAt: '2026-10-14T02:00:00Z', value: '0' }] })
      if (path === '/api/v1/rules') return ok({ groups: [{ name: 'hr', file: 'hr.yml', rules: [{ name: 'PayrollDown', type: 'alerting', health: 'ok', query: 'up{job="payroll"} == 0' }] }] })
      if (path === '/api/v1/metadata') return ok({ up: [{ type: 'gauge', help: 'Target is up', unit: '' }] })
      return json(res, 404, { status: 'error', error: 'not found' })
    }

    if (service === 'es') {
      if (auth !== `ApiKey ${MOCK.esApiKey}`) return json(res, 401, { error: { type: 'security_exception' }, status: 401 })
      if (path === '/') return json(res, 200, { cluster_name: 'hr-logs', version: { number: '8.15.0' } })
      if (path.startsWith('/_cat/indices')) return json(res, 200, [{ index: 'logs-hr', 'docs.count': '5' }, { index: '.internal', 'docs.count': '1' }])
      if (path.startsWith('/_data_stream')) return json(res, 200, { data_streams: [] })
      if (path === '/logs-hr/_mapping') return json(res, 200, { 'logs-hr': { mappings: { properties: { '@timestamp': { type: 'date' }, message: { type: 'text' }, service: { properties: { name: { type: 'keyword' } } }, http: { properties: { status: { type: 'long' } } } } } } })
      if (path === '/logs-hr/_search') {
        const q = body ? (JSON.parse(body) as { size?: number; query?: { range?: Record<string, { gt: string }> } }) : {}
        const range = q.query?.range?.['@timestamp']?.gt
        const hits = LOGS.filter((d) => !range || d._source['@timestamp'] > range).slice(0, q.size ?? 10)
        return json(res, 200, { _scroll_id: url.searchParams.get('scroll') ? 'scroll-1' : undefined, hits: { total: { value: LOGS.length }, hits } })
      }
      if (path === '/_search/scroll') return req.method === 'DELETE' ? json(res, 200, { succeeded: true }) : json(res, 200, { _scroll_id: 'scroll-1', hits: { hits: [] } })
      return json(res, 404, { error: { type: 'index_not_found_exception' } })
    }

    if (service === 'dd') {
      if (req.headers['dd-api-key'] !== MOCK.ddApi || req.headers['dd-application-key'] !== MOCK.ddApp) return json(res, 403, { errors: ['Forbidden'] })
      if (path === '/api/v1/validate') return json(res, 200, { valid: true })
      if (path === '/api/v1/monitor') return json(res, 200, [{ id: 1, name: 'HR API latency', type: 'metric alert', overall_state: 'OK', query: 'avg(last_5m):avg:trace.http.request.duration{service:hr-api} > 1', tags: ['team:hr'] }])
      if (path === '/api/v1/slo') return json(res, 200, { data: [{ id: 'slo1', name: 'HR API availability', type: 'metric', target_threshold: 99.9 }] })
      if (path === '/api/v1/hosts') return json(res, 200, { host_list: [{ host_name: 'hr-api-1', up: true, apps: ['nginx'], last_reported_time: 1791900000 }] })
      if (path === '/api/v1/events') return json(res, 200, { events: [{ id: 9, title: 'Deploy hr-api', date_happened: 1791900000, tags: ['service:hr-api'] }] })
      if (path === '/api/v2/services') return json(res, 200, { data: { attributes: { services: ['hr-api', 'payroll'] } } })
      if (path === '/api/v1/query') return json(res, 200, { series: [{ metric: 'trace.http.request.duration', scope: 'service:hr-api', pointlist: [[1791900000000, 0.21], [1791900060000, 0.25]] }] })
      return json(res, 404, { errors: ['Not found'] })
    }

    if (service === 'nr' && path === '/graphql') {
      if (req.headers['api-key'] !== MOCK.nrKey) return json(res, 200, { errors: [{ message: 'Invalid API key' }] })
      const q = JSON.parse(body) as { query: string }
      if (q.query.includes('user {')) return json(res, 200, { data: { actor: { user: { name: 'QA Robot', email: 'qa@kmplus.test' } } } })
      if (q.query.includes('entitySearch')) return json(res, 200, { data: { actor: { entitySearch: { results: { entities: [{ guid: 'g1', name: 'hr-api', alertSeverity: 'NOT_ALERTING', reporting: true, language: 'java', apmSummary: { apdexScore: 0.98, errorRate: 0.01, responseTimeAverage: 0.2, throughput: 120 } }] } } } } })
      if (q.query.includes('aiIssues')) return json(res, 200, { data: { actor: { account: { aiIssues: { issues: { issues: [{ issueId: 'i1', title: ['High error rate'], priority: 'HIGH', state: 'ACTIVATED' }] } } } } } })
      if (q.query.includes('nrql')) return json(res, 200, { data: { actor: { account: { nrql: { results: [{ facet: 'hr-api', 'average.duration': 0.2 }] } } } } })
      return json(res, 200, { errors: [{ message: 'unknown query' }] })
    }

    if (service === 'gf') {
      if (path === '/api/health') return json(res, 200, { database: 'ok', version: '11.2.0' })
      if (auth !== `Bearer ${MOCK.grafanaToken}`) return json(res, 401, { message: 'Unauthorized' })
      if (path === '/api/search') return json(res, 200, [{ uid: 'd1', title: 'HR API overview', folderTitle: 'HR', tags: ['hr'], url: '/d/d1' }])
      if (path === '/api/folders') return json(res, 200, [{ uid: 'f1', title: 'HR' }])
      if (path === '/api/v1/provisioning/alert-rules') return json(res, 200, [{ uid: 'r1', title: 'Payroll down', folderUID: 'f1', ruleGroup: 'hr', labels: { severity: 'critical' } }])
      if (path === '/api/alertmanager/grafana/api/v2/alerts') return json(res, 200, [{ labels: { alertname: 'Payroll down' }, status: { state: 'active' }, startsAt: '2026-10-14T02:00:00Z' }])
      if (path === '/api/annotations') return json(res, 200, [{ id: 1, time: 1791900000000, text: 'Deployed hr-api 2.3', tags: ['deploy'] }])
      if (path === '/api/datasources') return json(res, 200, [{ id: 1, uid: 'p1', name: 'Prometheus', type: 'prometheus', url: 'http://prometheus:9090', access: 'proxy', isDefault: true, readOnly: false, secureJsonFields: { basicAuthPassword: true } }])
      return json(res, 404, { message: 'Not found' })
    }

    if (service === 's3' || service === 'awssm') {
      // Recompute Signature V4 from the request and compare.
      const given = auth
      const headers: Record<string, string> = {}
      const signed = /SignedHeaders=([^,]+)/.exec(given)?.[1]?.split(';') ?? []
      for (const h of signed) if (h !== 'host' && req.headers[h] !== undefined) headers[h] = String(req.headers[h])
      const date = String(req.headers['x-amz-date'] ?? '')
      const now = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`)
      const expected = signAwsRequest({ method: req.method ?? 'GET', url: `${base}${req.url}`, region: 'us-east-1', service: service === 's3' ? 's3' : 'secretsmanager', credentials: MOCK.aws, headers, body, now }).Authorization
      if (!given || given !== expected) return res.writeHead(403, { 'content-type': 'application/xml' }).end('<Error><Code>SignatureDoesNotMatch</Code><Message>mock</Message></Error>')
      if (service === 'awssm') {
        const target = String(req.headers['x-amz-target'])
        const q = JSON.parse(body) as { SecretId?: string }
        if (target.endsWith('ListSecrets')) return json(res, 200, { SecretList: [{ Name: 'hr/db' }, { Name: 'hr/api' }] })
        if (q.SecretId === 'hr/db') return json(res, 200, { SecretString: JSON.stringify(vaultSecrets['hr/db']) })
        return json(res, 400, { __type: 'com.amazonaws.secretsmanager#ResourceNotFoundException', message: 'not found' })
      }
      const [bucket, ...keyParts] = rest
      if (bucket !== MOCK.bucket) return res.writeHead(404).end('<Error><Code>NoSuchBucket</Code></Error>')
      if (!keyParts.length || (keyParts.length === 1 && keyParts[0] === '')) {
        const prefix = url.searchParams.get('prefix') ?? ''
        const keys = Object.keys(FILES).filter((k) => k.startsWith(prefix))
        return res.writeHead(200, { 'content-type': 'application/xml' }).end(`<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><Size>${FILES[k].length}</Size><LastModified>2026-10-14T00:00:00Z</LastModified></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`)
      }
      const key = keyParts.map(decodeURIComponent).join('/')
      if (!(key in FILES)) return res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>')
      return res.writeHead(200).end(FILES[key])
    }

    if (service === 'az') {
      if (url.searchParams.get('sig') !== 'mock-sig') return res.writeHead(403).end('<Error><Code>AuthenticationFailed</Code></Error>')
      const [container, ...keyParts] = rest
      if (container !== MOCK.bucket) return res.writeHead(404).end('<Error><Code>ContainerNotFound</Code></Error>')
      if (url.searchParams.get('comp') === 'list') {
        const prefix = url.searchParams.get('prefix') ?? ''
        const keys = Object.keys(FILES).filter((k) => k.startsWith(prefix))
        return res.writeHead(200).end(`<EnumerationResults><Blobs>${keys.map((k) => `<Blob><Name>${k}</Name><Properties><Content-Length>${FILES[k].length}</Content-Length><Last-Modified>Tue, 14 Oct 2026 00:00:00 GMT</Last-Modified></Properties></Blob>`).join('')}</Blobs><NextMarker /></EnumerationResults>`)
      }
      const key = keyParts.map(decodeURIComponent).join('/')
      return key in FILES ? res.writeHead(200).end(FILES[key]) : res.writeHead(404).end('<Error><Code>BlobNotFound</Code></Error>')
    }

    if (service === 'google' && path === '/token') {
      // Verify the service account's JWT with the test key.
      const assertion = new URLSearchParams(body).get('assertion') ?? ''
      const [h, p, sig] = assertion.split('.')
      const valid = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig ?? '', 'base64url'))
      return valid ? json(res, 200, { access_token: 'google-token', expires_in: 3600 }) : json(res, 400, { error: 'invalid_grant', error_description: 'bad signature' })
    }

    if (service === 'gcs') {
      if (auth !== 'Bearer google-token') return json(res, 401, { error: { message: 'Anonymous caller does not have storage.objects.list access' } })
      const m = /^\/storage\/v1\/b\/([^/]+)\/o(?:\/(.+))?$/.exec(path)
      if (!m || m[1] !== MOCK.bucket) return json(res, 404, { error: { message: 'Not found' } })
      if (!m[2]) {
        const prefix = url.searchParams.get('prefix') ?? ''
        return json(res, 200, { items: Object.keys(FILES).filter((k) => k.startsWith(prefix)).map((k) => ({ name: k, size: String(FILES[k].length), updated: '2026-10-14T00:00:00Z' })) })
      }
      const key = decodeURIComponent(m[2])
      return key in FILES ? res.writeHead(200).end(FILES[key]) : json(res, 404, { error: { message: 'No such object' } })
    }

    if (service === 'vault') {
      if (path === '/v1/auth/approle/login') {
        const q = JSON.parse(body) as { role_id?: string; secret_id?: string }
        return q.role_id === MOCK.vaultRole.roleId && q.secret_id === MOCK.vaultRole.secretId ? json(res, 200, { auth: { client_token: MOCK.vaultToken, lease_duration: 600 } }) : json(res, 400, { errors: ['invalid role or secret ID'] })
      }
      if (req.headers['x-vault-token'] !== MOCK.vaultToken) return json(res, 403, { errors: ['permission denied'] })
      if (path === '/v1/auth/token/lookup-self') return json(res, 200, { data: { display_name: 'token-nexus', policies: ['nexus-read'] } })
      if (path.startsWith('/v1/secret/metadata/') && url.searchParams.get('list') === 'true') {
        const dir = path.slice('/v1/secret/metadata/'.length)
        const children = new Set(Object.keys(vaultSecrets).filter((k) => k.startsWith(dir)).map((k) => k.slice(dir.length).split('/')[0] + (k.slice(dir.length).includes('/') ? '/' : '')))
        return children.size ? json(res, 200, { data: { keys: [...children] } }) : json(res, 404, { errors: [] })
      }
      const sec = path.startsWith('/v1/secret/data/') ? vaultSecrets[path.slice('/v1/secret/data/'.length)] : undefined
      return sec ? json(res, 200, { data: { data: sec, metadata: { version: 1 } } }) : json(res, 404, { errors: [] })
    }

    if (service === 'azure-login') {
      const q = new URLSearchParams(body)
      return q.get('client_id') === MOCK.azure.clientId && q.get('client_secret') === MOCK.azure.clientSecret && path.startsWith(`/${MOCK.azure.tenantId}/`)
        ? json(res, 200, { access_token: 'azure-token', expires_in: 3600 })
        : json(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' })
    }

    if (service === 'akv') {
      if (auth !== 'Bearer azure-token') return json(res, 401, { error: { code: 'Unauthorized' } })
      if (path === '/secrets') return json(res, 200, { value: [{ id: `${base}/akv/secrets/hr-db-password` }], nextLink: null })
      if (path === '/secrets/hr-db-password') return json(res, 200, { value: 'p@ss', id: `${base}/akv/secrets/hr-db-password/v1` })
      return json(res, 404, { error: { code: 'SecretNotFound' } })
    }

    if (service === 'gsm') {
      if (auth !== 'Bearer google-token') return json(res, 401, { error: { message: 'unauthenticated' } })
      if (path === '/v1/projects/qa-project/secrets') return json(res, 200, { secrets: [{ name: 'projects/qa-project/secrets/hr-db' }] })
      if (path === '/v1/projects/qa-project/secrets/hr-db/versions/latest:access') return json(res, 200, { payload: { data: Buffer.from(JSON.stringify(vaultSecrets['hr/db'])).toString('base64') } })
      return json(res, 404, { error: { message: 'NOT_FOUND' } })
    }

    if (service === 'doppler' && path === '/v3/configs/config/secrets/download') {
      if (auth !== `Bearer ${MOCK.doppler}`) return json(res, 401, { messages: ['Invalid Auth token'] })
      return json(res, 200, { DOPPLER_PROJECT: 'hr', DOPPLER_CONFIG: 'prd', HR_DB_PASSWORD: 'p@ss', HR_DB_URL: vaultSecrets['hr/db'].url })
    }

    json(res, 404, { error: 'unknown mock route' })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const serviceAccount = JSON.stringify({ type: 'service_account', project_id: 'qa-project', client_email: 'nexus@qa-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), token_uri: `${base}/google/token` })

  return {
    base,
    seen,
    vaultSecrets,
    serviceAccount,
    /** Credentials for each connector, pointing at this mock. */
    credentials: {
      prometheus: { url: `${base}/prom`, bearerToken: MOCK.promToken, queries: 'service_up = up' },
      elasticsearch: { url: `${base}/es`, apiKey: MOCK.esApiKey, indexPattern: 'logs-*' },
      datadog: { apiUrl: `${base}/dd`, apiKey: MOCK.ddApi, appKey: MOCK.ddApp, queries: 'hr_api_latency = avg:trace.http.request.duration{service:hr-api}' },
      newrelic: { endpoint: `${base}/nr/graphql`, apiKey: MOCK.nrKey, accountId: '123', queries: 'slow = SELECT average(duration) FROM Transaction FACET appName' },
      grafana: { url: `${base}/gf`, apiToken: MOCK.grafanaToken },
      s3: { endpoint: `${base}/s3`, bucket: MOCK.bucket, region: 'us-east-1', accessKeyId: MOCK.aws.accessKeyId, secretAccessKey: MOCK.aws.secretAccessKey },
      azureblob: { endpoint: `${base}/az`, account: 'qa', container: MOCK.bucket, sasToken: MOCK.azureSas },
      gcs: { apiEndpoint: `${base}/gcs`, bucket: MOCK.bucket, serviceAccountJson: serviceAccount },
      vault: { url: `${base}/vault`, roleId: MOCK.vaultRole.roleId, secretId: MOCK.vaultRole.secretId },
      awssecrets: { endpoint: `${base}/awssm`, region: 'us-east-1', accessKeyId: MOCK.aws.accessKeyId, secretAccessKey: MOCK.aws.secretAccessKey },
      azurekeyvault: { vaultUrl: `${base}/akv`, authorityHost: `${base}/azure-login`, ...MOCK.azure },
      gcpsecrets: { apiEndpoint: `${base}/gsm`, serviceAccountJson: serviceAccount },
      doppler: { apiUrl: `${base}/doppler`, serviceToken: MOCK.doppler },
    } as Record<string, Record<string, string>>,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  }
}
