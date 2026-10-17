/**
 * Root-cause hints for failed runs (MN-6). Pure and client-safe; covered by
 * scripts/engine-tests.ts. A run's error message is matched against known
 * patterns from databases, HTTP APIs, the Nexus Agent and Nexus itself; the
 * first match names the likely cause, a fix (text in the `hints` i18n
 * namespace) and the screen to fix it on. Unknown messages get no hint (the
 * AI diagnosis, AI-3, can still explain them).
 */

export const ROOT_CAUSES = ['agent', 'privateNetwork', 'rateLimit', 'auth', 'permission', 'schemaDrift', 'dataType', 'timeout', 'network', 'remoteError', 'held'] as const
export type RootCause = (typeof ROOT_CAUSES)[number]

const PATTERNS: [RootCause, RegExp][] = [
  ['agent', /nexus agent\b.*\b(offline|was removed|runs version|another workspace)|agent .* is offline/i],
  ['privateNetwork', /private (or intranet )?address|intranet address|refused from the cloud|not reachable from the cloud/i],
  ['rateLimit', /\b429\b|rate.?limit|too many requests|quota (exceeded|reached)|max(imum)? calls per run/i],
  ['auth', /password authentication failed|authentication failed|invalid (credentials|username or password|api key|token)|\bunauthori[sz]ed\b|\b401\b|access denied for user|login failed|invalid_(grant|client)|token (has )?expired|sign-?in (failed|was refused)/i],
  ['permission', /permission denied|\b403\b|\bforbidden\b|insufficient privileges?|not authori[sz]ed to|access to .+ (is )?denied|read-only|must be owner/i],
  ['schemaDrift', /column .+ does not exist|relation .+ does not exist|no such (table|column)|unknown column|invalid column name|invalid object name|table .+ (was )?not found|doesn't exist|has no column/i],
  ['dataType', /invalid input syntax for( type)?|cannot be cast|value too long for|out of range|numeric field overflow|invalid date|date\/time field value out of range/i],
  ['timeout', /timed? ?out|timeout|statement timeout|canceling statement|no answer within|ETIMEDOUT/i],
  ['network', /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ENETUNREACH|getaddrinfo|socket hang up|fetch failed|network error|certificate|self[- ]signed|\bTLS\b|\bSSL\b/i],
  ['remoteError', /\b50[0-4]\b|bad gateway|service unavailable|internal server error|gateway timeout/i],
  ['held', /quarantine threshold|rows? (were )?held|held back|rejected \d+ rows/i],
]

/** Where each cause is usually fixed. */
export const ROOT_CAUSE_HREF: Partial<Record<RootCause, string>> = {
  agent: '/dashboard/settings/agents',
  privateNetwork: '/dashboard/settings/agents',
  auth: '/dashboard/sources',
  permission: '/dashboard/sources',
  schemaDrift: '/dashboard/sources',
  network: '/dashboard/sources',
  held: '/dashboard/quality',
}

/** The likely cause of a run's error, or null when no known pattern matches. */
export function rootCause(message: string | null | undefined): RootCause | null {
  if (!message) return null
  for (const [cause, pattern] of PATTERNS) if (pattern.test(message)) return cause
  return null
}
