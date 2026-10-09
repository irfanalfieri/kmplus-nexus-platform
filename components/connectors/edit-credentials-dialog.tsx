'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getEditableCredentials, updateDataSourceCredentials } from '@/app/actions/data-sources'
import { previewRestConnection } from '@/app/actions/connector-source'
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

  useEffect(() => {
    getEditableCredentials(sourceId)
      .then((res) => {
        setForm(res)
        if (res.supported) setValues(res.values)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [sourceId])

  const setValue = useCallback((key: string, value: string) => setValues((v) => ({ ...v, [key]: value })), [])

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Edit credentials for ${sourceName}`}>
      <div className={`max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-6 ${custom ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <KeyRound className="h-4 w-4 text-primary" /> Edit credentials
            </div>
            <div className="text-sm text-muted-foreground">{sourceName}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!form ? (
          error ? null : (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          )
        ) : !form.supported ? (
          <p className="text-sm text-muted-foreground">
            Credentials for this connector ({form.sourceType}) can&apos;t be edited here. Delete and re-create the data source to change them.
          </p>
        ) : (
          <form
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
                return (
                  <label key={f.key} className="block text-sm">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      {f.label}
                      {f.required ? ' *' : ''}
                    </span>
                    <Input
                      type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                      value={values[f.key] ?? ''}
                      placeholder={f.type === 'password' ? (secretStored ? '•••••••• unchanged (type to replace)' : 'not set') : f.placeholder}
                      autoComplete="off"
                      onChange={(e) => setValue(f.key, e.target.value)}
                    />
                  </label>
                )
              })
            )}
            <p className="text-xs text-muted-foreground">
              {custom
                ? 'Saved secrets show as ••••••••; leave them to keep the current value, or replace them. '
                : 'Leave secret fields blank to keep the current value. '}
              Saving tests the connection first and re-scans the schema.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Test & save
              </Button>
            </div>
          </form>
        )}
        {!form && error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
