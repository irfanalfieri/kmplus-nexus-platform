import { sectionMetadata } from '@/lib/i18n/metadata'
import PipelineDesignerLayer from '@/components/dashboard/layers/pipeline-designer-layer'

export const maxDuration = 300
export const generateMetadata = () => sectionMetadata('pipelines')

export default function Page() {
  return <PipelineDesignerLayer />
}
