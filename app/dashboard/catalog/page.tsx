import { sectionMetadata } from '@/lib/i18n/metadata'
import CatalogLayer from '@/components/dashboard/layers/catalog-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('catalog')

export default function Page() {
  return <CatalogLayer />
}
