'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { acceptInvite } from '@/app/actions/workspaces'

export default function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter()
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
      setError(err instanceof Error ? err.message : 'Could not accept the invite')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" onClick={() => void accept()} disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Join workspace
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
