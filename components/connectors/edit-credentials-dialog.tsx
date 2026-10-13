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
import { credentialFieldLabel } from '@/components/connectors/connector-credential-form'
import { useT } from '@/components/i18n/i18n-provider'
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
  const t = useT()
  const formId = `${uid}-form`

  useEffect(() => {
    getEditableCredentials(sourceId)
      .then((res) => {
        setForm(res)
        if (res.supported) setValues(res.values)
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('connect.editCredentials.loadFailed')))
  }, [sourceId]) // eslint-disable-line react-hooks/exhaustive-deps -- load once per source, not per language

  const setValue = useCallback((key: string, value: string) => {
    setTouched(true)
    setValues((v) => ({ ...v, [key]: value }))
  }, [])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await updateDataSourceCredentials(sourceId, values)
      if (!res.ok) setError(t('connect.editCredentials.testFailed', { message: res.message }))
      else onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('connect.editCredentials.saveFailed'))
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
      setError(err instanceof Error ? err.message : t('connect.editCredentials.requestFailed'))
    } finally {
      setRestSending(false)
    }
  }

  const custom = form?.supported ? form.custom : null
  const MARK = '\u0001'
  const notSupported = t('connect.editCredentials.notSupported', { type: MARK }).split(MARK)

  return (
    <Modal
      onClose={onClose}
      dirty={touched && !busy}
      size={custom ? 'lg' : 'md'}
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" aria-hidden /> {t('connect.editCredentials.title')}
        </span>
      }
      description={sourceName}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {form?.supported && (
            <Button type="submit" form={formId} disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}{t('connect.editCredentials.testSave')}
            </Button>
          )}
        </>
      }
    >
      {!form ? (
        error ? null : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </div>
        )
      ) : !form.supported ? (
        <p className="text-sm text-muted-foreground">
          {notSupported[0]}
          <span className="font-mono">{form.sourceType}</span>
          {notSupported[1]}
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
                    {credentialFieldLabel(t, f)}
                    {f.required ? ' *' : ''}
                  </Label>
                  <Input
                    id={inputId}
                    type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                    value={values[f.key] ?? ''}
                    placeholder={f.type === 'password' ? (secretStored ? t('connect.editCredentials.secretUnchanged') : t('connect.editCredentials.notSet')) : f.placeholder}
                    autoComplete="off"
                    onChange={(e) => setValue(f.key, e.target.value)}
                  />
                </div>
              )
            })
          )}
          <p className="text-xs text-muted-foreground">
            {custom ? t('connect.editCredentials.customHint') : t('connect.editCredentials.simpleHint')}{' '}
            {t('connect.editCredentials.testHint')}
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
        </form>
      )}
      {!form && error && <Notice tone="danger">{error}</Notice>}
    </Modal>
  )
}
