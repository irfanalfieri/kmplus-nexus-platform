'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, CornerDownLeft, Database, LayoutDashboard, Languages, Loader2, Moon, Route, Scale, Search, Settings2, Workflow, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { can } from '@/lib/auth/permissions'
import { NAV_GROUPS, SETTINGS_TABS, SETTINGS_TAB_PERMISSION, sectionHref, settingsHref } from '@/lib/navigation'
import { FEATURES, PREFERENCES, SECTION_KEYWORDS, SETTINGS_KEYWORDS, recordHref, searchFinder, type FinderItem, type FinderKind } from '@/lib/finder'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { useWorkspace } from '@/components/workspace/workspace-context'
import { useTour } from '@/components/tour/guided-tour'
import { listFinderRecords } from '@/lib/actions/finder'
import { SECTION_ICONS } from './sidebar'

type Records = Awaited<ReturnType<typeof listFinderRecords>>
type Item = FinderItem & { Icon: LucideIcon }

const RECORD_ICONS = { pipeline: Workflow, source: Database, dataset: BookOpen, dashboard: LayoutDashboard, rule: Scale } as const
const PREFERENCE_ICONS: Record<string, LucideIcon> = { themeLight: Settings2, themeDark: Moon, themeSystem: Settings2, langEn: Languages, langId: Languages, tour: Route }
const GROUP_ORDER: FinderKind[] = ['action', 'record', 'screen', 'setting', 'preference']
/** Names are fetched again after this long (a pipeline added meanwhile shows up). */
const RECORDS_TTL_MS = 60_000

/**
 * "Go to" (Ctrl/⌘ K): find any screen, settings tab, feature, record
 * (pipeline, data source, dataset, dashboard, rule) or preference by name,
 * in English or Bahasa Indonesia, and open it. Features open through their
 * own links (useUrlIntents), so the same link works from Help or a message.
 */
