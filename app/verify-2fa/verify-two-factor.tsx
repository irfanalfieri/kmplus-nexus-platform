'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, ShieldCheck } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm space-y-5 p-6">
        <div>
          <ShieldCheck className="mb-2 h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Two-factor authentication</h1>
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
            <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} className="h-4 w-4" />
            Trust this device for 30 days
          </label>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !code.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify
          </Button>
        </form>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setUseBackup((v) => !v)
              setCode('')
              setError('')
            }}
          >
            {useBackup ? 'Use authenticator app' : 'Use a backup code'}
          </button>
          <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="text-muted-foreground underline-offset-4 hover:underline">
            Start over
          </Link>
        </div>
      </Card>
    </main>
  )
}
