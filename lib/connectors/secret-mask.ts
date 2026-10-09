/**
 * Masking for connectors with custom credential forms (REST, Salesforce), so
 * their credentials can be edited without sending secrets to the browser.
 * A stored secret is replaced by KEEP; when the form is saved, any value still
 * equal to KEEP is swapped back for the stored one. Client-safe (no I/O).
 */

export const KEEP = '••••••••'

const SECRET_FIELDS: Record<string, string[]> = {
  rest: ['apiKeyValue', 'bearerToken', 'basicPassword', 'customHeaderValue', 'oauthClientSecret', 'oauthPassword', 'apiKey', 'password'],
  salesforce: ['clientSecret', 'accessToken', 'refreshToken', 'password', 'securityToken'],
}

/** Key/value list fields whose sensitive-looking entries are masked too. */
const KV_FIELDS: Record<string, string[]> = {
  rest: ['headersKv', 'paramsKv', 'bodyKv'],
}

const SENSITIVE_KEY = /auth|token|key|secret|pass|cookie|session|sig/i

export function hasCustomCredentialForm(slug: string): slug is 'rest' | 'salesforce' {
  return slug in SECRET_FIELDS
}

interface Pair {
  key?: unknown
  value?: unknown
  [k: string]: unknown
}

function parsePairs(raw: string | undefined): Pair[] | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as Pair[]) : null
  } catch {
    return null
  }
}

export function maskCredentials(slug: string, stored: Record<string, string>): Record<string, string> {
  const out = { ...stored }
  for (const key of SECRET_FIELDS[slug] ?? []) {
    if (out[key]) out[key] = KEEP
  }
  for (const key of KV_FIELDS[slug] ?? []) {
    const pairs = parsePairs(out[key])
    if (!pairs) continue
    out[key] = JSON.stringify(pairs.map((p) => (SENSITIVE_KEY.test(String(p.key ?? '')) && p.value ? { ...p, value: KEEP } : p)))
  }
  return out
}

/** Puts stored secrets back wherever the submitted form still holds KEEP. */
export function restoreSecrets(slug: string, submitted: Record<string, string>, stored: Record<string, string>): Record<string, string> {
  const out = { ...submitted }
  for (const [key, value] of Object.entries(out)) {
    if (value === KEEP) out[key] = stored[key] ?? ''
  }
  for (const key of KV_FIELDS[slug] ?? []) {
    const pairs = parsePairs(out[key])
    if (!pairs?.some((p) => p.value === KEEP)) continue
    const storedPairs = parsePairs(stored[key]) ?? []
    out[key] = JSON.stringify(
      pairs.map((p) => {
        if (p.value !== KEEP) return p
        const match = storedPairs.find((s) => String(s.key ?? '') === String(p.key ?? ''))
        return { ...p, value: match ? String(match.value ?? '') : '' }
      })
    )
  }
  return out
}
