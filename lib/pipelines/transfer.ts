import { z } from 'zod'
import { scheduleSchema, type PipelineDefinition, type PipelineSchedule } from './definition'
import { planPromotion, type PromotionPlan, type PromotionSide } from './promote'
import { ruleBodySchema } from '@/lib/rules/definition'
import { datasetSchemaSpec } from '@/lib/datasets/schema'

/**
 * Pipeline export / import as JSON (VC-5). Pure and client-safe; covered by
 * scripts/engine-tests.ts.
 *
 * An export holds the pipeline's definition and schedule plus what it refers
 * to by id in its workspace, by name: data sources (name and connector type,
 * never credentials), business rules (name and body), the pipeline it runs
 * after, and the defined schemas of the datasets it writes. Importing maps
 * them onto the target workspace like a promotion (lib/pipelines/promote.ts):
 * data sources by name and type (or as the person chooses), rules by name
 * (created when missing), the "run after" pipeline by name (else the
 * schedule becomes manual). The pipeline arrives as an unpublished draft.
 */

export const PIPELINE_EXPORT_FORMAT = 'kmplus-nexus/pipeline'
export const PIPELINE_EXPORT_VERSION = 1

export const pipelineExportSchema = z.object({
  format: z.literal(PIPELINE_EXPORT_FORMAT),
  formatVersion: z.literal(PIPELINE_EXPORT_VERSION),
  exportedAt: z.string(),
  /** Which version was exported (published, or the draft when nothing is published). */
  exportedVersion: z.number().int().min(0).default(0),
  pipeline: z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).default(''),
    definition: z.unknown(),
    schedule: z.unknown(),
  }),
  references: z.object({
    dataSources: z.array(z.object({ id: z.string(), name: z.string(), sourceType: z.string() })).max(50).default([]),
    rules: z.array(z.object({ id: z.string(), name: z.string(), body: ruleBodySchema })).max(200).default([]),
    pipelines: z.array(z.object({ id: z.string(), name: z.string() })).max(50).default([]),
  }),
  schemas: z.array(z.object({ datasetName: z.string(), schema: datasetSchemaSpec })).max(50).default([]),
})
export type PipelineExport = z.infer<typeof pipelineExportSchema>

/** Ids a definition and schedule refer to in their workspace. */
export function referencedIds(def: PipelineDefinition, schedule: PipelineSchedule) {
  const dataSources = new Set<string>()
  const rules = new Set<string>()
  for (const n of def.nodes) {
    if ((n.type === 'source' || n.type === 'enrich' || n.type === 'apicall') && 'dataSourceId' in n && n.dataSourceId) dataSources.add(n.dataSourceId)
    if (n.type === 'destination' && n.kind !== 'dataset') dataSources.add(n.dataSourceId)
    if (n.type === 'filter' && n.ruleId) rules.add(n.ruleId)
    if (n.type === 'rules') n.ruleIds.forEach((r) => rules.add(r))
    if (n.type === 'router') n.branches.forEach((b) => b.ruleId && rules.add(b.ruleId))
    if (n.type === 'validate') n.rules.forEach((r) => r.rule === 'condition' && r.ruleId && rules.add(r.ruleId))
  }
  return { dataSources: [...dataSources], rules: [...rules], pipelines: schedule.type === 'after' && schedule.afterPipelineId ? [schedule.afterPipelineId] : [] }
}

/** A file name for the download. */
export const exportFileName = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pipeline'}.nexus-pipeline.json`

/** Reads an uploaded file; the problem in words when it isn't a Nexus pipeline export. */
export function parseExport(text: string): { ok: true; file: PipelineExport } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The file is not JSON.' }
  }
  if ((raw as { format?: unknown } | null)?.format !== PIPELINE_EXPORT_FORMAT) return { ok: false, error: 'This is not a Nexus pipeline export.' }
  if ((raw as { formatVersion?: unknown }).formatVersion !== PIPELINE_EXPORT_VERSION) return { ok: false, error: 'This export was made by a newer version of Nexus.' }
  const parsed = pipelineExportSchema.safeParse(raw)
  return parsed.success ? { ok: true, file: parsed.data } : { ok: false, error: 'The export is incomplete or was changed by hand.' }
}

export interface ImportPlan extends PromotionPlan {
  /** Exported data sources and what each maps to (null = nothing chosen or found). */
  sources: { id: string; name: string; sourceType: string; targetId: string | null; byName: boolean }[]
  warnings: string[]
}

/**
 * Maps an export onto a workspace. `sourceMap` (export data source id →
 * workspace data source id) overrides the match by name and type.
 */
export function planImport(file: PipelineExport, definition: PipelineDefinition, to: PromotionSide, sourceMap: Record<string, string> = {}): ImportPlan {
  const warnings: string[] = []
  const schedule = scheduleSchema.parse(file.pipeline.schedule ?? {})
  // Chosen data sources take the name and type of the workspace's source, so the planner maps them.
  const sources = file.references.dataSources.map((d) => {
    const chosen = sourceMap[d.id] ? to.dataSources.find((x) => x.id === sourceMap[d.id]) : undefined
    const byName = to.dataSources.find((x) => x.name.toLowerCase() === d.name.toLowerCase() && x.sourceType === d.sourceType)
    const target = chosen ?? byName ?? null
    return { id: d.id, name: d.name, sourceType: d.sourceType, targetId: target?.id ?? null, byName: !chosen && Boolean(byName) }
  })
  const from: PromotionSide = {
    dataSources: sources.map((s) => {
      const target = s.targetId ? to.dataSources.find((x) => x.id === s.targetId)! : null
      return { id: s.id, name: target?.name ?? s.name, sourceType: target?.sourceType ?? s.sourceType }
    }),
    rules: file.references.rules,
    pipelines: file.references.pipelines.map((p) => ({ id: p.id, name: p.name, promotionKey: null })),
  }
  // "Run after" a pipeline this workspace doesn't have: imported with a manual schedule.
  let nextSchedule = schedule
  if (schedule.type === 'after') {
    const after = file.references.pipelines.find((p) => p.id === schedule.afterPipelineId)
    if (!after || !to.pipelines.some((p) => p.name.toLowerCase() === after.name.toLowerCase())) {
      nextSchedule = { type: 'manual' } as PipelineSchedule
      warnings.push(`It ran after "${after?.name ?? 'another pipeline'}", which this workspace doesn't have: the schedule is set to manual.`)
    }
  }
  const plan = planPromotion(definition, nextSchedule, from, to, 'this workspace')
  const blocking = plan.blocking.map((b) => (b.startsWith('Add the data source') ? b.replace(/ in this workspace with its this workspace credentials\.$/, ' here, or choose one of the same type.') : b))
  return { ...plan, blocking, sources, warnings }
}
