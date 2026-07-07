'use client'

import { useState } from 'react'
import { Plus, Trash2, CheckCircle2, AlertCircle, Plug, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const MOCK_DATA_SOURCES = [
  {
    id: 'src_1',
    name: 'SAP ERP System',
    type: 'enterprise',
    sourceType: 'sap',
    status: 'connected',
    lastConnected: '2 hours ago',
  },
  {
    id: 'src_2',
    name: 'Oracle Database',
    type: 'database',
    sourceType: 'oracle',
    status: 'connected',
    lastConnected: '5 minutes ago',
  },
  {
    id: 'src_3',
    name: 'MySQL Production',
    type: 'database',
    sourceType: 'mysql',
    status: 'connected',
    lastConnected: '10 minutes ago',
  },
  {
    id: 'src_4',
    name: 'REST API Gateway',
    type: 'api',
    sourceType: 'rest',
    status: 'connected',
    lastConnected: 'Just now',
  },
  {
    id: 'src_5',
    name: 'CSV File Uploads',
    type: 'file',
    sourceType: 'csv',
    status: 'disconnected',
    lastConnected: '3 days ago',
  },
]

export default function DataSourcesLayer() {
  const [sources, setSources] = useState(MOCK_DATA_SOURCES)
  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceType, setNewSourceType] = useState('')

  const addSource = () => {
    if (newSourceName && newSourceType) {
      setSources([
        ...sources,
        {
          id: `src_${Date.now()}`,
          name: newSourceName,
          type: newSourceType,
          sourceType: newSourceType.toLowerCase(),
          status: 'disconnected',
          lastConnected: 'Never',
        },
      ])
      setNewSourceName('')
      setNewSourceType('')
    }
  }

  const deleteSource = (id: string) => {
    setSources(sources.filter((s) => s.id !== id))
  }

  const toggleConnection = (id: string) => {
    setSources(
      sources.map((s) =>
        s.id === id
          ? {
              ...s,
              status: s.status === 'connected' ? 'disconnected' : 'connected',
              lastConnected:
                s.status === 'connected' ? '3 days ago' : 'Just now',
            }
          : s
      )
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold mb-4">Layer 1: Data Source Manager</h2>
        <p className="text-muted-foreground mb-6">
          Manage connections to enterprise systems, databases, APIs, and file sources.
        </p>

        <div className="bg-muted/50 rounded-lg p-4 mb-6 space-y-3">
          <h3 className="font-semibold text-sm">Add New Data Source</h3>
          <div className="flex gap-3">
            <Input
              placeholder="Source name"
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              className="flex-1"
            />
            <Select value={newSourceType} onValueChange={setNewSourceType}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sap">SAP</SelectItem>
                <SelectItem value="oracle">Oracle</SelectItem>
                <SelectItem value="mysql">MySQL</SelectItem>
                <SelectItem value="rest">REST API</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={addSource} className="px-6">
              <Plus className="w-4 h-4 mr-2" />
              Add
            </Button>
          </div>
        </div>

        <div className="grid gap-3">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
            >
              <div className="flex-1 flex items-center gap-4">
                <div className="flex-1">
                  <div className="font-medium">{source.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Type: {source.sourceType.toUpperCase()} • Last: {source.lastConnected}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {source.status === 'connected' ? (
                  <div className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle2 className="w-4 h-4" />
                    Connected
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-orange-600">
                    <AlertCircle className="w-4 h-4" />
                    Disconnected
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleConnection(source.id)}
                  title={source.status === 'connected' ? 'Disconnect' : 'Connect'}
                >
                  <Plug className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteSource(source.id)}
                  title="Delete source"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Connected Sources</div>
          <div className="text-2xl font-bold mt-2">
            {sources.filter((s) => s.status === 'connected').length}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Total Sources</div>
          <div className="text-2xl font-bold mt-2">{sources.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Data Types</div>
          <div className="text-2xl font-bold mt-2">5+</div>
        </div>
      </div>
    </div>
  )
}
