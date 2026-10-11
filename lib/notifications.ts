import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notifications, user, workspaceMembers } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'
import { appUrl, sendEmail as deliver, smtpConfigured } from '@/lib/email'

/**
 * In-app notifications (bell icon) + optional email over SMTP (lib/email.ts).
 * When SMTP isn't configured the email is skipped and only the bell shows it.
 */

export type NotificationLevel = 'error' | 'warning' | 'info'

async function sendEmail(to: string[], subject: string, lines: string[]): Promise<'sent' | 'skipped' | 'failed'> {
  if (!smtpConfigured() || !to.length) return 'skipped'
  try {
    await deliver({ to, subject, lines, action: { label: 'Open KMPlus Nexus', url: `${appUrl()}/dashboard` } })
    return 'sent'
  } catch (err) {
    console.error('[notifications] email failed:', err instanceof Error ? err.message : err)
    return 'failed'
  }
}

export async function notify(opts: {
  /** Recipient. */
  userId: string
  workspaceId: string
  level: NotificationLevel
  title: string
  lines: string[]
  pipelineId?: string
  runId?: string
  /** Send email too. Empty list = the user's own address. */
  email?: { to: string[] }
}) {
  let emailStatus: string | null = null
  if (opts.email) {
    let to = opts.email.to
    if (!to.length) {
      const [owner] = await db.select({ email: user.email }).from(user).where(eq(user.id, opts.userId)).limit(1)
      to = owner?.email ? [owner.email] : []
    }
    emailStatus = await sendEmail(to, `[Nexus] ${opts.title}`, opts.lines)
  }
  await db.insert(notifications).values({
    id: newId('ntf'),
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    level: opts.level,
    title: opts.title,
    body: opts.lines.join('\n'),
    pipelineId: opts.pipelineId,
    runId: opts.runId,
    emailStatus,
  })
  return { emailStatus }
}

/**
 * Business rule "notify" action: a bell notification for the workspace's
 * admins and data stewards, and one email to the rule's recipients (or to
 * those members when the rule lists none).
 */
export async function notifyRule(opts: { scope: { workspaceId: string; actorId: string }; pipelineId: string; runId: string; title: string; message: string; emails: string[] }) {
  const members = await db
    .select({ userId: workspaceMembers.userId, email: user.email })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, opts.scope.workspaceId), inArray(workspaceMembers.role, ['admin', 'steward'])))
  const to = opts.emails.length ? opts.emails : members.map((m) => m.email)
  const lines = [opts.message, `Pipeline run ${opts.runId}`]
  for (const [i, m] of members.entries()) {
    await notify({
      userId: m.userId,
      workspaceId: opts.scope.workspaceId,
      level: 'info',
      title: opts.title,
      lines,
      pipelineId: opts.pipelineId,
      runId: opts.runId,
      email: i === 0 && to.length ? { to } : undefined,
    })
  }
}
