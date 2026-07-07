'use client'

import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const MAPPINGS = [
  {
    id: 'map_1',
    sourceField: 'CustomerID',
    destinationField: 'CUST_ID',
    transformation: 'Direct',
    active: true,
  },
  {
    id: 'map_2',
    sourceField: 'FullName',
    destinationField: 'CUST_NAME',
    transformation: 'Trim & Uppercase',
    active: true,
  },
  {
    id: 'map_3',
    sourceField: 'EmailAddress',
    destinationField: 'EMAIL',
    transformation: 'Lowercase',
    active: true,
  },
  {
    id: 'map_4',
    sourceField: 'CreatedDate',
    destinationField: 'CREATE_DATE',
    transformation: 'Date Format',
    active: true,
  },
  {
    id: 'map_5',
    sourceField: 'TotalAmount',
    destinationField: 'ORDER_VALUE',
    transformation: 'Currency Conversion',
    active: true,
  },
]

export default function DataMappingLayer() {
  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Layer 6: Data Mapping Studio</h2>
            <p className="text-muted-foreground mt-2">
              Define field-level transformations and mappings between source and destination systems.
            </p>
          </div>
          <Button className="px-6">
            <Plus className="w-4 h-4 mr-2" />
            Add Mapping
          </Button>
        </div>

        <div className="space-y-3">
          {MAPPINGS.map((mapping) => (
            <div
              key={mapping.id}
              className="p-4 bg-muted/30 rounded-lg border border-border/50 flex items-center justify-between hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-4 flex-1">
                <div className="font-mono text-sm bg-background px-3 py-1 rounded">
                  {mapping.sourceField}
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
                <div className="font-mono text-sm bg-background px-3 py-1 rounded">
                  {mapping.destinationField}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline">{mapping.transformation}</Badge>
                {mapping.active ? (
                  <Badge className="bg-green-100 text-green-800">Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Total Mappings</div>
          <div className="text-2xl font-bold mt-2">{MAPPINGS.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Active</div>
          <div className="text-2xl font-bold mt-2">
            {MAPPINGS.filter((m) => m.active).length}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Transformations</div>
          <div className="text-2xl font-bold mt-2">
            {new Set(MAPPINGS.map((m) => m.transformation)).size}
          </div>
        </div>
      </div>
    </div>
  )
}
