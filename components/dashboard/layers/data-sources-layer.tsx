'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, CheckCircle2, AlertCircle, X, Save, Edit, Eye, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ConnectorCredentialForm from '@/components/connectors/connector-credential-form'
import SchemaExplorerModal from '@/components/modals/schema-explorer-modal'
import { CONNECTOR_CATALOG, getConnectorDefinition } from '@/lib/connectors/catalog'
import { REST_DEFAULTS, validateRestCredentials } from '@/lib/connectors/rest-client'
import { validateSalesforceCredentials } from '@/lib/connectors/salesforce/oauth'
import { SALESFORCE_DEFAULTS } from '@/components/connectors/salesforce-connector-form'
import type { SchemaScanResult } from '@/lib/connectors/types'
import { createDataSource, deleteDataSource, getDataSources } from '@/app/actions/data-sources'
import { getInstalledConnectorSlugs } from '@/app/actions/connectors'
import { previewRestConnection, testAndScanDataSource } from '@/app/actions/connector-source'
import type { RestRequestPreview } from '@/lib/connectors/rest-client'

type DataSourceRow = {
  id: string
  name: string
  type: string
  sourceType: string
  role?: 'source' | 'destination'
  status: string
  lastConnected: string | Date | null
  config?: Record<string, unknown> | null
}

function formatLastConnected(value: string | Date | null) {
  if (!value) return 'Never'
  if (typeof value === 'string') return value
  const diffMs = Date.now() - value.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return value.toLocaleDateString()
}

function credentialsValid(slug: string, values: Record<string, string>) {
  if (slug === 'rest') return validateRestCredentials(values)
  if (slug === 'salesforce') return validateSalesforceCredentials(values)
  const def = getConnectorDefinition(slug)
  if (!def) return false
  return def.credentialFields
    .filter((f) => f.required)
    .every((f) => Boolean(values[f.key]?.trim()))
}

function defaultCredentialsForConnector(slug: string): Record<string, string> {
  if (slug === 'rest') {
    return Object.fromEntries(
      Object.entries(REST_DEFAULTS).map(([key, value]) => [key, String(value)])
    )
  }
  if (slug === 'salesforce') {
    return { ...SALESFORCE_DEFAULTS }
  }
  return {}
}

