'use client'

import { useState } from 'react'
import { X, Plus, Trash2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

interface ColumnMappingModalProps {
  isOpen: boolean
  pipelineName: string
  onClose: () => void
  onSave: (mappings: any) => void
}

const TRANSFORMATION_TYPES = [
  'None',
  'Uppercase',
  'Lowercase',
  'Title Case',
  'Date Format (YYYY-MM-DD)',
  'Date Format (MM/DD/YYYY)',
  'Round (2 decimals)',
  'Parse Integer',
  'Parse Decimal',
  'Trim Whitespace',
  'Replace Nulls',
]

const SOURCE_COLUMNS = [
  'Document_ID',
  'Customer_Code',
  'Customer_Name',
  'Amount',
  'Currency',
  'Document_Date',
  'Status',
]

const EXISTING_TABLES = ['Customers', 'Orders', 'Products', 'Transactions', 'Audit_Log']

interface ColumnMapping {
  id: string
  sourceColumn: string
  destinationTable: string
  newColumnName: string
  dataType: string
  transformation: string
}

export default function ColumnMappingModal({
  isOpen,
  pipelineName,
  onClose,
  onSave,
}: ColumnMappingModalProps) {
  const [createMode, setCreateMode] = useState<'new' | 'existing'>('new')
  const [newTableName, setNewTableName] = useState('')
  const [selectedExistingTable, setSelectedExistingTable] = useState('')
  const [mappings, setMappings] = useState<ColumnMapping[]>([
    {
      id: '1',
      sourceColumn: 'Document_ID',
      destinationTable: 'New Table',
      newColumnName: 'doc_id',
      dataType: 'VARCHAR',
      transformation: 'None',
    },
    {
      id: '2',
      sourceColumn: 'Customer_Name',
      destinationTable: 'New Table',
      newColumnName: 'customer_name',
      dataType: 'VARCHAR',
      transformation: 'Uppercase',
    },
  ])
  const [savedCount, setSavedCount] = useState(0)

  const addMapping = () => {
    const newMapping: ColumnMapping = {
      id: Date.now().toString(),
      sourceColumn: SOURCE_COLUMNS[0],
      destinationTable: createMode === 'new' ? 'New Table' : selectedExistingTable,
      newColumnName: '',
      dataType: 'VARCHAR',
      transformation: 'None',
    }
    setMappings([...mappings, newMapping])
  }

  const removeMapping = (id: string) => {
    setMappings(mappings.filter((m) => m.id !== id))
  }

  const updateMapping = (id: string, field: string, value: string) => {
    setMappings(
      mappings.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    )
  }

  const handleSave = () => {
    setSavedCount(mappings.length)
    setTimeout(() => {
      onSave({
        newTableName: createMode === 'new' ? newTableName : null,
        targetTable: createMode === 'existing' ? selectedExistingTable : null,
        mappings,
      })
      onClose()
    }, 1500)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg border border-border max-w-5xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Column Mapping & Table Creation</h3>
            <p className="text-sm text-muted-foreground mt-1">{pipelineName}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {savedCount === 0 ? (
            <>
              <div className="bg-blue-100/50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  Map columns from your data source to create a new table or insert into an existing table. You can apply transformations to each column.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold mb-3 block">Destination Table</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value="new"
                        checked={createMode === 'new'}
                        onChange={(e) => setCreateMode(e.target.value as 'new' | 'existing')}
                      />
                      <span className="text-sm">Create New Table</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value="existing"
                        checked={createMode === 'existing'}
                        onChange={(e) => setCreateMode(e.target.value as 'new' | 'existing')}
                      />
                      <span className="text-sm">Use Existing Table</span>
                    </label>
                  </div>
                </div>

                {createMode === 'new' && (
                  <Input
                    placeholder="Enter new table name (e.g., sales_documents)"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                  />
                )}

                {createMode === 'existing' && (
                  <Select value={selectedExistingTable} onValueChange={setSelectedExistingTable}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select existing table" />
                    </SelectTrigger>
                    <SelectContent>
                      {EXISTING_TABLES.map((table) => (
                        <SelectItem key={table} value={table}>
                          {table}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">Column Mappings</h4>
                  <Button size="sm" onClick={addMapping} variant="outline">
                    <Plus className="w-4 h-4 mr-1" />
                    Add Mapping
                  </Button>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {mappings.map((mapping) => (
                    <div
                      key={mapping.id}
                      className="bg-muted/30 border border-border/50 rounded-lg p-4 space-y-3"
                    >
                      <div className="grid grid-cols-6 gap-3">
                        <div>
                          <label className="text-xs font-medium block mb-1">Source Column</label>
                          <Select
                            value={mapping.sourceColumn}
                            onValueChange={(val) =>
                              updateMapping(mapping.id, 'sourceColumn', val)
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SOURCE_COLUMNS.map((col) => (
                                <SelectItem key={col} value={col}>
                                  {col}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <label className="text-xs font-medium block mb-1">New Column Name</label>
                          <Input
                            size={1}
                            placeholder="e.g., doc_id"
                            value={mapping.newColumnName}
                            onChange={(e) =>
                              updateMapping(mapping.id, 'newColumnName', e.target.value)
                            }
                            className="h-8"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-medium block mb-1">Data Type</label>
                          <Select
                            value={mapping.dataType}
                            onValueChange={(val) =>
                              updateMapping(mapping.id, 'dataType', val)
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="VARCHAR">VARCHAR</SelectItem>
                              <SelectItem value="INTEGER">INTEGER</SelectItem>
                              <SelectItem value="DECIMAL">DECIMAL</SelectItem>
                              <SelectItem value="DATE">DATE</SelectItem>
                              <SelectItem value="TIMESTAMP">TIMESTAMP</SelectItem>
                              <SelectItem value="BOOLEAN">BOOLEAN</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="col-span-2">
                          <label className="text-xs font-medium block mb-1">Transformation</label>
                          <Select
                            value={mapping.transformation}
                            onValueChange={(val) =>
                              updateMapping(mapping.id, 'transformation', val)
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TRANSFORMATION_TYPES.map((trans) => (
                                <SelectItem key={trans} value={trans}>
                                  {trans}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeMapping(mapping.id)}
                            className="w-full h-8"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSave} className="flex-1">
                  Save Column Mappings
                </Button>
                <Button onClick={onClose} variant="outline" className="flex-1">
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="py-12 text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
              <div>
                <div className="font-semibold text-green-600">Mappings Saved Successfully</div>
                <p className="text-sm text-muted-foreground mt-2">
                  {savedCount} column mappings configured and ready for deployment.
                </p>
              </div>
              <Button onClick={onClose}>Done</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
