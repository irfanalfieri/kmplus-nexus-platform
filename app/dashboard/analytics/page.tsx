import { sectionMetadata } from '@/lib/i18n/metadata'
import AnalyticsDashboardLayer from '@/components/dashboard/layers/analytics-dashboard-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('analytics')

export default function Page() {
  return <AnalyticsDashboardLayer />
}
