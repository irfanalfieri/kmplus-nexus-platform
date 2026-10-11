import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { safeNextPath } from '@/lib/safe-redirect'

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; error_description?: string }> }) {
  const params = await searchParams
  const next = safeNextPath(params.next)
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect(next)
  // The SSO callback sends the user back here with ?error= when the identity provider sign-in fails.
  const ssoError = params.error ? (params.error_description || params.error).replace(/_/g, ' ').slice(0, 200) : undefined
  return <AuthForm mode="sign-in" next={next} ssoError={ssoError} />
}
