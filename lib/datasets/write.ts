import type { DestinationStep, ColumnType } from '@/lib/pipelines/definition'
import { stepTitle } from '@/lib/pipelines/definition'
import type { OutputColumn } from '@/lib/pipelines/columns'
import { NonRetryableError } from '@/lib/pipelines/io'
import type { Row } from '@/lib/pipelines/transforms'
import { autoAddedColumns, conformRows, followRenames, mappingIssues, resolveMapping, safeName } from './schema'
import { changeSchema, type StoredSchema } from './store'

/**
 * A chunk's rows for a defined dataset (server; the worker calls it per
 * destination): new columns added first when the schema grows automatically,
 * then the destination's mapping applied and every value checked against the
 * schema. Only the mapped columns are written, matched on the schema's keys.
 */
export async function prepareDefinedWrite(
  scope: { workspaceId: string; userId: string },
  stored: StoredSchema,
  original: Extract<DestinationStep, { kind: 'dataset' }>,
  inputRows: Row[],
  hints: Record<string, ColumnType> = {},
  /** Active rename aliases of the dataset (old → new), so published pipelines follow a rename. */
  aliases: { oldName: string; newName: string }[] = []
) {
  const { dest, rows } = followRenames(original, inputRows, aliases)
  for (const a of aliases) if (a.oldName in hints && !(a.newName in hints)) hints = { ...hints, [a.newName]: hints[a.oldName] }
  const inputCols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => !c.startsWith('_nexus_'))
  let schema = stored.schema
  let current = stored
  const added: string[] = []
  const first = mappingIssues(schema, dest, inputCols.map((name) => ({ name, type: hints[name] ?? 'text' })))
  if (first.byName && schema.autoAdd && first.extras.length) {
    // Only names a schema can hold as they are: anything else would never match by name.
    const cols = autoAddedColumns(first.extras.filter((e) => safeName(e) === e), rows, hints).filter((c) => !schema.columns.some((x) => x.name === c.name))
    if (cols.length) {
      const res = await changeSchema(scope, dest.datasetName, cols.map((column) => ({ kind: 'add' as const, column })))
      schema = res.schema
      current = { ...stored, version: res.version, schema }
      added.push(...cols.map((c) => c.name))
    }
  }
  const { map } = resolveMapping(schema, dest, inputCols)
  const keys = schema.keys.length ? schema.keys : dest.keys
  if (dest.mode === 'upsert') {
    if (!keys.length) throw new NonRetryableError(`${stepTitle(dest)}: the dataset has no key columns to upsert on. Set them in its schema.`)
    const missing = keys.filter((k) => !map.some((m) => m.target === k))
    if (missing.length) throw new NonRetryableError(`${stepTitle(dest)}: map the dataset's key column(s) ${missing.join(', ')}.`)
  }
  const conformed = conformRows(schema, map, rows)
  const columns: OutputColumn[] = map.map((m) => schema.columns.find((c) => c.name === m.target)!).map((c) => ({ name: c.name, type: c.type }))
  const tableColumns: OutputColumn[] = schema.columns.map((c) => ({ name: c.name, type: c.type }))
  const dropped = first.extras.filter((e) => !added.includes(e))
  return { stored: current, rows: conformed.rows, rejects: conformed.rejects, columns, tableColumns, keys, added, dropped }
}
