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

type Preview = Awaited<ReturnType<typeof previewPromotion>>

const STATUS_TEXT: Record<string, string> = {
  mapped: 'found',
  missing: 'missing',
  create: 'will be created',
  update: 'will be updated',
  same: 'same',
}

/** Promote a pipeline's published version to the next environment (GV-7). */
export default function PromoteDialog({ pipelineId, onClose, onDone }: { pipelineId: string; onClose: () => void; onDone: (text: string) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const noteId = useId()

  useEffect(() => {
    previewPromotion(pipelineId)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not prepare the promotion'))
  }, [pipelineId])

  const promote = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await promotePipeline({ pipelineId, note })
      const where = `${ENVIRONMENT_INFO[res.target.environment].label} (${res.target.name})`
      onDone(res.published ? `Promoted to ${where} as v${res.version}; it runs there now.` : `Promoted to ${where} as v${res.version}; it waits for approval there.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promotion failed')
      setBusy(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="md"
      title="Promote pipeline"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {preview && (
            <Button onClick={() => void promote()} disabled={busy || preview.blocking.length > 0}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Promote to {ENVIRONMENT_INFO[preview.target.environment].label}
            </Button>
          )}
        </>
      }
    >
      {!preview && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Checking the next environment…
        </div>
      )}
      {preview && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{preview.pipeline.name}</span>
            <span className="font-mono text-muted-foreground">v{preview.pipeline.version}</span>
            <EnvironmentBadge environment={preview.from.environment} />
            <ArrowRight className="size-4 text-muted-foreground" aria-label="to" />
            <EnvironmentBadge environment={preview.target.environment} />
            <span className="text-muted-foreground">{preview.target.name}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {preview.existing ? `Updates the pipeline there (runs v${preview.existing.publishedVersion || '–'} now).` : 'Creates the pipeline there, with its schedule off until someone turns it on.'} Data sources are matched by name, so it
            uses the credentials of {ENVIRONMENT_INFO[preview.target.environment].label}.
          </p>
          {preview.items.length > 0 && (
            <ul className="space-y-1 rounded-md border border-border p-2 text-xs" aria-label="What the promotion maps">
              {preview.items.map((i) => (
                <li key={`${i.kind}:${i.name}`} className="flex items-center gap-2">
                  {i.status === 'missing' ? <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-hidden /> : <CheckCircle2 className="size-3.5 shrink-0 text-live" aria-hidden />}
                  <span className="text-muted-foreground">{i.kind}</span>
                  <span className="font-mono font-medium">{i.name}</span>
                  {i.detail && <span className="text-muted-foreground">({i.detail})</span>}
                  <span className={i.status === 'missing' ? 'ml-auto font-medium text-danger-text' : 'ml-auto text-muted-foreground'}>{STATUS_TEXT[i.status]}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.blocking.length > 0 && (
            <Notice tone="danger" title="Fix these first:" className="text-xs">
              <ul className="list-inside list-disc space-y-0.5">
                {preview.blocking.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Notice>
          )}
          {preview.approvalReasons.length > 0 && (
            <Notice tone="held" title={`Needs approval in ${preview.target.name}:`} className="text-xs">
              <ul className="list-inside list-disc">
                {preview.approvalReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Notice>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={noteId} className="text-xs text-muted-foreground">
              Note for the approver (optional)
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
