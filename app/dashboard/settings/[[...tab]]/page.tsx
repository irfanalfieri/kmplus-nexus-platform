import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { isSettingsTab } from '@/lib/navigation'
import { getTranslator } from '@/lib/i18n/server'
import WorkspaceSettingsLayer from '@/components/dashboard/layers/workspace-settings-layer'

export const maxDuration = 300

type Params = { params: Promise<{ tab?: string[] }> }

function tabOf(segments: string[] | undefined) {
  if (!segments?.length) return 'general'
  return segments.length === 1 && isSettingsTab(segments[0]) ? segments[0] : null
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getTranslator()
  const tab = tabOf((await params).tab)
  const page = t('pages.settings.title')
  return { title: tab && tab !== 'general' ? `${t(`settings.${tab}`)} · ${page}` : page, description: t('pages.settings.description') }
}

export default async function SettingsPage({ params }: Params) {
  const tab = tabOf((await params).tab)
  if (!tab) notFound()
  return <WorkspaceSettingsLayer tab={tab} />
}
