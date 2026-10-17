import type { PipelineDefinition, PipelineSchedule } from './definition'
import type { RuleBody } from '@/lib/rules/definition'

/**
 * Environment promotion (GV-7). Pure; covered by scripts/engine-tests.ts.
 *
 * Environments are workspaces in one group (dev → staging → prod), each with
 * its own data sources and credentials. Promoting a pipeline copies its
 * published definition to the next environment and swaps every reference to
 * a workspace object for the matching one there:
 *   data sources   by name and connector type (each environment holds its own credentials)
 *   business rules by name (created or updated in the target with the source's body)
 *   pipelines      ("run after", "run another pipeline") by promotion key, else name
 * Datasets are referenced by name already and need no mapping.
 */

export const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const
export type Environment = (typeof ENVIRONMENTS)[number]
export const ENVIRONMENT_INFO: Record<Environment, { label: string; short: string }> = {
  dev: { label: 'Development', short: 'DEV' },
  staging: { label: 'Staging', short: 'STAGING' },
  prod: { label: 'Production', short: 'PROD' },
}

export function isEnvironment(value: unknown): value is Environment {
  return typeof value === 'string' && (ENVIRONMENTS as readonly string[]).includes(value)
}

/** The stage a pipeline promotes into: the next environment present in the group. */
export function nextEnvironment(current: Environment, present: Environment[]): Environment | null {
  return ENVIRONMENTS.slice(ENVIRONMENTS.indexOf(current) + 1).find((e) => present.includes(e)) ?? null
}

export interface PromotionSide {
  dataSources: { id: string; name: string; sourceType: string }[]
  rules: { id: string; name: string; body: RuleBody }[]
  pipelines: { id: string; name: string; promotionKey: string | null }[]
}

export type MappingStatus = 'mapped' | 'missing' | 'create' | 'update' | 'same' | 'conflict'
export interface PromotionItem {
  kind: 'data source' | 'business rule' | 'pipeline' | 'dataset schema'
  name: string
  status: MappingStatus
  detail?: string
}

export interface PromotionPlan {
  definition: PipelineDefinition
  schedule: PipelineSchedule
  items: PromotionItem[]
  /** Problems that block the promotion (missing data sources, pipelines not promoted yet). */
  blocking: string[]
  /** Rules to create or update in the target before saving the pipeline: source rule id → body with pipeline ids remapped. */
  rules: { sourceId: string; name: string; targetId: string | null; body: RuleBody }[]
}

const keyOf = (p: { id: string; promotionKey: string | null }) => p.promotionKey ?? p.id
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Plans a promotion. Rules the target lacks get a placeholder id `promote:<source rule id>`
 * that the caller replaces with the created rule's id (`applyRuleIds`).
 */
