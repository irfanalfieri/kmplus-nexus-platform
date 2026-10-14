'use client'

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppWindow, Boxes, Braces, Database, Download, FileSpreadsheet, KeyRound, Loader2, Lock, Plug, Search, Server, Trash2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { StateMark } from '@/components/ui/flow-line'
import { useConfirm } from '@/components/ui/dialog'
import { PageHeader } from '@/components/dashboard/page-header'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { getConnectorMarketplace, installConnector, uninstallConnector } from '@/lib/actions/connectors'
import { useCan } from '@/components/workspace/workspace-context'
import { CONNECTOR_GROUPS, type ConnectorGroup } from '@/lib/connectors/types'
import { connectorMatches, groupConnectors, isConnectorGroup } from '@/lib/connectors/search'
import { cn } from '@/lib/utils'
import type { MessageKey } from '@/lib/i18n/translate'

type MarketplaceConnector = Awaited<ReturnType<typeof getConnectorMarketplace>>[number]

const GROUP_ICONS: Record<ConnectorGroup, ReactNode> = {
  applications: <AppWindow aria-hidden />,
  kmplus: <Boxes aria-hidden />,
  databases: <Database aria-hidden />,
  apis: <Braces aria-hidden />,
  files: <FileSpreadsheet aria-hidden />,
  infrastructure: <Server aria-hidden />,
  identity: <Users aria-hidden />,
  secrets: <KeyRound aria-hidden />,
}

const chipClass = (active: boolean) =>
  cn(
    'inline-flex h-8 items-center gap-2 rounded-sm border px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    active ? 'border-live bg-accent font-medium text-accent-foreground shadow-[inset_0_-2px_0_var(--live)]' : 'border-border bg-card text-foreground hover:bg-muted',
  )

