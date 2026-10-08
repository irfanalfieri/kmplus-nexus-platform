'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import KeyValueEditor from '@/components/connectors/key-value-editor'
import {
  REST_DEFAULTS,
  type RestAuthMethod,
  type RestBodyType,
  type RestHttpMethod,
  type RestIntegrationScheme,
  type RestRequestPreview,
  parseConnectionPaste,
  sanitizeRestCredentials,
} from '@/lib/connectors/rest-client'

interface RestConnectorFormProps {
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  preview?: RestRequestPreview | null
  sending?: boolean
  onSend?: () => void
}

function val(values: Record<string, string>, key: keyof typeof REST_DEFAULTS) {
  return values[key] ?? REST_DEFAULTS[key]
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground/80">{hint}</p> : null}
    </div>
  )
}

const METHODS: RestHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export default function RestConnectorForm({
  values,
  onChange,
  preview,
  sending,
  onSend,
}: RestConnectorFormProps) {
  const scheme = val(values, 'integrationScheme') as RestIntegrationScheme
  const authMethod = val(values, 'authMethod') as RestAuthMethod
  const bodyType = val(values, 'bodyType') as RestBodyType
  const resolvedBodyType = scheme === 'graphql' ? 'graphql' : bodyType

  const fullUrlPreview = `${val(values, 'baseUrl').replace(/\/+$/, '')}${val(values, 'resourcePath').startsWith('/') ? '' : '/'}${val(values, 'resourcePath')}`
  const [pasteBox, setPasteBox] = useState('')
  const [pasteHint, setPasteHint] = useState('')

  const applyPatch = useCallback(
    (patch: Record<string, string>) => {
      for (const [key, value] of Object.entries(patch)) {
        onChange(key, value)
      }
    },
    [onChange]
  )

  const importConnection = useCallback(
    (raw: string) => {
      const parsed = parseConnectionPaste(raw)
      if (!parsed) {
        setPasteHint('Could not parse — use: url: https://… then auth: eyJ…')
        return false
      }
      applyPatch({
        baseUrl: parsed.baseUrl ?? val(values, 'baseUrl'),
        resourcePath: parsed.resourcePath ?? val(values, 'resourcePath'),
        authMethod: parsed.authMethod ?? 'bearer',
        bearerToken: parsed.bearerToken ?? '',
        bearerPrefix: parsed.bearerPrefix ?? 'Bearer',
        ...(parsed.customHeaderName
          ? {
              customHeaderName: parsed.customHeaderName,
              customHeaderValue: parsed.customHeaderValue ?? '',
            }
          : {}),
      })
      setPasteHint('Imported — URL and Bearer token applied.')
      return true
    },
    [applyPatch, values]
  )

  const handlePaste = (raw: string) => {
    if (raw.includes('auth') || raw.includes('eyJ') || raw.match(/url\s*:/i)) {
      importConnection(raw)
    }
  }

  useEffect(() => {
    const baseUrl = val(values, 'baseUrl')
    if (baseUrl.includes(' auth:') || (baseUrl.includes('eyJ') && baseUrl.startsWith('http'))) {
      const fixed = sanitizeRestCredentials(values)
      if (fixed.baseUrl !== baseUrl) {
        applyPatch(fixed)
        setPasteHint('Fixed URL — auth token moved to Authorization tab.')
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 p-3 space-y-2">
        <Label className="text-xs text-muted-foreground">
          Quick import — paste <code className="text-[10px]">url:</code> + <code className="text-[10px]">auth:</code>
        </Label>
        <textarea
          className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[11px]"
          placeholder={`url: https://developmentplan-service-portaverse.pelindo.co.id/tms/v2/event-talent/ninebox\nauth: eyJhbGci…`}
          value={pasteBox}
          onChange={(e) => setPasteBox(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            window.setTimeout(() => handlePaste(text), 0)
          }}
        />
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => importConnection(pasteBox)}>
            Import connection
          </Button>
          {pasteHint ? <span className="text-[11px] text-muted-foreground">{pasteHint}</span> : null}
        </div>
      </div>

      {/* Postman-style request line */}
      <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
        <div className="flex items-stretch border-b border-border/60">
          <Select
            value={val(values, 'httpMethod')}
            onValueChange={(v) => v && onChange('httpMethod', v)}
          >
            <SelectTrigger className="h-10 w-[110px] shrink-0 rounded-none border-0 border-r bg-background font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-10 flex-1 rounded-none border-0 font-mono text-sm focus-visible:ring-0"
            placeholder="https://api.example.com (host only)"
            value={val(values, 'baseUrl')}
            onChange={(e) => onChange('baseUrl', e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text')
              if (text.includes('auth') || text.includes('eyJ') || text.includes('/tms/')) {
                e.preventDefault()
                importConnection(text)
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <Input
            className="h-8 flex-1 font-mono text-xs"
            placeholder="/resource/path"
            value={val(values, 'resourcePath')}
            onChange={(e) => onChange('resourcePath', e.target.value)}
          />
          {onSend && (
            <button
              type="button"
              onClick={onSend}
              disabled={sending}
              className="shrink-0 rounded-md bg-orange-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
        <div className="border-t border-border/40 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
          {fullUrlPreview || 'Enter base URL and path'}
        </div>
      </div>

      <Tabs defaultValue="params" className="w-full">
        <TabsList className="h-9 w-full justify-start overflow-x-auto">
          <TabsTrigger value="params">Params</TabsTrigger>
          <TabsTrigger value="auth">Authorization</TabsTrigger>
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="variables">Variables</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="params" className="mt-3 rounded-lg border border-border/50 p-3">
          <KeyValueEditor
            value={val(values, 'paramsKv')}
            onChange={(v) => onChange('paramsKv', v)}
            keyPlaceholder="Query param"
            valuePlaceholder="Value"
          />
        </TabsContent>

        <TabsContent value="auth" className="mt-3 space-y-3 rounded-lg border border-border/50 p-3">
          <Field label="Type">
            <Select value={authMethod} onValueChange={(v) => v && onChange('authMethod', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Auth</SelectItem>
                <SelectItem value="api_key">API Key</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="basic">Basic Auth</SelectItem>
                <SelectItem value="custom_header">Custom Header</SelectItem>
                <SelectItem value="oauth2_client_credentials">OAuth 2.0 — Client Credentials</SelectItem>
                <SelectItem value="oauth2_password">OAuth 2.0 — Password Grant</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {authMethod === 'api_key' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Add to">
                  <Select
                    value={val(values, 'apiKeyLocation')}
                    onValueChange={(v) => v && onChange('apiKeyLocation', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="header">Header</SelectItem>
                      <SelectItem value="query">Query Params</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Header / param name">
                  <Input value={val(values, 'apiKeyHeader')} onChange={(e) => onChange('apiKeyHeader', e.target.value)} />
                </Field>
              </div>
              <Field label="Prefix (optional)" hint='e.g. "Bearer" — prepended before the key value'>
                <Input value={val(values, 'apiKeyPrefix')} onChange={(e) => onChange('apiKeyPrefix', e.target.value)} />
              </Field>
              <Field label="Value">
                <Input type="password" value={val(values, 'apiKeyValue')} onChange={(e) => onChange('apiKeyValue', e.target.value)} />
              </Field>
            </>
          )}

          {authMethod === 'bearer' && (
            <>
              <Field label="Token prefix">
                <Input value={val(values, 'bearerPrefix')} onChange={(e) => onChange('bearerPrefix', e.target.value)} />
              </Field>
              <Field label="Token">
                <Input type="password" value={val(values, 'bearerToken')} onChange={(e) => onChange('bearerToken', e.target.value)} />
              </Field>
            </>
          )}

          {authMethod === 'basic' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Username">
                <Input value={val(values, 'basicUsername')} onChange={(e) => onChange('basicUsername', e.target.value)} />
              </Field>
              <Field label="Password">
                <Input type="password" value={val(values, 'basicPassword')} onChange={(e) => onChange('basicPassword', e.target.value)} />
              </Field>
            </div>
          )}

          {authMethod === 'custom_header' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Header name">
                <Input value={val(values, 'customHeaderName')} onChange={(e) => onChange('customHeaderName', e.target.value)} />
              </Field>
              <Field label="Header value">
                <Input type="password" value={val(values, 'customHeaderValue')} onChange={(e) => onChange('customHeaderValue', e.target.value)} />
              </Field>
            </div>
          )}

          {(authMethod === 'oauth2_client_credentials' || authMethod === 'oauth2_password') && (
            <>
              <Field label="Access Token URL">
                <Input value={val(values, 'oauthTokenUrl')} onChange={(e) => onChange('oauthTokenUrl', e.target.value)} placeholder="https://auth.example.com/oauth/token" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Client ID">
                  <Input value={val(values, 'oauthClientId')} onChange={(e) => onChange('oauthClientId', e.target.value)} />
                </Field>
                <Field label="Client Secret">
                  <Input type="password" value={val(values, 'oauthClientSecret')} onChange={(e) => onChange('oauthClientSecret', e.target.value)} />
                </Field>
              </div>
              {authMethod === 'oauth2_password' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Username">
                    <Input value={val(values, 'oauthUsername')} onChange={(e) => onChange('oauthUsername', e.target.value)} />
                  </Field>
                  <Field label="Password">
                    <Input type="password" value={val(values, 'oauthPassword')} onChange={(e) => onChange('oauthPassword', e.target.value)} />
                  </Field>
                </div>
              )}
              <Field label="Scope (optional)">
                <Input value={val(values, 'oauthScope')} onChange={(e) => onChange('oauthScope', e.target.value)} />
              </Field>
            </>
          )}
        </TabsContent>

        <TabsContent value="headers" className="mt-3 rounded-lg border border-border/50 p-3">
          <KeyValueEditor
            value={val(values, 'headersKv')}
            onChange={(v) => onChange('headersKv', v)}
            keyPlaceholder="Header"
            valuePlaceholder="Value"
          />
        </TabsContent>

        <TabsContent value="body" className="mt-3 space-y-3 rounded-lg border border-border/50 p-3">
          <Field label="Integration scheme">
            <Select value={scheme} onValueChange={(v) => v && onChange('integrationScheme', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rest_json">REST / JSON</SelectItem>
                <SelectItem value="graphql">GraphQL</SelectItem>
                <SelectItem value="odata">OData</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {scheme !== 'graphql' && (
            <Field label="Body type">
              <Select value={bodyType} onValueChange={(v) => v && onChange('bodyType', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">none</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="raw">raw</SelectItem>
                  <SelectItem value="urlencoded">x-www-form-urlencoded</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {resolvedBodyType === 'graphql' && (
            <Field label="GraphQL query">
              <textarea
                className="min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                placeholder={`query Users {\n  users(limit: 5) { id name email }\n}`}
                value={val(values, 'graphqlQuery')}
                onChange={(e) => onChange('graphqlQuery', e.target.value)}
              />
            </Field>
          )}

          {resolvedBodyType === 'json' && (
            <Field label="JSON body">
              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                placeholder='{"filter":"active"}'
                value={val(values, 'requestBody')}
                onChange={(e) => onChange('requestBody', e.target.value)}
              />
            </Field>
          )}

          {resolvedBodyType === 'raw' && (
            <>
              <Field label="Content-Type">
                <Input value={val(values, 'rawContentType')} onChange={(e) => onChange('rawContentType', e.target.value)} />
              </Field>
              <Field label="Raw body">
                <textarea
                  className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                  value={val(values, 'requestBody')}
                  onChange={(e) => onChange('requestBody', e.target.value)}
                />
              </Field>
            </>
          )}

          {resolvedBodyType === 'urlencoded' && (
            <KeyValueEditor
              value={val(values, 'bodyKv')}
              onChange={(v) => onChange('bodyKv', v)}
              keyPlaceholder="Field"
              valuePlaceholder="Value"
            />
          )}
        </TabsContent>

        <TabsContent value="variables" className="mt-3 space-y-3 rounded-lg border border-border/50 p-3">
          <Field
            label="Environment variables (JSON)"
            hint='Use {{name}} in URL, headers, params, or body. Example: {"base":"https://api.example.com"}'
          >
            <textarea
              className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              placeholder='{"apiHost":"https://api.example.com","tenantId":"acme"}'
              value={val(values, 'variablesJson')}
              onChange={(e) => onChange('variablesJson', e.target.value)}
            />
          </Field>
          <Field label="Response data path" hint="Dot path to array in JSON response, e.g. data.items">
            <Input value={val(values, 'dataPath')} onChange={(e) => onChange('dataPath', e.target.value)} placeholder="data.items" />
          </Field>
        </TabsContent>

        <TabsContent value="settings" className="mt-3 space-y-3 rounded-lg border border-border/50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timeout (ms)">
              <Input type="number" value={val(values, 'timeoutMs')} onChange={(e) => onChange('timeoutMs', e.target.value)} />
            </Field>
            <Field label="Retries">
              <Input type="number" value={val(values, 'retries')} onChange={(e) => onChange('retries', e.target.value)} />
            </Field>
            <Field label="Retry backoff (ms)">
              <Input type="number" value={val(values, 'retryBackoffMs')} onChange={(e) => onChange('retryBackoffMs', e.target.value)} />
            </Field>
            <Field label="Validate status">
              <Input value={val(values, 'validateStatus')} onChange={(e) => onChange('validateStatus', e.target.value)} placeholder="2xx" />
            </Field>
          </div>
          <Field label="Follow redirects">
            <Select value={val(values, 'followRedirects')} onValueChange={(v) => v && onChange('followRedirects', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <div className="border-t border-border/50 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pagination (production fetch)
            </p>
            <Field label="Style">
              <Select value={val(values, 'paginationStyle')} onValueChange={(v) => v && onChange('paginationStyle', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — single request</SelectItem>
                  <SelectItem value="offset">Offset / limit</SelectItem>
                  <SelectItem value="page">Page number</SelectItem>
                  <SelectItem value="cursor">Cursor</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {val(values, 'paginationStyle') !== 'none' && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Page size">
                  <Input value={val(values, 'paginationPageSize')} onChange={(e) => onChange('paginationPageSize', e.target.value)} />
                </Field>
                <Field label="Max pages">
                  <Input value={val(values, 'paginationMaxPages')} onChange={(e) => onChange('paginationMaxPages', e.target.value)} />
                </Field>
                <Field label="Limit param">
                  <Input value={val(values, 'paginationLimitParam')} onChange={(e) => onChange('paginationLimitParam', e.target.value)} />
                </Field>
                {val(values, 'paginationStyle') === 'offset' && (
                  <Field label="Offset param">
                    <Input value={val(values, 'paginationOffsetParam')} onChange={(e) => onChange('paginationOffsetParam', e.target.value)} />
                  </Field>
                )}
                {val(values, 'paginationStyle') === 'page' && (
                  <Field label="Page param">
                    <Input value={val(values, 'paginationPageParam')} onChange={(e) => onChange('paginationPageParam', e.target.value)} />
                  </Field>
                )}
                {val(values, 'paginationStyle') === 'cursor' && (
                  <>
                    <Field label="Cursor param">
                      <Input value={val(values, 'paginationCursorParam')} onChange={(e) => onChange('paginationCursorParam', e.target.value)} />
                    </Field>
                    <Field label="Next cursor path">
                      <Input value={val(values, 'paginationCursorPath')} onChange={(e) => onChange('paginationCursorPath', e.target.value)} />
                    </Field>
                  </>
                )}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {preview && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
            <Badge variant={preview.ok ? 'default' : 'destructive'}>
              {preview.response.status || 'ERR'} {preview.response.statusText}
            </Badge>
            <span className="text-xs text-muted-foreground">{preview.response.durationMs} ms</span>
            <span className="text-xs text-muted-foreground">{preview.response.sizeBytes} bytes</span>
            {preview.response.contentType && (
              <span className="truncate text-xs text-muted-foreground">{preview.response.contentType}</span>
            )}
          </div>
          <div className="max-h-48 overflow-auto bg-zinc-950 p-3 font-mono text-xs text-green-400">
            <pre className="whitespace-pre-wrap break-all">{preview.response.bodyPreview || preview.message}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
