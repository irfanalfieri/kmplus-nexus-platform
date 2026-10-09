'use server'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { and, asc, desc, eq, gt, isNull, like, sql } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { session, twoFactor, user, verification, workspaceInvites, workspaceMembers, workspaces } from '@/lib/db/schema'
import { ACTIVE_WORKSPACE_COOKIE, getMembership, newId, requireUserId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { ROLE_INFO, ROLES, type Role } from '@/lib/auth/permissions'
import { recordAudit, type AuditAction } from '@/lib/audit'
import { appUrl, sendEmail, smtpConfigured } from '@/lib/email'
import { guard } from '@/lib/server-action'

const roleSchema = z.enum(ROLES)
const idSchema = z.string().trim().min(1).max(100)
const nameSchema = z.string().trim().min(1, 'Name is required').max(80)
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

async function audit(ctx: WorkspaceContext, action: AuditAction, resourceId: string, changes?: Record<string, unknown>) {
  await recordAudit(ctx, { action, resource: 'workspace', resourceId, changes })
}

async function setActiveWorkspace(workspaceId: string) {
  ;(await cookies()).set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
}

async function adminCount(workspaceId: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'admin')))
  return n
}

// ── Context & switching ──────────────────────────────────────────────────────

/** Current workspace, the user's role in it, and every workspace they belong to. */
async function getWorkspaceContextImpl() {
  const ctx = await requireWorkspace()
  const mine = await db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, ctx.userId))
    .orderBy(asc(workspaces.name))
  return {
    user: { id: ctx.userId, email: ctx.email, name: ctx.name },
    workspace: { id: ctx.workspaceId, name: ctx.workspaceName },
    role: ctx.role,
    workspaces: mine.map((w) => ({ ...w, role: w.role as Role })),
  }
}

async function switchWorkspaceImpl(rawId: string) {
  const userId = await requireUserId()
  const workspaceId = idSchema.parse(rawId)
  if (!(await getMembership(userId, workspaceId))) throw new Error('You are not a member of that workspace.')
  await setActiveWorkspace(workspaceId)
  revalidatePath('/dashboard')
}

async function createWorkspaceImpl(rawName: string) {
  const userId = await requireUserId()
  const name = nameSchema.parse(rawName)
  const id = newId('ws')
  await db.insert(workspaces).values({ id, name, createdBy: userId })
  await db.insert(workspaceMembers).values({ workspaceId: id, userId, role: 'admin' })
  await recordAudit({ userId, workspaceId: id }, { action: 'CREATE', resource: 'workspace', resourceId: id, changes: { name } })
  await setActiveWorkspace(id)
  revalidatePath('/dashboard')
  return { id }
}

async function renameWorkspaceImpl(rawName: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const name = nameSchema.parse(rawName)
  await db.update(workspaces).set({ name, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId))
  await audit(ctx, 'RENAME', ctx.workspaceId, { name })
  revalidatePath('/dashboard')
}

// ── Members ──────────────────────────────────────────────────────────────────

async function listMembersImpl() {
  const ctx = await requireWorkspace()
  const members = await db
    .select({ userId: workspaceMembers.userId, role: workspaceMembers.role, joinedAt: workspaceMembers.createdAt, email: user.email, name: user.name, twoFactorEnabled: user.twoFactorEnabled })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
    .orderBy(asc(user.email))
  return members.map((m) => ({ ...m, role: m.role as Role, isYou: m.userId === ctx.userId }))
}

async function changeMemberRoleImpl(rawUserId: string, rawRole: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const userId = idSchema.parse(rawUserId)
  const role = roleSchema.parse(rawRole)
  const current = await getMembership(userId, ctx.workspaceId)
  if (!current) throw new Error('That user is not a member of this workspace.')
  if (current === 'admin' && role !== 'admin' && (await adminCount(ctx.workspaceId)) <= 1) {
    throw new Error('A workspace needs at least one admin. Make someone else admin first.')
  }
  await db
    .update(workspaceMembers)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)))
  await audit(ctx, 'CHANGE_ROLE', userId, { from: current, to: role })
  revalidatePath('/dashboard')
}

/**
 * Admin recovery for a member who lost their authenticator and backup codes
 * (TD-19): turns their 2FA off, signs them out everywhere and forgets trusted
 * devices. At their next sign-in (password) they must enroll 2FA again.
 */
