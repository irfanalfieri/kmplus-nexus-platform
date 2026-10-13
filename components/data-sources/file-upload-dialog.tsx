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
import { usePrefs } from '@/components/i18n/i18n-provider'
import type { Translate } from '@/lib/i18n/translate'

const MAX_BYTES = 50 * 1024 * 1024

type Loaded = { fileName: string; sheets: { name: string; data: Cell[][] }[] }

async function parseFile(file: File, t: Translate): Promise<Loaded> {
  if (file.size > MAX_BYTES) throw new Error(t('connect.fileUpload.tooLarge'))
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(file)
    return { fileName: file.name, sheets: sheets.map((s) => ({ name: s.sheet, data: s.data as unknown as Cell[][] })) }
  }
  if (/\.(csv|tsv|txt)$/i.test(file.name)) {
    const Papa = (await import('papaparse')).default
    const text = await file.text()
    const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy', delimiter: /\.tsv$/i.test(file.name) ? '\t' : '' })
    if (res.errors.length && !res.data.length) throw new Error(t('connect.fileUpload.csvError', { message: res.errors[0].message }))
    return { fileName: file.name, sheets: [{ name: 'CSV', data: res.data }] }
  }
  throw new Error(t('connect.fileUpload.wrongType'))
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
  const { t, formatNumber, formatDateTime } = usePrefs()

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
      const l = await parseFile(file, t)
      if (!l.sheets.length) throw new Error(t('connect.fileUpload.noSheets'))
      setLoaded(l)
      setSheetIndex(0)
      setHeaderRow(1)
      build(l, 0, 1)
      const name = cleanName(l.sheets.length > 1 ? `${file.name.replace(/\.[^.]+$/, '')}_${l.sheets[0].name}` : file.name)
      setTable(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('connect.fileUpload.readFailed'))
      setLoaded(null)
      setSheet(null)
    } finally {
      setParsing(false)
    }
  }

  const upload = async () => {
    if (!loaded || !sheet) return
    setError('')
    if (!sheet.rows.length) return setError(t('connect.fileUpload.noDataRows'))
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
      setDone(
        t('connect.fileUpload.uploaded', {
          rows: t('common.rows', { count: formatNumber(sheet.rows.length) }),
          table,
          total: rowCount !== null ? t('connect.fileUpload.nowTotal', { rows: t('common.rows', { count: formatNumber(rowCount) }) }) : '',
          source: sourceName,
        }),
      )
      setLoaded(null)
      setSheet(null)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('connect.fileUpload.uploadFailed'))
    } finally {
      setProgress(null)
    }
  }

  const drop = async (tableName: string) => {
    const ok = await confirm({
      title: t('connect.fileUpload.deleteTitle', { name: tableName }),
      description: t('connect.fileUpload.deleteDescription'),
      confirmLabel: t('connect.fileUpload.deleteConfirm'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteFileTable(sourceId, tableName)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('connect.fileUpload.deleteFailed'))
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
          {t('connect.fileUpload.title')}
        </span>
      }
      description={t('connect.fileUpload.description', { source: sourceName })}
      bodyClassName="space-y-4"
      footer={
        <>
          {progress ? (
            <div className="mr-auto flex flex-1 items-center gap-2 text-sm">
              <div
                role="progressbar"
                aria-label={t('connect.fileUpload.progress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="h-2 max-w-xs flex-1 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="font-mono text-xs">
                {t('connect.fileUpload.progressRows', { sent: formatNumber(progress.sent), total: formatNumber(progress.total) })}
              </span>
            </div>
          ) : (
            <span className="mr-auto" />
          )}
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={() => void upload()} disabled={!sheet || !!progress || !table}>
            {progress ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            {t('connect.fileUpload.upload')}
          </Button>
        </>
      }
    >
      {confirmEl}
      {files.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">{t('connect.fileUpload.uploadedTables')}</h3>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {files.map((f) => (
              <li key={f.table} className="flex flex-wrap items-center gap-2 p-2">
                <span className="font-mono">{f.table}</span>
                <Badge variant="outline" className="font-mono">
                  {t('common.rows', { count: formatNumber(f.rowCount) })}
                </Badge>
                <span className="flex-1 text-xs text-muted-foreground">
                  {f.fileName}
                  {f.sheet ? ` · ${f.sheet}` : ''} · <span className="font-mono">{formatDateTime(f.uploadedAt)}</span> · {f.uploadedBy}
                </span>
                <Button size="icon-sm" variant="ghost" onClick={() => void drop(f.table)} aria-label={t('connect.fileUpload.deleteAria', { name: f.table })}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center hover:bg-muted/50 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring">
        {parsing ? <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden /> : <Upload className="size-6 text-muted-foreground" aria-hidden />}
        <span className="text-sm font-medium">{loaded ? loaded.fileName : t('connect.fileUpload.choose')}</span>
        <span className="text-xs text-muted-foreground">{t('connect.fileUpload.chooseHint')}</span>
        <input type="file" accept=".csv,.tsv,.txt,.xlsx" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
      </label>

      {loaded && sheet && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            {loaded.sheets.length > 1 && (
              <label>
                <span className="mb-1 block text-xs text-muted-foreground">{t('connect.fileUpload.sheet')}</span>
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
              <span className="mb-1 block text-xs text-muted-foreground">{t('connect.fileUpload.headerRow')}</span>
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
              <span className="mb-1 block text-xs text-muted-foreground">{t('connect.fileUpload.tableName')}</span>
              <Input className="w-64 font-mono" value={table} onChange={(e) => setTable(e.target.value)} onBlur={() => setTable(cleanName(table))} />
            </label>
            <label>
              <span className="mb-1 block text-xs text-muted-foreground">{t('connect.fileUpload.ifExists')}</span>
              <NativeSelect className="w-48" value={mode} onChange={(v) => setMode(v as 'replace' | 'append')}>
                <option value="replace">{t('connect.fileUpload.replace')}</option>
                <option value="append">{t('connect.fileUpload.append')}</option>
              </NativeSelect>
            </label>
            <span className="pb-2 font-mono text-xs text-muted-foreground">
              {t('common.rows', { count: formatNumber(sheet.rows.length) })} · {t('connect.fileUpload.columns', { count: sheet.columns.length })}
            </span>
          </div>

          <div className="max-h-80 overflow-auto rounded-md border border-border">
            <Table label={t('connect.fileUpload.previewLabel')} className="text-xs">
              <THead className="sticky top-0 z-10 bg-muted">
                <tr>
                  {sheet.columns.map((c, i) => (
                    <th key={i} scope="col" className="min-w-[140px] p-1 text-left align-top font-medium">
                      <Input className="h-7 font-mono text-xs" value={c.name} onChange={(e) => setName(i, e.target.value)} aria-label={t('connect.fileUpload.columnName', { n: i + 1 })} />
                      <NativeSelect className="mt-1 h-7 text-xs" value={c.type} onChange={(v) => setType(i, v as ColumnType)} aria-label={t('connect.fileUpload.columnType', { n: i + 1 })}>
                        {COLUMN_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
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
                          <span className="text-muted-foreground" aria-label={t('connect.fileUpload.empty')}>
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
          <p className="text-xs text-muted-foreground">{t('connect.fileUpload.typesHint')}</p>
        </div>
      )}
      {done && <Notice tone="success">{done}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
    </Modal>
  )
}
