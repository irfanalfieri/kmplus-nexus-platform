import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { KmLogo } from '@/components/brand/km-logo'
import { NexusWordmark } from '@/components/brand/nexus-logo'
import { FlowLine } from '@/components/ui/flow-line'
import { cn } from '@/lib/utils'
import { getTranslator } from '@/lib/i18n/server'

const CAPABILITIES = ['sources', 'marketplace', 'designer', 'scheduler', 'catalog', 'rules', 'analytics', 'governance'] as const

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (session?.user) {
    redirect('/dashboard')
  }
  const t = await getTranslator()

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2.5">
          <KmLogo className="h-9" priority />
          <NexusWordmark className="text-xl" />
        </span>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-10 px-4 pt-6 pb-16 sm:px-6">
        <section className="max-w-2xl">
          <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">{t('auth.landing.eyebrow')}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">KMPlus Nexus</h1>
          <p className="mt-4 text-lg text-pretty text-muted-foreground">
            {t('auth.landing.lead')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg', className: 'px-4' })}>
              {t('auth.landing.getStarted')}
            </Link>
            <Link href="/sign-in" className={buttonVariants({ size: 'lg', variant: 'outline', className: 'px-4' })}>
              {t('auth.landing.signIn')}
            </Link>
          </div>
        </section>

        <section aria-labelledby="capabilities" className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border px-5 py-4">
            <h2 id="capabilities" className="text-base font-semibold">
              {t('auth.landing.covers')}
            </h2>
            <FlowLine from={t('auth.landing.flowFrom')} to="KMS · LMS · TMS" state="live" srLabel={t('auth.landing.flowLabel')} className="min-w-56 flex-1 sm:max-w-md" />
          </div>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((key, i) => (
              <li
                key={key}
                className={cn('border-border px-5 py-4', i > 0 && 'border-t', 'sm:border-t-0 sm:[&:nth-child(n+3)]:border-t lg:[&:nth-child(n+3)]:border-t-0 lg:[&:nth-child(n+5)]:border-t', 'sm:odd:border-r lg:border-r lg:[&:nth-child(4n)]:border-r-0')}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span aria-hidden className="inline-block size-2 shrink-0 rounded-[1px] bg-live" />
                  {t(`auth.landing.capabilities.${key}.name`)}
                </div>
                <p className="mt-1 pl-4 text-sm text-muted-foreground">{t(`auth.landing.capabilities.${key}.detail`)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}
