'use client'

import { useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { suggestMapping } from '@/lib/actions/ai'
import { DOMAIN_ENTITIES } from '@/lib/domain/model'
import type { MapStep } from '@/lib/pipelines/definition'
import { useAiStatus } from './use-ai'

type Suggestion = Awaited<ReturnType<typeof suggestMapping>>['suggestions'][number]

/**
 * "Suggest with AI" for a Map step (#14): the model proposes source → target
 * pairs with transforms; the user ticks the ones to add.
 */
export function AiMappingButton({ columns, mapped, source, onAccept }: { columns: { name: string; type: string }[]; mapped: string[]; source?: { dataSourceId: string; table: string }; onAccept: (fields: MapStep['fields']) => void }) {
  const ai = useAiStatus()
  const [open, setOpen] = useState(false)
  const [entity, setEntity] = useState('employee')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [model, setModel] = useState('')
  if (!ai?.ready) return null

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
      setError(err instanceof Error ? err.message : 'The AI request failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!columns.length} title="Ask the AI model to propose mappings for the unmapped columns">
        <Sparkles className="mr-1 h-4 w-4" /> Suggest with AI
      </Button>
    )
  }
  return (
    <div className="w-full space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span>Map to</span>
        <select className="h-7 rounded-md border border-input bg-background px-1" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Target entity">
          {DOMAIN_ENTITIES.map((e) => (
            <option key={e.name} value={e.name}>
              {e.label} fields
            </option>
          ))}
          <option value="">clear names (no entity)</option>
        </select>
        <Button size="sm" className="h-7" onClick={() => void run()} disabled={busy}>
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} {busy ? 'Thinking…' : 'Suggest'}
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setOpen(false)} aria-label="Close AI suggestions">
          <X className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {suggestions && (
        <>
          {suggestions.length === 0 ? (
            <p className="text-muted-foreground">No confident suggestions for the remaining columns.</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-y-auto">
              {suggestions.map((s, i) => (
                <li key={`${s.from}-${s.to}`}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5" checked={picked.has(i)} onChange={(e) => setPicked((p) => (e.target.checked ? new Set(p).add(i) : new Set([...p].filter((x) => x !== i))))} />
                    <span>
                      <span className="font-mono">{s.from}</span> → <span className="font-mono font-medium">{s.to}</span> <span className="text-muted-foreground">({s.type})</span>
                      {s.transforms.length > 0 && <span className="text-muted-foreground"> · {s.transforms.map((t) => `${t.fn}${t.args.length ? `(${t.args.join(', ')})` : ''}`).join(' → ')}</span>}
                      {s.reason && <span className="block text-muted-foreground">{s.reason}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7"
              disabled={!picked.size}
              onClick={() => {
                onAccept(suggestions.filter((_, i) => picked.has(i)).map(({ reason: _r, ...f }) => f))
                setOpen(false)
                setSuggestions(null)
              }}
            >
              Add {picked.size} field{picked.size === 1 ? '' : 's'}
            </Button>
            <span className="text-muted-foreground">Suggested by {model}. Check them before publishing.</span>
          </div>
        </>
      )}
    </div>
  )
}
