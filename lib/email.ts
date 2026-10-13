import nodemailer, { type Transporter } from 'nodemailer'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config'
import { createTranslator } from '@/lib/i18n/translate'

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
 *
 * Every email uses one branded layout (render() below): the KM+ logo on the
 * teal-100 band, a teal line, a white card, one teal button, a plain-text twin.
 * Copy lives in lib/i18n/messages/{en,id}/email.ts; lib/email-templates.ts builds the messages.
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

export type EmailTone = 'danger' | 'warning' | 'held' | 'live' | 'info'

export interface EmailMessage {
  to: string | string[]
  subject: string
  /** Paragraphs of plain text. */
  lines: string[]
  /** Optional call-to-action button. */
  action?: { label: string; url: string }
  /** Big title in the card (defaults to the subject). */
  heading?: string
  /** Hidden preview text shown by mail clients next to the subject. */
  preheader?: string
  /** A status mark above the heading, e.g. a failed run. Always words, never colour alone. */
  status?: { tone: EmailTone; label: string }
  /** Label → value rows (pipeline, run, role…). Values in mono when `mono`. */
  details?: { label: string; value: string; mono?: boolean }[]
  /** A quieter last paragraph (e.g. "If you didn't sign up, ignore this email."). */
  note?: string
  /** Language of the layout's own words. */
  locale?: Locale
}

// KM+ tokens (DESIGN.md), as literal values: email clients don't read CSS variables.
const C = {
  board: '#f2f4f8',
  rail: '#081a1c',
  signal: '#3ddbd9',
  card: '#ffffff',
  rule: '#dde1e6',
  ink: '#121619',
  body: '#343a3f',
  muted: '#5f666d',
  primary: '#007d79',
  link: '#0072c3',
}
const TONE: Record<EmailTone, { mark: string; text: string; soft: string }> = {
  danger: { mark: '#da1e28', text: '#a2191f', soft: '#fff1f1' },
  warning: { mark: '#b28600', text: '#8e6a00', soft: '#fcf4d6' },
  held: { mark: '#8a3ffc', text: '#6929c4', soft: '#f6f2ff' },
  live: { mark: '#009d9a', text: '#005d5d', soft: '#e3f7f6' },
  info: { mark: '#0072c3', text: '#0072c3', soft: '#e5f6ff' },
}
const SANS = "'IBM Plex Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "'IBM Plex Mono',Consolas,'Courier New',monospace"

export function render(message: EmailMessage) {
  const t = createTranslator(message.locale ?? DEFAULT_LOCALE)
  const { lines, action, details, status, note } = message
  const heading = message.heading ?? message.subject
  const url = appUrl()

  const text = [
    heading,
    '',
    ...(status ? [`[${status.label}]`, ''] : []),
    ...lines.flatMap((l) => [l, '']),
    ...(details?.length ? [...details.map((d) => `${d.label}: ${d.value}`), ''] : []),
    ...(action ? [`${action.label}: ${action.url}`, ''] : []),
    ...(note ? [note, ''] : []),
    '—',
    'KMPlus Nexus',
    t('email.chrome.automated'),
  ].join('\n')

  const p = (s: string) => `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.body}">${escapeHtml(s)}</p>`
  const statusHtml = status
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px"><tr>
<td style="background:${TONE[status.tone].soft};border:1px solid ${TONE[status.tone].mark};border-radius:2px;padding:4px 10px 4px 8px;font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;color:${TONE[status.tone].text}">
<span style="display:inline-block;width:9px;height:9px;background:${TONE[status.tone].mark};margin-right:7px;vertical-align:-1px"></span>${escapeHtml(status.label)}</td></tr></table>`
    : ''
  const detailsHtml = details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border-top:1px solid ${C.rule}">${details
        .map(
          (d) => `<tr>
<td valign="top" style="padding:9px 12px 9px 0;border-bottom:1px solid ${C.rule};width:34%;font-family:${MONO};font-size:11px;line-height:18px;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}">${escapeHtml(d.label)}</td>
<td valign="top" style="padding:9px 0;border-bottom:1px solid ${C.rule};font-family:${d.mono ? MONO : SANS};font-size:${d.mono ? 13 : 14}px;line-height:20px;color:${C.ink};word-break:break-word">${escapeHtml(d.value)}</td></tr>`,
        )
        .join('')}</table>`
    : ''
  const actionHtml = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr>
<td bgcolor="${C.primary}" style="border-radius:3px;background:${C.primary}">
<a href="${escapeHtml(action.url)}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:3px">${escapeHtml(action.label)}</a></td></tr></table>
<p style="margin:0 0 6px;font-family:${SANS};font-size:12px;line-height:18px;color:${C.muted}">${escapeHtml(t('email.chrome.orPaste'))}</p>
<p style="margin:0 0 20px;font-family:${MONO};font-size:12px;line-height:18px;word-break:break-all"><a href="${escapeHtml(action.url)}" style="color:${C.link};text-decoration:underline">${escapeHtml(action.url)}</a></p>`
    : ''
  const noteHtml = note ? `<p style="margin:4px 0 0;padding-top:16px;border-top:1px solid ${C.rule};font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted}">${escapeHtml(note)}</p>` : ''

  const html = `<!doctype html>
<html lang="${message.locale ?? DEFAULT_LOCALE}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(message.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.board};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.board}">${escapeHtml(message.preheader ?? lines[0] ?? '')}&#8202;&#847;&#8202;&#847;&#8202;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.board}" style="background:${C.board}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">
<tr><td bgcolor="${C.rail}" style="background:${C.rail};padding:22px 32px;border-radius:4px 4px 0 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="bottom"><img src="${url}/brand/kmplus-logo-on-dark.png" width="74" height="40" alt="KMPlus" style="display:block;border:0;width:74px;height:40px"></td>
<td valign="bottom" style="padding:0 0 3px 12px;font-family:${SANS};font-size:18px;line-height:20px;font-weight:300;letter-spacing:.04em;color:#f2f4f8">${escapeHtml(t('email.chrome.product'))}</td>
</tr></table></td></tr>
<tr><td height="3" bgcolor="${C.signal}" style="background:${C.signal};height:3px;line-height:3px;font-size:0">&nbsp;</td></tr>
<tr><td bgcolor="${C.card}" style="background:${C.card};padding:32px 32px 28px;border:1px solid ${C.rule};border-top:0;border-radius:0 0 4px 4px">
${statusHtml}
<h1 style="margin:0 0 18px;font-family:${SANS};font-size:22px;line-height:30px;font-weight:600;color:${C.ink}">${escapeHtml(heading)}</h1>
${lines.map(p).join('\n')}
${detailsHtml}
${actionHtml}
${noteHtml}
</td></tr>
<tr><td style="padding:20px 32px 8px;font-family:${SANS};font-size:12px;line-height:18px;color:${C.muted}">
<p style="margin:0 0 6px">${escapeHtml(t('email.chrome.automated'))}</p>
<p style="margin:0">${escapeHtml(t('email.chrome.reason', { url: url.replace(/^https?:\/\//, '') }))} &middot; <a href="${url}" style="color:${C.link};text-decoration:none">${escapeHtml(t('email.chrome.openApp'))}</a></p>
</td></tr>
</table></td></tr></table>
</body></html>`
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
