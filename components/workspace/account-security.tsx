'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, KeyRound, Loader2, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { SettingsPanel } from '@/components/workspace/settings-panel'
import { authClient } from '@/lib/auth-client'
import { getAccountSecurity } from '@/lib/actions/account'

type Security = Awaited<ReturnType<typeof getAccountSecurity>>
type Mode = 'idle' | 'regenerate' | 'reenroll'

/** Settings → Your account security: 2FA status, new backup codes, move 2FA to a new phone (TD-19). */
export function AccountSecurity() {
  const [info, setInfo] = useState<Security | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setInfo(await getAccountSecurity())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account security')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const close = () => {
    setMode('idle')
    setPassword('')
    setError('')
  }

  // The password form below is the confirmation step for both actions: it names
  // what stops working and needs the account password before anything changes.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    if (mode === 'regenerate') {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password })
      setBusy(false)
      if (error || !data) return setError(error?.message ?? 'Could not create new backup codes.')
      setCodes(data.backupCodes)
      setCopied(false)
      close()
      void load()
      return
    }
    // Re-enroll: turn 2FA off (password-confirmed), then the setup flow runs again right away.
    const { error } = await authClient.twoFactor.disable({ password })
    setBusy(false)
    if (error) return setError(error.message ?? 'Could not start setup.')
    window.location.assign('/setup-2fa?next=%2Fdashboard')
  }

  const codesText = codes ? `KMPlus Nexus backup codes for ${info?.email ?? ''}\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n` : ''
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

  const low = info?.backupCodesLeft != null && info.backupCodesLeft <= 3

  return (
    <SettingsPanel
      title="Your account security"
      description="Two-factor authentication is required for every account. Lost your phone? Sign in with a backup code, then set up 2FA on your new device here."
    >
      {!info ? (
        error ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        )
      ) : (
        <div className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <dt className="text-xs text-muted-foreground">Authenticator app</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-medium text-live-text">
                <ShieldCheck className="size-4 text-live" aria-hidden /> On
              </dd>
            </div>
            <div className={cn('rounded-md border p-3', low ? 'border-warning/50 bg-warning-soft' : 'border-border')}>
              <dt className="text-xs text-muted-foreground">Backup codes left</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-medium">
                {low && <ShieldAlert className="size-4 text-warning" aria-hidden />}
                <span className="font-mono">{info.backupCodesLeft ?? '—'}</span> of 10{low ? ' · create new codes soon' : ''}
              </dd>
            </div>
          </dl>

          {mode === 'idle' ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setMode('regenerate')}>
                <KeyRound aria-hidden /> New backup codes
              </Button>
              <Button variant="outline" onClick={() => setMode('reenroll')}>
                <Smartphone aria-hidden /> Set up on a new device
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold">{mode === 'regenerate' ? 'Create new backup codes' : 'Move 2FA to a new device'}</h3>
              <Notice tone="warning" live={false}>
                {mode === 'regenerate'
                  ? 'Creates 10 new backup codes. Your old codes stop working.'
                  : 'Replaces your authenticator app: you will scan a new QR code right away. Your old app and backup codes stop working.'}
              </Notice>
              <div className="space-y-1.5">
                <Label htmlFor="account-security-password">Confirm your password</Label>
                <Input
                  id="account-security-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  autoFocus
                  className="max-w-xs"
                />
              </div>
              {error && <Notice tone="danger">{error}</Notice>}
              <div className="flex gap-2">
                <Button type="submit" variant={mode === 'reenroll' ? 'danger' : 'default'} disabled={busy || !password}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  {mode === 'regenerate' ? 'Create new codes' : 'Continue to setup'}
                </Button>
                <Button type="button" variant="ghost" onClick={close}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {codes && (
            <div className="space-y-3 rounded-md border border-info/40 bg-info-soft p-4" aria-live="polite">
              <h3 className="text-sm font-semibold">Your new backup codes (shown only now)</h3>
              <ul className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void copyCodes()}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button size="sm" variant="outline" onClick={downloadCodes}>
                  <Download aria-hidden /> Download
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCodes(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </SettingsPanel>
  )
}
