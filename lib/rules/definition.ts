import { z } from 'zod'
import { conditionGroupSchema, exprSchema } from '@/lib/pipelines/definition'

/**
 * Business rules (PRD Layer 11): reusable IF/THEN rules stored as declarative
 * JSON (BR-5), referenced by id from Filter, Validate, Router and Rules nodes
 * (BR-3). Client-safe.
 *
 *   IF employment_status = 'Active'  THEN include
 *   IF department = 'Finance'        THEN notify HR
 */

export const RULE_ACTIONS = ['include', 'exclude', 'set_field', 'calculate', 'route', 'notify', 'require_approval', 'trigger_pipeline'] as const
export type RuleActionType = (typeof RULE_ACTIONS)[number]

export const ACTION_INFO: Record<RuleActionType, string> = {
  include: 'Keep the row',
  exclude: 'Drop the row',
  set_field: 'Set a field to a value',
  calculate: 'Calculate a field',
  route: 'Route to a branch',
  notify: 'Notify people',
  require_approval: 'Hold for approval',
  trigger_pipeline: 'Run another pipeline',
}

export const ruleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('include') }),
  z.object({ type: z.literal('exclude') }),
  z.object({ type: z.literal('set_field'), field: z.string().min(1, 'Choose the field'), value: z.string().default('') }),
  z.object({ type: z.literal('calculate'), field: z.string().min(1, 'Choose the field'), expr: exprSchema }),
  /** A downstream Router sends the row to the branch with this label. */
  z.object({ type: z.literal('route'), branch: z.string().trim().min(1, 'Name the branch') }),
  /** One notification per run with the number of matching rows; empty emails = workspace admins and stewards. */
  z.object({ type: z.literal('notify'), message: z.string().trim().min(1, 'Write the message').max(300), emails: z.array(z.string().email()).max(10).default([]) }),
  /** The row is held in the quarantine until a steward approves it, then replayed. */
  z.object({ type: z.literal('require_approval'), reason: z.string().trim().max(200).default('') }),
  /** Queues another pipeline of the workspace after this run succeeds, once. */
  z.object({ type: z.literal('trigger_pipeline'), pipelineId: z.string().min(1, 'Choose the pipeline') }),
])
export type RuleAction = z.infer<typeof ruleActionSchema>

export const ruleBodySchema = z.object({
  when: conditionGroupSchema,
  then: z.array(ruleActionSchema).max(10).default([]),
  /** Actions when the condition doesn't match. */
  otherwise: z.array(ruleActionSchema).max(10).default([]),
})
export type RuleBody = z.infer<typeof ruleBodySchema>

export interface BusinessRule extends RuleBody {
  id: string
  name: string
  version: number
}

export const ruleInputSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().trim().min(1, 'Name the rule').max(120),
  description: z.string().trim().max(500).default(''),
  body: ruleBodySchema,
  changeNote: z.string().trim().max(200).optional(),
})
