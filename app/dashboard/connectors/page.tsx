import { sectionMetadata } from '@/lib/i18n/metadata'
import ConnectorLayer from '@/components/dashboard/layers/connector-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('connectors')

export default function Page() {
  return <ConnectorLayer />
}
