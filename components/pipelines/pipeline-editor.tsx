'use client'

import { useCallback, useId, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BellRing, Database, Filter, FlaskConical, GitBranch, Link2, Loader2, OctagonAlert, Rocket, Save, Scale, ShieldCheck, Shuffle, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { THead, TBody, Tr, Th, Td } from '@/components/ui/data-table'
import { Breaker } from '@/components/ui/flow-line'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SCHEDULE,
  DEFAULT_SETTINGS,
  OTHERWISE,
  definitionSchema,
  describeDefinitionError,
  newStepId,
  scheduleSchema,
  stepTitle,
  topoOrder,
  type NodeType,
  type PipelineEdge,
  type PipelineNode,
  type PipelineSchedule,
  type PipelineSettings,
} from '@/lib/pipelines/definition'
import { describeSchedule, formatInTimezone, nextRunTimes } from '@/lib/pipelines/schedule'
import { AFTER_OUTCOMES } from '@/lib/pipelines/definition'
import type { EngineResult, StepStat } from '@/lib/pipelines/engine'
import { createWebhookTrigger, disableWebhookTrigger, savePipeline, testPipeline } from '@/lib/actions/pipelines'
import {
  DestinationEditor,
  FilterEditor,
  MapEditor,
  NativeSelect,
  RouterEditor,
  RulesEditor,
  SourceEditor,
  ValidateEditor,
  newCondition,
  newValidationRule,
  type BuilderOptions,
  type Column,
} from './step-editors'

export interface EditablePipeline {
  id?: string
  name: string
  description: string
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  schedule: PipelineSchedule
  settings: PipelineSettings
  enabled: boolean
  /** Incremental sync position of the saved pipeline (display only). */
  syncPosition?: string | null
  /** Published version (0 = never published) and the unpublished draft, if any. */
  publishedVersion?: number
  draftVersion?: number | null
  /** An inbound webhook trigger URL exists (its token is only shown when created). */
  webhookTrigger?: boolean
  /** Notes from the template that built this pipeline. */
  notes?: string[]
}

export function blankPipeline(): EditablePipeline {
  const source: PipelineNode = { id: newStepId(), type: 'source', position: { x: 40, y: 120 }, dataSourceId: '', table: '', maxRows: 10000, mode: 'full', watermarkColumn: '' }
  const dest: PipelineNode = { id: newStepId(), type: 'destination', position: { x: 560, y: 120 }, kind: 'dataset', datasetName: '', mode: 'replace', keys: [], softDeleteMissing: false }
  return {
    name: '',
    description: '',
    enabled: false,
    schedule: DEFAULT_SCHEDULE,
    settings: DEFAULT_SETTINGS,
    nodes: [source, dest],
    edges: [{ id: newStepId(), from: source.id, to: dest.id, branch: '' }],
  }
}

const META: Record<NodeType, { title: string; icon: typeof Database; hint: string }> = {
  source: { title: 'Source', icon: Database, hint: 'Where rows come from' },
  filter: { title: 'Filter', icon: Filter, hint: 'Keep only matching rows' },
  map: { title: 'Map & transform', icon: Shuffle, hint: 'Rename, convert and clean fields' },
  validate: { title: 'Validate', icon: ShieldCheck, hint: 'Quarantine or flag rows that break rules' },
  rules: { title: 'Business rules', icon: Scale, hint: 'Apply IF/THEN rules' },
  router: { title: 'Router', icon: GitBranch, hint: 'Send rows down branches' },
  destination: { title: 'Destination', icon: Upload, hint: 'Where results are written' },
}
const ADDABLE: Exclude<NodeType, 'source'>[] = ['filter', 'map', 'validate', 'rules', 'router', 'destination']

/** Node frame and icon colour by kind: sources in, destinations out, transforms neutral. */
const KIND_BORDER: Record<NodeType, string> = {
  source: 'border-info',
  filter: 'border-border',
  map: 'border-border',
  validate: 'border-border',
  rules: 'border-border',
  router: 'border-border',
  destination: 'border-live',
}
const KIND_ICON: Record<NodeType, string> = {
  source: 'text-info',
  filter: 'text-muted-foreground',
  map: 'text-muted-foreground',
  validate: 'text-muted-foreground',
  rules: 'text-muted-foreground',
  router: 'text-muted-foreground',
  destination: 'text-live',
}

/** React Flow's own colours, mapped to the board's tokens so both themes follow. */
const CANVAS_STYLE = {
  minHeight: 360,
  '--xy-edge-stroke': 'var(--muted-foreground)',
  '--xy-edge-stroke-selected': 'var(--live)',
  '--xy-connectionline-stroke': 'var(--live)',
  '--xy-edge-label-background-color': 'var(--card)',
  '--xy-edge-label-color': 'var(--foreground)',
  '--xy-background-color': 'var(--background)',
  '--xy-background-pattern-color': 'var(--border)',
  '--xy-controls-button-background-color': 'var(--card)',
  '--xy-controls-button-background-color-hover': 'var(--muted)',
  '--xy-controls-button-color': 'var(--foreground)',
  '--xy-controls-button-color-hover': 'var(--foreground)',
  '--xy-controls-button-border-color': 'var(--border)',
  '--xy-controls-box-shadow': 'none',
  '--xy-minimap-background-color': 'var(--card)',
  '--xy-minimap-node-background-color': 'var(--muted)',
  '--xy-minimap-node-stroke-color': 'var(--border)',
  '--xy-minimap-mask-background-color': 'color-mix(in srgb, var(--background) 60%, transparent)',
} as React.CSSProperties