export function planPromotion(def: PipelineDefinition, schedule: PipelineSchedule, from: PromotionSide, to: PromotionSide, targetLabel: string): PromotionPlan {
  const items: PromotionItem[] = []
  const blocking: string[] = []
  const seen = new Set<string>()
  const note = (item: PromotionItem) => {
    const k = `${item.kind}:${item.name}`
    if (!seen.has(k)) (seen.add(k), items.push(item))
  }

  const pipelineInTarget = (sourcePipelineId: string) => {
    const src = from.pipelines.find((p) => p.id === sourcePipelineId)
    if (!src) return { src: null, dst: null }
    const dst = to.pipelines.find((p) => keyOf(p) === keyOf(src)) ?? to.pipelines.find((p) => p.name.toLowerCase() === src.name.toLowerCase()) ?? null
    return { src, dst }
  }

  const mapDataSource = (id: string) => {
    const src = from.dataSources.find((d) => d.id === id)
    if (!src) {
      blocking.push('The pipeline uses a data source that no longer exists here.')
      return id
    }
    const dst = to.dataSources.find((d) => d.name.toLowerCase() === src.name.toLowerCase() && d.sourceType === src.sourceType)
    if (!dst) {
      blocking.push(`Add the data source "${src.name}" (${src.sourceType}) in ${targetLabel} with its ${targetLabel} credentials.`)
      note({ kind: 'data source', name: src.name, status: 'missing' })
      return id
    }
    note({ kind: 'data source', name: src.name, status: 'mapped' })
    return dst.id
  }

  // Rules: the target's rule with the same name, created or updated to match.
  const ruleTarget = new Map<string, string>()
  const rules: PromotionPlan['rules'] = []
  const mapRule = (id: string) => {
    if (!id) return id
    if (ruleTarget.has(id)) return ruleTarget.get(id)!
    const src = from.rules.find((r) => r.id === id)
    if (!src) {
      blocking.push('The pipeline uses a business rule that no longer exists here.')
      return id
    }
    const body = remapRuleBody(src.body, (pid) => {
      const { src: sp, dst } = pipelineInTarget(pid)
      if (!dst) blocking.push(`Rule "${src.name}" runs pipeline "${sp?.name ?? pid}": promote that pipeline to ${targetLabel} first.`)
      return dst?.id ?? pid
    })
    const dst = to.rules.find((r) => r.name.toLowerCase() === src.name.toLowerCase())
    const target = dst?.id ?? `promote:${src.id}`
    ruleTarget.set(id, target)
    if (!dst || !same(dst.body, body)) rules.push({ sourceId: src.id, name: src.name, targetId: dst?.id ?? null, body })
    note({ kind: 'business rule', name: src.name, status: !dst ? 'create' : same(dst.body, body) ? 'same' : 'update' })
    return target
  }

  const nodes = def.nodes.map((n) => {
    switch (n.type) {
      case 'source':
        return { ...n, dataSourceId: mapDataSource(n.dataSourceId) }
      case 'destination':
        // Tables and REST API destinations point at a data source; datasets are matched by name already.
        return n.kind === 'dataset' ? n : { ...n, dataSourceId: mapDataSource(n.dataSourceId) }
      case 'enrich':
      case 'apicall':
        // API steps call a REST data source of their own.
        return { ...n, dataSourceId: mapDataSource(n.dataSourceId) }
      case 'filter':
        return { ...n, ruleId: mapRule(n.ruleId) }
      case 'rules':
        return { ...n, ruleIds: n.ruleIds.map(mapRule) }
      case 'router':
        return { ...n, branches: n.branches.map((b) => ({ ...b, ruleId: mapRule(b.ruleId) })) }
      case 'validate':
        return { ...n, rules: n.rules.map((r) => (r.rule === 'condition' && r.ruleId ? { ...r, ruleId: mapRule(r.ruleId) } : r)) }
      default:
        return n
    }
  }) as PipelineDefinition['nodes']

  let nextSchedule = schedule
  if (schedule.type === 'after') {
    const { src, dst } = pipelineInTarget(schedule.afterPipelineId)
    if (!dst) {
      blocking.push(`This pipeline runs after "${src?.name ?? 'another pipeline'}": promote that one to ${targetLabel} first.`)
      note({ kind: 'pipeline', name: src?.name ?? schedule.afterPipelineId, status: 'missing', detail: 'runs after' })
    } else {
      note({ kind: 'pipeline', name: src!.name, status: 'mapped', detail: 'runs after' })
      nextSchedule = { ...schedule, afterPipelineId: dst.id }
    }
  }

  return { definition: { ...def, nodes }, schedule: nextSchedule, items, blocking: [...new Set(blocking)], rules }
}

/** Pipeline ids inside a rule body (trigger_pipeline actions), remapped. */
export function remapRuleBody(body: RuleBody, mapPipeline: (id: string) => string): RuleBody {
  const map = (actions: RuleBody['then']) => actions.map((a) => (a.type === 'trigger_pipeline' ? { ...a, pipelineId: mapPipeline(a.pipelineId) } : a))
  return { ...body, then: map(body.then ?? []), otherwise: map(body.otherwise ?? []) }
}

/** Replaces `promote:<source rule id>` placeholders with the ids of rules created in the target. */
export function applyRuleIds(def: PipelineDefinition, created: Map<string, string>): PipelineDefinition {
  const fix = (id: string) => (id.startsWith('promote:') ? (created.get(id.slice('promote:'.length)) ?? id) : id)
  const nodes = def.nodes.map((n) => {
    switch (n.type) {
      case 'filter':
        return { ...n, ruleId: fix(n.ruleId) }
      case 'rules':
        return { ...n, ruleIds: n.ruleIds.map(fix) }
      case 'router':
        return { ...n, branches: n.branches.map((b) => ({ ...b, ruleId: fix(b.ruleId) })) }
      case 'validate':
        return { ...n, rules: n.rules.map((r) => ({ ...r, ruleId: fix(r.ruleId) })) }
      default:
        return n
    }
  }) as PipelineDefinition['nodes']
  return { ...def, nodes }
}
