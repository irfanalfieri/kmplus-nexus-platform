import Link from 'next/link'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { requirePageUser } from '@/lib/auth/session'
import { describeInvite } from '@/lib/actions/workspaces'
import { getTranslator } from '@/lib/i18n/server'
import { AuthShell } from '@/components/auth-form'
import { Notice } from '@/components/ui/notice'
import AcceptInviteButton from './accept-button'
import InviteLanding from './invite-landing'

/**
 * The link in an invite email. Signed out: create an account for the invited
 * email (or sign in / use SSO if there is one). Signed in: the usual gates
 * (Terms, 2FA), then join. ?welcome=1 (coming back from those steps) joins
 * without another click.
 */
export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { token } = await params
  const welcome = (await searchParams).welcome === '1'
  const t = await getTranslator()
  const invite = await describeInvite(token).catch(() => null)

  if (!invite) {
    return (
      <AuthShell className="max-w-md space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.invite.invalidTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('auth.invite.invalidBody')}</p>
        <Link href="/dashboard" className="inline-block text-sm font-medium text-info-text underline-offset-4 hover:underline">
          {t('auth.invite.goDashboard')}
        </Link>
      </AuthShell>
    )
  }

  const heading = (
    <>
      <div>
        <p className="text-sm text-muted-foreground">{t('auth.invite.invitedTo')}</p>
        <h1 className="text-xl font-semibold tracking-tight">{invite.workspaceName}</h1>
      </div>
      <div className="rounded-md border border-border bg-muted p-3 text-sm">
        <p>
          {t('auth.invite.role')} <span className="font-medium">{t(`auth.roles.${invite.role}.label`)}</span>
        </p>
        <p className="mt-1 text-muted-foreground">{t(`auth.roles.${invite.role}.description`)}</p>
      </div>
    </>
  )

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return (
      <AuthShell className="max-w-md space-y-4">
        {heading}
        <InviteLanding token={token} invite={{ workspaceName: invite.workspaceName, email: invite.email, hasAccount: invite.hasAccount, ssoProvider: invite.ssoProvider }} />
      </AuthShell>
    )
  }

  const user = await requirePageUser(`/invite/${token}${welcome ? '?welcome=1' : ''}`)
  const emailMatches = user.email.toLowerCase() === invite.email.toLowerCase()

  return (
    <AuthShell className="max-w-md space-y-4">
      {heading}
      {emailMatches ? (
        <AcceptInviteButton token={token} workspaceName={invite.workspaceName} auto={welcome} />
      ) : (
        <Notice tone="warning" live={false}>
          {t('auth.invite.wrongEmailBefore')} <span className="font-medium">{invite.email}</span>
          {t('auth.invite.wrongEmailMiddle')} <span className="font-medium">{user.email}</span>
          {t('auth.invite.wrongEmailAfter')}
        </Notice>
      )}
    </AuthShell>
  )
}
