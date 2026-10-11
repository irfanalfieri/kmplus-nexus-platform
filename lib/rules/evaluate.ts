import { describeExpr, evalExpr, evalGroup, type Row } from '@/lib/pipelines/conditions'
import type { Condition, ConditionGroup } from '@/lib/pipelines/definition'
import { ACTION_INFO, type BusinessRule, type RuleAction, type RuleBody } from './definition'

const NO_VALUE = new Set(['is_empty', 'is_not_empty'])

export function describeCondition(c: Condition) {
  const op = c.operator.replace(/_/g, ' ')
  if (NO_VALUE.has(c.operator)) return `${c.field} ${op}`
  return `${c.field} ${op} ${c.valueField ? c.valueField : JSON.stringify(c.value)}`
}

export function describeGroup(g: ConditionGroup): string {
  const parts = [...g.conditions.map(describeCondition), ...g.groups.map((x) => `(${describeGroup(x)})`)]
  if (!parts.length) return 'always'
  return parts.join(g.match === 'all' ? ' AND ' : ' OR ')
}

export function describeAction(a: RuleAction): string {
  switch (a.type) {
    case 'set_field':
      return `set ${a.field} = ${JSON.stringify(a.value)}`
    case 'calculate':
      return `${a.field} = ${describeExpr(a.expr)}`
    case 'route':
      return `route to "${a.branch}"`
    case 'notify':
      return `notify${a.emails.length ? ` ${a.emails.join(', ')}` : ' admins & stewards'}`
    case 'require_approval':
      return `hold for approval${a.reason ? ` (${a.reason})` : ''}`
    case 'trigger_pipeline':
      return 'run another pipeline'
    default:
      return ACTION_INFO[a.type].toLowerCase()
  }
}

/** "IF a = 1 AND b is empty THEN drop the row ELSE …" */
export function describeRule(body: RuleBody): string {
  const then = body.then.map(describeAction).join(', ') || 'nothing'
  const otherwise = body.otherwise.length ? ` ELSE ${body.otherwise.map(describeAction).join(', ')}` : ''
  return `IF ${describeGroup(body.when)} THEN ${then}${otherwise}`
}

/** "{first_name} {last_name}" → field values (missing = empty). */
export const fillTemplate = (text: string, row: Row) =>
  text.replace(/\{([^{}]+)\}/g, (_, name: string) => {
    const v = row[name.trim()]
    return v === null || v === undefined ? '' : String(v)
  })

export interface RuleOutcome {
  row: Row
  keep: boolean
  /** Approval reason when a rule holds the row (and it isn't pre-approved). */
  hold: string | null
  /** First calculation error; the row is quarantined. */
  failure: string | null
  /** `${ruleId}:then|otherwise` for every rule whose branch had actions. */
  hits: string[]
}

/**
 * Applies rules to a row in order (the Rules node, BR-1/BR-2). Pure; shared by
 * the engine and the Business Rules tester so both behave the same.
 * notify / trigger_pipeline run once per run from the hit counts.
 */
export function applyRules(rules: BusinessRule[], original: Row, opts: { approved?: boolean } = {}): RuleOutcome {
  let row = original
  let keep = true
  let hold: string | null = null
  let failure: string | null = null
  const hits: string[] = []
  for (const rule of rules) {
    const matched = evalGroup(row, rule.when)
    const branch = matched ? 'then' : 'otherwise'
    const actions: RuleAction[] = matched ? rule.then : rule.otherwise
    if (actions.length) hits.push(`${rule.id}:${branch}`)
    for (const a of actions) {
      if (a.type === 'include') keep = true
      else if (a.type === 'exclude') keep = false
      else if (a.type === 'set_field') row = { ...row, [a.field]: fillTemplate(a.value, row) }
      else if (a.type === 'calculate') {
        try {
          row = { ...row, [a.field]: evalExpr(row, a.expr) }
        } catch (err) {
          failure ??= `${rule.name}: ${a.field}: ${err instanceof Error ? err.message : 'calculation failed'}`
        }
      } else if (a.type === 'route') row = { ...row, _nexus_route: a.branch }
      else if (a.type === 'require_approval' && !opts.approved) hold = `${rule.name}${a.reason ? `: ${a.reason}` : ''}`
    }
  }
  return { row, keep, hold, failure, hits }
}
