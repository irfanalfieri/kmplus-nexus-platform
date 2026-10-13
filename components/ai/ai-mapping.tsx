'use client'

import { useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { suggestMapping } from '@/lib/actions/ai'
import { DOMAIN_ENTITIES } from '@/lib/domain/model'
import type { MapStep } from '@/lib/pipelines/definition'
import { useAiStatus } from './use-ai'
import { useT } from '@/components/i18n/i18n-provider'
import type { MessageKey } from '@/lib/i18n/translate'

type Suggestion = Awaited<ReturnType<typeof suggestMapping>>['suggestions'][number]

const selectClass = 'h-7 rounded-md border border-input bg-card px-1.5 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'

/** Puts React nodes into a translated template's {placeholders}. */
function rich(template: string, nodes: Record<string, React.ReactNode>) {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part)
    return m && m[1] in nodes ? <span key={i}>{nodes[m[1]]}</span> : part
  })
}

/**
 * "Suggest with AI" for a Map step (#14): the model proposes source → target
 * pairs with transforms; the user ticks the ones to add.
 */
export function AiMappingButton({ columns, mapped, source, onAccept }: { columns: { name: string; type: string }[]; mapped: string[]; source?: { dataSourceId: string; table: string }; onAccept: (fields: MapStep['fields']) => void }) {
  const ai = useAiStatus()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [entity, setEntity] = useState('employee')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [model, setModel] = useState('')
  if (!ai?.ready) return null
  // Entity labels have translations by name; a new entity shows its model label.
  const entityLabel = (name: string, fallback: string) => {
    const key = `ops.ai.mapping.entities.${name}`
    const text = t(key as MessageKey)
    return text === key ? fallback : text
  }

  const run = async () => {
    setBusy(true)
    setError('')
    setSuggestions(null)
    try {
      const res = await suggestMapping({ columns, mapped, entity: entity || null, ...(source ?? {}) })
      setSuggestions(res.suggestions)
      setPicked(new Set(res.suggestions.map((_, i) => i)))
      setModel(res.model)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.ai.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!columns.length} title={t('ops.ai.mapping.openTitle')}>
        <Sparkles aria-hidden /> {t('ops.ai.mapping.open')}
      </Button>
    )
  }
  return (
    <div className="w-full space-y-2 rounded-md border border-border bg-muted/50 p-2 text-xs" role="group" aria-label={t('ops.ai.mapping.group')}>
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <label htmlFor="ai-map-entity">{t('ops.ai.mapping.mapTo')}</label>
        <select id="ai-map-entity" className={selectClass} value={entity} onChange={(e) => setEntity(e.target.value)}>
          {DOMAIN_ENTITIES.map((e) => (
            <option key={e.name} value={e.name}>
              {t('ops.ai.mapping.entityFields', { entity: entityLabel(e.name, e.label) })}
            </option>
          ))}
          <option value="">{t('ops.ai.mapping.noEntity')}</option>
        </select>
        <Button size="sm" onClick={() => void run()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />} {busy ? t('ops.ai.thinking') : t('ops.ai.mapping.suggest')}
        </Button>
        <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={() => setOpen(false)} aria-label={t('ops.ai.mapping.close')}>
          <X aria-hidden />
        </Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {suggestions && (
        <>
          {suggestions.length === 0 ? (
            <p className="text-muted-foreground">{t('ops.ai.mapping.none')}</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-y-auto">
              {suggestions.map((s, i) => (
                <li key={`${s.from}-${s.to}`}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      checked={picked.has(i)}
                      onChange={(e) => setPicked((p) => (e.target.checked ? new Set(p).add(i) : new Set([...p].filter((x) => x !== i))))}
                    />
                    <span>
                      <span className="font-mono">{s.from}</span> <span aria-hidden>→</span>
                      <span className="sr-only">{t('ops.ai.mapping.to')}</span> <span className="font-mono font-medium">{s.to}</span> <span className="text-muted-foreground">({s.type})</span>
                      {s.transforms.length > 0 && <span className="font-mono text-muted-foreground"> · {s.transforms.map((tr) => `${tr.fn}${tr.args.length ? `(${tr.args.join(', ')})` : ''}`).join(' → ')}</span>}
                      {s.reason && <span className="block text-muted-foreground">{s.reason}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!picked.size}
              onClick={() => {
                onAccept(suggestions.filter((_, i) => picked.has(i)).map(({ reason: _r, ...f }) => f))
                setOpen(false)
                setSuggestions(null)
              }}
            >
              {t('ops.ai.mapping.addFields', { count: picked.size })}
            </Button>
            <span className="text-muted-foreground">
              {rich(t('ops.ai.mapping.suggestedBy'), { model: <span className="font-mono">{model}</span> })}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
