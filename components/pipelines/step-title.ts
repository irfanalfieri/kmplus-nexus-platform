import type { Translate } from '@/lib/i18n/translate'

/**
 * Step titles arrive from the server in English (stepTitle in lib/pipelines/definition.ts,
 * e.g. "Validate (16 rules)"). This reads them back and shows them in the reader's language.
 * Unknown text is returned as written.
 */
export function localizeStepTitle(text: string, t: Translate): string {
  let m: RegExpExecArray | null
  if ((m = /^Read (.+)$/.exec(text))) return m[1] === 'source' ? t('editor.stepTitle.sourceEmpty') : t('editor.stepTitle.source', { table: m[1] })
  if (text === 'Filter (rule)') return t('editor.stepTitle.filterRule')
  if ((m = /^Filter \((\d+) conditions?\)$/.exec(text))) return t('editor.stepTitle.filter', { count: Number(m[1]) })
  if ((m = /^Map (\d+) fields?$/.exec(text))) return t('editor.stepTitle.map', { count: Number(m[1]) })
  if ((m = /^Validate \((\d+) rules?\)$/.exec(text))) return t('editor.stepTitle.validate', { count: Number(m[1]) })
  if ((m = /^Business rules \((\d+)\)$/.exec(text))) return t('editor.stepTitle.rules', { count: Number(m[1]) })
  if ((m = /^Route \((\d+) branches\)$/.exec(text))) return t('editor.stepTitle.router', { count: Number(m[1]) })
  if ((m = /^Write dataset (.+)$/.exec(text))) return t('editor.stepTitle.destinationDataset', { name: m[1] })
  if ((m = /^Write (.+)$/.exec(text))) return t('editor.stepTitle.destinationTable', { name: m[1] })
  return text
}
