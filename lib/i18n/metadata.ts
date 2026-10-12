import type { Metadata } from 'next'
import type { Section } from '@/lib/navigation'
import { getTranslator } from './server'

/** Page title and description for a dashboard screen, in the user's language. */
export async function sectionMetadata(section: Section): Promise<Metadata> {
  const t = await getTranslator()
  return { title: t(`pages.${section}.title`), description: t(`pages.${section}.description`) }
}
