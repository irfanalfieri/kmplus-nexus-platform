'use client'

import { Fragment, useEffect, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { getAiSettings, setAiProvider } from '@/lib/actions/ai'
import { useT } from '@/components/i18n/i18n-provider'
import type { Translate } from '@/lib/i18n/translate'

type Settings = Awaited<ReturnType<typeof getAiSettings>>

/** Fills {slots} in a translated sentence with elements. */
function rich(text: string, slots: Record<string, React.ReactNode>) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <Fragment key={i}>{slots[part] ?? `{${part}}`}</Fragment> : part))
}

/** The server reports the model status in English; rebuild it in the interface language from its fields. */
function statusText(s: Settings, t: Translate): string {
  const agentName = s.agentModels.find((a) => a.id === s.agentId)?.name ?? s.where.replace(/^agent /, '')
  const host = s.where.match(/\((.+)\)$/)?.[1]
  const where = s.provider === 'agent' ? t('ws.ai.whereAgent', { name: agentName }) : s.paid ? t('ws.ai.whereServerPaid') : host ? t('ws.ai.whereServerHost', { host }) : t('ws.ai.whereServer')
  if (s.ready && s.model) return t('ws.ai.ready', { model: s.model, where })
  if (s.provider === 'off') return t('ws.ai.statusOff')
  if (s.provider === 'agent') {
    if (!s.agentId) return t('ws.ai.statusChooseAgent')
    return s.model ? t('ws.ai.statusOffline', { name: agentName }) : t('ws.ai.statusNoModel', { name: agentName })
  }
  if (s.paid) return t('ws.ai.statusPaidMissing')
  if (s.message.startsWith('NEXUS_AI_MODEL_TYPE')) return t('ws.ai.statusBadType')
  if (!s.model) return t('ws.ai.statusNoServer')
  return s.message
}

/** Settings → AI assistant (#14): which model answers (this server's open-source or paid model, or one next to an agent), or off. */
export function AiSettings() {
  const t = useT()
  const id = useId()
  const [s, setS] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getAiSettings()
      .then(setS)
      .catch((err) => setError(err instanceof Error ? err.message : t('ws.ai.loadFailed')))
  }, [t])

  const save = async (provider: 'off' | 'server' | 'agent', agentId: string | null = null) => {
    setBusy(true)
    setError('')
    try {
      await setAiProvider({ provider, agentId })
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ws.common.failed'))
      setBusy(false)
    }
  }

  return (
    <SettingsPanel
      title={t('ws.ai.title')}
      description={t('ws.ai.description')}
    >
      <div className="space-y-3">
        {!s ? (
          error ? null : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
            </p>
          )
        ) : (
          <>
            <Notice tone={s.ready ? 'success' : 'info'}>{statusText(s, t)}</Notice>
            {s.paid && s.provider === 'server' && <Notice tone="warning">{t('ws.ai.paidNotice')}</Notice>}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-provider`}>{t('ws.ai.model')}</Label>
                <select
                  id={`${id}-provider`}
                  className={nativeSelectClass}
                  value={s.provider}
                  disabled={busy}
                  onChange={(e) => (e.target.value === 'agent' ? setS({ ...s, provider: 'agent' }) : void save(e.target.value as 'off' | 'server'))}
                >
                  <option value="server">{t('ws.ai.optServer')}</option>
                  <option value="agent">{t('ws.ai.optAgent')}</option>
                  <option value="off">{t('ws.ai.optOff')}</option>
                </select>
              </div>
              {s.provider === 'agent' && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-agent`}>{t('ws.ai.agent')}</Label>
                  <select id={`${id}-agent`} className={nativeSelectClass} value={s.agentId ?? ''} disabled={busy} onChange={(e) => e.target.value && void save('agent', e.target.value)}>
                    <option value="">{t('ws.ai.chooseAgent')}</option>
                    {s.agentModels.map((a) => (
                      <option key={a.id} value={a.id} disabled={!a.model}>
                        {a.name}
                        {a.model ? ` (${a.model})` : ` (${t('ws.ai.noModel')})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {busy && <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" aria-label={t('ws.ai.saving')} />}
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer text-info-text">{t('ws.ai.howTo')}</summary>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>
                  {rich(t('ws.ai.howAgent'), {
                    pull: <span className="font-mono">ollama pull qwen2.5:7b-instruct</span>,
                    config: <span className="font-mono">{'"ai": { "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5:7b-instruct" }'}</span>,
                  })}
                </li>
                <li>
                  {rich(t('ws.ai.howServer'), {
                    baseUrl: <span className="font-mono">NEXUS_AI_BASE_URL</span>,
                    model: <span className="font-mono">NEXUS_AI_MODEL</span>,
                    apiKey: <span className="font-mono">NEXUS_AI_API_KEY</span>,
                  })}
                </li>
                <li>{t('ws.ai.hardware')}</li>
                <li>
                  {rich(t('ws.ai.howPaid'), {
                    type: <span className="font-mono">NEXUS_AI_MODEL_TYPE=paid</span>,
                    key: <span className="font-mono">NEXUS_AI_PAID_API_KEY</span>,
                    model: <span className="font-mono">NEXUS_AI_PAID_MODEL</span>,
                    effort: <span className="font-mono">NEXUS_AI_PAID_EFFORT</span>,
                    workspace: <span className="font-mono">NEXUS_AI_PAID_WORKSPACE_ID</span>,
                    back: <span className="font-mono">opensource</span>,
                  })}
                </li>
              </ul>
            </details>
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </SettingsPanel>
  )
}
