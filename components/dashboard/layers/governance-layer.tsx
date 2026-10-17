'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, Eraser, Eye, KeyRound, Loader2, LockKeyhole, Save, ScrollText, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/data-table'
import { PageHeader } from '@/components/dashboard/page-header'
import { useHashTarget, useUrlIntents } from '@/components/dashboard/url-intents'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { usePrefs, useT } from '@/components/i18n/i18n-provider'
import type { Translate } from '@/lib/i18n/translate'
import { cn } from '@/lib/utils'
import { eraseRecords, findErasureMatches, getGovernanceOverview, listErasureColumns, previewMaskedDataset, saveDatasetPolicy } from '@/lib/actions/governance'
import { CLASSIFICATIONS, MASKS, MASK_INFO, type ColumnPolicy } from '@/lib/governance/definition'
import { ROLES, type Role } from '@/lib/auth/permissions'
import { ROW_FILTER_OPERATORS, type RowFilter } from '@/lib/governance/row-filters'
import { SampleTable } from '@/components/pipelines/pipeline-editor'

type Overview = Awaited<ReturnType<typeof getGovernanceOverview>>
type Dataset = Overview['datasets'][number]

const selectClass = nativeSelectClass
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const RETENTION_PRESETS: (number | null)[] = [null, 30, 90, 365, 730, 1825, 3650]

/** "Keep everything", "90 days", "2 years" in the interface language. */
const retentionLabel = (t: Translate, days: number | null) =>
  days === null ? t('insights.governance.policy.keepAll') : days % 365 === 0 ? t('insights.governance.policy.years', { count: days / 365 }) : t('insights.governance.policy.days', { count: days })

const roleLabel = (t: Translate, role: Role) => t(`insights.governance.roles.${role}`)

/** Short date-time in WIB ("12 Oct 14:05 WIB"), in the interface language. */
function useWhen() {
  const { t, formatDateTime } = usePrefs()
  return (d: Date | string | null | undefined) =>
    d ? t('insights.time.wib', { time: formatDateTime(d, { dateStyle: undefined, timeStyle: undefined, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : '—'
}

/** Puts React nodes where `{name}` placeholders stand in a translated sentence. */
function withNodes(text: string, nodes: Record<string, React.ReactNode>) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1]
    return <Fragment key={i}>{name && name in nodes ? nodes[name] : part}</Fragment>
  })
}

