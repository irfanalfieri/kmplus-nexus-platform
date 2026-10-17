'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { businessRuleVersions, businessRules } from '@/lib/db/schema'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { guard } from '@/lib/server-action'
import { scheduleSchema } from '@/lib/pipelines/definition'
import { parseDefinition } from '@/lib/pipelines/runner'
import { applyRuleIds } from '@/lib/pipelines/promote'
import { assertPipelinesEditable, getOwnedPipeline, promotionSide, savePipelineAs } from '@/lib/pipelines/publish'
import { PIPELINE_EXPORT_FORMAT, PIPELINE_EXPORT_VERSION, exportFileName, parseExport, planImport, referencedIds, type PipelineExport } from '@/lib/pipelines/transfer'
import { schemaPromotion } from '@/lib/datasets/schema'
import { defineSchema, loadSchemas } from '@/lib/datasets/store'

/**
 * Pipeline export / import (VC-5). Exports carry names, never credentials or
 * rows; imports map references onto this workspace (lib/pipelines/transfer.ts)
 * and arrive as unpublished drafts with the schedule off.
 */

const idSchema = z.string().trim().min(1).max(100)
const MAX_FILE = 2_000_000

/** The pipeline (its published version, else its draft) as a JSON file. */
async function exportPipelineImpl(rawId: string) {
  const ctx = await requireWorkspace()
  const pipeline = await getOwnedPipeline(ctx, idSchema.parse(rawId))
  const definition = parseDefinition(pipeline.version ? pipeline.config : (pipeline.draftConfig ?? pipeline.config))
  const schedule = scheduleSchema.parse(pipeline.schedule ?? {})
  const refs = referencedIds(definition, schedule)
  const side = await promotionSide(ctx.workspaceId)
  const written = [...new Set(definition.nodes.flatMap((n) => (n.type === 'destination' && n.kind === 'dataset' ? [n.datasetName] : [])))]
  const schemas = written.length ? await loadSchemas(ctx.workspaceId) : new Map()
  const file: PipelineExport = {
    format: PIPELINE_EXPORT_FORMAT,
    formatVersion: PIPELINE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedVersion: pipeline.version || pipeline.draftVersion || 0,
    pipeline: { name: pipeline.name, description: pipeline.description ?? '', definition, schedule },
    references: {
      dataSources: side.dataSources.filter((d) => refs.dataSources.includes(d.id)),
      rules: side.rules.filter((r) => refs.rules.includes(r.id)),
      pipelines: side.pipelines.filter((p) => refs.pipelines.includes(p.id)).map((p) => ({ id: p.id, name: p.name })),
    },
    schemas: written.flatMap((name) => (schemas.get(name) ? [{ datasetName: name, schema: schemas.get(name)!.schema }] : [])),
  }
  await recordAudit(ctx, { action: 'EXPORT', resource: 'pipeline', resourceId: pipeline.id, changes: { name: pipeline.name, version: file.exportedVersion } })
  return { fileName: exportFileName(pipeline.name), json: JSON.stringify(file, null, 2) }
}

const importInput = z.object({
  json: z.string().min(2).max(MAX_FILE),
  /** Export data source id → this workspace's data source id. */
  sourceMap: z.record(z.string(), z.string()).default({}),
  name: z.string().trim().min(1).max(120).optional(),
})

async function buildImport(ctx: WorkspaceContext, data: z.output<typeof importInput>) {
  const parsed = parseExport(data.json)
  if (!parsed.ok) throw new Error(parsed.error)
  const file = parsed.file
  const definition = parseDefinition(file.pipeline.definition)
  const side = await promotionSide(ctx.workspaceId)
  const plan = planImport(file, definition, side, data.sourceMap)
  const existing = await loadSchemas(ctx.workspaceId)
  const schemas = file.schemas.map((s) => ({ ...s, ...schemaPromotion(s.schema, existing.get(s.datasetName)?.schema ?? null) }))
  for (const s of schemas) if (s.status === 'blocked' || s.status === 'update') plan.warnings.push(`Dataset "${s.datasetName}" already has a schema here that differs; it is kept as it is.`)
  const names = new Set(side.pipelines.map((p) => p.name.toLowerCase()))
  let name = data.name ?? file.pipeline.name
  if (!data.name && names.has(name.toLowerCase())) name = `${file.pipeline.name} (imported)`.slice(0, 120)
  return { file, plan, schemas, name, nameTaken: names.has(name.toLowerCase()), side }
}

