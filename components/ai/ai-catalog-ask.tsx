'use client'

import { useState } from 'react'
import { Loader2, MessageSquareText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { askCatalog } from '@/lib/actions/catalog'
import { usePrefs } from '@/components/i18n/i18n-provider'

type Result = Awaited<ReturnType<typeof askCatalog>>

/**
 * AI-5: ask the catalog in plain language ("Where is training hours by department?").
 * Works without a model (synonym ranking); a configured model re-ranks and explains.
 */
export function AiCatalogAsk({ onOpen }: { onOpen: (key: string) => void }) {
  const { t } = usePrefs()
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')

  const ask = async () => {
    setBusy(true)
    setError('')
    try {
      setResult(await askCatalog({ question }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('assist.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label={t('assist.catalog.label')} className="space-y-3 rounded-lg border border-border bg-card p-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void ask()
        }}
      >
        <label htmlFor="catalog-ask" className="flex items-center gap-1.5 text-sm font-medium">
          <MessageSquareText className="size-4 text-primary" aria-hidden /> {t('assist.catalog.label')}
        </label>
        <Input id="catalog-ask" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('assist.catalog.placeholder')} maxLength={500} className="min-w-[240px] flex-1" />
        <Button type="submit" size="sm" disabled={busy || question.trim().length < 3}>
          {busy && <Loader2 className="animate-spin" />} {busy ? t('assist.catalog.working') : t('assist.catalog.action')}
        </Button>
      </form>
      {error && <Notice tone="danger">{error}</Notice>}
      {result && (
        <div role="status" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t('assist.catalog.results')}</h2>
            <Button size="icon-xs" variant="ghost" onClick={() => setResult(null)} aria-label={t('assist.catalog.close')}>
              <X />
            </Button>
          </div>
          {result.results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('assist.catalog.none')}</p>
          ) : (
            <ol className="divide-y divide-border rounded-md border border-border">
              {result.results.map((r) => (
                <li key={r.key} className="px-3 py-2.5">
                  <button type="button" onClick={() => onOpen(r.key)} className="rounded-sm text-left font-medium text-info-text hover:underline" aria-label={t('assist.catalog.open', { name: r.name })}>
                    {r.name}
                  </button>
                  {r.sourceName && <span className="ml-2 text-xs text-muted-foreground">{r.sourceName}</span>}
                  {r.reason && <p className="mt-0.5 text-sm text-pretty">{r.reason}</p>}
                  {r.columns.length > 0 && (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">{t('assist.catalog.columns')}:</span>
                      {r.columns.map((c) => (
                        <code key={c} className="rounded-sm bg-muted px-1.5 py-px font-mono">
                          {c}
                        </code>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-muted-foreground">{result.via === 'ai' ? t('assist.catalog.byAi', { model: result.model ?? '' }) : t('assist.catalog.byKeywords')}</p>
        </div>
      )}
    </section>
  )
}