async function resetMemberTwoFactorImpl(rawUserId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const userId = idSchema.parse(rawUserId)
  if (userId === ctx.userId) throw new Error('Use "Set up on a new device" under Your account security to change your own 2FA.')
  if (!(await getMembership(userId, ctx.workspaceId))) throw new Error('That user is not a member of this workspace.')
  const [target] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
  await db.transaction(async (tx) => {
    await tx.update(user).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(user.id, userId))
    await tx.delete(twoFactor).where(eq(twoFactor.userId, userId))
    await tx.delete(session).where(eq(session.userId, userId))
    // "Trust this device" records would otherwise skip the code after re-enrollment.
    await tx.delete(verification).where(and(eq(verification.value, userId), like(verification.identifier, 'trust-device-%')))
  })
  await audit(ctx, 'RESET_2FA', userId, { email: target?.email })
  if (target?.email && smtpConfigured()) {
    await sendEmail({
      to: target.email,
      subject: 'Your KMPlus Nexus two-factor authentication was reset',
      lines: [
        `${ctx.name || ctx.email}, an admin of "${ctx.workspaceName}", reset two-factor authentication on your account and signed you out.`,
        'Sign in with your password and set up an authenticator app again.',
        "If you didn't ask for this, contact your admin right away.",
      ],
      action: { label: 'Sign in', url: `${appUrl()}/sign-in` },
    }).catch((err) => console.error('[2fa-reset] email failed:', err instanceof Error ? err.message : err))
  }
  revalidatePath('/dashboard')
}

/** Removes a member (admins), or leaves the workspace (anyone, for themselves). */
async function removeMemberImpl(rawUserId: string) {
  const ctx = await requireWorkspace()
  const userId = idSchema.parse(rawUserId)
  const self = userId === ctx.userId
  if (!self && ctx.role !== 'admin') throw new Error('Only admins can remove other members.')
  const current = await getMembership(userId, ctx.workspaceId)
  if (!current) throw new Error('That user is not a member of this workspace.')
  if (current === 'admin' && (await adminCount(ctx.workspaceId)) <= 1) {
    throw new Error('A workspace needs at least one admin. Make someone else admin first.')
  }
  await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)))
  await audit(ctx, self ? 'LEAVE' : 'REMOVE_MEMBER', userId, { role: current })
  if (self) (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE)
  revalidatePath('/dashboard')
}

// ── Invites (one-time links, emailed when SMTP is configured) ───────────────

/**
 * Creates an invite, emails the link when SMTP is configured, and returns the
 * link path so the admin can also copy it. Only the token hash is stored.
 */
async function createInviteImpl(rawEmail: string, rawRole: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const email = z.string().trim().toLowerCase().email('Enter a valid email').parse(rawEmail)
  const role = roleSchema.parse(rawRole)
  const [existingMember] = await db
    .select({ userId: user.id })
    .from(user)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.workspaceId, ctx.workspaceId)))
    .where(eq(sql`lower(${user.email})`, email))
    .limit(1)
  if (existingMember) throw new Error(`${email} is already a member.`)

  const token = randomBytes(24).toString('base64url')
  const id = newId('inv')
  await db.insert(workspaceInvites).values({
    id,
    workspaceId: ctx.workspaceId,
    email,
    role,
    tokenHash: hashToken(token),
    invitedBy: ctx.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  })
  const path = `/invite/${token}`
  let emailed = false
  if (smtpConfigured()) {
    try {
      await sendEmail({
        to: email,
        subject: `${ctx.name || ctx.email} invited you to ${ctx.workspaceName} on KMPlus Nexus`,
        lines: [
          `${ctx.name || ctx.email} invited you to join the workspace "${ctx.workspaceName}" on KMPlus Nexus as ${ROLE_INFO[role].label}.`,
          `Sign in or create an account with this email address (${email}) to accept. The link works once and expires in 7 days.`,
        ],
        action: { label: 'Accept invite', url: `${appUrl()}${path}` },
      })
      emailed = true
    } catch (err) {
      console.error('[invite] email failed:', err instanceof Error ? err.message : err)
    }
  }
  await audit(ctx, 'INVITE', id, { email, role, emailed })
  revalidatePath('/dashboard')
  return { path, email, role, emailed }
}

async function listInvitesImpl() {
  const ctx = await requireWorkspace('workspace:manage')
  return db
    .select({ id: workspaceInvites.id, email: workspaceInvites.email, role: workspaceInvites.role, expiresAt: workspaceInvites.expiresAt, createdAt: workspaceInvites.createdAt })
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, ctx.workspaceId),
        isNull(workspaceInvites.acceptedAt),
        isNull(workspaceInvites.revokedAt),
        gt(workspaceInvites.expiresAt, new Date())
      )
    )
    .orderBy(desc(workspaceInvites.createdAt))
}

