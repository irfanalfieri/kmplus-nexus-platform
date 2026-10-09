'use client'

import { useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download, Loader2, ShieldCheck } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Step = 'password' | 'scan' | 'codes'

/** Mandatory TOTP enrollment: confirm password → scan QR → enter code → save backup codes. */
export default function SetupTwoFactor({ email, next }: { email: string; next: string }) {
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
    if (error || !data) return setError(error?.message ?? 'Could not start two-factor setup.')
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
    if (error) return setError(error.message ?? 'That code is not valid. Check the time on your phone and try the newest code.')
    setStep('codes')
  }

  const codesText = `KMPlus Nexus backup codes for ${email}\nEach code works once. Keep them somewhere safe.\n\n${backupCodes.join('\n')}\n`

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
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md space-y-5 p-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-xs font-medium uppercase tracking-wide">Step {step === 'password' ? 1 : step === 'scan' ? 2 : 3} of 3</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Set up two-factor authentication</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            KMPlus Nexus requires a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy, …) every time you sign in.
          </p>
        </div>

        {step === 'password' && (
          <form onSubmit={start} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Confirm your password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" autoFocus />
              <p className="text-xs text-muted-foreground">Signed in as {email}.</p>
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !password}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Continue
            </Button>
          </form>
        )}

        {step === 'scan' && (
          <form onSubmit={confirm} className="space-y-4">
            <div className="space-y-2 text-sm">
              <p>1. Open your authenticator app and scan this QR code.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="mx-auto rounded-md border border-border bg-white p-2" />
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Can&apos;t scan? Enter this key instead</summary>
                <code className="mt-2 block break-all rounded bg-muted p-2 font-mono text-foreground">{secret}</code>
              </details>
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">2. Enter the 6-digit code it shows</Label>
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
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || code.replace(/\s/g, '').length !== 6}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify and turn on
            </Button>
          </form>
        )}

        {step === 'codes' && (
          <div className="space-y-4">
            <p className="text-sm">
              Two-factor authentication is on. Save these <span className="font-medium">backup codes</span>: if you lose your phone, each one lets you sign in once. They are shown only now.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm">
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => void copyCodes()}>
                {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={downloadCodes}>
                <Download className="mr-1 h-4 w-4" /> Download
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4" />
              I saved my backup codes
            </label>
            <Button className="w-full" disabled={!saved} onClick={() => window.location.assign(next)}>
              Continue to KMPlus Nexus
            </Button>
          </div>
        )}
      </Card>
    </main>
  )
}
