import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { safeNextPath } from '@/lib/safe-redirect'

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next)
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect(next)
  return <AuthForm mode="sign-in" next={next} />
}
