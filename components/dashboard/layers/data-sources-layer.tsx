'use client'

import { useState } from 'react'
import { Plus, Trash2, CheckCircle2, AlertCircle, Plug, X, Save, Edit, Lock, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import DataSourceAuthModal from '@/components/modals/data-source-auth-modal'
import SampleDataPreviewModal from '@/components/modals/sample-data-preview-modal'

const MOCK_DATA_SOURCES: Array<{ id: string; name: string; type: string; sourceType: string; role?: 'source' | 'destination'; status: string; lastConnected: string }> = [
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
  const [showAddForm, setShowAddForm] = useState(false)
  const [newSourceRole, setNewSourceRole] = useState<'source' | 'destination'>('source')
  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceType, setNewSourceType] = useState('')
  const [newSourceHost, setNewSourceHost] = useState('')
  const [newSourcePort, setNewSourcePort] = useState('')
  const [newSourceUser, setNewSourceUser] = useState('')
  const [newConnectionString, setNewConnectionString] = useState('')
  const [newClientId, setNewClientId] = useState('')
  const [newClientSecret, setNewClientSecret] = useState('')
  const [connectionTested, setConnectionTested] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editHost, setEditHost] = useState('')
  const [editPort, setEditPort] = useState('')
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [authorizedSources, setAuthorizedSources] = useState<Set<string>>(new Set())

  const requiresConnectionString = ['oracle', 'mysql', 'postgresql'].includes(newSourceType)
  const requiresClientCredentials = ['rest', 'sap'].includes(newSourceType)
  const connectionFieldsValid = requiresConnectionString
    ? Boolean(newConnectionString.trim())
    : requiresClientCredentials
      ? Boolean(newClientId.trim() && newClientSecret.trim())
      : Boolean(newSourceHost.trim())

  const testNewConnection = async () => {
    setTestingConnection(true)
    setConnectionError('')
    await new Promise((resolve) => setTimeout(resolve, 700))
    if (!connectionFieldsValid) {
      setConnectionError(requiresConnectionString ? 'Enter a connection string before testing.' : requiresClientCredentials ? 'Enter both client ID and client secret before testing.' : 'Enter a host or URL before testing.')
      setConnectionTested(false)
    } else {
      setConnectionTested(true)
    }
    setTestingConnection(false)
  }

  const addSource = () => {
    if (newSourceName && newSourceType && connectionFieldsValid && connectionTested) {
      setSources([
        ...sources,
        {
          id: `src_${Date.now()}`,
          name: newSourceName,
          type: newSourceType,
          sourceType: newSourceType.toLowerCase(),
          role: newSourceRole,
          status: 'disconnected',
          lastConnected: 'Never',
        },
      ])
      setNewSourceName('')
      setNewSourceType('')
      setNewSourceHost('')
      setNewSourcePort('')
      setNewSourceUser('')
      setNewConnectionString('')
      setNewClientId('')
      setNewClientSecret('')
      setConnectionTested(false)
      setConnectionError('')
      setShowAddForm(false)
    }
  }

  const startEdit = (id: string) => {
    const source = sources.find((s) => s.id === id)
    if (source) {
      setEditingId(id)
      setEditName(source.name)
      setEditHost('')
      setEditPort('')
    }
  }

  const saveEdit = () => {
    if (editingId && editName.trim()) {
      setSources(
        sources.map((s) =>
          s.id === editingId ? { ...s, name: editName } : s
        )
      )
      setEditingId(null)
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

  const openAuthModal = (id: string) => {
    setSelectedSourceId(id)
    setAuthModalOpen(true)
  }

  const handleAuthSuccess = (credentials: Record<string, string>) => {
    if (selectedSourceId) {
      setAuthorizedSources(new Set([...authorizedSources, selectedSourceId]))
      setSources(
        sources.map((s) =>
          s.id === selectedSourceId
            ? { ...s, status: 'connected', lastConnected: 'Just now' }
            : s
        )
      )
      setAuthModalOpen(false)
      setTimeout(() => {
        setPreviewModalOpen(true)
      }, 500)
    }
  }

  const handlePreviewClose = () => {
    setPreviewModalOpen(false)
    setSelectedSourceId(null)
  }

  const selectedSource = selectedSourceId ? sources.find((s) => s.id === selectedSourceId) : null

  return (
    <div className="space-y-6">
      <DataSourceAuthModal
        isOpen={authModalOpen}
        sourceId={selectedSourceId || ''}
        sourceName={selectedSource?.name || ''}
        sourceType={selectedSource?.sourceType || ''}
        onClose={() => {
          setAuthModalOpen(false)
          setSelectedSourceId(null)
        }}
        onSuccess={handleAuthSuccess}
      />

      <SampleDataPreviewModal
        isOpen={previewModalOpen}
        sourceName={selectedSource?.name || ''}
        sourceType={selectedSource?.sourceType || ''}
        onClose={handlePreviewClose}
        onProceed={() => {
          setPreviewModalOpen(false)
        }}
      />

      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Layer 1: Data Source Manager</h2>
            <p className="text-muted-foreground mt-2">
              Manage connections to enterprise systems, databases, APIs, and file sources.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { setNewSourceRole('source'); setShowAddForm(!showAddForm) }} variant="outline" className="px-4">
              <Plus className="w-4 h-4 mr-2" /> Add Source
            </Button>
            <Button onClick={() => { setNewSourceRole('destination'); setShowAddForm(true) }} className="px-4">
              <Plus className="w-4 h-4 mr-2" /> Add Destination
            </Button>
          </div>
        </div>

        {showAddForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg border border-border p-6 max-w-md w-full space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Add New {newSourceRole === 'destination' ? 'Destination' : 'Data'} Source</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAddForm(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <Input
                placeholder="Source name"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
              />

              <Select value={newSourceType} onValueChange={(value) => { setNewSourceType(value || ''); setConnectionTested(false) }}>
                <SelectTrigger>
                  <SelectValue placeholder="Source type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sap">SAP ERP</SelectItem>
                  <SelectItem value="oracle">Oracle Database</SelectItem>
                  <SelectItem value="mysql">MySQL Database</SelectItem>
                  <SelectItem value="rest">REST API</SelectItem>
                  <SelectItem value="csv">CSV Upload</SelectItem>
                  <SelectItem value="postgresql">PostgreSQL</SelectItem>
                </SelectContent>
              </Select>

              {requiresConnectionString ? (
                <Input
                  placeholder="Database connection string"
                  value={newConnectionString}
                  onChange={(e) => { setNewConnectionString(e.target.value); setConnectionTested(false) }}
                />
              ) : requiresClientCredentials ? (
                <>
                  <Input placeholder="Client ID" value={newClientId} onChange={(e) => { setNewClientId(e.target.value); setConnectionTested(false) }} />
                  <Input type="password" placeholder="Client secret" value={newClientSecret} onChange={(e) => { setNewClientSecret(e.target.value); setConnectionTested(false) }} />
                  <Input placeholder="Host / URL" value={newSourceHost} onChange={(e) => { setNewSourceHost(e.target.value); setConnectionTested(false) }} />
                </>
              ) : (
                <Input placeholder="Host / URL or file path" value={newSourceHost} onChange={(e) => { setNewSourceHost(e.target.value); setConnectionTested(false) }} />
              )}

              {!requiresClientCredentials && !requiresConnectionString && <Input placeholder="Port (optional)" value={newSourcePort} onChange={(e) => setNewSourcePort(e.target.value)} />}
              {!requiresConnectionString && <Input placeholder="Username (optional)" value={newSourceUser} onChange={(e) => setNewSourceUser(e.target.value)} />}

              {connectionError && <p className="text-sm text-destructive">{connectionError}</p>}
              {connectionTested && <p className="text-sm text-green-600">Connection test passed. This source is ready to create.</p>}

              <div className="flex gap-2 pt-4">
                <Button onClick={testNewConnection} variant="outline" className="flex-1" disabled={testingConnection || !newSourceType}>
                  {testingConnection ? 'Testing…' : 'Test Connection'}
                </Button>
                <Button onClick={addSource} className="flex-1" disabled={!connectionTested}>
                  <Save className="w-4 h-4 mr-2" />
                  Create
                </Button>
                <Button
                  onClick={() => setShowAddForm(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center justify-between"><div><h3 className="font-semibold">Destinations</h3><p className="text-sm text-muted-foreground">Where final pipeline data is stored. KMPlus Nexus is always available by default.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">KMPlus Nexus · Default</span></div>
          <div className="mt-3 flex flex-wrap gap-2">{sources.filter((source) => (source as any).role === 'destination').map((source) => <Badge key={source.id} variant="outline">{source.name} · {source.status}</Badge>)}<Badge variant="secondary">KMPlus Nexus</Badge></div>
        </div>

        <div className="grid gap-3">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
            >
              <div className="flex-1">
                {editingId === source.id ? (
                  <div className="space-y-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Source name"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit}>
                        <Save className="w-4 h-4 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="font-medium">{source.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Type: {source.sourceType.toUpperCase()} • Last: {source.lastConnected}
                    </div>
                  </>
                )}
              </div>
              {editingId !== source.id && (
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
                  {authorizedSources.has(source.id) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPreviewModalOpen(true)}
                      title="View sample data"
                      className="gap-1"
                    >
                      <Eye className="w-4 h-4" />
                      <span className="text-xs">Sample Data</span>
                    </Button>
                  )}
                  {!authorizedSources.has(source.id) && source.status === 'disconnected' && (
                    <Button
                      size="sm"
                      onClick={() => openAuthModal(source.id)}
                      className="gap-1"
                    >
                      <Lock className="w-4 h-4" />
                      <span className="text-xs">Authorize</span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(source.id)}
                    title="Edit source"
                  >
                    <Edit className="w-4 h-4" />
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
              )}
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
