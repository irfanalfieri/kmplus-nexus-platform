'use client'

import { useMemo, useState } from 'react'
import { X, Plus, Trash2, CheckCircle2, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface ColumnMappingModalProps {
  isOpen: boolean
  pipelineName: string
  onClose: () => void
  onSave: (mappings: MappingPayload) => void
}

interface SchemaColumn { name: string; type: string }
interface MappingStep { id: string; method: string; expression?: string }
interface ColumnMapping {
  id: string
  sourceColumn: string
  sourceType: string
  destinationColumn: string
  destinationType: string
  transformations: MappingStep[]
}
interface MappingPayload { targetTable: string | null; newTableName: string | null; mappings: ColumnMapping[] }

const SOURCE_COLUMNS: SchemaColumn[] = [
  { name: 'Document_ID', type: 'VARCHAR' }, { name: 'Customer_Code', type: 'VARCHAR' },
  { name: 'Customer_Name', type: 'VARCHAR' }, { name: 'Amount', type: 'DECIMAL' },
  { name: 'Currency', type: 'VARCHAR' }, { name: 'Document_Date', type: 'DATE' }, { name: 'Status', type: 'VARCHAR' },
]
const TABLE_SCHEMAS: Record<string, SchemaColumn[]> = {
  Customers: [{ name: 'id', type: 'INTEGER' }, { name: 'customer_code', type: 'VARCHAR' }, { name: 'customer_name', type: 'VARCHAR' }, { name: 'created_at', type: 'TIMESTAMP' }],
  Orders: [{ name: 'order_id', type: 'VARCHAR' }, { name: 'customer_code', type: 'VARCHAR' }, { name: 'amount', type: 'DECIMAL' }, { name: 'status', type: 'VARCHAR' }],
  Products: [{ name: 'sku', type: 'VARCHAR' }, { name: 'name', type: 'VARCHAR' }, { name: 'price', type: 'DECIMAL' }],
  Transactions: [{ name: 'transaction_id', type: 'VARCHAR' }, { name: 'amount', type: 'DECIMAL' }, { name: 'transaction_date', type: 'DATE' }],
  Audit_Log: [{ name: 'event_id', type: 'VARCHAR' }, { name: 'event_type', type: 'VARCHAR' }, { name: 'event_at', type: 'TIMESTAMP' }],
}
const METHODS = ['None', 'Uppercase', 'Lowercase', 'Title Case', 'Trim Whitespace', 'Date Format (YYYY-MM-DD)', 'Parse Integer', 'Parse Decimal', 'Round (2 decimals)', 'Replace Nulls', 'Conditional CASE']
const TYPES = ['VARCHAR', 'INTEGER', 'DECIMAL', 'DATE', 'TIMESTAMP', 'BOOLEAN']

export default function ColumnMappingModal({ isOpen, pipelineName, onClose, onSave }: ColumnMappingModalProps) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [tableName, setTableName] = useState('')
  const [existingTable, setExistingTable] = useState('')
  const [saved, setSaved] = useState(false)
  const [mappings, setMappings] = useState<ColumnMapping[]>(() => SOURCE_COLUMNS.slice(0, 2).map((column, index) => ({
    id: String(index + 1), sourceColumn: column.name, sourceType: column.type, destinationColumn: index ? 'customer_name' : 'doc_id', destinationType: column.type, transformations: [{ id: `${index}-1`, method: index ? 'Uppercase' : 'None' }],
  })))

  const destinationSchema = useMemo(() => existingTable ? TABLE_SCHEMAS[existingTable] || [] : [], [existingTable])
  const update = (id: string, patch: Partial<ColumnMapping>) => setMappings((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  const addMapping = () => setMappings((current) => [...current, { id: crypto.randomUUID(), sourceColumn: SOURCE_COLUMNS[0].name, sourceType: SOURCE_COLUMNS[0].type, destinationColumn: destinationSchema[0]?.name || '', destinationType: destinationSchema[0]?.type || 'VARCHAR', transformations: [{ id: crypto.randomUUID(), method: 'None' }] }])
  const addTransformation = (mapping: ColumnMapping) => update(mapping.id, { transformations: [...mapping.transformations, { id: crypto.randomUUID(), method: 'None' }] })
  const updateTransformation = (mapping: ColumnMapping, stepId: string, patch: Partial<MappingStep>) => update(mapping.id, { transformations: mapping.transformations.map((step) => step.id === stepId ? { ...step, ...patch } : step) })
  const removeTransformation = (mapping: ColumnMapping, stepId: string) => update(mapping.id, { transformations: mapping.transformations.filter((step) => step.id !== stepId) })
  const handleSave = () => { setSaved(true); onSave({ targetTable: mode === 'existing' ? existingTable : null, newTableName: mode === 'new' ? tableName : null, mappings }) }

  if (!isOpen) return null
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="max-h-[92vh] w-full max-w-6xl overflow-auto rounded-lg border border-border bg-card">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card p-6"><div><h3 className="text-lg font-semibold">Column Mapping & Table Creation</h3><p className="mt-1 text-sm text-muted-foreground">{pipelineName}</p></div><Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button></div>
      <div className="space-y-6 p-6">
        {saved ? <div className="py-12 text-center"><CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-600" /><h4 className="font-semibold text-green-600">Mappings saved</h4><Button className="mt-4" onClick={onClose}>Done</Button></div> : <>
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">Existing-table mode loads the source and destination schema automatically so incompatible mappings are visible before saving.</div>
          <div className="space-y-3"><label className="text-sm font-semibold">Destination</label><div className="flex gap-6 text-sm"><label className="flex items-center gap-2"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Create New Table</label><label className="flex items-center gap-2"><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Use Existing Table</label></div>{mode === 'new' ? <Input placeholder="New table name" value={tableName} onChange={(event) => setTableName(event.target.value)} /> : <Select value={existingTable} onValueChange={(value) => { if (!value) return; setExistingTable(value); setMappings((current) => current.map((item, index) => ({ ...item, destinationColumn: TABLE_SCHEMAS[value]?.[index]?.name || '', destinationType: TABLE_SCHEMAS[value]?.[index]?.type || 'VARCHAR' }))) }}><SelectTrigger><SelectValue placeholder="Select existing table to load schema" /></SelectTrigger><SelectContent>{Object.keys(TABLE_SCHEMAS).map((table) => <SelectItem key={table} value={table}>{table}</SelectItem>)}</SelectContent></Select>}</div>
          <div className="flex items-center justify-between"><div><h4 className="font-semibold">Source-to-destination mappings</h4><p className="text-xs text-muted-foreground">Each column can run an ordered chain of transformations.</p></div><Button size="sm" variant="outline" onClick={addMapping}><Plus className="mr-1 h-4 w-4" /> Add Mapping</Button></div>
          <div className="space-y-3">{mappings.map((mapping) => <div key={mapping.id} className="rounded-lg border border-border/60 bg-muted/20 p-4"><div className="grid gap-3 md:grid-cols-[1fr_110px_1fr_110px_auto]"><div><label className="text-xs">Source column</label><Select value={mapping.sourceColumn} onValueChange={(value) => { if (!value) return; const column = SOURCE_COLUMNS.find((item) => item.name === value)!; update(mapping.id, { sourceColumn: value, sourceType: column.type }) }}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent>{SOURCE_COLUMNS.map((column) => <SelectItem key={column.name} value={column.name}>{column.name}</SelectItem>)}</SelectContent></Select></div><div><label className="text-xs">Source type</label><Input className="mt-1 h-9 font-mono text-xs" value={mapping.sourceType} readOnly /></div><div><label className="text-xs">Destination column</label>{mode === 'existing' ? <Select value={mapping.destinationColumn} onValueChange={(value) => { if (!value) return; const column = destinationSchema.find((item) => item.name === value)!; update(mapping.id, { destinationColumn: value, destinationType: column.type }) }}><SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select column" /></SelectTrigger><SelectContent>{destinationSchema.map((column) => <SelectItem key={column.name} value={column.name}>{column.name}</SelectItem>)}</SelectContent></Select> : <Input className="mt-1 h-9" value={mapping.destinationColumn} onChange={(event) => update(mapping.id, { destinationColumn: event.target.value })} />}</div><div><label className="text-xs">Destination type</label>{mode === 'existing' ? <Input className="mt-1 h-9 font-mono text-xs" value={mapping.destinationType} readOnly /> : <Select value={mapping.destinationType} onValueChange={(value) => value && update(mapping.id, { destinationType: value })}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select>}</div><Button className="mt-5" size="icon" variant="ghost" onClick={() => setMappings((current) => current.filter((item) => item.id !== mapping.id))}><Trash2 className="h-4 w-4" /></Button></div><div className="mt-4 rounded-md border border-dashed border-border p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold">Transformation chain</span><Button size="sm" variant="ghost" onClick={() => addTransformation(mapping)}><Plus className="mr-1 h-3 w-3" /> Add step</Button></div><div className="space-y-2">{mapping.transformations.map((step, index) => <div key={step.id} className="flex items-center gap-2"><GripVertical className="h-4 w-4 text-muted-foreground" /><span className="w-5 text-xs text-muted-foreground">{index + 1}</span><Select value={step.method} onValueChange={(value) => value && updateTransformation(mapping, step.id, { method: value })}><SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectContent></Select>{step.method === 'Conditional CASE' && <Input className="h-8 flex-[2] font-mono text-xs" placeholder="CASE WHEN amount > 1000 THEN 'high' ELSE 'standard' END" value={step.expression || ''} onChange={(event) => updateTransformation(mapping, step.id, { expression: event.target.value })} />}{mapping.transformations.length > 1 && <Button size="icon" variant="ghost" onClick={() => removeTransformation(mapping, step.id)}><Trash2 className="h-3 w-3" /></Button>}</div>)}</div></div></div>)}</div>
          <div className="flex gap-2"><Button className="flex-1" onClick={handleSave} disabled={mode === 'new' ? !tableName.trim() : !existingTable}>Save Column Mappings</Button><Button className="flex-1" variant="outline" onClick={onClose}>Cancel</Button></div>
        </>}
      </div>
    </div>
  </div>
}
