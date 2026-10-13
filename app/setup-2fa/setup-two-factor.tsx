'use client'

import { useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download, Loader2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { AuthShell } from '@/components/auth-form'
import { useT } from '@/components/i18n/i18n-provider'

type Step = 'password' | 'scan' | 'codes'

/** Mandatory TOTP enrollment: confirm password → scan QR → enter code → save backup codes. */
export default function SetupTwoFactor({ email, next }: { email: string; next: string }) {
  const t = useT()
  const [step, setStep] = useState<Step>('password')
  const [password, setPassword] = useState('')
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error } = await authClient.twoFactor.enable({ password })
    setBusy(false)
    if (error || !data) return setError(error?.message ?? t('auth.setup2fa.startFailed'))
    setPassword('')
    setBackupCodes(data.backupCodes)
    setSecret(new URL(data.totpURI).searchParams.get('secret') ?? '')
    setQr(await QRCode.toDataURL(data.totpURI, { width: 220, margin: 1 }))
    setStep('scan')
  }

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') })
    setBusy(false)
    if (error) return setError(error.message ?? t('auth.setup2fa.invalidCode'))
    setStep('codes')
  }

  const codesText = `${t('auth.setup2fa.fileHeader', { email })}\n${t('auth.setup2fa.fileNote')}\n\n${backupCodes.join('\n')}\n`

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codesText)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const downloadCodes = () => {
    const url = URL.createObjectURL(new Blob([codesText], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'kmplus-nexus-backup-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AuthShell className="max-w-md space-y-5">
      <div>
        <p className="mb-2 font-mono text-xs tracking-wide text-muted-foreground uppercase">{t('auth.setup2fa.step', { step: step === 'password' ? 1 : step === 'scan' ? 2 : 3 })}</p>
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.setup2fa.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('auth.setup2fa.intro')}
        </p>
      </div>

      {step === 'password' && (
        <form onSubmit={start} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">{t('auth.setup2fa.confirmPassword')}</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" autoFocus />
            <p className="text-xs text-muted-foreground">{t('auth.setup2fa.signedInAs', { email })}</p>
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !password}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}{t('auth.setup2fa.continue')}
          </Button>
        </form>
      )}

      {step === 'scan' && (
        <form onSubmit={confirm} className="space-y-4">
          <div className="space-y-2 text-sm">
            <p>{t('auth.setup2fa.scan')}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={t('auth.setup2fa.qrAlt')} width={220} height={220} className="mx-auto rounded-md border border-border bg-white p-2" />
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer text-info-text">{t('auth.setup2fa.cantScan')}</summary>
              <code className="mt-2 block rounded-sm bg-muted p-2 font-mono break-all text-foreground">{secret}</code>
            </details>
          </div>
          <div className="space-y-2">
            <Label htmlFor="code">{t('auth.setup2fa.enterCode')}</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123 456"
              required
              autoFocus
              className="text-center font-mono text-lg tracking-widest"
            />
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" size="lg" className="w-full" disabled={busy || code.replace(/\s/g, '').length !== 6}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}{t('auth.setup2fa.verifyAndEnable')}
          </Button>
        </form>
      )}

      {step === 'codes' && (
        <div className="space-y-4">
          <p className="text-sm">
            {t('auth.setup2fa.enabledBefore')} <span className="font-medium">{t('auth.setup2fa.backupCodesWord')}</span>
            {t('auth.setup2fa.enabledAfter')}
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted p-3 font-mono text-sm" aria-label={t('auth.setup2fa.backupCodes')}>
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => void copyCodes()}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? t('auth.setup2fa.copied') : t('auth.setup2fa.copy')}
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={downloadCodes}>
              <Download aria-hidden /> {t('auth.setup2fa.download')}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-primary" />
            {t('auth.setup2fa.savedCodes')}
          </label>
          <Button size="lg" className="w-full" disabled={!saved} onClick={() => window.location.assign(next)}>
            {t('auth.setup2fa.continueToApp')}
          </Button>
        </div>
      )}
    </AuthShell>
  )
}
