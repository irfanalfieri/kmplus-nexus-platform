/** Postman-style {{variable}} substitution. */
export function applyVariables(input: string, variables: Record<string, string>): string {
  if (!input.includes('{{')) return input
  return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, name: string) => {
    return variables[name] ?? `{{${name}}}`
  })
}

export function parseVariablesJson(raw: string): Record<string, string> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
    )
  } catch {
    return {}
  }
}
