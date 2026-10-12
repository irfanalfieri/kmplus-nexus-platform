/**
 * SCIM 2.0 (RFC 7643 / 7644) wire format for user provisioning (GV-8). Pure;
 * covered by scripts/engine-tests.ts. The database side is lib/scim/store.ts,
 * the endpoints app/api/scim/v2/[[...path]]/route.ts.
 *
 * Supported: Users and Groups (create, read, list with `eq` filters and
 * paging, replace, PATCH, delete), ServiceProviderConfig, ResourceTypes,
 * Schemas. Tested against the shapes Microsoft Entra ID and Okta send.
 */

export const SCHEMA = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  enterpriseUser: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  serviceProviderConfig: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  resourceType: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  schema: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
} as const

export const SCIM_CONTENT_TYPE = 'application/scim+json'
export const MAX_RESULTS = 200

export class ScimError extends Error {
  constructor(
    public status: number,
    message: string,
    public scimType?: 'invalidFilter' | 'invalidValue' | 'uniqueness' | 'mutability' | 'invalidPath' | 'noTarget' | 'invalidSyntax' | 'tooMany'
  ) {
    super(message)
  }
}

export function errorBody(err: ScimError) {
  return { schemas: [SCHEMA.error], status: String(err.status), ...(err.scimType ? { scimType: err.scimType } : {}), detail: err.message }
}

export function listResponse<T>(resources: T[], total: number, startIndex: number) {
  return { schemas: [SCHEMA.list], totalResults: total, startIndex, itemsPerPage: resources.length, Resources: resources }
}

/** startIndex (1-based) and count from the query string. */
export function paging(params: URLSearchParams) {
  const start = Math.max(1, Number.parseInt(params.get('startIndex') ?? '1', 10) || 1)
  const rawCount = params.get('count')
  const count = rawCount === null ? 100 : Math.min(MAX_RESULTS, Math.max(0, Number.parseInt(rawCount, 10) || 0))
  return { startIndex: start, count }
}

export interface ScimFilter {
  attribute: string
  value: string
}

/**
 * `attribute eq "value"` filters (what IdPs use to look a resource up before
 * creating it). Attribute names are compared case-insensitively.
 */
export function parseFilter(filter: string | null, allowed: string[]): ScimFilter | null {
  if (!filter?.trim()) return null
  const m = /^\s*([A-Za-z][\w.:]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter)
  if (!m) throw new ScimError(400, `Only "attribute eq \\"value\\"" filters are supported (got: ${filter.slice(0, 100)}).`, 'invalidFilter')
  const attribute = allowed.find((a) => a.toLowerCase() === m[1].toLowerCase())
  if (!attribute) throw new ScimError(400, `Filtering on ${m[1]} is not supported. Use one of: ${allowed.join(', ')}.`, 'invalidFilter')
  return { attribute, value: m[2].replace(/\\(.)/g, '$1') }
}

/** SCIM booleans arrive as true/false or "True"/"False" (Entra). */
export function scimBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string' && /^(true|false)$/i.test(value)) return value.toLowerCase() === 'true'
  throw new ScimError(400, `Expected a boolean, got ${JSON.stringify(value)}.`, 'invalidValue')
}

export type UserDoc = Record<string, unknown> & { userName?: string; externalId?: string; active?: boolean }

/** The fields a User keeps besides userName / externalId / active (what GET returns). */
export function userAttributes(doc: Record<string, unknown>) {
  const { schemas: _s, id: _i, meta: _m, userName: _u, externalId: _e, active: _a, password: _p, groups: _g, ...rest } = doc
  return rest
}

