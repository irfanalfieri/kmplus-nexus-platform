'use client'

import { isSecretManager, secretRef } from '@/lib/secrets/types'
import { AiConnectorSuggest } from '@/components/ai/ai-connector-suggest'
import { suggestConnector } from '@/lib/actions/ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Activity, Database, Eye, KeyRound, Layers, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Save, Tag, Trash2, Upload } from 'lucide-react'
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
import { SourceHealthDialog } from '@/components/data-sources/source-health'
import { EnvironmentMarks, EnvironmentsDialog, OwnershipDialog, memberName, type Member, type SourceEnvironments } from '@/components/data-sources/source-ownership'
import { matchesSourceFilter, tagCounts, tagsOf, type SourceFilter } from '@/lib/connectors/ownership'
import { listMembers } from '@/lib/actions/workspaces'
import { useUrlIntents } from '@/components/dashboard/url-intents'
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
import { createDataSource, deleteDataSource, getDataSources, getSourceEnvironments, renameDataSource, setDataSourceRole, testConnection } from '@/lib/actions/data-sources'
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
  /** DS-8: unreviewed schema changes. */
  schemaDrift: boolean
  config?: Record<string, unknown> | null
  /** DS-11 */
  ownerId: string | null
  tags: string[]
}

const NO_FILTER: SourceFilter = { tag: '', owner: '', text: '' }

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
  const [healthFor, setHealthFor] = useState<string | null>(null)
  const [members, setMembers] = useState<(Member & { isYou: boolean })[]>([])
  const [envs, setEnvs] = useState<SourceEnvironments | null>(null)
  const [filter, setFilter] = useState<SourceFilter>(NO_FILTER)
  const [ownershipFor, setOwnershipFor] = useState<DataSourceRow | null>(null)
  const [envFor, setEnvFor] = useState<DataSourceRow | null>(null)

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
      const [rows, slugs, people, environments] = await Promise.all([
        getDataSources(),
        getInstalledConnectorSlugs(),
        listMembers().catch(() => []),
        // DS-11: the same source in the other environments of the group (none without a group).
        getSourceEnvironments().catch(() => null),
      ])
      setInstalledSlugs(slugs)
      setMembers(people)
      setEnvs(environments)
      setSources(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          sourceType: row.sourceType,
          role: (row.config as { role?: Role })?.role,
          status: row.status ?? 'disconnected',
          lastConnected: row.lastConnected,
          schemaDrift: Boolean(row.schemaDrift),
          config: row.config as Record<string, unknown> | null,
          ownerId: row.ownerId ?? null,
          tags: tagsOf(row.tags),
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
  const tags = useMemo(() => tagCounts(sources), [sources])
  const shown = useMemo(() => sources.filter((s) => matchesSourceFilter(s, filter)), [sources, filter])
  const filtering = filter.tag !== '' || filter.owner !== '' || filter.text.trim() !== ''
  const me = members.find((m) => m.isYou)?.userId ?? ''
  const ownerOf = (s: DataSourceRow) => (s.ownerId ? (memberName(members.find((m) => m.userId === s.ownerId)) ?? t('sources.formerMember')) : null)
  const hasEnvs = Boolean(envs?.environments.length)

  // Deep links: ?add=source|destination; ?source=<id> (marks the row) with &open=owner|environments|health|credentials.
  const [focusId, setFocusId] = useState<string | null>(null)
  const openParam = useRef('')
  useUrlIntents(!loading, {
    open: (v) => {
      openParam.current = v
    },
    add: (v) => canManage && setAdding(v === 'destination' ? 'destination' : 'source'),
    source: (id) => {
      const s = sources.find((x) => x.id === id)
      if (!s) return
      setFilter(NO_FILTER)
      setFocusId(s.id)
      window.setTimeout(() => document.getElementById(`source-${s.id}`)?.scrollIntoView({ block: 'center' }), 80)
      const open = openParam.current
      if (open === 'environments' && hasEnvs) setEnvFor(s)
      else if (open === 'health') setHealthFor(s.id)
      else if (canManage && open === 'owner') setOwnershipFor(s)
      else if (canManage && open === 'credentials' && s.sourceType !== 'file') setCredentialsFor({ id: s.id, name: s.name })
    },
  })

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
      {healthFor && <SourceHealthDialog sourceId={healthFor} onClose={() => setHealthFor(null)} onChanged={() => void loadAll()} />}
      {ownershipFor && (
        <OwnershipDialog
          source={ownershipFor}
          members={members}
          onClose={() => setOwnershipFor(null)}
          onSaved={(message) => {
            setOwnershipFor(null)
            toast({ message })
            void loadAll()
          }}
        />
      )}
      {envFor && envs && (
        <EnvironmentsDialog
          source={envFor}
          data={envs}
          onClose={() => setEnvFor(null)}
          onCopied={(message) => {
            toast({ message })
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
          connectors={adding === 'destination' ? installedConnectors.filter((c) => !isSecretManager(c.slug)) : installedConnectors}
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
              <Button data-tour="sources-add" onClick={() => setAdding('source')}>
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
        {!loading && sources.length > 0 && (
          <div role="search" aria-label={t('sources.filterLabel')} className="flex flex-wrap items-end gap-2">
            <Input value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} placeholder={t('sources.filterText')} aria-label={t('sources.filterText')} className="w-64 max-w-full" />
            {tags.length > 0 && (
              <select value={filter.tag} onChange={(e) => setFilter({ ...filter, tag: e.target.value })} className={nativeSelectClass + ' w-auto'} aria-label={t('sources.filterTag')}>
                <option value="">{t('sources.anyTag')}</option>
                {tags.map((x) => (
                  <option key={x.tag} value={x.tag}>
                    {x.tag} ({x.count})
                  </option>
                ))}
              </select>
            )}
            <select value={filter.owner} onChange={(e) => setFilter({ ...filter, owner: e.target.value })} className={nativeSelectClass + ' w-auto'} aria-label={t('sources.filterOwner')}>
              <option value="">{t('sources.anyOwner')}</option>
              {me && <option value={me}>{t('sources.ownedByMe')}</option>}
              {members
                .filter((m) => !m.isYou && sources.some((s) => s.ownerId === m.userId))
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberName(m)}
                  </option>
                ))}
              <option value="none">{t('sources.noOwner')}</option>
            </select>
            {filtering && (
              <Button variant="ghost" size="sm" onClick={() => setFilter(NO_FILTER)}>
                {t('sources.clearFilters')}
              </Button>
            )}
          </div>
        )}

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
                    <Button data-tour="sources-add" onClick={() => setAdding('source')}>
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
            shown.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t('sources.noneMatch')}</p>
            ) : (
            <Table label={t('pages.sources.title')} className="md:min-w-[760px]">
              <THead>
                <tr>
                  <Th>{t('sources.colName')}</Th>
                  <Th className="hidden md:table-cell">{t('sources.colRole')}</Th>
                  <Th>{t('sources.colStatus')}</Th>
                  <Th className="hidden text-right lg:table-cell">{t('sources.colTables')}</Th>
                  <Th className="hidden sm:table-cell">{t('sources.colChecked')}</Th>
                  {hasEnvs && <Th className="hidden md:table-cell">{t('sources.colEnvironments')}</Th>}
                  <Th className="text-right">
                    <span className="sr-only">{t('common.edit')}</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {shown.map((source) => {
                  const role: Role = source.role ?? 'source'
                  const connected = source.status === 'connected'
                  const scan = source.config?.schemaScan as SchemaScanResult | undefined
                  return (
                    <Tr key={source.id} id={`source-${source.id}`} selected={focusId === source.id} className="scroll-mt-24">
                      <Td className="min-w-40">
                        <div className="font-medium">{source.name}</div>
                        <div className="text-xs text-muted-foreground">{getConnectorDefinition(source.sourceType)?.name ?? source.sourceType.toUpperCase()}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{ownerOf(source) ? t('sources.ownerLine', { name: ownerOf(source)! }) : t('sources.noOwner')}</div>
                        {source.tags.length > 0 && (
                          <ul className="mt-1 flex flex-wrap gap-1" aria-label={t('sources.tagsOf', { name: source.name })}>
                            {source.tags.map((tag) => (
                              <li key={tag}>
                                <button type="button" onClick={() => setFilter({ ...filter, tag })} className="rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-[11px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
                                  {tag}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>
                      <Td className="hidden md:table-cell">
                        {isSecretManager(source.sourceType) ? (
                          // Secrets managers supply credentials to other sources; they are never read or written as data.
                          <span title={t('sources.secretsHint', { name: source.name })}>{t('sources.roleSecrets')}</span>
                        ) : canManage ? (
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
                        {source.schemaDrift && (
                          <button type="button" onClick={() => setHealthFor(source.id)} className="mt-1 block rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={t('health.openFor', { name: source.name })}>
                            <StateMark state="held" className="text-xs">{t('health.schemaChanged')}</StateMark>
                          </button>
                        )}
                      </Td>
                      <Td className="hidden text-right font-mono text-xs lg:table-cell">{scan && !isSecretManager(source.sourceType) ? scan.tables.length : '—'}</Td>
                      <Td className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{ago(source.lastConnected)}</Td>
                      {hasEnvs && envs && (
                        <Td className="hidden md:table-cell">
                          <button type="button" onClick={() => setEnvFor(source)} className="rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={t('sources.environmentsTitle', { name: source.name })}>
                            <EnvironmentMarks rows={envs.sources[source.id] ?? []} environments={envs.environments} />
                          </button>
                        </Td>
                      )}
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {canManage && source.sourceType === 'file' && (
                            <Button size="sm" variant="outline" onClick={() => setUploadFor(source.id)} aria-label={t('sources.uploadFor', { name: source.name })}>
                              <Upload /> <span className="hidden lg:inline">{t('sources.upload')}</span>
                            </Button>
                          )}
                          {connected && canPreview && !isSecretManager(source.sourceType) && (
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={t('sources.browseFor', { name: source.name })}
                              onClick={() => {
                                setSelectedSourceId(source.id)
                                setExplorerOpen(true)
                              }}
                            >
                              <Eye /> <span className="hidden lg:inline">{t('sources.browse')}</span>
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
                                <MenuItem onClick={() => setHealthFor(source.id)}>
                                  <Activity aria-hidden /> {t('health.open')}
                                </MenuItem>
                                {source.sourceType !== 'file' && (
                                  <MenuItem onClick={() => setCredentialsFor({ id: source.id, name: source.name })}>
                                    <KeyRound aria-hidden /> {t('sources.editCredentials')}
                                  </MenuItem>
                                )}
                                <MenuItem onClick={() => setOwnershipFor(source)}>
                                  <Tag aria-hidden /> {t('sources.ownership')}
                                </MenuItem>
                                {hasEnvs && (
                                  <MenuItem onClick={() => setEnvFor(source)}>
                                    <Layers aria-hidden /> {t('sources.environments')}
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
            )
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
      const result = await testAndScanDataSource(type, values, role)
      if ('preview' in result && result.preview) setRestPreview(result.preview as RestRequestPreview)
      if (!result.ok) {
        setError(result.message)
        void checkError(result.message)
        return
      }
      setScan(result.scan)
      setMessage(type === 'rest' && role === 'destination' ? t('sources.restDestinationReached') : isSecretManager(type) ? `${result.test.message} ${t('sources.secretsReady', { example: secretRef(name.trim() || 'Name', 'path/to/secret', 'field') })}` : t('sources.connectedFound', { count: result.scan.tables.length }))
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
                <SelectValue placeholder={t('sources.connectorPlaceholder')}>{(value: string | null) => (value ? (getConnectorDefinition(value)?.name ?? value) : t('sources.connectorPlaceholder'))}</SelectValue>
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
