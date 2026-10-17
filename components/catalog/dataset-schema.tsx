'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/data-table'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { usePrefs } from '@/components/i18n/i18n-provider'
import type { Translate } from '@/lib/i18n/translate'
import { insights } from '@/lib/i18n/messages/en/insights'
import { COLUMN_TYPES, type ColumnType } from '@/lib/pipelines/definition'
import { SCHEMA_CLASSIFICATIONS, type SchemaClassification, type SchemaOp } from '@/lib/datasets/schema'
import { DOMAIN_ENTITIES } from '@/lib/domain/model'
import { changeDatasetSchema, defineDatasetSchema, getDatasetSchema, previewSchemaChange } from '@/lib/actions/schemas'
import { NativeSelect } from '@/components/pipelines/step-editors'

type Data = Awaited<ReturnType<typeof getDatasetSchema>>

const entityLabel = (t: Translate, name: string, fallback: string) =>
  name in insights.catalog.entities ? t(`insights.catalog.entities.${name as keyof typeof insights.catalog.entities}`) : fallback

/** Define from a business entity or an example: shared by the panel and "New dataset". */
export function DefineFrom({ value, onChange }: { value: { from: 'entity' | 'example'; entity: string; example: string }; onChange: (v: { from: 'entity' | 'example'; entity: string; example: string }) => void }) {
  const { t } = usePrefs()
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('schemas.newDataset.from')}>
        <Button size="sm" variant={value.from === 'entity' ? 'default' : 'outline'} aria-pressed={value.from === 'entity'} onClick={() => onChange({ ...value, from: 'entity' })}>
          {t('schemas.panel.fromEntity')}
        </Button>
        <Button size="sm" variant={value.from === 'example' ? 'default' : 'outline'} aria-pressed={value.from === 'example'} onClick={() => onChange({ ...value, from: 'example' })}>
          {t('schemas.panel.fromExample')}
        </Button>
      </div>
      {value.from === 'entity' ? (
        <NativeSelect value={value.entity} onChange={(entity) => onChange({ ...value, entity })} aria-label={t('schemas.panel.fromEntity')}>
          <option value="">{t('schemas.panel.chooseEntity')}</option>
          {DOMAIN_ENTITIES.map((e) => (
            <option key={e.name} value={e.name}>{entityLabel(t, e.name, e.label)}</option>
          ))}
        </NativeSelect>
      ) : (
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('schemas.panel.exampleLabel')}</span>
          <textarea
            value={value.example}
            onChange={(e) => onChange({ ...value, example: e.target.value })}
            rows={5}
            className="w-full rounded-md border border-input bg-card p-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            placeholder={'{"employee_id": "E001", "full_name": "…", "hire_date": "2024-01-15"}'}
          />
        </label>
      )}
    </div>
  )
}

type Pending = { kind: 'rename' | 'type'; column: string; value: string } | { kind: 'add'; name: string; type: ColumnType; required: boolean } | null

