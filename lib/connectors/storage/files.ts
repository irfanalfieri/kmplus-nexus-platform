import type { ColumnType } from '@/lib/pipelines/definition'
import type { ConnectionTestResult, SchemaScanResult, SchemaTable } from '../types'
import { toSheet, type Cell } from '@/lib/files/parse'
import { configError, inferColumns, scanResult, type Row } from '../http'

/**
 * Files in cloud object storage (S3-compatible, Azure Blob, Google Cloud
 * Storage) as tables, read-only. Each CSV / TSV / JSON / NDJSON / XLSX file is a
 * table named after its path; a folder with several files of one format is also
 * a table "folder/*.csv" that reads them all (with a _source_file column), so
 * daily exports with new names keep feeding the same pipeline.
 */

export interface StorageObject {
  key: string
  size: number
  modified: string | null
}

export interface StorageClient {
  /** "S3 bucket hr-exports" … for messages. */
  label: string
  /** Objects under the prefix (recursive), up to `max`. */
  list(prefix: string, max: number): Promise<StorageObject[]>
  /** The object's bytes; with a range, only bytes [start, end]. */
  get(key: string, range?: [number, number]): Promise<Buffer>
}

export const FILE_FORMATS = ['csv', 'tsv', 'json', 'ndjson', 'jsonl', 'xlsx'] as const
type Format = (typeof FILE_FORMATS)[number]
/** Files larger than this are refused (split the export). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024
const MAX_OBJECTS = 5000

const formatOf = (key: string): Format | null => {
  const ext = key.split('.').pop()?.toLowerCase()
  return (FILE_FORMATS as readonly string[]).includes(ext ?? '') ? (ext as Format) : null
}

export const normalizePrefix = (raw: string | undefined) => {
  const p = (raw ?? '').trim().replace(/^\/+/, '')
  return p && !p.endsWith('/') ? `${p}/` : p
}

export interface FileTable {
  name: string
  format: Format
  /** Object keys read for this table. */
  keys: string[]
  size: number
  modified: string | null
}

/** Tables for a listing: one per supported file, plus one per folder+format holding 2 or more files. */
export function fileTables(objects: StorageObject[], prefix: string): FileTable[] {
  const files = objects.filter((o) => formatOf(o.key) && !o.key.endsWith('/'))
  const rel = (key: string) => key.slice(prefix.length)
  const tables: FileTable[] = files.map((o) => ({ name: rel(o.key), format: formatOf(o.key)!, keys: [o.key], size: o.size, modified: o.modified }))
  const groups = new Map<string, StorageObject[]>()
  for (const o of files) {
    const r = rel(o.key)
    const dir = r.includes('/') ? r.slice(0, r.lastIndexOf('/') + 1) : ''
    const k = `${dir}*.${formatOf(o.key)}`
    groups.set(k, [...(groups.get(k) ?? []), o])
  }
  for (const [name, list] of groups) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.key.localeCompare(b.key))
    tables.push({ name, format: formatOf(sorted[0].key)!, keys: sorted.map((o) => o.key), size: sorted.reduce((n, o) => n + o.size, 0), modified: sorted.map((o) => o.modified ?? '').sort().pop() || null })
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 1000)
}

function typed(value: string | null, type: ColumnType): unknown {
  if (value === null) return null
  if (type === 'integer' || type === 'numeric') {
    const n = Number(value)
    return Number.isFinite(n) ? n : value
  }
  if (type === 'boolean') return /^(true|yes|y|1)$/i.test(value)
  return value
}

function sheetRows(data: Cell[][], maxRows: number): Row[] {
  const sheet = toSheet(data)
  return sheet.rows.slice(0, maxRows).map((r) => Object.fromEntries(sheet.columns.map((c, i) => [c.name, typed(r[i], c.type)])))
}

