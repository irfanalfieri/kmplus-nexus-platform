import { sectionMetadata } from '@/lib/i18n/metadata'
import DataQualityLayer from '@/components/dashboard/layers/data-quality-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('quality')

export default function Page() {
  return <DataQualityLayer />
}
