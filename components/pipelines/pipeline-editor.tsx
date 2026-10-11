'use client'

import { useCallback, useMemo, useState } from 'react'
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
import { BellRing, Database, Filter, FlaskConical, GitBranch, Link2, Loader2, Rocket, Save, Scale, ShieldCheck, Shuffle, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import type { EngineResult, StepStat } from '@/lib/pipelines/engine'
import { savePipeline, testPipeline } from '@/lib/actions/pipelines'
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

type NodeData = { node: PipelineNode; stat?: StepStat; invalid: boolean }

function NexusNode({ data, selected }: NodeProps<FlowNode<NodeData>>) {
  const { node, stat } = data
  const meta = META[node.type]
  const Icon = meta.icon
  const handles = node.type === 'router' ? [...node.branches.map((b) => ({ id: b.id, label: b.label })), { id: OTHERWISE, label: 'otherwise' }] : node.type === 'destination' ? [] : [{ id: '', label: '' }]
  return (
    <div className={`w-52 rounded-lg border bg-card text-card-foreground shadow-sm ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}>
      {node.type !== 'source' && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-background !bg-muted-foreground" />}
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="truncate text-sm font-medium">{meta.title}</span>
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground">
        <div className="truncate" title={stepTitle(node)}>{stepTitle(node)}</div>
        {stat && (
          <div className="mt-1 flex flex-wrap gap-1">
            {stat.error ? (
              <Badge variant="destructive">failed</Badge>
            ) : (
              <>
                <Badge variant="secondary">{stat.rowsOut} out</Badge>
                {stat.rejected > 0 && <Badge variant="destructive">{stat.rejected} held</Badge>}
                {!!stat.flagged && <Badge variant="outline">{stat.flagged} flagged</Badge>}
              </>
            )}
          </div>
        )}
      </div>
      {handles.length === 1 && !handles[0].id ? (
        <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-background !bg-primary" />
      ) : (
        handles.map((h, i) => (
          <div key={h.id} className="relative border-t border-border/60 px-3 py-1 text-right text-[11px] text-muted-foreground">
            {h.label}
            <Handle id={h.id} type="source" position={Position.Right} style={{ top: '50%' }} className={`!h-3 !w-3 !border-2 !border-background ${i === handles.length - 1 ? '!bg-muted-foreground' : '!bg-primary'}`} />
          </div>
        ))
      )}
    </div>
  )
}
const nodeTypes = { nexus: NexusNode }

export default function PipelineEditor({ initial, options, onClose, onSaved }: { initial: EditablePipeline; options: BuilderOptions; onClose: () => void; onSaved: (id: string) => void }) {
  const [draft, setDraft] = useState<EditablePipeline>(initial)
  const [selectedId, setSelectedId] = useState<string | null>(initial.nodes[0]?.id ?? null)
  const [tab, setTab] = useState<'settings' | 'schedule' | 'test'>('test')
  const [saving, setSaving] = useState<null | 'draft' | 'publish'>(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [test, setTest] = useState<EngineResult | null>(null)

  const definition = { nodes: draft.nodes, edges: draft.edges, settings: draft.settings }
  const columns = useMemo(() => columnsPerNode(draft.nodes, draft.edges, options), [draft.nodes, draft.edges, options])
  const validation = useMemo(() => definitionSchema.safeParse({ schemaVersion: 2, ...definition }), [draft.nodes, draft.edges, draft.settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const scheduleCheck = useMemo(() => scheduleSchema.safeParse(draft.schedule), [draft.schedule])
  const upcoming = useMemo(() => (scheduleCheck.success ? nextRunTimes(scheduleCheck.data, 3) : []), [scheduleCheck])
  const selected = draft.nodes.find((n) => n.id === selectedId) ?? null
  const statFor = useCallback((id: string) => test?.steps.find((s) => s.id === id), [test])

  const flowNodes: FlowNode<NodeData>[] = draft.nodes.map((n) => ({ id: n.id, type: 'nexus', position: n.position, selected: n.id === selectedId, deletable: n.type !== 'source', data: { node: n, stat: statFor(n.id), invalid: false } }))
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
    setSaving(publish ? 'publish' : 'draft')
    try {
      const { id } = await savePipeline({ id: draft.id, name: draft.name, description: draft.description, definition, schedule: draft.schedule, enabled: draft.enabled, changeNote: changeNote || undefined, publish })
      onSaved(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  const outgoing = selected ? draft.edges.filter((e) => e.from === selected.id) : []
  const targets = draft.nodes.filter((n) => selected && n.id !== selected.id && n.type !== 'source')
  const [linkTo, setLinkTo] = useState('')
  const [linkBranch, setLinkBranch] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:p-3" role="dialog" aria-modal="true" aria-label="Pipeline editor">
      <div className="flex w-full max-w-[1500px] flex-col overflow-hidden border border-border bg-card sm:rounded-xl">
        <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Input value={draft.name} placeholder="Pipeline name, e.g. Employee Sync" onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-64 font-medium" aria-label="Pipeline name" />
          <Input value={draft.description} placeholder="Description (optional)" onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="min-w-[180px] flex-1" aria-label="Description" />
          {draft.id && (
            <Badge variant="outline">
              {draft.publishedVersion ? `published v${draft.publishedVersion}` : 'never published'}
              {draft.draftVersion ? ` · draft v${draft.draftVersion}` : ''}
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close editor">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[150px_1fr_380px]">
          <aside className="flex gap-1 overflow-x-auto border-b border-border p-2 lg:flex-col lg:border-b-0 lg:border-r" aria-label="Add a step">
            <div className="hidden px-1 pb-1 text-xs font-medium text-muted-foreground lg:block">Add after the selected step</div>
            {ADDABLE.map((t) => {
              const Icon = META[t].icon
              return (
                <Button key={t} size="sm" variant="outline" className="justify-start" onClick={() => addNode(t)} title={META[t].hint}>
                  <Icon className="mr-1.5 h-4 w-4" /> {META[t].title}
                </Button>
              )
            })}
          </aside>

          <div className="relative min-h-[360px]" aria-label="Pipeline canvas: drag steps, connect handles left to right">
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onPaneClick={() => setSelectedId(null)}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              colorMode="system"
              deleteKeyCode={['Delete', 'Backspace']}
              proOptions={{ hideAttribution: true }}
              style={{ minHeight: 360 }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable className="!hidden md:!block" />
            </ReactFlow>
          </div>

          <aside className="min-h-0 overflow-y-auto border-t border-border p-3 lg:border-l lg:border-t-0" aria-label="Step settings">
            {!selected ? (
              <p className="text-sm text-muted-foreground">Select a step on the canvas to configure it. Drag from a step&apos;s right handle to another step&apos;s left handle to connect them; select a connection and press Delete to remove it.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = META[selected.type].icon
                    return <Icon className="h-4 w-4 text-primary" aria-hidden />
                  })()}
                  <h3 className="flex-1 font-medium">{META[selected.type].title}</h3>
                  {selected.type !== 'source' && (
                    <Button size="sm" variant="ghost" onClick={() => removeNode(selected.id)} aria-label="Delete step">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {selected.type === 'source' && <SourceEditor step={selected} options={options} onChange={setNode} />}
                {selected.type === 'filter' && <FilterEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} onChange={setNode} />}
                {selected.type === 'map' && <MapEditor step={selected} columns={columns.get(selected.id) ?? []} onChange={setNode} />}
                {selected.type === 'validate' && <ValidateEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} onChange={setNode} />}
                {selected.type === 'rules' && <RulesEditor step={selected} options={options} onChange={setNode} />}
                {selected.type === 'router' && <RouterEditor step={selected} columns={columns.get(selected.id) ?? []} options={options} onChange={setNode} />}
                {selected.type === 'destination' && <DestinationEditor step={selected} options={options} columns={columns.get(selected.id) ?? []} onChange={setNode} />}

                {statFor(selected.id)?.error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{statFor(selected.id)?.error}</p>}
                {!!statFor(selected.id)?.sample?.length && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Rows after this step (last test)</div>
                    <SampleTable rows={statFor(selected.id)!.sample!} />
                  </div>
                )}

                {selected.type !== 'destination' && (
                  <section className="space-y-2 rounded-md border border-border p-2" aria-label="Connections">
                    <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Link2 className="h-3.5 w-3.5" /> Next steps
                    </div>
                    {outgoing.length === 0 && <p className="text-xs text-muted-foreground">Not connected yet.</p>}
                    {outgoing.map((e) => {
                      const to = draft.nodes.find((n) => n.id === e.to)
                      const branch = selected.type === 'router' ? (e.branch === OTHERWISE ? 'otherwise' : selected.branches.find((b) => b.id === e.branch)?.label) : null
                      return (
                        <div key={e.id} className="flex items-center gap-2 text-sm">
                          <span className="flex-1 truncate">
                            {branch && <span className="text-muted-foreground">{branch} → </span>}
                            {to ? stepTitle(to) : e.to}
                          </span>
                          <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, edges: d.edges.filter((x) => x.id !== e.id) }))} aria-label="Remove connection">
                            <X className="h-4 w-4" />
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

        <div className="max-h-[38vh] overflow-y-auto border-t border-border">
          <div className="flex gap-1 border-b border-border px-3 pt-2" role="tablist">
            {(['test', 'settings', 'schedule'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-t-md px-3 py-1.5 text-sm ${tab === t ? 'border border-b-0 border-border bg-card font-medium' : 'text-muted-foreground'}`}
              >
                {t === 'test' ? 'Test results' : t === 'settings' ? 'Run settings' : 'Schedule'}
              </button>
            ))}
          </div>
          <div className="p-3">
            {tab === 'settings' && <SettingsSection settings={draft.settings} onChange={(patch) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }))} />}
            {tab === 'schedule' && <ScheduleSection schedule={draft.schedule} enabled={draft.enabled} upcoming={upcoming} published={Boolean(draft.publishedVersion)} onChange={setSchedule} onEnabled={(enabled) => setDraft({ ...draft, enabled })} />}
            {tab === 'test' && <TestSummary test={test} testing={testing} draft={draft} />}
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border p-3">
          {error ? <p className="mr-auto text-sm text-destructive" role="alert">{error}</p> : <p className="mr-auto text-xs text-muted-foreground">{validation.success ? 'Ready to test or save.' : describeDefinitionError(validation.error)}</p>}
          <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Change note (optional)" className="h-9 w-56" aria-label="Change note" />
          <Button variant="outline" onClick={runTest} disabled={testing || saving !== null}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
            Test on sample
          </Button>
          <Button variant="outline" onClick={() => void save(false)} disabled={saving !== null || testing}>
            {saving === 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save draft
          </Button>
          <Button onClick={() => void save(true)} disabled={saving !== null || testing}>
            {saving === 'publish' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
            Save &amp; publish
          </Button>
        </footer>
      </div>
    </div>
  )
}

