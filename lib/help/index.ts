import type { Locale } from '@/lib/i18n/config'
import type { HelpContent } from './types'
import { helpEn } from './content/en'
import { helpId } from './content/id'

/** The guide per language; the Help page passes only the reader's language to the browser. */
export const HELP_CONTENT: Record<Locale, HelpContent> = { en: helpEn, id: helpId }
