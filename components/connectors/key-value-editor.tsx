'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  EMPTY_KV,
  parseKeyValueList,
  serializeKeyValueList,
  type KeyValuePair,
} from '@/lib/connectors/rest/key-value'

interface KeyValueEditorProps {
  value: string
  onChange: (serialized: string) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  showDescription?: boolean
}

export default function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  showDescription = false,
}: KeyValueEditorProps) {
  const pairs = parseKeyValueList(value)

  const update = (next: KeyValuePair[]) => {
    onChange(serializeKeyValueList(next))
  }

  const setPair = (index: number, patch: Partial<KeyValuePair>) => {
    const next = pairs.map((p, i) => (i === index ? { ...p, ...patch } : p))
    update(next)
  }

  const addRow = () => update([...pairs, { key: '', value: '', enabled: true }])

  const removeRow = (index: number) => {
    const next = pairs.filter((_, i) => i !== index)
    update(next.length ? next : EMPTY_KV)
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[24px_1fr_1fr_32px] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>
      {pairs.map((pair, index) => (
        <div key={index} className="grid grid-cols-[24px_1fr_1fr_32px] items-center gap-2">
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={(e) => setPair(index, { enabled: e.target.checked })}
            className="h-4 w-4 rounded border-input"
            aria-label="Enable row"
          />
          <Input
            className="h-8 font-mono text-xs"
            placeholder={keyPlaceholder}
            value={pair.key}
            onChange={(e) => setPair(index, { key: e.target.value })}
          />
          <Input
            className="h-8 font-mono text-xs"
            placeholder={valuePlaceholder}
            value={pair.value}
            onChange={(e) => setPair(index, { value: e.target.value })}
            type={valuePlaceholder.toLowerCase().includes('secret') ? 'password' : 'text'}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => removeRow(index)}
            aria-label="Remove row"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {showDescription && (
            <Input
              className="col-span-4 h-8 font-mono text-xs"
              placeholder="Description (optional)"
              value={pair.description ?? ''}
              onChange={(e) => setPair(index, { description: e.target.value })}
            />
          )}
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-8" onClick={addRow}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add row
      </Button>
    </div>
  )
}
