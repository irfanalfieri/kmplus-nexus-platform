import { requirePageUser } from '@/lib/auth/session'
import DashboardLayout from '@/components/dashboard/dashboard-layout'
import { getWorkspaceContext } from '@/app/actions/workspaces'

// Server actions on this page include manual pipeline runs.
export const maxDuration = 300

export default async function DashboardPage() {
  await requirePageUser('/dashboard')

  const workspace = await getWorkspaceContext()
  return <DashboardLayout workspace={workspace} />
}
