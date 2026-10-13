'use client'

import { AiConnectorSuggest } from '@/components/ai/ai-connector-suggest'
import { suggestConnector } from '@/lib/actions/ai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Database, Eye, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import EditCredentialsDialog from '@/components/connectors/edit-credentials-dialog'
import { useCan } from '@/components/workspace/workspace-context'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog, Modal } from '@/components/ui/dialog'
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/data-table'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { StateMark } from '@/components/ui/flow-line'
import { useToast } from '@/components/ui/toast'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ConnectorCredentialForm from '@/components/connectors/connector-credential-form'
import SchemaExplorerModal from '@/components/modals/schema-explorer-modal'
import FileUploadDialog from '@/components/data-sources/file-upload-dialog'
import { PageHeader } from '@/components/dashboard/page-header'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { usePrefs } from '@/components/i18n/i18n-provider'
import type { UploadedFile } from '@/app/actions/files'
import { CONNECTOR_CATALOG, getConnectorDefinition } from '@/lib/connectors/catalog'
import { REST_DEFAULTS, validateRestCredentials } from '@/lib/connectors/rest/config'
import { validateSalesforceCredentials } from '@/lib/connectors/salesforce/oauth'
import { SALESFORCE_DEFAULTS } from '@/components/connectors/salesforce-connector-form'
import type { SchemaScanResult } from '@/lib/connectors/types'
import { createDataSource, deleteDataSource, getDataSources, renameDataSource, setDataSourceRole, testConnection } from '@/lib/actions/data-sources'
import { getInstalledConnectorSlugs } from '@/lib/actions/connectors'
import { previewRestConnection, testAndScanDataSource } from '@/lib/actions/connector-source'
import type { RestRequestPreview } from '@/lib/connectors/rest/config'

type Role = 'source' | 'destination'
type DataSourceRow = {
  id: string
  name: string
  type: string
  sourceType: string
  role?: Role
  status: string
  lastConnected: string | Date | null
  config?: Record<string, unknown> | null
}

function credentialsValid(slug: string, values: Record<string, string>) {
  if (slug === 'rest') return validateRestCredentials(values)
  if (slug === 'salesforce') return validateSalesforceCredentials(values)
  const def = getConnectorDefinition(slug)
  if (!def) return false
  return def.credentialFields.filter((f) => f.required).every((f) => Boolean(values[f.key]?.trim()))
}

function defaultCredentialsForConnector(slug: string): Record<string, string> {
  if (slug === 'rest') return Object.fromEntries(Object.entries(REST_DEFAULTS).map(([key, value]) => [key, String(value)]))
  if (slug === 'salesforce') return { ...SALESFORCE_DEFAULTS }
  return {}
}

