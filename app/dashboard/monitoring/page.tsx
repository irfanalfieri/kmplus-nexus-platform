import { sectionMetadata } from '@/lib/i18n/metadata'
import SchedulerMonitoringLayer from '@/components/dashboard/layers/scheduler-monitoring-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('monitoring')

export default function Page() {
  return <SchedulerMonitoringLayer />
}
