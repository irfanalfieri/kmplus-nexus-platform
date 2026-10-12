'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, Eraser, Eye, KeyRound, Loader2, LockKeyhole, Save, ScrollText, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/data-table'
import { PageHeader } from '@/components/dashboard/page-header'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { useT } from '@/components/i18n/i18n-provider'
import { cn } from '@/lib/utils'
import { eraseRecords, findErasureMatches, getGovernanceOverview, listErasureColumns, previewMaskedDataset, saveDatasetPolicy } from '@/lib/actions/governance'
import { CLASSIFICATIONS, CLASSIFICATION_INFO, MASKS, MASK_INFO, type ColumnPolicy } from '@/lib/governance/definition'
import { ROLES, ROLE_INFO } from '@/lib/auth/permissions'
import { ROW_FILTER_OPERATORS, type RowFilter } from '@/lib/governance/row-filters'
import { SampleTable } from '@/components/pipelines/pipeline-editor'

type Overview = Awaited<ReturnType<typeof getGovernanceOverview>>
type Dataset = Overview['datasets'][number]

const selectClass = nativeSelectClass
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const RETENTION_PRESETS = [
  { label: 'Keep everything', days: null },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
  { label: '2 years', days: 730 },
  { label: '5 years', days: 1825 },
  { label: '10 years', days: 3650 },
] as const
const when = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) + ' WIB' : '—'

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
      setError(err instanceof Error ? err.message : 'Failed to load governance data')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dataset = data?.datasets.find((d) => d.name === selected) ?? null

  return (
    <div className="space-y-6">
      <PageHeader title={t('pages.governance.title')} description={t('pages.governance.description')} />

      {data && !data.seesUnmasked && (
        <Notice tone="info" live={false}>
          Your role ({ROLE_INFO[data.role].label}) sees masked values.
        </Notice>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      {!data ? (
        !error && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-muted-foreground" role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading governance data…
          </div>
        )
      ) : (
        <>
          <Controls data={data} />

          <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="gov-policies">
            <div className="mb-1 flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h2 id="gov-policies" className="text-base font-semibold">Dataset policies</h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Masked columns show as masked values to operators, analysts, auditors and viewers in dataset previews, and can&apos;t be used in Analytics. Admins and data stewards see real values. Suggestions come from column names and apply only once saved.
            </p>
            {data.datasets.length === 0 ? (
              <EmptyState compact icon={<Database />} title="No datasets yet">
                Pipelines that write to a Nexus dataset create them; their policies are set here.
              </EmptyState>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
                <ul className="space-y-1" aria-label="Datasets">
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
                            {d.policy ? `${masked} masked${d.policy.retentionDays ? ` · keep ${d.policy.retentionDays}d` : ''}` : 'No policy yet'}
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
  const c = data.controls
  const tiles = [
    {
      label: 'Two-factor authentication',
      value: `${c.membersWith2fa} of ${c.members} members`,
      ok: c.membersWith2fa === c.members,
      hint: c.membersWith2fa === c.members ? 'Required for every account' : 'Some members still have to finish setup',
      icon: ShieldCheck,
      action: { label: 'Members', tab: 'settings/members' },
    },
    {
      label: 'Credentials encrypted',
      value: `${c.encryptedSources} of ${c.dataSources} sources`,
      ok: c.encryptedSources === c.dataSources && (c.onCurrentKey === null || c.onCurrentKey === c.dataSources),
      hint: c.onCurrentKey !== null && c.onCurrentKey < c.encryptedSources ? `${c.encryptedSources - c.onCurrentKey} on an older key: run the re-encrypt script` : 'AES-256-GCM, current key',
      icon: KeyRound,
    },
    {
      label: 'Audit trail',
      value: `${c.auditEvents7d.toLocaleString()} events · 7 days`,
      ok: true,
      hint: 'Changes, data views, runs and logins with IP',
      icon: ScrollText,
      action: { label: 'Audit log', tab: 'settings/audit' },
    },
    {
      label: 'Datasets with a policy',
      value: `${c.datasetsWithPolicy} of ${c.datasets}`,
      ok: c.datasets === 0 || c.datasetsWithPolicy === c.datasets,
      hint: `${c.classifiedPersonal} personal/sensitive columns · ${c.maskedColumns} masked`,
      icon: LockKeyhole,
    },
    {
      label: 'Retention',
      value: `${c.retentionPolicies} polic${c.retentionPolicies === 1 ? 'y' : 'ies'}`,
      ok: true,
      hint: 'Rows older than the limit are deleted hourly',
      icon: Eraser,
    },
    {
      label: 'Roles & access',
      value: 'Server-enforced',
      ok: true,
      hint: 'Six roles; every action checks permissions',
      icon: Users,
      action: { label: 'Roles', tab: 'settings/members' },
    },
  ]
  return (
    <section aria-labelledby="gov-controls" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <h2 id="gov-controls" className="sr-only">
        Security controls
      </h2>
      {tiles.map((t) => {
        const Icon = t.icon
        return (
          <div key={t.label} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                <Icon className="h-4 w-4" aria-hidden /> {t.label}
              </h3>
              {t.ok ? (
                <span className="flex items-center gap-1 text-xs font-medium text-live-text"><CheckCircle2 className="h-3.5 w-3.5 text-live" aria-hidden /> OK</span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium text-warning-text"><AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden /> Attention</span>
              )}
            </div>
            <div className="mt-2 font-mono text-xl font-semibold tabular-nums">{t.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t.hint}</div>
            {t.action && (
              <Link href={`/dashboard/${t.action.tab}`} className={cn('mt-2 inline-block rounded-sm text-xs font-medium text-info-text underline-offset-4 hover:underline', focusRing)}>
                {t.action.label} →
              </Link>
            )}
          </div>
        )
      })}
    </section>
  )
}

function PolicyEditor({ dataset, canManage, onSaved }: { dataset: Dataset; canManage: boolean; onSaved: () => void }) {
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
        title: `Keep ${dataset.name} rows for ${retention} days?`,
        description: `Rows loaded more than ${retention} days ago are deleted when you save, and every hour after that. Deleted rows can't be restored.`,
        confirmLabel: 'Save and delete old rows',
        tone: 'danger',
      })
      if (!ok) return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await saveDatasetPolicy({ datasetName: dataset.name, columns, retentionDays: retention, rowFilters })
      setNotice(`Policy saved: ${res.masked} masked column${res.masked === 1 ? '' : 's'}${res.retentionDeleted ? `, ${res.retentionDeleted.toLocaleString()} rows older than the retention limit deleted` : ''}.`)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const showPreview = async () => {
    setError('')
    try {
      setPreview(await previewMaskedDataset(dataset.name))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    }
  }

  const retentionOptions = RETENTION_PRESETS.some((p) => p.days === retention) ? RETENTION_PRESETS : [...RETENTION_PRESETS, { label: `${retention} days`, days: retention }]

  return (
    <div className="min-w-0 space-y-4">
      {confirmEl}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-mono text-lg font-semibold">{dataset.name}</h3>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{dataset.rowCount.toLocaleString()}</span> rows · loaded <span className="font-mono">{when(dataset.lastLoadedAt)}</span>
            {dataset.policy ? ` · policy updated ${when(dataset.policy.updatedAt)}${dataset.policy.updatedByEmail ? ` by ${dataset.policy.updatedByEmail}` : ''}` : ''}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void showPreview()} disabled={!dataset.policy}>
              <Eye className="mr-1 h-4 w-4" aria-hidden /> Preview as analyst
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1 h-4 w-4" aria-hidden />} Save policy
            </Button>
          </div>
        )}
      </div>

      {!dataset.policy && suggestedCount > 0 && (
        <Notice tone="warning" live={false}>
          {suggestedCount} column{suggestedCount === 1 ? ' looks' : 's look'} personal or sensitive. The suggested masks below aren&apos;t enforced until {canManage ? 'you save' : 'an admin or data steward saves'} this policy.
        </Notice>
      )}
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="rounded-md border border-border">
        <Table label={`Column policies of ${dataset.name}`} className="min-w-[560px]">
          <THead>
            <tr>
              <Th>Column</Th>
              <Th>Classification</Th>
              <Th>Mask for other roles</Th>
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
                    {suggested && p.mask !== 'none' && <Badge variant="outline" className="ml-2 text-[10px]">suggested</Badge>}
                  </Td>
                  <Td className="py-2">
                    <select
                      className={selectClass}
                      value={p.classification}
                      disabled={!canManage}
                      onChange={(e) => set(col.name, { classification: e.target.value as ColumnPolicy['classification'] })}
                      aria-label={`Classification of ${col.name}`}
                      title={CLASSIFICATION_INFO[p.classification].description}
                    >
                      {CLASSIFICATIONS.map((c) => (
                        <option key={c} value={c}>{CLASSIFICATION_INFO[c].label}</option>
                      ))}
                    </select>
                  </Td>
                  <Td className="py-2">
                    <select className={selectClass} value={p.mask} disabled={!canManage} onChange={(e) => set(col.name, { mask: e.target.value as ColumnPolicy['mask'] })} aria-label={`Mask for ${col.name}`}>
                      {MASKS.map((m) => (
                        <option key={m} value={m}>{MASK_INFO[m].label} ({MASK_INFO[m].example})</option>
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
          Retention
        </label>
        <select
          id={`retention-${dataset.name}`}
          className={selectClass}
          value={retention ?? ''}
          disabled={!canManage}
          onChange={(e) => setRetention(e.target.value ? Number(e.target.value) : null)}
        >
          {retentionOptions.map((r) => (
            <option key={r.label} value={r.days ?? ''}>{r.label}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {retention ? `Rows loaded more than ${retention} days ago are deleted (checked hourly${dataset.policy?.retentionAppliedAt ? `, last ${when(dataset.policy.retentionAppliedAt)}` : ''}).` : 'Rows are kept until a pipeline replaces them.'}
        </span>
      </div>

      <RowFiltersEditor filters={rowFilters} columns={dataset.columns.map((c) => c.name)} canManage={canManage} onChange={setRowFilters} />

      {preview && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">
            What an analyst sees (first rows, saved policy){preview.masked.length ? `: ${preview.masked.join(', ')} masked` : ': nothing masked'}
            {preview.rowFilters ? ` · ${preview.rowFilters} row filter${preview.rowFilters === 1 ? '' : 's'} applied` : ''}
          </h4>
          <SampleTable rows={preview.rows} />
        </div>
      )}
    </div>
  )
}

function RowFiltersEditor({ filters, columns, canManage, onChange }: { filters: RowFilter[]; columns: string[]; canManage: boolean; onChange: (f: RowFilter[]) => void }) {
  const update = (i: number, patch: Partial<RowFilter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <section className="space-y-2 rounded-md border border-border p-3" aria-label="Row-level access">
      <div>
        <h4 className="text-sm font-medium">Row-level access</h4>
        <p className="text-xs text-muted-foreground">
          Limit which rows a role sees, e.g. analysts only see their company. Applies to previews, Analytics and the Data API. Several filters for the same role all apply.
        </p>
      </div>
      {filters.length === 0 && <p className="text-xs text-muted-foreground">Every role sees every row.</p>}
      {filters.map((f, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-sm" role="group" aria-label={`Row filter ${i + 1}`}>
          <span className="text-xs text-muted-foreground">Roles</span>
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
                {ROLE_INFO[r].label}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">only see rows where</span>
          <select className={selectClass} value={f.column} disabled={!canManage} onChange={(e) => update(i, { column: e.target.value })} aria-label={`Column for row filter ${i + 1}`}>
            <option value="">column…</option>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select className={selectClass} value={f.operator} disabled={!canManage} onChange={(e) => update(i, { operator: e.target.value as RowFilter['operator'] })} aria-label={`Operator for row filter ${i + 1}`}>
            {ROW_FILTER_OPERATORS.map((o) => (
              <option key={o} value={o}>{o === 'in_list' ? 'is one of' : o.replace('_', ' ')}</option>
            ))}
          </select>
          <Input className="h-8 w-48" value={f.value} disabled={!canManage} placeholder={f.operator === 'in_list' ? 'KMP, KMI' : 'value'} onChange={(e) => update(i, { value: e.target.value })} aria-label={`Value for row filter ${i + 1}`} />
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => onChange(filters.filter((_, j) => j !== i))} aria-label={`Remove row filter ${i + 1}`}>
              Remove
            </Button>
          )}
        </div>
      ))}
      {canManage && (
        <Button size="sm" variant="outline" onClick={() => onChange([...filters, { roles: ['analyst'], column: columns[0] ?? '', operator: 'equals', value: '' }])} disabled={filters.length >= 20}>
          Add row filter
        </Button>
      )}
    </section>
  )
}

function Erasure({ onDone }: { onDone: () => void }) {
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
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setBusy(false)
    }
  }

  const erase = async () => {
    const ok = await confirm({
      title: `Erase ${total.toLocaleString()} row${total === 1 ? '' : 's'}?`,
      description: `Permanently delete every row where ${column} = “${value}” from ${matches?.filter((m) => m.matches > 0).length ?? 0} dataset(s). This can't be undone. Also remove the person from the source system, or the next pipeline run brings them back.`,
      confirmLabel: 'Erase records',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      const res = await eraseRecords({ column, value })
      setResult(`Erased ${res.total.toLocaleString()} row${res.total === 1 ? '' : 's'} from ${res.erased.filter((e) => e.deleted).length} dataset(s). The audit log records a hash of the value, not the value.`)
      setMatches(null)
      setValue('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erasure failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="gov-erasure">
      {confirmEl}
      <div className="mb-1 flex items-center gap-2">
        <Eraser className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 id="gov-erasure" className="text-base font-semibold">Right to erasure</h2>
        <Badge variant="outline" className="font-mono">UU PDP</Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Delete one person&apos;s records from every dataset in this workspace. Also remove them from the source system, or the next pipeline run brings them back. Admins only.
      </p>
      {columns.length === 0 ? (
        <EmptyState compact icon={<Database />} title="No datasets yet">
          Erasure searches the datasets your pipelines write.
        </EmptyState>
      ) : (
        <form onSubmit={find} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Match column</span>
            <select className={cn(selectClass, 'h-9')} value={column} onChange={(e) => { setColumn(e.target.value); setMatches(null) }}>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>{c.name} ({c.datasets} dataset{c.datasets === 1 ? '' : 's'})</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Exact value</span>
            <Input value={value} onChange={(e) => { setValue(e.target.value); setMatches(null) }} placeholder="e.g. E00123" className="w-56" required />
          </label>
          <Button type="submit" variant="outline" disabled={busy || !value.trim()}>
            {busy && !matches ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}Find records
          </Button>
        </form>
      )}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {result && <Notice tone="success" className="mt-3">{result}</Notice>}
      {matches && (
        <div className="mt-4 space-y-3">
          <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label="Matching rows per dataset">
            {matches.map((m) => (
              <li key={m.dataset} className="flex justify-between px-3 py-2">
                <span className="font-mono text-xs">{m.dataset}</span>
                <span className="font-mono text-xs tabular-nums">{m.matches.toLocaleString()} row{m.matches === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
          {total > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                <span className="font-mono">{total.toLocaleString()}</span> row{total === 1 ? '' : 's'} where <span className="font-mono">{column}</span> = &ldquo;{value}&rdquo;.
              </span>
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void erase()}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}Erase {total.toLocaleString()} row{total === 1 ? '' : 's'}…
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMatches(null)}>Cancel</Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No matching rows.</p>
          )}
        </div>
      )}
    </section>
  )
}
