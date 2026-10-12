'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { getAiSettings, setAiProvider } from '@/lib/actions/ai'

type Settings = Awaited<ReturnType<typeof getAiSettings>>

const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

/** Settings → AI assistant (#14): which open-source model answers, or off. */
export function AiSettings() {
  const [s, setS] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getAiSettings()
      .then(setS)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load AI settings'))
  }, [])

  const save = async (provider: 'off' | 'server' | 'agent', agentId: string | null = null) => {
    setBusy(true)
    setError('')
    try {
      await setAiProvider({ provider, agentId })
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5" aria-label="AI assistant">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
        <div>
          <h3 className="font-semibold">AI assistant</h3>
          <p className="text-sm text-muted-foreground">
            Suggests column mappings, drafts business rules from a sentence, and answers questions about datasets with a chart. It runs on a free open-source model (e.g. Qwen 2.5 or Llama 3.1 in Ollama). It sees column names and types, a few example values of non-personal columns, and your text; never whole datasets. Everything it proposes is reviewed before it is saved, and questions run with your role&apos;s masking and row filters.
          </p>
        </div>
      </div>
      {!s ? (
        error ? null : (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </p>
        )
      ) : (
        <>
          <p className={`rounded-md p-2 text-sm ${s.ready ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
            {s.ready ? `Ready: ${s.model} on ${s.where}.` : s.message}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select className={selectClass} value={s.provider} disabled={busy} onChange={(e) => (e.target.value === 'agent' ? setS({ ...s, provider: 'agent' }) : void save(e.target.value as 'off' | 'server'))} aria-label="AI model">
              <option value="server">Model of this Nexus server</option>
              <option value="agent">Model next to a Nexus Agent (stays in your network)</option>
              <option value="off">Off</option>
            </select>
            {s.provider === 'agent' && (
              <select className={selectClass} value={s.agentId ?? ''} disabled={busy} onChange={(e) => e.target.value && void save('agent', e.target.value)} aria-label="Agent">
                <option value="">Choose an agent…</option>
                {s.agentModels.map((a) => (
                  <option key={a.id} value={a.id} disabled={!a.model}>
                    {a.name}
                    {a.model ? ` (${a.model})` : ' (no model)'}
                  </option>
                ))}
              </select>
            )}
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer text-primary">How to run a free model</summary>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                Next to a Nexus Agent: install Ollama on the agent&apos;s server, run <span className="font-mono">ollama pull qwen2.5:7b-instruct</span>, add <span className="font-mono">{'"ai": { "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5:7b-instruct" }'}</span> to the agent config, restart it, and pick the agent above.
              </li>
              <li>
                For this Nexus server: run any OpenAI-compatible server with an open model (Ollama, vLLM, LM Studio) where Nexus can reach it, and set <span className="font-mono">NEXUS_AI_BASE_URL</span> (ending in /v1) and <span className="font-mono">NEXUS_AI_MODEL</span> (plus <span className="font-mono">NEXUS_AI_API_KEY</span> if it needs one).
              </li>
              <li>About 8 GB of RAM runs a 7-8B model on CPU (slow but works); a GPU makes answers take seconds. Smaller: qwen2.5:3b-instruct.</li>
            </ul>
          </details>
        </>
      )}
      {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
    </section>
  )
}
