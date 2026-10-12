'use client'

import { useState } from 'react'
import { FileSpreadsheet, Loader2, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { Table, THead, TBody, Tr, Td } from '@/components/ui/data-table'
import { deleteFileTable, uploadFilePart } from '@/lib/actions/files'
import { cleanTableName as cleanName, toSheet, uploadParts, type Cell, type ParsedSheet } from '@/lib/files/parse'
import { COLUMN_TYPES, type ColumnType } from '@/lib/pipelines/definition'
import { NativeSelect } from '@/components/pipelines/step-editors'
import type { UploadedFile } from '@/app/actions/files'

const MAX_BYTES = 50 * 1024 * 1024

type Loaded = { fileName: string; sheets: { name: string; data: Cell[][] }[] }

async function parseFile(file: File): Promise<Loaded> {
  if (file.size > MAX_BYTES) throw new Error('Files can be at most 50 MB. Split larger exports.')
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(file)
    return { fileName: file.name, sheets: sheets.map((s) => ({ name: s.sheet, data: s.data as unknown as Cell[][] })) }
  }
  if (/\.(csv|tsv|txt)$/i.test(file.name)) {
    const Papa = (await import('papaparse')).default
    const text = await file.text()
    const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy', delimiter: /\.tsv$/i.test(file.name) ? '\t' : '' })
    if (res.errors.length && !res.data.length) throw new Error(`Could not read the CSV: ${res.errors[0].message}`)
    return { fileName: file.name, sheets: [{ name: 'CSV', data: res.data }] }
  }
  throw new Error('Choose a .csv, .tsv or .xlsx file. Old .xls files: save as .xlsx first.')
}

