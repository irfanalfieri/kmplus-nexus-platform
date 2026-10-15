'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Loader2, LogOut } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { acceptTerms } from '@/lib/actions/legal'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { AuthShell } from '@/components/auth-form'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { TermsArticle } from './terms-article'
import { TERMS_VERSION, termsFor } from '@/lib/legal/terms'

/**
 * The approval screen (/accept-terms): the full terms in a scrolling panel, a
 * checkbox, and Accept / Decline. Shown at first sign-in, and again after a new
 * version, before 2FA setup and before any screen of the app.
 */
export default function AcceptTerms({ next, previousVersion }: { next: string; previousVersion: string | null }) {
  const router = useRouter()
  const { t, locale, setLocale, formatDateTime } = usePrefs()
  const doc = termsFor(locale)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState('')

  const accept = async () => {
    setBusy('accept')
    setError('')
    try {
      await acceptTerms(TERMS_VERSION)
      // A full navigation: everything behind the gate renders fresh with the acceptance.
      window.location.assign(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('legal.failed'))
      setBusy(null)
    }
  }

  const decline = async () => {
    setBusy('decline')
    await authClient.signOut()
    router.replace('/sign-in')
    router.refresh()
  }

  return (
    <AuthShell className="max-w-2xl p-0">
      <div className="border-b border-border p-6 pb-5">
        <h1 className="text-xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {t('legal.version', { version: TERMS_VERSION, date: formatDateTime(`${TERMS_VERSION}T00:00:00+07:00`, { dateStyle: 'long', timeStyle: undefined }) })}
        </p>
        <p className="mt-3 text-sm text-pretty text-muted-foreground">
          {previousVersion ? t('legal.acceptUpdated', { previous: previousVersion }) : t('legal.acceptFirst')}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <button type="button" className="font-medium text-info-text underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setLocale(locale === 'id' ? 'en' : 'id')}>
            {t('legal.otherLanguage')}
          </button>
          <a href="/terms" target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-info-text underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            {t('legal.openFull')} <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </div>

      {/* The terms scroll inside the panel so the decision stays on screen. */}
      <div
        tabIndex={0}
        role="region"
        aria-label={doc.title}
        className="max-h-[50svh] overflow-y-auto bg-background px-6 py-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <p className="mb-5 text-sm text-pretty">{doc.intro}</p>
        <TermsArticle doc={doc} idPrefix="accept" />
        <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">{t('legal.prevails')}</p>
      </div>

      <div className="space-y-4 border-t border-border p-6">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <span className="font-medium">{t('legal.agree')}</span>
        </label>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap-reverse items-center justify-between gap-3">
          <Button variant="ghost" onClick={decline} disabled={busy !== null} className="text-muted-foreground">
            {busy === 'decline' ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
            {t('legal.decline')}
          </Button>
          <Button size="lg" onClick={accept} disabled={!agreed || busy !== null}>
            {busy === 'accept' && <Loader2 className="animate-spin" aria-hidden />}
            {busy === 'accept' ? t('legal.accepting') : t('legal.accept')}
          </Button>
        </div>
        <p className="text-xs text-pretty text-muted-foreground">{t('legal.declineHint')}</p>
      </div>
    </AuthShell>
  )
}
