import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { businessRules, nexusDatasets } from '@/lib/db/schema'
import { ruleBodySchema, type BusinessRule } from '@/lib/rules/definition'
import { lookupRefs, referencedRuleIds, type PipelineDefinition } from './definition'
import { emptyContext, type EngineContext } from './engine'
import { NonRetryableError, readDatasetColumnValues, readDatasetPairs } from './io'

/** Business rules of a workspace by id (invalid stored bodies are skipped). */
export async function loadRules(workspaceId: string, ids: string[]): Promise<Map<string, BusinessRule>> {
  if (!ids.length) return new Map()
  const rows = await db
    .select()
    .from(businessRules)
    .where(and(eq(businessRules.workspaceId, workspaceId), inArray(businessRules.id, ids)))
  const out = new Map<string, BusinessRule>()
  for (const r of rows) {
    const body = ruleBodySchema.safeParse(r.body)
    if (body.success) out.set(r.id, { id: r.id, name: r.name, version: r.version, ...body.data })
  }
  return out
}

/**
 * Everything the engine needs besides rows: the business rules the pipeline
 * references and the values of exists_in lookups ("dataset.column").
 */
export async function loadRunContext(workspaceId: string, def: PipelineDefinition): Promise<EngineContext> {
  const ctx = emptyContext()
  const ruleIds = referencedRuleIds(def)
  ctx.rules = await loadRules(workspaceId, ruleIds)
  const missing = ruleIds.filter((id) => !ctx.rules.has(id))
  if (missing.length) throw new NonRetryableError(`Business rule(s) used by this pipeline no longer exist: ${missing.join(', ')}`)

  const lookups = new Set<string>()
  for (const n of def.nodes) if (n.type === 'validate') for (const r of n.rules) if (r.rule === 'exists_in' && r.value) lookups.add(r.value)
  for (const ref of lookups) {
    const dot = ref.indexOf('.')
    if (dot < 1) throw new NonRetryableError(`Lookup "${ref}" must be dataset.column`)
    const datasetName = ref.slice(0, dot)
    const column = ref.slice(dot + 1)
    const [ds] = await db
      .select({ tableName: nexusDatasets.tableName, columns: nexusDatasets.columns })
      .from(nexusDatasets)
      .where(and(eq(nexusDatasets.workspaceId, workspaceId), eq(nexusDatasets.name, datasetName)))
      .limit(1)
    if (!ds) throw new NonRetryableError(`Lookup dataset ${datasetName} doesn't exist yet. Run the pipeline that produces it first.`)
    if (!((ds.columns as { name: string }[]) ?? []).some((c) => c.name === column)) throw new NonRetryableError(`Dataset ${datasetName} has no column ${column}.`)
    ctx.lookups.set(ref, await readDatasetColumnValues(ds.tableName, column))
  }

  // Lookup tables for Map "lookup" transforms (MP-6).
  for (const ref of lookupRefs(def)) {
    if (!ref.dataset || !ref.keyColumn || !ref.valueColumn) throw new NonRetryableError('A lookup transform needs a dataset, a key column and a value column.')
    const [ds] = await db
      .select({ tableName: nexusDatasets.tableName, columns: nexusDatasets.columns })
      .from(nexusDatasets)
      .where(and(eq(nexusDatasets.workspaceId, workspaceId), eq(nexusDatasets.name, ref.dataset)))
      .limit(1)
    if (!ds) throw new NonRetryableError(`Lookup dataset ${ref.dataset} doesn't exist. Upload it (CSV → Dataset template) or run the pipeline that produces it.`)
    const names = ((ds.columns as { name: string }[]) ?? []).map((c) => c.name)
    for (const col of [ref.keyColumn, ref.valueColumn]) if (!names.includes(col)) throw new NonRetryableError(`Dataset ${ref.dataset} has no column ${col}.`)
    ctx.lookupTables ??= new Map()
    ctx.lookupTables.set(ref.key, await readDatasetPairs(ds.tableName, ref.keyColumn, ref.valueColumn))
  }
  return ctx
}
