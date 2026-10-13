'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { AuthShell } from '@/components/auth-form'
import { useT } from '@/components/i18n/i18n-provider'

/** Second sign-in step: a code from the authenticator app, or a backup code. */
export default function VerifyTwoFactor({ next }: { next: string }) {
  const t = useT()
  const [useBackup, setUseBackup] = useState(false)
  const [code, setCode] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const value = code.replace(/\s/g, '')
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: value, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: value, trustDevice })
    setBusy(false)
    if (error) {
      setError(
        error.code === 'INVALID_TWO_FACTOR_COOKIE'
          ? t('auth.verify2fa.expired')
          : (error.message ?? t('auth.verify2fa.invalidCode'))
      )
      return
    }
    window.location.assign(next)
  }

  return (
    <AuthShell className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.verify2fa.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {useBackup ? t('auth.verify2fa.backupIntro') : t('auth.verify2fa.totpIntro')}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code">{useBackup ? t('auth.verify2fa.backupCode') : t('auth.verify2fa.code')}</Label>
          <Input
            id="code"
            key={useBackup ? 'backup' : 'totp'}
            inputMode={useBackup ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            maxLength={useBackup ? 32 : 7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={useBackup ? 'xxxxx-xxxxx' : '123 456'}
            required
            autoFocus
            className="text-center font-mono text-lg tracking-widest"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} className="size-4 accent-primary" />
          {t('auth.verify2fa.trustDevice')}
        </label>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !code.trim()}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}{t('auth.verify2fa.verify')}
        </Button>
      </form>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="rounded-sm text-info-text underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => {
            setUseBackup((v) => !v)
            setCode('')
            setError('')
          }}
        >
          {useBackup ? t('auth.verify2fa.useApp') : t('auth.verify2fa.useBackup')}
        </button>
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="rounded-sm text-info-text underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('auth.verify2fa.startOver')}
        </Link>
      </div>
    </AuthShell>
  )
}
