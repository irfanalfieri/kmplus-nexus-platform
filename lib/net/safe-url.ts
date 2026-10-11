import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Outbound requests to user-supplied URLs (OIDC discovery, webhooks) must not
 * reach the platform's own network (SSRF). Server-only.
 */

export class UnsafeUrlError extends Error {}

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
const allowPrivate = () => process.env.NEXUS_ALLOW_PRIVATE_URLS === 'true' && process.env.NODE_ENV !== 'production'

export const isPrivateAddress = (ip: string) => (isIP(ip) === 4 ? privateV4(ip) : isIP(ip) === 6 ? privateV6(ip) : true)

/** Throws unless the URL is https on a public host (every resolved address public). */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError('Enter a full URL starting with https://')
  }
  if (url.protocol !== 'https:' && !(allowPrivate() && url.protocol === 'http:')) throw new UnsafeUrlError('Only https:// URLs are allowed.')
  if (url.username || url.password) throw new UnsafeUrlError("URLs can't contain a username or password.")
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (allowPrivate()) return url
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new UnsafeUrlError('Internal hosts are not allowed.')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
  if (!addresses.length) throw new UnsafeUrlError(`${host} could not be resolved.`)
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError(`${host} points to a private network address.`)
  return url
}

/** fetch() to a checked public URL without following redirects (a redirect could point inside). */
export async function safeFetch(raw: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const url = await assertPublicHttpsUrl(raw)
  const { timeoutMs = 10_000, ...rest } = init
  return fetch(url, { ...rest, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
}
