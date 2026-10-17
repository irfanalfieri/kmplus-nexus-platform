'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, KeyRound, Loader2, Lock, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { StateMark, type FlowState } from '@/components/ui/flow-line'
import { useConfirm } from '@/components/ui/dialog'
import { PageHeader } from '@/components/dashboard/page-header'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { useCan } from '@/components/workspace/workspace-context'
import { getConnectorMarketplace, installConnector, uninstallConnector } from '@/lib/actions/connectors'
import { GROUP_HELP, connectorCapabilities, type Capabilities, type Support } from '@/lib/connectors/capabilities'
import { getConnectorDefinition, isConnectorSlug } from '@/lib/connectors/catalog'
import type { MessageKey } from '@/lib/i18n/translate'

type Marketplace = Awaited<ReturnType<typeof getConnectorMarketplace>>

const STATE: Record<Support, FlowState> = { yes: 'live', partial: 'paused', no: 'idle' }
const OPS: (keyof Omit<Capabilities, 'secrets'>)[] = ['read', 'write', 'incremental', 'live', 'cdc', 'agent', 'apiSteps']

/** CM-4: one connector's operations, the permissions it needs, its sign-in fields and install state. */
export function ConnectorDetail({ slug }: { slug: string }) {
  const { t } = usePrefs()
  const tOr = (key: string, fallback: string) => {
    const v = t(key as MessageKey)
    return v === key ? fallback : v
  }
  const canManage = useCan('connectors:manage')
  const [market, setMarket] = useState<Marketplace | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, confirmDialog] = useConfirm()
  const definition = isConnectorSlug(slug) ? getConnectorDefinition(slug) : undefined

  const load = useCallback(async () => {
    try {
      setMarket(await getConnectorMarketplace())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.connectors.loadFailed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (!definition || !isConnectorSlug(slug)) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <EmptyState title={t('connectorDocs.notFound')} action={<Link href="/dashboard/connectors" className="text-sm font-medium text-info-text underline-offset-2 hover:underline">{t('connectorDocs.back')}</Link>}>{''}</EmptyState>
      </div>
    )
  }
  const caps = connectorCapabilities(slug)
  const entry = market?.find((c) => c.slug === slug)
  const permissions = tOr(`connectorDocs.connectors.${slug}.permissions`, '').split('\n').filter(Boolean)
  const note = tOr(`connectorDocs.connectors.${slug}.note`, '')
  const opText = (op: (typeof OPS)[number], s: Support) => tOr(`connectorDocs.ops.${op}.${s}`, s === 'no' ? '—' : t(`connectorDocs.ops.${op}.yes` as MessageKey))

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ops.connectors.installFailed'))
    } finally {
      setBusy(false)
    }
  }
  const install = async () => {
    if (entry?.locked && !(await confirm({ title: t('ops.connectors.purchaseTitle', { name: definition.name }), description: t('ops.connectors.purchaseBody'), confirmLabel: t('ops.connectors.purchaseInstall') }))) return
    await act(() => installConnector(slug))
  }

  return (
    <div className="space-y-5">
      {confirmDialog}
      <Link href="/dashboard/connectors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('connectorDocs.back')}
      </Link>
      <PageHeader
        title={definition.name}
        description={tOr(`ops.connectors.descriptions.${slug}`, definition.description)}
        meta={`${tOr(`ops.connectors.categories.${definition.category}`, definition.category)} · v${definition.version} · ${definition.premium ? t('ops.connectors.premium') : t('ops.connectors.included')}`}
        actions={
          !entry ? null : entry.installed ? (
            <div className="flex items-center gap-2">
              <StateMark state="live">{t('ops.connectors.installed')}</StateMark>
              {canManage && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => uninstallConnector(slug))} aria-label={t('ops.connectors.uninstallNamed', { name: definition.name })}>
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />} {t('ops.connectors.uninstall')}
                </Button>
              )}
            </div>
          ) : canManage ? (
            <Button disabled={busy} onClick={() => void install()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : entry.locked ? <Lock aria-hidden /> : <Download aria-hidden />}
              {entry.locked ? t('ops.connectors.purchaseInstall') : t('ops.connectors.install')}
            </Button>
          ) : (
            <StateMark state="idle">{t('ops.connectors.notInstalled')}</StateMark>
          )
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="connector-ops" className="rounded-lg border border-border bg-card">
          <h2 id="connector-ops" className="border-b border-border px-4 py-3 text-base font-semibold">{t('connectorDocs.operations')}</h2>
          <dl className="divide-y divide-border">
            {OPS.map((op) => {
              const s = caps[op]
              return (
                <div key={op} className="gap-4 px-4 py-3 sm:grid sm:grid-cols-[minmax(10rem,14rem)_1fr]">
                  <dt className="text-sm font-medium">{t(`connectorDocs.ops.${op}.label` as MessageKey)}</dt>
                  <dd className="mt-1 sm:mt-0">
                    <StateMark state={STATE[s]} className="items-start whitespace-normal [&>*:first-child]:mt-1">{opText(op, s)}</StateMark>
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>

        <div className="space-y-5">
          <section aria-labelledby="connector-permissions" className="rounded-lg border border-border bg-card p-4">
            <h2 id="connector-permissions" className="mb-2 flex items-center gap-2 text-base font-semibold">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden /> {t('connectorDocs.permissions')}
            </h2>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {permissions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {note && <p className="mt-3 text-xs text-muted-foreground">{note}</p>}
          </section>

          {definition.credentialFields.length > 0 && (
            <section aria-labelledby="connector-fields" className="rounded-lg border border-border bg-card p-4">
              <h2 id="connector-fields" className="mb-2 text-base font-semibold">{t('connectorDocs.signIn')}</h2>
              <ul className="space-y-1 text-sm">
                {definition.credentialFields.map((f) => (
                  <li key={f.key} className="flex flex-wrap items-baseline gap-x-2">
                    <span>{f.label}</span>
                    {f.required && <span className="text-xs text-muted-foreground">{t('connectorDocs.requiredField')}</span>}
                    {f.type === 'password' && <span className="text-xs text-warning-text">{t('connectorDocs.secretField')}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Link href={`/dashboard/help#${GROUP_HELP[definition.group]}`} className="inline-block text-sm font-medium text-info-text underline-offset-2 hover:underline">
            {t('connectorDocs.learnMore')}
          </Link>
        </div>
      </div>
    </div>
  )
}
