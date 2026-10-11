/**
 * Before/after diffs for the audit log (GV-3). Pure and client-safe.
 * Only changed fields are kept. Secret-looking fields record that they
 * changed, never their values; long values are shortened.
 */

export type AuditDiff = Record<string, { from: unknown; to: unknown } | { changed: true }>

const SECRET = /pass(word)?|secret|token|api_?key|private|credential|client_?secret|connection_?string|authorization/i
const MAX_VALUE = 200

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

function short(v: unknown): unknown {
  if (v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v
  const json = JSON.stringify(v)
  return json.length > MAX_VALUE ? `${json.slice(0, MAX_VALUE)}…` : v
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Field-by-field diff. Nested plain objects are flattened one level deep
 * ("settings.retries"), deeper structures compare as a whole.
 */
export function diffObjects(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, opts: { secretFields?: string[]; ignore?: string[] } = {}): AuditDiff {
  const out: AuditDiff = {}
  const secrets = new Set(opts.secretFields ?? [])
  const ignore = new Set(['updatedAt', 'createdAt', ...(opts.ignore ?? [])])
  const walk = (a: Record<string, unknown>, b: Record<string, unknown>, prefix: string, depth: number) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (ignore.has(key)) continue
      const path = prefix ? `${prefix}.${key}` : key
      const x = a[key]
      const y = b[key]
      if (same(x, y)) continue
      if (secrets.has(key) || SECRET.test(key)) {
        out[path] = { changed: true }
      } else if (depth < 1 && isPlainObject(x) && isPlainObject(y)) {
        walk(x, y, path, depth + 1)
      } else {
        out[path] = { from: short(x), to: short(y) }
      }
    }
  }
  walk(before ?? {}, after ?? {}, '', 0)
  return out
}

/** Pipeline graphs: steps added/removed/changed by title, plus settings diffs. */
export function diffPipelineDefinitions(
  before: { nodes?: { id: string; type: string }[]; settings?: Record<string, unknown> } | null | undefined,
  after: { nodes?: { id: string; type: string }[]; settings?: Record<string, unknown> } | null | undefined,
  title: (n: { id: string; type: string }) => string
) {
  const a = new Map((before?.nodes ?? []).map((n) => [n.id, n]))
  const b = new Map((after?.nodes ?? []).map((n) => [n.id, n]))
  const strip = (n: object) => {
    const { position: _p, ...rest } = n as Record<string, unknown>
    return rest
  }
  const added = [...b.values()].filter((n) => !a.has(n.id)).map(title)
  const removed = [...a.values()].filter((n) => !b.has(n.id)).map(title)
  const changed = [...b.values()].filter((n) => a.has(n.id) && !same(strip(a.get(n.id)!), strip(n))).map(title)
  return {
    ...(added.length ? { stepsAdded: added } : {}),
    ...(removed.length ? { stepsRemoved: removed } : {}),
    ...(changed.length ? { stepsChanged: changed } : {}),
    ...diffObjects(before?.settings ?? {}, after?.settings ?? {}),
  }
}
