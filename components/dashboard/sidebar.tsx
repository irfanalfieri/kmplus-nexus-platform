'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, BarChart3, BookOpen, Database, LayoutDashboard, Plug, Scale, Settings, Shield, ShieldCheck, Workflow, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NAV_GROUPS, sectionHref, type Section } from '@/lib/navigation'
import { KmWordmark } from '@/components/brand/km-wordmark'
import WorkspaceSwitcher from '@/components/workspace/workspace-switcher'
import { useT } from '@/components/i18n/i18n-provider'

export const SECTION_ICONS: Record<Section, LucideIcon> = {
  overview: LayoutDashboard,
  sources: Database,
  connectors: Plug,
  pipelines: Workflow,
  rules: Scale,
  quality: ShieldCheck,
  catalog: BookOpen,
  monitoring: Activity,
  analytics: BarChart3,
  governance: Shield,
  settings: Settings,
}

export function currentSection(pathname: string): Section | null {
  const slug = pathname.split('/')[2]
  return (NAV_GROUPS.flatMap((g) => g.items) as readonly string[]).includes(slug) ? (slug as Section) : null
}

/** The rail: wordmark, workspace, and the screens grouped by job. */
export default function Sidebar({ attention, onNavigate }: { attention: { quality: number }; onNavigate?: () => void }) {
  const t = useT()
  const active = currentSection(usePathname())

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <KmWordmark className="h-[22px] text-sidebar-accent-foreground" />
        <span className="text-[15px] font-light tracking-wide text-sidebar-accent-foreground">{t('shell.product')}</span>
      </div>
      <div className="px-3 pb-3">
        <WorkspaceSwitcher />
      </div>

      <nav aria-label={t('nav.primary')} className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map(({ group, items }) => (
          <div key={group} className="mt-3 first:mt-1">
            {group !== 'home' && (
              <h2 className="px-2.5 pb-1 font-mono text-[11px] font-medium tracking-[0.08em] text-sidebar-muted uppercase">{t(`nav.groups.${group}`)}</h2>
            )}
            <ul className="space-y-px">
              {items.map((item) => {
                const Icon = SECTION_ICONS[item]
                const current = item === active
                const count = item === 'quality' ? attention.quality : 0
                return (
                  <li key={item}>
                    <Link
                      href={sectionHref(item)}
                      onClick={onNavigate}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'relative flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-sm transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sidebar-ring',
                        current && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-sm before:bg-sidebar-primary',
                      )}
                    >
                      <Icon className={cn('size-4 shrink-0', current ? 'text-sidebar-primary' : 'text-sidebar-muted')} aria-hidden />
                      <span className="flex-1 truncate">{t(`nav.${item}`)}</span>
                      {count > 0 && (
                        <span className="rounded-sm bg-sidebar-alert px-1.5 font-mono text-[11px] leading-[18px] font-medium text-sidebar-primary-foreground">
                          <span aria-hidden>{count > 999 ? '999+' : count}</span>
                          <span className="sr-only">{t('nav.qualityBadge', { count })}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  )
}
