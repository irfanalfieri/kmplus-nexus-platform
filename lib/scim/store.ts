import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { scimGroups, scimTokens, scimUsers, session, ssoProvider, user, workspaceMembers, workspaceSso } from '@/lib/db/schema'
import { ROLES, isRole, type Role } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { SCHEMA, ScimError, applyGroupPatch, applyUserPatch, listResponse, parseFilter, scimBoolean, userAttributes, userDisplayName, userEmail, type PatchOp, type UserDoc } from './protocol'

/**
 * SCIM 2.0 provisioning, database side (GV-8). The identity provider creates,
 * updates and deactivates workspace members with a workspace SCIM token:
 *   create   → a Nexus account (email at one of the workspace's verified SSO
 *              domains, signs in with SSO) and membership with the SSO default
 *              role, or the highest role of its role-mapped groups
 *   active=false / delete → membership removed and every session revoked
 *   groups   → admins map a group to a role in Settings; members get it
 */

export interface ScimCaller {
  workspaceId: string
  tokenId: string
  base: string
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export async function authenticateScim(req: Request, base: string): Promise<ScimCaller> {
  const header = req.headers.get('authorization') ?? ''
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
  if (!token) throw new ScimError(401, 'Send the SCIM token as "Authorization: Bearer nxs_…".')
  const [row] = await db
    .select({ id: scimTokens.id, workspaceId: scimTokens.workspaceId, lastUsedAt: scimTokens.lastUsedAt })
    .from(scimTokens)
    .where(and(eq(scimTokens.hash, sha256(token)), isNull(scimTokens.revokedAt)))
    .limit(1)
  if (!row) throw new ScimError(401, 'Invalid or revoked SCIM token.')
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await db.update(scimTokens).set({ lastUsedAt: new Date() }).where(eq(scimTokens.id, row.id))
  return { workspaceId: row.workspaceId, tokenId: row.id, base }
}

const actor = (c: ScimCaller) => ({ userId: `scim:${c.tokenId}`, workspaceId: c.workspaceId })

// ── Users ────────────────────────────────────────────────────────────────────

type ScimUserRow = typeof scimUsers.$inferSelect

async function groupsOf(workspaceId: string, scimIds: string[]) {
  if (!scimIds.length) return new Map<string, { value: string; display: string }[]>()
  const groups = await db.select().from(scimGroups).where(eq(scimGroups.workspaceId, workspaceId))
  const out = new Map<string, { value: string; display: string }[]>()
  for (const g of groups) for (const m of (g.members as string[]) ?? []) if (scimIds.includes(m)) out.set(m, [...(out.get(m) ?? []), { value: g.id, display: g.displayName }])
  return out
}

function userResource(c: ScimCaller, row: ScimUserRow, groups: { value: string; display: string }[] = []) {
  return {
    schemas: [SCHEMA.user],
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    userName: row.userName,
    active: row.active,
    ...(row.attributes as Record<string, unknown>),
    groups,
    meta: { resourceType: 'User', created: row.createdAt.toISOString(), lastModified: row.updatedAt.toISOString(), location: `${c.base}/Users/${row.id}` },
  }
}

async function ownedUser(c: ScimCaller, id: string) {
  const [row] = await db.select().from(scimUsers).where(and(eq(scimUsers.id, id), eq(scimUsers.workspaceId, c.workspaceId))).limit(1)
  if (!row) throw new ScimError(404, `User ${id} not found.`)
  return row
}

/** The workspace's verified SSO domains and their default roles. */
async function ssoDomains(workspaceId: string) {
  const rows = await db
    .select({ domain: workspaceSso.domain, defaultRole: workspaceSso.defaultRole })
    .from(workspaceSso)
    .innerJoin(ssoProvider, eq(ssoProvider.providerId, workspaceSso.providerId))
    .where(and(eq(workspaceSso.workspaceId, workspaceId), eq(ssoProvider.domainVerified, true)))
  return new Map(rows.map((r) => [r.domain.toLowerCase(), isRole(r.defaultRole) ? r.defaultRole : ('viewer' as Role)]))
}

/** Highest role among the user's role-mapped groups, or null when no mapped group includes them. */
async function groupRole(workspaceId: string, scimId: string): Promise<Role | null> {
  const groups = await db.select({ role: scimGroups.role, members: scimGroups.members }).from(scimGroups).where(eq(scimGroups.workspaceId, workspaceId))
  const roles = groups.filter((g) => g.role && isRole(g.role) && ((g.members as string[]) ?? []).includes(scimId)).map((g) => g.role as Role)
  return roles.length ? roles.sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b))[0] : null
}

