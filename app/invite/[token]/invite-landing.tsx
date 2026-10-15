'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { createAccountFromInvite } from '@/lib/actions/workspaces'
import { TERMS_VERSION } from '@/lib/legal/terms'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { useT } from '@/components/i18n/i18n-provider'

export interface InviteSummary {
  workspaceName: string
  email: string
  hasAccount: boolean
  ssoProvider: string | null
}

const MIN_PASSWORD = 8

/**
 * The invite link opened while signed out: the invited person creates their
 * account here (email fixed to the invite), signs in with their organization's
 * SSO, or signs in to an account they already have. Afterwards the invite page
 * runs the usual gates (2FA setup) and joins them to the workspace.
 */
export default function InviteLanding({ token, invite }: { token: string; invite: InviteSummary }) {
  const t = useT()
  const back = `/invite/${token}?welcome=1`
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (invite.ssoProvider) {
    const sso = async () => {
      setBusy(true)
      const { data, error } = await authClient.signIn.sso({ email: invite.email, callbackURL: back, errorCallbackURL: `/sign-in?next=${encodeURIComponent(back)}` })
      if (error) {
        setBusy(false)
        return setError(error.message ?? t('auth.form.ssoFailedShort'))
      }
      if (data?.url) window.location.href = data.url
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-pretty text-muted-foreground">{t('auth.invite.ssoBody', { provider: invite.ssoProvider, workspace: invite.workspaceName })}</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button size="lg" className="w-full" onClick={() => void sso()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {t('auth.invite.sso', { provider: invite.ssoProvider })}
        </Button>
      </div>
    )
  }

  if (invite.hasAccount) {
    return (
      <div className="space-y-3">
        <h2 className="text-base font-semibold">{t('auth.invite.hasAccountTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('auth.invite.hasAccountBody', { email: invite.email, workspace: invite.workspaceName })}</p>
        <Link href={`/sign-in?next=${encodeURIComponent(back)}&email=${encodeURIComponent(invite.email)}`} className={buttonVariants({ size: 'lg', className: 'w-full' })}>
          {t('auth.invite.signInToJoin')}
        </Link>
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) return setError(t('auth.reset.tooShort'))
    if (password !== confirm) return setError(t('auth.reset.mismatch'))
    if (!agreed) return setError(t('legal.signUpRequired'))
    setBusy(true)
    try {
      await createAccountFromInvite({ token, name, password, acceptedTerms: TERMS_VERSION })
      const { error } = await authClient.signIn.email({ email: invite.email, password })
      if (error) throw new Error(error.message ?? t('common.somethingWrong'))
      // A full navigation: the invite page sends a new account to 2FA setup first, then joins it.
      window.location.assign(back)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t('auth.invite.createTitle')}</h2>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{t('auth.invite.createBody', { email: invite.email })}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-email">{t('auth.invite.invitedEmail')}</Label>
        <Input id="invite-email" type="email" value={invite.email} readOnly aria-readonly className="bg-muted/50 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-name">{t('auth.form.name')}</Label>
        <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" autoFocus />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-password">{t('auth.invite.password')}</Label>
        <Input id="invite-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD} autoComplete="new-password" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-confirm">{t('auth.invite.confirmPassword')}</Label>
        <Input id="invite-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={MIN_PASSWORD} autoComplete="new-password" />
      </div>
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
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {busy ? t('auth.form.pleaseWait') : t('auth.invite.create')}
      </Button>
    </form>
  )
}
