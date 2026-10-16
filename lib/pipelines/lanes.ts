import type { JoinStep, PipelineNode, SourceStep } from './definition'

/**
 * Lanes (several sources). Pure and client-safe; covered by
 * scripts/engine-tests.ts.
 *
 * Every Source starts a lane: the source plus the steps its rows flow through.
 * Lanes meet in a Join (the right side is looked up) or a Union (rows stacked).
 * The driver streams in chunks. A lane that ends at the right side of a Join is
 * staged: read in full first, through its own steps, into a run staging table.
 * Other lanes that reach the Destinations (Union partners) stream after the
 * driver, one after another. A run therefore has phases: stage every Join's
 * right side (dependencies first), then stream the streamed lanes.
 *
 * Only value imports from nothing in ./definition: definition.ts validates with
 * planLanes, so this module must not depend on it at load time.
 */

type GraphNode = PipelineNode
type GraphEdge = { from: string; to: string; port?: string }
type Graph = { nodes: GraphNode[]; edges: GraphEdge[] }

export interface StagedJoin {
  id: string
  /** Steps whose rows arrive at the left (driving) and right (staged) ports. */
  leftFrom: string
  rightFrom: string
  /** Sources whose lanes end at the right port, read one after another to fill the staging table. */
  sources: string[]
}

export interface LanePlan {
  /** The streaming Source (the only one, or the one marked as driver). */
  driver: string | null
  /** Every Source, in step order. */
  sources: string[]
  /** Sources streamed to the Destinations, driver first. */
  streamed: string[]
  /** Joins in staging order (a Join inside a staged lane comes before the Join it feeds). */
  joins: StagedJoin[]
  /** Per step: the lanes (source ids) whose rows reach it on the driving side. A Join passes on its left lanes only. */
  lanes: Map<string, Set<string>>
  /** Per source: where its rows end up: 'stream' (Destinations) or `join:<id>` (a Join's right side). */
  targets: Map<string, Set<string>>
  issues: string[]
}

export const STREAM = 'stream'
const portOf = (e: GraphEdge) => e.port ?? ''

function topo(g: Graph): GraphNode[] | null {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]))
  for (const e of g.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const queue = g.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  const order: GraphNode[] = []
  while (queue.length) {
    const id = queue.shift()!
    const n = byId.get(id)
    if (n) order.push(n)
    for (const e of g.edges) {
      if (e.from !== id) continue
      indeg.set(e.to, (indeg.get(e.to) ?? 0) - 1)
      if (indeg.get(e.to) === 0) queue.push(e.to)
    }
  }
  return order.length === g.nodes.length ? order : null
}

const title = (n: GraphNode | undefined) => (n?.type === 'source' ? `Read ${n.table || 'source'}` : n?.type === 'join' ? `Join on ${n.keys.map((k) => k.left).filter(Boolean).join(', ') || 'keys'}` : (n?.id ?? 'step'))