export function JumpTo() {
  const { t, setTheme, setLocale } = usePrefs()
  const router = useRouter()
  const tour = useTour()
  const { role } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [records, setRecords] = useState<{ at: number; data: Records } | null>(null)
  const [loadingRecords, setLoadingRecords] = useState(false)
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

  // Record names load when the finder opens (never on every page), and stay a minute.
  useEffect(() => {
    if (!open || (records && Date.now() - records.at < RECORDS_TTL_MS)) return
    let cancelled = false
    setLoadingRecords(true)
    listFinderRecords()
      .then((data) => !cancelled && setRecords({ at: Date.now(), data }))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoadingRecords(false))
    return () => {
      cancelled = true
    }
  }, [open, records])

  const items = useMemo<Item[]>(() => {
    const screen = (s: (typeof NAV_GROUPS)[number]['items'][number] | 'help'): Item => ({ id: `screen-${s}`, kind: 'screen', label: t(`nav.${s}`), hint: t('finder.kinds.screen'), keywords: SECTION_KEYWORDS[s], section: s, href: sectionHref(s), Icon: SECTION_ICONS[s] })
    const screens = [...NAV_GROUPS.flatMap((g) => g.items).map(screen), screen('help')]
    const settings: Item[] = SETTINGS_TABS.filter((tab) => {
      const p = SETTINGS_TAB_PERMISSION[tab]
      return !p || can(role, p)
    }).map((tab) => ({ id: `settings-${tab}`, kind: 'setting', label: t(`settings.${tab}`), hint: t('nav.settings'), keywords: SETTINGS_KEYWORDS[tab], section: 'settings', href: settingsHref(tab), Icon: SECTION_ICONS.settings }))
    const features: Item[] = FEATURES.filter((f) => !f.permission || can(role, f.permission)).map((f) => ({
      id: `feature-${f.id}`,
      kind: 'action',
      label: t(`finder.features.${f.id}` as Parameters<typeof t>[0]),
      hint: t(`nav.${f.section}`),
      keywords: f.keywords,
      section: f.section,
      href: f.href,
      Icon: SECTION_ICONS[f.section],
    }))
    const preferences: Item[] = PREFERENCES.map((p) => ({
      id: `pref-${p.id}`,
      kind: 'preference',
      label: t(`finder.preferences.${p.id}` as Parameters<typeof t>[0]),
      hint: t('finder.kinds.preference'),
      keywords: p.keywords,
      section: 'help',
      run: p.run,
      Icon: PREFERENCE_ICONS[p.id],
    }))
    const r = records?.data
    const recordItems: Item[] = r
      ? [
          ...r.pipelines.map((p) => ({ id: `pipeline-${p.id}`, kind: 'record' as const, label: p.name, hint: t('finder.records.pipeline'), section: 'pipelines' as const, href: recordHref.pipeline(p.id), Icon: RECORD_ICONS.pipeline })),
          ...r.sources.map((s) => ({ id: `source-${s.id}`, kind: 'record' as const, label: s.name, hint: s.secrets ? t('finder.records.secrets') : t('finder.records.source'), keywords: s.sourceType, section: 'sources' as const, href: recordHref.source(s.id), Icon: RECORD_ICONS.source })),
          ...r.datasets.map((name) => ({ id: `dataset-${name}`, kind: 'record' as const, label: name, hint: t('finder.records.dataset'), section: 'catalog' as const, href: recordHref.dataset(name), Icon: RECORD_ICONS.dataset })),
          ...r.dashboards.map((d) => ({ id: `dashboard-${d.id}`, kind: 'record' as const, label: d.name, hint: t('finder.records.dashboard'), section: 'analytics' as const, href: recordHref.dashboard(d.id), Icon: RECORD_ICONS.dashboard })),
          ...r.rules.map((x) => ({ id: `rule-${x.id}`, kind: 'record' as const, label: x.name, hint: t('finder.records.rule'), section: 'rules' as const, href: recordHref.rule(x.id), Icon: RECORD_ICONS.rule })),
        ]
      : []
    return [...features, ...recordItems, ...screens, ...settings, ...preferences]
  }, [t, role, records])

  const matches = useMemo(() => {
    const found = searchFinder(items, query)
    // Grouped as ranked: groups appear in the order of their best result (empty query: a fixed order).
    const order = query.trim() ? [...new Set(found.map((m) => m.kind))] : GROUP_ORDER
    return order.flatMap((kind) => found.filter((m) => m.kind === kind))
  }, [items, query])
  const active = Math.min(index, Math.max(0, matches.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, matches])

  const close = () => {
    setOpen(false)
    setQuery('')
    setIndex(0)
  }
  const choose = useCallback(
    (m: Item) => {
      setOpen(false)
      setQuery('')
      setIndex(0)
      if (m.href) return router.push(m.href)
      if (m.run === 'tour') return tour.start()
      if (m.run?.startsWith('theme:')) return setTheme(m.run.slice(6) as 'light' | 'dark' | 'system')
      if (m.run?.startsWith('lang:')) return setLocale(m.run.slice(5) as 'en' | 'id')
    },
    [router, tour, setTheme, setLocale],
  )

  return (
    <>
      <button
        type="button"
        data-tour="jump-to"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground outline-none hover:border-input focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{t('shell.jump')}</span>
        <kbd className="hidden rounded-sm border border-border px-1 font-mono text-[11px] sm:inline">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent title={t('shell.jump')} description={t('shell.jumpHint')} size="md" bodyClassName="p-0">
          <div className="border-b border-border p-3">
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="jump-list"
              aria-autocomplete="list"
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
                  choose(matches[active])
                }
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
          {matches.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground" role="status">
              {loadingRecords ? t('finder.loadingRecords') : t('shell.jumpEmpty', { query })}
            </p>
          ) : (
            <ul id="jump-list" role="listbox" ref={listRef} aria-label={t('shell.jump')} className="max-h-[min(26rem,60dvh)] overflow-y-auto p-1.5">
              {matches.map((m, i) => (
                <FinderRow key={m.id} item={m} active={i === active} first={i === 0 || matches[i - 1].kind !== m.kind} groupLabel={t(`finder.kinds.${m.kind}`)} onHover={() => setIndex(i)} onChoose={() => choose(m)} />
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
            <span aria-hidden>{t('finder.keys')}</span>
            <span role="status" className="inline-flex items-center gap-1.5">
              {loadingRecords && <Loader2 className="size-3 animate-spin" aria-hidden />}
              {query.trim() ? t('finder.results', { count: matches.length }) : null}
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FinderRow({ item, active, first, groupLabel, onHover, onChoose }: { item: Item; active: boolean; first: boolean; groupLabel: string; onHover: () => void; onChoose: () => void }) {
  return (
    <>
      {first && (
        <li role="presentation" className="px-2.5 pt-2.5 pb-1 font-mono text-[11px] font-medium tracking-[0.025em] text-muted-foreground uppercase first:pt-1" aria-hidden>
          {groupLabel}
        </li>
      )}
      <li
        id={`jump-${item.id}`}
        role="option"
        aria-selected={active}
        onMouseMove={onHover}
        onClick={onChoose}
        className={cn('flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm', active && 'bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--live)]')}
      >
        <item.Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate', item.kind === 'record' && 'font-mono text-xs')}>{item.label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
        <CornerDownLeft className={cn('size-3.5 shrink-0 text-muted-foreground', !active && 'invisible')} aria-hidden />
      </li>
    </>
  )
}
