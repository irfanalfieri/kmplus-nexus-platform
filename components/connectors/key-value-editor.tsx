'use client'

import { useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/components/i18n/i18n-provider'
import { parseKeyValueList, serializeKeyValueList, type KeyValuePair } from '@/lib/connectors/rest/key-value'

interface KeyValueEditorProps {
  value: string
  onChange: (serialized: string) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  showDescription?: boolean
  /** Accessible name of the key inputs, e.g. "Header name" (defaults to "<keyPlaceholder> name"). */
  keyLabel?: string
  /** Accessible name of the value inputs, e.g. "Header value" (defaults to "<keyPlaceholder> value"). */
  valueLabel?: string
}

type Row = KeyValuePair & { id: number }

/**
 * Rows of key / value pairs (query params, headers, form fields). The rows on
 * screen live here, so a new blank row stays until it is filled or removed;
 * the stored value (`serializeKeyValueList`) leaves blank rows out. When the
 * value changes from outside (a pasted connection, a reset), the rows follow it.
 */
export default function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder: keyPlaceholderProp,
  valuePlaceholder: valuePlaceholderProp,
  showDescription = false,
  keyLabel,
  valueLabel,
}: KeyValueEditorProps) {
  const t = useT()
  const keyPlaceholder = keyPlaceholderProp ?? t('connect.kv.key')
  const valuePlaceholder = valuePlaceholderProp ?? t('connect.kv.value')
  const keyName = keyLabel ?? t('connect.kv.keyName', { name: keyPlaceholder })
  const valueName =
    valueLabel ?? (valuePlaceholder === t('connect.kv.value') ? t('connect.kv.valueName', { name: keyPlaceholder }) : valuePlaceholder)
  const rowName = keyPlaceholder.toLowerCase()

  const nextId = useRef(0)
  const withIds = (pairs: KeyValuePair[]): Row[] => pairs.map((p) => ({ ...p, id: nextId.current++ }))
  const serialize = (list: Row[]) => serializeKeyValueList(list.map(({ id: _id, ...pair }) => pair))
  const [rows, setRows] = useState<Row[]>(() => withIds(parseKeyValueList(value)))
  // The value this editor last reported: anything else came from outside.
  const [reported, setReported] = useState(value)
  if (value !== reported) {
    setReported(value)
    if (value !== serialize(rows)) setRows(withIds(parseKeyValueList(value)))
  }

  const update = (next: Row[]) => {
    const rowsToShow = next.length ? next : withIds([{ key: '', value: '', enabled: true }])
    setRows(rowsToShow)
    const serialized = serialize(rowsToShow)
    setReported(serialized)
    if (serialized !== value) onChange(serialized)
  }

  const setPair = (id: number, patch: Partial<KeyValuePair>) => update(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const addRow = () => update([...rows, ...withIds([{ key: '', value: '', enabled: true }])])
  const removeRow = (id: number) => update(rows.filter((r) => r.id !== id))

  return (
    <div className="space-y-2">
      <div aria-hidden className="grid grid-cols-[24px_1fr_1fr_32px] gap-2 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>
      {rows.map((pair, index) => {
        const n = index + 1
        return (
          <div key={pair.id} className="grid grid-cols-[24px_1fr_1fr_32px] items-center gap-2">
            <input
              type="checkbox"
              checked={pair.enabled}
              onChange={(e) => setPair(pair.id, { enabled: e.target.checked })}
              className="size-4 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={t('connect.kv.sendRow', { name: rowName, n })}
            />
            <Input
              className="h-8 font-mono text-xs"
              placeholder={keyPlaceholder}
              aria-label={t('connect.kv.fieldRow', { label: keyName, n })}
              value={pair.key}
              onChange={(e) => setPair(pair.id, { key: e.target.value })}
            />
            <Input
              className="h-8 font-mono text-xs"
              placeholder={valuePlaceholder}
              aria-label={t('connect.kv.fieldRow', { label: valueName, n })}
              value={pair.value}
              onChange={(e) => setPair(pair.id, { value: e.target.value })}
              type={valuePlaceholder.toLowerCase().includes('secret') ? 'password' : 'text'}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="shrink-0"
              onClick={() => removeRow(pair.id)}
              aria-label={t('connect.kv.removeRow', { name: rowName, n })}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
            {showDescription && (
              <Input
                className="col-span-4 h-8 font-mono text-xs"
                placeholder={t('connect.kv.description')}
                aria-label={t('connect.kv.descriptionRow', { name: rowName, n })}
                value={pair.description ?? ''}
                onChange={(e) => setPair(pair.id, { description: e.target.value })}
              />
            )}
          </div>
        )
      })}
      <Button type="button" size="sm" variant="outline" onClick={addRow}>
        <Plus aria-hidden />
        {t('connect.kv.addRow')}
      </Button>
    </div>
  )
}
