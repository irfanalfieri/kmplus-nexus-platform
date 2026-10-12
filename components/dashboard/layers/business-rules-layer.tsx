'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, History, Loader2, Plus, Save, Scale, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { deleteRule, listRuleVersions, listRules, saveRule, testRule } from '@/lib/actions/rules'
import { getBuilderOptions, listPipelines } from '@/lib/actions/pipelines'
import { ACTION_INFO, RULE_ACTIONS, ruleBodySchema, type RuleAction, type RuleActionType, type RuleBody } from '@/lib/rules/definition'
import { EXPR_FNS, EXPR_OPS, type ConditionGroup, type Expr } from '@/lib/pipelines/definition'
import { describeRule } from '@/lib/rules/evaluate'
import { ColumnPicker, ConditionsEditor, NativeSelect, newCondition, type Column } from '@/components/pipelines/step-editors'
import { formatWhen } from '@/components/pipelines/run-history'
import { useCan } from '@/components/workspace/workspace-context'
import { AiRuleDraft } from '@/components/ai/ai-rule'

type RuleRow = Awaited<ReturnType<typeof listRules>>[number]
type TestRow = Awaited<ReturnType<typeof testRule>>[number]
type Draft = { id?: string; name: string; description: string; body: RuleBody; changeNote: string }

const blankRule = (): Draft => ({
  name: '',
  description: '',
  changeNote: '',
  body: { when: { match: 'all', conditions: [newCondition('')], groups: [] }, then: [{ type: 'include' }], otherwise: [] },
})

function newAction(type: RuleActionType): RuleAction {
  switch (type) {
    case 'set_field':
      return { type, field: '', value: '' }
    case 'calculate':
      return { type, field: '', expr: { kind: 'op', op: '+', left: { kind: 'field', name: '' }, right: { kind: 'value', value: '0' } } }
    case 'route':
      return { type, branch: '' }
    case 'notify':
      return { type, message: '', emails: [] }
    case 'require_approval':
      return { type, reason: '' }
    case 'trigger_pipeline':
      return { type, pipelineId: '' }
    default:
      return { type }
  }
}

