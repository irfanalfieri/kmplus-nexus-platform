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

/** Second sign-in step: a code from the authenticator app, or a backup code. */
export default function VerifyTwoFactor({ next }: { next: string }) {
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
          ? 'This sign-in expired (10 minutes). Sign in again.'
          : (error.message ?? 'That code is not valid.')
      )
      return
    }
    window.location.assign(next)
  }

  return (
    <AuthShell className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Two-factor authentication</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {useBackup ? 'Enter one of your backup codes. Each code works once.' : 'Enter the 6-digit code from your authenticator app.'}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code">{useBackup ? 'Backup code' : 'Code'}</Label>
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
          Trust this device for 30 days
        </label>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !code.trim()}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}Verify
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
          {useBackup ? 'Use authenticator app' : 'Use a backup code'}
        </button>
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="rounded-sm text-info-text underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Start over
        </Link>
      </div>
    </AuthShell>
  )
}
