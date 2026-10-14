import { sectionMetadata } from '@/lib/i18n/metadata'
import { getLocale } from '@/lib/i18n/server'
import { HELP_CONTENT } from '@/lib/help'
import HelpLayer from '@/components/help/help-layer'

export const generateMetadata = () => sectionMetadata('help')

export default async function Page() {
  return <HelpLayer content={HELP_CONTENT[await getLocale()]} />
}
