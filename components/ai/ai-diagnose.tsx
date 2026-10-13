'use client'

import { useState } from 'react'
import { Loader2, Sparkles, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { useConfirm } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { applyDiagnosisFix, diagnoseRun } from '@/lib/actions/ai'
import { useCan } from '@/components/workspace/workspace-context'
import { useT } from '@/components/i18n/i18n-provider'
import type { Translate } from '@/lib/i18n/translate'
import type { DiagnosisFix } from '@/lib/ai/pipelines'
import { useAiStatus } from './use-ai'

type Result = Awaited<ReturnType<typeof diagnoseRun>>

function describeFix(fix: DiagnosisFix, t: Translate) {
  if (fix.kind === 'add_transform') {
    return t('assist.diagnose.addTransform', { transform: fix.transform?.fn ?? '', field: fix.field ?? '', args: fix.transform?.args.length ? ` (${fix.transform.args.join(', ')})` : '' })
  }
  if (fix.kind === 'change_severity') return t('assist.diagnose.changeSeverity', { rule: fix.rule ?? '', field: fix.field ?? '', severity: fix.severity ?? '' })
  if (fix.kind === 'remove_rule') return t('assist.diagnose.removeRule', { rule: fix.rule ?? '', field: fix.field ?? '' })
  return t('assist.diagnose.noFix')
}

/** AI-3: explains a failed run (or held rows) and can save the proposed fix as a draft for review. */
export function AiDiagnose({ runId, onApplied }: { runId: string; onApplied?: () => void }) {
  const ai = useAiStatus()
  const t = useT()
  const toast = useToast()
  const [confirm, confirmEl] = useConfirm()
  const canEdit = useCan('pipelines:edit')
  const canRun = useCan('pipelines:run')
  const [busy, setBusy] = useState<'diagnose' | 'apply' | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  if (!ai?.ready || !canRun) return null

  const diagnose = async () => {
    setBusy('diagnose')
    setError('')
    try {
      setResult(await diagnoseRun({ runId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('assist.failed'))
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (!result) return
    if (!(await confirm({ title: t('assist.diagnose.applyTitle'), description: t('assist.diagnose.applyBody'), confirmLabel: t('assist.diagnose.applyFix') }))) return
    setBusy('apply')
    setError('')
    try {
      const saved = await applyDiagnosisFix({ pipelineId: result.pipelineId, fix: result.fix })
      toast({ message: t('assist.diagnose.applied', { version: saved.version }) })
      onApplied?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('assist.failed'))
    } finally {
      setBusy(null)
    }
  }

  const label = 'font-mono text-[11px] tracking-wide text-muted-foreground uppercase'
  return (
    <div className="space-y-2">
      {confirmEl}
      {!result && (
        <Button size="sm" variant="outline" onClick={() => void diagnose()} disabled={busy !== null}>
          {busy === 'diagnose' ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy === 'diagnose' ? t('assist.diagnose.working') : t('assist.diagnose.action')}
        </Button>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {result && (
        <section aria-label={t('assist.diagnose.title')} className="space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="flex items-start gap-2 font-medium">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {result.summary}
          </p>
          {result.cause && (
            <div>
              <h4 className={label}>{t('assist.diagnose.cause')}</h4>
              <p className="mt-0.5 text-pretty">{result.cause}</p>
            </div>
          )}
          {result.steps.length > 0 && (
            <div>
              <h4 className={label}>{t('assist.diagnose.steps')}</h4>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                {result.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          <div>
            <h4 className={label}>{t('assist.diagnose.fix')}</h4>
            <p className="mt-0.5">{describeFix(result.fix, t)}</p>
            {result.fix.kind !== 'none' && canEdit && (
              <Button size="sm" className="mt-2" onClick={() => void apply()} disabled={busy !== null}>
                {busy === 'apply' ? <Loader2 className="animate-spin" /> : <Wrench />} {t('assist.diagnose.applyFix')}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('assist.diagnose.by', { model: result.model })}</p>
        </section>
      )}
    </div>
  )
}
