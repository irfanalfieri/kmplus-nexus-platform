'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { Modal } from '@/components/ui/dialog'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/data-table'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { defineFromCurrentColumns, dismissUpgradeNotice, getUpgradeNotices, listInferredDatasets } from '@/lib/actions/schemas'
import { UPGRADE_NOTICES, type UpgradeScreen } from '@/lib/upgrades/notices'

type Inferred = Awaited<ReturnType<typeof listInferredDatasets>>

/**
 * "What's new" notices for features existing workspaces can adopt (lib/upgrades/notices.ts):
 * shown on the screens a notice names, to people allowed to act on it, until they dismiss it.
 */
export function UpgradeBanner({ screen, onChanged }: { screen: UpgradeScreen; onChanged?: () => void }) {
  const { t } = usePrefs()
  const [notices, setNotices] = useState<{ id: string; count: number }[]>([])
  const [reviewing, setReviewing] = useState(false)

  const load = useCallback(async () => {
    try {
      setNotices(await getUpgradeNotices())
    } catch {
      // A notice is never worth an error on the screen.
      setNotices([])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const shown = notices.filter((n) => UPGRADE_NOTICES.find((u) => u.id === n.id)?.screens.includes(screen))
  if (!shown.length) return null

  const dismiss = async (id: string) => {
    setNotices((ns) => ns.filter((n) => n.id !== id))
    try {
      await dismissUpgradeNotice(id)
    } catch {
      /* shown again next time */
    }
  }

  return (
    <>
      {shown.map((n) => {
        const def = UPGRADE_NOTICES.find((u) => u.id === n.id)!
        return (
          <Notice key={n.id} tone="info" className="mb-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="size-4" aria-hidden /> {t('schemas.upgrade.title')}
                </p>
                <p className="mt-0.5 text-sm">{t('schemas.upgrade.body', { count: n.count })}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => setReviewing(true)}>{t('schemas.upgrade.review')}</Button>
                <Link href={`/dashboard/help#${def.help}`} className="text-sm font-medium text-info-text underline-offset-2 hover:underline">
                  {t('schemas.upgrade.learn')}
                </Link>
                <Button size="icon-sm" variant="ghost" aria-label={t('schemas.upgrade.dismiss')} onClick={() => void dismiss(n.id)}>
                  <X />
                </Button>
              </div>
            </div>
          </Notice>
        )
      })}
      {reviewing && (
        <ReviewInferred
          onClose={() => setReviewing(false)}
          onDefined={() => {
            void load()
            onChanged?.()
          }}
        />
      )}
    </>
  )
}

function ReviewInferred({ onClose, onDefined }: { onClose: () => void; onDefined: () => void }) {
  const { t, formatNumber } = usePrefs()
  const [rows, setRows] = useState<Inferred | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await listInferredDatasets())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('schemas.panel.loadFailed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const define = async (names: string[], key: string) => {
    setBusy(key)
    setError('')
    try {
      const res = await defineFromCurrentColumns(names)
      setNotice(t('schemas.upgrade.definedCount', { count: res.defined }))
      await load()
      onDefined()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('schemas.panel.loadFailed'))
    } finally {
      setBusy(null)
    }
  }

  const definable = (rows ?? []).filter((r) => r.columns > 0)
  return (
    <Modal
      title={t('schemas.upgrade.modalTitle')}
      description={t('schemas.upgrade.modalBody')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
          {definable.length > 0 && (
            <Button disabled={busy !== null} onClick={() => void define(definable.map((r) => r.name), '*')}>
              {busy === '*' && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />} {t('schemas.upgrade.defineAll', { count: definable.length })}
            </Button>
          )}
        </>
      }
    >
      {notice && <Notice tone="success" className="mb-3">{notice}</Notice>}
      {error && <Notice tone="danger" className="mb-3">{error}</Notice>}
      {!rows ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('schemas.upgrade.none')}</p>
      ) : (
        <Table label={t('schemas.upgrade.modalTitle')}>
          <THead>
            <tr>
              <Th>{t('schemas.upgrade.colDataset')}</Th>
              <Th>{t('schemas.upgrade.colColumns')}</Th>
              <Th>{t('schemas.upgrade.colUsedBy')}</Th>
              <Th><span className="sr-only">{t('schemas.upgrade.define')}</span></Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const used = [...r.pipelines, ...r.dashboards, ...r.apiKeys]
              return (
                <Tr key={r.name}>
                  <Td className="font-mono text-xs">
                    {r.name}
                    <span className="block font-sans text-muted-foreground">{t('common.rows', { count: formatNumber(r.rowCount) })}</span>
                  </Td>
                  <Td className="text-xs">{r.columns}</Td>
                  <Td className="text-xs">{used.length ? used.join(', ') : <span className="text-muted-foreground">{t('schemas.upgrade.unused')}</span>}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="outline" disabled={busy !== null || !r.columns} onClick={() => void define([r.name], r.name)}>
                      {busy === r.name && <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />} {t('schemas.upgrade.define')}
                    </Button>
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </Table>
      )}
    </Modal>
  )
}
