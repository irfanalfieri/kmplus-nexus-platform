'use client'

import { useEffect, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { getAiSettings, setAiProvider } from '@/lib/actions/ai'

type Settings = Awaited<ReturnType<typeof getAiSettings>>

/** Settings → AI assistant (#14): which open-source model answers, or off. */
export function AiSettings() {
  const id = useId()
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
    <SettingsPanel
      title="AI assistant"
      description={
        <>
          Suggests column mappings, drafts business rules from a sentence, and answers questions about datasets with a chart. It runs on a free open-source model (e.g. Qwen 2.5 or Llama 3.1 in Ollama). It sees column names and types, a few example values of non-personal columns, and your text; never whole datasets. Everything it proposes is reviewed before it is saved, and questions run with your role&apos;s masking and row filters.
        </>
      }
    >
      <div className="space-y-3">
        {!s ? (
          error ? null : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          )
        ) : (
          <>
            <Notice tone={s.ready ? 'success' : 'info'}>{s.ready ? `Ready: ${s.model} on ${s.where}.` : s.message}</Notice>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-provider`}>AI model</Label>
                <select
                  id={`${id}-provider`}
                  className={nativeSelectClass}
                  value={s.provider}
                  disabled={busy}
                  onChange={(e) => (e.target.value === 'agent' ? setS({ ...s, provider: 'agent' }) : void save(e.target.value as 'off' | 'server'))}
                >
                  <option value="server">Model of this Nexus server</option>
                  <option value="agent">Model next to a Nexus Agent (stays in your network)</option>
                  <option value="off">Off</option>
                </select>
              </div>
              {s.provider === 'agent' && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-agent`}>Agent</Label>
                  <select id={`${id}-agent`} className={nativeSelectClass} value={s.agentId ?? ''} disabled={busy} onChange={(e) => e.target.value && void save('agent', e.target.value)}>
                    <option value="">Choose an agent…</option>
                    {s.agentModels.map((a) => (
                      <option key={a.id} value={a.id} disabled={!a.model}>
                        {a.name}
                        {a.model ? ` (${a.model})` : ' (no model)'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {busy && <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer text-info-text">How to run a free model</summary>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>
                  Next to a Nexus Agent: install Ollama on the agent&apos;s server, run <span className="font-mono">ollama pull qwen2.5:7b-instruct</span>, add{' '}
                  <span className="font-mono">{'"ai": { "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5:7b-instruct" }'}</span> to the agent config, restart it, and pick the agent above.
                </li>
                <li>
                  For this Nexus server: run any OpenAI-compatible server with an open model (Ollama, vLLM, LM Studio) where Nexus can reach it, and set <span className="font-mono">NEXUS_AI_BASE_URL</span> (ending in /v1) and{' '}
                  <span className="font-mono">NEXUS_AI_MODEL</span> (plus <span className="font-mono">NEXUS_AI_API_KEY</span> if it needs one).
                </li>
                <li>About 8 GB of RAM runs a 7-8B model on CPU (slow but works); a GPU makes answers take seconds. Smaller: qwen2.5:3b-instruct.</li>
              </ul>
            </details>
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </SettingsPanel>
  )
}
