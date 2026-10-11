import { DOMAIN_BY_NAME } from '@/lib/domain/model'
import type { PipelineDefinition } from '@/lib/pipelines/definition'
import { datasetKey, sourceKey } from './definition'

/**
 * Lineage (DC-4): which source tables feed which pipelines, which datasets and
 * external tables they write, and who consumes those datasets (dashboards,
 * Data API entities, pipelines chained after them). Pure; covered by
 * scripts/engine-tests.ts.
 */

export type LineageKind = 'source_table' | 'pipeline' | 'dataset' | 'destination_table' | 'dashboard' | 'entity'

export interface LineageNode {
  id: string
  kind: LineageKind
  label: string
  detail: string
  /** Columns left (negative, upstream) or right (positive, downstream) of the focus. */
  depth: number
  /** Catalog key, when the node is a catalog item. */
  catalogKey?: string
}

export interface LineageGraph {
  focus: string
  nodes: LineageNode[]
  edges: { from: string; to: string }[]
}

export interface LineageInput {
  sources: { id: string; name: string }[]
  pipelines: { id: string; name: string; definition: PipelineDefinition; after: string | null }[]
  dashboards: { id: string; name: string; datasets: string[] }[]
  entities: { entity: string; datasetName: string }[]
}

const MAX_DEPTH = 4

export function buildLineage(focus: string, input: LineageInput, maxDepth = MAX_DEPTH): LineageGraph {
  const nodes = new Map<string, Omit<LineageNode, 'depth'>>()
  const edges: { from: string; to: string }[] = []
  const sourceName = (id: string) => input.sources.find((s) => s.id === id)?.name ?? 'missing source'
  const add = (n: Omit<LineageNode, 'depth'>) => (nodes.has(n.id) ? undefined : nodes.set(n.id, n), n.id)
  const link = (from: string, to: string) => edges.push({ from, to })

  for (const p of input.pipelines) {
    const pid = add({ id: `pipeline:${p.id}`, kind: 'pipeline', label: p.name, detail: 'pipeline' })!
    for (const n of p.definition.nodes) {
      if (n.type === 'source' && n.dataSourceId) {
        const key = sourceKey(n.dataSourceId, n.table)
        link(add({ id: key, kind: 'source_table', label: n.table, detail: sourceName(n.dataSourceId), catalogKey: key }) ?? key, pid)
      }
      if (n.type === 'destination') {
        if (n.kind === 'dataset') {
          const key = datasetKey(n.datasetName)
          link(pid, add({ id: key, kind: 'dataset', label: n.datasetName, detail: 'Nexus dataset', catalogKey: key }) ?? key)
        } else if (n.dataSourceId) {
          const id = `dest:${n.dataSourceId}:${n.table}`
          link(pid, add({ id, kind: 'destination_table', label: n.table, detail: `written to ${sourceName(n.dataSourceId)}` }) ?? id)
        }
      }
    }
    if (p.after) link(`pipeline:${p.after}`, pid)
  }
  for (const d of input.dashboards) {
    const id = add({ id: `dashboard:${d.id}`, kind: 'dashboard', label: d.name, detail: 'dashboard' })!
    for (const ds of d.datasets) {
      const key = datasetKey(ds)
      add({ id: key, kind: 'dataset', label: ds, detail: 'Nexus dataset', catalogKey: key })
      link(key, id)
    }
  }
  for (const e of input.entities) {
    const id = add({ id: `entity:${e.entity}`, kind: 'entity', label: DOMAIN_BY_NAME.get(e.entity)?.label ?? e.entity, detail: `Data API /domains/${e.entity}` })!
    const key = datasetKey(e.datasetName)
    add({ id: key, kind: 'dataset', label: e.datasetName, detail: 'Nexus dataset', catalogKey: key })
    link(key, id)
  }

  // Walk upstream and downstream from the focus, recording each node's distance.
  const depth = new Map<string, number>()
  if (!nodes.has(focus)) return { focus, nodes: [], edges: [] }
  depth.set(focus, 0)
  const walk = (dir: 1 | -1) => {
    let frontier = [focus]
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const e of edges) {
          const other = dir === 1 ? (e.from === id ? e.to : null) : e.to === id ? e.from : null
          if (other && !depth.has(other)) {
            depth.set(other, dir * d)
            next.push(other)
          }
        }
      }
      frontier = next
    }
  }
  walk(1)
  walk(-1)
  const keep = new Set(depth.keys())
  const seen = new Set<string>()
  return {
    focus,
    nodes: [...keep].map((id) => ({ ...nodes.get(id)!, depth: depth.get(id)! })),
    edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to) && !seen.has(`${e.from}>${e.to}`) && (seen.add(`${e.from}>${e.to}`), true)),
  }
}
