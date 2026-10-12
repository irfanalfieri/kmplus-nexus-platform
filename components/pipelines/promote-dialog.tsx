'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Promote pipeline">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="mr-auto font-semibold">Promote pipeline</h3>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {!preview && !error && (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking the next environment…
          </div>
        )}
        {preview && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{preview.pipeline.name}</span>
              <span className="text-muted-foreground">v{preview.pipeline.version}</span>
              <EnvironmentBadge environment={preview.from.environment} />
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <EnvironmentBadge environment={preview.target.environment} />
              <span className="text-muted-foreground">{preview.target.name}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {preview.existing ? `Updates the pipeline there (runs v${preview.existing.publishedVersion || '–'} now).` : 'Creates the pipeline there, with its schedule off until someone turns it on.'} Data sources are matched by name, so it uses the credentials of {ENVIRONMENT_INFO[preview.target.environment].label}.
            </p>
            {preview.items.length > 0 && (
              <ul className="space-y-1 rounded-md border border-border p-2 text-xs">
                {preview.items.map((i) => (
                  <li key={`${i.kind}:${i.name}`} className="flex items-center gap-2">
                    {i.status === 'missing' ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                    <span className="text-muted-foreground">{i.kind}</span>
                    <span className="font-medium">{i.name}</span>
                    {i.detail && <span className="text-muted-foreground">({i.detail})</span>}
                    <span className="ml-auto text-muted-foreground">{STATUS_TEXT[i.status]}</span>
                  </li>
                ))}
              </ul>
            )}
            {preview.blocking.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <p className="mb-1 font-medium">Fix these first:</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {preview.blocking.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.approvalReasons.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                <p className="mb-1 font-medium">Needs approval in {preview.target.name}:</p>
                <ul className="list-inside list-disc">
                  {preview.approvalReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the approver (optional)" aria-label="Promotion note" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void promote()} disabled={busy || preview.blocking.length > 0}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Promote to {ENVIRONMENT_INFO[preview.target.environment].label}
              </Button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