/** What an import would do: data source matches (with choices of the same type), rules, warnings, problems. */
async function previewImportImpl(input: z.input<typeof importInput>) {
  const ctx = await requireWorkspace('pipelines:edit')
  const b = await buildImport(ctx, importInput.parse(input))
  return {
    name: b.name,
    nameTaken: b.nameTaken,
    exportedAt: b.file.exportedAt,
    exportedVersion: b.file.exportedVersion,
    steps: b.plan.definition.nodes.length,
    sources: b.plan.sources.map((s) => ({ ...s, choices: b.side.dataSources.filter((d) => d.sourceType === s.sourceType).map((d) => ({ id: d.id, name: d.name })) })),
    items: b.plan.items,
    schemas: b.schemas.map((s) => ({ datasetName: s.datasetName, status: s.status })),
    warnings: b.plan.warnings,
    blocking: b.plan.blocking,
  }
}

/** Creates the pipeline as an unpublished draft (rules and missing dataset schemas first). */
async function importPipelineImpl(input: z.input<typeof importInput>) {
  const ctx = await requireWorkspace('pipelines:edit')
  await assertPipelinesEditable(ctx)
  const data = importInput.parse(input)
  const b = await buildImport(ctx, data)
  if (b.plan.blocking.length) throw new Error(b.plan.blocking.join(' '))
  if (b.nameTaken) throw new Error(`A pipeline named "${b.name}" already exists here. Choose another name.`)

  // Business rules the workspace lacks are created; ones with the same name keep their body.
  const ruleIds = new Map<string, string>()
  for (const r of b.plan.rules) {
    if (r.targetId) {
      ruleIds.set(r.sourceId, r.targetId)
      continue
    }
    const id = newId('rule')
    await db.insert(businessRules).values({ id, workspaceId: ctx.workspaceId, name: r.name, description: 'Imported with a pipeline', body: r.body, version: 1, createdBy: ctx.userId, updatedBy: ctx.userId })
    await db.insert(businessRuleVersions).values({ id: newId('rver'), ruleId: id, workspaceId: ctx.workspaceId, version: 1, name: r.name, body: r.body, changes: 'Imported', createdBy: ctx.userId })
    await recordAudit(ctx, { action: 'CREATE', resource: 'business_rule', resourceId: id, changes: { name: r.name, imported: true } })
    ruleIds.set(r.sourceId, id)
  }
  // Defined schemas the workspace doesn't have yet.
  for (const s of b.schemas) if (s.status === 'create') await defineSchema(ctx, s.datasetName, s.schema, 'an imported pipeline')

  const saved = await savePipelineAs(ctx, {
    name: b.name,
    description: (b.file.pipeline.description ?? '').slice(0, 500),
    definition: applyRuleIds(b.plan.definition, ruleIds),
    schedule: b.plan.schedule,
    enabled: false,
    changeNote: `Imported (exported ${b.file.exportedAt.slice(0, 10)}, v${b.file.exportedVersion})`,
    publish: false,
  })
  await recordAudit(ctx, { action: 'IMPORT', resource: 'pipeline', resourceId: saved.id, changes: { name: b.name, exportedVersion: b.file.exportedVersion, rulesCreated: b.plan.rules.filter((r) => !r.targetId).map((r) => r.name), schemasCreated: b.schemas.filter((s) => s.status === 'create').map((s) => s.datasetName) } })
  revalidatePath('/dashboard', 'layout')
  return { id: saved.id, version: saved.version }
}

export async function exportPipeline(...args: Parameters<typeof exportPipelineImpl>) {
  return guard(() => exportPipelineImpl(...args))
}
export async function previewImport(...args: Parameters<typeof previewImportImpl>) {
  return guard(() => previewImportImpl(...args))
}
export async function importPipeline(...args: Parameters<typeof importPipelineImpl>) {
  return guard(() => importPipelineImpl(...args))
}
