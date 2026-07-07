'use client'

import { useState } from 'react'
import { Tag, Plus, Search, Filter, Eye, Download, Lock, Trash2, X, Save, Edit } from 'lucide-react'
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

const MOCK_CATALOG_ITEMS = [
  {
    id: 'cat_1',
    name: 'Customer Master Data',
    dataType: 'Structured',
    source: 'SAP',
    classification: 'Business Critical',
    tags: ['customer', 'master', 'core'],
    owner: 'John Smith',
    created: '2024-01-15',
    records: 45230,
    lastModified: '2 hours ago',
    quality: 98,
  },
  {
    id: 'cat_2',
    name: 'Order Transactions',
    dataType: 'Structured',
    source: 'Oracle',
    classification: 'High Priority',
    tags: ['orders', 'sales', 'revenue'],
    owner: 'Sarah Johnson',
    created: '2024-01-10',
    records: 128450,
    lastModified: '10 minutes ago',
    quality: 96,
  },
  {
    id: 'cat_3',
    name: 'Product Catalog',
    dataType: 'Structured',
    source: 'REST API',
    classification: 'Standard',
    tags: ['products', 'inventory', 'catalog'],
    owner: 'Mike Chen',
    created: '2024-01-05',
    records: 12340,
    lastModified: '1 day ago',
    quality: 99,
  },
  {
    id: 'cat_4',
    name: 'Financial Reports',
    dataType: 'Unstructured',
    source: 'CSV',
    classification: 'Confidential',
    tags: ['finance', 'reports', 'confidential'],
    owner: 'Emma Davis',
    created: '2023-12-20',
    records: 890,
    lastModified: '3 days ago',
    quality: 94,
  },
]

export default function DataCatalogLayer() {
  const [items, setItems] = useState(MOCK_CATALOG_ITEMS)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterClassification, setFilterClassification] = useState('All')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [newItemType, setNewItemType] = useState('')
  const [newItemSource, setNewItemSource] = useState('')
  const [newItemClassification, setNewItemClassification] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  const filteredItems = items.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.tags.some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesFilter = filterClassification === 'All' || item.classification === filterClassification
    return matchesSearch && matchesFilter
  })

  const addItem = () => {
    if (newItemName && newItemType && newItemSource && newItemClassification) {
      setItems([
        ...items,
        {
          id: `cat_${Date.now()}`,
          name: newItemName,
          dataType: newItemType,
          source: newItemSource,
          classification: newItemClassification,
          tags: [],
          owner: 'Current User',
          created: new Date().toISOString().split('T')[0],
          records: 0,
          lastModified: 'Just now',
          quality: 85,
        },
      ])
      setNewItemName('')
      setNewItemType('')
      setNewItemSource('')
      setNewItemClassification('')
      setShowAddForm(false)
    }
  }

  const deleteItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
    if (selectedItemId === id) setSelectedItemId(null)
  }

  const selectedItem = selectedItemId ? items.find((i) => i.id === selectedItemId) : null
  const classificationOptions = ['All', ...new Set(items.map((i) => i.classification))]

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Layer 7: Data Catalog</h2>
            <p className="text-muted-foreground mt-2">
              Central repository of all data assets with metadata and governance tracking.
            </p>
          </div>
          <Button onClick={() => setShowAddForm(true)} className="px-6">
            <Plus className="w-4 h-4 mr-2" />
            Add Item
          </Button>
        </div>

        {showAddForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg border border-border p-6 max-w-md w-full space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Add Catalog Item</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAddForm(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <Input
                placeholder="Item name"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
              />

              <Select value={newItemType} onValueChange={setNewItemType}>
                <SelectTrigger>
                  <SelectValue placeholder="Data type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Structured">Structured</SelectItem>
                  <SelectItem value="Unstructured">Unstructured</SelectItem>
                  <SelectItem value="Semi-Structured">Semi-Structured</SelectItem>
                </SelectContent>
              </Select>

              <Select value={newItemSource} onValueChange={setNewItemSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Source system" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SAP">SAP</SelectItem>
                  <SelectItem value="Oracle">Oracle</SelectItem>
                  <SelectItem value="REST API">REST API</SelectItem>
                  <SelectItem value="CSV">CSV</SelectItem>
                  <SelectItem value="MySQL">MySQL</SelectItem>
                </SelectContent>
              </Select>

              <Select value={newItemClassification} onValueChange={setNewItemClassification}>
                <SelectTrigger>
                  <SelectValue placeholder="Classification" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Business Critical">Business Critical</SelectItem>
                  <SelectItem value="High Priority">High Priority</SelectItem>
                  <SelectItem value="Standard">Standard</SelectItem>
                  <SelectItem value="Confidential">Confidential</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex gap-2 pt-2">
                <Button onClick={addItem} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  Add
                </Button>
                <Button onClick={() => setShowAddForm(false)} variant="outline" className="flex-1">
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search catalog..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterClassification} onValueChange={setFilterClassification}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {classificationOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            {filteredItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No items found</div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItemId(item.id)}
                  className={`p-4 bg-muted/30 rounded-lg border-2 transition-all cursor-pointer ${
                    selectedItemId === item.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border/50 hover:border-border'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-semibold">{item.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {item.dataType} • {item.source} • Owner: {item.owner}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteItem(item.id)
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {item.classification}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Quality: {item.quality}%
                    </Badge>
                    {item.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        <Tag className="w-3 h-3 mr-1" />
                        {tag}
                      </Badge>
                    ))}
                    {item.tags.length > 2 && (
                      <Badge variant="secondary" className="text-xs">
                        +{item.tags.length - 2} more
                      </Badge>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {selectedItem && (
            <div className="bg-muted/30 rounded-lg border border-border p-4 space-y-4">
              <h3 className="font-semibold">Asset Details</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Name</div>
                  <div className="font-medium">{selectedItem.name}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Data Type</div>
                  <div className="font-medium">{selectedItem.dataType}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Source</div>
                  <div className="font-medium">{selectedItem.source}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Classification</div>
                  <Badge className="mt-1">{selectedItem.classification}</Badge>
                </div>
                <div>
                  <div className="text-muted-foreground">Owner</div>
                  <div className="font-medium">{selectedItem.owner}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Records</div>
                  <div className="font-medium">{selectedItem.records.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Quality Score</div>
                  <div className="font-medium text-green-600">{selectedItem.quality}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Created</div>
                  <div className="font-medium">{selectedItem.created}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last Modified</div>
                  <div className="font-medium">{selectedItem.lastModified}</div>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" className="flex-1">
                  <Eye className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" className="flex-1">
                  <Download className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" className="flex-1">
                  <Lock className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Catalog Items</div>
          <div className="text-2xl font-bold mt-2">{items.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Data Sources</div>
          <div className="text-2xl font-bold mt-2">
            {new Set(items.map((i) => i.source)).size}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Classifications</div>
          <div className="text-2xl font-bold mt-2">
            {new Set(items.map((i) => i.classification)).size}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Avg Quality</div>
          <div className="text-2xl font-bold mt-2">
            {Math.round(items.reduce((sum, i) => sum + i.quality, 0) / items.length)}%
          </div>
        </div>
      </div>
    </div>
  )
}
