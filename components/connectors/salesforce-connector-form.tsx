'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Notice } from '@/components/ui/notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { startSalesforceWebAuth } from '@/lib/actions/salesforce-oauth'
import { usePrefs } from '@/components/i18n/i18n-provider'

export const SALESFORCE_DEFAULTS: Record<string, string> = {
  authMethod: 'web_oauth',
  loginHost: 'login',
  clientId: '',
  clientSecret: '',
  instanceUrl: '',
  accessToken: '',
  refreshToken: '',
  connectedAt: '',
  username: '',
  password: '',
}

interface SalesforceConnectorFormProps {
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** Set when editing an existing source: a masked Consumer Secret is read server-side. */
  sourceId?: string
}

function val(values: Record<string, string>, key: string) {
  return values[key] ?? SALESFORCE_DEFAULTS[key] ?? ''
}

export default function SalesforceConnectorForm({ values, onChange, sourceId }: SalesforceConnectorFormProps) {
  const authMethod = val(values, 'authMethod') || 'web_oauth'
  const connected = Boolean(val(values, 'accessToken') && val(values, 'instanceUrl'))
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const uid = useId()
  const { t, formatDateTime } = usePrefs()
  const fid = (key: string) => `${uid}-${key}`

  const applyCredentials = useCallback(
    (creds: Record<string, string>) => {
      for (const [key, value] of Object.entries(creds)) {
        onChange(key, value)
      }
    },
    [onChange]
  )

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'kmplus:salesforce-oauth') return

      setConnecting(false)
      if (!event.data.ok) {
        setError(event.data.message ?? t('connect.salesforce.authFailed'))
        return
      }

      setError('')
      if (event.data.credentials) {
        applyCredentials(event.data.credentials as Record<string, string>)
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [applyCredentials, t])

  const connectWithSalesforce = async () => {
    setError('')
    const clientId = val(values, 'clientId').trim()
    const clientSecret = val(values, 'clientSecret').trim()
    if (!clientId || !clientSecret) {
      setError(t('connect.salesforce.needKeys'))
      return
    }

    setConnecting(true)
    try {
      const { authorizeUrl } = await startSalesforceWebAuth({
        clientId,
        clientSecret,
        loginHost: val(values, 'loginHost'),
        sourceId,
      })

      const popup = window.open(
        authorizeUrl,
        'salesforce-oauth',
        'width=520,height=720,scrollbars=yes,resizable=yes'
      )

      if (!popup) {
        window.location.href = authorizeUrl
        return
      }

      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer)
          setConnecting(false)
        }
      }, 500)
    } catch (err) {
      setConnecting(false)
      setError(err instanceof Error ? err.message : t('connect.salesforce.startFailed'))
    }
  }

  const redirectUri =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/connectors/salesforce/callback`
      : '/api/connectors/salesforce/callback'

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={fid('authMethod')} className="text-xs text-muted-foreground">{t('connect.salesforce.authentication')}</Label>
        <Select
          value={authMethod}
          onValueChange={(v) => v && onChange('authMethod', v)}
        >
          <SelectTrigger id={fid('authMethod')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="web_oauth">{t('connect.salesforce.webOauth')}</SelectItem>
            <SelectItem value="password">{t('connect.salesforce.passwordLegacy')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={fid('loginHost')} className="text-xs text-muted-foreground">{t('connect.salesforce.environment')}</Label>
          <Select value={val(values, 'loginHost')} onValueChange={(v) => v && onChange('loginHost', v)}>
            <SelectTrigger id={fid('loginHost')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="login">{t('connect.salesforce.production')}</SelectItem>
              <SelectItem value="test">{t('connect.salesforce.sandbox')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={fid('callbackUrl')} className="text-xs text-muted-foreground">{t('connect.salesforce.callbackUrl')}</Label>
          <Input id={fid('callbackUrl')} readOnly className="h-9 font-mono text-[11px]" value={redirectUri} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={fid('clientId')} className="text-xs text-muted-foreground">{t('connect.salesforce.consumerKey')}</Label>
        <Input id={fid('clientId')}
          placeholder="3MVG9…"
          value={val(values, 'clientId')}
          onChange={(e) => onChange('clientId', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={fid('clientSecret')} className="text-xs text-muted-foreground">{t('connect.salesforce.consumerSecret')}</Label>
        <Input id={fid('clientSecret')}
          type="password"
          value={val(values, 'clientSecret')}
          onChange={(e) => onChange('clientSecret', e.target.value)}
        />
      </div>

      {authMethod === 'web_oauth' ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
          {connected ? (
            <div className="flex items-start gap-2 text-sm" role="status">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-live" aria-hidden />
              <div>
                <p className="font-medium text-live-text">{t('connect.salesforce.connected')}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {val(values, 'instanceUrl')}
                </p>
                {val(values, 'connectedAt') && (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {t('connect.salesforce.authorized', { time: formatDateTime(val(values, 'connectedAt')) })}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('connect.salesforce.signInHint')}
            </p>
          )}

          <Button
            type="button"
            className="w-full"
            disabled={connecting}
            onClick={() => void connectWithSalesforce()}
          >
            {connecting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                {t('connect.salesforce.waiting')}
              </>
            ) : (
              <>
                <ExternalLink aria-hidden />
                {connected ? t('connect.salesforce.reconnect') : t('connect.salesforce.connect')}
              </>
            )}
          </Button>

          <p className="text-[11px] text-muted-foreground">
            {t('connect.salesforce.setupHint')}{' '}
            {t('connect.salesforce.scopes')} <code className="rounded-sm bg-muted px-1 font-mono">api</code>,{' '}
            <code className="rounded-sm bg-muted px-1 font-mono">refresh_token</code>,{' '}
            <code className="rounded-sm bg-muted px-1 font-mono">offline_access</code>.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={fid('instanceUrl')} className="text-xs text-muted-foreground">{t('connect.salesforce.instanceUrl')}</Label>
            <Input id={fid('instanceUrl')}
              placeholder="https://yourorg.my.salesforce.com"
              value={val(values, 'instanceUrl')}
              onChange={(e) => onChange('instanceUrl', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fid('username')} className="text-xs text-muted-foreground">{t('connect.salesforce.username')}</Label>
            <Input id={fid('username')} value={val(values, 'username')} onChange={(e) => onChange('username', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fid('password')} className="text-xs text-muted-foreground">{t('connect.salesforce.passwordToken')}</Label>
            <Input id={fid('password')}
              type="password"
              value={val(values, 'password')}
              onChange={(e) => onChange('password', e.target.value)}
            />
          </div>
        </>
      )}

      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  )
}
