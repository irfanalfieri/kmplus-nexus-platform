'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { acceptInvite } from '@/lib/actions/workspaces'
import { useT } from '@/components/i18n/i18n-provider'

/** Joins the workspace. auto: right after creating the account and setting up 2FA, no extra click. */
export default function AcceptInviteButton({ token, workspaceName, auto = false }: { token: string; workspaceName: string; auto?: boolean }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  const accept = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      await acceptInvite(token)
      // A full navigation, so the dashboard opens in the workspace just joined.
      window.location.assign('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.invite.acceptFailed'))
      setBusy(false)
    }
  }, [token, t])

  useEffect(() => {
    if (auto && !started.current) {
      started.current = true
      void accept()
    }
  }, [auto, accept])

  return (
    <div className="space-y-2">
      <Button size="lg" className="w-full" onClick={() => void accept()} disabled={busy}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {busy ? t('auth.invite.joining', { workspace: workspaceName }) : t('auth.invite.join')}
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  )
}
