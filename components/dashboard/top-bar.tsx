'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LifeBuoy, Menu as MenuIcon, Route } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { useTour } from '@/components/tour/guided-tour'
import { cn } from '@/lib/utils'
import { useT } from '@/components/i18n/i18n-provider'
import { useWorkspace } from '@/components/workspace/workspace-context'
import NotificationBell from './notification-bell'
import { ProfileMenu } from './profile-menu'
import { JumpTo } from './jump-to'
import { currentSection } from './sidebar'

export default function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const t = useT()
  const { workspace } = useWorkspace()
  const section = currentSection(usePathname())
  const tour = useTour()

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:px-5">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('nav.menu')} onClick={onOpenNav}>
        <MenuIcon />
      </Button>
      <nav aria-label={t('shell.breadcrumb')} className="hidden min-w-0 md:block">
        <ol className="flex items-center gap-1.5 text-sm">
          <li className="max-w-56 truncate text-muted-foreground">{workspace.name}</li>
          {section && (
            <>
              <li aria-hidden className="text-muted-foreground">/</li>
              <li aria-current="page" className="font-medium">
                {t(`nav.${section}`)}
              </li>
            </>
          )}
        </ol>
      </nav>
      <div className="flex min-w-0 flex-1 justify-end md:justify-center">
        <JumpTo />
      </div>
      <div className="flex items-center gap-1 sm:gap-1.5">
        <Button variant="ghost" aria-label={t('tour.guideMeLabel')} aria-pressed={tour.active} onClick={tour.start} className="px-2 xl:px-2.5">
          <Route aria-hidden />
          <span className="hidden xl:inline">{t('tour.guideMe')}</span>
        </Button>
        <Link
          href="/dashboard/help"
          data-tour="help-button"
          aria-label={t('tour.helpLabel')}
          aria-current={section === 'help' ? 'page' : undefined}
          className={cn(buttonVariants({ variant: 'ghost' }), 'px-2 aria-[current=page]:bg-muted xl:px-2.5')}
        >
          <LifeBuoy aria-hidden />
          <span className="hidden xl:inline">{t('tour.help')}</span>
        </Link>
        <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-border sm:block" />
        <NotificationBell />
        <ProfileMenu />
      </div>
    </header>
  )
}
