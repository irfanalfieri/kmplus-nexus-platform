import type { Metadata } from 'next'
import { EmbeddedDashboard } from '@/components/analytics/embedded-dashboard'
import { AutoPrint } from '@/components/analytics/auto-print'
import { getDashboardData, listDashboards } from '@/lib/actions/analytics'
import { embedFilterValues } from '@/lib/analytics/sharing'
import { requirePageUser } from '@/lib/auth/session'
import { getTranslator } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false } }

/**
 * DB-5 "Export PDF": the dashboard alone, laid out for paper, opening the
 * browser's print dialog (Save as PDF). Same access as the Analytics screen;
 * the filter choices come in as `?f.<filter>=…`.
 */
export default async function PrintDashboardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  await requirePageUser(`/print/dashboards/${id}`)
  const t = await getTranslator()
  try {
    const list = await listDashboards()
    const dash = list.dashboards.find((d) => d.id === id)
    if (!dash || !list.canView) throw new Error('Dashboard not found')
    const { results, generatedAt } = await getDashboardData(id, embedFilterValues(dash.filters, query))
    return (
      <>
        <style>{'@page { size: A4 landscape; margin: 12mm } @media print { main { padding: 0 !important } article { break-inside: avoid } }'}</style>
        <EmbeddedDashboard name={dash.name} description={dash.description} widgets={dash.widgets} results={results} generatedAt={new Date(generatedAt).toISOString()} />
        <AutoPrint />
      </>
    )
  } catch (err) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground">
        <p>{err instanceof Error ? err.message : t('insights.embed.unavailable')}</p>
      </main>
    )
  }
}
