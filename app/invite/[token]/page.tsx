import Link from 'next/link'
import { requirePageUser } from '@/lib/auth/session'
import { describeInvite } from '@/lib/actions/workspaces'
import { ROLE_INFO } from '@/lib/auth/permissions'
import { Card } from '@/components/ui/card'
import AcceptInviteButton from './accept-button'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await requirePageUser(`/invite/${token}`)

  const invite = await describeInvite(token).catch(() => null)
  const emailMatches = invite && user.email.toLowerCase() === invite.email.toLowerCase()

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md space-y-4 p-6">
        {!invite ? (
          <>
            <h1 className="text-xl font-semibold">Invite not valid</h1>
            <p className="text-sm text-muted-foreground">This link is invalid, has expired (links last 7 days), was revoked, or was already used. Ask a workspace admin for a new one.</p>
            <Link href="/dashboard" className="text-sm text-primary underline-offset-4 hover:underline">Go to your dashboard</Link>
          </>
        ) : (
          <>
            <div>
              <p className="text-sm text-muted-foreground">You&apos;re invited to join</p>
              <h1 className="text-2xl font-semibold">{invite.workspaceName}</h1>
            </div>
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <div>
                Role: <span className="font-medium">{ROLE_INFO[invite.role].label}</span>
              </div>
              <div className="mt-1 text-muted-foreground">{ROLE_INFO[invite.role].description}</div>
            </div>
            {emailMatches ? (
              <AcceptInviteButton token={token} />
            ) : (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                This invite is for <span className="font-medium">{invite.email}</span>, but you&apos;re signed in as{' '}
                <span className="font-medium">{user.email}</span>. Sign out and sign in (or sign up) with the invited email.
              </p>
            )}
          </>
        )}
      </Card>
    </main>
  )
}
