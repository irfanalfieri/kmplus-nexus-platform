'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { BellRing, Database, Filter, FlaskConical, GitBranch, GitMerge, Layers, Link2, Loader2, OctagonAlert, Rocket, Save, Scale, ShieldCheck, Shuffle, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { THead, TBody, Tr, Th, Td } from '@/components/ui/data-table'
import { Breaker } from '@/components/ui/flow-line'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePrefs, useT } from '@/components/i18n/i18n-provider'
import type { Translate } from '@/lib/i18n/translate'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SCHEDULE,
  DEFAULT_SETTINGS,
  OTHERWISE,
  definitionSchema,
  describeDefinitionError,
  newStepId,
  scheduleSchema,
  topoOrder,
  type NodeType,
  type Port,
  type PipelineEdge,
  type PipelineNode,
  type PipelineSchedule,
  type PipelineSettings,
} from '@/lib/pipelines/definition'
import { describeScheduleT, nextRunTimes } from '@/lib/pipelines/schedule'
import { AFTER_OUTCOMES } from '@/lib/pipelines/definition'
import type { EngineResult, StepStat } from '@/lib/pipelines/engine'
import { createWebhookTrigger, disableWebhookTrigger, savePipeline, testPipeline } from '@/lib/actions/pipelines'
import { localizeCheck } from '@/lib/pipelines/check-messages'
import { localizeStepTitle } from './step-title'
import { isStagedStep, joinPrefix, laneLabel, planLanes, type LanePlan } from '@/lib/pipelines/lanes'
import { joinOutputColumns } from '@/lib/pipelines/join'
import {
  DestinationEditor,
  FilterEditor,
  JoinEditor,
  MapEditor,
  NativeSelect,
  RouterEditor,
  RulesEditor,
  SourceEditor,
  UnionEditor,
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

/** Step kinds: icon here, title and hint from `editor.nodes.*` / `editor.hints.*`. */
const META: Record<NodeType, { icon: typeof Database }> = {
  source: { icon: Database },
  filter: { icon: Filter },
  map: { icon: Shuffle },
  validate: { icon: ShieldCheck },
  rules: { icon: Scale },
  router: { icon: GitBranch },
  join: { icon: GitMerge },
  union: { icon: Layers },
  destination: { icon: Upload },
}
const kindTitle = (type: NodeType, t: Translate) => t(`editor.nodes.${type}`)

/** `stepTitle` (lib/pipelines/definition.ts) in the reader's language, for display only. */
function stepLabel(n: PipelineNode, t: Translate): string {
  switch (n.type) {
    case 'source':
      return n.table ? t('editor.stepTitle.source', { table: n.table }) : t('editor.stepTitle.sourceEmpty')
    case 'filter':
      return n.ruleId ? t('editor.stepTitle.filterRule') : t('editor.stepTitle.filter', { count: n.conditions.length })
    case 'map':
      return t('editor.stepTitle.map', { count: n.fields.length })
    case 'validate':
      return t('editor.stepTitle.validate', { count: n.rules.length })
    case 'rules':
      return t('editor.stepTitle.rules', { count: n.ruleIds.length })
    case 'router':
      return t('editor.stepTitle.router', { count: n.branches.length + 1 })
    case 'join':
      return t('editor.stepTitle.join', { keys: n.keys.map((k) => k.left).filter(Boolean).join(', ') || '…' })
    case 'union':
      return t('editor.stepTitle.union')
    case 'destination':
      return n.kind === 'dataset' ? t('editor.stepTitle.destinationDataset', { name: n.datasetName }) : n.kind === 'api' ? t('editor.stepTitle.destinationApi', { name: `${n.method} ${n.path}` }) : t('editor.stepTitle.destinationTable', { name: n.table })
  }
}
const ADDABLE: NodeType[] = ['source', 'filter', 'map', 'validate', 'rules', 'router', 'join', 'union', 'destination']

/** Node frame and icon colour by kind: sources in, destinations out, transforms neutral. */
const KIND_BORDER: Record<NodeType, string> = {
  source: 'border-info',
  filter: 'border-border',
  map: 'border-border',
  validate: 'border-border',
  rules: 'border-border',
  router: 'border-border',
  join: 'border-border',
  union: 'border-border',
  destination: 'border-live',
}
const KIND_ICON: Record<NodeType, string> = {
  source: 'text-info',
  filter: 'text-muted-foreground',
  map: 'text-muted-foreground',
  validate: 'text-muted-foreground',
  rules: 'text-muted-foreground',
  router: 'text-muted-foreground',
  join: 'text-muted-foreground',
  union: 'text-muted-foreground',
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

function newNode(type: NodeType, columns: Column[], position: { x: number; y: number }, firstBranch = 'Branch 1'): PipelineNode {
  const first = columns[0]?.name ?? ''
  const id = newStepId()
  switch (type) {
    case 'source':
      return { id, type, position, dataSourceId: '', table: '', maxRows: 10000, mode: 'full', watermarkColumn: '' }
    case 'join':
      return { id, type, position, joinType: 'left', keys: [{ left: first, right: '' }], normalize: { trim: true, ignoreCase: true, leadingZeros: false }, onMany: 'all', firstBy: { column: '', direction: 'desc' }, onNoMatch: 'keep', prefix: '' }
    case 'union':
      return { id, type, position, sourceColumn: '_source', labels: [] }
    case 'filter':
      return { id, type, position, match: 'all', conditions: [newCondition(first)], ruleId: '' }
    case 'map':
      return { id, type, position, keepUnmapped: false, fields: [{ from: first, to: first.toLowerCase(), type: 'text', transforms: [] }] }
    case 'validate':
      return { id, type, position, onFail: 'reject', rules: [newValidationRule(first)] }
    case 'rules':
      return { id, type, position, ruleIds: [] }
    case 'router':
      return { id, type, position, branches: [{ id: newStepId(), label: firstBranch, ruleId: '', condition: { match: 'all', conditions: [newCondition(first)], groups: [] } }] }
    case 'destination':
      return { id, type, position, kind: 'dataset', datasetName: '', mode: 'replace', keys: [], softDeleteMissing: false }
  }
}

/** Columns flowing into each node (a Join: its left side; `right`: its right side): what its inputs output. */
function columnsPerNode(nodes: PipelineNode[], edges: PipelineEdge[], options: BuilderOptions, plan: LanePlan): Map<string, Column[]> & { right: Map<string, Column[]> } {
  const order = topoOrder(nodes, edges) ?? nodes
  const output = new Map<string, Column[]>()
  const input = Object.assign(new Map<string, Column[]>(), { right: new Map<string, Column[]>() })
  const gather = (nodeId: string, right: boolean) => {
    const merged = new Map<string, Column>()
    for (const e of edges) if (e.to === nodeId && (e.port === 'right') === right) for (const c of output.get(e.from) ?? []) if (!merged.has(c.name)) merged.set(c.name, c)
    return [...merged.values()]
  }
  for (const node of order) {
    const cols = gather(node.id, false)
    input.set(node.id, cols)
    if (node.type === 'join') {
      const right = gather(node.id, true)
      input.right.set(node.id, right)
      output.set(node.id, joinOutputColumns(node, cols, right, joinPrefix({ nodes, edges }, plan, node)))
    } else if (node.type === 'union') {
      output.set(node.id, node.sourceColumn && !cols.some((c) => c.name === node.sourceColumn) ? [...cols, { name: node.sourceColumn, type: 'text' }] : cols)
    } else if (node.type === 'source') {
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

/** `held`: the last test held rows at this node for approval (and quarantined none). `driver`: the streaming Source of several. */
type NodeData = { node: PipelineNode; stat?: StepStat; held: boolean; invalid: boolean; driver: boolean }

function NexusNode({ data, selected }: NodeProps<FlowNode<NodeData>>) {
  const t = useT()
  const { node, stat, held } = data
  const meta = META[node.type]
  const Icon = meta.icon
  const title = stepLabel(node, t)
  const handles = node.type === 'router' ? [...node.branches.map((b) => ({ id: b.id, label: b.label })), { id: OTHERWISE, label: t('editor.canvas.otherwise') }] : node.type === 'destination' ? [] : [{ id: '', label: '' }]
  // The last test's outcome overrides the kind colour: failed or quarantined → danger, held for approval → held.
  const border = stat?.error ? 'border-danger' : stat && stat.rejected > 0 ? (held ? 'border-held' : 'border-danger') : KIND_BORDER[node.type]
  const targetHandle = '!h-3 !w-3 !border-2 !border-card !bg-muted-foreground'
  return (
    <div className={cn('w-52 rounded-md border-2 bg-card text-card-foreground', border, selected && 'outline-2 outline-offset-2 outline-ring')}>
      {node.type !== 'source' && node.type !== 'join' && <Handle type="target" position={Position.Left} className={targetHandle} />}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon className={cn('size-4 shrink-0', KIND_ICON[node.type])} aria-hidden />
        <span className="truncate text-sm font-medium">{kindTitle(node.type, t)}</span>
        {data.driver && (
          <Badge variant="outline" className="ml-auto rounded-sm px-1 py-0 font-mono text-[10px] uppercase">
            {t('editor.canvas.driver')}
          </Badge>
        )}
      </div>
      {node.type === 'join' &&
        (['left', 'right'] as const).map((side) => (
          <div key={side} className="relative border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
            {t(`editor.canvas.${side}`)}
            <Handle id={side} type="target" position={Position.Left} style={{ top: '50%' }} className={targetHandle} />
          </div>
        ))}
      <div className="px-3 py-2 text-xs text-muted-foreground">
        <div className="truncate" title={title}>
          {title}
        </div>
        {stat && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px]">
            {stat.error ? (
              <span className="inline-flex items-center gap-1.5 font-sans font-medium text-danger-text">
                <Breaker state="tripped" className="size-2" /> {t('editor.canvas.failed')}
              </span>
            ) : (
              <>
                <span className="text-foreground">{t('editor.canvas.out', { count: stat.rowsOut })}</span>
                {stat.rejected > 0 && (
                  <span className={cn('inline-flex items-center gap-1.5', held ? 'text-held-text' : 'text-danger-text')}>
                    <Breaker state={held ? 'held' : 'tripped'} className="size-2" />
                    {t('editor.canvas.held', { count: stat.rejected })}
                  </span>
                )}
                {!!stat.flagged && <span className="text-warning-text">{t('editor.canvas.flagged', { count: stat.flagged })}</span>}
                {node.type === 'join' && stat.rowsIn > 0 && <span>{t('editor.canvas.matched', { matched: stat.matched ?? 0, count: stat.rowsIn })}</span>}
                {!!stat.multiplied && <span className="text-warning-text">{t('editor.canvas.multiplied', { count: stat.multiplied })}</span>}
                {!!stat.staged && <span>{t('editor.canvas.staged', { count: stat.staged })}</span>}
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
  const { theme, t } = usePrefs()
  const nameId = useId()
  const descriptionId = useId()
  const changeNoteId = useId()

  // A pipeline built from a template has never been saved, so it counts as unsaved work too.
  const dirty = snapshotOf(draft) !== savedSnapshot || (!draft.id && Boolean(initial.name))

  const definition = { nodes: draft.nodes, edges: draft.edges, settings: draft.settings }
  const plan = useMemo(() => planLanes({ nodes: draft.nodes, edges: draft.edges }), [draft.nodes, draft.edges])
  const columns = useMemo(() => columnsPerNode(draft.nodes, draft.edges, options, plan), [draft.nodes, draft.edges, options, plan])
  const sourceCount = draft.nodes.filter((n) => n.type === 'source').length
  const deletable = (n: PipelineNode) => n.type !== 'source' || sourceCount > 1
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

  const flowNodes: FlowNode<NodeData>[] = draft.nodes.map((n) => ({ id: n.id, type: 'nexus', position: n.position, selected: n.id === selectedId, deletable: deletable(n), data: { node: n, stat: statFor(n.id), held: heldAt(n.id), invalid: false, driver: sourceCount > 1 && plan.driver === n.id } }))
  const flowEdges: FlowEdge[] = draft.edges.map((e) => {
    const from = draft.nodes.find((n) => n.id === e.from)
    const label = from?.type === 'router' ? (e.branch === OTHERWISE ? t('editor.canvas.otherwise') : from.branches.find((b) => b.id === e.branch)?.label) : undefined
    return { id: e.id, source: e.from, target: e.to, sourceHandle: e.branch || null, targetHandle: e.port || null, label, animated: testing }
  })

  const setNode = (node: PipelineNode) => setDraft((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === node.id ? node : n)) }))
  const removeNode = (id: string) => {
    setDraft((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== id), edges: d.edges.filter((e) => e.from !== id && e.to !== id) }))
    setSelectedId(null)
  }
  const confirmRemove = (nodes: PipelineNode[]) =>
    confirm({
      title: nodes.length === 1 ? t('editor.modal.deleteOneTitle', { step: kindTitle(nodes[0].type, t).toLowerCase() }) : t('editor.modal.deleteManyTitle', { count: nodes.length }),
      description: t('editor.modal.deleteBody'),
      confirmLabel: nodes.length === 1 ? t('editor.modal.deleteStep') : t('editor.modal.deleteSteps'),
      tone: 'danger',
    })
  const connect = (from: string, to: string, branch = '', side: Port = '') =>
    setDraft((d) => {
      if (from === to || d.edges.some((e) => e.from === from && e.to === to && e.branch === branch)) return d
      const target = d.nodes.find((n) => n.id === to)
      // A Join has one input per side: the new connection takes the side over (left if none was picked).
      const port: Port = target?.type === 'join' ? side || (d.edges.some((e) => e.to === to && e.port === 'left') ? 'right' : 'left') : ''
      const edges = target?.type === 'join' ? d.edges.filter((e) => !(e.to === to && e.port === port)) : d.edges
      return { ...d, edges: [...edges, { id: newStepId(), from, to, branch, ...(port ? { port } : {}) }] }
    })
  /** Several sources: exactly one is the driver. */
  const makeDriver = (id: string) => setDraft((d) => ({ ...d, nodes: d.nodes.map((n) => (n.type === 'source' ? { ...n, driver: n.id === id } : n)) }))

  const onNodesChange = (changes: NodeChange<FlowNode<NodeData>>[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        const pos = c.position
        setDraft((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === c.id ? { ...n, position: { x: Math.round(pos.x), y: Math.round(pos.y) } } : n)) }))
      } else if (c.type === 'select' && c.selected) setSelectedId(c.id)
      else if (c.type === 'remove') {
        const n = draft.nodes.find((x) => x.id === c.id)
        if (n && deletable(n)) removeNode(c.id)
      }
    }
  }
  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
    if (removed.size) setDraft((d) => ({ ...d, edges: d.edges.filter((e) => !removed.has(e.id)) }))
  }
  const onConnect = (c: Connection) => c.source && c.target && connect(c.source, c.target, c.sourceHandle ?? '', c.targetHandle === 'left' || c.targetHandle === 'right' ? c.targetHandle : '')

  const addSource = () => {
    const sources = draft.nodes.filter((n) => n.type === 'source')
    const lowest = Math.max(...draft.nodes.map((n) => n.position.y), 0)
    const node = newNode('source', [], { x: sources[0]?.position.x ?? 40, y: lowest + 160 })
    // The first source stays the driver; the new one is looked up or added after it.
    setDraft((d) => ({ ...d, nodes: [...d.nodes.map((n) => (n.type === 'source' && !d.nodes.some((x) => x.type === 'source' && x.driver) && n.id === sources[0]?.id ? { ...n, driver: true } : n)), node] }))
    setSelectedId(node.id)
  }

  const addNode = (type: NodeType) => {
    if (type === 'source') return addSource()
    const anchor = selected ?? draft.nodes[0]
    const position = { x: (anchor?.position.x ?? 0) + 260, y: (anchor?.position.y ?? 0) + (draft.nodes.filter((n) => Math.abs(n.position.x - ((anchor?.position.x ?? 0) + 260)) < 40).length * 140) }
    const node = newNode(type, anchor ? columns.get(anchor.id) ?? [] : [], position, t('editor.canvas.firstBranch'))
    setDraft((d) => {
      let edges = d.edges
      if (anchor && anchor.type !== 'destination') {
        let branch = ''
        if (anchor.type === 'router') branch = anchor.branches.find((b) => !d.edges.some((e) => e.from === anchor.id && e.branch === b.id))?.id ?? OTHERWISE
        // Inserting before the anchor's single next step keeps the chain: anchor → new → next.
        const outgoing = d.edges.filter((e) => e.from === anchor.id && e.branch === branch)
        // A new Join takes the anchor's rows on its left (driving) side; the right side is connected by hand.
        const port: Port = type === 'join' ? 'left' : ''
        const into = { id: newStepId(), from: anchor.id, to: node.id, branch, ...(port ? { port } : {}) }
        if (anchor.type !== 'router' && outgoing.length === 1 && type !== 'destination') {
          edges = [...d.edges.filter((e) => e !== outgoing[0]), into, { id: newStepId(), from: node.id, to: outgoing[0].to, branch: '', ...(outgoing[0].port ? { port: outgoing[0].port } : {}) }]
        } else edges = [...d.edges, into]
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
      setError(err instanceof Error ? err.message : t('editor.modal.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  const save = async (publish: boolean) => {
    setError('')
    if (!draft.name.trim()) return setError(t('editor.modal.nameRequired'))
    if (!validation.success) return setError(describeDefinitionError(validation.error))
    if (!scheduleCheck.success) return setError(t('editor.modal.checkSchedule'))
    if (draft.schedule.type === 'cron' && !upcoming.length) return setError(t('editor.modal.cronInvalid'))
    if (draft.schedule.type === 'after' && !draft.schedule.afterPipelineId) return setError(t('editor.modal.chooseAfter'))
    if (
      publish &&
      !(await confirm({
        title: t('editor.modal.publishTitle', { name: draft.name.trim() }),
        description: draft.publishedVersion ? t('editor.modal.publishBodyReplace', { version: draft.publishedVersion }) : t('editor.modal.publishBody'),
        confirmLabel: t('editor.modal.savePublish'),
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
      setError(err instanceof Error ? err.message : t('editor.modal.saveFailed'))
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
  const [linkSide, setLinkSide] = useState<Port>('')
  const linkTarget = draft.nodes.find((n) => n.id === linkTo)
  const selectedStat = selected ? statFor(selected.id) : undefined

  // The canvas shares the height with the panel below it: fit the steps again when its size changes.
  // A callback ref, because the editor mounts inside a dialog portal after the first effects run.
  const flowRef = useRef<{ fitView: (o?: { padding?: number }) => unknown } | null>(null)
  // A short canvas has no room for the minimap: it would sit on top of the steps.
  const [roomy, setRoomy] = useState(true)
  const observerRef = useRef<ResizeObserver | null>(null)
  const canvasRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      setRoomy(el.clientHeight >= 420)
      clearTimeout(timer)
      timer = setTimeout(() => void flowRef.current?.fitView({ padding: 0.3 }), 120)
    })
    observer.observe(el)
    observerRef.current = observer
  }, [])
  useEffect(() => () => observerRef.current?.disconnect(), [])

  return (
    <Modal
      onClose={onClose}
      dirty={dirty}
      size="full"
      title={draft.name.trim() || t('editor.modal.newPipeline')}
      description={t('editor.modal.description')}
      headerActions={
        draft.id ? (
          <Badge variant="outline" className="mt-0.5 rounded-sm font-mono">
            {draft.publishedVersion ? t('editor.modal.publishedVersion', { version: draft.publishedVersion }) : t('editor.modal.neverPublished')}
            {draft.draftVersion ? ` · ${t('editor.modal.draftVersion', { version: draft.draftVersion })}` : ''}
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
            <p className="mr-auto text-xs text-muted-foreground">{validation.success ? t('editor.modal.ready') : describeDefinitionError(validation.error)}</p>
          )}
          <Label htmlFor={changeNoteId} className="sr-only">
            {t('editor.modal.changeNote')}
          </Label>
          <Input id={changeNoteId} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder={t('editor.modal.changeNotePlaceholder')} className="w-56" />
          <Button variant="outline" onClick={runTest} disabled={testing || saving !== null}>
            {testing ? <Loader2 className="animate-spin" aria-hidden /> : <FlaskConical aria-hidden />}
            {t('editor.modal.testOnSample')}
          </Button>
          <Button variant="outline" onClick={() => void save(false)} disabled={saving !== null || testing}>
            {saving === 'draft' ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {t('editor.modal.saveDraft')}
          </Button>
          <Button onClick={() => void save(true)} disabled={saving !== null || testing}>
            {saving === 'publish' ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}
            {t('editor.modal.savePublish')}
          </Button>
        </>
      }
    >
      {confirmDialog}
      <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
        <div className="grid w-64 gap-1">
          <Label htmlFor={nameId} className="text-xs text-muted-foreground">
            {t('editor.modal.name')}
          </Label>
          <Input id={nameId} value={draft.name} placeholder={t('editor.modal.namePlaceholder')} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="font-medium" />
        </div>
        <div className="grid min-w-[180px] flex-1 gap-1">
          <Label htmlFor={descriptionId} className="text-xs text-muted-foreground">
            {t('editor.modal.descriptionLabel')}
          </Label>
          <Input id={descriptionId} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:min-h-60 lg:basis-0 lg:grid-cols-[160px_1fr_380px] lg:overflow-hidden">
        <aside className="flex gap-1 overflow-x-auto border-b border-border p-2 lg:flex-col lg:border-r lg:border-b-0" aria-label={t('editor.modal.addStep')}>
          <h3 className="hidden px-1 pb-1 text-xs font-medium text-muted-foreground lg:block">{t('editor.modal.addAfter')}</h3>
          {ADDABLE.map((type) => {
            const Icon = META[type].icon
            return (
              <Button key={type} size="sm" variant="outline" className="justify-start" onClick={() => addNode(type)} title={t(`editor.hints.${type}`)}>
                <Icon className={KIND_ICON[type]} aria-hidden /> {kindTitle(type, t)}
              </Button>
            )
          })}
        </aside>

        <div ref={canvasRef} className="relative min-h-[360px] lg:min-h-0" role="region" aria-label={t('editor.modal.canvas')}>
          <ReactFlow
            onInit={(instance) => (flowRef.current = instance)}
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onBeforeDelete={async ({ nodes }) => {
              const steps = draft.nodes.filter((n) => deletable(n) && nodes.some((x) => x.id === n.id))
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
            {roomy && <MiniMap pannable zoomable className="!hidden md:!block" />}
          </ReactFlow>
        </div>

        <aside className="min-h-0 overflow-y-auto border-t border-border p-3 lg:border-t-0 lg:border-l" aria-label={t('editor.modal.stepSettings')}>
          {!selected ? (
            <p className="text-sm text-muted-foreground">{t('editor.modal.selectHint')}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon = META[selected.type].icon
                  return <Icon className={cn('size-4', KIND_ICON[selected.type])} aria-hidden />
                })()}
                <h3 className="flex-1 font-medium">{kindTitle(selected.type, t)}</h3>
                {deletable(selected) && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={async () => {
                      if (await confirmRemove([selected])) removeNode(selected.id)
                    }}
                    aria-label={t('editor.modal.deleteStep')}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
              {selected.type === 'source' && (
                <SourceEditor
                  step={selected}
                  options={options}
                  lane={{ several: sourceCount > 1, driver: plan.driver === selected.id, staged: isStagedStep(plan, selected.id), hasJoins: plan.joins.length > 0 }}
                  onMakeDriver={() => makeDriver(selected.id)}
                  onChange={setNode}
                />
              )}
              {selected.type === 'join' && (
                <JoinEditor
                  step={selected}
                  left={columns.get(selected.id) ?? []}
                  right={columns.right.get(selected.id) ?? []}
                  defaultPrefix={joinPrefix({ nodes: draft.nodes, edges: draft.edges }, plan, { ...selected, prefix: '' })}
                  connected={plan.joins.some((j) => j.id === selected.id)}
                  onChange={setNode}
                />
              )}
              {selected.type === 'union' && (
                <UnionEditor
                  step={selected}
                  inputs={draft.edges.filter((e) => e.to === selected.id).map((e) => {
                    const from = draft.nodes.find((n) => n.id === e.from)
                    return { from: e.from, name: from ? stepLabel(from, t) : e.from, defaultLabel: laneLabel({ nodes: draft.nodes, edges: draft.edges }, plan, e.from) }
                  })}
                  onChange={setNode}
                />
              )}
              {selected.type === 'filter' && <FilterEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} onChange={setNode} />}
              {selected.type === 'map' && <MapEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} source={sourceRef} onChange={setNode} />}
              {selected.type === 'validate' && <ValidateEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} onChange={setNode} />}
              {selected.type === 'rules' && <RulesEditor step={selected} options={options} onChange={setNode} />}
              {selected.type === 'router' && <RouterEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} onChange={setNode} />}
              {selected.type === 'destination' && <DestinationEditor step={selected} options={options} columns={columns.get(selected.id) ?? []} sampleRow={selectedStat?.sample?.[0] as Record<string, unknown> | undefined} pipelineId={draft.id} onChange={setNode} />}

              {selectedStat?.error && <Notice tone="danger">{selectedStat.error}</Notice>}
              {!!selectedStat?.sample?.length && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground">{t('editor.modal.rowsAfter')}</h4>
                  <SampleTable rows={selectedStat.sample} />
                </div>
              )}

              {selected.type !== 'destination' && (
                <section className="space-y-2 rounded-md border border-border p-2" aria-label={t('editor.modal.connections')}>
                  <h4 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Link2 className="size-3.5" aria-hidden /> {t('editor.modal.nextSteps')}
                  </h4>
                  {outgoing.length === 0 && <p className="text-xs text-muted-foreground">{t('editor.modal.notConnected')}</p>}
                  {outgoing.map((e) => {
                    const to = draft.nodes.find((n) => n.id === e.to)
                    const branch = selected.type === 'router' ? (e.branch === OTHERWISE ? t('editor.canvas.otherwise') : selected.branches.find((b) => b.id === e.branch)?.label) : null
                    const name = to ? stepLabel(to, t) : e.to
                    return (
                      <div key={e.id} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate">
                          {branch && <span className="text-muted-foreground">{branch} → </span>}
                          {name}
                          {e.port && <span className="text-muted-foreground"> ({t(`editor.canvas.${e.port}`)})</span>}
                        </span>
                        <Button size="icon-sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, edges: d.edges.filter((x) => x.id !== e.id) }))} aria-label={t('editor.modal.removeConnection', { name })}>
                          <X aria-hidden />
                        </Button>
                      </div>
                    )
                  })}
                  <div className="flex flex-wrap gap-1.5">
                    {selected.type === 'router' && (
                      <NativeSelect className="w-32" value={linkBranch} onChange={setLinkBranch} aria-label={t('editor.modal.branch')}>
                        <option value="">{t('editor.modal.branchPlaceholder')}</option>
                        {selected.branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))}
                        <option value={OTHERWISE}>{t('editor.canvas.otherwise')}</option>
                      </NativeSelect>
                    )}
                    <NativeSelect className="min-w-0 flex-1" value={linkTo} onChange={(v) => (setLinkTo(v), setLinkSide(''))} aria-label={t('editor.modal.connectTo')}>
                      <option value="">{t('editor.modal.connectPlaceholder')}</option>
                      {targets.map((n) => (
                        <option key={n.id} value={n.id}>
                          {stepLabel(n, t)}
                        </option>
                      ))}
                    </NativeSelect>
                    {linkTarget?.type === 'join' && (
                      <NativeSelect className="w-40" value={linkSide} onChange={(v) => setLinkSide(v as Port)} aria-label={t('editor.modal.side')}>
                        <option value="">{t('editor.modal.side')}</option>
                        <option value="left">{t('editor.modal.sideLeft')}</option>
                        <option value="right">{t('editor.modal.sideRight')}</option>
                      </NativeSelect>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!linkTo || (selected.type === 'router' && !linkBranch) || (linkTarget?.type === 'join' && !linkSide)}
                      onClick={() => {
                        connect(selected.id, linkTo, selected.type === 'router' ? linkBranch : '', linkTarget?.type === 'join' ? linkSide : '')
                        setLinkTo('')
                        setLinkSide('')
                      }}
                    >
                      {t('editor.modal.connect')}
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
            <Button size="icon-xs" variant="ghost" onClick={() => setNotes([])} aria-label={t('editor.modal.dismissNotes')}>
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
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="relative z-10 max-h-[38vh] min-h-28 shrink flex-col gap-0 overflow-y-auto border-t border-border bg-card">
        <TabsList variant="line" className="px-3 pt-2" aria-label={t('editor.modal.tabs')}>
          <TabsTrigger value="test">{t('editor.modal.tabTest')}</TabsTrigger>
          <TabsTrigger value="settings">{t('editor.modal.tabSettings')}</TabsTrigger>
          <TabsTrigger value="schedule">{t('editor.modal.tabSchedule')}</TabsTrigger>
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
  const { t, locale } = usePrefs()
  if (testing)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t('editor.test.testing')}
      </p>
    )
  if (!test) return <p className="text-sm text-muted-foreground">{t('editor.test.intro')}</p>
  if (test.error) return <Notice tone="danger">{test.error}</Notice>
  const destTotal = test.steps.filter((s) => s.type === 'destination').reduce((n, s) => n + s.rowsOut, 0)
  const severity = (s: string | undefined) => (s === 'error' || s === 'warning' || s === 'info' ? t(`editor.test.severity.${s}`) : (s ?? ''))
  return (
    <div className="space-y-2 text-sm">
      {test.watermark && (
        <div className="text-xs text-muted-foreground">
          {t('editor.test.incremental')}{' '}
          <span className="font-mono">{draft.syncPosition ? `${test.watermark.column} > ${draft.syncPosition}` : t('editor.test.firstSync')}</span>
          {test.watermark.value ? (
            <>
              {' '}
              · {t('editor.test.advance')} <span className="font-mono">{test.watermark.value}</span>
            </>
          ) : (
            ` · ${t('editor.test.noNewRows')}`
          )}
        </div>
      )}
      <p className="tabular-nums">
        {t('editor.test.summary', { read: test.rowsRead, written: destTotal })}
        {test.rejectedCount > 0 && t('editor.test.quarantined', { count: test.rejectedCount })}
        {!!test.heldCount && t('editor.test.heldForApproval', { count: test.heldCount })}
        {!!test.flaggedCount && t('editor.test.flagged', { count: test.flaggedCount })}
        {t('editor.test.nothingWritten')}
      </p>
      {test.steps
        .filter((s) => s.type === 'join' && s.rowsIn > 0)
        .map((s) => (
          <p key={s.id} className="text-xs text-muted-foreground tabular-nums">
            {t('editor.test.join', { step: localizeStepTitle(s.label, t), matched: s.matched ?? 0, count: s.rowsIn })}
            {!!s.multiplied && t('editor.test.joinMultiplied', { count: s.multiplied })}
            {!!s.staged && t('editor.test.joinSample', { staged: s.staged })}
          </p>
        ))}
      {test.rejects.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {test.rejects.slice(0, 8).map((r, k) => (
            <li key={k}>
              <span className={cn('font-medium', r.kind === 'flag' ? 'text-warning-text' : r.kind === 'approval' ? 'text-held-text' : 'text-danger-text')}>
                {r.kind === 'flag' ? severity(r.severity) : r.kind === 'approval' ? t('editor.test.kindApproval') : t('editor.test.kindError')}
              </span>
              : {r.errors.map((m) => localizeCheck(m, locale)).join('; ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SettingsSection({ settings, onChange }: { settings: PipelineSettings; onChange: (patch: Partial<PipelineSettings>) => void }) {
  const { t, formatNumber } = usePrefs()
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
        <BellRing className="size-4 text-muted-foreground" aria-hidden /> {t('editor.settings.title')}
      </h3>
      <div className="grid gap-3 md:grid-cols-4">
        {label(
          t('editor.settings.retries'),
          <NativeSelect value={String(settings.retries)} onChange={(v) => onChange({ retries: Number(v) })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t('editor.settings.noRetries') : t('editor.settings.retriesCount', { count: n })}
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          t('editor.settings.firstRetry'),
          <NativeSelect value={String(settings.retryDelaySeconds)} onChange={(v) => onChange({ retryDelaySeconds: Number(v) })} disabled={!settings.retries}>
            {[5, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {t('editor.settings.seconds', { count: n })}
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          t('editor.settings.timeout'),
          <NativeSelect value={String(settings.timeoutMinutes)} onChange={(v) => onChange({ timeoutMinutes: Number(v) })}>
            {[15, 30, 60, 120, 240, 480, 1440].map((n) => (
              <option key={n} value={n}>
                {n < 60 ? t('editor.settings.minutes', { count: n }) : t('editor.settings.hours', { count: n / 60 })}
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          t('editor.settings.batchSize'),
          <NativeSelect value={String(settings.batchSize)} onChange={(v) => onChange({ batchSize: Number(v) })}>
            {[1000, 2500, 5000, 10000, 20000].map((n) => (
              <option key={n} value={n}>
                {formatNumber(n)}
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          t('editor.settings.maxError'),
          <NativeSelect value={settings.maxErrorPercent === null ? '' : String(settings.maxErrorPercent)} onChange={(v) => onChange({ maxErrorPercent: v === '' ? null : Number(v) })}>
            <option value="">{t('editor.settings.noLimit')}</option>
            {[1, 2, 5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
          </NativeSelect>,
        )}
        {label(
          t('editor.settings.alerts'),
          <NativeSelect value={settings.alertOn} onChange={(v) => onChange({ alertOn: v as PipelineSettings['alertOn'] })}>
            <option value="failure">{t('editor.settings.alertFailure')}</option>
            <option value="failure_or_rejects">{t('editor.settings.alertRejects')}</option>
            <option value="never">{t('editor.settings.alertNever')}</option>
          </NativeSelect>,
        )}
        <div className="md:col-span-2">
          {label(
            t('editor.settings.sendTo'),
            <Input
              value={emails}
              disabled={settings.alertOn === 'never'}
              placeholder={t('editor.settings.sendToPlaceholder')}
              onChange={(e) => {
                setEmails(e.target.value)
                onChange({ alertEmails: e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) })
              }}
            />,
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('editor.settings.retriesNote')}</p>
    </section>
  )
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

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
  const { t, formatDateTime } = usePrefs()
  const typeId = useId()
  const runTime = (d: Date) =>
    formatDateTime(d, { dateStyle: undefined, timeStyle: undefined, timeZone: schedule.timezone, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <section aria-label={t('editor.schedule.label')}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Label htmlFor={typeId} className="font-medium">
          {t('editor.schedule.label')}
        </Label>
        <NativeSelect id={typeId} className="w-40" value={schedule.type} onChange={(v) => onChange({ type: v as PipelineSchedule['type'] })}>
          <option value="manual">{t('editor.schedule.types.manual')}</option>
          <option value="hourly">{t('editor.schedule.types.hourly')}</option>
          <option value="daily">{t('editor.schedule.types.daily')}</option>
          <option value="weekly">{t('editor.schedule.types.weekly')}</option>
          <option value="monthly">{t('editor.schedule.types.monthly')}</option>
          <option value="cron">{t('editor.schedule.types.cron')}</option>
          <option value="after">{t('editor.schedule.types.after')}</option>
        </NativeSelect>
        {schedule.type === 'after' && (
          <>
            <NativeSelect className="w-56" value={schedule.afterPipelineId} onChange={(v) => onChange({ afterPipelineId: v })} aria-label={t('editor.schedule.runAfter')}>
              <option value="">{t('editor.schedule.choosePipeline')}</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.published ? '' : ` ${t('editor.schedule.notPublished')}`}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect className="w-56" value={schedule.afterOn} onChange={(v) => onChange({ afterOn: v as PipelineSchedule['afterOn'] })} aria-label={t('editor.schedule.whenOther')}>
              {AFTER_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o === 'success' ? t('editor.schedule.afterSuccess') : o === 'success_or_partial' ? t('editor.schedule.afterPartial') : t('editor.schedule.afterAny')}
                </option>
              ))}
            </NativeSelect>
          </>
        )}
        {schedule.type === 'hourly' && (
          <label className="flex items-center gap-2 text-sm">
            {t('editor.schedule.atMinute')}
            <Input type="number" min={0} max={59} className="w-20 font-mono" value={schedule.minute} onChange={(e) => onChange({ minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })} />
          </label>
        )}
        {['daily', 'weekly', 'monthly'].includes(schedule.type) && (
          <label className="flex items-center gap-2 text-sm">
            {t('editor.schedule.at')}
            <Input type="time" className="w-32 font-mono" value={schedule.time} onChange={(e) => e.target.value && onChange({ time: e.target.value })} />
            WIB
          </label>
        )}
        {schedule.type === 'monthly' && (
          <label className="flex items-center gap-2 text-sm">
            {t('editor.schedule.onDay')}
            <Input type="number" min={1} max={28} className="w-20 font-mono" value={schedule.dayOfMonth} onChange={(e) => onChange({ dayOfMonth: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })} />
          </label>
        )}
        {schedule.type === 'cron' && <Input className="w-48 font-mono" placeholder="0 1 * * 1-5" value={schedule.cron} onChange={(e) => onChange({ cron: e.target.value })} aria-label={t('editor.schedule.cron')} />}
        {schedule.type !== 'manual' && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
            {t('editor.schedule.enabled')}
          </label>
        )}
      </div>
      {schedule.type === 'weekly' && (
        <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label={t('editor.schedule.daysOfWeek')}>
          {DAY_KEYS.map((d, i) => {
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
                {t(`editor.schedule.days.${d}`)}
              </button>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {describeScheduleT(schedule, t)}
        {schedule.type !== 'manual' &&
          schedule.type !== 'after' &&
          ` · ${upcoming.length ? t('editor.schedule.next', { times: upcoming.map(runTime).join(' · ') }) : t('editor.schedule.invalid')}`}
        {schedule.type === 'after' && schedule.afterPipelineId && ` (${pipelines.find((p) => p.id === schedule.afterPipelineId)?.name ?? t('editor.schedule.missingPipeline')})`}
        {schedule.type !== 'manual' && !enabled && ` · ${t('editor.schedule.disabled')}`}
        {schedule.type !== 'manual' && !published && ` · ${t('editor.schedule.startsOnPublish')}`}. {t('editor.schedule.publishedOnly')}
      </p>
    </section>
  )
}

/** Inbound webhook trigger (SC-1): a secret URL that starts this pipeline from another system. */
function WebhookTrigger({ pipelineId, exists, onChange }: { pipelineId?: string; exists: boolean; onChange: (exists: boolean) => void }) {
  const t = useT()
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
      setError(err instanceof Error ? err.message : t('editor.webhook.failed'))
    } finally {
      setBusy(false)
    }
  }
  const create = async () => {
    if (!pipelineId) return
    if (exists && !(await confirm({ title: t('editor.webhook.newTitle'), description: t('editor.webhook.newBody'), confirmLabel: t('editor.webhook.newConfirm'), tone: 'danger' }))) return
    await act(async () => {
      setUrl((await createWebhookTrigger(pipelineId)).url)
      onChange(true)
    })
  }
  const turnOff = async () => {
    if (!pipelineId) return
    if (!(await confirm({ title: t('editor.webhook.offTitle'), description: t('editor.webhook.offBody'), confirmLabel: t('editor.webhook.turnOff'), tone: 'danger' }))) return
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
        {t('editor.webhook.title')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('editor.webhook.body')}</p>
      {!pipelineId ? (
        <p className="text-xs text-muted-foreground">{t('editor.webhook.saveFirst')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void create()}>
            {exists ? t('editor.webhook.createNew') : t('editor.webhook.create')}
          </Button>
          {exists && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void turnOff()}>
              {t('editor.webhook.turnOff')}
            </Button>
          )}
          {exists && !url && <span className="text-xs text-muted-foreground">{t('editor.webhook.exists')}</span>}
        </div>
      )}
      {url && (
        <Notice tone="warning" title={t('editor.webhook.copyNow')}>
          <div className="mt-1 space-y-1">
            <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={t('editor.webhook.url')} />
            <div className="font-mono text-xs text-muted-foreground">curl -X POST &quot;{url.slice(0, 48)}…&quot;</div>
          </div>
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  )
}

export function SampleTable({ rows }: { rows: Record<string, unknown>[] }) {
  const t = useT()
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter((c) => !c.startsWith('_nexus_')).slice(0, 20)
  const show = (v: unknown) => (v === null || v === undefined ? '∅' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border" tabIndex={0} role="region" aria-label={t('editor.sample.label')}>
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