function newNode(type: Exclude<NodeType, 'source'>, columns: Column[], position: { x: number; y: number }): PipelineNode {
  const first = columns[0]?.name ?? ''
  const id = newStepId()
  switch (type) {
    case 'filter':
      return { id, type, position, match: 'all', conditions: [newCondition(first)], ruleId: '' }
    case 'map':
      return { id, type, position, keepUnmapped: false, fields: [{ from: first, to: first.toLowerCase(), type: 'text', transforms: [] }] }
    case 'validate':
      return { id, type, position, onFail: 'reject', rules: [newValidationRule(first)] }
    case 'rules':
      return { id, type, position, ruleIds: [] }
    case 'router':
      return { id, type, position, branches: [{ id: newStepId(), label: 'Branch 1', ruleId: '', condition: { match: 'all', conditions: [newCondition(first)], groups: [] } }] }
    case 'destination':
      return { id, type, position, kind: 'dataset', datasetName: '', mode: 'replace', keys: [], softDeleteMissing: false }
  }
}

/** Columns flowing into each node: the union of what its inputs output. */
function columnsPerNode(nodes: PipelineNode[], edges: PipelineEdge[], options: BuilderOptions): Map<string, Column[]> {
  const order = topoOrder(nodes, edges) ?? nodes
  const output = new Map<string, Column[]>()
  const input = new Map<string, Column[]>()
  for (const node of order) {
    const merged = new Map<string, Column>()
    for (const e of edges) if (e.to === node.id) for (const c of output.get(e.from) ?? []) if (!merged.has(c.name)) merged.set(c.name, c)
    const cols = [...merged.values()]
    input.set(node.id, cols)
    if (node.type === 'source') {
      const src = options.dataSources.find((d) => d.id === node.dataSourceId)
      output.set(node.id, src?.tables.find((t) => t.name === node.table)?.columns ?? [])
    } else if (node.type === 'map') {
      const mapped = node.fields.filter((f) => f.to).map((f) => ({ name: f.to, type: f.type }))
      const used = new Set(node.fields.map((f) => f.from))
      output.set(node.id, node.keepUnmapped ? [...mapped, ...cols.filter((c) => !used.has(c.name) && !mapped.some((m) => m.name === c.name))] : mapped)
    } else if (node.type === 'rules') {
      const added = new Map(cols.map((c) => [c.name, c]))
      for (const id of node.ruleIds) {
        for (const field of options.rules.find((r) => r.id === id)?.outputs ?? []) if (!added.has(field)) added.set(field, { name: field, type: 'text' })
      }
      output.set(node.id, [...added.values()])
    } else output.set(node.id, cols)
  }
  return input
}

/** `held`: the last test held rows at this node for approval (and quarantined none). */
type NodeData = { node: PipelineNode; stat?: StepStat; held: boolean; invalid: boolean }

function NexusNode({ data, selected }: NodeProps<FlowNode<NodeData>>) {
  const { node, stat, held } = data
  const meta = META[node.type]
  const Icon = meta.icon
  const handles = node.type === 'router' ? [...node.branches.map((b) => ({ id: b.id, label: b.label })), { id: OTHERWISE, label: 'otherwise' }] : node.type === 'destination' ? [] : [{ id: '', label: '' }]
  // The last test's outcome overrides the kind colour: failed or quarantined → danger, held for approval → held.
  const border = stat?.error ? 'border-danger' : stat && stat.rejected > 0 ? (held ? 'border-held' : 'border-danger') : KIND_BORDER[node.type]
  return (
    <div className={cn('w-52 rounded-md border-2 bg-card text-card-foreground', border, selected && 'outline-2 outline-offset-2 outline-ring')}>
      {node.type !== 'source' && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-card !bg-muted-foreground" />}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon className={cn('size-4 shrink-0', KIND_ICON[node.type])} aria-hidden />
        <span className="truncate text-sm font-medium">{meta.title}</span>
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground">
        <div className="truncate" title={stepTitle(node)}>
          {stepTitle(node)}
        </div>
        {stat && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px]">
            {stat.error ? (
              <span className="inline-flex items-center gap-1.5 font-sans font-medium text-danger-text">
                <Breaker state="tripped" className="size-2" /> failed
              </span>
            ) : (
              <>
                <span className="text-foreground">{stat.rowsOut} out</span>
                {stat.rejected > 0 && (
                  <span className={cn('inline-flex items-center gap-1.5', held ? 'text-held-text' : 'text-danger-text')}>
                    <Breaker state={held ? 'held' : 'tripped'} className="size-2" />
                    {stat.rejected} held
                  </span>
                )}
                {!!stat.flagged && <span className="text-warning-text">{stat.flagged} flagged</span>}
              </>
            )}
          </div>
        )}
      </div>
      {handles.length === 1 && !handles[0].id ? (
        <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-card !bg-primary" />
      ) : (
        handles.map((h, i) => (
          <div key={h.id} className="relative border-t border-border px-3 py-1 text-right text-[11px] text-muted-foreground">
            {h.label}
            <Handle id={h.id} type="source" position={Position.Right} style={{ top: '50%' }} className={cn('!h-3 !w-3 !border-2 !border-card', i === handles.length - 1 ? '!bg-muted-foreground' : '!bg-primary')} />
          </div>
        ))
      )}
    </div>
  )
}
const nodeTypes = { nexus: NexusNode }

