'use client'

import { useEffect, useId, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { previewPromotion, promotePipeline } from '@/lib/actions/environments'
import { ENVIRONMENT_INFO } from '@/lib/pipelines/promote'
import { EnvironmentBadge } from '@/components/workspace/environment-badge'
import { useT } from '@/components/i18n/i18n-provider'
import type { MessageKey } from '@/lib/i18n/translate'

type Preview = Awaited<ReturnType<typeof previewPromotion>>

const STATUS_TEXT: Record<string, MessageKey> = {
  mapped: 'editor.promote.status.mapped',
  missing: 'editor.promote.status.missing',
  create: 'editor.promote.status.create',
  update: 'editor.promote.status.update',
  same: 'editor.promote.status.same',
  conflict: 'editor.promote.status.conflict',
}
const KIND_TEXT: Record<string, MessageKey> = {
  'data source': 'editor.promote.kind.dataSource',
  'business rule': 'editor.promote.kind.businessRule',
  pipeline: 'editor.promote.kind.pipeline',
  'dataset schema': 'editor.promote.kind.datasetSchema',
}

/** Promote a pipeline's published version to the next environment (GV-7). */
export default function PromoteDialog({ pipelineId, onClose, onDone }: { pipelineId: string; onClose: () => void; onDone: (text: string) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const noteId = useId()
  const t = useT()
  const envLabel = (env: keyof typeof ENVIRONMENT_INFO) => t(`editor.promote.env.${env}`)

  useEffect(() => {
    previewPromotion(pipelineId)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : t('editor.promote.prepareFailed')))
  }, [pipelineId, t])

  const promote = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await promotePipeline({ pipelineId, note })
      const where = `${envLabel(res.target.environment)} (${res.target.name})`
      onDone(res.published ? t('editor.promote.donePublished', { where, version: res.version }) : t('editor.promote.doneApproval', { where, version: res.version }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('editor.promote.failed'))
      setBusy(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="md"
      title={t('editor.promote.title')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {preview && (
            <Button onClick={() => void promote()} disabled={busy || preview.blocking.length > 0}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {t('editor.promote.promoteTo', { env: envLabel(preview.target.environment) })}
            </Button>
          )}
        </>
      }
    >
      {!preview && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t('editor.promote.checking')}
        </div>
      )}
      {preview && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{preview.pipeline.name}</span>
            <span className="font-mono text-muted-foreground">v{preview.pipeline.version}</span>
            <EnvironmentBadge environment={preview.from.environment} />
            <ArrowRight className="size-4 text-muted-foreground" aria-label={t('editor.promote.to')} />
            <EnvironmentBadge environment={preview.target.environment} />
            <span className="text-muted-foreground">{preview.target.name}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {preview.existing ? t('editor.promote.updates', { version: preview.existing.publishedVersion || '–' }) : t('editor.promote.creates')}{' '}
            {t('editor.promote.matchedByName', { env: envLabel(preview.target.environment) })}
          </p>
          {preview.items.length > 0 && (
            <ul className="space-y-1 rounded-md border border-border p-2 text-xs" aria-label={t('editor.promote.maps')}>
              {preview.items.map((i) => (
                <li key={`${i.kind}:${i.name}`} className="flex items-center gap-2">
                  {i.status === 'missing' || i.status === 'conflict' ? <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-hidden /> : <CheckCircle2 className="size-3.5 shrink-0 text-live" aria-hidden />}
                  <span className="text-muted-foreground">{KIND_TEXT[i.kind] ? t(KIND_TEXT[i.kind]) : i.kind}</span>
                  <span className="font-mono font-medium">{i.name}</span>
                  {i.detail && <span className="text-muted-foreground">({i.detail === 'runs after' ? t('editor.promote.runsAfter') : i.detail})</span>}
                  <span className={i.status === 'missing' || i.status === 'conflict' ? 'ml-auto font-medium text-danger-text' : 'ml-auto text-muted-foreground'}>{STATUS_TEXT[i.status] ? t(STATUS_TEXT[i.status]) : i.status}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.blocking.length > 0 && (
            <Notice tone="danger" title={t('editor.promote.fixFirst')} className="text-xs">
              <ul className="list-inside list-disc space-y-0.5">
                {preview.blocking.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Notice>
          )}
          {preview.approvalReasons.length > 0 && (
            <Notice tone="held" title={t('editor.promote.needsApproval', { name: preview.target.name })} className="text-xs">
              <ul className="list-inside list-disc">
                {preview.approvalReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Notice>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={noteId} className="text-xs text-muted-foreground">
              {t('editor.promote.note')}
            </Label>
            <Input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      )}
      {error && (
        <Notice tone="danger" className="mt-3">
          {error}
        </Notice>
      )}
    </Modal>
  )
}