/** The email a User resource is provisioned for: primary email, else a work email, else the first, else userName. */
export function userEmail(doc: UserDoc): string | null {
  const emails = Array.isArray(doc.emails) ? (doc.emails as { value?: unknown; primary?: unknown; type?: unknown }[]) : []
  const pick = emails.find((e) => e.primary === true || e.primary === 'true' || e.primary === 'True') ?? emails.find((e) => e.type === 'work') ?? emails[0]
  const candidate = typeof pick?.value === 'string' ? pick.value : typeof doc.userName === 'string' ? doc.userName : ''
  const email = candidate.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

/** A display name from displayName, name.formatted or given + family name. */
export function userDisplayName(doc: UserDoc): string | null {
  if (typeof doc.displayName === 'string' && doc.displayName.trim()) return doc.displayName.trim()
  const name = (doc.name ?? {}) as { formatted?: unknown; givenName?: unknown; familyName?: unknown }
  if (typeof name.formatted === 'string' && name.formatted.trim()) return name.formatted.trim()
  const parts = [name.givenName, name.familyName].filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
  return parts.length ? parts.join(' ') : null
}

export interface PatchOp {
  op: 'add' | 'replace' | 'remove'
  path?: string
  value?: unknown
}

export function parsePatch(body: unknown): PatchOp[] {
  const b = body as { schemas?: unknown; Operations?: unknown } | null
  if (!b || !Array.isArray(b.Operations)) throw new ScimError(400, 'A PATCH body needs an Operations array.', 'invalidSyntax')
  return b.Operations.map((raw) => {
    const o = raw as { op?: unknown; path?: unknown; value?: unknown }
    const op = String(o.op ?? '').toLowerCase()
    if (op !== 'add' && op !== 'replace' && op !== 'remove') throw new ScimError(400, `Unknown PATCH op "${String(o.op)}".`, 'invalidSyntax')
    return { op, path: typeof o.path === 'string' && o.path.trim() ? o.path.trim() : undefined, value: o.value } as PatchOp
  })
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** `emails[type eq "work"].value` → { attr: 'emails', filter: {type: 'work'}, sub: 'value' }. */
function parsePath(path: string) {
  const m = /^([A-Za-z][\w:.-]*?)(?:\[\s*([A-Za-z]\w*)\s+eq\s+"([^"]*)"\s*\])?(?:\.([A-Za-z]\w*))?$/.exec(path)
  if (!m) throw new ScimError(400, `Unsupported path "${path}".`, 'invalidPath')
  let attr = m[1]
  let sub = m[4]
  // Extension attributes: urn:…:User:department
  if (attr.startsWith('urn:')) {
    const i = attr.lastIndexOf(':')
    return { attr: attr.slice(0, i), sub: attr.slice(i + 1), filter: undefined }
  }
  if (!m[2] && !sub && attr.includes('.')) [attr, sub] = attr.split('.', 2) as [string, string]
  return { attr, filter: m[2] ? { key: m[2], value: m[3] } : undefined, sub }
}

/**
 * Applies PATCH operations to a User document (userName, externalId, active
 * and attributes). Returns a new document; never mutates the input.
 */
export function applyUserPatch(doc: UserDoc, ops: PatchOp[]): UserDoc {
  const out: UserDoc = structuredClone(doc)
  for (const op of ops) {
    if (!op.path) {
      // { op: replace, value: { active: false, name: {...} } }
      if (op.op === 'remove') throw new ScimError(400, 'remove needs a path.', 'noTarget')
      if (!isObject(op.value)) throw new ScimError(400, 'Without a path, value must be an object.', 'invalidValue')
      for (const [k, v] of Object.entries(op.value)) {
        if (k.includes('.') || k.includes('[') || k.startsWith('urn:')) Object.assign(out, applyUserPatch(out, [{ op: op.op, path: k, value: v }]))
        else if (isObject(v) && isObject(out[k]) && op.op === 'add') out[k] = { ...(out[k] as object), ...v }
        else out[k] = v
      }
      continue
    }
    const { attr, filter, sub } = parsePath(op.path)
    if (!filter && !sub) {
      if (op.op === 'remove') delete out[attr]
      else if (op.op === 'add' && Array.isArray(out[attr]) && Array.isArray(op.value)) out[attr] = [...(out[attr] as unknown[]), ...op.value]
      else out[attr] = op.value
      continue
    }
    if (!filter) {
      // name.givenName, or an extension attribute
      const parent = isObject(out[attr]) ? { ...(out[attr] as Record<string, unknown>) } : {}
      if (op.op === 'remove') delete parent[sub!]
      else parent[sub!] = op.value
      out[attr] = parent
      continue
    }
    // emails[type eq "work"].value
    const list = Array.isArray(out[attr]) ? [...(out[attr] as Record<string, unknown>[])] : []
    const index = list.findIndex((item) => isObject(item) && String(item[filter.key]) === filter.value)
    if (op.op === 'remove') {
      if (index >= 0) {
        if (sub) list[index] = Object.fromEntries(Object.entries(list[index]).filter(([k]) => k !== sub))
        else list.splice(index, 1)
      }
    } else {
      const item = index >= 0 ? { ...list[index] } : { [filter.key]: filter.value }
      if (sub) item[sub] = op.value
      else if (isObject(op.value)) Object.assign(item, op.value)
      if (index >= 0) list[index] = item
      else list.push(item)
    }
    out[attr] = list
  }
  if ('active' in out && out.active !== undefined) out.active = scimBoolean(out.active)
  return out
}

/** Group PATCH: displayName / externalId changes and member adds, removes and replacements. */
export function applyGroupPatch(group: { displayName: string; externalId: string | null; members: string[] }, ops: PatchOp[]) {
  const out = { ...group, members: [...group.members] }
  const ids = (value: unknown): string[] => {
    const arr = Array.isArray(value) ? value : value === undefined ? [] : [value]
    return arr.map((m) => (isObject(m) ? String(m.value ?? '') : String(m))).filter(Boolean)
  }
  for (const op of ops) {
    const path = op.path ?? ''
    const memberFilter = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path)
    if (memberFilter) {
      if (op.op === 'remove') out.members = out.members.filter((m) => m !== memberFilter[1])
      else if (!out.members.includes(memberFilter[1])) out.members.push(memberFilter[1])
      continue
    }
    if (path.toLowerCase() === 'members') {
      const given = ids(op.value)
      if (op.op === 'add') out.members = [...new Set([...out.members, ...given])]
      else if (op.op === 'replace') out.members = [...new Set(given)]
      else out.members = given.length ? out.members.filter((m) => !given.includes(m)) : []
      continue
    }
    if (!path) {
      if (!isObject(op.value)) throw new ScimError(400, 'Without a path, value must be an object.', 'invalidValue')
      if (typeof op.value.displayName === 'string') out.displayName = op.value.displayName
      if ('externalId' in op.value) out.externalId = op.value.externalId == null ? null : String(op.value.externalId)
      if (op.value.members !== undefined) out.members = op.op === 'add' ? [...new Set([...out.members, ...ids(op.value.members)])] : [...new Set(ids(op.value.members))]
      continue
    }
    if (path.toLowerCase() === 'displayname') {
      if (op.op === 'remove') throw new ScimError(400, 'displayName is required.', 'mutability')
      out.displayName = String(op.value ?? '')
      continue
    }
    if (path.toLowerCase() === 'externalid') {
      out.externalId = op.op === 'remove' || op.value == null ? null : String(op.value)
      continue
    }
    throw new ScimError(400, `Unsupported group path "${path}".`, 'invalidPath')
  }
  if (!out.displayName.trim()) throw new ScimError(400, 'displayName is required.', 'invalidValue')
  return out
}

/** Static discovery documents. */
export function serviceProviderConfig(base: string) {
  return {
    schemas: [SCHEMA.serviceProviderConfig],
    documentationUri: `${base}/docs`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_RESULTS },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'A SCIM token created in KMPlus Nexus → Settings → SCIM provisioning.', primary: true }],
    meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` },
  }
}

export function resourceTypes(base: string) {
  const types = [
    { schemas: [SCHEMA.resourceType], id: 'User', name: 'User', endpoint: '/Users', schema: SCHEMA.user, schemaExtensions: [{ schema: SCHEMA.enterpriseUser, required: false }], meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` } },
    { schemas: [SCHEMA.resourceType], id: 'Group', name: 'Group', endpoint: '/Groups', schema: SCHEMA.group, meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` } },
  ]
  return listResponse(types, types.length, 1)
}

const attribute = (name: string, type: string, extra: Record<string, unknown> = {}) => ({ name, type, multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', ...extra })

export function schemas() {
  const user = {
    schemas: [SCHEMA.schema],
    id: SCHEMA.user,
    name: 'User',
    attributes: [
      attribute('userName', 'string', { required: true, uniqueness: 'server' }),
      attribute('name', 'complex', { subAttributes: ['formatted', 'givenName', 'familyName'].map((n) => attribute(n, 'string')) }),
      attribute('displayName', 'string'),
      attribute('title', 'string'),
      attribute('active', 'boolean'),
      attribute('emails', 'complex', { multiValued: true, subAttributes: [attribute('value', 'string'), attribute('type', 'string'), attribute('primary', 'boolean')] }),
    ],
  }
  const group = {
    schemas: [SCHEMA.schema],
    id: SCHEMA.group,
    name: 'Group',
    attributes: [attribute('displayName', 'string', { required: true }), attribute('members', 'complex', { multiValued: true, subAttributes: [attribute('value', 'string'), attribute('display', 'string')] })],
  }
  return listResponse([user, group], 2, 1)
}
