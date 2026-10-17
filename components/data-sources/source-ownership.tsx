'use client'

import { useState } from 'react'
import { Loader2, Plus, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { StateMark } from '@/components/ui/flow-line'
import { EnvironmentBadge } from '@/components/workspace/environment-badge'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { copyDataSourceToEnvironment, getSourceEnvironments, setDataSourceOwnership } from '@/lib/actions/data-sources'
import { MAX_TAGS, normalizeTags } from '@/lib/connectors/ownership'

export type SourceEnvironments = Awaited<ReturnType<typeof getSourceEnvironments>>
export type Member = { userId: string; name: string | null; email: string }

export const memberName = (m: Member | undefined) => (m ? m.name || m.email : null)

/** DS-11: a data source's owner (a workspace member) and tags. */
export function OwnershipDialog({
  source,
  members,
  onClose,
  onSaved,
}: {
  source: { id: string; name: string; ownerId: string | null; tags: string[] }
  members: Member[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = usePrefs()
  const [ownerId, setOwnerId] = useState(source.ownerId ?? '')
  const [tags, setTags] = useState(source.tags.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = ownerId !== (source.ownerId ?? '') || normalizeTags(tags).join(',') !== source.tags.join(',')
  const owner = members.find((m) => m.userId === source.ownerId)
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await setDataSourceOwnership(source.id, { ownerId: ownerId || null, tags: normalizeTags(tags) })
      onSaved(t('sources.ownershipSaved', { name: source.name }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      onClose={onClose}
      dirty={dirty}
      size="sm"
      title={t('sources.ownershipTitle', { name: source.name })}
      description={t('sources.ownershipHelp')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="source-ownership" disabled={busy || !dirty}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="source-ownership"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <div>
          <Label htmlFor="source-owner" className="mb-1.5 block">
            {t('sources.owner')}
          </Label>
          <select id="source-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={nativeSelectClass}>
            <option value="">{t('sources.noOwner')}</option>
            {source.ownerId && !owner && <option value={source.ownerId}>{t('sources.formerMember')}</option>}
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ? `${m.name} (${m.email})` : m.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="source-tags" className="mb-1.5 block">
            {t('sources.tags')}
          </Label>
          <Input id="source-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('sources.tagsPlaceholder')} aria-describedby="source-tags-help" />
          <p id="source-tags-help" className="mt-1 text-xs text-muted-foreground">
            {t('sources.tagsHelp', { max: MAX_TAGS })}
          </p>
          {normalizeTags(tags).length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label={t('sources.tagsOf', { name: source.name })}>
              {normalizeTags(tags).map((tag) => (
                <li key={tag} className="rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-xs">
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </Modal>
  )
}

const healthState = (h: 'live' | 'failing' | 'idle' | null) => (h === 'live' ? 'live' : h === 'failing' ? 'tripped' : 'idle') as 'live' | 'tripped' | 'idle'

/** The words for one environment's copy of a source (state + health), used in the list and the dialog. */
export function useEnvWords() {
  const { t } = usePrefs()
  return (row: SourceEnvironments['sources'][string][number]) =>
    row.state === 'missing'
      ? t('sources.envMissing')
      : row.state === 'conflict'
        ? t('sources.envConflict')
        : row.health === 'live'
          ? t('sources.envHealthLive')
          : row.health === 'failing'
            ? t('sources.envHealthFailing')
            : t('sources.envHealthIdle')
}

/** Compact marks for the Data sources list: one per other environment. */
export function EnvironmentMarks({ rows, environments }: { rows: SourceEnvironments['sources'][string]; environments: SourceEnvironments['environments'] }) {
  const { t } = usePrefs()
  const words = useEnvWords()
  return (
    <ul className="space-y-1">
      {rows.map((row) => {
        const env = environments.find((e) => e.id === row.workspaceId)
        if (!env) return null
        const state = row.state === 'present' ? healthState(row.health) : row.state === 'conflict' ? 'held' : 'idle'
        return (
          <li key={row.workspaceId} className="flex items-center gap-1.5" title={t('sources.envMark', { environment: t(`ws.env.names.${env.environment}`), state: words(row) })}>
            <EnvironmentBadge environment={env.environment} />
            <StateMark state={state} className="text-xs">
              {row.state === 'present' ? t('sources.envPresent') : words(row)}
            </StateMark>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * DS-11: where a data source stands in each environment of the group, with
 * "Add to <environment>" for a missing one (no credentials are copied).
 */
export function EnvironmentsDialog({
  source,
  data,
  onClose,
  onCopied,
}: {
  source: { id: string; name: string }
  data: SourceEnvironments
  onClose: () => void
  onCopied: (message: string) => void
}) {
  const { t, formatDateTime } = usePrefs()
  const [confirm, confirmDialog] = useConfirm()
  const words = useEnvWords()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const rows = data.sources[source.id] ?? []
  const copy = async (env: SourceEnvironments['environments'][number]) => {
    const environment = t(`ws.env.names.${env.environment}`)
    const ok = await confirm({ title: t('sources.copyTitle', { name: source.name, environment }), description: t('sources.copyBody', { name: source.name, workspace: env.name, environment }), confirmLabel: t('sources.copyTo', { environment }) })
    if (!ok) return
    setBusy(env.id)
    setError('')
    try {
      const res = await copyDataSourceToEnvironment({ sourceId: source.id, workspaceId: env.id })
      onCopied(t('sources.copied', { name: source.name, workspace: res.workspaceName }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Modal onClose={onClose} size="md" title={t('sources.environmentsTitle', { name: source.name })} description={t('sources.environmentsHelp')}>
      <div className="space-y-3">
        {confirmDialog}
        {error && <Notice tone="danger">{error}</Notice>}
        {!data.environments.length ? (
          <Notice tone="info" live={false}>
            {t('sources.environmentsNone')}
          </Notice>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {data.environment && (
              <li className="flex items-center gap-2 px-3 py-2 text-sm">
                <EnvironmentBadge environment={data.environment} />
                <span className="text-muted-foreground">{t('sources.envThis')}</span>
              </li>
            )}
            {rows.map((row) => {
              const env = data.environments.find((e) => e.id === row.workspaceId)
              if (!env) return null
              const environment = t(`ws.env.names.${env.environment}`)
              return (
                <li key={row.workspaceId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <EnvironmentBadge environment={env.environment} />
                  <span className="font-medium">{env.name}</span>
                  <StateMark state={row.state === 'present' ? healthState(row.health) : row.state === 'conflict' ? 'held' : 'idle'}>{words(row)}</StateMark>
                  {row.state === 'present' && (row.lastConnected || row.owner) && (
                    <span className="text-xs text-muted-foreground">
                      {[
                        row.lastConnected ? t('sources.envChecked', { when: `${formatDateTime(row.lastConnected, { dateStyle: 'medium', timeStyle: 'short' })} WIB` }) : null,
                        row.owner ? t('sources.envOwner', { name: row.owner }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                  {row.state === 'conflict' && <span className="text-xs text-muted-foreground">{t('sources.envConflictHelp')}</span>}
                  {row.state === 'missing' && (
                    <span className="ml-auto">
                      {env.canManage ? (
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void copy(env)}>
                          {busy === env.id ? <Loader2 className="animate-spin" /> : <Plus aria-hidden />} {t('sources.copyTo', { environment })}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('sources.copyNoAccess', { workspace: env.name })}</span>
                      )}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
