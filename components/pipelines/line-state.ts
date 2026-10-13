import { DEFAULT_SCHEDULE, scheduleSchema, topoOrder, type PipelineDefinition } from '@/lib/pipelines/definition'
import type { listPipelines } from '@/lib/actions/pipelines'
import type { Translate } from '@/lib/i18n/translate'
import type { FlowState } from '@/components/ui/flow-line'

/** How Pipelines and Overview read a pipeline as a line (client-safe, pure). */
export type PipelineRow = Awaited<ReturnType<typeof listPipelines>>[number]

/** The two ends of the line: source table → destination(s). */
export function ends(def: PipelineDefinition | null, sourceName: (id: string) => string, t: Translate) {
  if (!def) return { from: t('pipelines.noSource'), table: '', to: t('pipelines.noDestination') }
  const order = topoOrder(def.nodes, def.edges) ?? def.nodes
  const src = order.find((n) => n.type === 'source')
  const dests = order.flatMap((d) => (d.type !== 'destination' ? [] : d.kind === 'dataset' ? [d.datasetName] : [`${sourceName(d.dataSourceId)} · ${d.table}`]))
  return {
    // The source bus names the system and table; the destination bus the dataset, product or table it feeds.
    from: src?.type === 'source' ? sourceName(src.dataSourceId) : t('pipelines.noSource'),
    table: src?.type === 'source' ? src.table : '',
    to: dests.length ? (dests.length > 1 ? `${dests[0]} +${dests.length - 1}` : dests[0]) : t('pipelines.noDestination'),
  }
}

/** A pipeline reads like a breaker: what state is its line in? */
export function lineState(p: PipelineRow, running: boolean, t: Translate): { state: FlowState; label: string } {
  const schedule = scheduleSchema.safeParse(p.schedule ?? {}).data ?? DEFAULT_SCHEDULE
  if (running || p.lastRunStatus === 'running' || p.lastRunStatus === 'queued') return { state: 'running', label: t('state.running') }
  if (p.pendingApproval) return { state: 'held', label: t('state.awaitingApproval') }
  if (p.lastRunStatus === 'failed') return { state: 'tripped', label: t('state.failed') }
  if (p.heldRows > 0) return { state: 'tripped', label: t('state.held', { count: p.heldRows }) }
  if (!(p.version ?? 0)) return { state: 'idle', label: t('state.draft') }
  if (schedule.type !== 'manual' && !p.enabled) return { state: 'paused', label: t('state.paused') }
  if (!p.lastRunStatus) return { state: 'idle', label: t('state.neverRun') }
  if (p.lastRunStatus === 'cancelled') return { state: 'paused', label: t('state.cancelled') }
  return { state: 'live', label: t('state.succeeded') }
}
