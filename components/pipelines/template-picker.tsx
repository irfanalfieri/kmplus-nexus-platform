'use client'

import { AiPipelineDraft } from '@/components/ai/ai-pipeline-draft'
import { useMemo, useState } from 'react'
import { Database, FileSpreadsheet, Plus, Users, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { PIPELINE_TEMPLATES, buildPipelineTemplate, type PipelineTemplateId } from '@/lib/pipelines/templates'
import { blankPipeline, type EditablePipeline } from './pipeline-editor'
import { NativeSelect, type BuilderOptions } from './step-editors'
import { useT } from '@/components/i18n/i18n-provider'

const ICONS: Record<PipelineTemplateId, typeof Users> = { 'hris-employee': Users, 'ad-users': Users, 'csv-dataset': FileSpreadsheet }
/** Message keys of each template's name, description and source hint (`editor.templates.items.*`). */
const TEXT_KEY = { 'hris-employee': 'hrisEmployee', 'ad-users': 'adUsers', 'csv-dataset': 'csvDataset' } as const satisfies Record<PipelineTemplateId, string>

const cardClass =
  'rounded-md border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/** "New pipeline": start blank or from a template (PD-8). */
export default function TemplatePicker({ options, onClose, onPick }: { options: BuilderOptions; onClose: () => void; onPick: (p: EditablePipeline) => void }) {
  const t = useT()
  const [templateId, setTemplateId] = useState<PipelineTemplateId | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [table, setTable] = useState('')
  const [datasetName, setDatasetName] = useState('')
  const [kmplusId, setKmplusId] = useState('')
  const kmplusTargets = options.dataSources.filter((d) => d.sourceType === 'kmplus' && d.role === 'destination')

  const template = PIPELINE_TEMPLATES.find((t) => t.id === templateId)
  const sources = useMemo(
    () =>
      options.dataSources.filter((d) => d.role === 'source' && (templateId === 'ad-users' ? d.sourceType === 'ldap' : templateId === 'csv-dataset' ? d.sourceType === 'file' : true)),
    [options.dataSources, templateId]
  )
  const source = sources.find((d) => d.id === sourceId)
  const tables = source?.tables ?? []

  const choose = (id: PipelineTemplateId) => {
    setTemplateId(id)
    const picked = PIPELINE_TEMPLATES.find((x) => x.id === id)!
    setDatasetName(picked.defaultDataset)
    setSourceId('')
    setTable(id === 'ad-users' ? 'users' : '')
  }

  const build = () => {
    if (!template || !source || !table) return
    const cols = tables.find((x) => x.name === table)?.columns ?? []
    const built = buildPipelineTemplate(template.id, { dataSourceId: source.id, sourceType: source.sourceType, table, columns: cols, datasetName: datasetName || undefined, datasets: options.datasets, kmplusDestinationId: template.id === 'hris-employee' ? kmplusId || undefined : undefined })
    onPick({ ...blankPipeline(), name: built.name, description: built.description, nodes: built.nodes, edges: built.edges, notes: built.notes })
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={t('editor.modal.newPipeline')}
      description={t('editor.templates.description')}
      footer={
        template && sources.length > 0 ? (
          <Button onClick={build} disabled={!source || !table}>
            {t('editor.templates.build')}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <AiPipelineDraft
          onDraft={(d) =>
            onPick({
              ...blankPipeline(),
              name: d.name,
              description: d.description,
              nodes: d.definition.nodes,
              edges: d.definition.edges,
              settings: d.definition.settings,
              schedule: d.schedule,
              notes: [...(d.explanation ? [d.explanation] : []), ...d.notes, t('assist.pipeline.drafted', { model: d.model })],
            })
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => onPick(blankPipeline())} className={cn(cardClass, 'border-border')}>
            <div className="flex items-center gap-2 font-medium">
              <Plus className="size-4 text-muted-foreground" aria-hidden /> {t('editor.templates.blank')}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('editor.templates.blankBody')}</p>
          </button>
          {PIPELINE_TEMPLATES.map((tpl) => {
            const Icon = ICONS[tpl.id] ?? Workflow
            const active = templateId === tpl.id
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => choose(tpl.id)}
                aria-pressed={active}
                className={cn(cardClass, active ? 'border-ring bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--live)] hover:bg-accent' : 'border-border')}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Icon className="size-4 text-muted-foreground" aria-hidden /> {t(`editor.templates.items.${TEXT_KEY[tpl.id]}.name`)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t(`editor.templates.items.${TEXT_KEY[tpl.id]}.description`)}</p>
              </button>
            )
          })}
        </div>

        {template && (
          <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby="template-setup">
            <h3 id="template-setup" className="text-sm font-medium">
              {t(`editor.templates.items.${TEXT_KEY[template.id]}.name`)}
            </h3>
            {sources.length === 0 ? (
              <EmptyState compact icon={<Database />} title={t('editor.templates.noSource')}>
                {t('editor.templates.addFirst', { hint: t(`editor.templates.items.${TEXT_KEY[template.id]}.sourceHint`) })}
              </EmptyState>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t('editor.templates.dataSource')}</span>
                  <NativeSelect
                    value={sourceId}
                    onChange={(v) => {
                      setSourceId(v)
                      setTable(templateId === 'ad-users' ? 'users' : '')
                    }}
                  >
                    <option value="">{t('editor.templates.choose')}</option>
                    {sources.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t('editor.templates.table')}</span>
                  <NativeSelect value={table} onChange={setTable} disabled={!source}>
                    <option value="">{t('editor.templates.choose')}</option>
                    {tables.map((x) => (
                      <option key={x.name} value={x.name}>
                        {x.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t('editor.templates.datasetName')}</span>
                  <Input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder={templateId === 'csv-dataset' ? t('editor.templates.fromTable') : template.defaultDataset} className="font-mono" />
                </label>
              </div>
            )}
            {template.id === 'hris-employee' && kmplusTargets.length > 0 && (
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">{t('editor.templates.alsoKmplus')}</span>
                <NativeSelect value={kmplusId} onChange={setKmplusId}>
                  <option value="">{t('editor.templates.onlyDataset')}</option>
                  {kmplusTargets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <p className="text-xs text-muted-foreground">{t('editor.templates.opensAsDraft')}</p>
          </section>
        )}
      </div>
    </Modal>
  )
}
