'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/components/i18n/i18n-provider'
import { connect as connectMessages } from '@/lib/i18n/messages/en/connect'
import type { MessageKey, Translate } from '@/lib/i18n/translate'
import type { CredentialField } from '@/lib/connectors/types'
import RestConnectorForm from '@/components/connectors/rest-connector-form'
import SalesforceConnectorForm from '@/components/connectors/salesforce-connector-form'

const OPTIONAL_SUFFIX = ' (optional)'
const KNOWN_FIELDS: Record<string, string> = connectMessages.fields

/**
 * The label of a catalog credential field in the interface language. Common
 * fields (host, port, database, username, password, …) are translated by key
 * when the catalog label is the usual one; anything else keeps the catalog label.
 */
export function credentialFieldLabel(t: Translate, field: Pick<CredentialField, 'key' | 'label'>): string {
  const optional = field.label.endsWith(OPTIONAL_SUFFIX)
  const base = optional ? field.label.slice(0, -OPTIONAL_SUFFIX.length) : field.label
  if (!Object.prototype.hasOwnProperty.call(KNOWN_FIELDS, field.key) || KNOWN_FIELDS[field.key] !== base) return field.label
  const text = t(`connect.fields.${field.key}` as MessageKey)
  return optional ? `${text} ${t('connect.credentialForm.optional')}` : text
}

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
  const uid = useId()
  const t = useT()
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

  const optional = t('connect.credentialForm.optional')
  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const label = credentialFieldLabel(t, field)
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`${uid}-${field.key}`} className="text-xs text-muted-foreground">
              {label}
              {!field.required && !label.endsWith(optional) ? ` ${optional}` : ''}
            </Label>
            <Input
              id={`${uid}-${field.key}`}
              type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
              placeholder={field.placeholder ?? label}
              value={values[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              required={field.required}
            />
          </div>
        )
      })}
    </div>
  )
}
