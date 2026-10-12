import { sectionMetadata } from '@/lib/i18n/metadata'
import BusinessRulesLayer from '@/components/dashboard/layers/business-rules-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('rules')

export default function Page() {
  return <BusinessRulesLayer />
}
