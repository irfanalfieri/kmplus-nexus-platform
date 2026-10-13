'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Lightbulb, Loader2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { suggestConnector } from '@/lib/actions/ai'
import { usePrefs } from '@/components/i18n/i18n-provider'

type Result = Awaited<ReturnType<typeof suggestConnector>>

/**
 * AI-4: "Not sure which connector?" Paste a URL, a file's first line or an error
 * and get connector suggestions (rules first, the model only when they find nothing).
 */
export function AiConnectorSuggest({ onUse }: { onUse: (slug: string) => void }) {
  const { t } = usePrefs()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      setResult(await suggestConnector({ text }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('assist.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-sm text-sm text-info-text hover:underline">
        <Lightbulb className="size-4" aria-hidden /> {t('assist.connector.toggle')}
      </button>
    )
  }
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
      <label htmlFor="connector-suggest-text" className="block text-sm font-medium">
        {t('assist.connector.label')}
      </label>
      <textarea
        id="connector-suggest-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder={t('assist.connector.placeholder')}
        aria-describedby="connector-suggest-hint"
        className="w-full resize-y rounded-md border border-input bg-card px-2.5 py-2 font-mono text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy || text.trim().length < 3}>
          {busy ? <Loader2 className="animate-spin" /> : <Lightbulb />} {busy ? t('assist.connector.working') : t('assist.connector.action')}
        </Button>
        <p id="connector-suggest-hint" className="flex-1 text-xs text-muted-foreground">
          {t('assist.connector.hint')}
        </p>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {result &&
        (result.suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t('assist.connector.none')}
          </p>
        ) : (
          <div role="status">
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {result.suggestions.map((s) => (
                <li key={s.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {s.name} <span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground uppercase">{t(`assist.connector.confidence.${s.confidence}`)}</span>
                    </p>
                    {s.reason && <p className="text-xs text-muted-foreground">{s.reason}</p>}
                  </div>
                  {s.installed ? (
                    <Button size="sm" onClick={() => onUse(s.slug)}>
                      {t('assist.connector.use', { name: s.name })}
                    </Button>
                  ) : (
                    <Link href="/dashboard/connectors" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                      {t('assist.connector.install', { name: s.name })}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-muted-foreground">{result.via === 'ai' ? t('assist.connector.byAi', { model: result.model ?? '' }) : t('assist.connector.byRules')}</p>
          </div>
        ))}
    </div>
  )
}
