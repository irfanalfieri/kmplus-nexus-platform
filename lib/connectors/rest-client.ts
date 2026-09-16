import type { ConnectorCredentials } from './types'
import {
  activePairs,
  parseKeyValueList,
  pairsToRecord,
  pairsToUrlEncoded,
  type KeyValuePair,
} from './rest/key-value'
import { applyVariables, parseVariablesJson } from './rest/variables'
import { sanitizeRestCredentials } from './rest/parse-connection'

export { parseConnectionPaste, sanitizeRestCredentials } from './rest/parse-connection'

export type RestIntegrationScheme = 'rest_json' | 'graphql' | 'odata'
export type RestAuthMethod =
  | 'none'
  | 'api_key'
  | 'bearer'
  | 'basic'
  | 'custom_header'
  | 'oauth2_client_credentials'
  | 'oauth2_password'

export type RestHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type RestBodyType = 'none' | 'json' | 'raw' | 'urlencoded' | 'graphql'
export type RestPaginationStyle = 'none' | 'offset' | 'page' | 'cursor'

export interface RestConfig {
  integrationScheme: RestIntegrationScheme
  authMethod: RestAuthMethod
  baseUrl: string
  resourcePath: string
  httpMethod: RestHttpMethod
  dataPath: string
  /** @deprecated legacy JSON object — migrated to paramsKv */
  queryParams: string
  graphqlQuery: string
  apiKeyHeader: string
  apiKeyValue: string
  apiKeyLocation: 'header' | 'query'
  apiKeyPrefix: string
  bearerToken: string
  bearerPrefix: string
  basicUsername: string
  basicPassword: string
  customHeaderName: string
  customHeaderValue: string
  oauthTokenUrl: string
  oauthClientId: string
  oauthClientSecret: string
  oauthScope: string
  oauthUsername: string
  oauthPassword: string
  oauth2GrantType: 'client_credentials' | 'password'
  timeoutMs: string
  retries: string
  retryBackoffMs: string
  /** @deprecated legacy JSON object — migrated to headersKv */
  customHeaders: string
  paramsKv: string
  headersKv: string
  bodyType: RestBodyType
  requestBody: string
  bodyKv: string
  rawContentType: string
  variablesJson: string
  followRedirects: string
  validateStatus: string
  paginationStyle: RestPaginationStyle
  paginationLimitParam: string
  paginationOffsetParam: string
  paginationPageParam: string
  paginationCursorParam: string
  paginationCursorPath: string
  paginationPageSize: string
  paginationMaxPages: string
}

export interface RestRequestPreview {
  ok: boolean
  message: string
  request: {
    method: string
    url: string
    headers: Record<string, string>
    bodyPreview?: string
  }
  response: {
    status: number
    statusText: string
    durationMs: number
    contentType: string
    sizeBytes: number
    headers: Record<string, string>
    bodyPreview: string
  }
  meta?: Record<string, string>
}

export const REST_DEFAULTS: RestConfig = {
  integrationScheme: 'rest_json',
  authMethod: 'none',
  baseUrl: '',
  resourcePath: '/',
  httpMethod: 'GET',
  dataPath: '',
  queryParams: '',
  graphqlQuery: '',
  apiKeyHeader: 'X-API-Key',
  apiKeyValue: '',
  apiKeyLocation: 'header',
  apiKeyPrefix: '',
  bearerToken: '',
  bearerPrefix: 'Bearer',
  basicUsername: '',
  basicPassword: '',
  customHeaderName: '',
  customHeaderValue: '',
  oauthTokenUrl: '',
  oauthClientId: '',
  oauthClientSecret: '',
  oauthScope: '',
  oauthUsername: '',
  oauthPassword: '',
  oauth2GrantType: 'client_credentials',
  timeoutMs: '30000',
  retries: '2',
  retryBackoffMs: '500',
  customHeaders: '',
  paramsKv: JSON.stringify([{ key: '', value: '', enabled: true }]),
  headersKv: JSON.stringify([
    { key: 'Accept', value: 'application/json', enabled: true },
    { key: 'User-Agent', value: 'KMPlus-Nexus/1.0', enabled: true },
  ]),
  bodyType: 'none',
  requestBody: '',
  bodyKv: JSON.stringify([{ key: '', value: '', enabled: true }]),
  rawContentType: 'text/plain',
  variablesJson: '',
  followRedirects: 'true',
  validateStatus: '2xx',
  paginationStyle: 'none',
  paginationLimitParam: 'limit',
  paginationOffsetParam: 'offset',
  paginationPageParam: 'page',
  paginationCursorParam: 'cursor',
  paginationCursorPath: 'meta.next_cursor',
  paginationPageSize: '100',
  paginationMaxPages: '10',
}

