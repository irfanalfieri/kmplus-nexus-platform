'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CornerDownLeft, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { can } from '@/lib/auth/permissions'
import { NAV_GROUPS, SETTINGS_TABS, SETTINGS_TAB_PERMISSION, sectionHref, settingsHref } from '@/lib/navigation'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useT } from '@/components/i18n/i18n-provider'
import { useWorkspace } from '@/components/workspace/workspace-context'
import { SECTION_ICONS } from './sidebar'

/** "Go to…": jump to any screen or settings section by typing (Ctrl/⌘ K). */
export function JumpTo() {
  const t = useT()
  const router = useRouter()
  const { role } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const targets = useMemo(() => {
    const screens = NAV_GROUPS.flatMap((g) => g.items).map((s) => ({ id: s, label: t(`nav.${s}`), group: t('nav.primary'), href: sectionHref(s), Icon: SECTION_ICONS[s] }))
    const settings = SETTINGS_TABS.filter((tab) => {
      const p = SETTINGS_TAB_PERMISSION[tab]
      return !p || can(role, p)
    }).map((tab) => ({ id: `settings-${tab}`, label: t(`settings.${tab}`), group: t('nav.settings'), href: settingsHref(tab), Icon: SECTION_ICONS.settings }))
    return [...screens, ...settings]
  }, [t, role])

  const q = query.trim().toLowerCase()
  const matches = q ? targets.filter((x) => x.label.toLowerCase().includes(q) || x.group.toLowerCase().includes(q)) : targets
  const active = Math.min(index, Math.max(0, matches.length - 1))

  const go = (href: string) => {
    setOpen(false)
    setQuery('')
    router.push(href)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground outline-none hover:border-input focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{t('shell.jump')}</span>
        <kbd className="hidden rounded-sm border border-border px-1 font-mono text-[11px] sm:inline">Ctrl K</kbd>
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <DialogContent title={t('shell.jump')} description={t('shell.jumpHint')} size="md" bodyClassName="p-0">
          <div className="border-b border-border p-3">
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="jump-list"
              aria-activedescendant={matches[active] ? `jump-${matches[active].id}` : undefined}
              aria-label={t('shell.jumpPlaceholder')}
              placeholder={t('shell.jumpPlaceholder')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setIndex(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setIndex((i) => Math.min(i + 1, matches.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setIndex((i) => Math.max(i - 1, 0))
                } else if (e.key === 'Enter' && matches[active]) {
                  e.preventDefault()
                  go(matches[active].href)
                }
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
          {matches.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('shell.jumpEmpty', { query })}</p>
          ) : (
            <ul id="jump-list" role="listbox" ref={listRef} aria-label={t('shell.jump')} className="max-h-80 overflow-y-auto p-1.5">
              {matches.map((m, i) => (
                <li
                  key={m.id}
                  id={`jump-${m.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => go(m.href)}
                  className={cn('flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm', i === active && 'bg-accent text-accent-foreground')}
                >
                  <m.Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1">{m.label}</span>
                  <span className="text-xs text-muted-foreground">{m.group}</span>
                  {i === active && <CornerDownLeft className="size-3.5 text-muted-foreground" aria-hidden />}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
