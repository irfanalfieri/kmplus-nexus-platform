import Link from 'next/link'
import { requirePageUser } from '@/lib/auth/session'
import { describeInvite } from '@/lib/actions/workspaces'
import { ROLE_INFO } from '@/lib/auth/permissions'
import { AuthShell } from '@/components/auth-form'
import { Notice } from '@/components/ui/notice'
import AcceptInviteButton from './accept-button'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await requirePageUser(`/invite/${token}`)

  const invite = await describeInvite(token).catch(() => null)
  const emailMatches = invite && user.email.toLowerCase() === invite.email.toLowerCase()

  return (
    <AuthShell className="max-w-md space-y-4">
      {!invite ? (
        <>
          <h1 className="text-xl font-semibold tracking-tight">Invite not valid</h1>
          <p className="text-sm text-muted-foreground">This link is invalid, has expired (links last 7 days), was revoked, or was already used. Ask a workspace admin for a new one.</p>
          <Link href="/dashboard" className="inline-block text-sm font-medium text-info-text underline-offset-4 hover:underline">
            Go to your dashboard
          </Link>
        </>
      ) : (
        <>
          <div>
            <p className="text-sm text-muted-foreground">You&apos;re invited to join</p>
            <h1 className="text-xl font-semibold tracking-tight">{invite.workspaceName}</h1>
          </div>
          <div className="rounded-md border border-border bg-muted p-3 text-sm">
            <p>
              Role: <span className="font-medium">{ROLE_INFO[invite.role].label}</span>
            </p>
            <p className="mt-1 text-muted-foreground">{ROLE_INFO[invite.role].description}</p>
          </div>
          {emailMatches ? (
            <AcceptInviteButton token={token} />
          ) : (
            <Notice tone="warning" live={false}>
              This invite is for <span className="font-medium">{invite.email}</span>, but you&apos;re signed in as <span className="font-medium">{user.email}</span>. Sign out and sign in (or sign up) with the invited email.
            </Notice>
          )}
        </>
      )}
    </AuthShell>
  )
}
