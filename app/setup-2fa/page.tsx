import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { safeNextPath } from '@/lib/safe-redirect'
import SetupTwoFactor from './setup-two-factor'

export default async function SetupTwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next)
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect(`/sign-in?next=${encodeURIComponent(next)}`)
  if (session.user.twoFactorEnabled) redirect(next)
  return <SetupTwoFactor email={session.user.email} next={next} />
}