/** What "saved" means for the unsaved-changes prompt: definition, name, description and schedule. */
const snapshotOf = (p: EditablePipeline) => JSON.stringify({ name: p.name, description: p.description, nodes: p.nodes, edges: p.edges, settings: p.settings, schedule: p.schedule, enabled: p.enabled })

export default function PipelineEditor({ initial, options, onClose, onSaved }: { initial: EditablePipeline; options: BuilderOptions; onClose: () => void; onSaved: (id: string, result: { version: number; published: boolean; approvalId: string | null }) => void }) {
  const [draft, setDraft] = useState<EditablePipeline>(initial)
  const [selectedId, setSelectedId] = useState<string | null>(initial.nodes[0]?.id ?? null)
  const [tab, setTab] = useState<'settings' | 'schedule' | 'test'>('test')
  const [saving, setSaving] = useState<null | 'draft' | 'publish'>(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [test, setTest] = useState<EngineResult | null>(null)
  const [notes, setNotes] = useState(initial.notes ?? [])
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotOf(initial))
  const [confirm, confirmDialog] = useConfirm()
  const { theme } = usePrefs()
  const nameId = useId()
  const descriptionId = useId()
  const changeNoteId = useId()

  // A pipeline built from a template has never been saved, so it counts as unsaved work too.
  const dirty = snapshotOf(draft) !== savedSnapshot || (!draft.id && Boolean(initial.name))

  const definition = { nodes: draft.nodes, edges: draft.edges, settings: draft.settings }
  const columns = useMemo(() => columnsPerNode(draft.nodes, draft.edges, options), [draft.nodes, draft.edges, options])
  const validation = useMemo(() => definitionSchema.safeParse({ schemaVersion: 2, ...definition }), [draft.nodes, draft.edges, draft.settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const scheduleCheck = useMemo(() => scheduleSchema.safeParse(draft.schedule), [draft.schedule])
  const upcoming = useMemo(() => (scheduleCheck.success ? nextRunTimes(scheduleCheck.data, 3) : []), [scheduleCheck])
  const selected = draft.nodes.find((n) => n.id === selectedId) ?? null
  const statFor = useCallback((id: string) => test?.steps.find((s) => s.id === id), [test])
  const heldAt = useCallback(
    (id: string) => {
      const kinds = new Set((test?.rejects ?? []).filter((r) => r.stepId === id).map((r) => r.kind ?? 'invalid'))
      return kinds.has('approval') && !kinds.has('invalid')
    },
    [test],
  )

  const flowNodes: FlowNode<NodeData>[] = draft.nodes.map((n) => ({ id: n.id, type: 'nexus', position: n.position, selected: n.id === selectedId, deletable: n.type !== 'source', data: { node: n, stat: statFor(n.id), held: heldAt(n.id), invalid: false } }))
  const flowEdges: FlowEdge[] = draft.edges.map((e) => {
    const from = draft.nodes.find((n) => n.id === e.from)
    const label = from?.type === 'router' ? (e.branch === OTHERWISE ? 'otherwise' : from.branches.find((b) => b.id === e.branch)?.label) : undefined
    return { id: e.id, source: e.from, target: e.to, sourceHandle: e.branch || null, label, animated: testing }
  })

  const setNode = (node: PipelineNode) => setDraft((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === node.id ? node : n)) }))
  const removeNode = (id: string) => {
    setDraft((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== id), edges: d.edges.filter((e) => e.from !== id && e.to !== id) }))
    setSelectedId(null)
  }
  const confirmRemove = (nodes: PipelineNode[]) =>
    confirm({
      title: nodes.length === 1 ? `Delete the ${META[nodes[0].type].title.toLowerCase()} step?` : `Delete ${nodes.length} steps?`,
      description: 'Its settings and connections are removed from this draft. Nothing changes for running pipelines until you save.',
      confirmLabel: nodes.length === 1 ? 'Delete step' : 'Delete steps',
      tone: 'danger',
    })
  const connect = (from: string, to: string, branch = '') =>
    setDraft((d) => {
      if (from === to || d.edges.some((e) => e.from === from && e.to === to && e.branch === branch)) return d
      return { ...d, edges: [...d.edges, { id: newStepId(), from, to, branch }] }
    })

  const onNodesChange = (changes: NodeChange<FlowNode<NodeData>>[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        const pos = c.position
        setDraft((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === c.id ? { ...n, position: { x: Math.round(pos.x), y: Math.round(pos.y) } } : n)) }))
      } else if (c.type === 'select' && c.selected) setSelectedId(c.id)
      else if (c.type === 'remove') {
        const n = draft.nodes.find((x) => x.id === c.id)
        if (n && n.type !== 'source') removeNode(c.id)
      }
    }
  }
  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
    if (removed.size) setDraft((d) => ({ ...d, edges: d.edges.filter((e) => !removed.has(e.id)) }))
  }
  const onConnect = (c: Connection) => c.source && c.target && connect(c.source, c.target, c.sourceHandle ?? '')

  const addNode = (type: Exclude<NodeType, 'source'>) => {
    const anchor = selected ?? draft.nodes[0]
    const position = { x: (anchor?.position.x ?? 0) + 260, y: (anchor?.position.y ?? 0) + (draft.nodes.filter((n) => Math.abs(n.position.x - ((anchor?.position.x ?? 0) + 260)) < 40).length * 140) }
    const node = newNode(type, anchor ? columns.get(anchor.id) ?? [] : [], position)
    setDraft((d) => {
      let edges = d.edges
      if (anchor && anchor.type !== 'destination') {
        let branch = ''
        if (anchor.type === 'router') branch = anchor.branches.find((b) => !d.edges.some((e) => e.from === anchor.id && e.branch === b.id))?.id ?? OTHERWISE
        // Inserting before the anchor's single next step keeps the chain: anchor → new → next.
        const outgoing = d.edges.filter((e) => e.from === anchor.id && e.branch === branch)
        if (anchor.type !== 'router' && outgoing.length === 1 && type !== 'destination') {
          edges = [...d.edges.filter((e) => e !== outgoing[0]), { id: newStepId(), from: anchor.id, to: node.id, branch }, { id: newStepId(), from: node.id, to: outgoing[0].to, branch: '' }]
        } else edges = [...d.edges, { id: newStepId(), from: anchor.id, to: node.id, branch }]
      }
      return { ...d, nodes: [...d.nodes, node], edges }
    })
    setSelectedId(node.id)
  }

  const setSchedule = (patch: Partial<PipelineSchedule>) => setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }))

  const runTest = async () => {
    setError('')
    if (!validation.success) return setError(describeDefinitionError(validation.error))
    setTesting(true)
    setTest(null)
    setTab('test')
    try {
      const res = await testPipeline(definition, draft.id)
      if (!res.ok) setError(res.message)
      else setTest(res.result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test run failed')
    } finally {
      setTesting(false)
    }
  }

  const save = async (publish: boolean) => {
    setError('')
    if (!draft.name.trim()) return setError('Give the pipeline a name.')
    if (!validation.success) return setError(describeDefinitionError(validation.error))
    if (!scheduleCheck.success) return setError('Check the schedule settings.')
    if (draft.schedule.type === 'cron' && !upcoming.length) return setError('The cron expression is invalid.')
    if (draft.schedule.type === 'after' && !draft.schedule.afterPipelineId) return setError('Choose the pipeline this one runs after (Schedule tab).')
    if (
      publish &&
      !(await confirm({
        title: `Publish ${draft.name.trim()}?`,
        description: `Scheduled, API and webhook runs will use this version${draft.publishedVersion ? ` instead of v${draft.publishedVersion}` : ''}. If this workspace requires approval, it waits for a second person first.`,
        confirmLabel: 'Save & publish',
      }))
    )
      return
    setSaving(publish ? 'publish' : 'draft')
    try {
      const snapshot = snapshotOf(draft)
      const res = await savePipeline({ id: draft.id, name: draft.name, description: draft.description, definition, schedule: draft.schedule, enabled: draft.enabled, changeNote: changeNote || undefined, publish })
      setSavedSnapshot(snapshot)
      onSaved(res.id, res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  // The source table, for example values in AI mapping suggestions.
  const sourceNode = draft.nodes.find((n) => n.type === 'source')
  const sourceRef = sourceNode?.type === 'source' && sourceNode.dataSourceId && sourceNode.table ? { dataSourceId: sourceNode.dataSourceId, table: sourceNode.table } : undefined
  const outgoing = selected ? draft.edges.filter((e) => e.from === selected.id) : []
  const targets = draft.nodes.filter((n) => selected && n.id !== selected.id && n.type !== 'source')
  const [linkTo, setLinkTo] = useState('')
  const [linkBranch, setLinkBranch] = useState('')
  const selectedStat = selected ? statFor(selected.id) : undefined

  return (
    <Modal
      onClose={onClose}
      dirty={dirty}
      size="full"
      title={draft.name.trim() || 'New pipeline'}
      description="Pipeline editor: build the flow on the canvas, test it on a sample, then save a draft or publish."
      headerActions={
        draft.id ? (
          <Badge variant="outline" className="mt-0.5 rounded-sm font-mono">
            {draft.publishedVersion ? `published v${draft.publishedVersion}` : 'never published'}
            {draft.draftVersion ? ` · draft v${draft.draftVersion}` : ''}
          </Badge>
        ) : undefined
      }
      bodyClassName="flex flex-col p-0 lg:overflow-hidden"
      footer={
        <>
          {error ? (
            <p className="mr-auto flex min-w-0 items-center gap-1.5 text-sm text-danger-text" role="alert">
              <OctagonAlert className="size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : (
            <p className="mr-auto text-xs text-muted-foreground">{validation.success ? 'Ready to test or save.' : describeDefinitionError(validation.error)}</p>
          )}
          <Label htmlFor={changeNoteId} className="sr-only">
            Change note
          </Label>
          <Input id={changeNoteId} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Change note (optional)" className="w-56" />
          <Button variant="outline" onClick={runTest} disabled={testing || saving !== null}>
            {testing ? <Loader2 className="animate-spin" aria-hidden /> : <FlaskConical aria-hidden />}
            Test on sample
          </Button>
          <Button variant="outline" onClick={() => void save(false)} disabled={saving !== null || testing}>
            {saving === 'draft' ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            Save draft
          </Button>
          <Button onClick={() => void save(true)} disabled={saving !== null || testing}>
            {saving === 'publish' ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}
            Save &amp; publish
          </Button>
        </>
      }
    >
      {confirmDialog}
      <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
        <div className="grid w-64 gap-1">
          <Label htmlFor={nameId} className="text-xs text-muted-foreground">
            Pipeline name
          </Label>
          <Input id={nameId} value={draft.name} placeholder="e.g. Employee Sync" onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="font-medium" />
        </div>
        <div className="grid min-w-[180px] flex-1 gap-1">
          <Label htmlFor={descriptionId} className="text-xs text-muted-foreground">
            Description (optional)
          </Label>
          <Input id={descriptionId} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[160px_1fr_380px]">
        <aside className="flex gap-1 overflow-x-auto border-b border-border p-2 lg:flex-col lg:border-r lg:border-b-0" aria-label="Add a step">
          <h3 className="hidden px-1 pb-1 text-xs font-medium text-muted-foreground lg:block">Add after the selected step</h3>
          {ADDABLE.map((t) => {
            const Icon = META[t].icon
            return (
              <Button key={t} size="sm" variant="outline" className="justify-start" onClick={() => addNode(t)} title={META[t].hint}>
                <Icon className={KIND_ICON[t]} aria-hidden /> {META[t].title}
              </Button>
            )
          })}
        </aside>

        <div className="relative min-h-[360px]" role="region" aria-label="Pipeline canvas: drag steps, connect handles left to right">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onBeforeDelete={async ({ nodes }) => {
              const steps = draft.nodes.filter((n) => n.type !== 'source' && nodes.some((x) => x.id === n.id))
              return steps.length === 0 || confirmRemove(steps)
            }}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            colorMode={theme}
            deleteKeyCode={['Delete', 'Backspace']}
            proOptions={{ hideAttribution: true }}
            style={CANVAS_STYLE}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!hidden md:!block" />
          </ReactFlow>
        </div>

        <aside className="min-h-0 overflow-y-auto border-t border-border p-3 lg:border-t-0 lg:border-l" aria-label="Step settings">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a step on the canvas to configure it. Drag from a step&apos;s right handle to another step&apos;s left handle to connect them; select a connection and press Delete to remove it.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon = META[selected.type].icon
                  return <Icon className={cn('size-4', KIND_ICON[selected.type])} aria-hidden />
                })()}
                <h3 className="flex-1 font-medium">{META[selected.type].title}</h3>
                {selected.type !== 'source' && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={async () => {
                      if (await confirmRemove([selected])) removeNode(selected.id)
                    }}
                    aria-label="Delete step"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
              {selected.type === 'source' && <SourceEditor step={selected} options={options} onChange={setNode} />}
              {selected.type === 'filter' && <FilterEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} onChange={setNode} />}
              {selected.type === 'map' && <MapEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} source={sourceRef} onChange={setNode} />}
              {selected.type === 'validate' && <ValidateEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} onChange={setNode} />}
              {selected.type === 'rules' && <RulesEditor step={selected} options={options} onChange={setNode} />}
              {selected.type === 'router' && <RouterEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} onChange={setNode} />}
              {selected.type === 'destination' && <DestinationEditor step={selected} options={options} columns={columns.get(selected.id) ?? []} onChange={setNode} />}

              {selectedStat?.error && <Notice tone="danger">{selectedStat.error}</Notice>}
              {!!selectedStat?.sample?.length && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground">Rows after this step (last test)</h4>
                  <SampleTable rows={selectedStat.sample} />
                </div>
              )}

              {selected.type !== 'destination' && (
                <section className="space-y-2 rounded-md border border-border p-2" aria-label="Connections">
                  <h4 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Link2 className="size-3.5" aria-hidden /> Next steps
                  </h4>
                  {outgoing.length === 0 && <p className="text-xs text-muted-foreground">Not connected yet.</p>}
                  {outgoing.map((e) => {
                    const to = draft.nodes.find((n) => n.id === e.to)
                    const branch = selected.type === 'router' ? (e.branch === OTHERWISE ? 'otherwise' : selected.branches.find((b) => b.id === e.branch)?.label) : null
                    const name = to ? stepTitle(to) : e.to
                    return (
                      <div key={e.id} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate">
                          {branch && <span className="text-muted-foreground">{branch} → </span>}
                          {name}
                        </span>
                        <Button size="icon-sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, edges: d.edges.filter((x) => x.id !== e.id) }))} aria-label={`Remove connection to ${name}`}>
                          <X aria-hidden />
                        </Button>
                      </div>
                    )
                  })}
                  <div className="flex flex-wrap gap-1.5">
                    {selected.type === 'router' && (
                      <NativeSelect className="w-32" value={linkBranch} onChange={setLinkBranch} aria-label="Branch">
                        <option value="">branch…</option>
                        {selected.branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))}
                        <option value={OTHERWISE}>otherwise</option>
                      </NativeSelect>
                    )}
                    <NativeSelect className="min-w-0 flex-1" value={linkTo} onChange={setLinkTo} aria-label="Connect to step">
                      <option value="">Connect to…</option>
                      {targets.map((n) => (
                        <option key={n.id} value={n.id}>
                          {stepTitle(n)}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!linkTo || (selected.type === 'router' && !linkBranch)}
                      onClick={() => {
                        connect(selected.id, linkTo, selected.type === 'router' ? linkBranch : '')
                        setLinkTo('')
                      }}
                    >
                      Connect
                    </Button>
                  </div>
                </section>
              )}
            </div>
          )}
        </aside>
      </div>

      {notes.length > 0 && (
        <Notice
          tone="info"
          className="rounded-none border-x-0 border-b-0 text-xs"
          action={
            <Button size="icon-xs" variant="ghost" onClick={() => setNotes([])} aria-label="Dismiss template notes">
              <X aria-hidden />
            </Button>
          }
        >
          <ul className="list-disc pl-4">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Notice>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="max-h-[38vh] shrink-0 flex-col gap-0 overflow-y-auto border-t border-border">
        <TabsList variant="line" className="px-3 pt-2" aria-label="Test results, run settings and schedule">
          <TabsTrigger value="test">Test results</TabsTrigger>
          <TabsTrigger value="settings">Run settings</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
        </TabsList>
        <TabsContent value="test" className="p-3">
          <TestSummary test={test} testing={testing} draft={draft} />
        </TabsContent>
        <TabsContent value="settings" className="p-3">
          <SettingsSection settings={draft.settings} onChange={(patch) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }))} />
        </TabsContent>
        <TabsContent value="schedule" className="p-3">
          <ScheduleSection
            schedule={draft.schedule}
            enabled={draft.enabled}
            upcoming={upcoming}
            published={Boolean(draft.publishedVersion)}
            pipelines={options.pipelines.filter((p) => p.id !== draft.id)}
            onChange={setSchedule}
            onEnabled={(enabled) => setDraft({ ...draft, enabled })}
          />
          <WebhookTrigger pipelineId={draft.id} exists={Boolean(draft.webhookTrigger)} onChange={(webhookTrigger) => setDraft((d) => ({ ...d, webhookTrigger }))} />
        </TabsContent>
      </Tabs>
    </Modal>
  )
}

