'use server'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { scimGroups, scimTokens, scimUsers, user } from '@/lib/db/schema'
import { newId, requireWorkspace } from '@/lib/auth/session'
import { ROLES } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { diffObjects } from '@/lib/audit-diff'
import { refreshRoles } from '@/lib/scim/store'
import { guard } from '@/lib/server-action'

/**
 * SCIM provisioning settings (GV-8): admins create the token the identity
 * provider uses, see who it provisioned, and map IdP groups to Nexus roles.
 */

const idSchema = z.string().trim().min(1).max(100)

async function scimBaseUrl() {
  const configured = process.env.BETTER_AUTH_URL?.replace(/\/+$/, '')
  if (configured) return `${configured}/api/scim/v2`
  const h = await headers()
  return `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}/api/scim/v2`
}

async function getScimOverviewImpl() {
  const ctx = await requireWorkspace('workspace:manage')
  const [tokens, users, groups] = await Promise.all([
    db
      .select({ id: scimTokens.id, name: scimTokens.name, prefix: scimTokens.prefix, createdAt: scimTokens.createdAt, lastUsedAt: scimTokens.lastUsedAt, revokedAt: scimTokens.revokedAt, createdBy: user.email })
      .from(scimTokens)
      .leftJoin(user, eq(user.id, scimTokens.createdBy))
      .where(eq(scimTokens.workspaceId, ctx.workspaceId))
      .orderBy(desc(scimTokens.createdAt)),
    db
      .select({ id: scimUsers.id, userName: scimUsers.userName, active: scimUsers.active, updatedAt: scimUsers.updatedAt, email: user.email })
      .from(scimUsers)
      .innerJoin(user, eq(user.id, scimUsers.userId))
      .where(eq(scimUsers.workspaceId, ctx.workspaceId))
      .orderBy(desc(scimUsers.updatedAt))
      .limit(200),
    db.select().from(scimGroups).where(eq(scimGroups.workspaceId, ctx.workspaceId)).orderBy(scimGroups.displayName),
  ])
  return {
    baseUrl: await scimBaseUrl(),
    tokens,
    users,
    groups: groups.map((g) => ({ id: g.id, displayName: g.displayName, role: g.role, members: ((g.members as string[]) ?? []).length })),
  }
}

const tokenName = z.string().trim().min(1, 'Name the token, e.g. "Entra ID provisioning"').max(80)

/** Creates a SCIM token and returns it once; only its hash is stored. */
async function createScimTokenImpl(rawName: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const name = tokenName.parse(rawName)
  const token = `nxs_${randomBytes(32).toString('base64url')}`
  const id = newId('scimt')
  await db.insert(scimTokens).values({ id, workspaceId: ctx.workspaceId, name, prefix: token.slice(0, 10), hash: createHash('sha256').update(token).digest('hex'), createdBy: ctx.userId })
  await recordAudit(ctx, { action: 'CREATE', resource: 'scim_token', resourceId: id, changes: { name } })
  revalidatePath('/dashboard')
  return { id, token, baseUrl: await scimBaseUrl() }
}

async function revokeScimTokenImpl(rawId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const id = idSchema.parse(rawId)
  const res = await db
    .update(scimTokens)
    .set({ revokedAt: new Date(), revokedBy: ctx.userId })
    .where(and(eq(scimTokens.id, id), eq(scimTokens.workspaceId, ctx.workspaceId), isNull(scimTokens.revokedAt)))
    .returning({ name: scimTokens.name })
  if (!res.length) throw new Error('Token not found or already revoked')
  await recordAudit(ctx, { action: 'REVOKE', resource: 'scim_token', resourceId: id, changes: { name: res[0].name } })
  revalidatePath('/dashboard')
}

const groupRoleInput = z.object({ groupId: idSchema, role: z.enum(ROLES).nullable() })

/** Members of the group get this role (the highest of their mapped groups); null = the group doesn't set roles. */
async function setScimGroupRoleImpl(input: z.input<typeof groupRoleInput>) {
  const ctx = await requireWorkspace('workspace:manage')
  const data = groupRoleInput.parse(input)
  const [g] = await db.select().from(scimGroups).where(and(eq(scimGroups.id, data.groupId), eq(scimGroups.workspaceId, ctx.workspaceId))).limit(1)
  if (!g) throw new Error('Group not found')
  await db.update(scimGroups).set({ role: data.role, updatedAt: new Date() }).where(eq(scimGroups.id, g.id))
  await refreshRoles({ workspaceId: ctx.workspaceId, tokenId: 'settings', base: '' }, (g.members as string[]) ?? [])
  await recordAudit(ctx, { action: 'UPDATE', resource: 'scim_group', resourceId: g.id, changes: { displayName: g.displayName }, diff: diffObjects({ role: g.role }, { role: data.role }) })
  revalidatePath('/dashboard')
}

export async function getScimOverview(...args: Parameters<typeof getScimOverviewImpl>) {
  return guard(() => getScimOverviewImpl(...args))
}

export async function createScimToken(...args: Parameters<typeof createScimTokenImpl>) {
  return guard(() => createScimTokenImpl(...args))
}

export async function revokeScimToken(...args: Parameters<typeof revokeScimTokenImpl>) {
  return guard(() => revokeScimTokenImpl(...args))
}

export async function setScimGroupRole(...args: Parameters<typeof setScimGroupRoleImpl>) {
  return guard(() => setScimGroupRoleImpl(...args))
}
