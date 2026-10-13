'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/components/i18n/i18n-provider'
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
  /** Accessible name of the key inputs, e.g. "Header name" (defaults to "<keyPlaceholder> name"). */
  keyLabel?: string
  /** Accessible name of the value inputs, e.g. "Header value" (defaults to "<keyPlaceholder> value"). */
  valueLabel?: string
}

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
  const pairs = parseKeyValueList(value)
  const keyName = keyLabel ?? t('connect.kv.keyName', { name: keyPlaceholder })
  const valueName =
    valueLabel ?? (valuePlaceholder === t('connect.kv.value') ? t('connect.kv.valueName', { name: keyPlaceholder }) : valuePlaceholder)
  const rowName = keyPlaceholder.toLowerCase()

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
      <div aria-hidden className="grid grid-cols-[24px_1fr_1fr_32px] gap-2 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>
      {pairs.map((pair, index) => {
        const n = index + 1
        return (
          <div key={index} className="grid grid-cols-[24px_1fr_1fr_32px] items-center gap-2">
            <input
              type="checkbox"
              checked={pair.enabled}
              onChange={(e) => setPair(index, { enabled: e.target.checked })}
              className="size-4 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={t('connect.kv.sendRow', { name: rowName, n })}
            />
            <Input
              className="h-8 font-mono text-xs"
              placeholder={keyPlaceholder}
              aria-label={t('connect.kv.fieldRow', { label: keyName, n })}
              value={pair.key}
              onChange={(e) => setPair(index, { key: e.target.value })}
            />
            <Input
              className="h-8 font-mono text-xs"
              placeholder={valuePlaceholder}
              aria-label={t('connect.kv.fieldRow', { label: valueName, n })}
              value={pair.value}
              onChange={(e) => setPair(index, { value: e.target.value })}
              type={valuePlaceholder.toLowerCase().includes('secret') ? 'password' : 'text'}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="shrink-0"
              onClick={() => removeRow(index)}
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
                onChange={(e) => setPair(index, { description: e.target.value })}
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
