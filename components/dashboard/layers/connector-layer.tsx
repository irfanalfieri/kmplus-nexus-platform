'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, Lock, Plug, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { StateMark } from '@/components/ui/flow-line'
import { useConfirm } from '@/components/ui/dialog'
import { PageHeader } from '@/components/dashboard/page-header'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { getConnectorMarketplace, installConnector, uninstallConnector } from '@/lib/actions/connectors'
import { useCan } from '@/components/workspace/workspace-context'

type MarketplaceConnector = Awaited<ReturnType<typeof getConnectorMarketplace>>[number]

export default function ConnectorLayer() {
  const { t } = usePrefs()
  const [connectors, setConnectors] = useState<MarketplaceConnector[]>([])
  const [loading, setLoading] = useState(true)
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirm, confirmEl] = useConfirm()
  const canManage = useCan('connectors:manage')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setConnectors(await getConnectorMarketplace())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connectors')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
    if (connector.locked && !(await confirm({ title: `Purchase ${connector.name}?`, description: 'This premium connector is purchased for the workspace, then installed.', confirmLabel: 'Purchase & install' }))) return
    await runAction(connector.slug, () => installConnector(connector.slug), 'Install failed')
  }
  const handleUninstall = async (connector: MarketplaceConnector) => {
    if (!(await confirm({ title: `Uninstall ${connector.name}?`, description: 'It will no longer be offered when adding a data source.', confirmLabel: 'Uninstall', tone: 'danger' }))) return
    await runAction(connector.slug, () => uninstallConnector(connector.slug), 'Uninstall failed')
  }
  const billing = connectors[0]?.billing ?? false
  const hasLocked = connectors.some((c) => c.locked && !c.installed)
  const installedCount = connectors.filter((c) => c.installed).length
  const premiumCount = connectors.filter((c) => c.premium).length

  return (
    <div className="space-y-5">
      {confirmEl}
      <PageHeader
        title={t('pages.connectors.title')}
        description={t('pages.connectors.description')}
        meta={loading && connectors.length === 0 ? undefined : `${installedCount} installed · ${connectors.length} available · ${premiumCount} premium`}
      />

      <p className="max-w-3xl text-sm text-muted-foreground">
        Install connectors to unlock source types in Data sources. Only installed connectors appear when adding a data source.
      </p>

      {!canManage && (
        <Notice tone="info" live={false}>
          Only workspace admins can install or uninstall connectors.
        </Notice>
      )}
      {billing && hasLocked && (
        <Notice tone="info" live={false}>
          Premium connectors require purchase before install.
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      {loading && connectors.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-sm text-muted-foreground" role="status">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Loading connectors…
        </div>
      ) : connectors.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={<Plug />} title="No connectors available">
            No connectors are offered to this workspace yet.
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {connectors.map((connector) => {
            const busy = installingSlug === connector.slug
            return (
              <li key={connector.slug} className="flex flex-col rounded-lg border border-border bg-card p-4">
                <h2 className="font-semibold">{connector.name}</h2>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {connector.category} · v{connector.version}
                  {connector.premium ? ' · Premium' : ' · Included'}
                </div>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">{connector.description}</p>
                <div className="mt-4 flex min-h-8 items-center gap-2">
                  {connector.installed ? (
                    <>
                      <StateMark state="live" className="mr-auto">
                        Installed
                      </StateMark>
                      {canManage && (
                        <Button size="icon-sm" variant="ghost" onClick={() => void handleUninstall(connector)} disabled={busy} aria-label={`Uninstall ${connector.name}`} title="Uninstall">
                          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <StateMark state="idle" className="mr-auto">
                        Not installed
                      </StateMark>
                      {connector.locked && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Lock className="size-3" aria-hidden />
                          Locked
                        </span>
                      )}
                      {canManage && (
                        <Button size="sm" variant="outline" onClick={() => void handleInstall(connector)} disabled={busy}>
                          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
                          {connector.locked ? (busy ? 'Purchasing…' : 'Purchase & install') : busy ? 'Installing…' : 'Install'}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