/** Parses one file's bytes. `partial`: the bytes may end mid-record (a ranged read), so the last line is dropped. */
export async function parseFile(format: Format, bytes: Buffer, maxRows: number, partial = false): Promise<Row[]> {
  if (format === 'xlsx') {
    const { default: readXlsxFile } = await import('read-excel-file/node')
    const sheets = (await readXlsxFile(bytes)) as unknown as { sheet: string; data: Cell[][] }[]
    return sheetRows(sheets[0]?.data ?? [], maxRows)
  }
  let text = bytes.toString('utf8').replace(/^﻿/, '')
  if (partial && text.includes('\n')) text = text.slice(0, text.lastIndexOf('\n'))
  if (format === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw configError('The JSON file could not be parsed. JSON Lines files should end in .ndjson or .jsonl.')
    }
    const list = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>).find(Array.isArray) ?? [parsed]
    return (list as Row[]).filter((r) => r && typeof r === 'object').slice(0, maxRows)
  }
  if (format === 'ndjson' || format === 'jsonl') {
    const rows: Row[] = []
    for (const line of text.split(/\r?\n/)) {
      if (rows.length >= maxRows) break
      if (!line.trim()) continue
      try {
        rows.push(JSON.parse(line) as Row)
      } catch {
        if (!partial) throw configError('A line of the JSON Lines file is not valid JSON.')
      }
    }
    return rows
  }
  const { default: Papa } = await import('papaparse')
  const data = Papa.parse<string[]>(text, { skipEmptyLines: true, delimiter: format === 'tsv' ? '\t' : '' }).data as Cell[][]
  return sheetRows(data, maxRows)
}

/** The first rows of a file: CSV/TSV/NDJSON read only their first 1 MB. */
async function headRows(client: StorageClient, key: string, format: Format, size: number, limit: number): Promise<Row[]> {
  if (size > MAX_FILE_BYTES && format !== 'csv' && format !== 'tsv' && format !== 'ndjson' && format !== 'jsonl') throw configError(`${key} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
  const ranged = (format === 'csv' || format === 'tsv' || format === 'ndjson' || format === 'jsonl') && size > 1_048_576
  const bytes = await client.get(key, ranged ? [0, 1_048_575] : undefined)
  return parseFile(format, bytes, limit, ranged)
}

export async function listTables(client: StorageClient, prefix: string) {
  return fileTables(await client.list(prefix, MAX_OBJECTS), prefix)
}

export async function testStorage(client: StorageClient, prefix: string): Promise<ConnectionTestResult> {
  try {
    const objects = await client.list(prefix, MAX_OBJECTS)
    const tables = fileTables(objects, prefix)
    return { ok: true, message: `Connected to ${client.label}: ${objects.length} objects, ${tables.length} readable files and folders.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${client.label} connection failed.` }
  }
}

export async function scanStorage(client: StorageClient, prefix: string, method: string): Promise<SchemaScanResult> {
  const tables = await listTables(client, prefix)
  const out: SchemaTable[] = []
  // Columns come from the first rows of the first file of each table (at most 40 files are opened).
  for (const [i, t] of tables.entries()) {
    const rows = i < 40 ? await headRows(client, t.keys[0], t.format, t.size, 50).catch(() => []) : []
    out.push({ schema: 'storage', name: t.name, columns: [...inferColumns(rows), ...(t.keys.length > 1 ? [{ name: '_source_file', type: 'TEXT', nullable: false }] : [])], rowCount: null })
  }
  return scanResult(out, method)
}

function tableFor(tables: FileTable[], name: string, label: string) {
  const t = tables.find((x) => x.name === name)
  if (!t) throw configError(`No file or folder "${name}" in ${label}. Test the data source again to refresh its tables.`)
  return t
}

export async function sampleStorage(client: StorageClient, prefix: string, table: string, limit = 25) {
  const t = tableFor(await listTables(client, prefix), table, client.label)
  const rows = await headRows(client, t.keys[0], t.format, t.size, limit)
  const withFile = t.keys.length > 1 ? rows.map((r) => ({ ...r, _source_file: t.keys[0] })) : rows
  return { tableName: table, columns: withFile.length ? Object.keys(withFile[0]) : [], rows: withFile, totalRows: withFile.length }
}

/** Every row of the table's files, in file order, up to maxRows. */
export async function readStorage(client: StorageClient, prefix: string, table: string, maxRows: number): Promise<Row[]> {
  const t = tableFor(await listTables(client, prefix), table, client.label)
  const rows: Row[] = []
  for (const key of t.keys) {
    if (rows.length >= maxRows) break
    const bytes = await client.get(key)
    if (bytes.length > MAX_FILE_BYTES) throw configError(`${key} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
    const part = await parseFile(t.format, bytes, maxRows - rows.length)
    rows.push(...(t.keys.length > 1 ? part.map((r) => ({ ...r, _source_file: key })) : part))
  }
  return rows
}

/** Minimal XML helpers for S3 / Azure listings (no XML library needed). */
export const xmlBlocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1])
export const xmlText = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&') : null
}
