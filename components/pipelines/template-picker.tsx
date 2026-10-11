'use client'

import { useMemo, useState } from 'react'
import { FileSpreadsheet, LayoutTemplate, Plus, Users, Workflow, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PIPELINE_TEMPLATES, buildPipelineTemplate, type PipelineTemplateId } from '@/lib/pipelines/templates'
import { blankPipeline, type EditablePipeline } from './pipeline-editor'
import { NativeSelect, type BuilderOptions } from './step-editors'

const ICONS: Record<PipelineTemplateId, typeof Users> = { 'hris-employee': Users, 'ad-users': Users, 'csv-dataset': FileSpreadsheet }

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="New pipeline">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border p-4">
          <LayoutTemplate className="h-5 w-5 text-primary" />
          <div className="flex-1 font-semibold">New pipeline</div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={() => onPick(blankPipeline())} className="rounded-lg border border-border p-3 text-left hover:bg-muted/40">
              <div className="flex items-center gap-2 font-medium">
                <Plus className="h-4 w-4 text-primary" /> Blank pipeline
              </div>
              <p className="mt-1 text-xs text-muted-foreground">A source and a destination; add steps on the canvas.</p>
            </button>
            {PIPELINE_TEMPLATES.map((t) => {
              const Icon = ICONS[t.id] ?? Workflow
              return (
                <button key={t.id} onClick={() => choose(t.id)} aria-pressed={templateId === t.id} className={`rounded-lg border p-3 text-left hover:bg-muted/40 ${templateId === t.id ? 'border-primary bg-primary/5' : 'border-border'}`}>
                  <div className="flex items-center gap-2 font-medium">
                    <Icon className="h-4 w-4 text-primary" /> {t.name}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                </button>
              )
            })}
          </div>

          {template && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="text-sm font-medium">{template.name}</div>
              {sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching data source yet ({template.sourceHint}). Add one in Data Sources first.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">Data source</span>
                    <NativeSelect value={sourceId} onChange={(v) => { setSourceId(v); setTable(templateId === 'ad-users' ? 'users' : '') }}>
                      <option value="">Choose…</option>
                      {sources.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">Table / object</span>
                    <NativeSelect value={table} onChange={setTable} disabled={!source}>
                      <option value="">Choose…</option>
                      {tables.map((t) => (
                        <option key={t.name} value={t.name}>{t.name}</option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">Dataset name</span>
                    <Input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder={templateId === 'csv-dataset' ? 'from the table name' : template.defaultDataset} className="font-mono" />
                  </label>
                </div>
              )}
              {template.id === 'hris-employee' && kmplusTargets.length > 0 && (
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">Also send employees to a KMPlus product (optional)</span>
                  <NativeSelect value={kmplusId} onChange={setKmplusId}>
                    <option value="">No, only the dataset</option>
                    {kmplusTargets.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </NativeSelect>
                </label>
              )}
              <div className="flex justify-end">
                <Button onClick={build} disabled={!source || !table}>
                  Build pipeline
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">The pipeline opens in the editor as a draft: review the mapping, test on sample, then save and publish.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
