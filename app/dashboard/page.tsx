import { redirect } from 'next/navigation'
import { getWorkspaceContext } from '@/lib/actions/workspaces'
import { landingSection, sectionHref } from '@/lib/navigation'

/** /dashboard lands by role: stewards in the quarantine inbox, everyone else on the overview. */
export default async function DashboardIndex() {
  const { role } = await getWorkspaceContext()
  redirect(sectionHref(landingSection(role)))
}
