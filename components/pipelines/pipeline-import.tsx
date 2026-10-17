'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { Modal } from '@/components/ui/dialog'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { exportPipeline, importPipeline, previewImport } from '@/lib/actions/pipeline-transfer'
import type { MessageKey } from '@/lib/i18n/translate'

type Preview = Awaited<ReturnType<typeof previewImport>>

/** VC-5: downloads a pipeline as JSON (no credentials, no rows). */
export async function downloadPipelineExport(id: string) {
  const { fileName, json } = await exportPipeline(id)
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const KIND: Record<string, MessageKey> = { 'data source': 'editor.promote.kind.dataSource', 'business rule': 'editor.promote.kind.businessRule', pipeline: 'editor.promote.kind.pipeline', 'dataset schema': 'editor.promote.kind.datasetSchema' }
const STATUS: Record<string, MessageKey> = { mapped: 'editor.promote.status.mapped', missing: 'editor.promote.status.missing', create: 'editor.promote.status.create', update: 'editor.promote.status.update', same: 'editor.promote.status.same', conflict: 'editor.promote.status.conflict' }

/** VC-5: reads an exported pipeline, maps its data sources and rules onto this workspace, and creates it as a draft. */
export function ImportPipelineDialog({ onClose, onImported }: { onClose: () => void; onImported: (id: string) => void }) {
  const { t, formatDateTime } = usePrefs()
  const [json, setJson] = useState('')
  const [fileName, setFileName] = useState('')
  const [sourceMap, setSourceMap] = useState<Record<string, string>>({})
  const [name, setName] = useState<string | undefined>(undefined)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!json) return
    let cancelled = false
    setBusy(true)
    setError('')
    previewImport({ json, sourceMap, name })
      .then((p) => {
        if (cancelled) return
        setPreview(p)
        if (name === undefined) setName(p.name)
      })
      .catch((err) => !cancelled && (setPreview(null), setError(err instanceof Error ? err.message : t('pipelines.transfer.failed'))))
      .finally(() => !cancelled && setBusy(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, sourceMap, name])

  const readFile = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setPreview(null)
    setName(undefined)
    setSourceMap({})
    setJson(await file.text())
  }

  const doImport = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await importPipeline({ json, sourceMap, name })
      onImported(res.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pipelines.transfer.failed'))
      setBusy(false)
    }
  }

  const ready = preview && !preview.blocking.length && !preview.nameTaken && name?.trim()
  return (
    <Modal
      title={t('pipelines.transfer.importTitle')}
      description={t('pipelines.transfer.importDescription')}
      size="lg"
      onClose={onClose}
      dirty={Boolean(json)}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!ready || busy} onClick={() => void doImport()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />} {t('pipelines.transfer.importAsDraft')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border p-4 hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
          <FileUp className="size-5 text-muted-foreground" aria-hidden />
          <span className="flex-1">{fileName || t('pipelines.transfer.chooseFile')}</span>
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
        </label>
        {error && <Notice tone="danger">{error}</Notice>}
        {busy && !preview && (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </p>
        )}
        {preview && (
          <>
            <p className="text-xs text-muted-foreground">{t('pipelines.transfer.exported', { when: formatDateTime(preview.exportedAt, { dateStyle: 'medium', timeStyle: 'short' }), version: preview.exportedVersion, steps: preview.steps })}</p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('pipelines.transfer.name')}</span>
              <Input value={name ?? ''} onChange={(e) => setName(e.target.value)} />
              {preview.nameTaken && <span className="mt-1 block text-xs text-danger-text">{t('pipelines.transfer.nameTaken')}</span>}
            </label>

            {preview.sources.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-muted-foreground">{t('pipelines.transfer.sources')}</legend>
                {preview.sources.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2">
                    {s.targetId ? <CheckCircle2 className="size-4 text-live" aria-hidden /> : <AlertTriangle className="size-4 text-danger" aria-hidden />}
                    <span className="min-w-40 font-medium">{s.name} <span className="font-mono text-xs text-muted-foreground">{s.sourceType}</span></span>
                    <span aria-hidden>→</span>
                    <select
                      className={nativeSelectClass}
                      value={sourceMap[s.id] ?? s.targetId ?? ''}
                      onChange={(e) => setSourceMap({ ...sourceMap, [s.id]: e.target.value })}
                      aria-label={t('pipelines.transfer.sourceFor', { name: s.name })}
                    >
                      <option value="">{s.choices.length ? t('pipelines.transfer.chooseSource') : t('pipelines.transfer.noSourceOfType', { type: s.sourceType })}</option>
                      {s.choices.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </fieldset>
            )}

            {preview.items.filter((i) => i.kind !== 'data source').length > 0 && (
              <ul className="space-y-1 rounded-md border border-border p-2 text-xs">
                {preview.items.filter((i) => i.kind !== 'data source').map((i) => (
                  <li key={`${i.kind}:${i.name}`} className="flex items-center gap-2">
                    <span className="text-muted-foreground">{KIND[i.kind] ? t(KIND[i.kind]) : i.kind}</span>
                    <span className="font-mono font-medium">{i.name}</span>
                    <span className="ml-auto text-muted-foreground">{STATUS[i.status] ? t(STATUS[i.status]) : i.status}</span>
                  </li>
                ))}
                {preview.schemas.map((s) => (
                  <li key={`schema:${s.datasetName}`} className="flex items-center gap-2">
                    <span className="text-muted-foreground">{t('editor.promote.kind.datasetSchema')}</span>
                    <span className="font-mono font-medium">{s.datasetName}</span>
                    <span className="ml-auto text-muted-foreground">{s.status === 'create' ? t('editor.promote.status.create') : t('editor.promote.status.same')}</span>
                  </li>
                ))}
              </ul>
            )}
            {preview.warnings.map((w) => (
              <Notice key={w} tone="warning" className="text-xs">{w}</Notice>
            ))}
            {preview.blocking.map((b) => (
              <Notice key={b} tone="danger" className="text-xs">{b}</Notice>
            ))}
            <p className="text-xs text-muted-foreground">{t('pipelines.transfer.draftNote')}</p>
          </>
        )}
      </div>
    </Modal>
  )
}
