import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { safeNextPath } from '@/lib/safe-redirect'
import VerifyTwoFactor from './verify-two-factor'

export default async function VerifyTwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next)
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect(next)
  return <VerifyTwoFactor next={next} />
}
