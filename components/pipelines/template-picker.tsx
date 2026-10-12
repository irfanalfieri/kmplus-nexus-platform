'use client'

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

const ICONS: Record<PipelineTemplateId, typeof Users> = { 'hris-employee': Users, 'ad-users': Users, 'csv-dataset': FileSpreadsheet }

const cardClass =
  'rounded-md border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/** "New pipeline": start blank or from a template (PD-8). */
export default function TemplatePicker({ options, onClose, onPick }: { options: BuilderOptions; onClose: () => void; onPick: (p: EditablePipeline) => void }) {
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
    const t = PIPELINE_TEMPLATES.find((x) => x.id === id)!
    setDatasetName(t.defaultDataset)
    setSourceId('')
    setTable(id === 'ad-users' ? 'users' : '')
  }

  const build = () => {
    if (!template || !source || !table) return
    const cols = tables.find((t) => t.name === table)?.columns ?? []
    const built = buildPipelineTemplate(template.id, { dataSourceId: source.id, sourceType: source.sourceType, table, columns: cols, datasetName: datasetName || undefined, datasets: options.datasets, kmplusDestinationId: template.id === 'hris-employee' ? kmplusId || undefined : undefined })
    onPick({ ...blankPipeline(), name: built.name, description: built.description, nodes: built.nodes, edges: built.edges, notes: built.notes })
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title="New pipeline"
      description="Start blank or from a template."
      footer={
        template && sources.length > 0 ? (
          <Button onClick={build} disabled={!source || !table}>
            Build pipeline
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => onPick(blankPipeline())} className={cn(cardClass, 'border-border')}>
            <div className="flex items-center gap-2 font-medium">
              <Plus className="size-4 text-muted-foreground" aria-hidden /> Blank pipeline
            </div>
            <p className="mt-1 text-xs text-muted-foreground">A source and a destination; add steps on the canvas.</p>
          </button>
          {PIPELINE_TEMPLATES.map((t) => {
            const Icon = ICONS[t.id] ?? Workflow
            const active = templateId === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => choose(t.id)}
                aria-pressed={active}
                className={cn(cardClass, active ? 'border-ring bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--live)] hover:bg-accent' : 'border-border')}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Icon className="size-4 text-muted-foreground" aria-hidden /> {t.name}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
              </button>
            )
          })}
        </div>

        {template && (
          <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby="template-setup">
            <h3 id="template-setup" className="text-sm font-medium">
              {template.name}
            </h3>
            {sources.length === 0 ? (
              <EmptyState compact icon={<Database />} title="No matching data source yet">
                {template.sourceHint}. Add one in Data Sources first.
              </EmptyState>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Data source</span>
                  <NativeSelect
                    value={sourceId}
                    onChange={(v) => {
                      setSourceId(v)
                      setTable(templateId === 'ad-users' ? 'users' : '')
                    }}
                  >
                    <option value="">Choose…</option>
                    {sources.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Table / object</span>
                  <NativeSelect value={table} onChange={setTable} disabled={!source}>
                    <option value="">Choose…</option>
                    {tables.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Dataset name</span>
                  <Input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder={templateId === 'csv-dataset' ? 'from the table name' : template.defaultDataset} className="font-mono" />
                </label>
              </div>
            )}
            {template.id === 'hris-employee' && kmplusTargets.length > 0 && (
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Also send employees to a KMPlus product (optional)</span>
                <NativeSelect value={kmplusId} onChange={setKmplusId}>
                  <option value="">No, only the dataset</option>
                  {kmplusTargets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <p className="text-xs text-muted-foreground">The pipeline opens in the editor as a draft: review the mapping, test on sample, then save and publish.</p>
          </section>
        )}
      </div>
    </Modal>
  )
}
