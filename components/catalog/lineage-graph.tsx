'use client'

import { useEffect, useMemo, useState } from 'react'
import { Background, BackgroundVariant, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BarChart3, Database, GitFork, Loader2, Server, Share2, Upload, Workflow } from 'lucide-react'
import { getLineage } from '@/lib/actions/catalog'
import type { LineageGraph, LineageKind, LineageNode } from '@/lib/catalog/lineage'
import { cn } from '@/lib/utils'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { usePrefs } from '@/components/i18n/i18n-provider'

/*
 * Lineage as a single-line diagram: square nodes on 2px lines. The node's
 * border names its kind (sources info blue, datasets live teal, destinations
 * held purple; pipelines, dashboards and API entities neutral), and every node
 * also says its kind in words.
 */
const KIND: Record<LineageKind, { icon: typeof Database; label: string; border: string }> = {
  source_table: { icon: Server, label: 'Source table', border: 'border-info' },
  pipeline: { icon: Workflow, label: 'Pipeline', border: 'border-paused' },
  dataset: { icon: Database, label: 'Dataset', border: 'border-live' },
  destination_table: { icon: Upload, label: 'Written to', border: 'border-held' },
  dashboard: { icon: BarChart3, label: 'Dashboard', border: 'border-paused' },
  entity: { icon: Share2, label: 'Data API entity', border: 'border-paused' },
}

const LINE = 'var(--muted-foreground)'
const handleStyle = { width: 6, height: 6, borderRadius: 1, border: 0, background: LINE }

type Data = { node: LineageNode; focus: boolean; clickable: boolean }

function LineageCard({ data }: NodeProps<Node<Data>>) {
  const { node, focus, clickable } = data
  const Icon = KIND[node.kind].icon
  return (
    <div
      className={cn(
        'w-48 rounded-sm border-2 bg-card px-3 py-2 text-left',
        KIND[node.kind].border,
        focus && 'bg-accent text-accent-foreground outline-2 outline-offset-2 outline-ring',
        clickable && 'cursor-pointer hover:bg-muted'
      )}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} isConnectable={false} />
      <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        <Icon className="h-3 w-3" aria-hidden /> {KIND[node.kind].label}
        {focus && <span className="ml-auto normal-case">this item</span>}
      </div>
      <div className="truncate font-mono text-xs font-medium" title={node.label}>{node.label}</div>
      <div className="truncate text-[11px] text-muted-foreground" title={node.detail}>{node.detail}</div>
      <Handle type="source" position={Position.Right} style={handleStyle} isConnectable={false} />
    </div>
  )
}
const nodeTypes = { lineage: LineageCard }

/** Where an item's data comes from and where it goes (DC-4). Click a dataset or source table to open it. */
export function LineageView({ catalogKey, onOpen }: { catalogKey: string; onOpen: (key: string) => void }) {
  const { theme } = usePrefs()
  const [graph, setGraph] = useState<LineageGraph | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setGraph(null)
    setError('')
    getLineage(catalogKey)
      .then((g) => !cancelled && setGraph(g))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load lineage'))
    return () => {
      cancelled = true
    }
  }, [catalogKey])

  const { nodes, edges, height } = useMemo(() => {
    if (!graph) return { nodes: [], edges: [], height: 0 }
    // Columns by distance from the focus; rows in order within a column.
    const byDepth = new Map<number, LineageNode[]>()
    for (const n of graph.nodes) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n])
    const maxRows = Math.max(1, ...[...byDepth.values()].map((c) => c.length))
    const minDepth = Math.min(0, ...graph.nodes.map((n) => n.depth))
    const nodes: Node<Data>[] = [...byDepth.entries()].flatMap(([d, col]) =>
      col.map((n, i) => ({
        id: n.id,
        type: 'lineage',
        position: { x: (d - minDepth) * 240, y: i * 84 + ((maxRows - col.length) * 84) / 2 },
        data: { node: n, focus: n.id === graph.focus, clickable: Boolean(n.catalogKey) && n.id !== graph.focus },
        draggable: false,
        selectable: false,
      }))
    )
    const edges: Edge[] = graph.edges.map((e) => ({
      id: `${e.from}>${e.to}`,
      source: e.from,
      target: e.to,
      type: 'step',
      animated: false,
      style: { stroke: LINE, strokeWidth: 2 },
    }))
    return { nodes, edges, height: Math.max(220, Math.min(420, maxRows * 84 + 60)) }
  }, [graph])

  if (error) return <Notice tone="danger">{error}</Notice>
  if (!graph)
    return (
      <p className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading lineage…
      </p>
    )
  if (graph.nodes.length <= 1)
    return (
      <EmptyState compact icon={<GitFork />} title="No lineage yet">
        No pipelines, dashboards or API entities use this yet.
      </EmptyState>
    )

  const labelOf = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id)
    if (!n) return id
    const text = `${KIND[n.kind].label} ${n.label}`
    return n.catalogKey && n.id !== graph.focus ? (
      <button
        type="button"
        className="rounded-sm font-medium text-info-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={() => onOpen(n.catalogKey!)}
      >
        {text}
      </button>
    ) : (
      text
    )
  }

  return (
    <div>
      <div className="rounded-md border border-border bg-card" style={{ height }} role="figure" aria-label="Lineage graph; the list view below has the same links">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          colorMode={theme}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => n.data.clickable && n.data.node.catalogKey && onOpen(n.data.node.catalogKey)}
          style={{ minHeight: 160, background: 'transparent' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} color="var(--border)" />
        </ReactFlow>
      </div>
      {/* Text version of the graph for screen readers, keyboards and copy-paste. */}
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">List view</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {graph.edges.map((e) => (
            <li key={`${e.from}>${e.to}`}>
              {labelOf(e.from)} → {labelOf(e.to)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
