'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, History, Loader2, Plus, Save, Scale, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { PageHeader } from '@/components/dashboard/page-header'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { deleteRule, listRuleVersions, listRules, saveRule, testRule } from '@/lib/actions/rules'
import { getBuilderOptions, listPipelines } from '@/lib/actions/pipelines'
import { ACTION_INFO, RULE_ACTIONS, ruleBodySchema, type RuleAction, type RuleActionType, type RuleBody } from '@/lib/rules/definition'
import { EXPR_FNS, EXPR_OPS, type ConditionGroup, type Expr } from '@/lib/pipelines/definition'
import { describeRule } from '@/lib/rules/evaluate'
import { ColumnPicker, ConditionsEditor, NativeSelect, newCondition, type Column } from '@/components/pipelines/step-editors'
import { useCan } from '@/components/workspace/workspace-context'
import { AiRuleDraft } from '@/components/ai/ai-rule'
import { localizeCheck } from '@/lib/pipelines/check-messages'

/** "13 Oct, 09:05:12 WIB" in the interface language. */
function useWhen() {
  const { formatDateTime } = usePrefs()
  return (value: Date | string | null | undefined) =>
    value ? `${formatDateTime(value, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', dateStyle: undefined, timeStyle: undefined })} WIB` : '—'
}