export default function DataSourcesLayer() {
  const { t, formatDateTime } = usePrefs()
  const toast = useToast()
  const [sources, setSources] = useState<DataSourceRow[]>([])
  const [installedSlugs, setInstalledSlugs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<Role | null>(null)
  const [renaming, setRenaming] = useState<DataSourceRow | null>(null)
  const [editName, setEditName] = useState('')
  const [listError, setListError] = useState('')
  const [deleting, setDeleting] = useState<DataSourceRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [credentialsFor, setCredentialsFor] = useState<{ id: string; name: string } | null>(null)
  const canManage = useCan('sources:manage')
  const canPreview = useCan('data:preview')
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [uploadFor, setUploadFor] = useState<string | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)

  const installedConnectors = useMemo(() => CONNECTOR_CATALOG.filter((c) => installedSlugs.includes(c.slug)), [installedSlugs])

  const ago = (value: string | Date | null) => {
    if (!value) return t('common.never')
    const d = new Date(value)
    const minutes = Math.floor((Date.now() - d.getTime()) / 60000)
    if (minutes < 1) return t('sources.justNow')
    if (minutes < 60) return t('sources.minutesAgo', { count: minutes })
    if (minutes < 24 * 60) return t('sources.hoursAgo', { count: Math.floor(minutes / 60) })
    return formatDateTime(d, { dateStyle: 'medium', timeStyle: undefined })
  }

  // Initial state is loading; later refreshes update the list in place (no flicker).
  const loadAll = useCallback(async () => {
    try {
      const [rows, slugs] = await Promise.all([getDataSources(), getInstalledConnectorSlugs()])
      setInstalledSlugs(slugs)
      setSources(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          sourceType: row.sourceType,
          role: (row.config as { role?: Role })?.role,
          status: row.status ?? 'disconnected',
          lastConnected: row.lastConnected,
          config: row.config as Record<string, unknown> | null,
        })),
      )
      setListError('')
    } catch (err) {
      setListError(err instanceof Error ? err.message : t('common.somethingWrong'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const runListAction = async (key: string, action: () => Promise<unknown>, done?: string) => {
    setListError('')
    setBusy(key)
    try {
      await action()
      if (done) toast({ message: done })
      await loadAll()
      return true
    } catch (err) {
      setListError(err instanceof Error ? err.message : t('common.somethingWrong'))
      return false
    } finally {
      setBusy(null)
    }
  }

  const roleLabel = (role: Role) => (role === 'destination' ? t('sources.roleDestination') : t('sources.roleSource'))
  const selectedSource = selectedSourceId ? sources.find((s) => s.id === selectedSourceId) : null
  const selectedSchemaScan = selectedSource?.config?.schemaScan as SchemaScanResult | undefined

  return (
    <div>
      {credentialsFor && (
        <EditCredentialsDialog
          sourceId={credentialsFor.id}
          sourceName={credentialsFor.name}
          onClose={() => setCredentialsFor(null)}
          onSaved={() => {
            setCredentialsFor(null)
            void loadAll()
          }}
        />
      )}
      {uploadFor &&
        (() => {
          const src = sources.find((x) => x.id === uploadFor)
          return src ? (
            <FileUploadDialog sourceId={src.id} sourceName={src.name} files={(src.config?.files ?? []) as UploadedFile[]} onClose={() => setUploadFor(null)} onDone={() => void loadAll()} />
          ) : null
        })()}
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
      {adding && (
        <AddSourceDialog
          role={adding}
          connectors={installedConnectors}
          onClose={() => setAdding(null)}
          onCreated={async (name) => {
            setAdding(null)
            toast({ message: name })
            await loadAll()
          }}
        />
      )}
      {renaming && (
        <Modal
          onClose={() => setRenaming(null)}
          dirty={editName !== renaming.name}
          size="sm"
          title={t('sources.rename')}
          footer={
            <>
              <Button variant="outline" onClick={() => setRenaming(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                form="rename-source"
                disabled={busy === 'rename' || !editName.trim() || editName === renaming.name}
              >
                {busy === 'rename' ? <Loader2 className="animate-spin" /> : <Save />} {t('common.save')}
              </Button>
            </>
          }
        >
          <form
            id="rename-source"
            onSubmit={(e) => {
              e.preventDefault()
              void runListAction('rename', () => renameDataSource(renaming.id, editName), t('sources.renamed')).then((ok) => ok && setRenaming(null))
            }}
          >
            <Label htmlFor="rename-source-name" className="mb-1.5 block">
              {t('sources.renameLabel', { name: renaming.name })}
            </Label>
            <Input id="rename-source-name" autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} />
          </form>
        </Modal>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('sources.removeTitle', { name: deleting?.name ?? '' })}
        description={t('sources.removeBody')}
        confirmLabel={t('sources.remove')}
        tone="danger"
        busy={busy === 'delete'}
        onConfirm={async () => {
          if (!deleting) return
          const name = deleting.name
          await runListAction('delete', () => deleteDataSource(deleting.id), t('sources.removed', { name }))
          setDeleting(null)
        }}
      />

      <PageHeader
        title={t('pages.sources.title')}
        description={t('pages.sources.description')}
        meta={!loading && sources.length > 0 ? t('sources.summary', { count: sources.length }) : undefined}
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setAdding('destination')}>
                <Plus /> {t('sources.addDestination')}
              </Button>
              <Button onClick={() => setAdding('source')}>
                <Plus /> {t('sources.addSource')}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="space-y-4">
        {!canManage && (
          <Notice tone="info" live={false}>
            {t('sources.adminOnly')}
          </Notice>
        )}
        {listError && <Notice tone="danger">{listError}</Notice>}

        <section aria-label={t('pages.sources.title')} className="rounded-lg border border-border bg-card">
          {loading ? (
            <p className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
            </p>
          ) : sources.length === 0 ? (
            <EmptyState
              icon={<Database />}
              title={t('sources.emptyTitle')}
              action={
                canManage ? (
                  installedConnectors.length ? (
                    <Button onClick={() => setAdding('source')}>
                      <Plus /> {t('sources.addSource')}
                    </Button>
                  ) : (
                    <Link href="/dashboard/connectors" className={buttonVariants()}>
                      {t('sources.openConnectors')}
                    </Link>
                  )
                ) : undefined
              }
            >
              {t('sources.emptyBody')}
            </EmptyState>
          ) : (
            <Table label={t('pages.sources.title')} className="min-w-[760px]">
              <THead>
                <tr>
                  <Th>{t('sources.colName')}</Th>
                  <Th>{t('sources.colRole')}</Th>
                  <Th>{t('sources.colStatus')}</Th>
                  <Th className="text-right">{t('sources.colTables')}</Th>
                  <Th>{t('sources.colChecked')}</Th>
                  <Th className="text-right">
                    <span className="sr-only">{t('common.edit')}</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {sources.map((source) => {
                  const role: Role = source.role ?? 'source'
                  const connected = source.status === 'connected'
                  const scan = source.config?.schemaScan as SchemaScanResult | undefined
                  return (
                    <Tr key={source.id}>
                      <Td>
                        <div className="font-medium">{source.name}</div>
                        <div className="text-xs text-muted-foreground">{getConnectorDefinition(source.sourceType)?.name ?? source.sourceType.toUpperCase()}</div>
                      </Td>
                      <Td>
                        {canManage ? (
                          <select
                            value={role}
                            disabled={busy !== null}
                            onChange={(e) => {
                              const next = e.target.value as Role
                              void runListAction(`role:${source.id}`, () => setDataSourceRole(source.id, next), t('sources.roleChanged', { name: source.name, role: roleLabel(next).toLowerCase() }))
                            }}
                            className={nativeSelectClass}
                            aria-label={t('sources.roleOf', { name: source.name })}
                          >
                            <option value="source">{t('sources.roleSource')}</option>
                            <option value="destination">{t('sources.roleDestination')}</option>
                          </select>
                        ) : (
                          roleLabel(role)
                        )}
                      </Td>
                      <Td>
                        {busy === `test:${source.id}` ? (
                          <StateMark state="running">{t('sources.testing')}</StateMark>
                        ) : (
                          <StateMark state={connected ? 'live' : source.status === 'error' ? 'tripped' : 'idle'}>{connected ? t('sources.connected') : source.status === 'error' ? t('sources.error') : t('sources.disconnected')}</StateMark>
                        )}
                      </Td>
                      <Td className="text-right font-mono text-xs">{scan ? scan.tables.length : '—'}</Td>
                      <Td className="font-mono text-xs text-muted-foreground">{ago(source.lastConnected)}</Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {canManage && source.sourceType === 'file' && (
                            <Button size="sm" variant="outline" onClick={() => setUploadFor(source.id)} aria-label={t('sources.uploadFor', { name: source.name })}>
                              <Upload /> {t('sources.upload')}
                            </Button>
                          )}
                          {connected && canPreview && (
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={t('sources.browseFor', { name: source.name })}
                              onClick={() => {
                                setSelectedSourceId(source.id)
                                setExplorerOpen(true)
                              }}
                            >
                              <Eye /> {t('sources.browse')}
                            </Button>
                          )}
                          {canManage && (
                            <Menu>
                              <MenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t('sources.more', { name: source.name })} />}>
                                <MoreHorizontal />
                              </MenuTrigger>
                              <MenuContent>
                                <MenuItem disabled={busy !== null} onClick={() => void runListAction(`test:${source.id}`, () => testConnection(source.id), t('sources.retested', { name: source.name }))}>
                                  <RefreshCw aria-hidden /> {t('sources.test')}
                                </MenuItem>
                                {source.sourceType !== 'file' && (
                                  <MenuItem onClick={() => setCredentialsFor({ id: source.id, name: source.name })}>
                                    <KeyRound aria-hidden /> {t('sources.editCredentials')}
                                  </MenuItem>
                                )}
                                <MenuItem
                                  onClick={() => {
                                    setEditName(source.name)
                                    setRenaming(source)
                                  }}
                                >
                                  <Pencil aria-hidden /> {t('sources.rename')}
                                </MenuItem>
                                <MenuSeparator />
                                <MenuItem onClick={() => setDeleting(source)} className="text-danger-text [&_svg]:text-danger-text!">
                                  <Trash2 aria-hidden /> {t('sources.remove')}
                                </MenuItem>
                              </MenuContent>
                            </Menu>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </TBody>
            </Table>
          )}
        </section>
      </div>
    </div>
  )
}

/** Name → connector → credentials → test → create. Creating needs a passing test. */
function AddSourceDialog({
  role,
  connectors,
  onClose,
  onCreated,
}: {
  role: Role
  connectors: typeof CONNECTOR_CATALOG
  onClose: () => void
  onCreated: (message: string) => void | Promise<void>
}) {
  const { t } = usePrefs()
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [tested, setTested] = useState(false)
  const [testing, setTesting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [scan, setScan] = useState<SchemaScanResult | null>(null)
  const [restPreview, setRestPreview] = useState<RestRequestPreview | null>(null)
  const [restSending, setRestSending] = useState(false)
  const [hint, setHint] = useState<{ slug: string; name: string; reason: string; installed: boolean } | null>(null)
  const connector = type ? getConnectorDefinition(type) : undefined

  // A failed test: does the error look like a different system? (rules only, never waits for a model)
  const checkError = async (message: string) => {
    try {
      const res = await suggestConnector({ text: message, rulesOnly: true })
      const top = res.suggestions.find((x) => x.confidence === 'high' && x.slug !== type)
      setHint(top ? { slug: top.slug, name: top.name, reason: top.reason, installed: top.installed } : null)
    } catch {
      setHint(null)
    }
  }
  const valid = type ? credentialsValid(type, values) : false
  const dirty = Boolean(name || type)

  const sendRestPreview = async () => {
    if (!valid) return setError(t('sources.fillBeforeSend'))
    setRestSending(true)
    setError('')
    try {
      const preview = await previewRestConnection(values)
      setRestPreview(preview)
      if (!preview.ok) setError(preview.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sources.requestFailed'))
    } finally {
      setRestSending(false)
    }
  }

  const test = async () => {
    if (!type || !valid) return setError(t('sources.fillRequired'))
    setTesting(true)
    setError('')
    setMessage('')
    setTested(false)
    setScan(null)
    setRestPreview(null)
    setHint(null)
    try {
      const result = await testAndScanDataSource(type, values)
      if ('preview' in result && result.preview) setRestPreview(result.preview as RestRequestPreview)
      if (!result.ok) {
        setError(result.message)
        void checkError(result.message)
        return
      }
      setScan(result.scan)
      setMessage(t('sources.connectedFound', { count: result.scan.tables.length, method: result.scan.method }))
      setTested(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sources.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  const create = async () => {
    if (!name || !type || !valid || !tested) return
    setCreating(true)
    try {
      await createDataSource({
        name,
        type: connector?.category.toLowerCase() ?? type,
        sourceType: type,
        config: { role, ...(scan ? { schemaScan: scan } : {}) },
        credentials: values,
      })
      await onCreated(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sources.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      dirty={dirty && !creating}
      size={type === 'rest' ? 'xl' : 'md'}
      title={role === 'destination' ? t('sources.addTitleDestination') : t('sources.addTitleSource')}
      description={t('sources.addDescription')}
      footer={
        <>
          <Button variant="outline" disabled={testing || !type} onClick={() => void test()}>
            {testing ? <Loader2 className="animate-spin" /> : <RefreshCw />} {testing ? t('sources.testing') : t('sources.test')}
          </Button>
          <Button disabled={!tested || !name.trim() || creating} onClick={() => void create()}>
            {creating ? <Loader2 className="animate-spin" /> : <Save />} {t('sources.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="new-source-name" className="mb-1.5 block">
            {t('sources.name')}
          </Label>
          <Input id="new-source-name" autoFocus placeholder={t('sources.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="new-source-type" className="mb-1.5 block">
            {t('sources.connector')}
          </Label>
          {connectors.length === 0 ? (
            <Notice tone="info" live={false} action={<Link href="/dashboard/connectors" className={buttonVariants({ size: 'sm', variant: 'outline' })}>{t('sources.openConnectors')}</Link>}>
              {t('sources.noConnectors')}
            </Notice>
          ) : (
            <Select
              value={type}
              onValueChange={(value) => {
                const next = (value as string) || ''
                setType(next)
                setValues(next ? defaultCredentialsForConnector(next) : {})
                setTested(false)
                setError('')
                setMessage('')
                setScan(null)
                setRestPreview(null)
              }}
            >
              <SelectTrigger id="new-source-type" className="w-full">
                <SelectValue placeholder={t('sources.connectorPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {connectors.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <AiConnectorSuggest
          onUse={(slug) => {
            setType(slug)
            setValues(defaultCredentialsForConnector(slug))
            setTested(false)
            setError('')
            setMessage('')
            setScan(null)
            setRestPreview(null)
          }}
        />

        {connector && (
          <fieldset className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
            <legend className="px-1 text-sm font-medium">{t('sources.credentialsFor', { connector: connector.name })}</legend>
            <ConnectorCredentialForm
              connectorSlug={type}
              fields={connector.credentialFields}
              values={values}
              onChange={(key, value) => {
                setValues((prev) => ({ ...prev, [key]: value }))
                setTested(false)
                setRestPreview(null)
              }}
              restPreview={restPreview}
              restSending={restSending}
              onRestSend={type === 'rest' ? () => void sendRestPreview() : undefined}
            />
          </fieldset>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
        {hint && (
          <Notice
            tone="info"
            live={false}
            action={
              hint.installed ? (
                <Button size="sm" variant="outline" onClick={() => { setType(hint.slug); setValues(defaultCredentialsForConnector(hint.slug)); setHint(null); setError('') }}>
                  {t('assist.connector.switchTo', { name: hint.name })}
                </Button>
              ) : undefined
            }
          >
            {t('assist.connector.errorHint', { name: hint.name, reason: hint.reason })}
          </Notice>
        )}
        {tested && message && <Notice tone="success">{message}</Notice>}
      </div>
    </Modal>
  )
}
