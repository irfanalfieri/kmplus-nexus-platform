import type { Metadata } from 'next'
import { ForgotPasswordForm } from '@/components/password-reset'
import { getTranslator } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator()
  return { title: t('auth.reset.forgotTitle') }
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const email = (await searchParams).email
  return <ForgotPasswordForm initialEmail={typeof email === 'string' ? email.slice(0, 200) : ''} />
}