async function revokeInviteImpl(rawId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const id = idSchema.parse(rawId)
  await db
    .update(workspaceInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(workspaceInvites.id, id), eq(workspaceInvites.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'REVOKE_INVITE', id)
  revalidatePath('/dashboard')
}

async function findValidInvite(token: string) {
  const [invite] = await db
    .select({ id: workspaceInvites.id, workspaceId: workspaceInvites.workspaceId, email: workspaceInvites.email, role: workspaceInvites.role, workspaceName: workspaces.name })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .where(
      and(
        eq(workspaceInvites.tokenHash, hashToken(token)),
        isNull(workspaceInvites.acceptedAt),
        isNull(workspaceInvites.revokedAt),
        gt(workspaceInvites.expiresAt, new Date())
      )
    )
    .limit(1)
  return invite ?? null
}

/** For the invite page: what the link is for (no secrets). */
async function describeInviteImpl(rawToken: string) {
  const token = z.string().min(10).max(200).parse(rawToken)
  const invite = await findValidInvite(token)
  if (!invite) return null
  return { workspaceName: invite.workspaceName, email: invite.email, role: invite.role as Role }
}

/** Accepts an invite. The signed-in account's email must match the invited email. */
async function acceptInviteImpl(rawToken: string) {
  const userId = await requireUserId()
  const token = z.string().min(10).max(200).parse(rawToken)
  const invite = await findValidInvite(token)
  if (!invite) throw new Error('This invite link is invalid, expired, revoked or already used.')
  const [me] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
  if (me?.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new Error(`This invite is for ${invite.email}. Sign in with that account to accept it.`)
  }
  const role = roleSchema.parse(invite.role)
  if (!(await getMembership(userId, invite.workspaceId))) {
    await db.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId, role })
  }
  await db.update(workspaceInvites).set({ acceptedAt: new Date(), acceptedBy: userId }).where(eq(workspaceInvites.id, invite.id))
  await recordAudit({ userId, workspaceId: invite.workspaceId }, { action: 'ACCEPT_INVITE', resource: 'workspace', resourceId: invite.id, changes: { role } })
  await setActiveWorkspace(invite.workspaceId)
  revalidatePath('/dashboard')
  return { workspaceName: invite.workspaceName }
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/workspaces.ts. ──

export async function getWorkspaceContext(...args: Parameters<typeof getWorkspaceContextImpl>) {
  return guard(() => getWorkspaceContextImpl(...args))
}

export async function switchWorkspace(...args: Parameters<typeof switchWorkspaceImpl>) {
  return guard(() => switchWorkspaceImpl(...args))
}

export async function createWorkspace(...args: Parameters<typeof createWorkspaceImpl>) {
  return guard(() => createWorkspaceImpl(...args))
}

export async function renameWorkspace(...args: Parameters<typeof renameWorkspaceImpl>) {
  return guard(() => renameWorkspaceImpl(...args))
}

export async function listMembers(...args: Parameters<typeof listMembersImpl>) {
  return guard(() => listMembersImpl(...args))
}

export async function changeMemberRole(...args: Parameters<typeof changeMemberRoleImpl>) {
  return guard(() => changeMemberRoleImpl(...args))
}

export async function resetMemberTwoFactor(...args: Parameters<typeof resetMemberTwoFactorImpl>) {
  return guard(() => resetMemberTwoFactorImpl(...args))
}

export async function removeMember(...args: Parameters<typeof removeMemberImpl>) {
  return guard(() => removeMemberImpl(...args))
}

export async function createInvite(...args: Parameters<typeof createInviteImpl>) {
  return guard(() => createInviteImpl(...args))
}

export async function listInvites(...args: Parameters<typeof listInvitesImpl>) {
  return guard(() => listInvitesImpl(...args))
}

export async function revokeInvite(...args: Parameters<typeof revokeInviteImpl>) {
  return guard(() => revokeInviteImpl(...args))
}

export async function describeInvite(...args: Parameters<typeof describeInviteImpl>) {
  return guard(() => describeInviteImpl(...args))
}

export async function acceptInvite(...args: Parameters<typeof acceptInviteImpl>) {
  return guard(() => acceptInviteImpl(...args))
}
