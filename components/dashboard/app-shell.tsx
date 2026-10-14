'use client'

import { useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'
import { WorkspaceProvider, type WorkspaceInfo } from '@/components/workspace/workspace-context'
import { ToastProvider } from '@/components/ui/toast'
import { TourProvider } from '@/components/tour/guided-tour'
import { useT } from '@/components/i18n/i18n-provider'
import Sidebar from './sidebar'
import TopBar from './top-bar'

/** The dashboard frame: rail (a drawer below 1024px), top bar, and the routed screen. */
export function AppShell({ workspace, attention, children }: { workspace: WorkspaceInfo; attention: { quality: number }; children: React.ReactNode }) {
  const t = useT()
  const [navOpen, setNavOpen] = useState(false)

  return (
    <WorkspaceProvider value={workspace}>
      <ToastProvider>
        <TourProvider>
          <a
            href="#main"
            className="sr-only z-[70] rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          >
            {t('nav.skip')}
          </a>
          <div className="flex h-dvh bg-background text-foreground">
            <aside className="hidden w-60 shrink-0 lg:block">
              <Sidebar attention={attention} />
            </aside>

            <DialogPrimitive.Root open={navOpen} onOpenChange={setNavOpen}>
              <DialogPrimitive.Portal>
                <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[#081a1c]/50 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 lg:hidden" />
                <DialogPrimitive.Popup
                  aria-label={t('nav.primary')}
                  className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] shadow-raised transition-transform duration-200 ease-out outline-none data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full lg:hidden"
                >
                  <DialogPrimitive.Close
                    aria-label={t('nav.closeMenu')}
                    className="absolute top-4 right-3 z-10 rounded-sm p-1 text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring"
                  >
                    <XIcon className="size-5" />
                  </DialogPrimitive.Close>
                  <Sidebar attention={attention} onNavigate={() => setNavOpen(false)} />
                </DialogPrimitive.Popup>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>

            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar onOpenNav={() => setNavOpen(true)} />
              <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
                <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{children}</div>
              </main>
            </div>
          </div>
        </TourProvider>
      </ToastProvider>
    </WorkspaceProvider>
  )
}
