'use client'

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { useT } from '@/components/i18n/i18n-provider'
import { listSecretManagers, listSecretNames } from '@/lib/actions/data-sources'
import { secretRef } from '@/lib/secrets/types'

type Manager = Awaited<ReturnType<typeof listSecretManagers>>[number]

/**
 * "Use a secret": picks a secret from one of the workspace's secrets managers
 * and puts a reference ({{secret:<manager>:<path>#<field>}}) in a credential
 * field. Only secret names are ever loaded here, never values; Nexus reads the
 * value when it connects.
 */
export default function SecretRefPicker({ fieldLabel, onPick }: { fieldLabel: string; onPick: (reference: string) => void }) {
  const t = useT()
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [managers, setManagers] = useState<Manager[] | null>(null)
  const [managerId, setManagerId] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [loadingNames, setLoadingNames] = useState(false)
  const [path, setPath] = useState('')
  const [field, setField] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || managers) return
    listSecretManagers()
      .then((list) => {
        setManagers(list)
        if (list.length === 1) setManagerId(list[0].id)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [open, managers])

  useEffect(() => {
    if (!managerId) return setNames([])
    setLoadingNames(true)
    setError('')
    listSecretNames(managerId)
      .then(setNames)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingNames(false))
  }, [managerId])

  const manager = managers?.find((m) => m.id === managerId)

  if (!open) {
    return (
      <Button type="button" size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setOpen(true)} aria-label={t('connect.secrets.useFor', { field: fieldLabel })}>
        <KeyRound aria-hidden /> {t('connect.secrets.use')}
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3" role="group" aria-label={t('connect.secrets.useFor', { field: fieldLabel })}>
      {!managers ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t('common.loading')}
        </p>
      ) : managers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('connect.secrets.none')}{' '}
          <Link href="/dashboard/connectors?group=secrets" className="text-info-text underline-offset-2 hover:underline">
            {t('connect.secrets.openConnectors')}
          </Link>
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
            <div className="space-y-1">
              <Label htmlFor={`${uid}-m`} className="text-[11px] text-muted-foreground">
                {t('connect.secrets.manager')}
              </Label>
              <select id={`${uid}-m`} className={nativeSelectClass} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">{t('connect.secrets.choose')}</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${uid}-p`} className="text-[11px] text-muted-foreground">
                {t('connect.secrets.path')} {loadingNames && <Loader2 className="inline size-3 animate-spin" aria-hidden />}
              </Label>
              <Input id={`${uid}-p`} list={`${uid}-names`} value={path} onChange={(e) => setPath(e.target.value)} placeholder="hr/postgres" className="font-mono text-xs" autoComplete="off" />
              <datalist id={`${uid}-names`}>
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${uid}-f`} className="text-[11px] text-muted-foreground">
                {t('connect.secrets.field')}
              </Label>
              <Input id={`${uid}-f`} value={field} onChange={(e) => setField(e.target.value)} placeholder="password" className="font-mono text-xs" autoComplete="off" />
            </div>
          </div>
          {manager && path.trim() && <p className="font-mono text-[11px] break-all text-muted-foreground">{secretRef(manager.name, path.trim(), field.trim() || undefined)}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!manager || !path.trim()}
              onClick={() => {
                if (!manager) return
                onPick(secretRef(manager.name, path.trim(), field.trim() || undefined))
                setOpen(false)
              }}
            >
              {t('connect.secrets.insert')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <span className="text-[11px] text-muted-foreground">{t('connect.secrets.hint')}</span>
          </div>
        </>
      )}
      {error && <p className="text-xs text-danger-text">{error}</p>}
      {managers?.length === 0 && (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          {t('common.close')}
        </Button>
      )}
    </div>
  )
}
