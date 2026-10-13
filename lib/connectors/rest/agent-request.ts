/**
 * Intranet APIs through a Nexus Agent (DS-12). The agent's config holds the
 * API's base URL and everything secret (sign-in, certificates); the request
 * itself (path, method, parameters, headers, body, data path, paging) is
 * designed in Nexus per data source and sent with each task. The agent
 * combines the two, its own fields always win, and every request must stay
 * under its base URL. Pure and client-safe.
 */

/** Fields only the agent's config may set. A request from Nexus never carries them. */
export const AGENT_OWNED_REST_FIELDS = [
  'baseUrl',
  'authMethod',
  'apiKeyHeader',
  'apiKeyValue',
  'apiKeyLocation',
  'apiKeyPrefix',
  'bearerToken',
  'bearerPrefix',
  'basicUsername',
  'basicPassword',
  'customHeaderName',
  'customHeaderValue',
  'oauthTokenUrl',
  'oauthClientId',
  'oauthClientSecret',
  'oauthScope',
  'oauthUsername',
  'oauthPassword',
  'oauth2GrantType',
  'variablesJson',
  'followRedirects',
  'restrictToBaseUrl',
  'clientCert',
  'clientKey',
  'caCert',
  'signingSecret',
  // Legacy credential keys that feed the sign-in fields.
  'apiKey',
  'authHeader',
  'username',
  'password',
] as const

const OWNED = new Set<string>(AGENT_OWNED_REST_FIELDS)

/** The part of a REST data source's settings Nexus sends to the agent (no agent-owned fields, no blanks). */
export function restRequestDesign(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    if (OWNED.has(k) || v == null || v === '') continue
    out[k] = String(v)
  }
  return out
}

/** The request to send with an agent task, or undefined (non-REST source, or nothing designed in Nexus). */
export function agentRestRequest(sourceType: string, values: Record<string, unknown>): Record<string, string> | undefined {
  if (sourceType !== 'rest') return undefined
  const design = restRequestDesign(values)
  return Object.keys(design).length ? design : undefined
}

/**
 * Agent side: the connection's local settings combined with a request designed
 * in Nexus. Agent-owned fields come only from the local config; redirects are
 * not followed and every URL must stay under the local base URL.
 */
export function mergeAgentRestRequest(local: Record<string, string>, request: Record<string, string> | undefined): Record<string, string> {
  if (!request) return local
  const merged: Record<string, string> = { ...local, ...restRequestDesign(request) }
  for (const k of AGENT_OWNED_REST_FIELDS) {
    if (k in local) merged[k] = local[k]
    else delete merged[k]
  }
  merged.followRedirects = 'false'
  merged.restrictToBaseUrl = (local.baseUrl ?? '').trim()
  return merged
}

/** True when `url` has the base URL's origin and its path is the base path or below it. */
export function isWithinBaseUrl(url: string, baseUrl: string): boolean {
  let u: URL
  let b: URL
  try {
    u = new URL(url)
    b = new URL(baseUrl.trim())
  } catch {
    return false
  }
  if (u.origin !== b.origin || u.username || u.password) return false
  const basePath = b.pathname.replace(/\/+$/, '')
  return basePath === '' || u.pathname === basePath || u.pathname.startsWith(`${basePath}/`)
}

/** What an agent shows Nexus about a connection's address: origin and base path, never credentials or query. */
export function publicEndpoint(credentials: Record<string, string>): string | undefined {
  const raw = credentials.baseUrl || credentials.url || ''
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ldap:' && u.protocol !== 'ldaps:') return undefined
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`.slice(0, 300)
  } catch {
    return undefined
  }
}
