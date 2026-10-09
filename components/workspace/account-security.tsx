'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, KeyRound, Loader2, ShieldCheck, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Your account security</h3>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Two-factor authentication is required for every account. Lost your phone? Sign in with a backup code, then set up 2FA on your new device here.</p>

      {!info ? (
        error ? null : (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        )
      ) : (
        <div className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Authenticator app</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-medium">
                <Check className="h-4 w-4 text-green-700 dark:text-green-400" aria-hidden /> On
              </dd>
            </div>
            <div className={`rounded-lg border p-3 ${low ? 'border-amber-500/50 bg-amber-500/5' : 'border-border'}`}>
              <dt className="text-xs text-muted-foreground">Backup codes left</dt>
              <dd className="mt-1 font-medium">
                {info.backupCodesLeft ?? '—'} of 10{low ? ' · create new codes soon' : ''}
              </dd>
            </div>
          </dl>

          {mode === 'idle' ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setMode('regenerate')}>
                <KeyRound className="mr-1 h-4 w-4" /> New backup codes
              </Button>
              <Button variant="outline" onClick={() => setMode('reenroll')}>
                <Smartphone className="mr-1 h-4 w-4" /> Set up on a new device
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm">
                {mode === 'regenerate'
                  ? 'Creates 10 new backup codes. Your old codes stop working.'
                  : 'Replaces your authenticator app: you will scan a new QR code right away. Your old app and backup codes stop working.'}
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Confirm your password</span>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus className="max-w-xs" />
              </label>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !password}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {mode === 'regenerate' ? 'Create new codes' : 'Continue to setup'}
                </Button>
                <Button type="button" variant="ghost" onClick={close}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {codes && (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4" aria-live="polite">
              <p className="text-sm font-medium">Your new backup codes (shown only now):</p>
              <ul className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void copyCodes()}>
                  {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button size="sm" variant="outline" onClick={downloadCodes}>
                  <Download className="mr-1 h-4 w-4" /> Download
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCodes(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {!info && error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