function parseJsonObject(raw: string, label: string): Record<string, string> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`)
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    )
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} JSON is invalid`)
  }
}

/** Map legacy + new credentials into RestConfig. */
export function parseRestConfig(raw: ConnectorCredentials): RestConfig {
  const sanitized = sanitizeRestCredentials(raw as Record<string, string>)
  const get = (key: keyof RestConfig, fallback = '') => sanitized[key] ?? raw[key] ?? fallback
  const legacyParams = parseJsonObject(get('queryParams'), 'Query parameters')
  const legacyHeaders = parseJsonObject(get('customHeaders'), 'Custom headers')

  return {
    integrationScheme: (get('integrationScheme', 'rest_json') as RestIntegrationScheme) || 'rest_json',
    authMethod: (get('authMethod', raw.apiKey ? 'bearer' : 'none') as RestAuthMethod) || 'none',
    baseUrl: get('baseUrl'),
    resourcePath: get('resourcePath', '/'),
    httpMethod: (get('httpMethod', 'GET') as RestHttpMethod) || 'GET',
    dataPath: get('dataPath'),
    queryParams: get('queryParams'),
    graphqlQuery: get('graphqlQuery'),
    apiKeyHeader: get('apiKeyHeader', get('authHeader', 'X-API-Key')),
    apiKeyValue: get('apiKeyValue', raw.apiKey ?? ''),
    apiKeyLocation: (get('apiKeyLocation', 'header') as 'header' | 'query') || 'header',
    apiKeyPrefix: get('apiKeyPrefix'),
    bearerToken: get('bearerToken', raw.apiKey ?? ''),
    bearerPrefix: get('bearerPrefix', 'Bearer'),
    basicUsername: get('basicUsername', raw.username ?? ''),
    basicPassword: get('basicPassword', raw.password ?? ''),
    customHeaderName: get('customHeaderName', raw.authHeader ?? ''),
    customHeaderValue: get('customHeaderValue', raw.apiKey ?? ''),
    oauthTokenUrl: get('oauthTokenUrl'),
    oauthClientId: get('oauthClientId'),
    oauthClientSecret: get('oauthClientSecret'),
    oauthScope: get('oauthScope'),
    oauthUsername: get('oauthUsername'),
    oauthPassword: get('oauthPassword'),
    oauth2GrantType: (get('oauth2GrantType', 'client_credentials') as 'client_credentials' | 'password') || 'client_credentials',
    timeoutMs: get('timeoutMs', REST_DEFAULTS.timeoutMs),
    retries: get('retries', REST_DEFAULTS.retries),
    retryBackoffMs: get('retryBackoffMs', REST_DEFAULTS.retryBackoffMs),
    customHeaders: get('customHeaders'),
    paramsKv: get('paramsKv') || JSON.stringify(parseKeyValueList('', legacyParams)),
    headersKv: get('headersKv') || JSON.stringify(parseKeyValueList('', legacyHeaders)),
    bodyType: (get('bodyType', get('integrationScheme') === 'graphql' ? 'graphql' : 'none') as RestBodyType) || 'none',
    requestBody: get('requestBody'),
    bodyKv: get('bodyKv', REST_DEFAULTS.bodyKv),
    rawContentType: get('rawContentType', 'text/plain'),
    variablesJson: get('variablesJson'),
    followRedirects: get('followRedirects', 'true'),
    validateStatus: get('validateStatus', '2xx'),
    paginationStyle: (get('paginationStyle', 'none') as RestPaginationStyle) || 'none',
    paginationLimitParam: get('paginationLimitParam', REST_DEFAULTS.paginationLimitParam),
    paginationOffsetParam: get('paginationOffsetParam', REST_DEFAULTS.paginationOffsetParam),
    paginationPageParam: get('paginationPageParam', REST_DEFAULTS.paginationPageParam),
    paginationCursorParam: get('paginationCursorParam', REST_DEFAULTS.paginationCursorParam),
    paginationCursorPath: get('paginationCursorPath', REST_DEFAULTS.paginationCursorPath),
    paginationPageSize: get('paginationPageSize', REST_DEFAULTS.paginationPageSize),
    paginationMaxPages: get('paginationMaxPages', REST_DEFAULTS.paginationMaxPages),
  }
}