function TestSummary({ test, testing, draft }: { test: EngineResult | null; testing: boolean; draft: EditablePipeline }) {
  if (testing)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Testing on a sample…
      </p>
    )
  if (!test) return <p className="text-sm text-muted-foreground">Test on sample reads real rows, runs every step and writes nothing. Each step on the canvas then shows its row counts; select a step to see its rows.</p>
  if (test.error) return <Notice tone="danger">{test.error}</Notice>
  const destTotal = test.steps.filter((s) => s.type === 'destination').reduce((n, s) => n + s.rowsOut, 0)
  return (
    <div className="space-y-2 text-sm">
      {test.watermark && (
        <div className="text-xs text-muted-foreground">
          Incremental: reading rows after{' '}
          <span className="font-mono">{draft.syncPosition ? `${test.watermark.column} > ${draft.syncPosition}` : 'the beginning (first sync)'}</span>
          {test.watermark.value ? (
            <>
              {' '}
              · a run would advance the position to <span className="font-mono">{test.watermark.value}</span>
            </>
          ) : (
            ' · no new rows'
          )}
        </div>
      )}
      <p>
        Read <span className="font-mono">{test.rowsRead}</span> rows; <span className="font-mono">{destTotal}</span> would be written
        {test.rejectedCount > 0 && `, ${test.rejectedCount} quarantined`}
        {!!test.heldCount && `, ${test.heldCount} held for approval`}
        {!!test.flaggedCount && `, ${test.flaggedCount} flagged`}. Nothing was written.
      </p>
      {test.rejects.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {test.rejects.slice(0, 8).map((r, k) => (
            <li key={k}>
              <span className={cn('font-medium', r.kind === 'flag' ? 'text-warning-text' : r.kind === 'approval' ? 'text-held-text' : 'text-danger-text')}>
                {r.kind === 'flag' ? r.severity : r.kind === 'approval' ? 'approval' : 'error'}
              </span>
              : {r.errors.join('; ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SettingsSection({ settings, onChange }: { settings: PipelineSettings; onChange: (patch: Partial<PipelineSettings>) => void }) {
  const [emails, setEmails] = useState(settings.alertEmails.join(', '))
  const label = (text: string, child: React.ReactNode) => (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{text}</span>
      {child}
    </label>
  )
  return (
    <section className="space-y-3" aria-labelledby="pipeline-run-settings">
      <h3 id="pipeline-run-settings" className="flex items-center gap-2 font-medium">
        <BellRing className="size-4 text-muted-foreground" aria-hidden /> Retries, limits &amp; alerts
      </h3>
      <div className="grid gap-3 md:grid-cols-4">
        {label(
          'Retries on failure',
          <NativeSelect value={String(settings.retries)} onChange={(v) => onChange({ retries: Number(v) })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'No retries' : `${n} retr${n === 1 ? 'y' : 'ies'}`}
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          'First retry after',
          <NativeSelect value={String(settings.retryDelaySeconds)} onChange={(v) => onChange({ retryDelaySeconds: Number(v) })} disabled={!settings.retries}>
            {[5, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} seconds (then doubles)
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          'Timeout',
          <NativeSelect value={String(settings.timeoutMinutes)} onChange={(v) => onChange({ timeoutMinutes: Number(v) })}>
            {[15, 30, 60, 120, 240, 480, 1440].map((n) => (
              <option key={n} value={n}>
                {n < 60 ? `${n} minutes` : `${n / 60} hour${n === 60 ? '' : 's'}`}
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          'Batch size (rows per chunk)',
          <NativeSelect value={String(settings.batchSize)} onChange={(v) => onChange({ batchSize: Number(v) })}>
            {[1000, 2500, 5000, 10000, 20000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          'Fail when more than … of rows are quarantined',
          <NativeSelect value={settings.maxErrorPercent === null ? '' : String(settings.maxErrorPercent)} onChange={(v) => onChange({ maxErrorPercent: v === '' ? null : Number(v) })}>
            <option value="">No limit</option>
            {[1, 2, 5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          'Email alerts',
          <NativeSelect value={settings.alertOn} onChange={(v) => onChange({ alertOn: v as PipelineSettings['alertOn'] })}>
            <option value="failure">When a run fails</option>
            <option value="failure_or_rejects">When it fails or quarantines rows</option>
            <option value="never">Never (bell only)</option>
          </NativeSelect>,
        )}
        <div className="md:col-span-2">
          {label(
            'Send alerts to',
            <Input
              value={emails}
              disabled={settings.alertOn === 'never'}
              placeholder="Your account email"
              onChange={(e) => {
                setEmails(e.target.value)
                onChange({ alertEmails: e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) })
              }}
            />,
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Retries apply to connection and write errors, not to bad data or configuration, and resume from the last finished chunk.</p>
    </section>
  )
}

function ScheduleSection({
  schedule,
  enabled,
  upcoming,
  published,
  pipelines,
  onChange,
  onEnabled,
}: {
  schedule: PipelineSchedule
  enabled: boolean
  upcoming: Date[]
  published: boolean
  pipelines: { id: string; name: string; published: boolean }[]
  onChange: (patch: Partial<PipelineSchedule>) => void
  onEnabled: (v: boolean) => void
}) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const typeId = useId()
  return (
    <section aria-label="Schedule">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Label htmlFor={typeId} className="font-medium">
          Schedule
        </Label>
        <NativeSelect id={typeId} className="w-40" value={schedule.type} onChange={(v) => onChange({ type: v as PipelineSchedule['type'] })}>
          <option value="manual">Manual only</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="cron">Cron expression</option>
          <option value="after">After another pipeline</option>
        </NativeSelect>
        {schedule.type === 'after' && (
          <>
            <NativeSelect className="w-56" value={schedule.afterPipelineId} onChange={(v) => onChange({ afterPipelineId: v })} aria-label="Run after pipeline">
              <option value="">Choose a pipeline…</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.published ? '' : ' (not published)'}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect className="w-56" value={schedule.afterOn} onChange={(v) => onChange({ afterOn: v as PipelineSchedule['afterOn'] })} aria-label="When the other pipeline">
              {AFTER_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o === 'success' ? 'when it succeeds' : o === 'success_or_partial' ? 'when it succeeds or partially succeeds' : 'whenever it finishes'}
                </option>
              ))}
            </NativeSelect>
          </>
        )}
        {schedule.type === 'hourly' && (
          <label className="flex items-center gap-2 text-sm">
            at minute
            <Input type="number" min={0} max={59} className="w-20 font-mono" value={schedule.minute} onChange={(e) => onChange({ minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })} />
          </label>
        )}
        {['daily', 'weekly', 'monthly'].includes(schedule.type) && (
          <label className="flex items-center gap-2 text-sm">
            at
            <Input type="time" className="w-32 font-mono" value={schedule.time} onChange={(e) => e.target.value && onChange({ time: e.target.value })} />
            WIB
          </label>
        )}
        {schedule.type === 'monthly' && (
          <label className="flex items-center gap-2 text-sm">
            on day
            <Input type="number" min={1} max={28} className="w-20 font-mono" value={schedule.dayOfMonth} onChange={(e) => onChange({ dayOfMonth: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })} />
          </label>
        )}
        {schedule.type === 'cron' && <Input className="w-48 font-mono" placeholder="0 1 * * 1-5" value={schedule.cron} onChange={(e) => onChange({ cron: e.target.value })} aria-label="Cron expression" />}
        {schedule.type !== 'manual' && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
            Enabled
          </label>
        )}
      </div>
      {schedule.type === 'weekly' && (
        <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Days of the week">
          {days.map((d, i) => {
            const on = schedule.weekdays.includes(i)
            return (
              <button
                key={d}
                type="button"
                onClick={() => onChange({ weekdays: on ? schedule.weekdays.filter((x) => x !== i) : [...schedule.weekdays, i] })}
                aria-pressed={on}
                className={cn(
                  'rounded-md border px-2 py-1 font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  on ? 'border-ring bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {d}
              </button>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {describeSchedule(schedule)}
        {schedule.type !== 'manual' && schedule.type !== 'after' && (upcoming.length ? ` · next: ${upcoming.map((d) => formatInTimezone(d, schedule.timezone)).join(' · ')}` : ' · invalid schedule')}
        {schedule.type === 'after' && schedule.afterPipelineId && ` (${pipelines.find((p) => p.id === schedule.afterPipelineId)?.name ?? 'missing pipeline'})`}
        {schedule.type !== 'manual' && !enabled && ' · disabled, will not run automatically'}
        {schedule.type !== 'manual' && !published && ' · schedules start once the pipeline is published'}
        . Scheduled runs always execute the published version.
      </p>
    </section>
  )
}

/** Inbound webhook trigger (SC-1): a secret URL that starts this pipeline from another system. */
function WebhookTrigger({ pipelineId, exists, onChange }: { pipelineId?: string; exists: boolean; onChange: (exists: boolean) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }
  const create = async () => {
    if (!pipelineId) return
    if (exists && !(await confirm({ title: 'Create a new webhook URL?', description: 'The current URL stops working at once. Systems that call it need the new one.', confirmLabel: 'Create new URL', tone: 'danger' }))) return
    await act(async () => {
      setUrl((await createWebhookTrigger(pipelineId)).url)
      onChange(true)
    })
  }
  const turnOff = async () => {
    if (!pipelineId) return
    if (!(await confirm({ title: 'Turn off the webhook trigger?', description: 'The URL stops working; calls to it are refused.', confirmLabel: 'Turn off', tone: 'danger' }))) return
    await act(async () => {
      await disableWebhookTrigger(pipelineId)
      setUrl(null)
      onChange(false)
    })
  }
  return (
    <section className="mt-4 space-y-2 border-t border-border pt-3" aria-labelledby="pipeline-webhook-trigger">
      {confirmDialog}
      <h3 id="pipeline-webhook-trigger" className="text-sm font-medium">
        Webhook trigger
      </h3>
      <p className="text-xs text-muted-foreground">
        Other systems (SAP event mesh, a CI job, a script) can start this pipeline with an HTTP POST to a secret URL. Runs use the published version; up to 30 calls per minute.
      </p>
      {!pipelineId ? (
        <p className="text-xs text-muted-foreground">Save the pipeline first.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void create()}>
            {exists ? 'Create a new URL (the old one stops working)' : 'Create webhook URL'}
          </Button>
          {exists && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void turnOff()}>
              Turn off
            </Button>
          )}
          {exists && !url && <span className="text-xs text-muted-foreground">A URL exists; it is only shown when created.</span>}
        </div>
      )}
      {url && (
        <Notice tone="warning" title="Copy this URL now; it won't be shown again.">
          <div className="mt-1 space-y-1">
            <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Webhook URL" />
            <div className="font-mono text-xs text-muted-foreground">curl -X POST &quot;{url.slice(0, 48)}…&quot;</div>
          </div>
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  )
}

export function SampleTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter((c) => !c.startsWith('_nexus_')).slice(0, 20)
  const show = (v: unknown) => (v === null || v === undefined ? '∅' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border" tabIndex={0} role="region" aria-label="Sample rows">
      <table className="w-full border-collapse text-left text-xs tabular-nums">
        <THead className="sticky top-0 z-[1] bg-muted">
          <tr>
            {cols.map((c) => (
              <Th key={c} className="h-7 px-2 font-mono normal-case first:pl-2 last:pr-2">
                {c}
              </Th>
            ))}
          </tr>
        </THead>
        <TBody>
          {rows.map((r, i) => (
            <Tr key={i}>
              {cols.map((c) => (
                <Td key={c} className="max-w-[220px] truncate px-2 py-1 font-mono whitespace-nowrap first:pl-2 last:pr-2" title={show(r[c])}>
                  {show(r[c])}
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </table>
    </div>
  )
}
