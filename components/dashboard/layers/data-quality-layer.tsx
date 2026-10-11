'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCheck, Loader2, Play, RefreshCw, ShieldAlert, ShieldCheck, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { approveRows, bulkFix, dismissRows, fixRow, getQualityOverview, listQuarantine, replayRows } from '@/lib/actions/quality'
import { NativeSelect } from '@/components/pipelines/step-editors'
import { formatWhen } from '@/components/pipelines/run-history'
import { useCan } from '@/components/workspace/workspace-context'

type Overview = Awaited<ReturnType<typeof getQualityOverview>>
type Item = Awaited<ReturnType<typeof listQuarantine>>['rows'][number]
type Status = 'open' | 'fixed' | 'approved' | 'replayed' | 'dismissed'

const show = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))

function KindBadge({ item }: { item: Item }) {
  if (item.kind === 'approval') return <Badge variant="outline" className="border-primary text-primary">needs approval</Badge>
  if (item.kind === 'flag') return <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">{item.severity}</Badge>
  return <Badge variant="destructive">invalid</Badge>
}

export default function DataQualityLayer() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<Status>('open')
  const [kind, setKind] = useState('')
  const [pipelineId, setPipelineId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [bulkField, setBulkField] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const canPreview = useCan('data:preview')
  const canManage = useCan('quality:manage')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, inbox] = await Promise.all([
        getQualityOverview(),
        canPreview ? listQuarantine({ status, kind: (kind || undefined) as 'invalid' | 'approval' | 'flag' | undefined, pipelineId: pipelineId || undefined }) : Promise.resolve({ rows: [], total: 0 }),
      ])
      setOverview(ov)
      setItems(inbox.rows)
      setTotal(inbox.total)
      setSelected(new Set())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data quality')
    } finally {
      setLoading(false)
    }
  }, [status, kind, pipelineId, canPreview])

  useEffect(() => {
    void load()
  }, [load])

  const fields = useMemo(() => Array.from(new Set(items.filter((i) => selected.has(i.id)).flatMap((i) => Object.keys(i.fixedRow ?? i.row)))), [items, selected])
  const ids = [...selected]
  const act = async (fn: () => Promise<string>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setNotice(await fn())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const replay = () =>
    act(async () => {
      const res = await replayRows(ids)
      return res.map((r) => (r.status === 'queued' ? `Replaying ${r.rows} row(s) in the background (run ${r.runId.slice(-6)}). Rows that fail again return to the inbox.` : `${r.rows} row(s) not replayed: ${r.message}`)).join(' ')
    })

  const pipelineOptions = overview?.pipelines ?? []

  return (
    <div className="space-y-6">
      {editing && <FixDialog item={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice('Fix saved. Select the row and Replay to write it.'); await load() }} />}

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <Badge variant="outline">Layer 12</Badge>
        </div>
        <h2 className="text-2xl font-bold">Data Quality</h2>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Rows your pipelines quarantined, held for approval or flagged. Fix them inline or in bulk, approve held rows, then replay them through the pipeline from the step that stopped them.
        </p>
      </div>

      {overview && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[
            ['Open issues', overview.open.total],
            ['Invalid rows', overview.open.invalid],
            ['Awaiting approval', overview.open.approval],
            ['Flagged (written)', overview.open.flag],
            ['Fixed, not replayed', overview.fixed],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="mt-1 text-2xl font-bold">{Number(value).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {overview && (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-semibold">Quality score by pipeline</h3>
            <p className="mb-3 text-xs text-muted-foreground">Share of rows read in the last 30 days that passed every check (not quarantined or flagged).</p>
            {overview.pipelines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs in the last 30 days.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">Pipeline</th>
                    <th className="font-medium">Score</th>
                    <th className="text-right font-medium">Read</th>
                    <th className="text-right font-medium">Quarantined</th>
                    <th className="text-right font-medium">Flagged</th>
                    <th className="text-right font-medium">Failed runs</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.pipelines.map((p) => (
                    <tr key={p.pipelineId} className="border-b border-border/60">
                      <td className="py-2">
                        <div className="font-medium">{p.name}</div>
                        {p.datasets.length > 0 && <div className="text-xs text-muted-foreground">→ {p.datasets.join(', ')}</div>}
                      </td>
                      <td className="w-40">
                        {p.score === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                              <div className={`h-full rounded-full ${p.score >= 98 ? 'bg-green-600' : p.score >= 90 ? 'bg-amber-500' : 'bg-destructive'}`} style={{ width: `${p.score}%` }} />
                            </div>
                            <span className="w-12 text-right tabular-nums">{p.score}%</span>
                          </div>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{p.read.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{p.quarantined.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{p.flagged.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{p.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 font-semibold">Most common open problems</h3>
            {overview.topProblems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing open. 🎉</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {overview.topProblems.map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Badge variant="secondary" className="tabular-nums">{t.n}</Badge>
                    <span>
                      {t.message ?? 'Unknown problem'} <span className="text-xs text-muted-foreground">· {t.pipelineName}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <ShieldAlert className="h-4 w-4 text-primary" />
          <h3 className="mr-auto font-semibold">Quarantine inbox</h3>
          <NativeSelect className="w-36" value={status} onChange={(v) => setStatus(v as Status)} aria-label="Status">
            <option value="open">Open</option>
            <option value="fixed">Fixed</option>
            <option value="approved">Approved</option>
            <option value="replayed">Replayed</option>
            <option value="dismissed">Dismissed</option>
          </NativeSelect>
          <NativeSelect className="w-40" value={kind} onChange={setKind} aria-label="Kind">
            <option value="">All kinds</option>
            <option value="invalid">Invalid</option>
            <option value="approval">Needs approval</option>
            <option value="flag">Flagged</option>
          </NativeSelect>
          <NativeSelect className="w-48" value={pipelineId} onChange={setPipelineId} aria-label="Pipeline">
            <option value="">All pipelines</option>
            {pipelineOptions.map((p) => (
              <option key={p.pipelineId} value={p.pipelineId}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {canManage && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 p-3 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <span className="mx-1 text-muted-foreground">|</span>
            <span className="text-muted-foreground">Set</span>
            <NativeSelect className="w-40" value={bulkField} onChange={setBulkField} aria-label="Field to set">
              <option value="">field…</option>
              {fields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </NativeSelect>
            <span className="text-muted-foreground">to</span>
            <Input className="h-9 w-40" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder="value (empty = null)" aria-label="Value" />
            <Button size="sm" variant="outline" disabled={busy || !bulkField} onClick={() => act(async () => `Updated ${(await bulkFix({ ids, field: bulkField, value: bulkValue })).updated} row(s).`)}>
              <Wrench className="mr-1 h-4 w-4" /> Bulk fix
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(async () => `Approved ${(await approveRows(ids)).approved} row(s). Replay them to write.`)}>
              <CheckCheck className="mr-1 h-4 w-4" /> Approve
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void replay()}>
              <Play className="mr-1 h-4 w-4" /> Replay
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(async () => `Dismissed ${(await dismissRows(ids)).dismissed} row(s).`)}>
              <X className="mr-1 h-4 w-4" /> Dismiss
            </Button>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        )}
        {notice && <p className="border-b border-border bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">{notice}</p>}
        {error && <p className="border-b border-border bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        {!canPreview ? (
          <p className="p-6 text-sm text-muted-foreground">Your role sees quality counts but not row contents.</p>
        ) : loading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No {status} rows{kind ? ` of this kind` : ''}. Rows appear here when a pipeline&apos;s Validate or Business rules step quarantines, holds or flags them.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="w-8 p-2">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={selected.size === items.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                    />
                  </th>
                  <th className="p-2 font-medium">Kind</th>
                  <th className="p-2 font-medium">Problem</th>
                  <th className="p-2 font-medium">Row</th>
                  <th className="p-2 font-medium">Pipeline · step</th>
                  <th className="p-2 font-medium">When</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const row = i.fixedRow ?? i.row
                  return (
                    <tr key={i.id} className="border-b border-border/60 align-top">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={selected.has(i.id)}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(i.id)
                            else next.delete(i.id)
                            setSelected(next)
                          }}
                        />
                      </td>
                      <td className="whitespace-nowrap p-2">
                        <KindBadge item={i} />
                        {i.fixedRow && <Badge variant="secondary" className="ml-1">fixed</Badge>}
                      </td>
                      <td className={`max-w-xs p-2 ${i.kind === 'flag' ? 'text-amber-700 dark:text-amber-300' : i.kind === 'approval' ? 'text-primary' : 'text-destructive'}`}>{i.messages.join('; ')}</td>
                      <td className="max-w-md p-2 font-mono text-xs">
                        {Object.entries(row)
                          .slice(0, 8)
                          .map(([k, v]) => `${k}: ${show(v) || '∅'}`)
                          .join(' · ')}
                        {Object.keys(row).length > 8 && ' …'}
                      </td>
                      <td className="p-2 text-xs">
                        <div>{i.pipelineName}</div>
                        <div className="text-muted-foreground">{i.step}</div>
                      </td>
                      <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">{formatWhen(i.createdAt)}</td>
                      <td className="p-2">
                        {canManage && i.editable && i.kind !== 'flag' && (status === 'open' || status === 'fixed') && (
                          <Button size="sm" variant="outline" onClick={() => setEditing(i)}>
                            Fix
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {total > items.length && <p className="p-3 text-xs text-muted-foreground">Showing the newest {items.length} of {total.toLocaleString()} rows. Filter by pipeline to narrow down.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function FixDialog({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(item.fixedRow ?? item.row).map(([k, v]) => [k, show(v)])))
  const [nulls, setNulls] = useState<Set<string>>(() => new Set(Object.entries(item.fixedRow ?? item.row).filter(([, v]) => v === null || v === undefined).map(([k]) => k)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const original = item.row

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const row: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(values)) {
        const before = original[k]
        // Keep the original type when the text is unchanged (numbers, booleans, objects).
        row[k] = nulls.has(k) && v === '' ? null : show(before) === v ? before : v
      }
      await fixRow({ id: item.id, row })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Fix quarantined row">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border p-4">
          <Wrench className="h-4 w-4 text-primary" />
          <div className="flex-1">
            <div className="font-semibold">Fix row</div>
            <div className="text-xs text-muted-foreground">
              {item.pipelineName} · {item.step}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="space-y-3 overflow-y-auto p-4">
          <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{item.messages.join('; ')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.keys(values).map((k) => (
              <label key={k} className="text-sm">
                <span className="mb-1 block font-mono text-xs text-muted-foreground">{k}</span>
                <Input
                  value={values[k]}
                  placeholder={nulls.has(k) ? 'null' : ''}
                  onChange={(e) => {
                    setValues({ ...values, [k]: e.target.value })
                    if (e.target.value) setNulls((n) => new Set([...n].filter((x) => x !== k)))
                  }}
                  className={show(original[k]) !== values[k] ? 'border-primary' : ''}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Saving marks the row fixed. Replay it from the inbox to run it through the pipeline again from this step.</p>
        </div>
        <footer className="flex items-center gap-2 border-t border-border p-4">
          {error ? <p className="mr-auto text-sm text-destructive">{error}</p> : <span className="mr-auto" />}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save fix
          </Button>
        </footer>
      </div>
    </div>
  )
}