const RESULT_KEYS = { kept: 'kept', dropped: 'dropped', quarantined: 'quarantined', 'held for approval': 'held' } as const

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
  const { t } = usePrefs()
  const formatWhen = useWhen()
  const [rules, setRules] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Draft | null>(null)
  const [datasets, setDatasets] = useState<{ name: string; columns: Column[] }[]>([])
  const [pipelineList, setPipelineList] = useState<{ id: string; name: string }[]>([])
  const [confirm, confirmEl] = useConfirm()
  const toast = useToast()
  const canEdit = useCan('rules:edit')

  const load = useCallback(async () => {
    try {
      const [rows, opts, pipes] = await Promise.all([listRules(), getBuilderOptions(), listPipelines()])
      setRules(rows)
      setDatasets(opts.datasets.map((d) => ({ name: d.name, columns: d.columns })))
      setPipelineList(pipes.map((p) => ({ id: p.id, name: p.name })))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.rules.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (rule: RuleRow) => {
    const ok = await confirm({
      title: t('ops.rules.deleteTitle', { name: rule.name }),
      description: rule.usedBy.length ? t('ops.rules.deleteUsedBy', { count: rule.usedBy.length, names: rule.usedBy.map((p) => p.name).join(', ') }) : t('ops.rules.deleteUnused'),
      confirmLabel: t('ops.rules.deleteConfirm'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteRule(rule.id)
      toast({ message: t('ops.rules.deleted', { name: rule.name }) })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.rules.deleteFailed'))
    }
  }

  return (
    <div className="space-y-5">
      {confirmEl}
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

      <PageHeader
        title={t('pages.rules.title')}
        description={t('pages.rules.description')}
        actions={
          canEdit && (
            <Button onClick={() => setEditing(blankRule())} disabled={loading}>
              <Plus aria-hidden /> {t('ops.rules.newRule')}
            </Button>
          )
        }
      />

      <p className="max-w-3xl text-sm text-muted-foreground">
        {t('ops.rules.intro')}
      </p>

      {error && <Notice tone="danger">{error}</Notice>}

      {loading ? (
        <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-sm text-muted-foreground" role="status">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> {t('ops.rules.loading')}
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={<Scale />}
            title={t('ops.rules.emptyTitle')}
            action={
              canEdit && (
                <Button onClick={() => setEditing(blankRule())}>
                  <Plus aria-hidden /> {t('ops.rules.newRule')}
                </Button>
              )
            }
          >
            {t('ops.rules.emptyBody')}
            {!canEdit && <span className="mt-2 block text-xs">{t('ops.rules.emptyReadOnly')}</span>}
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-col rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{r.name}</h2>
                <Badge variant="outline" className="font-mono">
                  v{r.version}
                </Badge>
                {r.usedBy.length ? <Badge variant="secondary">{t('ops.rules.usedBy', { count: r.usedBy.length })}</Badge> : <Badge variant="outline">{t('ops.rules.unused')}</Badge>}
              </div>
              {r.description && <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>}
              <p className="mt-2 rounded-md bg-muted p-2 font-mono text-xs">{r.body ? describeRule(r.body) : t('ops.rules.invalidBody')}</p>
              {r.usedBy.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{t('ops.rules.pipelinesList', { names: r.usedBy.map((p) => p.name).join(', ') })}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="mr-auto font-mono text-xs text-muted-foreground">{t('ops.rules.updated', { when: formatWhen(r.updatedAt) })}</span>
                {r.body && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ id: r.id, name: r.name, description: r.description, body: r.body!, changeNote: '' })}>
                    {canEdit ? t('common.edit') : t('ops.rules.viewTest')}
                  </Button>
                )}
                {canEdit && (
                  <Button size="icon-sm" variant="ghost" onClick={() => void remove(r)} aria-label={t('ops.rules.deleteNamed', { name: r.name })} title={t('common.delete')}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GroupEditor({ group, columns, depth, onChange, onRemove }: { group: ConditionGroup; columns: Column[]; depth: number; onChange: (g: ConditionGroup) => void; onRemove?: () => void }) {
  const { t } = usePrefs()
  return (
    <div className={`space-y-2 rounded-md border p-2 ${depth ? 'border-dashed border-primary/40' : 'border-border'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ConditionsEditor
            label={depth ? t('ops.rules.group.nested') : t('ops.rules.group.root')}
            match={group.match}
            conditions={group.conditions}
            columns={columns}
            onChange={(match, conditions) => onChange({ ...group, match, conditions })}
          />
        </div>
        {onRemove && (
          <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label={t('ops.rules.group.remove')}>
            <X aria-hidden />
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
          <Plus aria-hidden /> {group.match === 'all' ? t('ops.rules.group.nestedOr') : t('ops.rules.group.nestedAnd')}
        </Button>
      )}
    </div>
  )
}

function ExprEditor({ expr, columns, onChange, depth = 0 }: { expr: Expr; columns: Column[]; onChange: (e: Expr) => void; depth?: number }) {
  const { t } = usePrefs()
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
        <NativeSelect className="w-40" value={kindValue} onChange={setKind} aria-label={t('ops.rules.expr.part')}>
          <option value="field">{t('ops.rules.expr.field')}</option>
          <option value="value">{t('ops.rules.expr.value')}</option>
          {depth < 3 && (
            <>
              {EXPR_OPS.map((op) => (
                <option key={op} value={op}>
                  {op === 'concat' ? t('ops.rules.expr.concat') : t('ops.rules.expr.op', { op })}
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
        {expr.kind === 'field' && <ColumnPicker columns={columns} value={expr.name} onChange={(name) => onChange({ kind: 'field', name })} label={t('ops.rules.expr.fieldLabel')} />}
        {expr.kind === 'value' && <Input value={expr.value} onChange={(e) => onChange({ kind: 'value', value: e.target.value })} placeholder={t('ops.rules.expr.valuePlaceholder')} aria-label={t('ops.rules.expr.valueLabel')} />}
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
          <Plus aria-hidden /> {expr.fn === 'round' ? t('ops.rules.expr.decimals') : t('ops.rules.expr.fallback')}
        </Button>
      )}
    </div>
  )
}

function ActionsEditor({ title, actions, columns, pipelines, onChange }: { title: string; actions: RuleAction[]; columns: Column[]; pipelines: { id: string; name: string }[]; onChange: (a: RuleAction[]) => void }) {
  const { t } = usePrefs()
  const update = (i: number, a: RuleAction) => onChange(actions.map((x, j) => (j === i ? a : x)))
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {actions.length === 0 && <p className="text-xs text-muted-foreground">{t('ops.rules.actions.none')}</p>}
      {actions.map((a, i) => (
        <div key={i} className="space-y-1.5 rounded-md bg-muted/50 p-2">
          <div className="flex gap-1.5">
            <NativeSelect value={a.type} onChange={(type) => update(i, newAction(type as RuleActionType))} aria-label={t('ops.rules.actions.action')}>
              {RULE_ACTIONS.map((type) => (
                <option key={type} value={type}>
                  {t(`ops.rules.actions.types.${type}`) || ACTION_INFO[type]}
                </option>
              ))}
            </NativeSelect>
            <Button size="icon-sm" variant="ghost" onClick={() => onChange(actions.filter((_, j) => j !== i))} aria-label={t('ops.rules.actions.remove')}>
              <X aria-hidden />
            </Button>
          </div>
          {a.type === 'set_field' && (
            <div className="grid grid-cols-2 gap-1.5">
              <Input value={a.field} onChange={(e) => update(i, { ...a, field: e.target.value })} placeholder={t('ops.rules.actions.fieldPlaceholder')} aria-label={t('ops.rules.actions.fieldLabel')} list="rule-columns" />
              <Input value={a.value} onChange={(e) => update(i, { ...a, value: e.target.value })} placeholder={t('ops.rules.actions.valuePlaceholder')} aria-label={t('ops.rules.actions.valueLabel')} />
            </div>
          )}
          {a.type === 'calculate' && (
            <div className="space-y-1.5">
              <Input value={a.field} onChange={(e) => update(i, { ...a, field: e.target.value })} placeholder={t('ops.rules.actions.resultFieldPlaceholder')} aria-label={t('ops.rules.actions.resultFieldLabel')} list="rule-columns" />
              <ExprEditor expr={a.expr} columns={columns} onChange={(expr) => update(i, { ...a, expr })} />
            </div>
          )}
          {a.type === 'route' && <Input value={a.branch} onChange={(e) => update(i, { ...a, branch: e.target.value })} placeholder={t('ops.rules.actions.branchPlaceholder')} aria-label={t('ops.rules.actions.branchLabel')} />}
          {a.type === 'notify' && (
            <div className="space-y-1.5">
              <Input value={a.message} onChange={(e) => update(i, { ...a, message: e.target.value })} placeholder={t('ops.rules.actions.messagePlaceholder')} aria-label={t('ops.rules.actions.messageLabel')} />
              <Input
                defaultValue={a.emails.join(', ')}
                onBlur={(e) => update(i, { ...a, emails: e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) })}
                placeholder={t('ops.rules.actions.emailsPlaceholder')}
                aria-label={t('ops.rules.actions.emailsLabel')}
              />
              <p className="text-xs text-muted-foreground">{t('ops.rules.actions.notifyHelp')}</p>
            </div>
          )}
          {a.type === 'require_approval' && <Input value={a.reason} onChange={(e) => update(i, { ...a, reason: e.target.value })} placeholder={t('ops.rules.actions.reasonPlaceholder')} aria-label={t('ops.rules.actions.reasonLabel')} />}
          {a.type === 'trigger_pipeline' && (
            <NativeSelect value={a.pipelineId} onChange={(v) => update(i, { ...a, pipelineId: v })} aria-label={t('ops.rules.actions.pipelineLabel')}>
              <option value="">{t('ops.rules.actions.choosePipeline')}</option>
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
        <Plus aria-hidden /> {t('ops.rules.actions.add')}
      </Button>
    </div>
  )
}

function RuleEditor({ initial, datasets, pipelines, onClose, onSaved }: { initial: Draft; datasets: { name: string; columns: Column[] }[]; pipelines: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = usePrefs()
  const formatWhen = useWhen()
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
  const problem = parsed.success ? '' : parsed.error.issues[0] ? `${parsed.error.issues[0].path.join('.')}: ${parsed.error.issues[0].message}` : t('ops.rules.editor.invalid')

  const runTest = async () => {
    setError('')
    if (!parsed.success) return setError(problem)
    let rows: Record<string, unknown>[] | undefined
    if (testSource === 'json') {
      try {
        const value: unknown = JSON.parse(json)
        rows = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[]
      } catch {
        return setError(t('ops.rules.editor.jsonInvalid'))
      }
    }
    setTesting(true)
    try {
      setTestRows(await testRule({ name: draft.name || 'Rule', body: parsed.data, rows, datasetName: testSource === 'dataset' ? dataset : undefined }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.rules.editor.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setError('')
    if (!draft.name.trim()) return setError(t('ops.rules.editor.nameRequired'))
    if (!parsed.success) return setError(problem)
    setSaving(true)
    try {
      await saveRule({ id: draft.id, name: draft.name, description: draft.description, body: parsed.data, changeNote: draft.changeNote || undefined })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.rules.editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const showVersions = async () => {
    if (!draft.id) return
    try {
      setVersions(await listRuleVersions(draft.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.rules.editor.versionsFailed'))
    }
  }

  const show = (v: unknown) => (v === null || v === undefined ? '∅' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))

  const dirty = canEdit && JSON.stringify(draft) !== JSON.stringify(initial)

  return (
    <Modal
      onClose={onClose}
      dirty={dirty}
      size="full"
      title={draft.id ? (canEdit ? t('ops.rules.editor.titleEdit') : t('ops.rules.editor.titleView')) : t('ops.rules.editor.titleNew')}
      description={draft.id ? initial.name : undefined}
      headerActions={
        draft.id && (
          <Button size="sm" variant="outline" onClick={() => void showVersions()}>
            <History aria-hidden /> {t('ops.rules.editor.versions')}
          </Button>
        )
      }
      bodyClassName="p-0 lg:overflow-hidden"
      footer={
        <>
          {error && (
            <Notice tone="danger" className="mr-auto py-1.5">
              {error}
            </Notice>
          )}
          {canEdit && (
            <>
              <Label htmlFor="rule-change-note" className="sr-only">
                {t('ops.rules.editor.changeNote')}
              </Label>
              <Input id="rule-change-note" value={draft.changeNote} onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })} placeholder={t('ops.rules.editor.changeNotePlaceholder')} className="w-56" />
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                {t('ops.rules.editor.save')}
              </Button>
            </>
          )}
        </>
      }
    >
      <datalist id="rule-columns">
        {columns.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>

      <div className="grid lg:h-full lg:grid-cols-[1fr_420px]">
        <div className="space-y-3 p-4 lg:overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">{t('ops.rules.editor.name')}</Label>
              <Input id="rule-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('ops.rules.editor.namePlaceholder')} className="font-medium" disabled={!canEdit} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-description">{t('ops.rules.editor.description')}</Label>
              <Input id="rule-description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder={t('ops.rules.editor.descriptionPlaceholder')} disabled={!canEdit} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground" id="rule-dataset-label">
              {t('ops.rules.editor.datasetLabel')}
            </span>
            <NativeSelect className="w-56" value={dataset} onChange={setDataset} aria-labelledby="rule-dataset-label">
              <option value="">{t('ops.rules.editor.noDataset')}</option>
              {datasets.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {canEdit && <AiRuleDraft dataset={dataset} onDraft={(d) => setDraft({ ...draft, name: draft.name || d.name, description: draft.description || d.description, body: d.body })} />}
          <GroupEditor group={draft.body.when} columns={columns} depth={0} onChange={(when) => setDraft({ ...draft, body: { ...draft.body, when } })} />
          <ActionsEditor title={t('ops.rules.actions.then')} actions={draft.body.then} columns={columns} pipelines={pipelines} onChange={(then) => setDraft({ ...draft, body: { ...draft.body, then } })} />
          <ActionsEditor title={t('ops.rules.actions.otherwise')} actions={draft.body.otherwise} columns={columns} pipelines={pipelines} onChange={(otherwise) => setDraft({ ...draft, body: { ...draft.body, otherwise } })} />
          <p className={parsed.success ? 'rounded-md bg-muted p-2 font-mono text-xs' : 'rounded-md border border-danger/40 bg-danger-soft p-2 font-mono text-xs text-danger-text'}>{parsed.success ? describeRule(parsed.data) : problem}</p>
          <p className="text-xs text-muted-foreground">
            {t('ops.rules.editor.scopeHelp')}
          </p>
        </div>

        <aside className="space-y-3 border-t border-border p-4 lg:overflow-y-auto lg:border-t-0 lg:border-l" aria-label={versions ? t('ops.rules.editor.versions') : t('ops.rules.editor.testTitle')}>
          {versions ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{t('ops.rules.editor.versions')}</h3>
                <Button size="sm" variant="ghost" onClick={() => setVersions(null)}>
                  {t('ops.rules.editor.backToTest')}
                </Button>
              </div>
              {versions.map((v) => {
                const body = ruleBodySchema.safeParse(v.body)
                return (
                  <div key={v.version} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        v{v.version}
                      </Badge>
                      <span className="flex-1">{v.changes}</span>
                      <span className="font-mono text-muted-foreground">{formatWhen(v.createdAt)}</span>
                    </div>
                    <p className="mt-1 font-mono">{body.success ? describeRule(body.data) : t('ops.rules.editor.invalidVersion')}</p>
                    {canEdit && body.success && (
                      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setDraft({ ...draft, name: v.name, body: body.data, changeNote: t('ops.rules.editor.restored', { version: v.version }) })}>
                        {t('ops.rules.editor.loadIntoEditor')}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <>
              <h3 className="flex items-center gap-2 font-medium">
                <FlaskConical className="size-4 text-primary" aria-hidden /> {t('ops.rules.editor.testTitle')}
              </h3>
              <div className="flex gap-1.5">
                <NativeSelect value={testSource} onChange={(v) => setTestSource(v as 'dataset' | 'json')} aria-label={t('ops.rules.editor.testFrom')}>
                  {canPreview && datasets.length > 0 && <option value="dataset">{t('ops.rules.editor.latestRows', { dataset: dataset || t('ops.rules.editor.aDataset') })}</option>}
                  <option value="json">{t('ops.rules.editor.jsonRows')}</option>
                </NativeSelect>
                <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={testing || (testSource === 'dataset' && !dataset)}>
                  {testing ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden />
                      <span className="sr-only">{t('ops.rules.editor.testing')}</span>
                    </>
                  ) : (
                    t('ops.rules.editor.test')
                  )}
                </Button>
              </div>
              {testSource === 'json' && (
                <textarea
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-input bg-card p-2 font-mono text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={t('ops.rules.editor.sampleJson')}
                />
              )}
              {testRows && (
                <div className="space-y-1.5" role="status">
                  <p className="text-xs text-muted-foreground">
                    {t('ops.rules.editor.testSummary', { matched: testRows.filter((r) => r.matched).length, count: testRows.length })}
                  </p>
                  {testRows.map((r, i) => (
                    <div key={i} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={r.matched ? 'default' : 'outline'}>{r.matched ? t('ops.rules.editor.branchThen') : t('ops.rules.editor.branchOtherwise')}</Badge>
                        <Badge variant={r.result === 'kept' ? 'secondary' : r.result === 'dropped' ? 'outline' : 'destructive'}>{r.result in RESULT_KEYS ? t(`ops.rules.editor.results.${RESULT_KEYS[r.result as keyof typeof RESULT_KEYS]}`) : r.result}</Badge>
                        {r.route && <Badge variant="outline">{t('ops.rules.editor.route', { route: r.route })}</Badge>}
                        {r.detail && <span className="text-muted-foreground">{localizeCheck(r.detail, locale)}</span>}
                      </div>
                      <div className="mt-1 font-mono break-all text-muted-foreground">
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
    </Modal>
  )
}
