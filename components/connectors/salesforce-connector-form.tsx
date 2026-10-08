'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
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
import { startSalesforceWebAuth } from '@/app/actions/salesforce-oauth'

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
}

function val(values: Record<string, string>, key: string) {
  return values[key] ?? SALESFORCE_DEFAULTS[key] ?? ''
}

export default function SalesforceConnectorForm({ values, onChange }: SalesforceConnectorFormProps) {
  const authMethod = val(values, 'authMethod') || 'web_oauth'
  const connected = Boolean(val(values, 'accessToken') && val(values, 'instanceUrl'))
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

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
        setError(event.data.message ?? 'Salesforce authorization failed.')
        return
      }

      setError('')
      if (event.data.credentials) {
        applyCredentials(event.data.credentials as Record<string, string>)
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [applyCredentials])

  const connectWithSalesforce = async () => {
    setError('')
    const clientId = val(values, 'clientId').trim()
    const clientSecret = val(values, 'clientSecret').trim()
    if (!clientId || !clientSecret) {
      setError('Enter Consumer Key and Consumer Secret from your Salesforce Connected App first.')
      return
    }

    setConnecting(true)
    try {
      const { authorizeUrl } = await startSalesforceWebAuth({
        clientId,
        clientSecret,
        loginHost: val(values, 'loginHost'),
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
      setError(err instanceof Error ? err.message : 'Failed to start Salesforce login.')
    }
  }

  const redirectUri =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/connectors/salesforce/callback`
      : '/api/connectors/salesforce/callback'

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Authentication</Label>
        <Select
          value={authMethod}
          onValueChange={(v) => v && onChange('authMethod', v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="web_oauth">Web login (OAuth 2.0 — recommended)</SelectItem>
            <SelectItem value="password">Username & password (legacy)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Environment</Label>
          <Select value={val(values, 'loginHost')} onValueChange={(v) => v && onChange('loginHost', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="login">Production (login.salesforce.com)</SelectItem>
              <SelectItem value="test">Sandbox (test.salesforce.com)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Callback URL (Connected App)</Label>
          <Input readOnly className="h-9 font-mono text-[11px]" value={redirectUri} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Consumer Key (Client ID)</Label>
        <Input
          placeholder="3MVG9…"
          value={val(values, 'clientId')}
          onChange={(e) => onChange('clientId', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Consumer Secret (Client Secret)</Label>
        <Input
          type="password"
          value={val(values, 'clientSecret')}
          onChange={(e) => onChange('clientSecret', e.target.value)}
        />
      </div>

      {authMethod === 'web_oauth' ? (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
          {connected ? (
            <div className="flex items-start gap-2 text-sm text-green-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Connected via Salesforce web login</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {val(values, 'instanceUrl')}
                </p>
                {val(values, 'connectedAt') && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Authorized {new Date(val(values, 'connectedAt')).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sign in with your Salesforce org in the browser. Tokens are stored securely with this data source.
            </p>
          )}

          <Button
            type="button"
            className="w-full bg-[#0176D3] hover:bg-[#0162b3]"
            disabled={connecting}
            onClick={() => void connectWithSalesforce()}
          >
            {connecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Waiting for Salesforce…
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" />
                {connected ? 'Reconnect with Salesforce' : 'Connect with Salesforce'}
              </>
            )}
          </Button>

          <p className="text-[11px] text-muted-foreground">
            In Salesforce Setup → App Manager → your Connected App, enable OAuth and add the callback URL above.
            Use scopes: <code className="rounded bg-muted px-1">api</code>,{' '}
            <code className="rounded bg-muted px-1">refresh_token</code>,{' '}
            <code className="rounded bg-muted px-1">offline_access</code>.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Instance URL (optional)</Label>
            <Input
              placeholder="https://yourorg.my.salesforce.com"
              value={val(values, 'instanceUrl')}
              onChange={(e) => onChange('instanceUrl', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Username</Label>
            <Input value={val(values, 'username')} onChange={(e) => onChange('username', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Password + Security Token</Label>
            <Input
              type="password"
              value={val(values, 'password')}
              onChange={(e) => onChange('password', e.target.value)}
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