export default function DataSourcesLayer() {
  const [sources, setSources] = useState<DataSourceRow[]>([])
  const [installedSlugs, setInstalledSlugs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newSourceRole, setNewSourceRole] = useState<'source' | 'destination'>('source')
  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceType, setNewSourceType] = useState('')
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({})
  const [connectionTested, setConnectionTested] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [connectionMessage, setConnectionMessage] = useState('')
  const [pendingSchemaScan, setPendingSchemaScan] = useState<SchemaScanResult | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [restPreview, setRestPreview] = useState<RestRequestPreview | null>(null)
  const [restSending, setRestSending] = useState(false)

  const installedConnectors = useMemo(
    () => CONNECTOR_CATALOG.filter((c) => installedSlugs.includes(c.slug)),
    [installedSlugs]
  )

  const selectedConnector = newSourceType ? getConnectorDefinition(newSourceType) : undefined
  const fieldsValid = newSourceType ? credentialsValid(newSourceType, credentialValues) : false

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, slugs] = await Promise.all([getDataSources(), getInstalledConnectorSlugs()])
      setInstalledSlugs(slugs)
      setSources(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          sourceType: row.sourceType,
          role: (row.config as { role?: 'source' | 'destination' })?.role,
          status: row.status ?? 'disconnected',
          lastConnected: row.lastConnected,
          config: row.config as Record<string, unknown> | null,
        }))
      )
    } catch {
      setSources([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const resetForm = () => {
    setNewSourceName('')
    setNewSourceType('')
    setCredentialValues({})
    setConnectionTested(false)
    setConnectionError('')
    setConnectionMessage('')
    setPendingSchemaScan(null)
    setRestPreview(null)
  }

  const sendRestPreview = async () => {
    if (!fieldsValid) {
      setConnectionError('Fill required fields before sending.')
      return
    }
    setRestSending(true)
    setConnectionError('')
    try {
      const preview = await previewRestConnection(credentialValues)
      setRestPreview(preview)
      if (!preview.ok) setConnectionError(preview.message)
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setRestSending(false)
    }
  }

  const testNewConnection = async () => {
    if (!newSourceType || !fieldsValid) {
      setConnectionError('Fill all required connector fields before testing.')
      return
    }

    setTestingConnection(true)
    setConnectionError('')
    setConnectionMessage('')
    setConnectionTested(false)
    setPendingSchemaScan(null)
    setRestPreview(null)

    try {
      const result = await testAndScanDataSource(newSourceType, credentialValues)
      if ('preview' in result && result.preview) {
        setRestPreview(result.preview as RestRequestPreview)
      }
      if (!result.ok) {
        setConnectionError(result.message)
        return
      }

      setPendingSchemaScan(result.scan)
      setConnectionMessage(
        `Connected. Found ${result.scan.tables.length} objects via ${result.scan.method}.`
      )
      setConnectionTested(true)
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Connection test failed')
    } finally {
      setTestingConnection(false)
    }
  }

  const addSource = async () => {
    if (!newSourceName || !newSourceType || !fieldsValid || !connectionTested) return

    try {
      const connector = getConnectorDefinition(newSourceType)
      await createDataSource({
        name: newSourceName,
        type: connector?.category.toLowerCase() ?? newSourceType,
        sourceType: newSourceType,
        config: {
          role: newSourceRole,
          ...(pendingSchemaScan ? { schemaScan: pendingSchemaScan } : {}),
        },
        credentials: credentialValues,
      })

      resetForm()
      setShowAddForm(false)
      await loadAll()
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Failed to create data source')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteDataSource(id)
      await loadAll()
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Failed to delete source')
    }
  }

  const selectedSource = selectedSourceId ? sources.find((s) => s.id === selectedSourceId) : null
  const selectedSchemaScan = selectedSource?.config?.schemaScan as SchemaScanResult | undefined

  return (
    <div className="space-y-6">
      <SchemaExplorerModal
        isOpen={explorerOpen}
        sourceId={selectedSourceId || ''}
        sourceName={selectedSource?.name || ''}
        sourceType={selectedSource?.sourceType || ''}
        initialScan={selectedSchemaScan ?? null}
        onClose={() => {
          setExplorerOpen(false)
          setSelectedSourceId(null)
          void loadAll()
        }}
        onProceed={() => setExplorerOpen(false)}
      />

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Layer 1: Data Source Manager</h2>
            <p className="mt-2 text-muted-foreground">
              Add sources using installed connectors from the marketplace.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setNewSourceRole('source')
                setShowAddForm(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Source
            </Button>
            <Button
              onClick={() => {
                setNewSourceRole('destination')
                setShowAddForm(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Destination
            </Button>
          </div>
        </div>

        {showAddForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
              className={`max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-lg border border-border bg-card p-6 ${
                newSourceType === 'rest' ? 'max-w-4xl' : newSourceType === 'salesforce' ? 'max-w-xl' : 'max-w-lg'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  Add New {newSourceRole === 'destination' ? 'Destination' : 'Data'} Source
                </h3>
                <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); resetForm() }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <Input
                placeholder="Source name"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
              />

              <Select
                value={newSourceType}
                onValueChange={(value) => {
                  setNewSourceType(value || '')
                  setCredentialValues(value ? defaultCredentialsForConnector(value) : {})
                  setConnectionTested(false)
                  setConnectionError('')
                  setConnectionMessage('')
                  setPendingSchemaScan(null)
                  setRestPreview(null)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Connector / source type" />
                </SelectTrigger>
                <SelectContent>
                  {installedConnectors.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {installedConnectors.length === 0 && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4" />
                  Install connectors from Layer 2: Connector Marketplace first.
                </p>
              )}

              {selectedConnector && (
                <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
                  <p className="text-sm font-medium">
                    {selectedConnector.name}
                    {newSourceType === 'rest'
                      ? ' — scheme, auth & connection'
                      : newSourceType === 'salesforce'
                        ? ' — OAuth web login'
                        : ' credentials'}
                  </p>
                  <ConnectorCredentialForm
                    connectorSlug={newSourceType}
                    fields={selectedConnector.credentialFields}
                    values={credentialValues}
                    onChange={(key, value) => {
                      setCredentialValues((prev) => ({ ...prev, [key]: value }))
                      setConnectionTested(false)
                      setRestPreview(null)
                    }}
                    restPreview={restPreview}
                    restSending={restSending}
                    onRestSend={newSourceType === 'rest' ? () => void sendRestPreview() : undefined}
                  />
                </div>
              )}

              {connectionError && <p className="text-sm text-destructive">{connectionError}</p>}
              {connectionTested && connectionMessage && (
                <p className="text-sm text-green-600">{connectionMessage}</p>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={testingConnection || !newSourceType}
                  onClick={() => void testNewConnection()}
                >
                  {testingConnection ? 'Testing…' : 'Test Connection'}
                </Button>
                <Button className="flex-1" disabled={!connectionTested} onClick={() => void addSource()}>
                  <Save className="mr-2 h-4 w-4" />
                  Create
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => { setShowAddForm(false); resetForm() }}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading data sources…</p>
        ) : sources.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No data sources yet. Install a connector, then add your first source.
          </p>
        ) : (
          <div className="grid gap-3">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 p-4"
              >
                <div>
                  <div className="font-medium">{source.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {getConnectorDefinition(source.sourceType)?.name ?? source.sourceType.toUpperCase()} · Last:{' '}
                    {formatLastConnected(source.lastConnected)}
                    {source.config?.schemaScan
                      ? ` · ${(source.config.schemaScan as SchemaScanResult).tables.length} objects`
                      : null}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {source.status === 'connected' ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle2 className="h-4 w-4" /> Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-orange-600">
                      <AlertCircle className="h-4 w-4" /> Disconnected
                    </span>
                  )}
                  {source.status === 'connected' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedSourceId(source.id)
                        setExplorerOpen(true)
                      }}
                    >
                      <Eye className="mr-1 h-4 w-4" />
                      Schema & Data
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(source.id)
                      setEditName(source.name)
                    }}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleDelete(source.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