export default function GovernanceLayer() {
  const t = useT()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await getGovernanceOverview()
      setData(res)
      setSelected((cur) => cur ?? res.datasets[0]?.name ?? null)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.governance.loadFailed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dataset = data?.datasets.find((d) => d.name === selected) ?? null
  useHashTarget(data !== null)

  return (
    <div className="space-y-6">
      <PageHeader title={t('pages.governance.title')} description={t('pages.governance.description')} />

      {data && !data.seesUnmasked && (
        <Notice tone="info" live={false}>
          {t('insights.governance.maskedNotice', { role: roleLabel(t, data.role) })}
        </Notice>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      {!data ? (
        !error && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-muted-foreground" role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {t('insights.governance.loading')}
          </div>
        )
      ) : (
        <>
          <Controls data={data} />

          <section id="policies" data-tour="governance-policies" className="scroll-mt-6 rounded-lg border border-border bg-card p-5" aria-labelledby="gov-policies">
            <div className="mb-1 flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h2 id="gov-policies" className="text-base font-semibold">{t('insights.governance.policiesTitle')}</h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {t('insights.governance.policiesBody')}
            </p>
            {data.datasets.length === 0 ? (
              <EmptyState compact icon={<Database />} title={t('insights.governance.noDatasetsTitle')}>
                {t('insights.governance.noDatasetsBody')}
              </EmptyState>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
                <ul className="space-y-1" aria-label={t('insights.governance.datasetsLabel')}>
                  {data.datasets.map((d) => {
                    const masked = Object.values(d.columnPolicies).filter((p) => !p.suggested && p.mask !== 'none').length
                    return (
                      <li key={d.name}>
                        <button
                          onClick={() => setSelected(d.name)}
                          aria-current={selected === d.name ? 'true' : undefined}
                          className={cn(
                            'w-full rounded-md px-3 py-2 text-left text-sm',
                            focusRing,
                            selected === d.name ? 'bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--live)]' : 'hover:bg-muted'
                          )}
                        >
                          <div className="truncate font-mono font-medium">{d.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {d.policy
                              ? `${t('insights.governance.maskedCount', { count: masked })}${d.policy.retentionDays ? ` · ${t('insights.governance.keepDays', { days: d.policy.retentionDays })}` : ''}`
                              : t('insights.governance.noPolicy')}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {dataset && <PolicyEditor key={dataset.name} dataset={dataset} canManage={data.canManage} onSaved={load} />}
              </div>
            )}
          </section>

          {data.canErase && <Erasure onDone={load} />}
        </>
      )}
    </div>
  )
}

function Controls({ data }: { data: Overview }) {
  const { t, formatNumber } = usePrefs()
  const c = data.controls
  const tiles = [
    {
      key: 'twoFactor',
      label: t('insights.governance.controls.twoFactor'),
      value: t('insights.governance.controls.twoFactorValue', { with: c.membersWith2fa, total: c.members }),
      ok: c.membersWith2fa === c.members,
      hint: c.membersWith2fa === c.members ? t('insights.governance.controls.twoFactorOk') : t('insights.governance.controls.twoFactorPending'),
      icon: ShieldCheck,
      action: { label: t('insights.governance.controls.members'), tab: 'settings/members' },
    },
    {
      key: 'credentials',
      label: t('insights.governance.controls.credentials'),
      value: t('insights.governance.controls.credentialsValue', { encrypted: c.encryptedSources, total: c.dataSources }),
      ok: c.encryptedSources === c.dataSources && (c.onCurrentKey === null || c.onCurrentKey === c.dataSources),
      hint:
        c.onCurrentKey !== null && c.onCurrentKey < c.encryptedSources
          ? t('insights.governance.controls.credentialsOld', { count: c.encryptedSources - c.onCurrentKey })
          : t('insights.governance.controls.credentialsOk'),
      icon: KeyRound,
    },
    {
      key: 'audit',
      label: t('insights.governance.controls.audit'),
      value: t('insights.governance.controls.auditValue', { count: formatNumber(c.auditEvents7d) }),
      ok: true,
      hint: t('insights.governance.controls.auditHint'),
      icon: ScrollText,
      action: { label: t('insights.governance.controls.auditLog'), tab: 'settings/audit' },
    },
    {
      key: 'policies',
      label: t('insights.governance.controls.policies'),
      value: t('insights.governance.controls.policiesValue', { with: c.datasetsWithPolicy, total: c.datasets }),
      ok: c.datasets === 0 || c.datasetsWithPolicy === c.datasets,
      hint: t('insights.governance.controls.policiesHint', { personal: c.classifiedPersonal, masked: c.maskedColumns }),
      icon: LockKeyhole,
    },
    {
      key: 'retention',
      label: t('insights.governance.controls.retention'),
      value: t('insights.governance.controls.retentionValue', { count: c.retentionPolicies }),
      ok: true,
      hint: t('insights.governance.controls.retentionHint'),
      icon: Eraser,
    },
    {
      key: 'roles',
      label: t('insights.governance.controls.roles'),
      value: t('insights.governance.controls.rolesValue'),
      ok: true,
      hint: t('insights.governance.controls.rolesHint'),
      icon: Users,
      action: { label: t('insights.governance.controls.rolesLink'), tab: 'settings/members' },
    },
  ]
  // One board panel, one row per control (DESIGN.md: lines and tables, never a grid of KPI cards).
  return (
    <section aria-labelledby="gov-controls" className="rounded-lg border border-border bg-card">
      <h2 id="gov-controls" className="border-b border-border px-4 py-3 text-base font-semibold">
        {t('insights.governance.controls.title')}
      </h2>
      <ul className="divide-y divide-border">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <li key={tile.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(12rem,16rem)_minmax(10rem,14rem)_minmax(0,1fr)_6.5rem_7rem]">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> {tile.label}
              </span>
              <span className="order-3 font-mono text-sm tabular-nums md:order-none">{tile.value}</span>
              <span className="order-4 col-span-2 text-xs text-muted-foreground md:order-none md:col-span-1">{tile.hint}</span>
              {tile.ok ? (
                <span className="flex items-center gap-1.5 justify-self-end text-xs font-medium text-live-text md:justify-self-start"><CheckCircle2 className="size-3.5 text-live" aria-hidden /> {t('insights.governance.controls.ok')}</span>
              ) : (
                <span className="flex items-center gap-1.5 justify-self-end text-xs font-medium text-warning-text md:justify-self-start"><AlertTriangle className="size-3.5 text-warning" aria-hidden /> {t('insights.governance.controls.attention')}</span>
              )}
              <span className="order-5 col-span-2 md:order-none md:col-span-1 md:justify-self-end">
                {tile.action && (
                  <Link href={`/dashboard/${tile.action.tab}`} className={cn('inline-flex min-h-8 items-center rounded-sm text-xs font-medium text-info-text underline-offset-4 hover:underline', focusRing)}>
                    {tile.action.label} →
                  </Link>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PolicyEditor({ dataset, canManage, onSaved }: { dataset: Dataset; canManage: boolean; onSaved: () => void }) {
  const { t, formatNumber } = usePrefs()
  const when = useWhen()
  const [columns, setColumns] = useState<Record<string, ColumnPolicy>>(() =>
    Object.fromEntries(Object.entries(dataset.columnPolicies).map(([k, v]) => [k, { classification: v.classification, mask: v.mask }]))
  )
  const [retention, setRetention] = useState<number | null>(dataset.policy?.retentionDays ?? null)
  const [rowFilters, setRowFilters] = useState<RowFilter[]>(dataset.rowFilters)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; masked: string[]; rowFilters: number } | null>(null)
  const suggestedCount = useMemo(() => Object.values(dataset.columnPolicies).filter((p) => p.suggested && p.mask !== 'none').length, [dataset])
  const [confirm, confirmEl] = useConfirm()

  const set = (name: string, patch: Partial<ColumnPolicy>) => setColumns((c) => ({ ...c, [name]: { ...c[name], ...patch } }))

  const save = async () => {
    // A new or shorter retention period deletes old rows as soon as the policy is saved.
    const before = dataset.policy?.retentionDays ?? null
    if (retention !== null && (before === null || retention < before)) {
      const ok = await confirm({
        title: t('insights.governance.policy.retentionTitle', { dataset: dataset.name, days: retention }),
        description: t('insights.governance.policy.retentionBody', { days: retention }),
        confirmLabel: t('insights.governance.policy.retentionConfirm'),
        tone: 'danger',
      })
      if (!ok) return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await saveDatasetPolicy({ datasetName: dataset.name, columns, retentionDays: retention, rowFilters })
      setNotice(
        res.retentionDeleted
          ? t('insights.governance.policy.savedDeleted', { count: res.masked, deleted: formatNumber(res.retentionDeleted) })
          : t('insights.governance.policy.saved', { count: res.masked })
      )
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.governance.policy.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const showPreview = async () => {
    setError('')
    try {
      setPreview(await previewMaskedDataset(dataset.name))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.governance.policy.previewFailed'))
    }
  }

  const retentionOptions = RETENTION_PRESETS.includes(retention) ? RETENTION_PRESETS : [...RETENTION_PRESETS, retention]

  return (
    <div className="min-w-0 space-y-4">
      {confirmEl}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-mono text-lg font-semibold">{dataset.name}</h3>
          <p className="text-xs text-muted-foreground">
            {withNodes(t('insights.governance.policy.rowsLoaded'), {
              rows: <span className="font-mono">{formatNumber(dataset.rowCount)}</span>,
              when: <span className="font-mono">{when(dataset.lastLoadedAt)}</span>,
            })}
            {dataset.policy
              ? dataset.policy.updatedByEmail
                ? t('insights.governance.policy.policyUpdatedBy', { when: when(dataset.policy.updatedAt), email: dataset.policy.updatedByEmail })
                : t('insights.governance.policy.policyUpdated', { when: when(dataset.policy.updatedAt) })
              : ''}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void showPreview()} disabled={!dataset.policy}>
              <Eye className="mr-1 h-4 w-4" aria-hidden /> {t('insights.governance.policy.previewAsAnalyst')}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1 h-4 w-4" aria-hidden />} {t('insights.governance.policy.savePolicy')}
            </Button>
          </div>
        )}
      </div>

      {!dataset.policy && suggestedCount > 0 && (
        <Notice tone="warning" live={false}>
          {t(canManage ? 'insights.governance.policy.suggestedYou' : 'insights.governance.policy.suggestedOther', { count: suggestedCount })}
        </Notice>
      )}
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="rounded-md border border-border">
        <Table label={t('insights.governance.policy.columnPoliciesOf', { name: dataset.name })} className="min-w-[560px]">
          <THead>
            <tr>
              <Th>{t('insights.governance.policy.colColumn')}</Th>
              <Th>{t('insights.governance.policy.colClassification')}</Th>
              <Th>{t('insights.governance.policy.colMask')}</Th>
            </tr>
          </THead>
          <TBody>
            {dataset.columns.map((col) => {
              const p = columns[col.name]
              const suggested = dataset.columnPolicies[col.name]?.suggested
              return (
                <Tr key={col.name}>
                  <Td className="py-2">
                    <span className="font-mono text-xs">{col.name}</span> <span className="font-mono text-xs text-muted-foreground">{col.type}</span>
                    {suggested && p.mask !== 'none' && <Badge variant="outline" className="ml-2 text-[11px]">{t('insights.governance.policy.suggested')}</Badge>}
                  </Td>
                  <Td className="py-2">
                    <select
                      className={selectClass}
                      value={p.classification}
                      disabled={!canManage}
                      onChange={(e) => set(col.name, { classification: e.target.value as ColumnPolicy['classification'] })}
                      aria-label={t('insights.governance.policy.classificationOf', { column: col.name })}
                      title={t(`insights.governance.classifications.${p.classification}.description`)}
                    >
                      {CLASSIFICATIONS.map((c) => (
                        <option key={c} value={c}>{t(`insights.governance.classifications.${c}.label`)}</option>
                      ))}
                    </select>
                  </Td>
                  <Td className="py-2">
                    <select className={selectClass} value={p.mask} disabled={!canManage} onChange={(e) => set(col.name, { mask: e.target.value as ColumnPolicy['mask'] })} aria-label={t('insights.governance.policy.maskFor', { column: col.name })}>
                      {MASKS.map((m) => (
                        <option key={m} value={m}>{t(`insights.governance.masks.${m}`)} ({MASK_INFO[m].example})</option>
                      ))}
                    </select>
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor={`retention-${dataset.name}`} className="font-medium">
          {t('insights.governance.policy.retention')}
        </label>
        <select
          id={`retention-${dataset.name}`}
          className={selectClass}
          value={retention ?? ''}
          disabled={!canManage}
          onChange={(e) => setRetention(e.target.value ? Number(e.target.value) : null)}
        >
          {retentionOptions.map((days) => (
            <option key={days ?? 'all'} value={days ?? ''}>{retentionLabel(t, days)}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {retention
            ? dataset.policy?.retentionAppliedAt
              ? t('insights.governance.policy.retentionActiveLast', { days: retention, when: when(dataset.policy.retentionAppliedAt) })
              : t('insights.governance.policy.retentionActive', { days: retention })
            : t('insights.governance.policy.retentionNone')}
        </span>
      </div>

      <RowFiltersEditor filters={rowFilters} columns={dataset.columns.map((c) => c.name)} canManage={canManage} onChange={setRowFilters} />

      {preview && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">
            {t('insights.governance.policy.previewTitle')}
            {preview.masked.length ? t('insights.governance.policy.previewMasked', { columns: preview.masked.join(', ') }) : t('insights.governance.policy.previewNothing')}
            {preview.rowFilters ? t('insights.governance.policy.previewFilters', { count: preview.rowFilters }) : ''}
          </h4>
          <SampleTable rows={preview.rows} />
        </div>
      )}
    </div>
  )
}

function RowFiltersEditor({ filters, columns, canManage, onChange }: { filters: RowFilter[]; columns: string[]; canManage: boolean; onChange: (f: RowFilter[]) => void }) {
  const t = useT()
  const update = (i: number, patch: Partial<RowFilter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <section className="space-y-2 rounded-md border border-border p-3" aria-label={t('insights.governance.rowFilters.title')}>
      <div>
        <h4 className="text-sm font-medium">{t('insights.governance.rowFilters.title')}</h4>
        <p className="text-xs text-muted-foreground">{t('insights.governance.rowFilters.body')}</p>
      </div>
      {filters.length === 0 && <p className="text-xs text-muted-foreground">{t('insights.governance.rowFilters.none')}</p>}
      {filters.map((f, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-sm" role="group" aria-label={t('insights.governance.rowFilters.group', { n: i + 1 })}>
          <span className="text-xs text-muted-foreground">{t('insights.governance.rowFilters.roles')}</span>
          <div className="flex flex-wrap gap-1">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                disabled={!canManage}
                aria-pressed={f.roles.includes(r)}
                onClick={() => update(i, { roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] })}
                className={cn(
                  'rounded-sm border px-1.5 py-0.5 text-xs disabled:opacity-60',
                  focusRing,
                  f.roles.includes(r) ? 'border-primary bg-accent font-medium text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'
                )}
              >
                {roleLabel(t, r)}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{t('insights.governance.rowFilters.onlySee')}</span>
          <select className={selectClass} value={f.column} disabled={!canManage} onChange={(e) => update(i, { column: e.target.value })} aria-label={t('insights.governance.rowFilters.columnFor', { n: i + 1 })}>
            <option value="">{t('insights.governance.rowFilters.columnPlaceholder')}</option>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select className={selectClass} value={f.operator} disabled={!canManage} onChange={(e) => update(i, { operator: e.target.value as RowFilter['operator'] })} aria-label={t('insights.governance.rowFilters.operatorFor', { n: i + 1 })}>
            {ROW_FILTER_OPERATORS.map((o) => (
              <option key={o} value={o}>{t(`insights.governance.rowFilters.ops.${o}`)}</option>
            ))}
          </select>
          <Input className="h-8 w-48" value={f.value} disabled={!canManage} placeholder={f.operator === 'in_list' ? 'KMP, KMI' : t('insights.governance.rowFilters.valuePlaceholder')} onChange={(e) => update(i, { value: e.target.value })} aria-label={t('insights.governance.rowFilters.valueFor', { n: i + 1 })} />
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => onChange(filters.filter((_, j) => j !== i))} aria-label={t('insights.governance.rowFilters.removeLabel', { n: i + 1 })}>
              {t('insights.governance.rowFilters.remove')}
            </Button>
          )}
        </div>
      ))}
      {canManage && (
        <Button size="sm" variant="outline" onClick={() => onChange([...filters, { roles: ['analyst'], column: columns[0] ?? '', operator: 'equals', value: '' }])} disabled={filters.length >= 20}>
          {t('insights.governance.rowFilters.add')}
        </Button>
      )}
    </section>
  )
}

function Erasure({ onDone }: { onDone: () => void }) {
  const { t, formatNumber } = usePrefs()
  const [columns, setColumns] = useState<{ name: string; datasets: number }[]>([])
  const [column, setColumn] = useState('')
  const [value, setValue] = useState('')
  const [matches, setMatches] = useState<{ dataset: string; matches: number }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [confirm, confirmEl] = useConfirm()

  useEffect(() => {
    listErasureColumns()
      .then((c) => {
        setColumns(c)
        setColumn((cur) => cur || (c.find((x) => /employee|email|nik|code|id/i.test(x.name))?.name ?? c[0]?.name ?? ''))
      })
      .catch(() => setColumns([]))
  }, [])

  const total = matches?.reduce((s, m) => s + m.matches, 0) ?? 0

  const find = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setResult('')
    try {
      setMatches(await findErasureMatches({ column, value }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.governance.erasure.searchFailed'))
    } finally {
      setBusy(false)
    }
  }

  const erase = async () => {
    const ok = await confirm({
      title: t('insights.governance.erasure.eraseTitle', { count: formatNumber(total) }),
      description: t('insights.governance.erasure.eraseBody', { column, value, datasets: matches?.filter((m) => m.matches > 0).length ?? 0 }),
      confirmLabel: t('insights.governance.erasure.eraseConfirm'),
      tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      const res = await eraseRecords({ column, value })
      setResult(t('insights.governance.erasure.erased', { count: formatNumber(res.total), datasets: res.erased.filter((e) => e.deleted).length }))
      setMatches(null)
      setValue('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.governance.erasure.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="erasure" className="scroll-mt-6 rounded-lg border border-border bg-card p-5" aria-labelledby="gov-erasure">
      {confirmEl}
      <div className="mb-1 flex items-center gap-2">
        <Eraser className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 id="gov-erasure" className="text-base font-semibold">{t('insights.governance.erasure.title')}</h2>
        <Badge variant="outline" className="font-mono">UU PDP</Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {t('insights.governance.erasure.body')}
      </p>
      {columns.length === 0 ? (
        <EmptyState compact icon={<Database />} title={t('insights.governance.noDatasetsTitle')}>
          {t('insights.governance.erasure.noDatasetsBody')}
        </EmptyState>
      ) : (
        <form onSubmit={find} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('insights.governance.erasure.matchColumn')}</span>
            <select className={cn(selectClass, 'h-9')} value={column} onChange={(e) => { setColumn(e.target.value); setMatches(null) }}>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>{t('insights.governance.erasure.columnOption', { name: c.name, count: c.datasets })}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('insights.governance.erasure.exactValue')}</span>
            <Input value={value} onChange={(e) => { setValue(e.target.value); setMatches(null) }} placeholder={t('insights.governance.erasure.valuePlaceholder')} className="w-56" required />
          </label>
          <Button type="submit" variant="outline" disabled={busy || !value.trim()}>
            {busy && !matches ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}{t('insights.governance.erasure.find')}
          </Button>
        </form>
      )}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {result && <Notice tone="success" className="mt-3">{result}</Notice>}
      {matches && (
        <div className="mt-4 space-y-3">
          <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label={t('insights.governance.erasure.matchesLabel')}>
            {matches.map((m) => (
              <li key={m.dataset} className="flex justify-between px-3 py-2">
                <span className="font-mono text-xs">{m.dataset}</span>
                <span className="font-mono text-xs tabular-nums">{t('insights.governance.erasure.rows', { count: formatNumber(m.matches) })}</span>
              </li>
            ))}
          </ul>
          {total > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                {withNodes(t('insights.governance.erasure.summary', { count: formatNumber(total) }), { column: <span className="font-mono">{column}</span>, value })}
              </span>
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void erase()}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}{t('insights.governance.erasure.eraseButton', { count: formatNumber(total) })}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMatches(null)}>{t('common.cancel')}</Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('insights.governance.erasure.noMatches')}</p>
          )}
        </div>
      )}
    </section>
  )
}
