import type { Metadata } from 'next'
import { ResetPasswordForm } from '@/components/password-reset'
import { getTranslator } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator()
  return { title: t('auth.reset.newTitle'), referrer: 'no-referrer' }
}

/**
 * The emailed link lands here through Better Auth (/api/auth/reset-password/<token>),
 * which checks the token and adds ?token= or ?error=INVALID_TOKEN.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams
  return <ResetPasswordForm token={!error && typeof token === 'string' && token ? token : null} />
}
