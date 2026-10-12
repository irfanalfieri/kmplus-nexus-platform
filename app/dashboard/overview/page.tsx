import { sectionMetadata } from '@/lib/i18n/metadata'
import OverviewLayer from '@/components/dashboard/layers/overview-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('overview')

export default function Page() {
  return <OverviewLayer />
}