export default function FileUploadDialog({ sourceId, sourceName, files, onClose, onDone }: { sourceId: string; sourceName: string; files: UploadedFile[]; onClose: () => void; onDone: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [headerRow, setHeaderRow] = useState(1)
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [table, setTable] = useState('')
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [confirm, confirmEl] = useConfirm()

  const build = (l: Loaded, index: number, header: number) => {
    const data = l.sheets[index]?.data ?? []
    setSheet(toSheet(data, Math.max(0, header - 1)))
  }

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setDone('')
    setParsing(true)
    try {
      const l = await parseFile(file)
      if (!l.sheets.length) throw new Error('The file has no sheets.')
      setLoaded(l)
      setSheetIndex(0)
      setHeaderRow(1)
      build(l, 0, 1)
      const name = cleanName(l.sheets.length > 1 ? `${file.name.replace(/\.[^.]+$/, '')}_${l.sheets[0].name}` : file.name)
      setTable(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file')
      setLoaded(null)
      setSheet(null)
    } finally {
      setParsing(false)
    }
  }

  const upload = async () => {
    if (!loaded || !sheet) return
    setError('')
    if (!sheet.rows.length) return setError('The sheet has no data rows under the header.')
    const name = cleanName(table)
    if (name !== table) return setTable(name)
    const parts = uploadParts(sheet.rows)
    setProgress({ sent: 0, total: sheet.rows.length })
    try {
      let sent = 0
      let rowCount: number | null = null
      for (let i = 0; i < parts.length; i++) {
        sent += parts[i].length
        const res = await uploadFilePart({
          dataSourceId: sourceId,
          table,
          fileName: loaded.fileName,
          sheet: loaded.sheets.length > 1 ? loaded.sheets[sheetIndex].name : undefined,
          columns: sheet.columns,
          rows: parts[i],
          part: i,
          final: i === parts.length - 1,
          mode,
          sent,
        })
        rowCount = res.rowCount
        setProgress({ sent, total: sheet.rows.length })
      }
      setDone(`Uploaded ${sheet.rows.length.toLocaleString()} rows to "${table}"${rowCount !== null ? ` (now ${rowCount.toLocaleString()} rows)` : ''}. Pipelines can read it as a table of ${sourceName}.`)
      setLoaded(null)
      setSheet(null)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setProgress(null)
    }
  }

  const drop = async (t: string) => {
    const ok = await confirm({
      title: `Delete table "${t}"?`,
      description: 'The table and its uploaded rows are removed from this data source.',
      confirmLabel: 'Delete table',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteFileTable(sourceId, t)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const setType = (i: number, type: ColumnType) => sheet && setSheet({ ...sheet, columns: sheet.columns.map((c, j) => (j === i ? { ...c, type } : c)) })
  const setName = (i: number, name: string) => sheet && setSheet({ ...sheet, columns: sheet.columns.map((c, j) => (j === i ? { ...c, name } : c)) })

  const pct = progress ? Math.round((progress.sent / Math.max(1, progress.total)) * 100) : 0

  return (
    <Modal
      onClose={onClose}
      dirty={!!loaded || !!progress}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-primary" aria-hidden />
          Upload CSV or Excel
        </span>
      }
      description={`${sourceName} · each sheet becomes a table pipelines can read`}
      bodyClassName="space-y-4"
      footer={
        <>
          {progress ? (
            <div className="mr-auto flex flex-1 items-center gap-2 text-sm">
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="h-2 max-w-xs flex-1 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="font-mono text-xs">
                {progress.sent.toLocaleString()} / {progress.total.toLocaleString()} rows
              </span>
            </div>
          ) : (
            <span className="mr-auto" />
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void upload()} disabled={!sheet || !!progress || !table}>
            {progress ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            Upload
          </Button>
        </>
      }
    >
      {confirmEl}
      {files.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Uploaded tables</h3>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {files.map((f) => (
              <li key={f.table} className="flex flex-wrap items-center gap-2 p-2">
                <span className="font-mono">{f.table}</span>
                <Badge variant="outline" className="font-mono">
                  {f.rowCount.toLocaleString()} rows
                </Badge>
                <span className="flex-1 text-xs text-muted-foreground">
                  {f.fileName}
                  {f.sheet ? ` · ${f.sheet}` : ''} · <span className="font-mono">{new Date(f.uploadedAt).toLocaleString()}</span> · {f.uploadedBy}
                </span>
                <Button size="icon-sm" variant="ghost" onClick={() => void drop(f.table)} aria-label={`Delete ${f.table}`}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center hover:bg-muted/50 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring">
        {parsing ? <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden /> : <Upload className="size-6 text-muted-foreground" aria-hidden />}
        <span className="text-sm font-medium">{loaded ? loaded.fileName : 'Choose a .csv, .tsv or .xlsx file'}</span>
        <span className="text-xs text-muted-foreground">Read in your browser; up to 50 MB and 500,000 rows. The first row should hold the column names.</span>
        <input type="file" accept=".csv,.tsv,.txt,.xlsx" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
      </label>

      {loaded && sheet && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            {loaded.sheets.length > 1 && (
              <label>
                <span className="mb-1 block text-xs text-muted-foreground">Sheet</span>
                <NativeSelect
                  className="w-48"
                  value={String(sheetIndex)}
                  onChange={(v) => {
                    const i = Number(v)
                    setSheetIndex(i)
                    build(loaded, i, headerRow)
                    setTable(cleanName(`${loaded.fileName.replace(/\.[^.]+$/, '')}_${loaded.sheets[i].name}`))
                  }}
                >
                  {loaded.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <label>
              <span className="mb-1 block text-xs text-muted-foreground">Header row</span>
              <Input
                type="number"
                min={1}
                max={50}
                className="w-24 font-mono"
                value={headerRow}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(50, Number(e.target.value) || 1))
                  setHeaderRow(n)
                  build(loaded, sheetIndex, n)
                }}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs text-muted-foreground">Table name</span>
              <Input className="w-64 font-mono" value={table} onChange={(e) => setTable(e.target.value)} onBlur={() => setTable(cleanName(table))} />
            </label>
            <label>
              <span className="mb-1 block text-xs text-muted-foreground">If the table exists</span>
              <NativeSelect className="w-48" value={mode} onChange={(v) => setMode(v as 'replace' | 'append')}>
                <option value="replace">Replace its rows</option>
                <option value="append">Add these rows</option>
              </NativeSelect>
            </label>
            <span className="pb-2 font-mono text-xs text-muted-foreground">
              {sheet.rows.length.toLocaleString()} rows · {sheet.columns.length} columns
            </span>
          </div>

          <div className="max-h-80 overflow-auto rounded-md border border-border">
            <Table label="File preview: first 20 rows" className="text-xs">
              <THead className="sticky top-0 z-10 bg-muted">
                <tr>
                  {sheet.columns.map((c, i) => (
                    <th key={i} scope="col" className="min-w-[140px] p-1 text-left align-top font-medium">
                      <Input className="h-7 font-mono text-xs" value={c.name} onChange={(e) => setName(i, e.target.value)} aria-label={`Column ${i + 1} name`} />
                      <NativeSelect className="mt-1 h-7 text-xs" value={c.type} onChange={(v) => setType(i, v as ColumnType)} aria-label={`Column ${i + 1} type`}>
                        {COLUMN_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </NativeSelect>
                    </th>
                  ))}
                </tr>
              </THead>
              <TBody>
                {sheet.rows.slice(0, 20).map((r, i) => (
                  <Tr key={i}>
                    {r.map((v, j) => (
                      <Td key={j} className="max-w-[220px] truncate px-2 py-1 font-mono whitespace-nowrap first:pl-2 last:pr-2" title={v ?? ''}>
                        {v ?? (
                          <span className="text-muted-foreground" aria-label="empty">
                            ∅
                          </span>
                        )}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">Types are detected from the first 2,000 rows; codes with leading zeros stay text. Values are stored as written in the file; pipelines convert them using these types.</p>
        </div>
      )}
      {done && <Notice tone="success">{done}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
    </Modal>
  )
}
