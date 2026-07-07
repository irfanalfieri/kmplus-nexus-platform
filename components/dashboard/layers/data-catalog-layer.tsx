'use client'

import { Tag, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const CATALOG_ITEMS = [
  {
    id: 'cat_1',
    name: 'Customer Master Data',
    dataType: 'Structured',
    source: 'SAP',
    classification: 'Business Critical',
    tags: ['customer', 'master', 'core'],
  },
  {
    id: 'cat_2',
    name: 'Order Transactions',
    dataType: 'Structured',
    source: 'Oracle',
    classification: 'High Priority',
    tags: ['orders', 'sales', 'revenue'],
  },
  {
    id: 'cat_3',
    name: 'Product Catalog',
    dataType: 'Structured',
    source: 'REST API',
    classification: 'Standard',
    tags: ['products', 'inventory', 'catalog'],
  },
  {
    id: 'cat_4',
    name: 'Financial Reports',
    dataType: 'Unstructured',
    source: 'CSV',
    classification: 'Confidential',
    tags: ['finance', 'reports', 'confidential'],
  },
]

export default function DataCatalogLayer() {
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
          <Button className="px-6">
            <Plus className="w-4 h-4 mr-2" />
            Add Item
          </Button>
        </div>

        <div className="space-y-3">
          {CATALOG_ITEMS.map((item) => (
            <div
              key={item.id}
              className="p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Type: {item.dataType} • Source: {item.source}
                  </div>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {item.classification}
                    </Badge>
                    {item.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        <Tag className="w-3 h-3 mr-1" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Catalog Items</div>
          <div className="text-2xl font-bold mt-2">{CATALOG_ITEMS.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Data Sources</div>
          <div className="text-2xl font-bold mt-2">
            {new Set(CATALOG_ITEMS.map((i) => i.source)).size}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Classifications</div>
          <div className="text-2xl font-bold mt-2">
            {new Set(CATALOG_ITEMS.map((i) => i.classification)).size}
          </div>
        </div>
      </div>
    </div>
  )
}
