'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CredentialField } from '@/lib/connectors/types'
import RestConnectorForm from '@/components/connectors/rest-connector-form'
import SalesforceConnectorForm from '@/components/connectors/salesforce-connector-form'

interface ConnectorCredentialFormProps {
  connectorSlug?: string
  fields: CredentialField[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  restPreview?: import('@/lib/connectors/rest-client').RestRequestPreview | null
  restSending?: boolean
  onRestSend?: () => void
}

export default function ConnectorCredentialForm({
  connectorSlug,
  fields,
  values,
  onChange,
  restPreview,
  restSending,
  onRestSend,
}: ConnectorCredentialFormProps) {
  if (connectorSlug === 'rest') {
    return (
      <RestConnectorForm
        values={values}
        onChange={onChange}
        preview={restPreview}
        sending={restSending}
        onSend={onRestSend}
      />
    )
  }

  if (connectorSlug === 'salesforce') {
    return <SalesforceConnectorForm values={values} onChange={onChange} />
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {field.label}
            {!field.required ? ' (optional)' : ''}
          </Label>
          <Input
            type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
            placeholder={field.placeholder ?? field.label}
            value={values[field.key] ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            required={field.required}
          />
        </div>
      ))}
    </div>
  )
}
