import { AsyncLocalStorage } from 'node:async_hooks'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { createHash } from 'node:crypto'
import { Agent, fetch as undiciFetch } from 'undici'
import { signRequest } from './request-signing'

/**
 * Outbound requests to user-supplied URLs must not reach the platform's own
 * network (SSRF). Server-only.
 *
 * - Webhooks, OIDC discovery and SAML metadata: https on a public host (safeFetch).
 * - Connectors that call HTTP APIs (REST, SAP, Talenta, KMPlus products):
 *   http or https on a public host (connectorFetch). An API inside a company
 *   network (intranet) is reached through a Nexus Agent running in that network:
 *   the agent runs its tasks with private-network access (withPrivateNetworkAccess).
 * - Self-hosted Nexus inside a company network sets NEXUS_PRIVATE_NETWORK_ACCESS=true
 *   so the server itself can call intranet APIs.
 */

export class UnsafeUrlError extends Error {
  /** A refused address doesn't become allowed on a retry. */
  readonly retryable = false
}

function privateV4(ip: string) {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
}

function privateV6(ip: string) {
  const v = ip.toLowerCase()
  if (v === '::' || v === '::1') return true
  if (v.startsWith('::ffff:')) return privateV4(v.slice(7))
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v)
}

/**
 * Local development and tests may reach services on this machine (mock KMPlus
 * products, webhook receivers) with NEXUS_ALLOW_PRIVATE_URLS=true. Never in production.
 */
const allowPrivateForDev = () => process.env.NEXUS_ALLOW_PRIVATE_URLS === 'true' && process.env.NODE_ENV !== 'production'

/** Self-hosted inside a company network: the server may call private addresses (set on purpose, any environment). */
const selfHostedPrivateAccess = () => process.env.NEXUS_PRIVATE_NETWORK_ACCESS === 'true'

const privateNetworkContext = new AsyncLocalStorage<true>()

/** Runs `fn` with private-network access for connector requests (the Nexus Agent runs every task this way). */
export function withPrivateNetworkAccess<T>(fn: () => Promise<T>): Promise<T> {
  return privateNetworkContext.run(true, fn)
}

/** Whether connector requests may reach private / intranet addresses here. */
export function privateNetworkAllowed() {
  return privateNetworkContext.getStore() === true || selfHostedPrivateAccess() || allowPrivateForDev()
}

export const isPrivateAddress = (ip: string) => (isIP(ip) === 4 ? privateV4(ip) : isIP(ip) === 6 ? privateV6(ip) : true)

/** Host names that only exist inside a network (no public DNS). */
export const isInternalHostName = (host: string) => /^(localhost|[^.]+|.*\.(local|internal|intranet|corp|lan|home|localdomain)|metadata\.google\.internal)$/i.test(host)

async function privateHostReason(host: string): Promise<string | null> {
  if (!isIP(host) && isInternalHostName(host)) return 'internal'
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
  if (!addresses.length) return 'unresolved'
  return addresses.some((a) => isPrivateAddress(a.address)) ? 'private' : null
}

function parseUrl(raw: string) {
  try {
    return new URL(raw)
  } catch {
    throw new UnsafeUrlError('Enter a full URL starting with https://')
  }
}

/** Throws unless the URL is https on a public host (every resolved address public). */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  const url = parseUrl(raw)
  const open = allowPrivateForDev() || selfHostedPrivateAccess()
  if (url.protocol !== 'https:' && !(allowPrivateForDev() && url.protocol === 'http:')) throw new UnsafeUrlError('Only https:// URLs are allowed.')
  if (url.username || url.password) throw new UnsafeUrlError("URLs can't contain a username or password.")
  if (open) return url
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const reason = await privateHostReason(host)
  if (reason === 'internal') throw new UnsafeUrlError('Internal hosts are not allowed.')
  if (reason === 'unresolved') throw new UnsafeUrlError(`${host} could not be resolved.`)
  if (reason === 'private') throw new UnsafeUrlError(`${host} points to a private network address.`)
  return url
}

