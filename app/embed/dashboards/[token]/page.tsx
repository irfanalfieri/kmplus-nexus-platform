import type { Metadata } from 'next'
import { PrefsProvider } from '@/components/i18n/i18n-provider'
import { EmbeddedDashboard } from '@/components/analytics/embedded-dashboard'
import { countEmbedView, dashboardResults, loadEmbed, parseFilters, parseWidgets } from '@/lib/analytics/dashboards'
import { embedFilterValues } from '@/lib/analytics/sharing'
import { consumeRateLimit } from '@/lib/api/rate-limit'
import { recordAudit } from '@/lib/audit'
import { isLocale, isTheme } from '@/lib/i18n/config'
import { createTranslator } from '@/lib/i18n/translate'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false }, referrer: 'no-referrer' }

const EMBED_VIEWS_PER_MINUTE = 120

/**
 * DB-5: a dashboard embedded in a KMPlus app through a secret link. Read-only,
 * queried as the embed's role (viewer or analyst: masks and row filters apply),
 * framed only by the allowed sites (CSP set in proxy.ts). `?lang=id`,
 * `?theme=dark` and `?f.<filter>=…` (lib/analytics/sharing.ts) are honoured.
 */
export default async function EmbedPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ token }, query] = await Promise.all([params, searchParams])
  const lang = typeof query.lang === 'string' && isLocale(query.lang) ? query.lang : 'en'
  const theme = typeof query.theme === 'string' && isTheme(query.theme) ? query.theme : 'system'
  const t = createTranslator(lang)
  const found = await loadEmbed(token)
  if (!found) return <Unavailable text={t('insights.embed.unavailable')} />
  const { embed, dashboard } = found
  const limit = await consumeRateLimit(`embed:${embed.id}`, EMBED_VIEWS_PER_MINUTE)
  if (!limit.allowed) return <Unavailable text={t('insights.embed.busy')} />

  const widgets = parseWidgets(dashboard.widgets)
  const filters = parseFilters(dashboard.filters)
  const values = embedFilterValues(filters, query)
  const ctx = { userId: `embed:${embed.id}`, email: '', name: embed.label || 'Embed', workspaceId: embed.workspaceId, workspaceName: '', role: embed.role }
  const results = await dashboardResults(ctx, widgets, filters, values)
  await countEmbedView(embed.id)
  await recordAudit({ userId: `embed:${embed.id}`, workspaceId: embed.workspaceId }, { action: 'VIEW_DATA', resource: 'dashboard', resourceId: dashboard.id, changes: { what: 'embed', embedId: embed.id, role: embed.role, widgets: widgets.length, filtered: Object.keys(values).length || undefined } })
  return (
    <PrefsProvider locale={lang} theme={theme}>
      <EmbeddedDashboard name={dashboard.name} description={dashboard.description ?? ''} widgets={widgets} results={results} generatedAt={new Date().toISOString()} />
    </PrefsProvider>
  )
}

function Unavailable({ text }: { text: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground">
      <p>{text}</p>
    </main>
  )
}
