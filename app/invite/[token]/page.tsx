import Link from 'next/link'
import { requirePageUser } from '@/lib/auth/session'
import { describeInvite } from '@/lib/actions/workspaces'
import { getTranslator } from '@/lib/i18n/server'
import { AuthShell } from '@/components/auth-form'
import { Notice } from '@/components/ui/notice'
import AcceptInviteButton from './accept-button'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await requirePageUser(`/invite/${token}`)
  const t = await getTranslator()

  const invite = await describeInvite(token).catch(() => null)
  const emailMatches = invite && user.email.toLowerCase() === invite.email.toLowerCase()

  return (
    <AuthShell className="max-w-md space-y-4">
      {!invite ? (
        <>
          <h1 className="text-xl font-semibold tracking-tight">{t('auth.invite.invalidTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('auth.invite.invalidBody')}</p>
          <Link href="/dashboard" className="inline-block text-sm font-medium text-info-text underline-offset-4 hover:underline">
            {t('auth.invite.goDashboard')}
          </Link>
        </>
      ) : (
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
          {emailMatches ? (
            <AcceptInviteButton token={token} />
          ) : (
            <Notice tone="warning" live={false}>
              {t('auth.invite.wrongEmailBefore')} <span className="font-medium">{invite.email}</span>
              {t('auth.invite.wrongEmailMiddle')} <span className="font-medium">{user.email}</span>
              {t('auth.invite.wrongEmailAfter')}
            </Notice>
          )}
        </>
      )}
    </AuthShell>
  )
}
