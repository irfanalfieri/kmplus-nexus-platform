import { sectionMetadata } from '@/lib/i18n/metadata'
import GovernanceLayer from '@/components/dashboard/layers/governance-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('governance')

export default function Page() {
  return <GovernanceLayer />
}