export function validateRestCredentials(values: Record<string, string>): boolean {
  const config = parseRestConfig(values)
  if (!config.baseUrl.trim()) return false

  if (config.integrationScheme === 'graphql' || config.bodyType === 'graphql') {
    if (!config.graphqlQuery.trim() && !config.requestBody.trim()) return false
  } else if (!config.resourcePath.trim()) {
    return false
  }

  switch (config.authMethod) {
    case 'api_key':
      if (!config.apiKeyValue.trim()) return false
      break
    case 'bearer':
      if (!config.bearerToken.trim()) return false
      break
    case 'basic':
      if (!config.basicUsername.trim() || !config.basicPassword.trim()) return false
      break
    case 'custom_header':
      if (!config.customHeaderName.trim() || !config.customHeaderValue.trim()) return false
      break
    case 'oauth2_client_credentials':
    case 'oauth2_password':
      if (!config.oauthTokenUrl.trim() || !config.oauthClientId.trim() || !config.oauthClientSecret.trim()) {
        return false
      }
      if (config.authMethod === 'oauth2_password' && (!config.oauthUsername.trim() || !config.oauthPassword.trim())) {
        return false
      }
      break
  }

  return true
}

function getByPath(obj: unknown, path: string): unknown {
  if (!path.trim()) return obj
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}

function withPrefix(prefix: string, value: string) {
  const p = prefix.trim()
  if (!p) return value.trim()
  return `${p} ${value.trim()}`
}

function statusMatches(code: number, rule: string) {
  const trimmed = rule.trim()
  if (!trimmed || trimmed === 'any') return true
  if (trimmed === '2xx') return code >= 200 && code < 300
  if (trimmed.endsWith('xx')) {
    const base = Number.parseInt(trimmed[0], 10) * 100
    return code >= base && code < base + 100
  }
  if (trimmed.includes('-')) {
    const [min, max] = trimmed.split('-').map((n) => Number.parseInt(n, 10))
    return code >= min && code <= max
  }
  return code === Number.parseInt(trimmed, 10)
}

