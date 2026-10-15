'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { AuthShell } from '@/components/auth-form'
import { useT } from '@/components/i18n/i18n-provider'

const MIN_PASSWORD = 8

/**
 * "Forgot password?": asks for the email and always answers the same way, so
 * the page never tells whether an account exists. The email links to
 * /reset-password through Better Auth, which checks the token first.
 */
export function ForgotPasswordForm({ initialEmail = '' }: { initialEmail?: string }) {
  const t = useT()
  const [email, setEmail] = useState(initialEmail)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })
    setLoading(false)
    if (error) {
      // Rate limit and SSO-only domains are the only answers that differ.
      if (error.status === 429) return setError(t('auth.reset.tooMany'))
      if (error.status === 403) return setError(error.message ?? t('common.somethingWrong'))
    }
    setSentTo(email)
  }

  if (sentTo) {
    return (
      <AuthShell className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.reset.sentTitle')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('auth.reset.sentBody', { email: sentTo })}</p>
        <p className="text-xs text-pretty text-muted-foreground">{t('auth.reset.sentHint')}</p>
        <Link href="/sign-in" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
          {t('auth.form.backToSignIn')}
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.reset.forgotTitle')}</h1>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{t('auth.reset.forgotSubtitle')}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="reset-email">{t('auth.form.email')}</Label>
          <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" size="lg" disabled={loading} className="w-full">
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {loading ? t('auth.form.pleaseWait') : t('auth.reset.sendLink')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link href="/sign-in" className="font-medium text-info-text underline-offset-4 hover:underline">
          {t('auth.form.backToSignIn')}
        </Link>
      </p>
    </AuthShell>
  )
}

/** The link from the email: choose a new password. A used or expired link offers a new one. */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const t = useT()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(!token)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) return setError(t('auth.reset.tooShort'))
    if (password !== confirm) return setError(t('auth.reset.mismatch'))
    setLoading(true)
    const { error } = await authClient.resetPassword({ newPassword: password, token: token ?? '' })
    setLoading(false)
    if (error) {
      if (error.code === 'INVALID_TOKEN') return setInvalid(true)
      if (error.status === 429) return setError(t('auth.reset.tooMany'))
      if (error.code === 'PASSWORD_TOO_SHORT') return setError(t('auth.reset.tooShort'))
      return setError(error.message ?? t('common.somethingWrong'))
    }
    router.replace('/sign-in?reset=done')
  }

  if (invalid) {
    return (
      <AuthShell className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.reset.invalidTitle')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('auth.reset.invalidBody')}</p>
        <Link href="/forgot-password" className={buttonVariants({ className: 'w-full' })}>
          {t('auth.reset.requestNew')}
        </Link>
        <Link href="/sign-in" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
          {t('auth.form.backToSignIn')}
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.reset.newTitle')}</h1>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{t('auth.reset.newSubtitle')}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">{t('auth.reset.newPassword')}</Label>
          <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD} autoComplete="new-password" autoFocus />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-password">{t('auth.reset.confirmPassword')}</Label>
          <Input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={MIN_PASSWORD} autoComplete="new-password" />
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" size="lg" disabled={loading} className="w-full">
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {loading ? t('auth.form.pleaseWait') : t('auth.reset.save')}
        </Button>
      </form>
    </AuthShell>
  )
}
