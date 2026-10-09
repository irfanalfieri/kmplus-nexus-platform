import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/dashboard/dashboard-layout'
import { getWorkspaceContext } from '@/app/actions/workspaces'

// Server actions on this page include manual pipeline runs.
export const maxDuration = 300

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const workspace = await getWorkspaceContext()
  return <DashboardLayout workspace={workspace} />
}
