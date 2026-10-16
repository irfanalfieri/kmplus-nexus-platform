import { destinationTarget, type PipelineDefinition } from './definition'

/**
 * Publish approvals (GV-6). Client-safe and pure; covered by scripts/engine-tests.ts.
 *
 * A workspace chooses who must approve a pipeline before a version runs:
 *   off          publishing is immediate
 *   destructive  versions that replace a dataset, mark rows deleted or call an API that changes data need a second person
 *   always       every publish (and every promotion into this workspace) needs a second person
 * The requester can never approve their own request.
 */

export const APPROVAL_POLICIES = ['off', 'destructive', 'always'] as const
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number]

export const APPROVAL_POLICY_INFO: Record<ApprovalPolicy, { label: string; description: string }> = {
  off: { label: 'Off', description: 'Editors publish directly.' },
  destructive: { label: 'Destructive changes', description: 'A second person approves versions that replace a dataset or mark rows deleted.' },
  always: { label: 'Every publish', description: 'A second person approves every version before it runs, including promotions into this workspace.' },
}

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'superseded'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

export function isApprovalPolicy(value: unknown): value is ApprovalPolicy {
  return typeof value === 'string' && (APPROVAL_POLICIES as readonly string[]).includes(value)
}

/** Writes in a definition that remove or overwrite data. */
export function destructiveWrites(def: PipelineDefinition): string[] {
  const out: string[] = []
  for (const n of def.nodes) {
    // An API call that changes data in another system can't be undone by Nexus (decided: always destructive).
    if (n.type === 'apicall') out.push(`Changes data through ${n.create.method} ${n.create.path}${n.update ? ` and ${n.update.method} ${n.update.path}` : ''}`)
    if (n.type !== 'destination') continue
    const target = n.kind === 'dataset' ? `dataset ${n.datasetName}` : `${n.kind === 'api' ? 'API request' : 'table'} ${destinationTarget(n)}`
    if (n.kind === 'dataset' && n.mode === 'replace') out.push(`Replaces ${target} on every run`)
    if (n.softDeleteMissing) out.push(`Marks rows missing from the source as deleted in ${target}`)
  }
  return out
}

/** Why publishing this definition needs approval under the policy; empty = publish right away. */
export function approvalReasons(policy: ApprovalPolicy, def: PipelineDefinition, opts: { promotedFrom?: string } = {}): string[] {
  if (policy === 'off') return []
  const destructive = destructiveWrites(def)
  if (policy === 'destructive') return destructive
  return [opts.promotedFrom ? `Promoted from ${opts.promotedFrom}` : 'Every publish needs approval in this workspace', ...destructive]
}
