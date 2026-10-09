import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notifications, user } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'

/**
 * In-app notifications (bell icon) + optional email via Resend.
 * Email needs RESEND_API_KEY; sender from ALERT_FROM_EMAIL
 * (default "KMPlus Nexus <onboarding@resend.dev>", Resend's test sender, which
 * only delivers to the Resend account owner until a domain is verified).
 */

export type NotificationLevel = 'error' | 'warning' | 'info'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '')
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return 'http://localhost:3000'
}

async function sendEmail(to: string[], subject: string, lines: string[]): Promise<'sent' | 'skipped' | 'failed'> {
  const key = process.env.RESEND_API_KEY
  if (!key || !to.length) return 'skipped'
  const link = `${appUrl()}/dashboard`
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ALERT_FROM_EMAIL || 'KMPlus Nexus <onboarding@resend.dev>',
        to,
        subject,
        text: [...lines, '', `Open KMPlus Nexus: ${link}`].join('\n'),
        html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${lines
          .map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`)
          .join('')}<p><a href="${link}">Open KMPlus Nexus</a></p></div>`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      console.error('[notifications] Resend responded', response.status, (await response.text()).slice(0, 200))
      return 'failed'
    }
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
