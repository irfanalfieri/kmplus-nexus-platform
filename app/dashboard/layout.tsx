import { requirePageUser } from '@/lib/auth/session'
import { getWorkspaceContext } from '@/lib/actions/workspaces'
import { countOpenQuarantine } from '@/lib/quality/attention'
import { AppShell } from '@/components/dashboard/app-shell'

// Server actions on these pages include manual pipeline runs.
export const maxDuration = 300

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser('/dashboard')
  const workspace = await getWorkspaceContext()
  const quality = await countOpenQuarantine(workspace.workspace.id)
  return (
    <AppShell workspace={workspace} attention={{ quality }}>
      {children}
    </AppShell>
  )
}
