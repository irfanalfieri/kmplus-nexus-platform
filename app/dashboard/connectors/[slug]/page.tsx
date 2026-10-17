import type { Metadata } from 'next'
import { getTranslator } from '@/lib/i18n/server'
import { getConnectorDefinition, isConnectorSlug } from '@/lib/connectors/catalog'
import { ConnectorDetail } from '@/components/connectors/connector-detail'

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getTranslator()
  const { slug } = await params
  const name = isConnectorSlug(slug) ? getConnectorDefinition(slug)?.name : undefined
  return { title: name ? `${name} · ${t('pages.connectors.title')}` : t('pages.connectors.title'), description: t('pages.connectors.description') }
}

export default async function Page({ params }: Params) {
  const { slug } = await params
  return <ConnectorDetail slug={slug} />
}
