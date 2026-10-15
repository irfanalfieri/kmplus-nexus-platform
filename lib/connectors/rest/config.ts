import type { ConnectorCredentials } from '../types'
import { parseKeyValueList } from './key-value'
import { sanitizeRestCredentials } from './parse-connection'

/**
 * REST connector configuration: types, defaults and parsing. Client-safe (the
 * REST form imports it); requests are made by lib/connectors/rest-client.ts.
 */

export { parseConnectionPaste, sanitizeRestCredentials } from './parse-connection'

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
  /**
   * Set by the Nexus Agent for intranet APIs: every request must stay under
   * this base URL (same origin, same path prefix). Never set from Nexus.
   */
  restrictToBaseUrl: string
  /** Manual publishing (no agent): PEM client certificate Nexus presents (mTLS). */
  clientCert: string
  /** Its PEM private key (secret). */
  clientKey: string
  /** PEM CA certificate(s) of the company PKI that signed the API's server certificate. */
  caCert: string
  /** Shared secret for X-Nexus-Signature on every request (secret). */
  signingSecret: string
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
  restrictToBaseUrl: '',
  clientCert: '',
  clientKey: '',
  caCert: '',
  signingSecret: '',
}

const SECRET_MASK = '••••'
const ALWAYS_SECRET_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'x-nexus-signature']

/**
 * The request part of a preview, safe to show in the browser: sign-in header
 * values and an API key in the query string are masked ("Bearer ••••"). The
 * preview runs with stored or secrets-manager values the browser must never see.
 */
export function redactRestRequest(request: RestRequestPreview['request'], config: Pick<RestConfig, 'authMethod' | 'apiKeyHeader' | 'apiKeyLocation' | 'customHeaderName'>): RestRequestPreview['request'] {
  const secretHeaders = new Set(ALWAYS_SECRET_HEADERS)
  if (config.authMethod === 'api_key' && config.apiKeyLocation === 'header') secretHeaders.add((config.apiKeyHeader || 'X-API-Key').toLowerCase())
  if (config.authMethod === 'custom_header' && config.customHeaderName.trim()) secretHeaders.add(config.customHeaderName.trim().toLowerCase())
  const headers = Object.fromEntries(
    Object.entries(request.headers ?? {}).map(([name, value]) => {
      if (!secretHeaders.has(name.toLowerCase())) return [name, value]
      const scheme = /^(Bearer|Basic|Token|Bot)\s+/i.exec(value)?.[0] ?? ''
      return [name, `${scheme}${SECRET_MASK}`]
    })
  )
  let url = request.url
  if (config.authMethod === 'api_key' && config.apiKeyLocation === 'query' && url) {
    try {
      const parsed = new URL(url)
      const param = config.apiKeyHeader || 'api_key'
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, SECRET_MASK)
        url = parsed.toString().replaceAll(encodeURIComponent(SECRET_MASK), SECRET_MASK)
      }
    } catch {
      /* not a URL: leave it */
    }
  }
  return { ...request, headers, url }
}

export function parseJsonObject(raw: string, label: string): Record<string, string> {
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
    // authHeader: legacy credential key from older saved REST sources.
    apiKeyHeader: get('apiKeyHeader', raw.authHeader?.trim() || 'X-API-Key'),
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
    restrictToBaseUrl: get('restrictToBaseUrl'),
    clientCert: get('clientCert'),
    clientKey: get('clientKey'),
    caCert: get('caCert'),
    signingSecret: get('signingSecret'),
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
