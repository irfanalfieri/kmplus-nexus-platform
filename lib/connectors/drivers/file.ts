import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '@/lib/db'
import { cleanTableName } from '@/lib/files/parse'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult, SchemaTable } from '../types'

/**
 * File upload source (DS-9): CSV and Excel sheets uploaded in the browser are
 * stored as tables in the private "nexus_raw" schema of the Nexus database,
 * one table per uploaded sheet. Values are kept as text exactly as in the file;
 * the column types detected at upload are passed to pipelines as type hints.
 * The data source's (encrypted) credentials hold only its storage key.
 */

export const RAW_SCHEMA = 'nexus_raw'
/** Row order of the file; not exposed to pipelines. */
export const ROW_COLUMN = '_nexus_row'
export const FILE_MAX_ROWS = 500_000
export const FILE_MAX_COLUMNS = 300
export { cleanTableName }

const qIdent = (name: string) => `"${name.replace(/"/g, '""')}"`

function prefix(storageKey: string) {
  if (!storageKey) throw new Error('This file source has no storage yet. Upload a file first.')
  return `f_${createHash('sha1').update(storageKey).digest('hex').slice(0, 10)}_`
}

/** Physical table in nexus_raw for a visible table name. */
export function physicalTable(storageKey: string, table: string) {
  const clean = cleanTableName(table)
  if (clean !== table) throw new Error(`Unknown file table "${table}".`)
  return `${prefix(storageKey)}${clean}`
}

export const rawRel = (physical: string) => `${qIdent(RAW_SCHEMA)}.${qIdent(physical)}`

async function listTables(storageKey: string): Promise<SchemaTable[]> {
  const p = prefix(storageKey)
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name LIKE $2 AND c.table_name NOT LIKE '%\\_\\_up'
      ORDER BY c.table_name, c.ordinal_position`,
    [RAW_SCHEMA, `${p.replace(/_/g, '\\_')}%`]
  )
  const tables = new Map<string, SchemaTable>()
  for (const r of rows) {
    const name = r.table_name.slice(p.length)
    if (!tables.has(name)) tables.set(name, { schema: 'file', name, columns: [], rowCount: null })
    if (r.column_name !== ROW_COLUMN) tables.get(name)!.columns.push({ name: r.column_name, type: 'text', nullable: true })
  }
  for (const [name, t] of tables) {
    t.rowCount = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${rawRel(`${p}${name}`)}`)).rows[0].n
  }
  return [...tables.values()]
}

export async function testFileConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  if (!credentials.storageKey) return { ok: true, message: 'Ready. Save the source, then upload CSV or Excel files from Data Sources.' }
  const tables = await listTables(credentials.storageKey)
  return { ok: true, message: tables.length ? `${tables.length} uploaded table(s)` : 'No files uploaded yet', meta: { tables: String(tables.length) } }
}

export async function scanFileSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const tables = credentials.storageKey ? await listTables(credentials.storageKey) : []
  return { tables, scannedAt: new Date().toISOString(), method: 'nexus_raw tables' }
}

export async function sampleFileTable(credentials: ConnectorCredentials, table: string, limit = 25) {
  const rel = rawRel(physicalTable(credentials.storageKey ?? '', table))
  const [{ rows, fields }, count] = await Promise.all([
    pool.query(`SELECT * FROM ${rel} ORDER BY ${qIdent(ROW_COLUMN)} LIMIT $1`, [Math.max(1, Math.min(limit, 100_000))]),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${rel}`),
  ])
  return {
    tableName: table,
    columns: fields.map((f) => f.name).filter((n) => n !== ROW_COLUMN),
    rows: rows.map(({ [ROW_COLUMN]: _row, ...rest }) => rest as Record<string, unknown>),
    totalRows: count.rows[0].n as number | null,
  }
}

/** Reads one chunk in file order (or watermark order), for the pipeline worker. */
export async function readFileChunk(storageKey: string, table: string, opts: { offset: number; limit: number; watermark?: { column: string; after: string | null } }) {
  const rel = rawRel(physicalTable(storageKey, table))
  const wm = opts.watermark
  const params: unknown[] = [opts.limit, opts.offset]
  if (wm?.after != null) params.push(wm.after)
  const { rows } = await pool.query(
    `SELECT * FROM ${rel} ${wm?.after != null ? `WHERE ${qIdent(wm.column)} > $3` : ''} ORDER BY ${wm ? `${qIdent(wm.column)}, ` : ''}${qIdent(ROW_COLUMN)} LIMIT $1 OFFSET $2`,
    params
  )
  return rows.map(({ [ROW_COLUMN]: _row, ...rest }) => rest as Record<string, unknown>)
}

// ── Upload ───────────────────────────────────────────────────────────────────

async function insertRows(client: PoolClient, rel: string, columns: string[], rows: (string | null)[][]) {
  // Postgres allows 65,535 parameters per statement.
  const per = Math.max(1, Math.floor(60_000 / Math.max(1, columns.length)))
  for (let i = 0; i < rows.length; i += per) {
    const batch = rows.slice(i, i + per)
    const params: unknown[] = []
    const values = batch.map((r) => `(${columns.map((_, j) => (params.push(r[j] ?? null), `$${params.length}`)).join(', ')})`)
    await client.query(`INSERT INTO ${rel} (${columns.map(qIdent).join(', ')}) VALUES ${values.join(', ')}`, params)
  }
}

/**
 * Writes one part of an upload. Replace uploads go to a staging table that is
 * swapped in by the final part, so pipelines never read a half-uploaded file.
 */
export async function writeUploadPart(opts: { storageKey: string; table: string; columns: string[]; rows: (string | null)[][]; part: number; final: boolean; mode: 'replace' | 'append' }) {
  const physical = physicalTable(opts.storageKey, opts.table)
  const target = rawRel(physical)
  const staging = rawRel(`${physical}__up`)
  const rel = opts.mode === 'replace' ? staging : target
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${qIdent(RAW_SCHEMA)}`)
    // Supabase exposes only "public" over its REST API; keep this schema private anyway.
    await client.query(`REVOKE ALL ON SCHEMA ${qIdent(RAW_SCHEMA)} FROM PUBLIC`)
    if (opts.part === 0 && opts.mode === 'replace') await client.query(`DROP TABLE IF EXISTS ${staging}`)
    await client.query(`CREATE TABLE IF NOT EXISTS ${rel} (${qIdent(ROW_COLUMN)} bigserial, ${opts.columns.map((c) => `${qIdent(c)} text`).join(', ')})`)
    for (const c of opts.columns) await client.query(`ALTER TABLE ${rel} ADD COLUMN IF NOT EXISTS ${qIdent(c)} text`)
    await insertRows(client, rel, opts.columns, opts.rows)
    let rowCount: number | null = null
    if (opts.final) {
      if (opts.mode === 'replace') {
        await client.query(`DROP TABLE IF EXISTS ${target}`)
        await client.query(`ALTER TABLE ${staging} RENAME TO ${qIdent(physical)}`)
      }
      rowCount = (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${target}`)).rows[0].n
    }
    await client.query('COMMIT')
    return { rowCount }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function dropFileTable(storageKey: string, table: string) {
  const physical = physicalTable(storageKey, table)
  await pool.query(`DROP TABLE IF EXISTS ${rawRel(physical)}`)
  await pool.query(`DROP TABLE IF EXISTS ${rawRel(`${physical}__up`)}`)
}

/** Removes every table of a file source (when the source is deleted). */
export async function dropAllFileTables(storageKey: string) {
  for (const t of await listTables(storageKey)) await dropFileTable(storageKey, t.name)
}
