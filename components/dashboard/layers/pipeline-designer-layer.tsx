'use client'

import { useState } from 'react'
import { Plus, Play, Trash2, Edit, X, Save, Settings, TestTube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import PipelineTestModal from '@/components/modals/pipeline-test-modal'
import ColumnMappingModal from '@/components/modals/column-mapping-modal'

const DATA_SOURCES = ['SAP ERP System', 'Oracle Database', 'MySQL Production', 'REST API Gateway', 'CSV File Uploads']
const TRANSFORMATIONS = ['None', 'Mapping', 'Filtering', 'Aggregation', 'Cleansing']
const SCHEDULES = ['Manual', 'Hourly', 'Daily', 'Weekly', 'Monthly']

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
  const [newDescription, setNewDescription] = useState('')
  const [newSource, setNewSource] = useState('')
  const [newDestination, setNewDestination] = useState('')
  const [newTransformation, setNewTransformation] = useState('None')
  const [newSchedule, setNewSchedule] = useState('Manual')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [configuringId, setConfiguringId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSource, setEditSource] = useState('')
  const [editDestination, setEditDestination] = useState('')
  const [editTransformation, setEditTransformation] = useState('')
  const [editSchedule, setEditSchedule] = useState('')
  const [runningId, setRunningId] = useState<string | null>(null)
  const [testingPipelineId, setTestingPipelineId] = useState<string | null>(null)
  const [mappingPipelineId, setMappingPipelineId] = useState<string | null>(null)

  const addPipeline = () => {
    if (newName && newSource && newDestination) {
      setPipelines([
        ...pipelines,
        {
          id: `pipe_${Date.now()}`,
          name: newName,
          description: newDescription || 'New pipeline',
          source: newSource,
          destination: newDestination,
          status: 'draft',
          enabled: false,
          lastRun: 'Never',
          nextRun: newSchedule,
        },
      ])
      setNewName('')
      setNewDescription('')
      setNewSource('')
      setNewDestination('')
      setNewTransformation('None')
      setNewSchedule('Manual')
      setShowNewForm(false)
    }
  }

  const startConfigureEdit = (id: string) => {
    const pipeline = pipelines.find((p) => p.id === id)
    if (pipeline) {
      setConfiguringId(id)
      setEditName(pipeline.name)
      setEditDescription(pipeline.description)
      setEditSource(pipeline.source)
      setEditDestination(pipeline.destination)
      setEditSchedule(pipeline.nextRun)
    }
  }

  const saveConfiguration = () => {
    if (configuringId && editName.trim() && editSource && editDestination) {
      setPipelines(
        pipelines.map((p) =>
          p.id === configuringId
            ? {
                ...p,
                name: editName,
                description: editDescription,
                source: editSource,
                destination: editDestination,
                nextRun: editSchedule,
              }
            : p
        )
      )
      setConfiguringId(null)
    }
  }



  const runPipeline = (id: string) => {
    setRunningId(id)
    setTimeout(() => {
      setPipelines(
        pipelines.map((p) =>
          p.id === id
            ? {
                ...p,
                status: 'active',
                enabled: true,
                lastRun: 'Just now',
                nextRun: 'in 1 hour',
              }
            : p
        )
      )
      setRunningId(null)
    }, 1200)
  }

  const togglePipeline = (id: string) => {
    setPipelines(
      pipelines.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    )
  }

  const deletePipeline = (id: string) => {
    setPipelines(pipelines.filter((p) => p.id !== id))
  }

  const testingPipeline = pipelines.find((p) => p.id === testingPipelineId)
  const mappingPipeline = pipelines.find((p) => p.id === mappingPipelineId)

  return (
    <div className="space-y-6">
      <PipelineTestModal
        isOpen={!!testingPipelineId}
        pipelineName={testingPipeline?.name || ''}
        sourceType={testingPipeline?.source?.split(' ')[0] || ''}
        onClose={() => setTestingPipelineId(null)}
        onSuccess={() => {
          setTestingPipelineId(null)
          setMappingPipelineId(testingPipelineId)
        }}
      />

      <ColumnMappingModal
        isOpen={!!mappingPipelineId}
        pipelineName={mappingPipeline?.name || ''}
        onClose={() => setMappingPipelineId(null)}
        onSave={(mappings) => {
          console.log('Mappings saved:', mappings)
          setMappingPipelineId(null)
        }}
      />

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
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg border border-border p-6 max-w-2xl w-full space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Create New Pipeline</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowNewForm(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <Input
                placeholder="Pipeline name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />

              <Input
                placeholder="Description (optional)"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />

              <div className="grid grid-cols-2 gap-4">
                <Select value={newSource} onValueChange={setNewSource}>
                  <SelectTrigger>
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_SOURCES.map((src) => (
                      <SelectItem key={src} value={src}>
                        {src}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={newDestination} onValueChange={setNewDestination}>
                  <SelectTrigger>
                    <SelectValue placeholder="Destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_SOURCES.map((dst) => (
                      <SelectItem key={dst} value={dst}>
                        {dst}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Select value={newTransformation} onValueChange={setNewTransformation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Transformation" />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSFORMATIONS.map((trans) => (
                      <SelectItem key={trans} value={trans}>
                        {trans}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={newSchedule} onValueChange={setNewSchedule}>
                  <SelectTrigger>
                    <SelectValue placeholder="Schedule" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULES.map((sch) => (
                      <SelectItem key={sch} value={sch}>
                        {sch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={addPipeline} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  Create
                </Button>
                <Button
                  onClick={() => setShowNewForm(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {configuringId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg border border-border p-6 max-w-2xl w-full space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Configure Pipeline</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfiguringId(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <Input
                placeholder="Pipeline name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />

              <Input
                placeholder="Description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />

              <div className="grid grid-cols-2 gap-4">
                <Select value={editSource} onValueChange={setEditSource}>
                  <SelectTrigger>
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_SOURCES.map((src) => (
                      <SelectItem key={src} value={src}>
                        {src}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={editDestination} onValueChange={setEditDestination}>
                  <SelectTrigger>
                    <SelectValue placeholder="Destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_SOURCES.map((dst) => (
                      <SelectItem key={dst} value={dst}>
                        {dst}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Select value={editSchedule} onValueChange={setEditSchedule}>
                <SelectTrigger>
                  <SelectValue placeholder="Schedule" />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULES.map((sch) => (
                    <SelectItem key={sch} value={sch}>
                      {sch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-2 pt-4">
                <Button onClick={saveConfiguration} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  Save Configuration
                </Button>
                <Button
                  onClick={() => setConfiguringId(null)}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
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
                  <div className="flex items-center gap-2 mb-1">
                    <div className="font-semibold">{pipeline.name}</div>
                    <Badge variant={pipeline.enabled ? 'default' : 'secondary'}>
                      {pipeline.status}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mb-2">
                    {pipeline.description}
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>Source: {pipeline.source} → Destination: {pipeline.destination}</div>
                    <div>Last run: {pipeline.lastRun} • Next: {pipeline.nextRun}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startConfigureEdit(pipeline.id)}
                    title="Configure pipeline"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTestingPipelineId(pipeline.id)}
                    title="Test pipeline"
                  >
                    <TestTube className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMappingPipelineId(pipeline.id)}
                    title="Edit column mapping"
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Map
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => runPipeline(pipeline.id)}
                    disabled={runningId === pipeline.id}
                    title="Run pipeline"
                  >
                    <Play className="w-4 h-4" />
                    {runningId === pipeline.id && (
                      <span className="ml-1 text-xs">Running...</span>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deletePipeline(pipeline.id)}
                    title="Delete pipeline"
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