function TestSummary({ test, testing, draft }: { test: EngineResult | null; testing: boolean; draft: EditablePipeline }) {
  if (testing) return <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Testing on a sample…</p>
  if (!test) return <p className="text-sm text-muted-foreground">Test on sample reads real rows, runs every step and writes nothing. Each step on the canvas then shows its row counts; select a step to see its rows.</p>
  if (test.error) return <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{test.error}</p>
  const destTotal = test.steps.filter((s) => s.type === 'destination').reduce((n, s) => n + s.rowsOut, 0)
  return (
    <div className="space-y-2 text-sm">
      {test.watermark && (
        <div className="text-xs text-muted-foreground">
          Incremental: reading rows after {draft.syncPosition ? `${test.watermark.column} > ${draft.syncPosition}` : 'the beginning (first sync)'}
          {test.watermark.value ? ` · a run would advance the position to ${test.watermark.value}` : ' · no new rows'}
        </div>
      )}
      <p>
        Read {test.rowsRead} rows; {destTotal} would be written
        {test.rejectedCount > 0 && `, ${test.rejectedCount} quarantined`}
        {!!test.heldCount && `, ${test.heldCount} held for approval`}
        {!!test.flaggedCount && `, ${test.flaggedCount} flagged`}. Nothing was written.
      </p>
      {test.rejects.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {test.rejects.slice(0, 8).map((r, k) => (
            <li key={k}>
              <span className={r.kind === 'flag' ? 'text-amber-700 dark:text-amber-300' : r.kind === 'approval' ? 'text-primary' : 'text-destructive'}>{r.kind === 'flag' ? r.severity : r.kind === 'approval' ? 'approval' : 'error'}</span>: {r.errors.join('; ')}
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
    <label className="text-sm">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{text}</span>
      {child}
    </label>
  )
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 font-medium">
        <BellRing className="h-4 w-4 text-primary" /> Retries, limits & alerts
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {label(
          'Retries on failure',
          <NativeSelect value={String(settings.retries)} onChange={(v) => onChange({ retries: Number(v) })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'No retries' : `${n} retr${n === 1 ? 'y' : 'ies'}`}
              </option>
            ))}
          </NativeSelect>
        )}
        {label(
          'First retry after',
          <NativeSelect value={String(settings.retryDelaySeconds)} onChange={(v) => onChange({ retryDelaySeconds: Number(v) })} disabled={!settings.retries}>
            {[5, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} seconds (then doubles)
              </option>
            ))}
          </NativeSelect>
        )}
        {label(
          'Timeout',
          <NativeSelect value={String(settings.timeoutMinutes)} onChange={(v) => onChange({ timeoutMinutes: Number(v) })}>
            {[15, 30, 60, 120, 240, 480, 1440].map((n) => (
              <option key={n} value={n}>
                {n < 60 ? `${n} minutes` : `${n / 60} hour${n === 60 ? '' : 's'}`}
              </option>
            ))}
          </NativeSelect>
        )}
        {label(
          'Batch size (rows per chunk)',
          <NativeSelect value={String(settings.batchSize)} onChange={(v) => onChange({ batchSize: Number(v) })}>
            {[1000, 2500, 5000, 10000, 20000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </NativeSelect>
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
          </NativeSelect>
        )}
        {label(
          'Email alerts',
          <NativeSelect value={settings.alertOn} onChange={(v) => onChange({ alertOn: v as PipelineSettings['alertOn'] })}>
            <option value="failure">When a run fails</option>
            <option value="failure_or_rejects">When it fails or quarantines rows</option>
            <option value="never">Never (bell only)</option>
          </NativeSelect>
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
            />
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
  onChange,
  onEnabled,
}: {
  schedule: PipelineSchedule
  enabled: boolean
  upcoming: Date[]
  published: boolean
  onChange: (patch: Partial<PipelineSchedule>) => void
  onEnabled: (v: boolean) => void
}) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="font-medium">Schedule</span>
        <NativeSelect className="w-40" value={schedule.type} onChange={(v) => onChange({ type: v as PipelineSchedule['type'] })} aria-label="Schedule type">
          <option value="manual">Manual only</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="cron">Cron expression</option>
        </NativeSelect>
        {schedule.type === 'hourly' && (
          <label className="flex items-center gap-2 text-sm">
            at minute
            <Input type="number" min={0} max={59} className="w-20" value={schedule.minute} onChange={(e) => onChange({ minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })} />
          </label>
        )}
        {['daily', 'weekly', 'monthly'].includes(schedule.type) && (
          <label className="flex items-center gap-2 text-sm">
            at
            <Input type="time" className="w-32" value={schedule.time} onChange={(e) => e.target.value && onChange({ time: e.target.value })} />
            WIB
          </label>
        )}
        {schedule.type === 'monthly' && (
          <label className="flex items-center gap-2 text-sm">
            on day
            <Input type="number" min={1} max={28} className="w-20" value={schedule.dayOfMonth} onChange={(e) => onChange({ dayOfMonth: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })} />
          </label>
        )}
        {schedule.type === 'cron' && <Input className="w-48 font-mono" placeholder="0 1 * * 1-5" value={schedule.cron} onChange={(e) => onChange({ cron: e.target.value })} aria-label="Cron expression" />}
        {schedule.type !== 'manual' && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
            Enabled
          </label>
        )}
      </div>
      {schedule.type === 'weekly' && (
        <div className="mb-3 flex flex-wrap gap-1">
          {days.map((d, i) => (
            <button
              key={d}
              onClick={() => onChange({ weekdays: schedule.weekdays.includes(i) ? schedule.weekdays.filter((x) => x !== i) : [...schedule.weekdays, i] })}
              aria-pressed={schedule.weekdays.includes(i)}
              className={`rounded-md border px-2 py-1 text-xs ${schedule.weekdays.includes(i) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {describeSchedule(schedule)}
        {schedule.type !== 'manual' && (upcoming.length ? ` · next: ${upcoming.map((d) => formatInTimezone(d, schedule.timezone)).join(' · ')}` : ' · invalid schedule')}
        {schedule.type !== 'manual' && !enabled && ' · disabled, will not run automatically'}
        {schedule.type !== 'manual' && !published && ' · schedules start once the pipeline is published'}
        . Scheduled runs always execute the published version.
      </p>
    </section>
  )
}

export function SampleTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter((c) => !c.startsWith('_nexus_')).slice(0, 20)
  const show = (v: unknown) => (v === null || v === undefined ? '∅' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">
              {cols.map((c) => (
                <td key={c} className="max-w-[220px] truncate whitespace-nowrap px-2 py-1 font-mono" title={show(r[c])}>
                  {show(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
