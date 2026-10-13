'use client'

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { StateMark } from '@/components/ui/flow-line'
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
import RestNetworkPanel from '@/components/connectors/rest-network-panel'
import { Notice } from '@/components/ui/notice'
import { usePrefs } from '@/components/i18n/i18n-provider'
import {
  REST_DEFAULTS,
  type RestAuthMethod,
  type RestBodyType,
  type RestHttpMethod,
  type RestIntegrationScheme,
  type RestRequestPreview,
  parseConnectionPaste,
  sanitizeRestCredentials,
} from '@/lib/connectors/rest/config'

interface RestConnectorFormProps {
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  preview?: RestRequestPreview | null
  sending?: boolean
  onSend?: () => void
  /**
   * An intranet API reached through a Nexus Agent: the agent's config holds the
   * base URL and sign-in, so only the request is edited here.
   */
  agent?: { name: string; connection: string; endpoint: string | null } | null
}

function val(values: Record<string, string>, key: keyof typeof REST_DEFAULTS) {
  return values[key] ?? REST_DEFAULTS[key]
}

/** A labelled control: `id` goes on the control so the label (and hint) are tied to it. */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const textareaClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const METHODS: RestHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export default function RestConnectorForm({
  values,
  onChange,
  preview,
  sending,
  onSend,
  agent,
}: RestConnectorFormProps) {
  const scheme = val(values, 'integrationScheme') as RestIntegrationScheme
  const authMethod = val(values, 'authMethod') as RestAuthMethod
  const bodyType = val(values, 'bodyType') as RestBodyType
  const resolvedBodyType = scheme === 'graphql' ? 'graphql' : bodyType

  const base = agent ? (agent.endpoint ?? `<${agent.connection}>`) : val(values, 'baseUrl')
  const fullUrlPreview = `${base.replace(/\/+$/, '')}${val(values, 'resourcePath').startsWith('/') ? '' : '/'}${val(values, 'resourcePath')}`
  const [pasteBox, setPasteBox] = useState('')
  const [pasteHint, setPasteHint] = useState('')
  const uid = useId()
  const { t, formatNumber } = usePrefs()
  const fid = (key: string) => `${uid}-${key}`

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
        setPasteHint(t('connect.rest.parseError'))
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
      setPasteHint(t('connect.rest.imported'))
      return true
    },
    [applyPatch, values, t]
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
        setPasteHint(t('connect.rest.fixedUrl'))
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {agent ? (
        <Notice tone="info">{t('connect.rest.agentNotice', { agent: agent.name, connection: agent.connection })}</Notice>
      ) : (
      <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/40 p-3">
        <Label htmlFor={fid('quickImport')} className="text-xs text-muted-foreground">
          {t('connect.rest.quickImport')} <code className="font-mono text-[11px]">url:</code> + <code className="font-mono text-[11px]">auth:</code>
        </Label>
        <textarea
          id={fid('quickImport')}
          className={`min-h-[72px] ${textareaClass} text-[11px]`}
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
            {t('connect.rest.importConnection')}
          </Button>
          <span role="status" className="text-[11px] text-muted-foreground">
            {pasteHint}
          </span>
        </div>
      </div>
      )}

      {/* Postman-style request line */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-stretch border-b border-border">
          <Select
            value={val(values, 'httpMethod')}
            onValueChange={(v) => v && onChange('httpMethod', v)}
          >
            <SelectTrigger aria-label={t('connect.rest.httpMethod')} className="h-10 w-[110px] shrink-0 rounded-none border-0 border-r font-mono font-semibold focus-visible:outline-offset-[-2px]">
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
          {agent ? (
            <div className="flex h-10 flex-1 items-center truncate px-3 font-mono text-sm text-muted-foreground" title={t('connect.rest.agentBase', { agent: agent.name })}>
              {agent.endpoint ?? t('connect.rest.agentBase', { agent: agent.name })}
            </div>
          ) : (
          <Input
            className="h-10 flex-1 rounded-none border-0 font-mono text-sm focus-visible:outline-offset-[-2px]"
            aria-label={t('connect.rest.baseUrl')}
            placeholder={t('connect.rest.baseUrlPlaceholder')}
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
          )}
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <Input
            className="h-8 flex-1 font-mono text-xs"
            aria-label={t('connect.rest.resourcePath')}
            placeholder="/resource/path"
            value={val(values, 'resourcePath')}
            onChange={(e) => onChange('resourcePath', e.target.value)}
          />
          {onSend && (
            <Button type="button" onClick={onSend} disabled={sending} className="shrink-0 px-4">
              {sending ? t('connect.rest.sending') : t('connect.rest.send')}
            </Button>
          )}
        </div>
        <div className="border-t border-border bg-muted/40 px-3 py-1.5 font-mono text-[11px] break-all text-muted-foreground">
          {fullUrlPreview || t('connect.rest.enterUrl')}
        </div>
      </div>

      <Tabs defaultValue="params" className="w-full">
        <TabsList className="h-9 w-full justify-start overflow-x-auto">
          <TabsTrigger value="params">{t('connect.rest.tabs.params')}</TabsTrigger>
          {!agent && <TabsTrigger value="auth">{t('connect.rest.tabs.auth')}</TabsTrigger>}
          <TabsTrigger value="headers">{t('connect.rest.tabs.headers')}</TabsTrigger>
          <TabsTrigger value="body">{t('connect.rest.tabs.body')}</TabsTrigger>
          <TabsTrigger value="variables">{t('connect.rest.tabs.variables')}</TabsTrigger>
          <TabsTrigger value="settings">{t('connect.rest.tabs.settings')}</TabsTrigger>
          {!agent && <TabsTrigger value="network">{t('connect.rest.tabs.network')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="params" className="mt-3 rounded-lg border border-border p-3">
          <KeyValueEditor
            value={val(values, 'paramsKv')}
            onChange={(v) => onChange('paramsKv', v)}
            keyPlaceholder={t('connect.rest.queryParam')}
            valuePlaceholder={t('connect.rest.value')}
            keyLabel={t('connect.rest.queryParamName')}
            valueLabel={t('connect.rest.queryParamValue')}
          />
        </TabsContent>

        <TabsContent value="auth" className="mt-3 space-y-3 rounded-lg border border-border p-3">
          <Field id={fid('authMethod')} label={t('connect.rest.type')}>
            <Select value={authMethod} onValueChange={(v) => v && onChange('authMethod', v)}>
              <SelectTrigger id={fid('authMethod')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('connect.rest.authMethods.none')}</SelectItem>
                <SelectItem value="api_key">{t('connect.rest.authMethods.apiKey')}</SelectItem>
                <SelectItem value="bearer">{t('connect.rest.authMethods.bearer')}</SelectItem>
                <SelectItem value="basic">{t('connect.rest.authMethods.basic')}</SelectItem>
                <SelectItem value="custom_header">{t('connect.rest.authMethods.customHeader')}</SelectItem>
                <SelectItem value="oauth2_client_credentials">{t('connect.rest.authMethods.oauthClient')}</SelectItem>
                <SelectItem value="oauth2_password">{t('connect.rest.authMethods.oauthPassword')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {authMethod === 'api_key' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field id={fid('apiKeyLocation')} label={t('connect.rest.addTo')}>
                  <Select
                    value={val(values, 'apiKeyLocation')}
                    onValueChange={(v) => v && onChange('apiKeyLocation', v)}
                  >
                    <SelectTrigger id={fid('apiKeyLocation')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="header">{t('connect.rest.header')}</SelectItem>
                      <SelectItem value="query">{t('connect.rest.queryParams')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field id={fid('apiKeyHeader')} label={t('connect.rest.headerOrParamName')}>
                  <Input id={fid('apiKeyHeader')} value={val(values, 'apiKeyHeader')} onChange={(e) => onChange('apiKeyHeader', e.target.value)} />
                </Field>
              </div>
              <Field id={fid('apiKeyPrefix')} label={t('connect.rest.prefixOptional')} hint={t('connect.rest.prefixHint')}>
                <Input id={fid('apiKeyPrefix')} aria-describedby={`${fid('apiKeyPrefix')}-hint`} value={val(values, 'apiKeyPrefix')} onChange={(e) => onChange('apiKeyPrefix', e.target.value)} />
              </Field>
              <Field id={fid('apiKeyValue')} label={t('connect.rest.value')}>
                <Input id={fid('apiKeyValue')} type="password" value={val(values, 'apiKeyValue')} onChange={(e) => onChange('apiKeyValue', e.target.value)} />
              </Field>
            </>
          )}

          {authMethod === 'bearer' && (
            <>
              <Field id={fid('bearerPrefix')} label={t('connect.rest.tokenPrefix')}>
                <Input id={fid('bearerPrefix')} value={val(values, 'bearerPrefix')} onChange={(e) => onChange('bearerPrefix', e.target.value)} />
              </Field>
              <Field id={fid('bearerToken')} label={t('connect.rest.token')}>
                <Input id={fid('bearerToken')} type="password" value={val(values, 'bearerToken')} onChange={(e) => onChange('bearerToken', e.target.value)} />
              </Field>
            </>
          )}

          {authMethod === 'basic' && (
            <div className="grid grid-cols-2 gap-3">
              <Field id={fid('basicUsername')} label={t('connect.rest.username')}>
                <Input id={fid('basicUsername')} value={val(values, 'basicUsername')} onChange={(e) => onChange('basicUsername', e.target.value)} />
              </Field>
              <Field id={fid('basicPassword')} label={t('connect.rest.password')}>
                <Input id={fid('basicPassword')} type="password" value={val(values, 'basicPassword')} onChange={(e) => onChange('basicPassword', e.target.value)} />
              </Field>
            </div>
          )}

          {authMethod === 'custom_header' && (
            <div className="grid grid-cols-2 gap-3">
              <Field id={fid('customHeaderName')} label={t('connect.rest.headerName')}>
                <Input id={fid('customHeaderName')} value={val(values, 'customHeaderName')} onChange={(e) => onChange('customHeaderName', e.target.value)} />
              </Field>
              <Field id={fid('customHeaderValue')} label={t('connect.rest.headerValue')}>
                <Input id={fid('customHeaderValue')} type="password" value={val(values, 'customHeaderValue')} onChange={(e) => onChange('customHeaderValue', e.target.value)} />
              </Field>
            </div>
          )}

          {(authMethod === 'oauth2_client_credentials' || authMethod === 'oauth2_password') && (
            <>
              <Field id={fid('oauthTokenUrl')} label={t('connect.rest.tokenUrl')}>
                <Input id={fid('oauthTokenUrl')} value={val(values, 'oauthTokenUrl')} onChange={(e) => onChange('oauthTokenUrl', e.target.value)} placeholder="https://auth.example.com/oauth/token" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id={fid('oauthClientId')} label={t('connect.rest.clientId')}>
                  <Input id={fid('oauthClientId')} value={val(values, 'oauthClientId')} onChange={(e) => onChange('oauthClientId', e.target.value)} />
                </Field>
                <Field id={fid('oauthClientSecret')} label={t('connect.rest.clientSecret')}>
                  <Input id={fid('oauthClientSecret')} type="password" value={val(values, 'oauthClientSecret')} onChange={(e) => onChange('oauthClientSecret', e.target.value)} />
                </Field>
              </div>
              {authMethod === 'oauth2_password' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field id={fid('oauthUsername')} label={t('connect.rest.username')}>
                    <Input id={fid('oauthUsername')} value={val(values, 'oauthUsername')} onChange={(e) => onChange('oauthUsername', e.target.value)} />
                  </Field>
                  <Field id={fid('oauthPassword')} label={t('connect.rest.password')}>
                    <Input id={fid('oauthPassword')} type="password" value={val(values, 'oauthPassword')} onChange={(e) => onChange('oauthPassword', e.target.value)} />
                  </Field>
                </div>
              )}
              <Field id={fid('oauthScope')} label={t('connect.rest.scopeOptional')}>
                <Input id={fid('oauthScope')} value={val(values, 'oauthScope')} onChange={(e) => onChange('oauthScope', e.target.value)} />
              </Field>
            </>
          )}
        </TabsContent>

        <TabsContent value="headers" className="mt-3 rounded-lg border border-border p-3">
          <KeyValueEditor
            value={val(values, 'headersKv')}
            onChange={(v) => onChange('headersKv', v)}
            keyPlaceholder={t('connect.rest.header')}
            valuePlaceholder={t('connect.rest.value')}
            keyLabel={t('connect.rest.headerName')}
            valueLabel={t('connect.rest.headerValue')}
          />
        </TabsContent>

        <TabsContent value="body" className="mt-3 space-y-3 rounded-lg border border-border p-3">
          <Field id={fid('integrationScheme')} label={t('connect.rest.integrationScheme')}>
            <Select value={scheme} onValueChange={(v) => v && onChange('integrationScheme', v)}>
              <SelectTrigger id={fid('integrationScheme')}>
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
            <Field id={fid('bodyType')} label={t('connect.rest.bodyType')}>
              <Select value={bodyType} onValueChange={(v) => v && onChange('bodyType', v)}>
                <SelectTrigger id={fid('bodyType')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('connect.rest.bodyNone')}</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="raw">raw</SelectItem>
                  <SelectItem value="urlencoded">x-www-form-urlencoded</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {resolvedBodyType === 'graphql' && (
            <Field id={fid('graphqlQuery')} label={t('connect.rest.graphqlQuery')}>
              <textarea id={fid('graphqlQuery')}
                className={`min-h-[140px] ${textareaClass}`}
                placeholder={`query Users {\n  users(limit: 5) { id name email }\n}`}
                value={val(values, 'graphqlQuery')}
                onChange={(e) => onChange('graphqlQuery', e.target.value)}
              />
            </Field>
          )}

          {resolvedBodyType === 'json' && (
            <Field id={fid('requestBody')} label={t('connect.rest.jsonBody')}>
              <textarea id={fid('requestBody')}
                className={`min-h-[120px] ${textareaClass}`}
                placeholder='{"filter":"active"}'
                value={val(values, 'requestBody')}
                onChange={(e) => onChange('requestBody', e.target.value)}
              />
            </Field>
          )}

          {resolvedBodyType === 'raw' && (
            <>
              <Field id={fid('rawContentType')} label={t('connect.rest.contentType')}>
                <Input id={fid('rawContentType')} value={val(values, 'rawContentType')} onChange={(e) => onChange('rawContentType', e.target.value)} />
              </Field>
              <Field id={fid('requestBody')} label={t('connect.rest.rawBody')}>
                <textarea id={fid('requestBody')}
                  className={`min-h-[120px] ${textareaClass}`}
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
              keyPlaceholder={t('connect.rest.formField')}
              valuePlaceholder={t('connect.rest.value')}
              keyLabel={t('connect.rest.formFieldName')}
              valueLabel={t('connect.rest.formFieldValue')}
            />
          )}
        </TabsContent>

        <TabsContent value="variables" className="mt-3 space-y-3 rounded-lg border border-border p-3">
          {!agent && (
          <Field id={fid('variablesJson')}
            label={t('connect.rest.envVars')}
            hint={t('connect.rest.envVarsHint')}
          >
            <textarea id={fid('variablesJson')} aria-describedby={`${fid('variablesJson')}-hint`}
              className={`min-h-[100px] ${textareaClass}`}
              placeholder='{"apiHost":"https://api.example.com","tenantId":"acme"}'
              value={val(values, 'variablesJson')}
              onChange={(e) => onChange('variablesJson', e.target.value)}
            />
          </Field>
          )}
          <Field id={fid('dataPath')} label={t('connect.rest.dataPath')} hint={t('connect.rest.dataPathHint')}>
            <Input id={fid('dataPath')} aria-describedby={`${fid('dataPath')}-hint`} value={val(values, 'dataPath')} onChange={(e) => onChange('dataPath', e.target.value)} placeholder="data.items" />
          </Field>
        </TabsContent>

        <TabsContent value="settings" className="mt-3 space-y-3 rounded-lg border border-border p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field id={fid('timeoutMs')} label={t('connect.rest.timeout')}>
              <Input id={fid('timeoutMs')} type="number" value={val(values, 'timeoutMs')} onChange={(e) => onChange('timeoutMs', e.target.value)} />
            </Field>
            <Field id={fid('retries')} label={t('connect.rest.retries')}>
              <Input id={fid('retries')} type="number" value={val(values, 'retries')} onChange={(e) => onChange('retries', e.target.value)} />
            </Field>
            <Field id={fid('retryBackoffMs')} label={t('connect.rest.retryBackoff')}>
              <Input id={fid('retryBackoffMs')} type="number" value={val(values, 'retryBackoffMs')} onChange={(e) => onChange('retryBackoffMs', e.target.value)} />
            </Field>
            <Field id={fid('validateStatus')} label={t('connect.rest.validateStatus')}>
              <Input id={fid('validateStatus')} value={val(values, 'validateStatus')} onChange={(e) => onChange('validateStatus', e.target.value)} placeholder="2xx" />
            </Field>
          </div>
          {!agent && (
          <Field id={fid('followRedirects')} label={t('connect.rest.followRedirects')}>
            <Select value={val(values, 'followRedirects')} onValueChange={(v) => v && onChange('followRedirects', v)}>
              <SelectTrigger id={fid('followRedirects')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">{t('common.yes')}</SelectItem>
                <SelectItem value="false">{t('common.no')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          )}

          <div className="border-t border-border pt-3">
            <h3 className="mb-2 font-mono text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t('connect.rest.pagination')}
            </h3>
            <Field id={fid('paginationStyle')} label={t('connect.rest.style')}>
              <Select value={val(values, 'paginationStyle')} onValueChange={(v) => v && onChange('paginationStyle', v)}>
                <SelectTrigger id={fid('paginationStyle')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('connect.rest.paginationStyles.none')}</SelectItem>
                  <SelectItem value="offset">{t('connect.rest.paginationStyles.offset')}</SelectItem>
                  <SelectItem value="page">{t('connect.rest.paginationStyles.page')}</SelectItem>
                  <SelectItem value="cursor">{t('connect.rest.paginationStyles.cursor')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {val(values, 'paginationStyle') !== 'none' && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field id={fid('paginationPageSize')} label={t('connect.rest.pageSize')}>
                  <Input id={fid('paginationPageSize')} value={val(values, 'paginationPageSize')} onChange={(e) => onChange('paginationPageSize', e.target.value)} />
                </Field>
                <Field id={fid('paginationMaxPages')} label={t('connect.rest.maxPages')}>
                  <Input id={fid('paginationMaxPages')} value={val(values, 'paginationMaxPages')} onChange={(e) => onChange('paginationMaxPages', e.target.value)} />
                </Field>
                <Field id={fid('paginationLimitParam')} label={t('connect.rest.limitParam')}>
                  <Input id={fid('paginationLimitParam')} value={val(values, 'paginationLimitParam')} onChange={(e) => onChange('paginationLimitParam', e.target.value)} />
                </Field>
                {val(values, 'paginationStyle') === 'offset' && (
                  <Field id={fid('paginationOffsetParam')} label={t('connect.rest.offsetParam')}>
                    <Input id={fid('paginationOffsetParam')} value={val(values, 'paginationOffsetParam')} onChange={(e) => onChange('paginationOffsetParam', e.target.value)} />
                  </Field>
                )}
                {val(values, 'paginationStyle') === 'page' && (
                  <Field id={fid('paginationPageParam')} label={t('connect.rest.pageParam')}>
                    <Input id={fid('paginationPageParam')} value={val(values, 'paginationPageParam')} onChange={(e) => onChange('paginationPageParam', e.target.value)} />
                  </Field>
                )}
                {val(values, 'paginationStyle') === 'cursor' && (
                  <>
                    <Field id={fid('paginationCursorParam')} label={t('connect.rest.cursorParam')}>
                      <Input id={fid('paginationCursorParam')} value={val(values, 'paginationCursorParam')} onChange={(e) => onChange('paginationCursorParam', e.target.value)} />
                    </Field>
                    <Field id={fid('paginationCursorPath')} label={t('connect.rest.nextCursorPath')}>
                      <Input id={fid('paginationCursorPath')} value={val(values, 'paginationCursorPath')} onChange={(e) => onChange('paginationCursorPath', e.target.value)} />
                    </Field>
                  </>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        {!agent && (
          <TabsContent value="network" className="mt-3 rounded-lg border border-border p-3">
            <RestNetworkPanel values={values} onChange={onChange} />
          </TabsContent>
        )}
      </Tabs>

      {preview && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/60 px-3 py-2">
            <StateMark state={preview.ok ? 'live' : 'tripped'} className="font-mono">
              {preview.response.status || 'ERR'} {preview.response.statusText}
            </StateMark>
            <span className="font-mono text-xs text-muted-foreground">{preview.response.durationMs} ms</span>
            <span className="font-mono text-xs text-muted-foreground">{t('connect.rest.bytes', { count: formatNumber(preview.response.sizeBytes) })}</span>
            {preview.response.contentType && (
              <span className="truncate font-mono text-xs text-muted-foreground">{preview.response.contentType}</span>
            )}
          </div>
          <div className="max-h-48 overflow-auto bg-card p-3 font-mono text-xs text-foreground">
            <pre className="whitespace-pre-wrap break-all">{preview.response.bodyPreview || preview.message}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
