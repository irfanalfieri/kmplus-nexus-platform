import { sectionMetadata } from '@/lib/i18n/metadata'
import DataSourcesLayer from '@/components/dashboard/layers/data-sources-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('sources')

export default function Page() {
  return <DataSourcesLayer />
}