/** The Catalog's Schema section for a dataset (lanes design §3, phase D). */
export function DatasetSchemaPanel({ datasetName, onChanged }: { datasetName: string; onChanged?: () => void }) {
  const { t, formatDateTime } = usePrefs()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [defining, setDefining] = useState<{ from: 'entity' | 'example'; entity: string; example: string } | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [keys, setKeys] = useState<string[] | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    try {
      const d = await getDatasetSchema(datasetName)
      setData(d)
      setKeys(d.schema?.keys ?? [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('schemas.panel.loadFailed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetName])
  useEffect(() => {
    void load()
  }, [load])

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setNotice(await work())
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('schemas.panel.loadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const define = (input: Parameters<typeof defineDatasetSchema>[0]) =>
    run(async () => {
      await defineDatasetSchema(input)
      setDefining(null)
      return t('schemas.panel.defined')
    })

  /** Every change: renames, type changes and removals (and making a column required) are confirmed with their impact first. */
  const change = async (ops: SchemaOp[], title?: string) => {
    const needsConfirm = ops.some((o) => o.kind === 'rename' || o.kind === 'type' || o.kind === 'remove' || (o.kind === 'require' && o.required))
    if (needsConfirm) {
      let preview: Awaited<ReturnType<typeof previewSchemaChange>>
      setBusy(true)
      try {
        preview = await previewSchemaChange({ datasetName, ops })
      } catch (err) {
        return setError(err instanceof Error ? err.message : t('schemas.panel.loadFailed'))
      } finally {
        setBusy(false)
      }
      const lines: string[] = []
      for (const o of ops) {
        if (o.kind === 'rename') lines.push(t('schemas.panel.renameAlias', { from: o.from }))
        if (o.kind === 'remove') lines.push(t('schemas.panel.removeData'))
      }
      for (const r of preview.rows) {
        if (r.emptyRows) lines.push(t('schemas.panel.emptyRows', { count: r.emptyRows, column: r.column }))
        if (r.failingRows) lines.push(t('schemas.panel.failingRows', { count: r.failingRows, column: r.column, type: ops.find((o) => o.kind === 'type')?.kind === 'type' ? (ops.find((o) => o.kind === 'type') as { type: string }).type : '' }))
      }
      if (preview.usage) {
        const u = preview.usage
        if (u.pipelines.length) lines.push(t('schemas.panel.impactPipelines', { names: u.pipelines.join(', ') }))
        if (u.dashboards.length) lines.push(t('schemas.panel.impactDashboards', { names: u.dashboards.join(', ') }))
        if (u.apiKeys.length) lines.push(t('schemas.panel.impactApiKeys', { names: u.apiKeys.join(', ') }))
        if (!u.pipelines.length && !u.dashboards.length && !u.apiKeys.length) lines.push(t('schemas.panel.noImpact'))
      }
      const ok = await confirm({
        title: title ?? t('schemas.panel.confirmTitle'),
        description: (
          <span className="block space-y-1">
            {lines.map((l, i) => (
              <span key={i} className="block">{l}</span>
            ))}
          </span>
        ),
        confirmLabel: t('schemas.panel.apply'),
        tone: ops.some((o) => o.kind === 'remove' || o.kind === 'type') ? 'danger' : 'default',
      })
      if (!ok) return
    }
    await run(async () => {
      const res = await changeDatasetSchema({ datasetName, ops })
      setPending(null)
      const moved = [...res.moved.pipelines, ...res.moved.dashboards]
      return `${t('schemas.panel.changed', { version: res.version })}${moved.length ? ` ${t('schemas.panel.moved', { names: moved.join(', ') })}` : ''}`
    })
  }

  if (error && !data) return <Notice tone="danger">{error}</Notice>
  if (!data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t('schemas.panel.loading')}
      </p>
    )

  const messages = (
    <>
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
    </>
  )

  if (!data.schema) {
    return (
      <div className="space-y-3 rounded-md border border-border p-3">
        {messages}
        <p className="text-sm font-medium">{t('schemas.panel.inferredTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('schemas.panel.inferredBody')}</p>
        {data.canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !data.currentColumns.length} onClick={() => void define({ datasetName, from: 'columns' })}>
              {busy && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />} {t('schemas.panel.defineCurrent')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDefining({ from: 'entity', entity: '', example: '' })}>
              {t('schemas.panel.fromEntity')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDefining({ from: 'example', entity: '', example: '' })}>
              {t('schemas.panel.fromExample')}
            </Button>
          </div>
        )}
        {defining && (
          <Modal
            title={t('schemas.panel.define')}
            onClose={() => setDefining(null)}
            footer={
              <>
                <Button variant="outline" onClick={() => setDefining(null)}>{t('common.cancel')}</Button>
                <Button disabled={busy || (defining.from === 'entity' ? !defining.entity : !defining.example.trim())} onClick={() => void define({ datasetName, from: defining.from, entity: defining.entity, example: defining.example })}>
                  {t('schemas.panel.define')}
                </Button>
              </>
            }
          >
            {error && <Notice tone="danger" className="mb-2">{error}</Notice>}
            <DefineFrom value={defining} onChange={setDefining} />
          </Modal>
        )}
      </div>
    )
  }

  const schema = data.schema
  const canEdit = data.canEdit
  const keysDirty = keys !== null && keys.join() !== schema.keys.join()

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      {confirmDialog}
      {messages}
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="size-4 text-live" aria-hidden />
        <p className="text-sm font-medium">{t('schemas.panel.definedTitle', { version: data.version })}</p>
        {canEdit && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => setPending({ kind: 'add', name: '', type: 'text', required: false })}>
            <Plus className="mr-1 size-3.5" aria-hidden /> {t('schemas.panel.addColumn')}
          </Button>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={schema.autoAdd} disabled={!canEdit || busy} onChange={(e) => void change([{ kind: 'autoAdd', on: e.target.checked }])} />
        <span>
          {t('schemas.panel.autoAdd')}
          <span className="block text-xs text-muted-foreground">{t('schemas.panel.autoAddHelp')}</span>
        </span>
      </label>

      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <Table label={t('schemas.panel.title')}>
          <THead className="sticky top-0 z-10 bg-muted">
            <tr>
              <Th className="sticky left-0 bg-muted">{t('schemas.panel.colColumn')}</Th>
              <Th>{t('schemas.panel.colType')}</Th>
              <Th>{t('schemas.panel.colRequired')}</Th>
              <Th>{t('schemas.panel.colClassification')}</Th>
              <Th>{t('schemas.panel.colFilledBy')}</Th>
              {canEdit && <Th><span className="sr-only">{t('schemas.panel.actionsOf', { column: '' })}</span></Th>}
            </tr>
          </THead>
          <TBody>
            {schema.columns.map((c) => {
              const writers = data.owners.byColumn[c.name] ?? []
              const isKey = schema.keys.includes(c.name)
              return (
                <Tr key={c.name}>
                  <Td className="sticky left-0 bg-card py-1 font-mono text-xs whitespace-nowrap">
                    {isKey && <KeyRound className="mr-1 inline size-3 text-info-text" aria-label={t('schemas.panel.keys')} />}
                    {c.name}
                    {c.autoAdded && !c.reviewed && (
                      <span className="ml-1 rounded-sm bg-warning-soft px-1 font-sans text-[10px] text-warning-text">{t('schemas.panel.autoAdded')}</span>
                    )}
                  </Td>
                  <Td className="py-1 font-mono text-xs text-muted-foreground">{c.type}</Td>
                  <Td className="py-1">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={c.required}
                      disabled={!canEdit || busy || isKey}
                      onChange={(e) => void change([{ kind: 'require', name: c.name, required: e.target.checked }])}
                      aria-label={t('schemas.panel.requiredOf', { column: c.name })}
                    />
                  </Td>
                  <Td className="py-1">
                    {canEdit ? (
                      <NativeSelect className="h-7 text-xs" value={c.classification} disabled={busy} onChange={(v) => void change([{ kind: 'describe', name: c.name, classification: v as SchemaClassification }])} aria-label={t('schemas.panel.classificationOf', { column: c.name })}>
                        {SCHEMA_CLASSIFICATIONS.map((k) => (
                          <option key={k} value={k}>{t(`schemas.panel.classifications.${k}`)}</option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <span className="text-xs">{t(`schemas.panel.classifications.${c.classification}`)}</span>
                    )}
                  </Td>
                  <Td className="py-1 text-xs">
                    {writers.length ? writers.join(', ') : <span className="text-muted-foreground">{data.owners.byName.length ? '—' : t('schemas.panel.nobody')}</span>}
                    {writers.length > 1 && <span className="block text-[10px] text-warning-text">{t('schemas.panel.lastWriterWins')}</span>}
                  </Td>
                  {canEdit && (
                    <Td className="py-1 text-right">
                      <Menu>
                        <MenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t('schemas.panel.actionsOf', { column: c.name })} disabled={busy} />}>
                          <MoreHorizontal />
                        </MenuTrigger>
                        <MenuContent>
                          {c.autoAdded && !c.reviewed && (
                            <MenuItem onClick={() => void change([{ kind: 'review', name: c.name }])}>
                              <ShieldCheck aria-hidden /> {t('schemas.panel.markReviewed')}
                            </MenuItem>
                          )}
                          <MenuItem onClick={() => setPending({ kind: 'rename', column: c.name, value: c.name })}>
                            <Pencil aria-hidden /> {t('schemas.panel.rename')}
                          </MenuItem>
                          <MenuItem onClick={() => setPending({ kind: 'type', column: c.name, value: c.type })}>
                            <Type aria-hidden /> {t('schemas.panel.changeType')}
                          </MenuItem>
                          {!isKey && (
                            <>
                              <MenuSeparator />
                              <MenuItem onClick={() => void change([{ kind: 'remove', name: c.name }], t('schemas.panel.removeTitle', { column: c.name }))}>
                                <Trash2 aria-hidden /> {t('schemas.panel.remove')}
                              </MenuItem>
                            </>
                          )}
                        </MenuContent>
                      </Menu>
                    </Td>
                  )}
                </Tr>
              )
            })}
          </TBody>
        </Table>
      </div>
      {data.owners.byName.length > 0 && <p className="text-xs text-muted-foreground">{t('schemas.panel.byName', { names: data.owners.byName.join(', ') })}</p>}

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted-foreground">{t('schemas.panel.keys')}</legend>
        <p className="mb-2 text-xs text-muted-foreground">{t('schemas.panel.keysHelp')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {schema.columns.map((c) => (
            <label key={c.name} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-xs has-[:checked]:border-ring has-[:checked]:bg-accent">
              <input
                type="checkbox"
                className="accent-primary"
                disabled={!canEdit || busy}
                checked={(keys ?? schema.keys).includes(c.name)}
                onChange={(e) => setKeys((k) => (e.target.checked ? [...(k ?? []), c.name] : (k ?? []).filter((x) => x !== c.name)))}
              />
              {c.name}
            </label>
          ))}
          {canEdit && keysDirty && (
            <Button size="sm" disabled={busy} onClick={() => void change([{ kind: 'keys', keys: keys ?? [] }])}>
              {t('schemas.panel.saveKeys')}
            </Button>
          )}
        </div>
      </fieldset>

      {data.aliases.length > 0 && (
        <div className="text-xs">
          <p className="font-medium">{t('schemas.panel.aliases')}</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {data.aliases.map((a) => (
              <li key={a.oldName} className="font-mono">{t('schemas.panel.aliasLine', { from: a.oldName, to: a.newName, date: formatDateTime(a.expiresAt) })}</li>
            ))}
          </ul>
        </div>
      )}

      {data.versions.length > 0 && (
        <details className="text-xs">
          <summary className="flex cursor-pointer items-center gap-1 font-medium">
            <History className="size-3.5" aria-hidden /> {t('schemas.panel.history')}
          </summary>
          <ul className="mt-2 space-y-1">
            {data.versions.map((v) => (
              <li key={v.version}>
                <span className="font-medium">{t('schemas.panel.versionLine', { version: v.version, when: formatDateTime(v.createdAt) })}</span>
                <span className="text-muted-foreground"> · {v.change.filter(Boolean).join('; ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {pending && (
        <Modal
          title={pending.kind === 'add' ? t('schemas.panel.addColumn') : pending.kind === 'rename' ? t('schemas.panel.renameTitle', { column: pending.column }) : t('schemas.panel.typeTitle', { column: pending.column })}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setPending(null)}>{t('common.cancel')}</Button>
              <Button
                disabled={busy || (pending.kind === 'add' ? !pending.name.trim() : pending.kind === 'rename' ? !pending.value.trim() || pending.value === pending.column : false)}
                onClick={() =>
                  void change(
                    pending.kind === 'add'
                      ? [{ kind: 'add', column: { name: pending.name.trim(), type: pending.type, required: pending.required, description: '', classification: 'internal', default: null, autoAdded: false, reviewed: true } }]
                      : pending.kind === 'rename'
                        ? [{ kind: 'rename', from: pending.column, to: pending.value.trim() }]
                        : [{ kind: 'type', name: pending.column, type: pending.value as ColumnType }]
                  )
                }
              >
                {pending.kind === 'add' ? t('schemas.panel.add') : t('schemas.panel.apply')}
              </Button>
            </>
          }
        >
          {error && <Notice tone="danger" className="mb-2">{error}</Notice>}
          {pending.kind === 'add' ? (
            <div className="grid gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('schemas.panel.name')}</span>
                <Input value={pending.name} className="font-mono" placeholder="cost_center" onChange={(e) => setPending({ ...pending, name: e.target.value.toLowerCase() })} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('schemas.panel.type')}</span>
                <NativeSelect value={pending.type} onChange={(v) => setPending({ ...pending, type: v as ColumnType })}>
                  {COLUMN_TYPES.map((ty) => (
                    <option key={ty} value={ty}>{ty}</option>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={pending.required} onChange={(e) => setPending({ ...pending, required: e.target.checked })} />
                {t('schemas.panel.required')}
              </label>
            </div>
          ) : pending.kind === 'rename' ? (
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('schemas.panel.newName')}</span>
              <Input value={pending.value} className="font-mono" onChange={(e) => setPending({ ...pending, value: e.target.value.toLowerCase() })} />
            </label>
          ) : (
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('schemas.panel.type')}</span>
              <NativeSelect value={pending.value} onChange={(v) => setPending({ ...pending, value: v })}>
                {COLUMN_TYPES.map((ty) => (
                  <option key={ty} value={ty}>{ty}</option>
                ))}
              </NativeSelect>
            </label>
          )}
        </Modal>
      )}
    </div>
  )
}
