/** Parse pasted "url: … auth: …" blocks, curl snippets, or raw URLs into REST connector fields. */

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/i

export interface ParsedRestConnection {
  baseUrl: string
  resourcePath: string
  authMethod: 'none' | 'bearer' | 'custom_header'
  bearerToken: string
  bearerPrefix: string
  customHeaderName?: string
  customHeaderValue?: string
}

function splitUrl(fullUrl: string): { baseUrl: string; resourcePath: string } {
  try {
    const parsed = new URL(fullUrl.trim())
    const baseUrl = parsed.origin
    const resourcePath = `${parsed.pathname}${parsed.search}` || '/'
    return { baseUrl, resourcePath }
  } catch {
    return { baseUrl: fullUrl.trim(), resourcePath: '/' }
  }
}

function stripAuthFromUrl(raw: string): { url: string; inlineToken?: string } {
  let text = raw.trim()

  // "https://host/path auth: token" or "…/path auth:token"
  const authInline = text.match(/^(https?:\/\/.+?)\s+auth\s*:\s*(.+)$/i)
  if (authInline) {
    return { url: authInline[1].trim(), inlineToken: authInline[2].trim() }
  }

  // Trailing junk after valid URL (e.g. pasted "ninebox auth: eyJ...")
  const urlMatch = text.match(URL_PATTERN)
  if (urlMatch) {
    const url = urlMatch[0]
    const rest = text.slice(text.indexOf(url) + url.length).trim()
    const tokenFromRest = rest.match(JWT_PATTERN)?.[0]
    if (rest.toLowerCase().startsWith('auth') || tokenFromRest) {
      const token =
        rest.replace(/^auth\s*:\s*/i, '').match(JWT_PATTERN)?.[0] ??
        rest.replace(/^auth\s*:\s*/i, '').trim()
      return { url, inlineToken: token || undefined }
    }
    return { url }
  }

  return { url: text }
}

function extractBearerToken(text: string): string | undefined {
  const bearer = text.match(/(?:authorization|auth)\s*:\s*(?:Bearer\s+)?(eyJ[^\s"'<>]+)/i)
  if (bearer) return bearer[1]

  const jwtOnly = text.match(JWT_PATTERN)
  if (jwtOnly?.length) return jwtOnly[jwtOnly.length - 1]

  return undefined
}

function extractLabeledUrl(text: string): string | undefined {
  const labeled = text.match(/url\s*:\s*(https?:\/\/[^\s]+)/i)
  if (labeled) return labeled[1].trim()

  const bare = text.match(URL_PATTERN)
  return bare?.[0]
}

/** Returns partial REST credential updates from arbitrary pasted text. */
export function parseConnectionPaste(raw: string): Partial<ParsedRestConnection> | null {
  const text = raw.trim()
  if (!text) return null

  const fullUrl = extractLabeledUrl(text)
  const token =
    extractBearerToken(text) ??
    (() => {
      const authLine = text.match(/auth\s*:\s*(.+)/is)
      if (!authLine) return undefined
      return authLine[1].match(JWT_PATTERN)?.[0] ?? authLine[1].trim()
    })()

  if (!fullUrl && !token) return null

  if (fullUrl) {
    const { url, inlineToken } = stripAuthFromUrl(fullUrl)
    const { baseUrl, resourcePath } = splitUrl(url)
    const bearerToken = token ?? inlineToken ?? ''
    const usesAuthLabel = /auth\s*:/i.test(text) && !/authorization\s*:/i.test(text)

    if (bearerToken && usesAuthLabel) {
      return {
        baseUrl,
        resourcePath,
        authMethod: 'custom_header',
        customHeaderName: 'auth',
        customHeaderValue: bearerToken,
        bearerToken: '',
        bearerPrefix: '',
      }
    }

    return {
      baseUrl,
      resourcePath,
      authMethod: bearerToken ? 'bearer' : 'none',
      bearerToken,
      bearerPrefix: 'Bearer',
    }
  }

  if (token) {
    return {
      authMethod: 'bearer',
      bearerToken: token,
      bearerPrefix: 'Bearer',
    }
  }

  return null
}

/** A JWT anywhere in a string (not global: safe to reuse with .test). */
const HAS_JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/

/**
 * Clean credentials that have a pasted token stuck in the base URL (old bad
 * saves like "https://host/path auth: eyJ…"). A clean URL is left alone, even
 * when it contains the word "auth" (https://auth-api.company.com).
 */
export function sanitizeRestCredentials(values: Record<string, string>): Record<string, string> {
  const baseUrl = values.baseUrl ?? ''
  if (!/\sauth\s*:/i.test(baseUrl) && !HAS_JWT.test(baseUrl)) return values

  const parsed = parseConnectionPaste(`url: ${baseUrl} auth: ${values.bearerToken ?? ''}`)
  if (!parsed?.baseUrl) return values
  const token = parsed.bearerToken || parsed.customHeaderValue || ''

  return {
    ...values,
    baseUrl: parsed.baseUrl,
    // The path only moves when the stuck URL carried one.
    resourcePath: parsed.resourcePath && parsed.resourcePath !== '/' ? parsed.resourcePath : (values.resourcePath ?? '/'),
    authMethod: token ? 'bearer' : (values.authMethod ?? 'none'),
    bearerToken: token || values.bearerToken || '',
    bearerPrefix: values.bearerPrefix || 'Bearer',
  }
}
