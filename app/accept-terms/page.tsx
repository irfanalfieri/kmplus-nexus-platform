import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { safeNextPath } from '@/lib/safe-redirect'
import { hasAcceptedCurrentTerms, latestTermsAcceptance } from '@/lib/legal/acceptance'
import { getTranslator } from '@/lib/i18n/server'
import AcceptTerms from '@/components/legal/accept-terms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator()
  return { title: t('legal.acceptTitle') }
}

/** First sign-in (and after a new version): the person approves the Terms and Conditions before anything else. */
export default async function AcceptTermsPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next)
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect(`/sign-in?next=${encodeURIComponent(`/accept-terms?next=${encodeURIComponent(next)}`)}`)
  if (await hasAcceptedCurrentTerms(session.user.id)) redirect(next)
  const previous = await latestTermsAcceptance(session.user.id)
  return <AcceptTerms next={next} previousVersion={previous?.version ?? null} />
}
