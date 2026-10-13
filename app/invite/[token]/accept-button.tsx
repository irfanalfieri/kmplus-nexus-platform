'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { acceptInvite } from '@/lib/actions/workspaces'
import { useT } from '@/components/i18n/i18n-provider'

export default function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter()
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      await acceptInvite(token)
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.invite.acceptFailed'))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button size="lg" className="w-full" onClick={() => void accept()} disabled={busy}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {t('auth.invite.join')}
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  )
}
