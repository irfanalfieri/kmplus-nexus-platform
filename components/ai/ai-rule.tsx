'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { draftRule } from '@/lib/actions/ai'
import type { RuleBody } from '@/lib/rules/definition'
import { useAiStatus } from './use-ai'
import { useT } from '@/components/i18n/i18n-provider'

/** "Describe the rule" → a draft in the editor below (#14). Nothing is saved until the user saves. */
export function AiRuleDraft({ dataset, onDraft }: { dataset: string; onDraft: (draft: { name: string; description: string; body: RuleBody }) => void }) {
  const ai = useAiStatus()
  const t = useT()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  if (!ai?.ready) return null

  const run = async () => {
    setBusy(true)
    setNote(null)
    try {
      const res = await draftRule({ text, dataset: dataset || undefined })
      onDraft({ name: res.name, description: res.description, body: res.body })
      setNote({ kind: 'ok', text: t('ops.ai.rule.drafted', { model: res.model }) })
    } catch (err) {
      setNote({ kind: 'err', text: err instanceof Error ? err.message : t('ops.ai.failed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/50 p-2">
      <label className="flex items-center gap-1.5 text-xs font-medium" htmlFor="ai-rule-text">
        <Sparkles className="size-3.5 text-primary" aria-hidden /> {t('ops.ai.rule.label')}
      </label>
      <textarea
        id="ai-rule-text"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('ops.ai.rule.placeholder')}
        className="w-full rounded-md border border-input bg-card p-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void run()} disabled={busy || text.trim().length < 5}>
          {busy && <Loader2 className="animate-spin" aria-hidden />} {busy ? t('ops.ai.rule.drafting') : t('ops.ai.rule.draft')}
        </Button>
        {!dataset && <span className="text-xs text-muted-foreground">{t('ops.ai.rule.tip')}</span>}
      </div>
      {note && (
        <Notice tone={note.kind === 'ok' ? 'success' : 'danger'} className="text-xs">
          {note.text}
        </Notice>
      )}
    </div>
  )
}
