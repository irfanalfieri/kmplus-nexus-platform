import { headers } from 'next/headers'
import { requirePageUser } from '@/lib/auth/session'
import { safeNextPath } from '@/lib/safe-redirect'
import { getWorkspaceContext } from '@/lib/actions/workspaces'
import { countOpenQuarantine } from '@/lib/quality/attention'
import { AppShell } from '@/components/dashboard/app-shell'

// Server actions on these pages include manual pipeline runs.
export const maxDuration = 300

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // The page asked for (set by proxy.ts), so the sign-in, terms and 2FA gates come back to it.
  await requirePageUser(safeNextPath((await headers()).get('x-nexus-path')))
  const workspace = await getWorkspaceContext()
  const quality = await countOpenQuarantine(workspace.workspace.id)
  return (
    <AppShell workspace={workspace} attention={{ quality }}>
      {children}
    </AppShell>
  )
}