async function adminCount(workspaceId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'admin')))
  return n
}

/**
 * Gives an active SCIM user their membership and role. With fromGroups (a group
 * change), someone in no role-mapped group falls back to the default role.
 */
async function grantAccess(c: ScimCaller, row: ScimUserRow, defaultRole: Role, fromGroups = false) {
  const mapped = await groupRole(c.workspaceId, row.id)
  const [existing] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, c.workspaceId), eq(workspaceMembers.userId, row.userId))).limit(1)
  if (!existing) {
    const role = mapped ?? defaultRole
    await db.insert(workspaceMembers).values({ workspaceId: c.workspaceId, userId: row.userId, role }).onConflictDoNothing()
    return
  }
  const target = mapped ?? (fromGroups ? defaultRole : null)
  if (!target || target === existing.role) return
  // Never take away the last admin through a group change.
  if (existing.role === 'admin' && (await adminCount(c.workspaceId)) <= 1) return
  await db.update(workspaceMembers).set({ role: target, updatedAt: new Date() }).where(and(eq(workspaceMembers.workspaceId, c.workspaceId), eq(workspaceMembers.userId, row.userId)))
  await recordAudit(actor(c), { action: 'CHANGE_ROLE', resource: 'member', resourceId: row.userId, changes: { via: 'scim group' }, diff: { role: { from: existing.role, to: target } } })
}

/** Removes an account's access to the workspace and signs it out everywhere. */
async function revokeAccess(c: ScimCaller, row: ScimUserRow) {
  const [member] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, c.workspaceId), eq(workspaceMembers.userId, row.userId))).limit(1)
  if (member?.role === 'admin' && (await adminCount(c.workspaceId)) <= 1) {
    throw new ScimError(400, `${row.userName} is the workspace's last admin. Make someone else an admin in KMPlus Nexus first.`, 'mutability')
  }
  await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, c.workspaceId), eq(workspaceMembers.userId, row.userId)))
  // Sessions are per account, not per workspace: a deprovisioned person is signed out everywhere.
  await db.delete(session).where(eq(session.userId, row.userId))
}

export async function getUser(c: ScimCaller, id: string) {
  const row = await ownedUser(c, id)
  return userResource(c, row, (await groupsOf(c.workspaceId, [row.id])).get(row.id))
}

export async function listUsers(c: ScimCaller, params: URLSearchParams, startIndex: number, count: number) {
  const filter = parseFilter(params.get('filter'), ['userName', 'externalId', 'id', 'emails.value'])
  const where = [eq(scimUsers.workspaceId, c.workspaceId)]
  if (filter?.attribute === 'userName') where.push(sql`lower(${scimUsers.userName}) = lower(${filter.value})`)
  if (filter?.attribute === 'externalId') where.push(eq(scimUsers.externalId, filter.value))
  if (filter?.attribute === 'id') where.push(eq(scimUsers.id, filter.value))
  if (filter?.attribute === 'emails.value') where.push(sql`exists (select 1 from jsonb_array_elements(coalesce(${scimUsers.attributes}->'emails', '[]'::jsonb)) e where lower(e->>'value') = lower(${filter.value}))`)
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(scimUsers).where(and(...where))
  const rows = count ? await db.select().from(scimUsers).where(and(...where)).orderBy(scimUsers.createdAt, scimUsers.id).limit(count).offset(startIndex - 1) : []
  const groups = await groupsOf(c.workspaceId, rows.map((r) => r.id))
  return listResponse(rows.map((r) => userResource(c, r, groups.get(r.id))), total, startIndex)
}

function validateUserDoc(doc: UserDoc) {
  if (typeof doc.userName !== 'string' || !doc.userName.trim()) throw new ScimError(400, 'userName is required.', 'invalidValue')
  if (doc.userName.length > 320) throw new ScimError(400, 'userName is too long.', 'invalidValue')
}

