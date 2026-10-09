import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { workspaceMembers, workspaces } from '@/lib/db/schema'
import { can, deniedMessage, isRole, type Permission, type Role } from './permissions'

export const ACTIVE_WORKSPACE_COOKIE = 'nexus_ws'

/** Collision-free record id, e.g. newId('src') → "src_6f1c…". */
export function newId(prefix: string) {
  return `${prefix}_${randomUUID()}`
}

/** Signed-in user with 2FA set up, or throws. Two-factor authentication is mandatory (TD-2). */
async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  if (!session.user.twoFactorEnabled) throw new Error('Set up two-factor authentication first (reload the page).')
  return session.user
}

/**
 * For server pages: the signed-in user, or a redirect to sign-in (no session)
 * or to 2FA setup (no 2FA yet). nextPath is where to come back to afterwards.
 */
export async function requirePageUser(nextPath: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  const next = encodeURIComponent(nextPath)
  if (!session?.user) redirect(`/sign-in?next=${next}`)
  if (!session.user.twoFactorEnabled) redirect(`/setup-2fa?next=${next}`)
  return session.user
}

/** Returns the signed-in user's id or throws. Prefer requireWorkspace() for anything workspace data. */
export async function requireUserId() {
  return (await requireSession()).id
}

export interface WorkspaceContext {
  userId: string
  email: string
  name: string
  workspaceId: string
  workspaceName: string
  role: Role
}

/** Creates the user's personal workspace (they are admin). Used for brand-new accounts. */
async function createPersonalWorkspace(user: { id: string; name?: string | null; email: string }) {
  const workspaceId = `ws_${user.id}`
  const name = `${user.name?.trim() || user.email.split('@')[0]}'s workspace`
  await db.insert(workspaces).values({ id: workspaceId, name, createdBy: user.id }).onConflictDoNothing()
  await db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: 'admin' }).onConflictDoNothing()
  return workspaceId
}

/**
 * Resolves the signed-in user's active workspace (cookie, else their first
 * membership, else a new personal workspace) and optionally enforces a
 * permission. Every server action that touches workspace data starts here,
 * and every query is scoped by the returned workspaceId.
 */
export async function requireWorkspace(permission?: Permission): Promise<WorkspaceContext> {
  const user = await requireSession()
  const preferred = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role, name: workspaces.name })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, user.id))
    .orderBy(asc(workspaceMembers.createdAt))

  let current = memberships.find((m) => m.workspaceId === preferred) ?? memberships[0]
  if (!current) {
    const workspaceId = await createPersonalWorkspace(user)
    const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
    current = { workspaceId, role: 'admin', name: ws?.name ?? 'My workspace' }
  }
  if (!isRole(current.role)) throw new Error('Your membership has an unknown role. Ask a workspace admin to fix it.')

  const ctx: WorkspaceContext = {
    userId: user.id,
    email: user.email,
    name: user.name ?? '',
    workspaceId: current.workspaceId,
    workspaceName: current.name,
    role: current.role,
  }
  if (permission && !can(ctx.role, permission)) throw new Error(deniedMessage(ctx.role, permission))
  return ctx
}

/** Membership check for a specific workspace (used when switching). */
export async function getMembership(userId: string, workspaceId: string) {
  const [m] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1)
  return m && isRole(m.role) ? m.role : null
}
