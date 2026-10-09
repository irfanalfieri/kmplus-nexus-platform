import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Outgoing email over SMTP (TD-4). Works with any SMTP provider; we use the
 * company mail server (mail.kmplus.co.id:465, mailbox noreply@kmplus.co.id).
 *
 *   SMTP_HOST, SMTP_PORT (587 STARTTLS or 465 TLS), SMTP_USER, SMTP_PASSWORD
 *   EMAIL_FROM   e.g. "KMPlus Nexus <noreply@kmplus.co.id>" (must be the SMTP_USER mailbox)
 *
 * Without SMTP_HOST, development prints emails to the server console and
 * production refuses to send (emailEnabled() is false, so sign-up verification
 * is off and invites fall back to copy-paste links).
 */

let transporter: Transporter | null = null

export function smtpConfigured() {
  // A login without its password counts as not configured, so verification isn't required before mail can go out.
  return Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM && (!process.env.SMTP_USER || process.env.SMTP_PASSWORD))
}

/** True when emails actually reach people, or are printed in local development. */
export function emailEnabled() {
  return smtpConfigured() || process.env.NODE_ENV !== 'production'
}

function transport() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587)
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      // mail.kmplus.co.id is sometimes slow to accept connections.
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 30_000,
    })
  }
  return transporter
}

export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '')
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return 'http://localhost:3000'
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface EmailMessage {
  to: string | string[]
  subject: string
  /** Paragraphs of plain text. */
  lines: string[]
  /** Optional call-to-action button. */
  action?: { label: string; url: string }
}

function render({ lines, action }: EmailMessage) {
  const text = [...lines, ...(action ? ['', `${action.label}: ${action.url}`] : [])].join('\n')
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#111;max-width:560px">
${lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join('\n')}
${action ? `<p style="margin:20px 0"><a href="${escapeHtml(action.url)}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p><p style="margin:0;font-size:12px;color:#666">Or paste this link into your browser: ${escapeHtml(action.url)}</p>` : ''}
<p style="margin:24px 0 0;font-size:12px;color:#666">KMPlus Nexus</p>
</div>`
  return { text, html }
}

/** Sends an email. Throws if delivery fails, so callers can decide what to do. */
export async function sendEmail(message: EmailMessage): Promise<'sent' | 'logged'> {
  const to = Array.isArray(message.to) ? message.to : [message.to]
  if (!to.length) throw new Error('No recipient.')
  const { text, html } = render(message)
  if (!smtpConfigured()) {
    if (process.env.NODE_ENV === 'production') throw new Error('Email is not configured (SMTP_HOST / EMAIL_FROM).')
    console.info(`\n[email:dev] To: ${to.join(', ')}\n[email:dev] Subject: ${message.subject}\n${text}\n`)
    return 'logged'
  }
  await transport().sendMail({ from: process.env.EMAIL_FROM, to, subject: message.subject, text, html })
  return 'sent'
}
