'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Check, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getConnectorMarketplace, purchaseConnector } from '@/app/actions/connectors'

type MarketplaceConnector = Awaited<ReturnType<typeof getConnectorMarketplace>>[number]

export default function ConnectorLayer() {
  const [connectors, setConnectors] = useState<MarketplaceConnector[]>([])
  const [loading, setLoading] = useState(true)
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [error, setError] = useState('')

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

  const handleInstall = async (slug: string) => {
    setInstallingSlug(slug)
    setError('')
    try {
      await purchaseConnector(slug)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed')
    } finally {
      setInstallingSlug(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-2 text-2xl font-bold">Layer 2: Connector Marketplace</h2>
        <p className="mb-2 text-muted-foreground">
          Purchase and install connectors to unlock source types in Data Source Manager.
        </p>
        <p className="mb-6 text-sm text-muted-foreground">
          Only installed connectors appear when adding a data source. Premium connectors require purchase before install.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading marketplace…</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {connectors.map((connector) => (
              <div
                key={connector.slug}
                className="rounded-lg border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50"
              >
                <div className="font-semibold">{connector.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {connector.category} · v{connector.version}
                  {connector.premium ? ' · Premium' : ' · Included'}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{connector.description}</div>
                <div className="mt-4 flex items-center gap-2">
                  {connector.installed ? (
                    <div className="flex flex-1 items-center justify-center gap-1 rounded bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                      <Check className="h-3 w-3" />
                      Installed
                    </div>
                  ) : connector.locked ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => void handleInstall(connector.slug)}
                      disabled={installingSlug === connector.slug}
                    >
                      <Download className="mr-1 h-3 w-3" />
                      {installingSlug === connector.slug ? 'Purchasing…' : 'Purchase & Install'}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => void handleInstall(connector.slug)}
                      disabled={installingSlug === connector.slug}
                    >
                      <Download className="mr-1 h-3 w-3" />
                      {installingSlug === connector.slug ? 'Installing…' : 'Install'}
                    </Button>
                  )}
                  {connector.locked && !connector.installed && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      Locked
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Installed Connectors</div>
          <div className="mt-2 text-2xl font-bold">
            {connectors.filter((c) => c.installed).length}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Available</div>
          <div className="mt-2 text-2xl font-bold">{connectors.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Premium</div>
          <div className="mt-2 text-2xl font-bold">
            {connectors.filter((c) => c.premium).length}
          </div>
        </div>
      </div>
    </div>
  )
}