async function fetchOAuth2Token(config: RestConfig, variables: Record<string, string>): Promise<string> {
  const body = new URLSearchParams()
  const grantType = config.authMethod === 'oauth2_password' ? 'password' : 'client_credentials'
  body.set('grant_type', grantType)
  body.set('client_id', applyVariables(config.oauthClientId, variables))
  body.set('client_secret', applyVariables(config.oauthClientSecret, variables))

  if (grantType === 'password') {
    body.set('username', applyVariables(config.oauthUsername, variables))
    body.set('password', applyVariables(config.oauthPassword, variables))
  }
  if (config.oauthScope.trim()) body.set('scope', applyVariables(config.oauthScope, variables))

  const response = await fetch(applyVariables(config.oauthTokenUrl, variables), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OAuth2 token request failed (${response.status})${text ? `: ${text.slice(0, 200)}` : ''}`)
  }

  const payload = (await response.json()) as { access_token?: string }
  if (!payload.access_token) throw new Error('OAuth2 response missing access_token')
  return payload.access_token
}

async function buildAuthHeaders(
  config: RestConfig,
  variables: Record<string, string>
): Promise<Record<string, string>> {
  switch (config.authMethod) {
    case 'none':
      return {}
    case 'api_key': {
      if (config.apiKeyLocation !== 'header') return {}
      const value = applyVariables(config.apiKeyValue, variables)
      return {
        [applyVariables(config.apiKeyHeader, variables) || 'X-API-Key']: withPrefix(
          config.apiKeyPrefix,
          value
        ),
      }
    }
    case 'bearer':
      return {
        Authorization: withPrefix(
          config.bearerPrefix,
          applyVariables(config.bearerToken, variables)
        ),
      }
    case 'basic': {
      const encoded = Buffer.from(
        `${applyVariables(config.basicUsername, variables)}:${applyVariables(config.basicPassword, variables)}`
      ).toString('base64')
      return { Authorization: `Basic ${encoded}` }
    }
    case 'custom_header':
      return {
        [applyVariables(config.customHeaderName, variables)]: applyVariables(
          config.customHeaderValue,
          variables
        ),
      }
    case 'oauth2_client_credentials':
    case 'oauth2_password':
      return { Authorization: `Bearer ${await fetchOAuth2Token(config, variables)}` }
    default:
      return {}
  }
}

function schemeAcceptHeader(scheme: RestIntegrationScheme) {
  if (scheme === 'odata') return 'application/json;odata.metadata=minimal'
  return 'application/json'
}

function buildUrl(
  baseUrl: string,
  resourcePath: string,
  queryPairs: KeyValuePair[],
  authQuery?: Record<string, string>
) {
  const path = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries({ ...pairsToRecord(queryPairs), ...authQuery })) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function resolveBody(config: RestConfig, variables: Record<string, string>) {
  const bodyType =
    config.integrationScheme === 'graphql' || config.bodyType === 'graphql'
      ? 'graphql'
      : config.bodyType

  if (bodyType === 'none') return { body: undefined, contentType: undefined }

  if (bodyType === 'graphql') {
    const query = applyVariables(
      config.graphqlQuery.trim() || config.requestBody.trim(),
      variables
    )
    return {
      body: JSON.stringify({ query }),
      contentType: 'application/json',
    }
  }

  if (bodyType === 'json') {
    const raw = applyVariables(config.requestBody, variables)
    JSON.parse(raw || '{}')
    return { body: raw, contentType: 'application/json' }
  }

  if (bodyType === 'urlencoded') {
    const pairs = parseKeyValueList(config.bodyKv)
    const encoded = pairsToUrlEncoded(
      pairs.map((p) => ({
        ...p,
        key: applyVariables(p.key, variables),
        value: applyVariables(p.value, variables),
      }))
    )
    return { body: encoded, contentType: 'application/x-www-form-urlencoded' }
  }

  if (bodyType === 'raw') {
    return {
      body: applyVariables(config.requestBody, variables),
      contentType: config.rawContentType || 'text/plain',
    }
  }

  return { body: undefined, contentType: undefined }
}

export async function buildRestRequest(config: RestConfig, paginationOverrides?: Record<string, string>) {
  const variables = parseVariablesJson(config.variablesJson)
  const baseUrl = normalizeBaseUrl(applyVariables(config.baseUrl, variables))
  if (!baseUrl) throw new Error('API base URL is required.')

  const resourcePath = applyVariables(config.resourcePath, variables)
  const params = parseKeyValueList(config.paramsKv, parseJsonObject(config.queryParams, 'params'))
  const headerPairs = parseKeyValueList(config.headersKv, parseJsonObject(config.customHeaders, 'headers'))
  const authHeaders = await buildAuthHeaders(config, variables)

  const authQuery: Record<string, string> = {}
  if (config.authMethod === 'api_key' && config.apiKeyLocation === 'query') {
    authQuery[applyVariables(config.apiKeyHeader, variables) || 'api_key'] = withPrefix(
      config.apiKeyPrefix,
      applyVariables(config.apiKeyValue, variables)
    )
  }

  if (paginationOverrides) {
    for (const [key, value] of Object.entries(paginationOverrides)) {
      params.push({ key, value, enabled: true })
    }
  }

  const headers: Record<string, string> = {}
  for (const pair of activePairs(headerPairs)) {
    headers[applyVariables(pair.key, variables)] = applyVariables(pair.value, variables)
  }

  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'accept')) {
    headers.Accept = schemeAcceptHeader(config.integrationScheme)
  }

  Object.assign(headers, authHeaders)

  const { body, contentType } = resolveBody(config, variables)
  if (contentType) headers['Content-Type'] = contentType

  const method =
    config.integrationScheme === 'graphql' || config.bodyType === 'graphql'
      ? 'POST'
      : config.httpMethod || 'GET'

  const url = buildUrl(baseUrl, resourcePath, params, authQuery)

  const init: RequestInit = {
    method,
    headers,
    cache: 'no-store',
    redirect: config.followRedirects === 'false' ? 'manual' : 'follow',
  }

  if (body && method !== 'GET' && method !== 'HEAD') {
    init.body = body
  }

  return { url, init, method, headers, bodyPreview: body?.slice(0, 2000) }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url: string, init: RequestInit, retries: number, timeoutMs: number, backoffMs: number) {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const started = Date.now()
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
      })
      return { response, durationMs: Date.now() - started }
    } catch (error) {
      lastError = error
      if (attempt < retries) await sleep(backoffMs * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed')
}

export function extractRecords(payload: unknown, dataPath: string): Record<string, unknown>[] {
  const root = dataPath.trim() ? getByPath(payload, dataPath.trim()) : payload

  if (Array.isArray(root)) {
    return root.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
  }

  if (root && typeof root === 'object') {
    const obj = root as Record<string, unknown>
    for (const key of ['data', 'items', 'value', 'results', 'records']) {
      const candidate = obj[key]
      if (Array.isArray(candidate)) {
        return candidate.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
      }
    }
    if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      return [obj.data as Record<string, unknown>]
    }
    return [obj]
  }

  return []
}

function inferColumnsFromRows(rows: Record<string, unknown>[]) {
  if (!rows.length) return []
  return Object.entries(rows[0]).map(([name, value]) => ({
    name,
    type: typeof value === 'number' ? 'NUMERIC' : typeof value === 'boolean' ? 'BOOLEAN' : 'TEXT',
    nullable: true,
  }))
}

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()
  if (contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      return { payload: JSON.parse(text) as unknown, text, contentType }
    } catch {
      return { payload: null, text, contentType }
    }
  }
  return { payload: null, text, contentType }
}

export async function executeRestRequestDetailed(config: RestConfig, paginationOverrides?: Record<string, string>) {
  const timeoutMs = Number.parseInt(config.timeoutMs, 10) || 30000
  const retries = Math.max(0, Number.parseInt(config.retries, 10) || 0)
  const backoffMs = Number.parseInt(config.retryBackoffMs, 10) || 500
  const built = await buildRestRequest(config, paginationOverrides)
  const { response, durationMs } = await fetchWithRetry(
    built.url,
    built.init,
    retries,
    timeoutMs,
    backoffMs
  )
  const { payload, text, contentType } = await readResponsePayload(response)

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })

  return {
    ...built,
    response,
    durationMs,
    payload,
    responseText: text,
    contentType,
    responseHeaders,
    sizeBytes: new TextEncoder().encode(text).length,
  }
}

export async function previewRestRequest(config: RestConfig): Promise<RestRequestPreview> {
  try {
    const result = await executeRestRequestDetailed(config)
    const ok = statusMatches(result.response.status, config.validateStatus)

    return {
      ok,
      message: ok
        ? `${result.response.status} ${result.response.statusText} · ${result.durationMs}ms`
        : `Expected ${config.validateStatus}, got ${result.response.status}`,
      request: {
        method: result.method,
        url: result.url,
        headers: result.headers,
        bodyPreview: result.bodyPreview,
      },
      response: {
        status: result.response.status,
        statusText: result.response.statusText,
        durationMs: result.durationMs,
        contentType: result.contentType,
        sizeBytes: result.sizeBytes,
        headers: result.responseHeaders,
        bodyPreview: result.responseText.slice(0, 4000),
      },
      meta: {
        scheme: config.integrationScheme,
        auth: config.authMethod,
      },
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Request failed',
      request: { method: config.httpMethod, url: config.baseUrl, headers: {} },
      response: {
        status: 0,
        statusText: 'Error',
        durationMs: 0,
        contentType: '',
        sizeBytes: 0,
        headers: {},
        bodyPreview: error instanceof Error ? error.message : 'Request failed',
      },
    }
  }
}

export async function testRestConfig(config: RestConfig) {
  const preview = await previewRestRequest(config)
  if (!preview.ok) {
    return { ok: false as const, message: preview.message, preview }
  }
  const schemeLabel =
    config.integrationScheme === 'graphql'
      ? 'GraphQL'
      : config.integrationScheme === 'odata'
        ? 'OData'
        : 'REST'
  return {
    ok: true as const,
    message: `Connected via ${schemeLabel} — ${preview.message}`,
    meta: { endpoint: preview.request.url, scheme: config.integrationScheme, auth: config.authMethod },
    preview,
  }
}

async function fetchAllPages(config: RestConfig): Promise<Record<string, unknown>[]> {
  const style = config.paginationStyle
  if (style === 'none') {
    const result = await executeRestRequestDetailed(config)
    if (!result.response.ok) throw new Error(`API request failed (${result.response.status})`)
    return extractRecords(result.payload, config.dataPath)
  }

  const maxPages = Math.max(1, Number.parseInt(config.paginationMaxPages, 10) || 10)
  const pageSize = Number.parseInt(config.paginationPageSize, 10) || 100
  const all: Record<string, unknown>[] = []
  let cursor: string | undefined
  let offset = 0
  let page = 1

  for (let i = 0; i < maxPages; i++) {
    const overrides: Record<string, string> = {}
    if (style === 'offset') {
      overrides[config.paginationLimitParam] = String(pageSize)
      overrides[config.paginationOffsetParam] = String(offset)
    } else if (style === 'page') {
      overrides[config.paginationLimitParam] = String(pageSize)
      overrides[config.paginationPageParam] = String(page)
    } else if (style === 'cursor' && cursor) {
      overrides[config.paginationCursorParam] = cursor
      overrides[config.paginationLimitParam] = String(pageSize)
    } else if (style === 'cursor') {
      overrides[config.paginationLimitParam] = String(pageSize)
    }

    const result = await executeRestRequestDetailed(config, overrides)
    if (!result.response.ok) throw new Error(`API paginated request failed (${result.response.status})`)

    const batch = extractRecords(result.payload, config.dataPath)
    all.push(...batch)

    if (style === 'offset') {
      if (batch.length < pageSize) break
      offset += pageSize
    } else if (style === 'page') {
      if (batch.length < pageSize) break
      page += 1
    } else if (style === 'cursor') {
      const next = getByPath(result.payload, config.paginationCursorPath)
      if (typeof next !== 'string' || !next.trim() || batch.length < pageSize) break
      cursor = next
    } else {
      break
    }
  }

  return all
}

export async function scanRestConfig(config: RestConfig) {
  const records = await fetchAllPages(config)
  const resourceName =
    config.integrationScheme === 'graphql'
      ? 'graphql_result'
      : config.resourcePath.split('/').filter(Boolean).pop() || 'resource'

  return {
    tables: [
      {
        schema: config.integrationScheme === 'odata' ? 'odata' : 'api',
        name: resourceName,
        columns: inferColumnsFromRows(records),
        rowCount: records.length,
      },
    ],
    scannedAt: new Date().toISOString(),
    method: `${config.integrationScheme}-inference`,
  }
}

export async function sampleRestConfig(config: RestConfig, tableName: string, limit = 25) {
  void tableName
  const records = (await fetchAllPages(config)).slice(0, limit)
  const resourceName =
    config.integrationScheme === 'graphql'
      ? 'graphql_result'
      : config.resourcePath.split('/').filter(Boolean).pop() || 'resource'

  return {
    tableName: resourceName,
    columns: records.length ? Object.keys(records[0]) : [],
    rows: records,
    totalRows: records.length,
  }
}

export async function executeRestRequest(config: RestConfig) {
  const result = await executeRestRequestDetailed(config)
  return { url: result.url, response: result.response }
}
