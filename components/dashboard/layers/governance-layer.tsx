'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Eraser, Eye, KeyRound, Loader2, LockKeyhole, Save, ScrollText, Shield, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { eraseRecords, findErasureMatches, getGovernanceOverview, listErasureColumns, previewMaskedDataset, saveDatasetPolicy } from '@/lib/actions/governance'
import { CLASSIFICATIONS, CLASSIFICATION_INFO, MASKS, MASK_INFO, type ColumnPolicy } from '@/lib/governance/definition'
import { ROLE_INFO } from '@/lib/auth/permissions'
import { SampleTable } from '@/components/pipelines/pipeline-editor'

type Overview = Awaited<ReturnType<typeof getGovernanceOverview>>
type Dataset = Overview['datasets'][number]

const selectClass = 'h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60'
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

export default function GovernanceLayer({ onNavigate }: { onNavigate: (tab: string) => void }) {
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
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-2 flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <Badge variant="outline">Layer 13</Badge>
        </div>
        <h2 className="text-2xl font-bold">Governance & data protection</h2>
        <p className="mt-1 text-muted-foreground">
          Security controls for this workspace, and per-dataset policies: which columns hold personal data, how they are masked, and how long rows are kept.
          {data && !data.seesUnmasked && ` Your role (${ROLE_INFO[data.role].label}) sees masked values.`}
        </p>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {!data ? (
        !error && (
          <div className="flex items-center justify-center rounded-xl border border-border bg-card p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading governance data…
          </div>
        )
      ) : (
        <>
          <Controls data={data} onNavigate={onNavigate} />

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-1 flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Dataset policies</h3>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Masked columns show as masked values to operators, analysts, auditors and viewers in dataset previews, and can&apos;t be used in Analytics. Admins and data stewards see real values. Suggestions come from column names and apply only once saved.
            </p>
            {data.datasets.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No datasets yet. Pipelines that write to a Nexus dataset create them; their policies are set here.</p>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
                <ul className="space-y-1" aria-label="Datasets">
                  {data.datasets.map((d) => {
                    const masked = Object.values(d.columnPolicies).filter((p) => !p.suggested && p.mask !== 'none').length
                    return (
                      <li key={d.name}>
                        <button
                          onClick={() => setSelected(d.name)}
                          aria-current={selected === d.name}
                          className={`w-full rounded-md px-3 py-2 text-left text-sm ${selected === d.name ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                        >
                          <div className="truncate font-medium">{d.name}</div>
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

function Controls({ data, onNavigate }: { data: Overview; onNavigate: (tab: string) => void }) {
  const c = data.controls
  const tiles = [
    {
      label: 'Two-factor authentication',
      value: `${c.membersWith2fa} of ${c.members} members`,
      ok: c.membersWith2fa === c.members,
      hint: c.membersWith2fa === c.members ? 'Required for every account' : 'Some members still have to finish setup',
      icon: ShieldCheck,
      action: { label: 'Members', tab: 'settings' },
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
      action: { label: 'Audit log', tab: 'settings' },
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
      action: { label: 'Roles', tab: 'settings' },
    },
  ]
  return (
    <section aria-label="Security controls" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map((t) => {
        const Icon = t.icon
        return (
          <div key={t.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4" aria-hidden /> {t.label}
              </div>
              {t.ok ? (
                <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> OK</span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Attention</span>
              )}
            </div>
            <div className="mt-2 text-xl font-semibold">{t.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t.hint}</div>
            {t.action && (
              <button className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline" onClick={() => onNavigate(t.action!.tab)}>
                {t.action.label} →
              </button>
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
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; masked: string[] } | null>(null)
  const suggestedCount = useMemo(() => Object.values(dataset.columnPolicies).filter((p) => p.suggested && p.mask !== 'none').length, [dataset])

  const set = (name: string, patch: Partial<ColumnPolicy>) => setColumns((c) => ({ ...c, [name]: { ...c[name], ...patch } }))

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await saveDatasetPolicy({ datasetName: dataset.name, columns, retentionDays: retention })
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold">{dataset.name}</h4>
          <p className="text-xs text-muted-foreground">
            {dataset.rowCount.toLocaleString()} rows · loaded {when(dataset.lastLoadedAt)}
            {dataset.policy ? ` · policy updated ${when(dataset.policy.updatedAt)}${dataset.policy.updatedByEmail ? ` by ${dataset.policy.updatedByEmail}` : ''}` : ''}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void showPreview()} disabled={!dataset.policy}>
              <Eye className="mr-1 h-4 w-4" /> Preview as analyst
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save policy
            </Button>
          </div>
        )}
      </div>

      {!dataset.policy && suggestedCount > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {suggestedCount} column{suggestedCount === 1 ? ' looks' : 's look'} personal or sensitive. The suggested masks below aren&apos;t enforced until {canManage ? 'you save' : 'an admin or data steward saves'} this policy.
        </p>
      )}
      {notice && <p className="rounded-md border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400" role="status">{notice}</p>}
      {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="px-2 py-2">Column</th>
              <th className="px-2 py-2">Classification</th>
              <th className="px-2 py-2">Mask for other roles</th>
            </tr>
          </thead>
          <tbody>
            {dataset.columns.map((col) => {
              const p = columns[col.name]
              const suggested = dataset.columnPolicies[col.name]?.suggested
              return (
                <tr key={col.name} className="border-b border-border/60">
                  <td className="px-2 py-2">
                    <span className="font-mono text-xs">{col.name}</span> <span className="text-xs text-muted-foreground">{col.type}</span>
                    {suggested && p.mask !== 'none' && <Badge variant="outline" className="ml-2 text-[10px]">suggested</Badge>}
                  </td>
                  <td className="px-2 py-2">
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
                  </td>
                  <td className="px-2 py-2">
                    <select className={selectClass} value={p.mask} disabled={!canManage} onChange={(e) => set(col.name, { mask: e.target.value as ColumnPolicy['mask'] })} aria-label={`Mask for ${col.name}`}>
                      {MASKS.map((m) => (
                        <option key={m} value={m}>{MASK_INFO[m].label} ({MASK_INFO[m].example})</option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Retention</span>
        <select
          className={selectClass}
          value={retention ?? ''}
          disabled={!canManage}
          onChange={(e) => setRetention(e.target.value ? Number(e.target.value) : null)}
          aria-label="Retention period"
        >
          {retentionOptions.map((r) => (
            <option key={r.label} value={r.days ?? ''}>{r.label}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {retention ? `Rows loaded more than ${retention} days ago are deleted (checked hourly${dataset.policy?.retentionAppliedAt ? `, last ${when(dataset.policy.retentionAppliedAt)}` : ''}).` : 'Rows are kept until a pipeline replaces them.'}
        </span>
      </label>

      {preview && (
        <div className="space-y-2">
          <div className="text-sm font-medium">What an analyst sees (first rows, saved policy){preview.masked.length ? `: ${preview.masked.join(', ')} masked` : ': nothing masked'}</div>
          <SampleTable rows={preview.rows} />
        </div>
      )}
    </div>
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
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Eraser className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Right to erasure</h3>
        <Badge variant="outline">UU PDP</Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Delete one person&apos;s records from every dataset in this workspace. Also remove them from the source system, or the next pipeline run brings them back. Admins only.
      </p>
      {columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No datasets yet.</p>
      ) : (
        <form onSubmit={find} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Match column</span>
            <select className={`${selectClass} h-9`} value={column} onChange={(e) => { setColumn(e.target.value); setMatches(null) }}>
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
            {busy && !matches ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Find records
          </Button>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {result && <p className="mt-3 rounded-md border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400" role="status">{result}</p>}
      {matches && (
        <div className="mt-4 space-y-3">
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {matches.map((m) => (
              <li key={m.dataset} className="flex justify-between px-3 py-2">
                <span className="font-mono text-xs">{m.dataset}</span>
                <span className="tabular-nums">{m.matches.toLocaleString()} row{m.matches === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
          {total > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              Permanently delete {total.toLocaleString()} row{total === 1 ? '' : 's'} where <span className="font-mono">{column}</span> = &ldquo;{value}&rdquo;?
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void erase()}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Erase
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
