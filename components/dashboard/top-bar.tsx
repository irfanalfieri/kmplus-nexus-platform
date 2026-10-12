'use client'

import { usePathname } from 'next/navigation'
import { Menu as MenuIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
      <div className="flex items-center gap-1 sm:gap-2">
        <NotificationBell />
        <ProfileMenu />
      </div>
    </header>
  )
}
