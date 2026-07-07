'use client'

import { useState } from 'react'
import { Plus, Play, Trash2, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

const MOCK_PIPELINES = [
  {
    id: 'pipe_1',
    name: 'Daily SAP to Oracle Sync',
    description: 'Synchronize customer data from SAP to Oracle',
    source: 'SAP ERP System',
    destination: 'Oracle Database',
    status: 'active',
    enabled: true,
    lastRun: '2 hours ago',
    nextRun: 'in 4 hours',
  },
  {
    id: 'pipe_2',
    name: 'REST API Data Ingestion',
    description: 'Pull data from REST APIs and store in MySQL',
    source: 'REST API Gateway',
    destination: 'MySQL Production',
    status: 'active',
    enabled: true,
    lastRun: '30 minutes ago',
    nextRun: 'in 30 minutes',
  },
  {
    id: 'pipe_3',
    name: 'CSV File Processing',
    description: 'Process uploaded CSV files',
    source: 'CSV File Uploads',
    destination: 'Oracle Database',
    status: 'draft',
    enabled: false,
    lastRun: 'Never',
    nextRun: 'Manual',
  },
  {
    id: 'pipe_4',
    name: 'Data Quality Check Pipeline',
    description: 'Run data quality validations',
    source: 'Oracle Database',
    destination: 'Data Catalog',
    status: 'active',
    enabled: true,
    lastRun: '1 hour ago',
    nextRun: 'in 1 hour',
  },
]

export default function PipelineDesignerLayer() {
  const [pipelines, setPipelines] = useState(MOCK_PIPELINES)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')

  const addPipeline = () => {
    if (newName) {
      setPipelines([
        ...pipelines,
        {
          id: `pipe_${Date.now()}`,
          name: newName,
          description: 'New pipeline',
          source: 'Select source',
          destination: 'Select destination',
          status: 'draft',
          enabled: false,
          lastRun: 'Never',
          nextRun: 'Manual',
        },
      ])
      setNewName('')
      setShowNewForm(false)
    }
  }

  const togglePipeline = (id: string) => {
    setPipelines(
      pipelines.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    )
  }

  const deletePipeline = (id: string) => {
    setPipelines(pipelines.filter((p) => p.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Layer 3: Pipeline Designer</h2>
            <p className="text-muted-foreground mt-2">
              Create and manage data integration pipelines with visual workflow design.
            </p>
          </div>
          <Button onClick={() => setShowNewForm(!showNewForm)} className="px-6">
            <Plus className="w-4 h-4 mr-2" />
            New Pipeline
          </Button>
        </div>

        {showNewForm && (
          <div className="bg-muted/50 rounded-lg p-4 mb-6 space-y-3">
            <Input
              placeholder="Pipeline name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={addPipeline} size="sm">
                Create
              </Button>
              <Button onClick={() => setShowNewForm(false)} size="sm" variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-4">
          {pipelines.map((pipeline) => (
            <div
              key={pipeline.id}
              className="p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold">{pipeline.name}</div>
                    <Badge variant={pipeline.enabled ? 'default' : 'secondary'}>
                      {pipeline.status}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {pipeline.description}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2 space-y-1">
                    <div>Source: {pipeline.source} → Destination: {pipeline.destination}</div>
                    <div>Last run: {pipeline.lastRun} • Next: {pipeline.nextRun}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost">
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => togglePipeline(pipeline.id)}
                  >
                    <Play className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deletePipeline(pipeline.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Total Pipelines</div>
          <div className="text-2xl font-bold mt-2">{pipelines.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Active</div>
          <div className="text-2xl font-bold mt-2">
            {pipelines.filter((p) => p.enabled).length}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Draft</div>
          <div className="text-2xl font-bold mt-2">
            {pipelines.filter((p) => p.status === 'draft').length}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Success Rate</div>
          <div className="text-2xl font-bold mt-2">98%</div>
        </div>
      </div>
    </div>
  )
}
