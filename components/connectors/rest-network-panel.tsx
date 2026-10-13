'use client'

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, KeyRound, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { useT } from '@/components/i18n/i18n-provider'
import { getConnectorNetworkInfo } from '@/lib/actions/connector-source'
import { KEEP } from '@/lib/connectors/secret-mask'

const textareaClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-[11px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/** 32 random bytes, base64url: the shared secret for X-Nexus-Signature. */
function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Network settings of a REST data source (DS-12): how an API inside a company
 * network is reached. Through a Nexus Agent (no firewall change), or published
 * for Nexus by the company's DevOps behind a gateway that admits only Nexus:
 * by outbound IP, client certificate (mTLS) and/or signed requests.
 */
export default function RestNetworkPanel({ values, onChange }: { values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  const t = useT()
  const uid = useId()
  const [info, setInfo] = useState<{ egressIps: string[]; selfHosted: boolean } | null>(null)
  const [fresh, setFresh] = useState(false)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    getConnectorNetworkInfo()
      .then(setInfo)
      .catch(() => setInfo({ egressIps: [], selfHosted: false }))
  }, [])

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      window.setTimeout(() => setCopied(''), 1500)
    } catch {
      /* clipboard blocked: the value stays visible to copy by hand */
    }
  }

  const secret = values.signingSecret ?? ''
  const field = (key: string) => `${uid}-${key}`

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Network className="size-4 text-primary" aria-hidden /> {t('connect.network.title')}
        </p>
        <p>{t('connect.network.intro')}</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            {t('connect.network.viaAgent')}{' '}
            <Link href="/dashboard/settings/agents" className="text-info-text underline-offset-2 hover:underline">
              {t('connect.network.openAgents')}
            </Link>
          </li>
          <li>{t('connect.network.manual')}</li>
        </ol>
      </div>

      {info?.selfHosted && <Notice tone="info">{t('connect.network.selfHosted')}</Notice>}

      <section aria-labelledby={field('ips')} className="space-y-1.5 rounded-md border border-border p-3">
        <h4 id={field('ips')} className="text-xs font-semibold">
          {t('connect.network.ipsTitle')}
        </h4>
        {!info ? (
          <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
        ) : info.egressIps.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {info.egressIps.map((ip) => (
              <code key={ip} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {ip}
              </code>
            ))}
            <Button type="button" size="xs" variant="outline" onClick={() => void copy('ips', info.egressIps.join('\n'))}>
              {copied === 'ips' ? <Check aria-hidden /> : <Copy aria-hidden />} {copied === 'ips' ? t('connect.network.copied') : t('connect.network.copy')}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('connect.network.ipsNone')}</p>
        )}
      </section>

      <section aria-labelledby={field('mtls')} className="space-y-3 rounded-md border border-border p-3">
        <div>
          <h4 id={field('mtls')} className="text-xs font-semibold">
            {t('connect.network.mtlsTitle')}
          </h4>
          <p className="text-[11px] text-muted-foreground">{t('connect.network.mtlsHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={field('clientCert')} className="text-xs text-muted-foreground">
            {t('connect.network.clientCert')}
          </Label>
          <textarea id={field('clientCert')} className={`min-h-[72px] ${textareaClass}`} placeholder="-----BEGIN CERTIFICATE-----" value={values.clientCert ?? ''} onChange={(e) => onChange('clientCert', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={field('clientKey')} className="text-xs text-muted-foreground">
            {t('connect.network.clientKey')}
          </Label>
          <textarea
            id={field('clientKey')}
            className={`min-h-[72px] ${textareaClass}`}
            placeholder={values.clientKey === KEEP ? t('connect.editCredentials.secretUnchanged') : '-----BEGIN PRIVATE KEY-----'}
            value={values.clientKey === KEEP ? '' : (values.clientKey ?? '')}
            onChange={(e) => onChange('clientKey', e.target.value || (values.clientKey === KEEP ? KEEP : ''))}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={field('caCert')} className="text-xs text-muted-foreground">
            {t('connect.network.caCert')}
          </Label>
          <textarea id={field('caCert')} aria-describedby={`${field('caCert')}-hint`} className={`min-h-[72px] ${textareaClass}`} placeholder="-----BEGIN CERTIFICATE-----" value={values.caCert ?? ''} onChange={(e) => onChange('caCert', e.target.value)} />
          <p id={`${field('caCert')}-hint`} className="text-[11px] text-muted-foreground">
            {t('connect.network.caHint')}
          </p>
        </div>
      </section>

      <section aria-labelledby={field('sign')} className="space-y-2 rounded-md border border-border p-3">
        <div>
          <h4 id={field('sign')} className="flex items-center gap-1.5 text-xs font-semibold">
            <KeyRound className="size-3.5" aria-hidden /> {t('connect.network.signTitle')}
          </h4>
          <p className="text-[11px] text-muted-foreground">{t('connect.network.signHint')}</p>
        </div>
        <Label htmlFor={field('signingSecret')} className="text-xs text-muted-foreground">
          {t('connect.network.signingSecret')}
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={field('signingSecret')}
            type={fresh ? 'text' : 'password'}
            className="min-w-[220px] flex-1 font-mono text-xs"
            value={secret}
            autoComplete="off"
            onChange={(e) => {
              setFresh(false)
              onChange('signingSecret', e.target.value)
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              onChange('signingSecret', newSecret())
              setFresh(true)
            }}
          >
            {t('connect.network.generate')}
          </Button>
          {fresh && (
            <Button type="button" size="sm" variant="outline" onClick={() => void copy('secret', secret)}>
              {copied === 'secret' ? <Check aria-hidden /> : <Copy aria-hidden />} {copied === 'secret' ? t('connect.network.copied') : t('connect.network.copy')}
            </Button>
          )}
        </div>
        {fresh && <p className="text-[11px] text-warning-text">{t('connect.network.copyNow')}</p>}
      </section>

      <p className="text-[11px] text-muted-foreground">{t('connect.network.guide')}</p>
    </div>
  )
}