export default function BusinessRulesLayer() {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Draft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [datasets, setDatasets] = useState<{ name: string; columns: Column[] }[]>([])
  const [pipelineList, setPipelineList] = useState<{ id: string; name: string }[]>([])
  const canEdit = useCan('rules:edit')

  const load = useCallback(async () => {
    try {
      const [rows, opts, pipes] = await Promise.all([listRules(), getBuilderOptions(), listPipelines()])
      setRules(rows)
      setDatasets(opts.datasets.map((d) => ({ name: d.name, columns: d.columns })))
      setPipelineList(pipes.map((p) => ({ id: p.id, name: p.name })))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (id: string) => {
    try {
      await deleteRule(id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setConfirmDelete(null)
    }
  }

  return (
    <div className="space-y-6">
      {editing && (
        <RuleEditor
          initial={editing}
          datasets={datasets}
          pipelines={pipelineList}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" />
              <Badge variant="outline">Layer 11</Badge>
            </div>
            <h2 className="text-2xl font-bold">Business Rules</h2>
            <p className="mt-1 max-w-3xl text-muted-foreground">
              Reusable IF/THEN rules: define a condition once and use it in any pipeline&apos;s Filter, Validate, Router or Business rules step. Every save is a new version; pipelines use the latest version from their next run.
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => setEditing(blankRule())} disabled={loading}>
              <Plus className="mr-2 h-4 w-4" /> New rule
            </Button>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card p-10 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading rules…
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Scale className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No business rules yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            For example: IF employment_status equals &quot;Terminated&quot; THEN drop the row, or IF department equals &quot;Finance&quot; THEN notify HR.
          </p>
          {canEdit ? (
            <Button className="mt-4" onClick={() => setEditing(blankRule())}>
              <Plus className="mr-2 h-4 w-4" /> New rule
            </Button>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Admins and data stewards create rules.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rules.map((r) => (
            <div key={r.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.name}</span>
                <Badge variant="outline">v{r.version}</Badge>
                {r.usedBy.length ? <Badge variant="secondary">used by {r.usedBy.length} pipeline{r.usedBy.length === 1 ? '' : 's'}</Badge> : <Badge variant="outline">unused</Badge>}
              </div>
              {r.description && <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>}
              <p className="mt-2 rounded-md bg-muted/40 p-2 font-mono text-xs">{r.body ? describeRule(r.body) : 'Invalid rule body'}</p>
              {r.usedBy.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Pipelines: {r.usedBy.map((p) => p.name).join(', ')}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="mr-auto text-xs text-muted-foreground">updated {formatWhen(r.updatedAt)}</span>
                {r.body && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ id: r.id, name: r.name, description: r.description, body: r.body!, changeNote: '' })}>
                    {canEdit ? 'Edit' : 'View & test'}
                  </Button>
                )}
                {canEdit &&
                  (confirmDelete === r.id ? (
                    <span className="flex items-center gap-1 text-xs">
                      Delete &ldquo;{r.name}&rdquo;?
                      <Button size="sm" variant="destructive" onClick={() => remove(r.id)}>Delete</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r.id)} aria-label={`Delete ${r.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GroupEditor({ group, columns, depth, onChange, onRemove }: { group: ConditionGroup; columns: Column[]; depth: number; onChange: (g: ConditionGroup) => void; onRemove?: () => void }) {
  return (
    <div className={`space-y-2 rounded-md border p-2 ${depth ? 'border-dashed border-primary/40' : 'border-border'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ConditionsEditor
            label={depth ? 'Group: rows matching' : 'IF rows match'}
            match={group.match}
            conditions={group.conditions}
            columns={columns}
            onChange={(match, conditions) => onChange({ ...group, match, conditions })}
          />
        </div>
        {onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label="Remove group">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {group.groups.map((g, i) => (
        <GroupEditor
          key={i}
          group={g}
          columns={columns}
          depth={depth + 1}
          onChange={(next) => onChange({ ...group, groups: group.groups.map((x, j) => (j === i ? next : x)) })}
          onRemove={() => onChange({ ...group, groups: group.groups.filter((_, j) => j !== i) })}
        />
      ))}
      {depth < 2 && (
        <Button size="sm" variant="ghost" onClick={() => onChange({ ...group, groups: [...group.groups, { match: group.match === 'all' ? 'any' : 'all', conditions: [newCondition(columns[0]?.name ?? '')], groups: [] }] })}>
          <Plus className="mr-1 h-4 w-4" /> Nested {group.match === 'all' ? 'OR' : 'AND'} group
        </Button>
      )}
    </div>
  )
}

function ExprEditor({ expr, columns, onChange, depth = 0 }: { expr: Expr; columns: Column[]; onChange: (e: Expr) => void; depth?: number }) {
  const setKind = (kind: string) => {
    if (kind === 'field') onChange({ kind: 'field', name: columns[0]?.name ?? '' })
    else if (kind === 'value') onChange({ kind: 'value', value: '' })
    else if ((EXPR_OPS as readonly string[]).includes(kind)) onChange({ kind: 'op', op: kind as (typeof EXPR_OPS)[number], left: expr.kind === 'op' ? expr.left : expr, right: expr.kind === 'op' ? expr.right : { kind: 'value', value: '' } })
    else onChange({ kind: 'fn', fn: kind as (typeof EXPR_FNS)[number], args: kind === 'today' ? [] : kind === 'days_between' ? [{ kind: 'field', name: columns[0]?.name ?? '' }, { kind: 'fn', fn: 'today', args: [] }] : [expr.kind === 'fn' ? expr.args[0] ?? { kind: 'field', name: '' } : expr] })
  }
  const kindValue = expr.kind === 'op' ? expr.op : expr.kind === 'fn' ? expr.fn : expr.kind
  return (
    <div className={`space-y-1.5 ${depth ? 'border-l-2 border-primary/30 pl-2' : ''}`}>
      <div className="flex gap-1.5">
        <NativeSelect className="w-40" value={kindValue} onChange={setKind} aria-label="Expression part">
          <option value="field">field</option>
          <option value="value">value</option>
          {depth < 3 && (
            <>
              {EXPR_OPS.map((op) => (
                <option key={op} value={op}>
                  {op === 'concat' ? 'join text (&)' : `a ${op} b`}
                </option>
              ))}
              {EXPR_FNS.map((fn) => (
                <option key={fn} value={fn}>
                  {fn}()
                </option>
              ))}
            </>
          )}
        </NativeSelect>
        {expr.kind === 'field' && <ColumnPicker columns={columns} value={expr.name} onChange={(name) => onChange({ kind: 'field', name })} label="Field" />}
        {expr.kind === 'value' && <Input value={expr.value} onChange={(e) => onChange({ kind: 'value', value: e.target.value })} placeholder="value" aria-label="Value" />}
      </div>
      {expr.kind === 'op' && (
        <>
          <ExprEditor expr={expr.left} columns={columns} depth={depth + 1} onChange={(left) => onChange({ ...expr, left })} />
          <ExprEditor expr={expr.right} columns={columns} depth={depth + 1} onChange={(right) => onChange({ ...expr, right })} />
        </>
      )}
      {expr.kind === 'fn' &&
        expr.args.map((a, i) => <ExprEditor key={i} expr={a} columns={columns} depth={depth + 1} onChange={(next) => onChange({ ...expr, args: expr.args.map((x, j) => (j === i ? next : x)) })} />)}
      {expr.kind === 'fn' && (expr.fn === 'coalesce' || expr.fn === 'round') && expr.args.length < (expr.fn === 'round' ? 2 : 5) && (
        <Button size="sm" variant="ghost" onClick={() => onChange({ ...expr, args: [...expr.args, { kind: 'value', value: '' }] })}>
          <Plus className="mr-1 h-4 w-4" /> {expr.fn === 'round' ? 'Decimals' : 'Fallback'}
        </Button>
      )}
    </div>
  )
}

function ActionsEditor({ title, actions, columns, pipelines, onChange }: { title: string; actions: RuleAction[]; columns: Column[]; pipelines: { id: string; name: string }[]; onChange: (a: RuleAction[]) => void }) {
  const update = (i: number, a: RuleAction) => onChange(actions.map((x, j) => (j === i ? a : x)))
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <div className="text-sm font-medium">{title}</div>
      {actions.length === 0 && <p className="text-xs text-muted-foreground">No actions: rows pass through unchanged.</p>}
      {actions.map((a, i) => (
        <div key={i} className="space-y-1.5 rounded-md bg-muted/30 p-2">
          <div className="flex gap-1.5">
            <NativeSelect value={a.type} onChange={(t) => update(i, newAction(t as RuleActionType))} aria-label="Action">
              {RULE_ACTIONS.map((t) => (
                <option key={t} value={t}>
                  {ACTION_INFO[t]}
                </option>
              ))}
            </NativeSelect>
            <Button size="sm" variant="ghost" onClick={() => onChange(actions.filter((_, j) => j !== i))} aria-label="Remove action">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {a.type === 'set_field' && (
            <div className="grid grid-cols-2 gap-1.5">
              <Input value={a.field} onChange={(e) => update(i, { ...a, field: e.target.value })} placeholder="field (new or existing)" aria-label="Field" list="rule-columns" />
              <Input value={a.value} onChange={(e) => update(i, { ...a, value: e.target.value })} placeholder="value, or {first_name} {last_name}" aria-label="Value" />
            </div>
          )}
          {a.type === 'calculate' && (
            <div className="space-y-1.5">
              <Input value={a.field} onChange={(e) => update(i, { ...a, field: e.target.value })} placeholder="result field, e.g. tenure_days" aria-label="Result field" list="rule-columns" />
              <ExprEditor expr={a.expr} columns={columns} onChange={(expr) => update(i, { ...a, expr })} />
            </div>
          )}
          {a.type === 'route' && <Input value={a.branch} onChange={(e) => update(i, { ...a, branch: e.target.value })} placeholder="branch label in the pipeline's Router" aria-label="Branch" />}
          {a.type === 'notify' && (
            <div className="space-y-1.5">
              <Input value={a.message} onChange={(e) => update(i, { ...a, message: e.target.value })} placeholder="Message, e.g. New Finance hires to onboard" aria-label="Message" />
              <Input
                defaultValue={a.emails.join(', ')}
                onBlur={(e) => update(i, { ...a, emails: e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) })}
                placeholder="Emails (empty = workspace admins & stewards)"
                aria-label="Emails"
              />
              <p className="text-xs text-muted-foreground">One notification per run with the number of matching rows.</p>
            </div>
          )}
          {a.type === 'require_approval' && <Input value={a.reason} onChange={(e) => update(i, { ...a, reason: e.target.value })} placeholder="Reason shown to the approver" aria-label="Reason" />}
          {a.type === 'trigger_pipeline' && (
            <NativeSelect value={a.pipelineId} onChange={(v) => update(i, { ...a, pipelineId: v })} aria-label="Pipeline">
              <option value="">Choose a pipeline…</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...actions, newAction('set_field')])} disabled={actions.length >= 10}>
        <Plus className="mr-1 h-4 w-4" /> Action
      </Button>
    </div>
  )
}

function RuleEditor({ initial, datasets, pipelines, onClose, onSaved }: { initial: Draft; datasets: { name: string; columns: Column[] }[]; pipelines: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial)
  const [dataset, setDataset] = useState(datasets[0]?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testRows, setTestRows] = useState<TestRow[] | null>(null)
  const [testSource, setTestSource] = useState<'dataset' | 'json'>(datasets.length ? 'dataset' : 'json')
  const [json, setJson] = useState('[\n  { "employee_code": "E001", "department": "Finance", "employment_status": "Active" }\n]')
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof listRuleVersions>> | null>(null)
  const canEdit = useCan('rules:edit')
  const canPreview = useCan('data:preview')

  const columns = useMemo(() => datasets.find((d) => d.name === dataset)?.columns ?? [], [datasets, dataset])
  const parsed = ruleBodySchema.safeParse(draft.body)
  const problem = parsed.success ? '' : parsed.error.issues[0] ? `${parsed.error.issues[0].path.join('.')}: ${parsed.error.issues[0].message}` : 'Invalid rule'

  const runTest = async () => {
    setError('')
    if (!parsed.success) return setError(problem)
    let rows: Record<string, unknown>[] | undefined
    if (testSource === 'json') {
      try {
        const value: unknown = JSON.parse(json)
        rows = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[]
      } catch {
        return setError('Sample rows must be valid JSON: an object or an array of objects.')
      }
    }
    setTesting(true)
    try {
      setTestRows(await testRule({ name: draft.name || 'Rule', body: parsed.data, rows, datasetName: testSource === 'dataset' ? dataset : undefined }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setError('')
    if (!draft.name.trim()) return setError('Name the rule.')
    if (!parsed.success) return setError(problem)
    setSaving(true)
    try {
      await saveRule({ id: draft.id, name: draft.name, description: draft.description, body: parsed.data, changeNote: draft.changeNote || undefined })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const showVersions = async () => {
    if (!draft.id) return
    try {
      setVersions(await listRuleVersions(draft.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions')
    }
  }

  const show = (v: unknown) => (v === null || v === undefined ? '∅' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Business rule editor">
      <div className="flex w-full max-w-6xl flex-col overflow-hidden border border-border bg-card sm:rounded-xl">
        <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Scale className="h-5 w-5 text-primary" />
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Rule name, e.g. Active employees only" className="w-72 font-medium" aria-label="Rule name" disabled={!canEdit} />
          <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What it's for (optional)" className="min-w-[180px] flex-1" aria-label="Description" disabled={!canEdit} />
          {draft.id && (
            <Button size="sm" variant="outline" onClick={() => void showVersions()}>
              <History className="mr-1 h-4 w-4" /> Versions
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <datalist id="rule-columns">
          {columns.map((c) => (
            <option key={c.name} value={c.name} />
          ))}
        </datalist>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1fr_420px] lg:overflow-hidden">
          <div className="space-y-3 p-3 lg:overflow-y-auto">
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Field names from dataset</span>
              <NativeSelect className="w-56" value={dataset} onChange={setDataset} aria-label="Dataset for field names">
                <option value="">none (type field names)</option>
                {datasets.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {canEdit && <AiRuleDraft dataset={dataset} onDraft={(d) => setDraft({ ...draft, name: draft.name || d.name, description: draft.description || d.description, body: d.body })} />}
            <GroupEditor group={draft.body.when} columns={columns} depth={0} onChange={(when) => setDraft({ ...draft, body: { ...draft.body, when } })} />
            <ActionsEditor title="THEN" actions={draft.body.then} columns={columns} pipelines={pipelines} onChange={(then) => setDraft({ ...draft, body: { ...draft.body, then } })} />
            <ActionsEditor title="OTHERWISE (optional)" actions={draft.body.otherwise} columns={columns} pipelines={pipelines} onChange={(otherwise) => setDraft({ ...draft, body: { ...draft.body, otherwise } })} />
            <p className="rounded-md bg-muted/40 p-2 font-mono text-xs">{parsed.success ? describeRule(parsed.data) : problem}</p>
            <p className="text-xs text-muted-foreground">
              In a Filter, Router or Validate step only the IF part is used (keep / branch / pass). In a Business rules step the THEN and OTHERWISE actions run on each row.
            </p>
          </div>

          <aside className="space-y-3 border-t border-border p-3 lg:overflow-y-auto lg:border-l lg:border-t-0">
            {versions ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Versions</span>
                  <Button size="sm" variant="ghost" onClick={() => setVersions(null)}>Back to test</Button>
                </div>
                {versions.map((v) => {
                  const body = ruleBodySchema.safeParse(v.body)
                  return (
                    <div key={v.version} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">v{v.version}</Badge>
                        <span className="flex-1">{v.changes}</span>
                        <span className="text-muted-foreground">{formatWhen(v.createdAt)}</span>
                      </div>
                      <p className="mt-1 font-mono">{body.success ? describeRule(body.data) : 'invalid'}</p>
                      {canEdit && body.success && (
                        <Button size="sm" variant="ghost" className="mt-1" onClick={() => setDraft({ ...draft, name: v.name, body: body.data, changeNote: `Restored v${v.version}` })}>
                          Load into editor
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 font-medium">
                  <FlaskConical className="h-4 w-4 text-primary" /> Test on sample rows
                </div>
                <div className="flex gap-1.5">
                  <NativeSelect value={testSource} onChange={(v) => setTestSource(v as 'dataset' | 'json')} aria-label="Test rows from">
                    {canPreview && datasets.length > 0 && <option value="dataset">Latest rows of {dataset || 'a dataset'}</option>}
                    <option value="json">Rows I type (JSON)</option>
                  </NativeSelect>
                  <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={testing || (testSource === 'dataset' && !dataset)}>
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                  </Button>
                </div>
                {testSource === 'json' && <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={6} className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs" aria-label="Sample rows JSON" />}
                {testRows && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      {testRows.filter((r) => r.matched).length} of {testRows.length} rows match the IF condition. Nothing was saved or written.
                    </p>
                    {testRows.map((r, i) => (
                      <div key={i} className="rounded-md border border-border p-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={r.matched ? 'default' : 'outline'}>{r.matched ? 'THEN' : 'OTHERWISE'}</Badge>
                          <Badge variant={r.result === 'kept' ? 'secondary' : r.result === 'dropped' ? 'outline' : 'destructive'}>{r.result}</Badge>
                          {r.route && <Badge variant="outline">route: {r.route}</Badge>}
                          {r.detail && <span className="text-muted-foreground">{r.detail}</span>}
                        </div>
                        <div className="mt-1 break-all font-mono text-muted-foreground">
                          {Object.entries(r.output)
                            .slice(0, 12)
                            .map(([k, v]) => {
                              const changed = show(r.input[k]) !== show(v)
                              return (
                                <span key={k} className={changed ? 'font-semibold text-foreground' : ''}>
                                  {k}: {show(v)}
                                  {' · '}
                                </span>
                              )
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border p-3">
          {error ? <p className="mr-auto text-sm text-destructive" role="alert">{error}</p> : <span className="mr-auto" />}
          {canEdit && (
            <>
              <Input value={draft.changeNote} onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })} placeholder="Change note (optional)" className="h-9 w-56" aria-label="Change note" />
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save rule
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
