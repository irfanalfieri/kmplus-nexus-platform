'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { draftPipeline } from '@/lib/actions/ai'
import type { PipelineDraft } from '@/lib/ai/pipelines'
import { useT } from '@/components/i18n/i18n-provider'
import { useAiStatus } from './use-ai'

/** AI-2: "Describe the pipeline" → a draft opened in the editor. Nothing is saved until the person saves it. */
export function AiPipelineDraft({ onDraft }: { onDraft: (draft: PipelineDraft & { model: string }) => void }) {
  const ai = useAiStatus()
  const t = useT()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!ai?.ready) return null

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      onDraft(await draftPipeline({ text }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('assist.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
      <label htmlFor="ai-pipeline-text" className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="size-4 text-primary" aria-hidden /> {t('assist.pipeline.label')}
      </label>
      <textarea
        id="ai-pipeline-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder={t('assist.pipeline.placeholder')}
        aria-describedby="ai-pipeline-hint"
        className="w-full resize-y rounded-md border border-input bg-card px-2.5 py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void run()} disabled={busy || text.trim().length < 10}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? t('assist.pipeline.working') : t('assist.pipeline.action')}
        </Button>
        <p id="ai-pipeline-hint" className="flex-1 text-xs text-muted-foreground">
          {t('assist.pipeline.hint')}
        </p>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  )
}
