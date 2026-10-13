import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { KmLogo } from '@/components/brand/km-logo'
import { FlowLine } from '@/components/ui/flow-line'
import { cn } from '@/lib/utils'

const CAPABILITIES = [
  ['Data Source Manager', 'Connect databases, files and apps'],
  ['Connector Marketplace', 'Install the connectors you need'],
  ['Pipeline Designer', 'Map and transform data step by step'],
  ['Scheduler & Monitoring', 'Run on a schedule, follow every run'],
  ['Data Mapping & Catalog', 'One model for employees and org data'],
  ['Business Rules & Quality', 'Check data before it moves on'],
  ['Analytics & Dashboards', 'Charts on governed datasets'],
  ['Governance & AI', 'Masking, row access and an open-source assistant'],
] as const

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (session?.user) {
    redirect('/dashboard')
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2.5">
          <KmLogo className="h-9" priority />
          <span className="text-base font-semibold tracking-tight">Nexus</span>
        </span>
        <Link href="/sign-in" className={buttonVariants({ variant: 'ghost' })}>
          Sign in
        </Link>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-10 px-4 pt-6 pb-16 sm:px-6">
        <section className="max-w-2xl">
          <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">Enterprise data integration platform</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">KMPlus Nexus</h1>
          <p className="mt-4 text-lg text-pretty text-muted-foreground">
            Connect, check, govern and deliver enterprise data, HR first, to KMPlus products and the other systems you run. One platform for data pipelines, integrations and intelligence.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg', className: 'px-4' })}>
              Get started
            </Link>
            <Link href="/sign-in" className={buttonVariants({ size: 'lg', variant: 'outline', className: 'px-4' })}>
              Sign in
            </Link>
          </div>
        </section>

        <section aria-labelledby="capabilities" className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border px-5 py-4">
            <h2 id="capabilities" className="text-base font-semibold">
              What it covers
            </h2>
            <FlowLine from="HR system" to="KMS · LMS · TMS" state="live" srLabel="From your HR system to KMPlus products" className="min-w-56 flex-1 sm:max-w-md" />
          </div>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map(([name, detail], i) => (
              <li
                key={name}
                className={cn('border-border px-5 py-4', i > 0 && 'border-t', 'sm:border-t-0 sm:[&:nth-child(n+3)]:border-t lg:[&:nth-child(n+3)]:border-t-0 lg:[&:nth-child(n+5)]:border-t', 'sm:odd:border-r lg:border-r lg:[&:nth-child(4n)]:border-r-0')}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span aria-hidden className="inline-block size-2 shrink-0 rounded-[1px] bg-live" />
                  {name}
                </div>
                <p className="mt-1 pl-4 text-sm text-muted-foreground">{detail}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}
