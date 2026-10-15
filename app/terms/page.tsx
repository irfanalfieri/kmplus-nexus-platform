import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { KmLogo } from '@/components/brand/km-logo'
import { TermsArticle } from '@/components/legal/terms-article'
import { getLocale, getTranslator } from '@/lib/i18n/server'
import { TERMS_VERSION, termsFor } from '@/lib/legal/terms'
import { LOCALE_INFO } from '@/lib/i18n/config'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator()
  return { title: t('legal.acceptTitle') }
}

/**
 * The Terms and Conditions, public (linked from sign-up and the approval
 * screen). ?lang=en|id shows the other language without changing the cookie.
 */
export default async function TermsPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const requested = (await searchParams).lang
  const locale = requested === 'id' || requested === 'en' ? requested : await getLocale()
  const t = await getTranslator()
  const doc = termsFor(locale)
  const other = locale === 'id' ? 'en' : 'id'
  const effective = new Intl.DateTimeFormat(LOCALE_INFO[locale].intl, { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(`${TERMS_VERSION}T00:00:00+07:00`))

  return (
    <main lang={LOCALE_INFO[locale].htmlLang} className="min-h-svh bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <KmLogo className="h-9" priority />
            <span className="text-base font-semibold tracking-tight">Nexus</span>
          </Link>
          <Link href={`/terms?lang=${other}`} hrefLang={other} className="text-sm font-medium text-info-text underline-offset-4 hover:underline">
            {locale === 'id' ? 'Read in English' : 'Baca dalam Bahasa Indonesia'}
          </Link>
        </div>

        <article className="rounded-lg border border-border bg-card">
          <header className="border-b border-border p-6 sm:p-8">
            <h1 className="text-[1.625rem] leading-9 font-normal tracking-[-0.01em]">{doc.title}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{t('legal.version', { version: TERMS_VERSION, date: effective })}</p>
            <p className="mt-3 max-w-2xl text-sm text-pretty text-muted-foreground">{doc.intro}</p>
            <nav aria-label={t('legal.contents')} className="mt-5">
              <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {doc.sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#terms-${s.id}`} className="text-info-text underline-offset-4 hover:underline">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </header>
          <div className="p-6 sm:p-8">
            <TermsArticle doc={doc} />
            <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">{t('legal.prevails')}</p>
          </div>
        </article>

        <Link href="/dashboard" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-info-text underline-offset-4 hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> {t('legal.backHome')}
        </Link>
      </div>
    </main>
  )
}