export function planLanes(def: Graph): LanePlan {
  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  const sources = def.nodes.filter((n): n is SourceStep => n.type === 'source')
  const issues: string[] = []
  const order = topo(def) ?? def.nodes

  const lanes = new Map<string, Set<string>>()
  for (const n of order) {
    const set = new Set<string>()
    if (n.type === 'source') set.add(n.id)
    for (const e of def.edges) if (e.to === n.id && portOf(e) !== 'right') for (const s of lanes.get(e.from) ?? []) set.add(s)
    lanes.set(n.id, set)
  }

  const targets = new Map<string, Set<string>>()
  for (const s of sources) {
    const found = new Set<string>()
    const seen = new Set([s.id])
    const stack = [s.id]
    while (stack.length) {
      const id = stack.pop()!
      if (byId.get(id)?.type === 'destination') found.add(STREAM)
      for (const e of def.edges) {
        if (e.from !== id) continue
        if (portOf(e) === 'right') found.add(`join:${e.to}`)
        else if (!seen.has(e.to)) (seen.add(e.to), stack.push(e.to))
      }
    }
    targets.set(s.id, found)
  }

  let driver: string | null = null
  if (sources.length === 1) driver = sources[0].id
  else if (sources.length > 1) {
    const marked = sources.filter((s) => s.driver)
    if (!marked.length) issues.push('Mark one Source as the driver: it streams in chunks; the other sources are looked up or added after it.')
    else if (marked.length > 1) issues.push('Only one Source can be the driver.')
    driver = marked[0]?.id ?? null
  }

  for (const s of sources) {
    const t = targets.get(s.id)!
    if (!t.size) issues.push(`"${title(s)}" doesn't lead to a Destination or a Join.`)
    else if (t.size > 1) issues.push(`"${title(s)}" feeds more than one place. Each lane ends at the Destinations or at the right side of one Join; add another Source for the same table to use it twice.`)
    if (s.id === driver && t.size && !t.has(STREAM)) issues.push('The driver Source must lead to a Destination, not into the right side of a Join.')
  }

  const joins: StagedJoin[] = []
  for (const n of order) {
    if (n.type !== 'join') continue
    const left = def.edges.filter((e) => e.to === n.id && portOf(e) === 'left')
    const right = def.edges.filter((e) => e.to === n.id && portOf(e) === 'right')
    if (left.length !== 1 || right.length !== 1) {
      issues.push(`${title(n)}: connect exactly one input to each side (left and right).`)
      continue
    }
    const l = lanes.get(left[0].from) ?? new Set()
    const r = lanes.get(right[0].from) ?? new Set()
    if ([...l].some((s) => r.has(s))) issues.push(`${title(n)}: both sides come from the same Source. A Join combines two different lanes.`)
    joins.push({ id: n.id, leftFrom: left[0].from, rightFrom: right[0].from, sources: sources.filter((s) => targets.get(s.id)?.has(`join:${n.id}`)).map((s) => s.id) })
  }

  const streamed = [...(driver ? [driver] : []), ...sources.filter((s) => s.id !== driver && targets.get(s.id)?.has(STREAM)).map((s) => s.id)]
  return { driver, sources: sources.map((s) => s.id), streamed, joins, lanes, targets, issues }
}

const cache = new WeakMap<object, LanePlan>()
/** planLanes, remembered per (parsed, unchanging) definition object. */
export function lanePlan(def: Graph): LanePlan {
  let plan = cache.get(def)
  if (!plan) cache.set(def, (plan = planLanes(def)))
  return plan
}

/**
 * Steps one pass touches when rows enter at `startId` (a Source, or the step a
 * quarantined row replays from): everything downstream, stopping at the right
 * side of a Join (that Join is included; its right input is staged there).
 */
export function passNodes(def: Graph, startId: string): Set<string> {
  const out = new Set([startId])
  const stack = [startId]
  while (stack.length) {
    const id = stack.pop()!
    for (const e of def.edges) {
      if (e.from !== id || out.has(e.to)) continue
      out.add(e.to)
      if (portOf(e) !== 'right') stack.push(e.to)
    }
  }
  return out
}

/** True when the step only carries rows that end up staged (a lane that feeds a Join's right side). */
export function isStagedStep(plan: LanePlan, nodeId: string): boolean {
  const lanes = [...(plan.lanes.get(nodeId) ?? [])]
  // Not yet connected anywhere (no targets) isn't staged either.
  return lanes.length > 0 && lanes.every((s) => (plan.targets.get(s)?.size ?? 0) > 0 && !plan.targets.get(s)?.has(STREAM))
}

/** A lane's name: the table of its Source when one lane reaches the step, else the step id. */
export function laneLabel(def: Graph, plan: LanePlan, nodeId: string): string {
  const lanes = [...(plan.lanes.get(nodeId) ?? [])]
  const src = lanes.length === 1 ? def.nodes.find((n) => n.id === lanes[0]) : undefined
  return src?.type === 'source' && src.table ? src.table : nodeId
}

/** Prefix for right columns whose name the left row already has: the step's own, else "<right table>_". */
export function joinPrefix(def: Graph, plan: LanePlan, join: JoinStep): string {
  if (join.prefix) return join.prefix
  const staged = plan.joins.find((j) => j.id === join.id)
  const name = staged ? laneLabel(def, plan, staged.rightFrom) : 'right'
  const clean = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'right'
  return `${/^[a-z_]/.test(clean) ? clean : `r_${clean}`}_`
}

/** The value a Union writes into its source column for rows arriving from `fromId`. */
export function unionLabel(def: Graph, plan: LanePlan, union: { labels: { from: string; label: string }[] }, fromId: string): string {
  return union.labels.find((l) => l.from === fromId)?.label.trim() || laneLabel(def, plan, fromId)
}
