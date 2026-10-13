import { DEFAULT_LOCALE, LOCALE_INFO, type Locale } from '@/lib/i18n/config'
import { createTranslator } from '@/lib/i18n/translate'
import { appUrl, type EmailMessage, type EmailTone } from '@/lib/email'

/**
 * The emails Nexus sends, built from lib/i18n/messages/{en,id}/email.ts and
 * rendered by lib/email.ts. The language follows the person who triggered the
 * email when there is a request (their `nexus_lang` cookie), else English.
 */

export async function requestLocale(): Promise<Locale> {
  try {
    const { getLocale } = await import('@/lib/i18n/server')
    return await getLocale()
  } catch {
    // Background work (cron, worker) has no request and no cookie.
    return DEFAULT_LOCALE
  }
}

type Draft = Omit<EmailMessage, 'to'>

export function verifyEmail(opts: { name: string; url: string; locale: Locale }): Draft {
  const t = createTranslator(opts.locale)
  return {
    locale: opts.locale,
    subject: t('email.verify.subject'),
    preheader: t('email.verify.preheader'),
    heading: t('email.verify.heading'),
    lines: [t('email.verify.greeting', { name: opts.name }), t('email.verify.body'), t('email.verify.next')],
    action: { label: t('email.verify.action'), url: opts.url },
    note: `${t('email.verify.expires')} ${t('email.verify.ignore')}`,
  }
}

export function inviteEmail(opts: { inviter: string; workspace: string; role: string; email: string; url: string; locale: Locale }): Draft {
  const t = createTranslator(opts.locale)
  return {
    locale: opts.locale,
    subject: t('email.invite.subject', { inviter: opts.inviter, workspace: opts.workspace }),
    preheader: t('email.invite.preheader', { workspace: opts.workspace }),
    heading: t('email.invite.heading', { workspace: opts.workspace }),
    lines: [t('email.invite.body', { inviter: opts.inviter })],
    details: [
      { label: t('email.invite.workspace'), value: opts.workspace },
      { label: t('email.invite.role'), value: opts.role },
      { label: t('email.invite.invitedBy'), value: opts.inviter },
    ],
    action: { label: t('email.invite.action'), url: opts.url },
    note: t('email.invite.howTo', { email: opts.email }),
  }
}

export function twoFactorResetEmail(opts: { admin: string; workspace: string; locale: Locale }): Draft {
  const t = createTranslator(opts.locale)
  return {
    locale: opts.locale,
    subject: t('email.reset2fa.subject'),
    preheader: t('email.reset2fa.preheader'),
    heading: t('email.reset2fa.heading'),
    status: { tone: 'warning', label: t('email.reset2fa.heading') },
    lines: [t('email.reset2fa.body', { admin: opts.admin, workspace: opts.workspace }), t('email.reset2fa.next')],
    action: { label: t('email.reset2fa.action'), url: `${appUrl()}/sign-in` },
    note: t('email.reset2fa.warn'),
  }
}

const LEVEL_TONE: Record<'error' | 'warning' | 'info', EmailTone> = { error: 'danger', warning: 'warning', info: 'info' }

/**
 * An alert from the bell (failed run, rejected rows, approval request). Lines
 * shaped "Label: value" become the details table; the rest stay paragraphs.
 */
export function alertEmail(opts: { title: string; lines: string[]; level: 'error' | 'warning' | 'info'; pipelineId?: string; locale: Locale }): Draft {
  const t = createTranslator(opts.locale)
  const details: { label: string; value: string; mono?: boolean }[] = []
  const paragraphs: string[] = []
  for (const line of opts.lines) {
    const m = /^([A-Z][A-Za-z ]{1,18}): (.+)$/.exec(line)
    if (!m) {
      paragraphs.push(line)
      continue
    }
    // ISO times read as a WIB date in the reader's language.
    const iso = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(m[2]) ? new Date(m[2]) : null
    const value = iso && !Number.isNaN(iso.getTime()) ? `${new Intl.DateTimeFormat(LOCALE_INFO[opts.locale].intl, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(iso)} WIB` : m[2]
    details.push({ label: m[1], value, mono: /^(Time|Run|Trigger)$/.test(m[1]) })
  }
  const rejected = /rejected \d+ rows/.test(opts.title)
  return {
    locale: opts.locale,
    subject: `[Nexus] ${opts.title}`,
    preheader: paragraphs[0] ?? details.map((d) => d.value).join(' · '),
    heading: opts.title,
    status: { tone: LEVEL_TONE[opts.level], label: t(`email.alert.${opts.level}`) },
    lines: paragraphs,
    details,
    action: rejected
      ? { label: t('email.alert.openQuality'), url: `${appUrl()}/dashboard/quality` }
      : opts.pipelineId
        ? { label: t('email.alert.openPipelines'), url: `${appUrl()}/dashboard/pipelines` }
        : { label: t('email.chrome.openApp'), url: `${appUrl()}/dashboard` },
  }
}
