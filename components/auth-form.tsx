'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { KmLogo } from '@/components/brand/km-logo'
import { useT } from '@/components/i18n/i18n-provider'
import { TERMS_VERSION } from '@/lib/legal/terms'

/**
 * The frame of every sign-in screen: the board, the KM+ wordmark with "Nexus"
 * above, and one flat panel holding the form.
 */
export function AuthShell({ children, className }: { children: React.ReactNode; className?: string }) {
  const t = useT()
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Link
        href="/"
        className="mb-6 flex items-center gap-2.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        aria-label={t('auth.shell.home')}
      >
        <KmLogo className="h-9" priority />
        <span className="text-base font-semibold tracking-tight" aria-hidden>
          Nexus
        </span>
      </Link>
      <section className={cn('w-full max-w-sm rounded-lg border border-border bg-card p-6', className)}>{children}</section>
    </main>
  )
}

export function AuthForm({ mode, next = '/dashboard', ssoError }: { mode: 'sign-in' | 'sign-up'; next?: string; ssoError?: string }) {
  const router = useRouter()
  const t = useT()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(ssoError ? t('auth.form.ssoFailed', { error: ssoError }) : null)
  const [useSso, setUseSso] = useState(Boolean(ssoError))
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)

  const isSignUp = mode === 'sign-up'

  /** SSO: the email's domain picks the workspace identity provider; the browser goes there and comes back signed in. */
  const signInWithSso = async () => {
    const { data, error } = await authClient.signIn.sso({ email, callbackURL: next, errorCallbackURL: `/sign-in?next=${encodeURIComponent(next)}` })
    setLoading(false)
    if (error)
      return setError(
        error.status === 404 || /not found|no provider/i.test(error.message ?? '')
          ? t('auth.form.ssoNotSetUp')
          : (error.message ?? t('auth.form.ssoFailedShort')),
      )
    if (data?.url) window.location.href = data.url
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    if (!isSignUp && useSso) return signInWithSso()

    const setupPath = `/setup-2fa?next=${encodeURIComponent(next)}`
    if (isSignUp) {
      if (!agreed) {
        setLoading(false)
        return setError(t('legal.signUpRequired'))
      }
      // The verification link signs the user in and continues to 2FA setup. The server
      // refuses a sign-up without the current terms version and records the acceptance.
      const { data, error } = await authClient.signUp.email({ email, password, name, callbackURL: setupPath, acceptedTerms: TERMS_VERSION } as Parameters<typeof authClient.signUp.email>[0])
      setLoading(false)
      if (error) return setError(error.message ?? t('common.somethingWrong'))
      if (data?.token) {
        // Email verification is off (production without SMTP): straight to 2FA setup.
        router.push(setupPath)
        return
      }
      setSentTo(email)
      return
    }

    const { data, error } = await authClient.signIn.email({ email, password, callbackURL: setupPath })
    setLoading(false)
    if (error) {
      if (error.code === 'EMAIL_NOT_VERIFIED') {
        setSentTo(email)
        return
      }
      return setError(error.message ?? t('common.somethingWrong'))
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      router.push(`/verify-2fa?next=${encodeURIComponent(next)}`)
      return
    }
    // No 2FA yet: the dashboard sends the user to /setup-2fa.
    router.push(next)
    router.refresh()
  }

  if (sentTo) {
    return (
      <AuthShell className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.form.checkEmailTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('auth.form.checkEmailBefore')} <span className="font-medium text-foreground">{sentTo}</span>
          {t('auth.form.checkEmailAfter')}
        </p>
        <p className="text-xs text-muted-foreground">{t('auth.form.checkEmailHint')}</p>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setSentTo(null)
            setPassword('')
          }}
        >
          {t('auth.form.backToSignIn')}
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{isSignUp ? t('auth.form.signUpTitle') : t('auth.form.signInTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{isSignUp ? t('auth.form.signUpSubtitle') : t('auth.form.signInSubtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {isSignUp && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t('auth.form.name')}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t('auth.form.email')}</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        {!useSso && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t('auth.form.password')}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
          </div>
        )}

        {isSignUp && (
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              required
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <span className="text-pretty text-muted-foreground">
              {t('legal.signUpAgree', { link: '\u0000' })
                .split('\u0000')
                .flatMap((part, i) =>
                  i === 0
                    ? [part]
                    : [
                        <a key="terms" href="/terms" target="_blank" rel="noopener" className="font-medium text-info-text underline-offset-4 hover:underline">
                          {t('legal.termsLink')}
                        </a>,
                        part,
                      ],
                )}
            </span>
          </label>
        )}

        {error && <Notice tone="danger">{error}</Notice>}

        <Button type="submit" size="lg" disabled={loading} className="w-full">
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {loading ? t('auth.form.pleaseWait') : isSignUp ? t('auth.form.createAccount') : useSso ? t('auth.form.continueSso') : t('auth.form.signIn')}
        </Button>
        {!isSignUp && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => {
              setUseSso(!useSso)
              setError(null)
            }}
          >
            {useSso ? t('auth.form.usePassword') : t('auth.form.useSso')}
          </Button>
        )}
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignUp ? t('auth.form.haveAccount') : t('auth.form.noAccount')}{' '}
        <Link
          href={`${isSignUp ? '/sign-in' : '/sign-up'}${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`}
          className="font-medium text-info-text underline-offset-4 hover:underline"
        >
          {isSignUp ? t('auth.form.signIn') : t('auth.form.signUp')}
        </Link>
      </p>
    </AuthShell>
  )
}
