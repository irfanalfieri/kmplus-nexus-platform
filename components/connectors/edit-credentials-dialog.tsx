'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { getEditableCredentials, updateDataSourceCredentials } from '@/lib/actions/data-sources'
import { previewRestConnection } from '@/lib/actions/connector-source'
import RestConnectorForm from '@/components/connectors/rest-connector-form'
import SalesforceConnectorForm from '@/components/connectors/salesforce-connector-form'
import type { RestRequestPreview } from '@/lib/connectors/rest-client'

type Editable = Awaited<ReturnType<typeof getEditableCredentials>>

/**
 * Edit a data source's credentials. Secrets are never sent to the browser:
 * simple forms leave secret fields blank (blank keeps the stored value); the
 * REST and Salesforce forms show stored secrets as •••••••• (left as-is, the
 * stored value is kept). Changes are saved only after the merged credentials
 * pass a connection test.
 */
export default function EditCredentialsDialog({ sourceId, sourceName, onClose, onSaved }: { sourceId: string; sourceName: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Editable | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [restPreview, setRestPreview] = useState<RestRequestPreview | null>(null)
  const [restSending, setRestSending] = useState(false)
  const [touched, setTouched] = useState(false)
  const uid = useId()
  const formId = `${uid}-form`

  useEffect(() => {
    getEditableCredentials(sourceId)
      .then((res) => {
        setForm(res)
        if (res.supported) setValues(res.values)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [sourceId])

  const setValue = useCallback((key: string, value: string) => {
    setTouched(true)
    setValues((v) => ({ ...v, [key]: value }))
  }, [])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await updateDataSourceCredentials(sourceId, values)
      if (!res.ok) setError(`Connection test failed, nothing was saved: ${res.message}`)
      else onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const sendRestPreview = async () => {
    setRestSending(true)
    setError('')
    try {
      const preview = await previewRestConnection(values, sourceId)
      setRestPreview(preview)
      if (!preview.ok) setError(preview.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setRestSending(false)
    }
  }

  const custom = form?.supported ? form.custom : null

  return (
    <Modal
      onClose={onClose}
      dirty={touched && !busy}
      size={custom ? 'lg' : 'md'}
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" aria-hidden /> Edit credentials
        </span>
      }
      description={sourceName}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {form?.supported && (
            <Button type="submit" form={formId} disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}Test & save
            </Button>
          )}
        </>
      }
    >
      {!form ? (
        error ? null : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </div>
        )
      ) : !form.supported ? (
        <p className="text-sm text-muted-foreground">
          Credentials for this connector (<span className="font-mono">{form.sourceType}</span>) can&apos;t be edited here. Delete and re-create the data source to change them.
        </p>
      ) : (
        <form
          id={formId}
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {form.custom === 'rest' ? (
            <RestConnectorForm values={values} onChange={setValue} preview={restPreview} sending={restSending} onSend={() => void sendRestPreview()} />
          ) : form.custom === 'salesforce' ? (
            <SalesforceConnectorForm values={values} onChange={setValue} sourceId={sourceId} />
          ) : (
            (form.fields ?? []).map((f) => {
              const secretStored = (form.secretsSet ?? []).includes(f.key)
              const inputId = `${uid}-${f.key}`
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                    {f.label}
                    {f.required ? ' *' : ''}
                  </Label>
                  <Input
                    id={inputId}
                    type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                    value={values[f.key] ?? ''}
                    placeholder={f.type === 'password' ? (secretStored ? '•••••••• unchanged (type to replace)' : 'not set') : f.placeholder}
                    autoComplete="off"
                    onChange={(e) => setValue(f.key, e.target.value)}
                  />
                </div>
              )
            })
          )}
          <p className="text-xs text-muted-foreground">
            {custom
              ? 'Saved secrets show as ••••••••; leave them to keep the current value, or replace them. '
              : 'Leave secret fields blank to keep the current value. '}
            Saving tests the connection first and re-scans the schema.
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
        </form>
      )}
      {!form && error && <Notice tone="danger">{error}</Notice>}
    </Modal>
  )
}
