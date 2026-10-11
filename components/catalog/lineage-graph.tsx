'use client'

import { useEffect, useMemo, useState } from 'react'
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BarChart3, Database, Loader2, Server, Share2, Upload, Workflow } from 'lucide-react'
import { getLineage } from '@/lib/actions/catalog'
import type { LineageGraph, LineageKind, LineageNode } from '@/lib/catalog/lineage'

const KIND: Record<LineageKind, { icon: typeof Database; label: string }> = {
  source_table: { icon: Server, label: 'Source table' },
  pipeline: { icon: Workflow, label: 'Pipeline' },
  dataset: { icon: Database, label: 'Dataset' },
  destination_table: { icon: Upload, label: 'Written to' },
  dashboard: { icon: BarChart3, label: 'Dashboard' },
  entity: { icon: Share2, label: 'Data API entity' },
}

type Data = { node: LineageNode; focus: boolean; clickable: boolean }

function LineageCard({ data }: NodeProps<Node<Data>>) {
  const { node, focus, clickable } = data
  const Icon = KIND[node.kind].icon
  return (
    <div className={`w-48 rounded-lg border bg-card px-3 py-2 text-left shadow-sm ${focus ? 'border-primary ring-2 ring-primary/30' : 'border-border'} ${clickable ? 'cursor-pointer hover:border-primary/60' : ''}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-muted-foreground" isConnectable={false} />
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden /> {KIND[node.kind].label}
      </div>
      <div className="truncate font-mono text-xs font-medium" title={node.label}>{node.label}</div>
      <div className="truncate text-[11px] text-muted-foreground" title={node.detail}>{node.detail}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-muted-foreground" isConnectable={false} />
    </div>
  )
}
const nodeTypes = { lineage: LineageCard }

/** Where an item's data comes from and where it goes (DC-4). Click a dataset or source table to open it. */
export function LineageView({ catalogKey, onOpen }: { catalogKey: string; onOpen: (key: string) => void }) {
  const [graph, setGraph] = useState<LineageGraph | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setGraph(null)
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
    const edges: Edge[] = graph.edges.map((e) => ({ id: `${e.from}>${e.to}`, source: e.from, target: e.to, animated: false }))
    return { nodes, edges, height: Math.max(220, Math.min(420, maxRows * 84 + 60)) }
  }, [graph])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!graph) return <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading lineage…</p>
  if (graph.nodes.length <= 1) return <p className="text-sm text-muted-foreground">No pipelines, dashboards or API entities use this yet.</p>

  return (
    <div>
      <div className="rounded-md border border-border" style={{ height }} aria-label="Lineage graph">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesConnectable={false}
          elementsSelectable={false}
          colorMode="system"
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => n.data.clickable && n.data.node.catalogKey && onOpen(n.data.node.catalogKey)}
          style={{ minHeight: 160 }}
        >
          <Background gap={20} />
        </ReactFlow>
      </div>
      {/* Text version of the graph for screen readers and copy-paste. */}
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer">List view</summary>
        <ul className="mt-1 list-disc pl-5">
          {graph.edges.map((e) => {
            const from = graph.nodes.find((n) => n.id === e.from)
            const to = graph.nodes.find((n) => n.id === e.to)
            return (
              <li key={`${e.from}>${e.to}`}>
                {from ? `${KIND[from.kind].label} ${from.label}` : e.from} → {to ? `${KIND[to.kind].label} ${to.label}` : e.to}
              </li>
            )
          })}
        </ul>
      </details>
    </div>
  )
}