/** fetch() to a checked public URL without following redirects (a redirect could point inside). */
export async function safeFetch(raw: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const url = await assertPublicHttpsUrl(raw)
  const { timeoutMs = 10_000, ...rest } = init
  return fetch(url, { ...rest, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * Checks a URL a connector is about to call. From the cloud, private and
 * intranet addresses are refused with a message that points to the Nexus Agent;
 * inside an agent (or a self-hosted Nexus) they are allowed.
 */
export async function assertConnectorUrl(raw: string, opts: { httpsOnly?: boolean } = {}): Promise<URL> {
  const url = parseUrl(raw)
  const inside = privateNetworkAllowed()
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeUrlError('Only http:// and https:// URLs are allowed.')
  if (opts.httpsOnly && url.protocol !== 'https:' && !inside) throw new UnsafeUrlError('Only https:// URLs are allowed.')
  if (inside) return url
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const reason = await privateHostReason(host)
  if (reason === 'unresolved') throw new UnsafeUrlError(`${host} could not be found in public DNS. If it is an address inside your company network, connect it through a Nexus Agent in that network (Settings → Nexus Agents).`)
  if (reason) throw new UnsafeUrlError(`${host} is inside a private network, so KMPlus Nexus can't reach it from the cloud. Connect it through a Nexus Agent running in that network (Settings → Nexus Agents).`)
  return url
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])

/**
 * How a connector proves it is Nexus to an API published through a company
 * gateway by hand: a client certificate (mTLS), a company CA to trust, and/or
 * signed requests (X-Nexus-Signature, lib/net/request-signing.ts).
 */
export interface ConnectorTls {
  /** PEM client certificate (chain) Nexus presents. */
  clientCert?: string
  /** PEM private key of the client certificate. */
  clientKey?: string
  /** PEM CA certificate(s) to trust for the API's server certificate (company PKI). */
  caCert?: string
}

export interface ConnectorFetchOptions {
  httpsOnly?: boolean
  tls?: ConnectorTls
  /** Shared secret: every request (and redirect hop) gets X-Nexus-Timestamp and X-Nexus-Signature. */
  signingSecret?: string
}

const dispatchers = new Map<string, Agent>()

/** One connection pool per TLS identity. */
function dispatcherFor(tls: ConnectorTls) {
  const cert = tls.clientCert?.trim() || undefined
  const key = tls.clientKey?.trim() || undefined
  const ca = tls.caCert?.trim() || undefined
  if (!cert && !ca) return null
  if (Boolean(cert) !== Boolean(key)) throw new UnsafeUrlError('A client certificate needs both the certificate and its private key.')
  const id = createHash('sha256').update(`${cert}
${key}
${ca}`).digest('hex')
  let agent = dispatchers.get(id)
  if (!agent) {
    agent = new Agent({ connect: { cert, key, ca, rejectUnauthorized: true } })
    dispatchers.set(id, agent)
  }
  return agent
}

function bodyText(body: RequestInit['body']): string | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  throw new Error('Signed requests need a text body.')
}

/**
 * fetch() for connector requests: checks the URL and every redirect target
 * (followed by hand, at most 5) with assertConnectorUrl, and applies the
 * client certificate, company CA and request signature when configured.
 */
export async function connectorFetch(raw: string, init: RequestInit = {}, opts: ConnectorFetchOptions = {}): Promise<Response> {
  let url = await assertConnectorUrl(raw, opts)
  const secret = opts.signingSecret?.trim()
  const dispatcher = opts.tls ? dispatcherFor(opts.tls) : null
  let current: RequestInit = { ...init, redirect: 'manual', ...(secret ? { body: bodyText(init.body) } : {}) }
  const follow = (init.redirect ?? 'follow') === 'follow'
  for (let hop = 0; ; hop++) {
    if (dispatcher && url.protocol !== 'https:') throw new UnsafeUrlError('A client certificate or company CA needs an https:// URL.')
    const headers = new Headers(current.headers)
    if (secret) {
      for (const [k, v] of Object.entries(signRequest(secret, current.method ?? 'GET', url, (current.body as string | undefined) ?? ''))) headers.set(k, v)
    }
    const request = { ...current, headers }
    const res = dispatcher
      ? ((await undiciFetch(url, { ...(request as object), dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as Response)
      : await fetch(url, request)
    const location = res.headers.get('location')
    if (!follow || !REDIRECTS.has(res.status) || !location) return res
    if (hop >= 5) throw new Error('Too many redirects.')
    url = await assertConnectorUrl(new URL(location, url).toString(), opts)
    // Like browsers: 303 (and 301/302 after a POST) continue as GET without a body.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && (current.method ?? 'GET').toUpperCase() === 'POST')) {
      current = { ...current, method: 'GET', body: undefined }
    }
  }
}
