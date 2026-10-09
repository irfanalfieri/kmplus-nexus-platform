/** Only same-site relative paths ("/invite/abc"), never "//evil.com", "/\evil.com" or absolute URLs. */
export function safeNextPath(value: unknown, fallback = '/dashboard') {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