export default function ConnectorLayer() {
  const { t, formatNumber } = usePrefs()
  const params = useSearchParams()
  const [connectors, setConnectors] = useState<MarketplaceConnector[]>([])
  const [loading, setLoading] = useState(true)
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const [group, setGroup] = useState<ConnectorGroup | null>(() => {
    const g = params.get('group')
    return isConnectorGroup(g) ? g : null
  })
  const [confirm, confirmEl] = useConfirm()
  const canManage = useCan('connectors:manage')
  const uid = useId()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setConnectors(await getConnectorMarketplace())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.connectors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // The search and category live in the URL (shareable, survive reload) without a server round trip per keystroke.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (query.trim()) url.searchParams.set('q', query.trim())
    else url.searchParams.delete('q')
    if (group) url.searchParams.set('group', group)
    else url.searchParams.delete('group')
    if (url.toString() !== window.location.href) window.history.replaceState(window.history.state, '', url)
  }, [query, group])

  const runAction = async (slug: string, action: () => Promise<unknown>, fallback: string) => {
    setInstallingSlug(slug)
    setError('')
    try {
      await action()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
    } finally {
      setInstallingSlug(null)
    }
  }
  const handleInstall = async (connector: MarketplaceConnector) => {
    if (connector.locked && !(await confirm({ title: t('ops.connectors.purchaseTitle', { name: connector.name }), description: t('ops.connectors.purchaseBody'), confirmLabel: t('ops.connectors.purchaseInstall') }))) return
    await runAction(connector.slug, () => installConnector(connector.slug), t('ops.connectors.installFailed'))
  }
  const handleUninstall = async (connector: MarketplaceConnector) => {
    if (!(await confirm({ title: t('ops.connectors.uninstallTitle', { name: connector.name }), description: t('ops.connectors.uninstallBody'), confirmLabel: t('ops.connectors.uninstall'), tone: 'danger' }))) return
    await runAction(connector.slug, () => uninstallConnector(connector.slug), t('ops.connectors.uninstallFailed'))
  }
  // Catalog categories and descriptions have translations by name/slug; anything new shows as the catalog wrote it.
  const tOr = useCallback(
    (key: string, fallback: string) => {
      const text = t(key as MessageKey)
      return text === key ? fallback : text
    },
    [t],
  )
  const groupLabel = useCallback((g: ConnectorGroup) => t(`ops.connectors.groups.${g}.label` as MessageKey), [t])

  // Matches for the search (in the reader's language too), then the chosen category.
  const matches = useMemo(
    () =>
      connectors.filter((c) =>
        connectorMatches(c, query, [tOr(`ops.connectors.descriptions.${c.slug}`, ''), tOr(`ops.connectors.categories.${c.category}`, ''), groupLabel(c.group)]),
      ),
    [connectors, query, tOr, groupLabel],
  )
  const groupCounts = useMemo(() => Object.fromEntries(CONNECTOR_GROUPS.map((g) => [g, matches.filter((c) => c.group === g).length])) as Record<ConnectorGroup, number>, [matches])
  const shown = useMemo(() => (group ? matches.filter((c) => c.group === group) : matches), [matches, group])
  const sections = useMemo(() => groupConnectors(shown), [shown])

  const billing = connectors[0]?.billing ?? false
  const hasLocked = connectors.some((c) => c.locked && !c.installed)
  const installedCount = connectors.filter((c) => c.installed).length
  const premiumCount = connectors.filter((c) => c.premium).length
  const filtered = Boolean(query.trim()) || group !== null

  return (
    <div className="space-y-5">
      {confirmEl}
      <PageHeader
        title={t('pages.connectors.title')}
        description={t('pages.connectors.description')}
        meta={loading && connectors.length === 0 ? undefined : t('ops.connectors.meta', { installed: formatNumber(installedCount), available: formatNumber(connectors.length), premium: formatNumber(premiumCount) })}
      />

      <p className="max-w-3xl text-sm text-muted-foreground">{t('ops.connectors.intro')}</p>

      {!canManage && (
        <Notice tone="info" live={false}>
          {t('ops.connectors.adminsOnly')}
        </Notice>
      )}
      {billing && hasLocked && (
        <Notice tone="info" live={false}>
          {t('ops.connectors.premiumNotice')}
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      {loading && connectors.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-sm text-muted-foreground" role="status">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> {t('ops.connectors.loading')}
        </div>
      ) : connectors.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={<Plug />} title={t('ops.connectors.emptyTitle')}>
            {t('ops.connectors.emptyBody')}
          </EmptyState>
        </div>
      ) : (
        <>
          <div data-tour="connectors-find" className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id={`${uid}-search`}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && query) {
                      e.preventDefault()
                      setQuery('')
                    }
                  }}
                  placeholder={t('ops.connectors.searchPlaceholder')}
                  aria-label={t('ops.connectors.searchLabel')}
                  className="pr-8 pl-8"
                  autoComplete="off"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label={t('ops.connectors.clearSearch')}
                    className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
              <p role="status" className="font-mono text-xs text-muted-foreground">
                {filtered ? t('ops.connectors.showing', { shown: formatNumber(shown.length), total: formatNumber(connectors.length) }) : ''}
              </p>
            </div>
            <div role="group" aria-label={t('ops.connectors.groupsLabel')} className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={group === null} onClick={() => setGroup(null)} className={chipClass(group === null)}>
                {t('ops.connectors.all')}
                <span className="font-mono text-xs text-muted-foreground">{formatNumber(matches.length)}</span>
              </button>
              {CONNECTOR_GROUPS.filter((g) => connectors.some((c) => c.group === g)).map((g) => (
                <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(group === g ? null : g)} className={cn(chipClass(group === g), group !== g && groupCounts[g] === 0 && 'text-muted-foreground')}>
                  {groupLabel(g)}
                  <span className="font-mono text-xs text-muted-foreground">{formatNumber(groupCounts[g])}</span>
                </button>
              ))}
            </div>
          </div>

          {sections.length === 0 ? (
            <div className="rounded-lg border border-border bg-card">
              <EmptyState
                icon={<Search />}
                title={query.trim() ? t('ops.connectors.noMatchTitle', { query: query.trim() }) : t('ops.connectors.noneInGroup')}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {query && (
                      <Button size="sm" variant="outline" onClick={() => setQuery('')}>
                        {t('ops.connectors.clearSearch')}
                      </Button>
                    )}
                    {group && (
                      <Button size="sm" variant="outline" onClick={() => setGroup(null)}>
                        {t('ops.connectors.showAll')}
                      </Button>
                    )}
                  </div>
                }
              >
                {t('ops.connectors.noMatchBody')}
              </EmptyState>
            </div>
          ) : (
            <div className="space-y-8">
              {sections.map((section) => (
                <section key={section.group} aria-labelledby={`${uid}-${section.group}`} className="space-y-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-2">
                    <h2 id={`${uid}-${section.group}`} className="flex items-center gap-2 text-sm font-semibold [&>svg]:size-4 [&>svg]:text-primary">
                      {GROUP_ICONS[section.group]}
                      {groupLabel(section.group)}
                      <span className="font-mono text-xs font-normal text-muted-foreground">{formatNumber(section.items.length)}</span>
                    </h2>
                    <p className="text-xs text-muted-foreground">{t(`ops.connectors.groups.${section.group}.description` as MessageKey)}</p>
                  </div>
                  <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {section.items.map((connector) => {
                      const busy = installingSlug === connector.slug
                      return (
                        <li key={connector.slug} className="flex flex-col rounded-lg border border-border bg-card p-4">
                          <h3 className="font-semibold">{connector.name}</h3>
                          <div className="mt-1 font-mono text-xs text-muted-foreground">
                            {tOr(`ops.connectors.categories.${connector.category}`, connector.category)} · v{connector.version}
                            {' · '}
                            {connector.premium ? t('ops.connectors.premium') : t('ops.connectors.included')}
                          </div>
                          <p className="mt-2 flex-1 text-sm text-muted-foreground">{tOr(`ops.connectors.descriptions.${connector.slug}`, connector.description)}</p>
                          <div className="mt-4 flex min-h-8 items-center gap-2">
                            {connector.installed ? (
                              <>
                                <StateMark state="live" className="mr-auto">
                                  {t('ops.connectors.installed')}
                                </StateMark>
                                {canManage && (
                                  <Button size="icon-sm" variant="ghost" onClick={() => void handleUninstall(connector)} disabled={busy} aria-label={t('ops.connectors.uninstallNamed', { name: connector.name })} title={t('ops.connectors.uninstall')}>
                                    {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                                  </Button>
                                )}
                              </>
                            ) : (
                              <>
                                <StateMark state="idle" className="mr-auto">
                                  {t('ops.connectors.notInstalled')}
                                </StateMark>
                                {connector.locked && (
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Lock className="size-3" aria-hidden />
                                    {t('ops.connectors.locked')}
                                  </span>
                                )}
                                {canManage && (
                                  <Button size="sm" variant="outline" onClick={() => void handleInstall(connector)} disabled={busy}>
                                    {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
                                    {connector.locked ? (busy ? t('ops.connectors.purchasing') : t('ops.connectors.purchaseInstall')) : busy ? t('ops.connectors.installing') : t('ops.connectors.install')}
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
