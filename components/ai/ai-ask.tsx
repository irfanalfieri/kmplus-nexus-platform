'use client'

import { useState } from 'react'
import { Loader2, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { askData } from '@/lib/actions/ai'
import type { Widget } from '@/lib/analytics/definition'
import { WidgetView } from '@/components/analytics/charts'
import { useAiStatus } from './use-ai'

type Answer = Awaited<ReturnType<typeof askData>>

const selectClass = 'h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'

/**
 * "Ask a question" (#14): the model turns the question into a chart query; Nexus
 * runs it like any Analytics widget (masks, row filters, read-only).
 */
export function AiAsk({ datasets, onAdd }: { datasets: string[]; onAdd?: (widget: Widget) => Promise<void> }) {
  const ai = useAiStatus()
  const [question, setQuestion] = useState('')
  const [dataset, setDataset] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [added, setAdded] = useState(false)
  if (!ai?.ready) return null

  const ask = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setAdded(false)
    try {
      setAnswer(await askData({ question, dataset: dataset || undefined }))
    } catch (err) {
      setAnswer(null)
      setError(err instanceof Error ? err.message : 'The AI request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label="Ask a question">
      <form onSubmit={ask} className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your data, e.g. How many active employees per department?" className="min-w-[240px] flex-1" aria-label="Question" />
        <select value={dataset} onChange={(e) => setDataset(e.target.value)} className={selectClass} aria-label="Dataset">
          <option value="">Any dataset</option>
          {datasets.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={busy || question.trim().length < 3}>
          {busy && <Loader2 className="animate-spin" aria-hidden />} {busy ? 'Thinking…' : 'Ask'}
        </Button>
      </form>
      {error && <Notice tone="danger">{error}</Notice>}
      {answer && (
        <div className="space-y-2">
          <div className="rounded-md border border-border p-3">
            <h3 className="mb-2 text-sm font-medium">{answer.widget.title || 'Answer'}</h3>
            <WidgetView widget={answer.widget} result={answer.result} />
          </div>
          <p className="text-xs text-muted-foreground">
            {answer.explanation} From dataset <span className="font-mono">{answer.widget.dataset}</span>; query written by <span className="font-mono">{answer.model}</span>, run with your access rules.
          </p>
          {onAdd && (
            <Button size="sm" variant="outline" disabled={added} onClick={() => void onAdd({ ...answer.widget, id: `w_${Math.random().toString(36).slice(2, 10)}` }).then(() => setAdded(true))}>
              <Plus aria-hidden /> {added ? 'Added to the dashboard' : 'Add to this dashboard'}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