export async function createUser(c: ScimCaller, body: unknown) {
  const doc = (body ?? {}) as UserDoc
  validateUserDoc(doc)
  const email = userEmail(doc)
  if (!email) throw new ScimError(400, 'The user needs an email address (emails or an email-shaped userName).', 'invalidValue')
  const domains = await ssoDomains(c.workspaceId)
  const domain = email.split('@')[1]
  if (!domains.has(domain)) throw new ScimError(400, `${email} is not at a verified SSO domain of this workspace (${[...domains.keys()].join(', ') || 'none yet'}). Set up SSO for the domain first.`, 'invalidValue')
  const active = doc.active === undefined ? true : scimBoolean(doc.active)

  const [taken] = await db.select({ id: scimUsers.id }).from(scimUsers).where(and(eq(scimUsers.workspaceId, c.workspaceId), sql`lower(${scimUsers.userName}) = lower(${doc.userName!})`)).limit(1)
  if (taken) throw new ScimError(409, `A user with userName ${doc.userName} already exists.`, 'uniqueness')

  // One Nexus account per email; SCIM accounts sign in with SSO (no password).
  let [account] = await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`).limit(1)
  if (!account) {
    const id = randomUUID().replace(/-/g, '')
    await db.insert(user).values({ id, email, name: userDisplayName(doc) ?? email, emailVerified: true, twoFactorEnabled: false })
    account = { id }
  }
  const [linked] = await db.select({ id: scimUsers.id }).from(scimUsers).where(and(eq(scimUsers.workspaceId, c.workspaceId), eq(scimUsers.userId, account.id))).limit(1)
  if (linked) throw new ScimError(409, `${email} is already provisioned (id ${linked.id}).`, 'uniqueness')

  const now = new Date()
  const [row] = await db
    .insert(scimUsers)
    .values({ id: randomUUID(), workspaceId: c.workspaceId, userId: account.id, userName: doc.userName!.trim(), externalId: typeof doc.externalId === 'string' ? doc.externalId : null, active, attributes: userAttributes(doc), createdAt: now, updatedAt: now })
    .returning()
  if (active) await grantAccess(c, row, domains.get(domain)!)
  await recordAudit(actor(c), { action: 'PROVISION', resource: 'member', resourceId: account.id, changes: { email, scimId: row.id, active } })
  return userResource(c, row)
}

async function saveUser(c: ScimCaller, row: ScimUserRow, next: UserDoc) {
  validateUserDoc(next)
  const active = next.active === undefined ? row.active : scimBoolean(next.active)
  const userName = next.userName!.trim()
  if (userName.toLowerCase() !== row.userName.toLowerCase()) {
    const [taken] = await db.select({ id: scimUsers.id }).from(scimUsers).where(and(eq(scimUsers.workspaceId, c.workspaceId), sql`lower(${scimUsers.userName}) = lower(${userName})`)).limit(1)
    if (taken && taken.id !== row.id) throw new ScimError(409, `A user with userName ${userName} already exists.`, 'uniqueness')
  }
  if (row.active && !active) await revokeAccess(c, row)
  const [updated] = await db
    .update(scimUsers)
    .set({ userName, externalId: typeof next.externalId === 'string' ? next.externalId : null, active, attributes: userAttributes(next), updatedAt: new Date() })
    .where(eq(scimUsers.id, row.id))
    .returning()
  const name = userDisplayName(next)
  if (name) await db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, row.userId))
  if (active) {
    const email = (await db.select({ email: user.email }).from(user).where(eq(user.id, row.userId)).limit(1))[0]?.email ?? ''
    const defaultRole = (await ssoDomains(c.workspaceId)).get(email.split('@')[1] ?? '') ?? 'viewer'
    await grantAccess(c, updated, defaultRole)
  }
  if (row.active !== active) await recordAudit(actor(c), { action: active ? 'PROVISION' : 'DEPROVISION', resource: 'member', resourceId: row.userId, changes: { scimId: row.id, userName, reactivated: active || undefined } })
  else await recordAudit(actor(c), { action: 'UPDATE', resource: 'member', resourceId: row.userId, changes: { scimId: row.id, via: 'scim' } })
  return userResource(c, updated, (await groupsOf(c.workspaceId, [updated.id])).get(updated.id))
}

const currentDoc = (row: ScimUserRow): UserDoc => ({ ...(row.attributes as Record<string, unknown>), userName: row.userName, ...(row.externalId ? { externalId: row.externalId } : {}), active: row.active })

export async function replaceUser(c: ScimCaller, id: string, body: unknown) {
  const row = await ownedUser(c, id)
  return saveUser(c, row, (body ?? {}) as UserDoc)
}

export async function patchUser(c: ScimCaller, id: string, ops: PatchOp[]) {
  const row = await ownedUser(c, id)
  return saveUser(c, row, applyUserPatch(currentDoc(row), ops))
}

export async function deleteUser(c: ScimCaller, id: string) {
  const row = await ownedUser(c, id)
  if (row.active) await revokeAccess(c, row)
  await db.delete(scimUsers).where(eq(scimUsers.id, row.id))
  // Drop them from every group of the workspace.
  const groups = await db.select().from(scimGroups).where(eq(scimGroups.workspaceId, c.workspaceId))
  for (const g of groups) {
    const members = (g.members as string[]) ?? []
    if (members.includes(row.id)) await db.update(scimGroups).set({ members: members.filter((m) => m !== row.id), updatedAt: new Date() }).where(eq(scimGroups.id, g.id))
  }
  await recordAudit(actor(c), { action: 'DEPROVISION', resource: 'member', resourceId: row.userId, changes: { scimId: row.id, userName: row.userName, deleted: true } })
}

// ── Groups ───────────────────────────────────────────────────────────────────

type GroupRow = typeof scimGroups.$inferSelect

async function groupResource(c: ScimCaller, g: GroupRow) {
  const ids = (g.members as string[]) ?? []
  const users = ids.length ? await db.select({ id: scimUsers.id, userName: scimUsers.userName }).from(scimUsers).where(and(eq(scimUsers.workspaceId, c.workspaceId), inArray(scimUsers.id, ids))) : []
  return {
    schemas: [SCHEMA.group],
    id: g.id,
    ...(g.externalId ? { externalId: g.externalId } : {}),
    displayName: g.displayName,
    members: users.map((u) => ({ value: u.id, display: u.userName, $ref: `${c.base}/Users/${u.id}` })),
    meta: { resourceType: 'Group', created: g.createdAt.toISOString(), lastModified: g.updatedAt.toISOString(), location: `${c.base}/Groups/${g.id}` },
  }
}

async function ownedGroup(c: ScimCaller, id: string) {
  const [g] = await db.select().from(scimGroups).where(and(eq(scimGroups.id, id), eq(scimGroups.workspaceId, c.workspaceId))).limit(1)
  if (!g) throw new ScimError(404, `Group ${id} not found.`)
  return g
}

/** Only ids of SCIM users of this workspace can be members. */
async function knownMembers(c: ScimCaller, ids: string[]) {
  if (!ids.length) return []
  const rows = await db.select({ id: scimUsers.id }).from(scimUsers).where(and(eq(scimUsers.workspaceId, c.workspaceId), inArray(scimUsers.id, ids)))
  const known = new Set(rows.map((r) => r.id))
  return ids.filter((id) => known.has(id))
}

/** Re-applies group roles to the given SCIM users (after membership or mapping changes). */
export async function refreshRoles(c: ScimCaller, scimIds: string[]) {
  if (!scimIds.length) return
  const rows = await db.select().from(scimUsers).where(and(eq(scimUsers.workspaceId, c.workspaceId), inArray(scimUsers.id, scimIds)))
  const domains = await ssoDomains(c.workspaceId)
  for (const row of rows) {
    if (!row.active) continue
    const email = (await db.select({ email: user.email }).from(user).where(eq(user.id, row.userId)).limit(1))[0]?.email ?? ''
    await grantAccess(c, row, domains.get(email.split('@')[1] ?? '') ?? 'viewer', true)
  }
}

export async function getGroup(c: ScimCaller, id: string) {
  return groupResource(c, await ownedGroup(c, id))
}

export async function listGroups(c: ScimCaller, params: URLSearchParams, startIndex: number, count: number) {
  const filter = parseFilter(params.get('filter'), ['displayName', 'externalId', 'id'])
  const where = [eq(scimGroups.workspaceId, c.workspaceId)]
  if (filter?.attribute === 'displayName') where.push(sql`lower(${scimGroups.displayName}) = lower(${filter.value})`)
  if (filter?.attribute === 'externalId') where.push(eq(scimGroups.externalId, filter.value))
  if (filter?.attribute === 'id') where.push(eq(scimGroups.id, filter.value))
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(scimGroups).where(and(...where))
  const rows = count ? await db.select().from(scimGroups).where(and(...where)).orderBy(scimGroups.createdAt, scimGroups.id).limit(count).offset(startIndex - 1) : []
  // "excludedAttributes=members" (Entra) keeps large groups cheap.
  const withMembers = !/members/i.test(params.get('excludedAttributes') ?? '')
  const resources = await Promise.all(rows.map(async (g) => (withMembers ? groupResource(c, g) : { ...(await groupResource(c, { ...g, members: [] })), members: undefined })))
  return listResponse(resources, total, startIndex)
}

export async function createGroup(c: ScimCaller, body: unknown) {
  const doc = (body ?? {}) as { displayName?: unknown; externalId?: unknown; members?: unknown }
  if (typeof doc.displayName !== 'string' || !doc.displayName.trim()) throw new ScimError(400, 'displayName is required.', 'invalidValue')
  const [taken] = await db.select({ id: scimGroups.id }).from(scimGroups).where(and(eq(scimGroups.workspaceId, c.workspaceId), sql`lower(${scimGroups.displayName}) = lower(${doc.displayName})`)).limit(1)
  if (taken) throw new ScimError(409, `A group named ${doc.displayName} already exists.`, 'uniqueness')
  const members = await knownMembers(c, applyGroupPatch({ displayName: doc.displayName, externalId: null, members: [] }, [{ op: 'add', path: 'members', value: doc.members ?? [] }]).members)
  const now = new Date()
  const [g] = await db
    .insert(scimGroups)
    .values({ id: randomUUID(), workspaceId: c.workspaceId, displayName: doc.displayName.trim(), externalId: typeof doc.externalId === 'string' ? doc.externalId : null, members, createdAt: now, updatedAt: now })
    .returning()
  await recordAudit(actor(c), { action: 'CREATE', resource: 'scim_group', resourceId: g.id, changes: { displayName: g.displayName, members: members.length } })
  return groupResource(c, g)
}

async function saveGroup(c: ScimCaller, g: GroupRow, next: { displayName: string; externalId: string | null; members: string[] }) {
  const members = await knownMembers(c, next.members)
  const before = (g.members as string[]) ?? []
  const [updated] = await db.update(scimGroups).set({ displayName: next.displayName.trim(), externalId: next.externalId, members, updatedAt: new Date() }).where(eq(scimGroups.id, g.id)).returning()
  const changed = [...before.filter((m) => !members.includes(m)), ...members.filter((m) => !before.includes(m))]
  // Removed members may lose the group's role: recompute from their remaining groups.
  if (g.role) await refreshRoles(c, changed)
  await recordAudit(actor(c), { action: 'UPDATE', resource: 'scim_group', resourceId: g.id, changes: { displayName: updated.displayName, added: members.filter((m) => !before.includes(m)).length, removed: before.filter((m) => !members.includes(m)).length } })
  return groupResource(c, updated)
}

export async function replaceGroup(c: ScimCaller, id: string, body: unknown) {
  const g = await ownedGroup(c, id)
  const doc = (body ?? {}) as { displayName?: unknown; externalId?: unknown; members?: unknown }
  const next = applyGroupPatch({ displayName: g.displayName, externalId: g.externalId, members: [] }, [
    { op: 'replace', path: 'displayName', value: doc.displayName ?? g.displayName },
    { op: 'replace', path: 'members', value: doc.members ?? [] },
  ])
  return saveGroup(c, g, { ...next, externalId: typeof doc.externalId === 'string' ? doc.externalId : g.externalId })
}

export async function patchGroup(c: ScimCaller, id: string, ops: PatchOp[]) {
  const g = await ownedGroup(c, id)
  return saveGroup(c, g, applyGroupPatch({ displayName: g.displayName, externalId: g.externalId, members: (g.members as string[]) ?? [] }, ops))
}

export async function deleteGroup(c: ScimCaller, id: string) {
  const g = await ownedGroup(c, id)
  await db.delete(scimGroups).where(eq(scimGroups.id, g.id))
  if (g.role) await refreshRoles(c, (g.members as string[]) ?? [])
  await recordAudit(actor(c), { action: 'DELETE', resource: 'scim_group', resourceId: g.id, changes: { displayName: g.displayName } })
}
